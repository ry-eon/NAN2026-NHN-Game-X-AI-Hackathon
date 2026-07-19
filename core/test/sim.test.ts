import { describe, expect, it } from 'vitest'
import {
  ENEMY_DEFS,
  STAGE_001,
  Simulation,
  TICKS_PER_SECOND,
  UNIT_DEFS,
  rngFloat,
} from '../src/index'
import type { GameState, PlayerAction, TimedAction } from '../src/index'

const MAX_TICKS = 5 * 60 * TICKS_PER_SECOND // 5분 안전 상한

/** 정해진 입력 시퀀스로 끝까지 실행. 봇·리플레이와 같은 {tick, action} 형식. */
function runScript(script: TimedAction[], seed?: number) {
  const sim = new Simulation(STAGE_001, UNIT_DEFS, ENEMY_DEFS, seed)
  const byTick = new Map<number, PlayerAction[]>()
  for (const { tick, action } of script) {
    const list = byTick.get(tick) ?? []
    list.push(action)
    byTick.set(tick, list)
  }
  const snapshots: string[] = []
  while (sim.state.status === 'playing' && sim.state.tick < MAX_TICKS) {
    sim.step(byTick.get(sim.state.tick + 1) ?? [])
    if (sim.state.tick % 50 === 0) snapshots.push(JSON.stringify(sim.state))
  }
  return { sim, snapshots }
}

// 수제 스테이지 001을 클리어하는 기준 스크립트.
// 코스트 타임라인: 초기 15 → 블로커(14) 즉시 → 아처(9)는 재생 후 → 브루저(11) 후반.
const CLEAR_SCRIPT: TimedAction[] = [
  { tick: 1, action: { type: 'deploy', unitDefId: 'blocker', x: 2, y: 3 } },
  { tick: 9 * TICKS_PER_SECOND, action: { type: 'deploy', unitDefId: 'archer', x: 0, y: 3 } },
  { tick: 21 * TICKS_PER_SECOND, action: { type: 'deploy', unitDefId: 'bruiser', x: 3, y: 3 } },
]

describe('승패 판정', () => {
  it('아무것도 배치하지 않으면 성벽이 파괴되어 패배한다', () => {
    const { sim } = runScript([])
    expect(sim.state.status).toBe('lost')
    expect(sim.state.wallHp).toBe(0)
  })

  it('기준 스크립트로 stage-001을 클리어할 수 있다', () => {
    const { sim } = runScript(CLEAR_SCRIPT)
    expect(sim.state.status).toBe('won')
    expect(sim.state.wallHp).toBeGreaterThan(0)
  })
})

describe('결정론', () => {
  it('같은 (스테이지, 시드, 입력)이면 전 구간 상태가 완전히 일치한다', () => {
    const a = runScript(CLEAR_SCRIPT)
    const b = runScript(CLEAR_SCRIPT)
    expect(a.snapshots).toEqual(b.snapshots)
    expect(JSON.stringify(a.sim.state)).toBe(JSON.stringify(b.sim.state))
  })

  it('시드 RNG는 같은 시드에서 같은 수열을 낸다', () => {
    const s1 = { rngState: 42 }
    const s2 = { rngState: 42 }
    const seq1 = Array.from({ length: 10 }, () => rngFloat(s1))
    const seq2 = Array.from({ length: 10 }, () => rngFloat(s2))
    expect(seq1).toEqual(seq2)
    expect(new Set(seq1).size).toBeGreaterThan(1)
  })
})

