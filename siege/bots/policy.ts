// 봇 정책 — `(관측 가능한 state) -> 커맨드` 순수 함수.
//
// 이 파일은 렌더링도 DOM도 모른다. 봇이 sim에 넣는 입력은 플레이어가 넣는 입력과
// **완전히 같은 타입**(SiegeInput)이다. 그래서 봇이 통과시킨 판은 곧 플레이어가 하는 판이고,
// 봇이 남긴 커맨드 시퀀스는 그대로 리플레이가 된다 — 이 프로젝트의 논지("생성이 아니라 보증")가
// 성립하는 지점이 여기다.
//
// 등급을 넷 두는 이유: 하나로는 "이 판이 성립한다"를 말할 수 없다. (장착제 개정 2026-08-08 —
// 병기는 빈 채로 시작하고 수비병을 장착해야 쏜다. "아무것도 안 하면 지는 게 맞다"는 디렉션으로
// 무개입의 역할이 「성립의 증명」에서 「배치가 의미 있다는 증명」으로 바뀌었다)
//   afk    = 정말 아무것도 안 함 → **져야 한다** — 장착(배치)이 게임에 실제로 의미 있는가
//   deploy = 표준 장착 후 무개입 → 배치만으로 성립하는가 (구 afk의 역할을 잇는 기준선)
//   greedy = 적극 플레이        → 플레이어의 개입이 보상되는가
//   random = 장착 후 아무렇게나 → 심사자가 대충 조작해도 무너지지 않는가

import { CASTLE, CREW_MAN_RADIUS, FIELD, MAGE_SKILLS, TICKS_PER_SECOND, WALL_X, manningMap, mountPoint } from '../sim/world'
import type { SiegeInput, SiegeState, Vec2 } from '../sim/world'

export interface BotPolicy {
  name: string
  desc: string
  /** 매 틱 호출. 커맨드를 낼 틱에만 입력을 반환한다(대부분의 틱은 undefined) */
  act(state: SiegeState, rand: () => number): SiegeInput | undefined
}

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z)
const sec = (n: number): number => Math.round(n * TICKS_PER_SECOND)

/**
 * 준비 단계 표준 장착 — 빈 병기(id 순)마다 가장 가까운 대기 수비병을 조작 위치로 보낸다.
 * 한 틱에 명령 하나(리플레이가 사람 손과 같은 리듬).
 *
 * 판정은 **의도 기준**이다: 정지한 병사의 실제 장착 + 걸어가는 병사의 목적지.
 * 순간 위치(manningMap)로 판정하면 걸어 지나가는 병사가 남의 병기를 일시 점유해
 * "다 장착됐다"로 오판하고 개시해버린다 — 실측: 보행 중 5기인 채 개시 → 빈 병기가
 * 판 내내 남아 기준선이 614 → 113으로 무너졌다. 개시는 **전원 정착 후에만** 한다.
 * 반환: null = 전 병기 장착·정착 완료(침공 개시 가능), {} = 보행 대기, 그 외 = 이동 명령.
 */
function deployPrep(s: SiegeState): SiegeInput | null {
  const crewKinds = new Set(Object.values(s.kinds.units).filter((d) => d.crew).map((d) => d.crew!))
  const guards = s.units.filter((u) => crewKinds.has(u.kind))
  const weapons = s.units.filter((u) => s.kinds.units[u.kind]!.crew)
  // 1) 정지 병사만으로 잰 실제 장착 (병기 id 순 최근접 배정 — manningMap과 같은 규칙)
  const claimed = new Set<number>()
  const covered = new Set<number>()
  for (const w of weapons) {
    let best: (typeof guards)[number] | null = null
    let bestD = Infinity
    for (const g of guards) {
      if (claimed.has(g.id) || g.path.length > 0) continue
      if (Math.abs(g.h - w.h) > 1.5) continue
      const d = dist(g.pos, w.pos)
      if (d <= CREW_MAN_RADIUS && (d < bestD || (d === bestD && best !== null && g.id < best.id))) {
        best = g
        bestD = d
      }
    }
    if (best) {
      claimed.add(best.id)
      covered.add(w.id)
    }
  }
  // 2) 걸어가는 병사는 목적지로 배정을 친다 — 같은 병기에 두 번 파병하지 않기 위함
  for (const g of guards) {
    if (g.path.length === 0) continue
    const last = g.path[g.path.length - 1]!
    for (const w of weapons) {
      if (covered.has(w.id)) continue
      if (dist(last, w.pos) <= CREW_MAN_RADIUS + 1) {
        covered.add(w.id)
        break
      }
    }
  }
  const walking = guards.some((g) => g.path.length > 0)
  const uncovered = weapons.filter((w) => !covered.has(w.id))
  if (uncovered.length === 0) return walking ? {} : null
  const idle = guards.filter((g) => !claimed.has(g.id) && g.path.length === 0)
  for (const w of uncovered) {
    const g = idle.sort((a, b) => dist(a.pos, w.pos) - dist(b.pos, w.pos) || a.id - b.id)[0]
    if (!g) return {} // 보낼 병사가 없다 — 걷는 병사들이 정착한 뒤 다시 판단
    return { unitMove: { ids: [g.id], to: mountPoint(w) } }
  }
  return {}
}

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
  desc: '침공만 개시하고 정말 아무것도 안 한다 — 장착 없이는 성이 무너짐을 증명하는 하한 (패배가 정상)',
  act: (s) => (s.status === 'prep' ? { startAssault: true } : undefined),
}

