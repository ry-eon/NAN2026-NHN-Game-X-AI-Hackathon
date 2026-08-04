// 봇 정책 — `(관측 가능한 state) -> 커맨드` 순수 함수.
//
// 이 파일은 렌더링도 DOM도 모른다. 봇이 sim에 넣는 입력은 플레이어가 넣는 입력과
// **완전히 같은 타입**(SiegeInput)이다. 그래서 봇이 통과시킨 판은 곧 플레이어가 하는 판이고,
// 봇이 남긴 커맨드 시퀀스는 그대로 리플레이가 된다 — 이 프로젝트의 논지("생성이 아니라 보증")가
// 성립하는 지점이 여기다.
//
// 등급을 셋 두는 이유: 하나로는 "이 판이 성립한다"를 말할 수 없다.
//   afk    = 손 안 댄 하한 → 기본 배치만으로 성립하는가
//   greedy = 적극 플레이   → 플레이어의 개입이 보상되는가
//   random = 아무렇게나 만짐 → 심사자가 대충 조작해도 무너지지 않는가

import { CASTLE, FIELD, HERO_SKILL, TICKS_PER_SECOND, WALL_X } from '../sim/world'
import type { SiegeInput, SiegeState, Vec2 } from '../sim/world'

export interface BotPolicy {
  name: string
  desc: string
  /** 매 틱 호출. 커맨드를 낼 틱에만 입력을 반환한다(대부분의 틱은 undefined) */
  act(state: SiegeState, rand: () => number): SiegeInput | undefined
}

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z)
const sec = (n: number): number => Math.round(n * TICKS_PER_SECOND)

/** 적 위치를 후보로 삼아 반경 안에 가장 많이 걸리는 지점 (스킬 조준 — 클라이언트 자동조준과 같은 방식) */
function densestPoint(state: SiegeState, radius: number): { x: number; z: number; n: number } | null {
  let best: { x: number; z: number; n: number } | null = null
  for (const c of state.enemies) {
    let n = 0
    for (const e of state.enemies) if (dist(c.pos, e.pos) <= radius) n++
    if (!best || n > best.n) best = { x: c.pos.x, z: c.pos.z, n }
  }
  return best
}

/** 성벽을 위협하는 적들의 z 중심 — 접근한 적일수록 크게 친다 */
function threatZ(state: SiegeState): number | null {
  let wsum = 0
  let w = 0
  for (const e of state.enemies) {
    // 벽에 가까울수록 1. 회절 레인으로 돌아 벽보다 서쪽에 선 적이 과대평가되지 않게 상한을 둔다
    const closeness = Math.min(1, Math.max(0, 1 - (e.pos.x - WALL_X) / 30))
    if (closeness <= 0) continue
    wsum += e.pos.z * closeness
    w += closeness
  }
  return w > 0 ? wsum / w : null
}

export const afk: BotPolicy = {
  name: 'afk',
  desc: '침공만 개시하고 손대지 않는다 — 기본 배치만으로 성립하는지의 기준선',
  act: (s) => (s.status === 'prep' ? { startAssault: true } : undefined),
}

// 이 게임의 핵심 제약: **유닛은 정지 상태에서만 사격한다**(sim 규칙).
// 그래서 재배치는 공짜가 아니라 "이동하는 동안 화력을 포기"하는 거래다.
// 1차 검증에서 2초마다 재배치하는 greedy가 무개입보다 크게 지는 것으로 이 대가가 드러났다.
// 아래 두 정책은 그 사실을 반영해 "가끔, 값어치 있을 때만" 움직인다.

// 2026-08-04 두 번 고쳤다. 「위협 회피 유도」로 화력을 쫓아 옮기는 게 손해가 됐고(늘 한 박자 늦다),
// 이어서 「대포 고정 + 조준」으로 옮기는 것 자체가 불가능해졌다. 이제 손잡이는 둘뿐이다:
//   - 조준 (화망을 어디에 그리나 = 괴수를 어디로 흘리나)
//   - 영웅 (위협 계산에 안 잡히는 지상 전력 = 킬존의 실탄)
const clampWallZ = (z: number): number => Math.max(CASTLE.north + 2, Math.min(CASTLE.south - 2, z))

