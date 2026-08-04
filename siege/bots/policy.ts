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

// 「위협 회피 유도」 도입(2026-08-04) 이후 적극 플레이의 실체가 바뀌었다.
// 성벽 위 화력을 쫓아 옮기는 건 오히려 손해다 — 옮기는 동안 사격을 멈추는 데다,
// 화망을 몰면 다음 웨이브는 그 반대편으로 흐르기 때문에 늘 한 박자 늦게 도착한다.
// 대신 성벽 위 배치는 고정해 화망을 유지하고, **위협 계산에 잡히지 않는 지상 영웅**을
// 흐름이 몰리는 쪽으로 옮겨 킬존을 지킨다. 그게 이 설계가 의도한 플레이다.
export const greedy: BotPolicy = {
  name: 'greedy',
  desc: '화망은 고정한 채, 흐름이 몰리는 구간으로 영웅을 옮겨 업화로 끊는다 — 적극 플레이',
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

    // 2) 영웅 재배치 — 6초에 한 번, 흐름이 크게 어긋났을 때만. 성벽 안쪽 지상을 따라 움직여
    //    업화 사거리(18) 안에 전선을 넣는다. 성벽 위 유닛은 건드리지 않는다.
    if (s.tick % sec(6) !== 0) return undefined
    const tz = threatZ(s)
    if (tz === null || Math.abs(hero.pos.z - tz) <= 6) return undefined
    const z = Math.max(CASTLE.north + 2, Math.min(CASTLE.south - 2, tz))
    return { unitMove: { ids: [hero.id], to: { x: WALL_X - 6, z } } }
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
