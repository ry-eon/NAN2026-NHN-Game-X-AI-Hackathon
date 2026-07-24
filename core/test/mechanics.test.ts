import { describe, expect, it } from 'vitest'
import { ENEMY_DEFS, Simulation, TICKS_PER_SECOND, UNIT_DEFS, enemyWorldPos } from '../src/index'
import type { StageDef } from '../src/index'

// W2 신규 메커니즘(광역/치유/감속/공성)을 전투 변수 없이 관찰하는 마이크로 스테이지들

function lineStage(overrides: Partial<StageDef> = {}): StageDef {
  return {
    id: 'test-line',
    name: '외길',
    tilesRows: ['XXXXXXXX', 'WRRRRRRR', 'XXXXGXXX', 'XXXXXXXX'],
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
    slowed.step([{ type: 'deploy', unitDefId: 'slower', x: 4, y: 2 }]) // 알코브 (막다른 지상칸)
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
    // v3: 성벽(wallTop)까지 직선거리 2.5 이내에서 정지 — 접점보다 앞
    const pos = enemyWorldPos(sim.ctx, siege)
    expect(Math.hypot(pos.x - 0, pos.y - 1)).toBeLessThanOrEqual(2.6)
    expect(pos.x).toBeGreaterThan(1.2)
    expect(sim.state.wallHp).toBeLessThan(stage.wallHp)
  })

  it('연전 이월: 시작 성벽 HP를 지정할 수 있고 최대치로 캡된다', () => {
    const stage = lineStage()
    const carried = new Simulation(stage, UNIT_DEFS, ENEMY_DEFS, undefined, 220)
    expect(carried.state.wallHp).toBe(220)
    const over = new Simulation(stage, UNIT_DEFS, ENEMY_DEFS, undefined, 9999)
    expect(over.state.wallHp).toBe(stage.wallHp)
    const floor = new Simulation(stage, UNIT_DEFS, ENEMY_DEFS, undefined, 0)
    expect(floor.state.wallHp).toBe(1)
  })

  it('성벽 수리: 코스트를 소모해 회복하고, 상한·쿨다운·잔액을 검증한다', () => {
    const sim = new Simulation(
      lineStage({ spawns: [{ tick: 99999, enemyDefId: 'grunt', pathIndex: 0, wave: 1 }] }),
      UNIT_DEFS,
      ENEMY_DEFS,
    )
    sim.state.wallHp = 200
    const costBefore = sim.state.cost
    sim.step([{ type: 'repairWall' }])
    expect(sim.state.wallHp).toBe(380) // +180
    expect(sim.state.cost).toBeCloseTo(costBefore - 12, 5)

    sim.step([{ type: 'repairWall' }]) // 쿨다운 중
    expect(sim.state.events.some((e) => e.type === 'wallActionRejected')).toBe(true)
    expect(sim.state.wallHp).toBe(380)

    sim.state.repairReadyAt = 0
    sim.step([{ type: 'repairWall' }])
    expect(sim.state.wallHp).toBe(500) // 상한 캡

    sim.state.repairReadyAt = 0
    sim.step([{ type: 'repairWall' }]) // 성벽 온전 → 반려 (코스트 낭비 방지)
    expect(
      sim.state.events.some((e) => e.type === 'wallActionRejected' && e.reason === 'wallFull'),
    ).toBe(true)
  })

  it('낙석: 반경 내 적들에게 방어력 무시 피해, 쿨다운제', () => {
    const stage = lineStage({
      spawns: [
        { tick: 30, enemyDefId: 'grunt', pathIndex: 0, wave: 1 },
        { tick: 30, enemyDefId: 'grunt', pathIndex: 0, wave: 1 },
        { tick: 30, enemyDefId: 'runner', pathIndex: 0, wave: 1 },
      ],
    })
    const sim = new Simulation(stage, UNIT_DEFS, ENEMY_DEFS)
    run(sim, 4) // 셋이 뭉쳐 전진 중 (runner가 앞서지만 초반이라 근접)
    const cell = { x: Math.round(6 - sim.state.enemies[0]!.pathPos), y: 1 }
    sim.step([{ type: 'wallSkill', x: cell.x, y: cell.y }])
    const fired = sim.state.events.find((e) => e.type === 'wallSkillFired')
    expect(fired?.type).toBe('wallSkillFired')
    if (fired?.type === 'wallSkillFired') expect(fired.hits).toBeGreaterThanOrEqual(2)
    // grunt 480 - 320 = 160 생존, 낙석은 방어력(20) 무시 확인
    const grunt = sim.state.enemies.find((e) => e.defId === 'grunt')
    expect(grunt?.hp).toBe(160)

    sim.step([{ type: 'wallSkill', x: cell.x, y: cell.y }]) // 쿨다운
    expect(
      sim.state.events.some((e) => e.type === 'wallActionRejected' && e.reason === 'onCooldown'),
    ).toBe(true)
  })

  it('재배치(이동): 저지를 풀고 이동하며, 쿨다운·타일 규칙을 지킨다', () => {
    const stage = lineStage({
      spawns: [{ tick: 1, enemyDefId: 'grunt', pathIndex: 0, wave: 1 }],
    })
    const sim = new Simulation(stage, UNIT_DEFS, ENEMY_DEFS)
    sim.step([{ type: 'deploy', unitDefId: 'blocker', x: 3, y: 1 }])
    const unitId = sim.state.units[0]!.id
    while (
      sim.state.status === 'playing' &&
      sim.state.enemies[0]?.blockedBy == null &&
      sim.state.tick < 3000
    )
      sim.step()

    sim.step([{ type: 'moveUnit', unitId, x: 1, y: 1 }]) // 저지 중 이동 → 저지 해제
    const unit = sim.state.units[0]!
    expect(unit.x).toBe(1)
    expect(unit.blockedEnemyIds).toHaveLength(0)
    expect(sim.state.enemies[0]!.blockedBy).toBeNull()

    sim.step([{ type: 'moveUnit', unitId, x: 2, y: 1 }]) // 쿨다운 중
    expect(
      sim.state.events.some((e) => e.type === 'moveRejected' && e.reason === 'onCooldown'),
    ).toBe(true)
    expect(sim.state.units[0]!.x).toBe(1)

    sim.state.units[0]!.moveReadyAt = 0
    sim.step([{ type: 'moveUnit', unitId, x: 0, y: 1 }]) // 근접 → 성벽 위 불가
    expect(
      sim.state.events.some((e) => e.type === 'moveRejected' && e.reason === 'invalidTile'),
    ).toBe(true)
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
    run(sim, 25) // 공성차가 정지 지점(성벽 직선거리 2.5, x≈2.3)에 도달할 때까지
    expect(sim.state.enemies[0]!.atWall).toBe(true)
    sim.step([{ type: 'deploy', unitDefId: 'bruiser', x: 3, y: 1 }]) // 인접 (근접 사거리 내)
    run(sim, 10)
    expect(sim.state.enemies).toHaveLength(0) // 저지 불가여도 자기 칸 공격으로 처치
    expect(sim.state.status).toBe('won')
  })
})
