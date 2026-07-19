import { describe, expect, it } from 'vitest'
import { CHARACTERS, ENEMY_DEFS, STAGE_001 } from '@core'
import {
  createGreedyPolicy,
  createPlannerPolicy,
  createRandomPolicy,
  evaluateBots,
  runHeadless,
} from '../src/index'

describe('Planner 봇', () => {
  it('stage-001을 클리어한다', () => {
    const r = runHeadless(STAGE_001, CHARACTERS, ENEMY_DEFS, createPlannerPolicy())
    expect(r.status).toBe('won')
  })

  it('실행이 결정론적이다 (내부 RNG 없음)', () => {
    const a = runHeadless(STAGE_001, CHARACTERS, ENEMY_DEFS, createPlannerPolicy())
    const b = runHeadless(STAGE_001, CHARACTERS, ENEMY_DEFS, createPlannerPolicy())
    expect(a.actionLog).toEqual(b.actionLog)
  })
})

describe('Random 봇', () => {
  it('같은 시드면 같은 플레이, 다른 시드면 (일반적으로) 다른 플레이', () => {
    const a = runHeadless(STAGE_001, CHARACTERS, ENEMY_DEFS, createRandomPolicy(7))
    const b = runHeadless(STAGE_001, CHARACTERS, ENEMY_DEFS, createRandomPolicy(7))
    const c = runHeadless(STAGE_001, CHARACTERS, ENEMY_DEFS, createRandomPolicy(8))
    expect(a.actionLog).toEqual(b.actionLog)
    expect(JSON.stringify(a.actionLog)).not.toBe(JSON.stringify(c.actionLog))
  })

  it('항상 종료된다 (승패 무관, maxTicks 안전 상한 내)', () => {
    for (const seed of [1, 2, 3]) {
      const r = runHeadless(STAGE_001, CHARACTERS, ENEMY_DEFS, createRandomPolicy(seed))
      expect(['won', 'lost']).toContain(r.status)
    }
  })
})

describe('봇 스위트 평가기', () => {
  it('등급별 지표를 집계한다 — 파이프라인 지표 산출의 기반', () => {
    const aggregates = evaluateBots(
      STAGE_001,
      CHARACTERS,
      ENEMY_DEFS,
      [
        { name: 'planner', create: () => createPlannerPolicy() },
        { name: 'greedy', create: () => createGreedyPolicy() },
        { name: 'random', create: (i) => createRandomPolicy(1000 + i) },
      ],
      3,
    )
    expect(aggregates).toHaveLength(3)
    for (const agg of aggregates) {
      expect(agg.runs).toBe(3)
      expect(agg.clearRate).toBeGreaterThanOrEqual(0)
      expect(agg.clearRate).toBeLessThanOrEqual(1)
      expect(agg.results).toHaveLength(3)
    }
    // 상위 봇(Planner·Greedy)은 결정론적이므로 stage-001을 항상 깬다
    expect(aggregates[0]!.clearRate).toBe(1)
    expect(aggregates[1]!.clearRate).toBe(1)
  })
})
