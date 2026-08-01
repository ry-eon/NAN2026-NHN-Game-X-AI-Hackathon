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
    const closeness = Math.max(0, 1 - (e.pos.x - WALL_X) / 30) // 벽에 가까울수록 1
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

export const greedy: BotPolicy = {
  name: 'greedy',
  desc: '영웅 스킬을 밀집점에 쓰고, 전선이 크게 쏠릴 때만 궁수를 옮긴다 — 적극 플레이',
  act(s) {
    if (s.status === 'prep') return { startAssault: true }
    if (s.status !== 'assault') return undefined

    // 1) 스킬 — 쿨이 돌고 반경 안에 2기 이상 몰렸을 때만 (한 마리에 쓰면 낭비)
    const hero = s.units.find((u) => u.kind === 'hero')
    if (hero && hero.skillCd === 0 && s.enemies.length > 0) {
      const spot = densestPoint(s, HERO_SKILL.radius)
      if (spot && spot.n >= 2 && dist(hero.pos, spot) <= HERO_SKILL.range) {
        return { heroSkill: { x: spot.x, z: spot.z, heroId: hero.id } }
      }
    }

    // 2) 재배치 — 8초에 한 번, 그것도 정말 멀리 떨어진 궁수만. 사격을 멈출 값어치가 있어야 한다.
    //    (전부 한 점에 모으지 않는다 — 겹치면 사거리 밖 구간이 그대로 비어버린다)
    if (s.tick % sec(8) !== 0) return undefined
    const tz = threatZ(s)
    if (tz === null) return undefined
    const archers = s.units.filter((u) => u.kind === 'soldier')
    const far = archers.filter((u) => Math.abs(u.pos.z - tz) > 12)
    if (far.length === 0) return undefined
    // 절반만 보낸다 — 나머지는 계속 쏜다
    const send = far.slice(0, Math.max(1, Math.floor(far.length / 2)))
    return { unitMove: { ids: send.map((u) => u.id), to: { x: WALL_X, z: tz, h: CASTLE.wallH } } }
  },
}

export const random: BotPolicy = {
  name: 'random',
  desc: '5초마다 30% 확률로 아무 부대나 성벽 아무 곳으로 보낸다 — 심사자가 대충 만지는 경우',
  act(s, rand) {
    if (s.status === 'prep') return { startAssault: true }
    if (s.status !== 'assault') return undefined
    if (s.tick % sec(5) !== 0) return undefined
    if (rand() > 0.3) return undefined // 계속 만지작대지는 않는다
    const movable = s.units.filter((u) => u.kind !== 'hero')
    const ids = movable.filter(() => rand() < 0.5).map((u) => u.id)
    if (ids.length === 0) return undefined
    const z = FIELD.minZ + rand() * (FIELD.maxZ - FIELD.minZ)
    return { unitMove: { ids, to: { x: WALL_X, z, h: CASTLE.wallH } } }
  },
}

export const POLICIES: BotPolicy[] = [afk, greedy, random]
