import { describe, expect, it } from 'vitest'
import { ENEMY_DEFS, STRUCTURE_DEFS, Simulation, TICKS_PER_SECOND, UNIT_DEFS } from '../src/index'
import type { StageDef } from '../src/index'

// 방어 시설 3종 (v3 길찾기 연동): 바리케이드/파수탑/기름 가마
const DEFS = [...UNIT_DEFS, ...STRUCTURE_DEFS]

function forkStage(): StageDef {
  // 두 갈래 길 — 시설로 조각하는 판
  return {
    id: 'test-fork',
    name: '갈림길',
    tilesRows: ['XXXXXX', 'WRRRRR', 'XRXXRX', 'XRRRRX', 'XXXXXX'],
    paths: [
      [
        { x: 4, y: 1 },
        { x: 3, y: 1 },
        { x: 2, y: 1 },
        { x: 1, y: 1 },
      ],
    ],
    wallHp: 500,
    initialCost: 99,
    costRegenPerSec: 0,
    costMax: 99,
    spawns: [{ tick: 30, enemyDefId: 'grunt', pathIndex: 0, wave: 1 }],
    seed: 1,
  }
}

const run = (sim: Simulation, seconds: number) => {
  for (let i = 0; i < seconds * TICKS_PER_SECOND; i++) sim.step()
}

describe('방어 시설', () => {
  it('바리케이드: 공격하지 않는 순수 장애물 — 괴수가 우회한다', () => {
    const sim = new Simulation(forkStage(), DEFS, ENEMY_DEFS)
    sim.step([{ type: 'deploy', unitDefId: 'barricade', x: 3, y: 1 }])
    run(sim, 8)
    const e = sim.state.enemies[0]!
    expect(e.blockedBy).toBeNull()
    expect(e.route.some((c) => c.y >= 2)).toBe(true) // 아랫길 우회
    expect(sim.state.units[0]!.hp).toBe(STRUCTURE_DEFS[0]!.hp) // 얻어맞지 않음
  })

  it('바리케이드 복수 건설 가능 + 완전 봉쇄 시 괴수가 부수려 든다', () => {
    const sim = new Simulation(forkStage(), DEFS, ENEMY_DEFS)
    sim.step([
      { type: 'deploy', unitDefId: 'barricade', x: 3, y: 1 },
      { type: 'deploy', unitDefId: 'barricade', x: 4, y: 3 },
    ])
    expect(sim.state.units).toHaveLength(2) // 복수 건설 (core는 원래 허용 — 시설의 정당한 사용)
    run(sim, 10)
    const wall = sim.state.units.find((u) => u.hp < STRUCTURE_DEFS[0]!.hp)
    expect(wall).toBeDefined() // 봉쇄 돌파 — 어느 한쪽을 두들기고 있다
    expect(sim.state.wallHp).toBe(500) // 성벽은 아직 무사
  })

  it('기름 가마: 사거리 내 모든 괴수를 동시 타격한다', () => {
    const stage = forkStage()
    stage.spawns = [
      { tick: 30, enemyDefId: 'grunt', pathIndex: 0, wave: 1 },
      { tick: 30, enemyDefId: 'grunt', pathIndex: 0, wave: 1 },
      { tick: 30, enemyDefId: 'grunt', pathIndex: 0, wave: 1 },
    ]
    const sim = new Simulation(stage, DEFS, ENEMY_DEFS)
    // 윗길 봉쇄(바리케이드) + 그 앞에 가마 → 대기 행렬을 태운다
    sim.step([
      { type: 'deploy', unitDefId: 'barricade', x: 2, y: 1 },
      { type: 'deploy', unitDefId: 'barricade', x: 4, y: 3 },
      { type: 'deploy', unitDefId: 'cauldron', x: 3, y: 1 },
    ])
    run(sim, 8)
    const burned = sim.state.enemies.filter((e) => e.hp < 480)
    expect(burned.length).toBeGreaterThanOrEqual(2) // 광역 화상
  })

  it('파수탑: 지상에 건설되는 원거리 — 성벽 위 슬롯 없이도 사격한다', () => {
    const sim = new Simulation(forkStage(), DEFS, ENEMY_DEFS)
    sim.step([{ type: 'deploy', unitDefId: 'watchtower', x: 4, y: 3 }])
    run(sim, 6)
    expect(sim.state.enemies.every((e) => e.hp < 480) || sim.state.enemies.length === 0).toBe(
      true,
    ) // 사거리 3.0 — 갈림길 어느 쪽이든 맞는다
  })
})
