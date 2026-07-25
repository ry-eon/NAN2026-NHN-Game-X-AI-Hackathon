// M2b 전투 sim 검증 — 렌더 없이 판이 성립함을 단언한다 ("생성이 아니라 보증").
// 결정론 · 무방비 패배 · 기본 배치 승리(시드 검증) · 부대 이동 · 지상 접전.

import { describe, expect, it } from 'vitest'
import {
  WALL_HP,
  createSiege,
  stepSiege,
  UNIT_KINDS,
  type SiegeInput,
  type SiegeState,
} from '../sim/world'

const SEED = 20260725
const MAX_TICKS = 30 * 300 // 5분 상한 — 이 안에 승패가 나야 한다

/** 스크립트 입력으로 판 전체 실행. 종료 틱·최종 상태 반환 */
function runSiege(
  seed: number,
  inputAt: (tick: number, state: SiegeState) => SiegeInput,
  mutate?: (state: SiegeState) => void,
): SiegeState {
  const { state, spawns } = createSiege(seed)
  mutate?.(state)
  for (let i = 0; i < MAX_TICKS; i++) {
    stepSiege(state, spawns, inputAt(i, state))
    if (state.status === 'won' || state.status === 'lost') break
  }
  return state
}

describe('M2b 전투', () => {
  it('결정론: 같은 (시드, 입력 시퀀스)는 같은 결과', () => {
    const script = (tick: number, state: SiegeState): SiegeInput => {
      if (tick === 0) return { startAssault: true }
      if (tick === 60)
        return { unitMove: { ids: state.units.slice(0, 3).map((u) => u.id), to: { x: -6, z: -8, h: 11 } } }
      if (tick === 300) return { moveTo: { x: -6, z: 8, h: 11 } }
      if (tick === 600) {
        const hero = state.units.find((u) => u.kind === 'hero')
        return hero ? { unitMove: { ids: [hero.id], to: { x: 2, z: 0 } } } : {}
      }
      return {}
    }
    const a = runSiege(SEED, script)
    const b = runSiege(SEED, script)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('무방비(유닛 0)면 성벽이 뚫려 패배한다', () => {
    const end = runSiege(
      SEED,
      (tick) => (tick === 0 ? { startAssault: true } : {}),
      (state) => {
        state.units = []
      },
    )
    expect(end.status).toBe('lost')
    expect(end.wallHp).toBe(0)
  })

  it('기본 배치는 시드 판을 막아낸다 — 봇 검증의 원형', () => {
    const end = runSiege(SEED, (tick) => (tick === 0 ? { startAssault: true } : {}))
    expect(end.status).toBe('won')
    expect(end.wallHp).toBeGreaterThan(0)
    expect(end.enemies).toHaveLength(0)
  })

  it('부대 명령: 성벽 위 궁수가 계단을 거쳐 지상 목표로 이동한다', () => {
    const { state, spawns } = createSiege(SEED)
    const soldier = state.units.find((u) => u.kind === 'soldier')!
    expect(soldier.h).toBe(11)
    stepSiege(state, spawns, { unitMove: { ids: [soldier.id], to: { x: -14, z: -8 } } })
    for (let i = 0; i < 1200 && soldier.path.length > 0; i++) stepSiege(state, spawns, {})
    expect(soldier.h).toBe(0)
    expect(Math.hypot(soldier.pos.x - -14, soldier.pos.z - -8)).toBeLessThan(2.5)
  })

  it('지상 아군은 괴수와 접전한다 — 성벽 대신 유닛을 때린다', () => {
    const { state, spawns } = createSiege(SEED)
    stepSiege(state, spawns, { startAssault: true })
    const hero = state.units.find((u) => u.kind === 'hero')!
    // 영웅 바로 옆에 야귀 배치 (첫 정규 스폰은 4초 뒤라 간섭 없음)
    state.enemies.push({
      id: state.nextId++,
      kind: 'grunt',
      pos: { x: hero.pos.x + 1.0, z: hero.pos.z },
      hp: 480,
      cooldown: 0,
      atWall: false,
      wave: 0,
    })
    for (let i = 0; i < 60; i++) stepSiege(state, spawns, {})
    expect(hero.hp).toBeLessThan(UNIT_KINDS.hero!.hp)
    expect(state.wallHp).toBe(WALL_HP)
  })
})