export const greedy: BotPolicy = {
  name: 'greedy',
  desc: '전선 쪽으로 병기를 겨누고, 흐름이 몰리는 구간으로 영웅을 옮겨 업화로 끊는다 — 적극 플레이',
  act(s) {
    if (s.status === 'prep') return { startAssault: true }
    if (s.status !== 'assault') return undefined

    const hero = s.units.find((u) => u.kind === 'hero')
    if (!hero) return undefined

    // 1) 스킬 — 쿨이 돌고 반경 안에 2기 이상 몰렸을 때만 (한 마리에 쓰면 낭비)
    if (hero.skillCd === 0 && s.enemies.length > 0) {
      const spot = densestPoint(s, HERO_SKILL.radius)
      if (spot && spot.n >= 2 && dist(hero.pos, spot) <= HERO_SKILL.range) {
        return { heroSkill: { x: spot.x, z: spot.z, heroId: hero.id } }
      }
    }

    // 2) 부활술사 우선 — 이 자를 끊지 않으면 킬존에서 잡은 것들이 계속 다시 일어난다.
    //    설계가 의도한 판단이 그대로 정책이 된다: 잡몹을 붙잡고 있지 말고 술사를 먼저 끊는다.
    const boss = s.enemies.find((e) => s.kinds.enemies[e.kind]?.raise)
    if (boss && s.tick % sec(3) === 0) {
      const guns = s.units.filter((u) => u.aim !== null)
      const off = guns.filter(
        (u) => u.aim && Math.hypot(u.aim.x - boss.pos.x, u.aim.z - boss.pos.z) > 4
          && Math.hypot(u.pos.x - boss.pos.x, u.pos.z - boss.pos.z) <= s.kinds.units[u.kind]!.range,
      )
      // 전부 술사에게 돌리면 그 사이 본대가 성벽을 갉는다 — 절반만 뗀다
      const half = off.slice(0, Math.max(1, Math.floor(guns.length / 2)))
      if (half.length > 0) return { unitAim: { ids: half.map((u) => u.id), to: { x: boss.pos.x, z: boss.pos.z } } }
    }

    // 3) 안뜰이 뚫렸으면 병기 한 문을 버리고 조작 병사를 내려보낸다.
    //    성벽 위 화력은 터널·안뜰에 닿지 않으므로, 여기서만은 지상 전력이 유일한 답이다.
    const intruders = s.enemies.filter((e) => e.mode === 'breach' && e.pos.x < CASTLE.east - CASTLE.wallT / 2)
    if (intruders.length > 0) {
      const guards = s.units.filter((u) => u.kind === 'guard').length
      if (guards < intruders.length) {
        // 전선에서 가장 먼 병기부터 뗀다 — 화력 손실이 가장 적은 문
        const spare = s.units
          .filter((u) => !u.crewGone && s.kinds.units[u.kind]?.crew)
          .sort((a, b) => Math.abs(b.pos.z - intruders[0]!.pos.z) - Math.abs(a.pos.z - intruders[0]!.pos.z))[0]
        if (spare) return { dismount: { ids: [spare.id] } }
      }
    }

    const tz = threatZ(s)
    if (tz === null) return undefined

    // 4) 조준 — 4초에 한 번 전선 쪽으로 화망을 다시 그린다. 이동이 아니라 조준이라 즉시 먹는다.
    //    전부 한 점에 몰지는 않는다: 몰면 반대편이 완전히 비어 다음 웨이브가 통째로 그리로 흐른다.
    if (s.tick % sec(4) === 0) {
      const aimAt = clampWallZ(tz)
      const stale = s.units.filter((u) => u.aim !== null && Math.abs(u.aim.z - aimAt) > 8)
      if (stale.length > 0) {
        const send = stale.slice(0, Math.max(1, Math.ceil(stale.length * 0.6)))
        return { unitAim: { ids: send.map((u) => u.id), to: { x: WALL_X + 8, z: aimAt } } }
      }
    }

    // 5) 영웅 — 성벽 안쪽 지상을 따라 움직여 업화 사거리(18) 안에 전선을 넣는다
    if (s.tick % sec(6) !== 0) return undefined
    if (Math.abs(hero.pos.z - tz) <= 6) return undefined
    return { unitMove: { ids: [hero.id], to: { x: WALL_X - 6, z: clampWallZ(tz) } } }
  },
}

export const random: BotPolicy = {
  name: 'random',
  desc: '5초마다 30% 확률로 아무 병기나 엉뚱한 곳에 겨누고 영웅을 아무 데로 보낸다 — 심사자가 대충 만지는 경우',
  act(s, rand) {
    if (s.status === 'prep') return { startAssault: true }
    if (s.status !== 'assault') return undefined
    if (s.tick % sec(5) !== 0) return undefined
    if (rand() > 0.3) return undefined // 계속 만지작대지는 않는다
    // 대포가 고정된 뒤로 "대충 만진다"의 실체는 이동이 아니라 **엉뚱한 조준**이다.
    // 이동 명령만 무작위로 넣으면 고정 병기가 전부 무시해서 사실상 무개입과 같아진다 —
    // 그러면 이 봇은 통과하지만 검증은 시늉이 된다. 손잡이가 바뀌면 봇도 따라 바뀌어야 한다.
    const ids = s.units.filter((u) => u.aim !== null && rand() < 0.5).map((u) => u.id)
    if (ids.length > 0) {
      const z = FIELD.minZ + rand() * (FIELD.maxZ - FIELD.minZ)
      return { unitAim: { ids, to: { x: WALL_X + 4 + rand() * 20, z } } }
    }
    const hero = s.units.find((u) => u.kind === 'hero')
    if (!hero) return undefined
    const hz = clampWallZ(FIELD.minZ + rand() * (FIELD.maxZ - FIELD.minZ))
    return { unitMove: { ids: [hero.id], to: { x: WALL_X - 4 - rand() * 8, z: hz } } }
  },
}

export const POLICIES: BotPolicy[] = [afk, greedy, random]
