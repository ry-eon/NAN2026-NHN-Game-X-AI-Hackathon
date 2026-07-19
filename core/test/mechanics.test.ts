import { describe, expect, it } from 'vitest'
import { ENEMY_DEFS, Simulation, TICKS_PER_SECOND, UNIT_DEFS } from '../src/index'
import type { StageDef } from '../src/index'

// W2 신규 메커니즘(광역/치유/감속/공성)을 전투 변수 없이 관찰하는 마이크로 스테이지들

function lineStage(overrides: Partial<StageDef> = {}): StageDef {
  return {
    id: 'test-line',
    name: '외길',
    tilesRows: ['XXXXXXXX', 'WRRRRRRR', 'XGGGGGGX', 'XXXXXXXX'],
    paths: [[7, 6, 5, 4, 3, 2, 1].map((x) => ({ x, y: 1 }))],
    wallHp: 500,
    initialCost: 99,
    costRegenPerSec: 0,
    costMax: 99,
    spawns: [],
    seed: 1,
    ...overrides,
  }
}

const run = (sim: Simulation, seconds: number) => {
  for (let i = 0; i < seconds * TICKS_PER_SECOND; i++) sim.step()
}

describe('W2 신규 메커니즘', () => {
  it('광역(술사): 같은 지점의 적 무리가 동일 피해를 함께 받는다', () => {
    const stage = lineStage({
      spawns: [1, 1, 1].map(() => ({ tick: 30, enemyDefId: 'grunt', pathIndex: 0, wave: 1 })),
    })
    const sim = new Simulation(stage, UNIT_DEFS, ENEMY_DEFS)
    sim.step([{ type: 'deploy', unitDefId: 'mage', x: 0, y: 1 }])
    run(sim, 10)

    const hps = sim.state.enemies.map((e) => e.hp)
    expect(hps.length).toBe(3)
    expect(new Set(hps).size).toBe(1) // 동시 스폰 → 같은 위치 → 항상 같은 피해
    expect(hps[0]!).toBeLessThan(480)
  })

  it('치유(의무병): 다친 아군을 사거리 안에서 회복시킨다', () => {
    // 스폰이 남아 있어야 즉시 승리 처리되지 않는다 (먼 미래 스폰으로 게임 유지)
    const sim = new Simulation(
      lineStage({ spawns: [{ tick: 99999, enemyDefId: 'grunt', pathIndex: 0, wave: 1 }] }),
      UNIT_DEFS,
      ENEMY_DEFS,
    )
    sim.step([
      { type: 'deploy', unitDefId: 'blocker', x: 2, y: 1 },
      { type: 'deploy', unitDefId: 'healer', x: 0, y: 1 },
    ])
    const blocker = sim.state.units.find((u) => u.defId === 'blocker')!
    blocker.hp = 100
    run(sim, 3)
    expect(blocker.hp).toBeGreaterThan(250) // 1.4s당 100 회복 × 2회 이상
  })

  it('감속(감속사): 오라 구간을 지나는 적이 더 늦게 도착한다', () => {
    const spawns = [{ tick: 1, enemyDefId: 'grunt' as const, pathIndex: 0, wave: 1 }]
    const plain = new Simulation(lineStage({ spawns }), UNIT_DEFS, ENEMY_DEFS)
    const slowed = new Simulation(lineStage({ spawns }), UNIT_DEFS, ENEMY_DEFS)
    slowed.step([{ type: 'deploy', unitDefId: 'slower', x: 4, y: 2 }]) // 진입로 옆 지상
    run(plain, 8)
    run(slowed, 8)
    // 감속사는 지상 칸이라 저지하지 않는다 — 순수하게 이동만 느려져야 한다
    expect(slowed.state.enemies[0]!.blockedBy).toBeNull()
    expect(slowed.state.enemies[0]!.pathPos).toBeLessThan(plain.state.enemies[0]!.pathPos - 0.5)
  })

  it('공성(공성차): 성벽 앞에서 멈춰 원거리로 성벽을 포격한다', () => {
    const stage = lineStage({
      spawns: [{ tick: 1, enemyDefId: 'siege', pathIndex: 0, wave: 1 }],
    })
    const sim = new Simulation(stage, UNIT_DEFS, ENEMY_DEFS)
    run(sim, 20)
    const siege = sim.state.enemies[0]!
    expect(siege.atWall).toBe(true)
    expect(siege.pathPos).toBeLessThanOrEqual(6 - 2.4) // 경로 끝(6)에서 2.5타일 앞 정지
    expect(sim.state.wallHp).toBeLessThan(stage.wallHp)
  })

  it('근접 자기 칸 공격: 원거리가 닿지 않는 포격 공성차를 근접으로 처치할 수 있다', () => {
    // 성벽 위 칸(0,2)이 포격 지점(x≈3.5, y1)에서 3.64타일 — 아처 사거리(3.5) 밖
    const stage: StageDef = {
      id: 'test-siege-melee',
      name: '공성 근접 처치',
      tilesRows: ['XXXXXXXXXX', 'XRRRRRRRRR', 'WGGGGGGGGX', 'XXXXXXXXXX'],
      paths: [[9, 8, 7, 6, 5, 4, 3, 2, 1].map((x) => ({ x, y: 1 }))],
      wallHp: 500,
      initialCost: 99,
      costRegenPerSec: 0,
      costMax: 99,
      spawns: [{ tick: 1, enemyDefId: 'siege', pathIndex: 0, wave: 1 }],
      seed: 1,
    }
    const sim = new Simulation(stage, UNIT_DEFS, ENEMY_DEFS)
    run(sim, 17) // 공성차가 정지 지점(pathPos 5.5, x=3.5)에 도달할 때까지
    expect(sim.state.enemies[0]!.atWall).toBe(true)
    sim.step([{ type: 'deploy', unitDefId: 'bruiser', x: 4, y: 1 }]) // 0.5타일 거리
    run(sim, 10)
    expect(sim.state.enemies).toHaveLength(0) // 저지 불가여도 자기 칸 공격으로 처치
    expect(sim.state.status).toBe('won')
  })
})
