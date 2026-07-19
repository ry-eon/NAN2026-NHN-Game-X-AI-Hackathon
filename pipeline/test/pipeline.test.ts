import { describe, expect, it } from 'vitest'
import { generateStage } from '../src/generate'
import { CRITERIA_V0, judge, validateStage } from '../src/judge'
import type { BotAggregate } from '../../bots/src/index'

describe('생성기', () => {
  it('같은 시드는 같은 스테이지를 만든다 (결정론)', () => {
    expect(JSON.stringify(generateStage(42))).toBe(JSON.stringify(generateStage(42)))
    expect(generateStage(42).id).not.toBe(generateStage(43).id)
  })

  it('시드 200~239 전부 정적 검증을 통과한다 (구조 보장: 경로 인접·종점 커버)', () => {
    for (let seed = 200; seed < 240; seed++) {
      const result = validateStage(generateStage(seed))
      expect(result.ok, `seed ${seed}: ${result.ok ? '' : result.detail}`).toBe(true)
    }
  })
})

// 판정 로직 단위 테스트용 집계 픽스처
function agg(
  name: string,
  clearRate: number,
  avgWallHpRatio: number,
  unitKinds = ['blocker', 'archer'],
): BotAggregate {
  return {
    name,
    runs: 5,
    clears: Math.round(clearRate * 5),
    clearRate,
    avgWallHpRatio,
    avgClearSeconds: clearRate > 0 ? 60 : null,
    results: [
      {
        status: clearRate === 1 ? 'won' : 'lost',
        ticks: 1800,
        seconds: 60,
        wallHp: 400 * avgWallHpRatio,
        wallHpRatio: avgWallHpRatio,
        deploys: unitKinds.length,
        enemiesKilled: 10,
        wallHits: 0,
        actionLog: unitKinds.map((defId, i) => ({
          tick: i * 100 + 1,
          action: { type: 'deploy' as const, unitDefId: defId, x: 2, y: 3 },
        })),
        finalState: null as never, // judge는 finalState를 보지 않는다
      },
    ],
  }
}

describe('판정 (CRITERIA_V0 [초안])', () => {
  it('Planner 실패 → UNSOLVABLE', () => {
    const v = judge([agg('planner', 0.8, 0.5), agg('greedy', 0.5, 0.3), agg('random', 0, 0)])
    expect(v).toMatchObject({ accepted: false, reason: 'UNSOLVABLE' })
  })

  it('Random 절반 이상 클리어 → TRIVIAL', () => {
    const v = judge([agg('planner', 1, 1), agg('greedy', 1, 0.9), agg('random', 0.6, 0.5)])
    expect(v).toMatchObject({ accepted: false, reason: 'TRIVIAL' })
  })

  it('Planner가 유닛 1종만 사용 → DEGENERATE', () => {
    const v = judge([
      agg('planner', 1, 0.9, ['archer']),
      agg('greedy', 1, 0.8),
      agg('random', 0.2, 0.1),
    ])
    expect(v).toMatchObject({ accepted: false, reason: 'DEGENERATE' })
  })

  it('티어: Greedy 실패면 HARD, 성벽 여유면 EASY, 그 사이 NORMAL', () => {
    const base = (g: BotAggregate) => [agg('planner', 1, 1), g, agg('random', 0.2, 0.1)]
    expect(judge(base(agg('greedy', 0.8, 0.2)))).toMatchObject({ accepted: true, tier: 'HARD' })
    expect(judge(base(agg('greedy', 1, 0.85)))).toMatchObject({ accepted: true, tier: 'EASY' })
    expect(judge(base(agg('greedy', 1, 0.5)))).toMatchObject({ accepted: true, tier: 'NORMAL' })
  })

  it('목표 티어 불일치 → OFF_CURVE', () => {
    const v = judge(
      [agg('planner', 1, 1), agg('greedy', 1, 0.85), agg('random', 0.2, 0.1)],
      CRITERIA_V0,
      'HARD',
    )
    expect(v).toMatchObject({ accepted: false, reason: 'OFF_CURVE' })
  })
})