export const deploy: BotPolicy = {
  name: 'deploy',
  desc: '표준 장착만 하고 침공 후엔 손대지 않는다 — 배치만으로 성립하는지의 기준선',
  act: (s) => (s.status === 'prep' ? (deployPrep(s) ?? { startAssault: true }) : undefined),
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
  desc: '표준 장착 뒤, 전선 쪽으로 병기를 겨누고 흐름이 몰리는 구간으로 마법사를 옮겨 궁극 업화로 끊는다 — 적극 플레이',
  act(s) {
    if (s.status === 'prep') return deployPrep(s) ?? { startAssault: true }
    if (s.status !== 'assault') return undefined

    // 스킬 개편(2026-08-08) 후 역할: 업화는 마법사의 궁극(슬롯 2)이 됐다.
    // 봇의 스킬·재배치 로직은 마법사가 계승하고, 전사는 안뜰 대응 1순위로 쓴다.
    const mage = s.units.find((u) => u.kind === 'mage')
    const ult = MAGE_SKILLS[2]!

    // 1) 궁극 업화 — 쿨이 돌고 반경 안에 3기 이상 몰렸을 때만 (2026-08-06 재검증에서
    //    2기 기준이 과소비로 판명 — 6시드 스윕에서 3기 기준이 전 시드 우세)
    if (mage && (mage.cds[2] ?? 1) <= 0 && s.enemies.length > 0) {
      const spot = densestPoint(s, ult.radius)
      if (spot && spot.n >= 3 && dist(mage.pos, spot) <= ult.range) {
        return { castSkill: { casterId: mage.id, slot: 2, x: spot.x, z: spot.z } }
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

    // 3) 안뜰이 뚫렸으면 조작 병사를 병기에서 빼 내려보낸다 (2026-08-06 룰 개정:
    //    하차 스폰이 아니라 실재 유닛의 이동 — 계단을 타는 시간이 실제로 든다).
    //    성벽 위 화력은 터널·안뜰에 닿지 않으므로, 여기서만은 지상 전력이 유일한 답이다.
    const intruders = s.enemies.filter((e) => e.mode === 'breach' && e.pos.x < CASTLE.east - CASTLE.wallT / 2)
    if (intruders.length > 0) {
      // 전사 먼저 — 지상전 전담(2026-08-08 킷). 어택땅으로 보내 접적 시 그 자리에서 교전
      const warrior = s.units.find((u) => u.kind === 'hero')
      if (warrior && warrior.path.length === 0 && dist(warrior.pos, intruders[0]!.pos) > 6) {
        return { unitMove: { ids: [warrior.id], to: { x: intruders[0]!.pos.x, z: intruders[0]!.pos.z, h: 0 }, attack: true } }
      }
      const map = manningMap(s)
      const manning = new Set(map.values())
      const crewKinds = new Set(Object.values(s.kinds.units).filter((d) => d.crew).map((d) => d.crew!))
      const guards = s.units.filter((u) => crewKinds.has(u.kind))
      // "대응 중"인 병사 = 이동 명령을 받았거나 이미 병기 곁을 비운 수비병
      const responding = guards.filter((u) => u.path.length > 0 || u.target !== null || !manning.has(u.id)).length
      if (responding < intruders.length) {
        // 전선에서 가장 먼 병기의 병사부터 뗀다 — 화력 손실이 가장 적은 문
        const spare = guards
          .filter((u) => u.path.length === 0 && manning.has(u.id))
          .sort((a, b) => Math.abs(b.pos.z - intruders[0]!.pos.z) - Math.abs(a.pos.z - intruders[0]!.pos.z))[0]
        if (spare) {
          return { unitMove: { ids: [spare.id], to: { x: intruders[0]!.pos.x, z: intruders[0]!.pos.z, h: 0 } } }
        }
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

    // 5) 마법사 — 성벽 안쪽 지상을 따라 움직여 궁극 사거리(18) 안에 전선을 넣는다.
    //    문턱 10: 이동 중엔 못 쏘므로 재배치는 참을수록 이득 (6시드 스윕으로 확정)
    if (!mage || s.tick % sec(6) !== 0) return undefined
    if (Math.abs(mage.pos.z - tz) <= 10) return undefined
    return { unitMove: { ids: [mage.id], to: { x: WALL_X - 6, z: clampWallZ(tz) } } }
  },
}

export const random: BotPolicy = {
  name: 'random',
  // 장착은 하고 시작한다 — 장착제 이후 "정말 아무것도 안 한 판"은 즉시 지는 게 정상이라
  // 장착 없는 random은 afk와 같은 판정이 되고 검증이 시늉이 된다. 이 봇이 재는 것은
  // "게임에 들어온 사람이 엉뚱하게 만졌을 때"지 "게임을 시작 안 했을 때"가 아니다.
  desc: '표준 장착 뒤, 5초마다 30% 확률로 아무 병기나 엉뚱한 곳에 겨누고 영웅을 아무 데로 보낸다 — 심사자가 대충 만지는 경우',
  act(s, rand) {
    if (s.status === 'prep') return deployPrep(s) ?? { startAssault: true }
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

export const POLICIES: BotPolicy[] = [afk, deploy, greedy, random]