describe('배치 규칙', () => {
  function freshSim() {
    return new Simulation(STAGE_001, UNIT_DEFS, ENEMY_DEFS)
  }

  function lastReject(state: GameState) {
    return state.events.find((e) => e.type === 'deployRejected')
  }

  it('원거리 유닛은 지상에, 근접 유닛은 성벽 위에 배치할 수 없다', () => {
    const sim = freshSim()
    sim.step([{ type: 'deploy', unitDefId: 'archer', x: 2, y: 2 }])
    expect(lastReject(sim.state)?.reason).toBe('invalidTile')
    sim.step([{ type: 'deploy', unitDefId: 'blocker', x: 0, y: 3 }])
    expect(lastReject(sim.state)?.reason).toBe('invalidTile')
    expect(sim.state.units).toHaveLength(0)
  })

  it('근접 유닛은 진입로(road)에 배치할 수 있다 — 블로킹의 전제', () => {
    const sim = freshSim()
    sim.step([{ type: 'deploy', unitDefId: 'blocker', x: 4, y: 3 }])
    expect(sim.state.units).toHaveLength(1)
    expect(sim.state.cost).toBeCloseTo(15 - 14 + 1 / TICKS_PER_SECOND, 5)
  })

  it('코스트 부족·중복 배치는 반려된다', () => {
    const sim = freshSim()
    sim.step([{ type: 'deploy', unitDefId: 'blocker', x: 2, y: 3 }]) // 코스트 15→1
    sim.step([{ type: 'deploy', unitDefId: 'bruiser', x: 3, y: 3 }])
    expect(lastReject(sim.state)?.reason).toBe('insufficientCost')

    const rich = freshSim()
    rich.step([{ type: 'deploy', unitDefId: 'blocker', x: 2, y: 3 }])
    rich.state.cost = 99
    rich.step([{ type: 'deploy', unitDefId: 'bruiser', x: 2, y: 3 }])
    expect(lastReject(rich.state)?.reason).toBe('occupied')
  })

  it('철수하면 절반이 환급되고 재배치 쿨다운이 걸린다', () => {
    const sim = freshSim()
    sim.step([{ type: 'deploy', unitDefId: 'blocker', x: 2, y: 3 }])
    const unitId = sim.state.units[0]!.id
    const costBefore = sim.state.cost
    sim.step([{ type: 'withdraw', unitId }])
    expect(sim.state.units).toHaveLength(0)
    expect(sim.state.cost).toBeGreaterThan(costBefore + 6) // 환급 floor(14/2)=7
    sim.step([{ type: 'deploy', unitDefId: 'blocker', x: 2, y: 3 }])
    expect(lastReject(sim.state)?.reason).toBe('onCooldown')
  })
})

describe('블로킹', () => {
  // 전투 변수를 제거한 마이크로 스테이지: 외길에 저지 1짜리 더미를 세워
  // "저지 수를 넘는 적은 통과해 성벽을 때린다"만 관찰한다.
  it('저지 수를 넘는 적은 통과해 성벽을 타격한다', () => {
    const stage = {
      id: 'test-block',
      name: '블로킹 검증',
      tilesRows: ['XXXXX', 'RRRRR', 'XXXXX'],
      paths: [
        [
          { x: 4, y: 1 },
          { x: 3, y: 1 },
          { x: 2, y: 1 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
      ],
      wallHp: 500,
      initialCost: 99,
      costRegenPerSec: 0,
      costMax: 99,
      spawns: [1, 2, 3].map((s) => ({
        tick: s * TICKS_PER_SECOND,
        enemyDefId: 'grunt',
        pathIndex: 0,
        wave: 1,
      })),
      seed: 1,
    }
    // 공격을 사실상 하지 않는 저지 1 더미 (저지 상태를 유지시키기 위함)
    const dummy = {
      id: 'dummy',
      name: '더미',
      placement: 'ground' as const,
      cost: 1,
      hp: 99999,
      atk: 1,
      def: 0,
      atkIntervalTicks: 9999 * TICKS_PER_SECOND,
      range: 0,
      blockCount: 1,
      redeployTicks: 1,
    }
    const sim = new Simulation(stage, [dummy], ENEMY_DEFS)
    sim.step([{ type: 'deploy', unitDefId: 'dummy', x: 2, y: 1 }])
    for (let i = 0; i < 12 * TICKS_PER_SECOND; i++) sim.step()

    const blocked = sim.state.enemies.filter((e) => e.blockedBy !== null)
    const atWall = sim.state.enemies.filter((e) => e.atWall)
    expect(blocked).toHaveLength(1) // 첫 번째 적만 저지됨
    expect(atWall).toHaveLength(2) // 나머지는 통과해 성벽 타격
    expect(sim.state.wallHp).toBeLessThan(stage.wallHp)
  })
})
