// M2b 전투 sim 검증 — 렌더 없이 판이 성립함을 단언한다 ("생성이 아니라 보증").
// 결정론 · 무방비 패배 · 기본 배치 승리(시드 검증) · 부대 이동 · 지상 접전.

import { describe, expect, it } from 'vitest'
import {
  CASTLE,
  ENEMY_KINDS,
  findPath,
  HERO_SKILL,
  stepHeight,
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

  it('영역 정합: 흉벽 띠는 설 수 없고, 터널은 통행, 괴수는 벽 바깥 면에서 멈춘다', () => {
    const outerFace = CASTLE.east + CASTLE.wallT / 2 // -2
    // 보도에서 흉벽 띠(동벽 바깥 1.3)로는 못 들어간다 — 성가퀴 돌 속에 서던 문제
    expect(stepHeight(CASTLE.wallH, outerFace - 0.5, 10)).toBeNull()
    // 북벽 바깥 띠·모서리 캡도 마찬가지
    expect(stepHeight(CASTLE.wallH, -6, CASTLE.north - CASTLE.wallT / 2 + 0.5)).toBeNull()
    expect(stepHeight(CASTLE.wallH, outerFace - 0.5, CASTLE.north - CASTLE.wallT / 2 + 0.5)).toBeNull()
    // 성문 터널은 벽 두께 전체가 지상 통행
    expect(stepHeight(0, outerFace - 0.5, 0)).toBe(0)
    // 흉벽 위(설 수 없는 지점) 클릭 → 가장 가까운 보도 지점으로 근접 이동 (명령 무시 대신)
    const path = findPath({ x: -6, z: 10 }, { x: outerFace - 0.4, z: 10 }, CASTLE.wallH, CASTLE.wallH)
    expect(path).not.toBeNull()
    // 괴수 정지선 = 벽 바깥 면 + 반경 (벽 속으로 파고들던 문제)
    const { state, spawns } = createSiege(SEED)
    state.units = []
    stepSiege(state, spawns, { startAssault: true })
    for (let i = 0; i < 30 * 40; i++) stepSiege(state, spawns, {})
    const atWall = state.enemies.filter((e) => e.atWall)
    expect(atWall.length).toBeGreaterThan(0)
    for (const e of atWall) {
      expect(e.pos.x).toBeGreaterThanOrEqual(outerFace + ENEMY_KINDS[e.kind]!.radius)
    }
  })

  it('영웅 스킬: 반경 내 광역 피해 + 쿨다운·사거리 검증', () => {
    const { state, spawns } = createSiege(SEED)
    stepSiege(state, spawns, { startAssault: true })
    const hero = state.units.find((u) => u.kind === 'hero')!
    state.units = [hero] // 다른 유닛 사격이 수치 단언에 끼지 않게
    const mkGrunt = (x: number, z: number) => ({
      id: state.nextId++,
      kind: 'grunt',
      pos: { x, z },
      hp: 700,
      cooldown: 0,
      atWall: false,
      wave: 0,
    })
    // 시전점 (2,0) — 영웅(-12,0)에서 d=14 ≤ 사거리 18. 반경 4.5 안 2마리 + 밖 1마리
    state.enemies.push(mkGrunt(2, 0), mkGrunt(3, 1.5), mkGrunt(2, 8))
    stepSiege(state, spawns, { heroSkill: { x: 2, z: 0 } })
    expect(state.enemies.filter((e) => e.hp === 700 - HERO_SKILL.dmg)).toHaveLength(2)
    expect(state.enemies.filter((e) => e.hp === 700).length).toBeGreaterThanOrEqual(1)
    expect(hero.skillCd).toBeGreaterThan(0)
    // 쿨다운 중 재시전은 무시된다
    const cdBefore = hero.skillCd
    stepSiege(state, spawns, { heroSkill: { x: 2, z: 0 } })
    expect(hero.skillCd).toBe(cdBefore - 1)
    // 사거리 밖 시전은 쿨다운도 소모하지 않는다
    hero.skillCd = 0
    stepSiege(state, spawns, { heroSkill: { x: 40, z: 0 } })
    expect(hero.skillCd).toBe(0)
  })
})
