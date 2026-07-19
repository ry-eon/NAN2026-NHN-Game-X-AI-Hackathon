// 봇 스위트 평가기: 스테이지 하나를 봇 등급별로 N회 시뮬해 지표를 집계한다.
// W2 파이프라인의 "봇 시뮬 N회 → 지표 산출" 단계가 이 모듈을 그대로 쓴다.
// 등급 간 성과 격차가 곧 난이도 신호다 — 예: Planner는 깨는데 Greedy가 못 깨면 상급,
// Random까지 깨면 하급 (판정 임계값은 [미결] — 사용자와 논의 후 확정).

import type { EnemyDef, StageDef, UnitDef } from '@core'
import { runHeadless } from './runner'
import type { BotPolicy, BotRunResult, RunOptions } from './runner'

export interface BotSpec {
  name: string
  /** 실행마다 새 정책 인스턴스 생성 (내부 상태·시드 격리). runIndex로 시드 변주 */
  create: (runIndex: number) => BotPolicy
  /**
   * 이 봇의 시뮬 횟수 (기본값 대신). 결정론 봇(Planner/Greedy)은 같은 스테이지에서
   * 항상 같은 플레이를 하므로 1이면 충분 — N회는 순수 낭비다.
   */
  runs?: number
}

export interface BotAggregate {
  name: string
  runs: number
  clears: number
  clearRate: number
  /** 잔여 성벽 HP 비율 평균 (패배 = 해당 런의 잔여율 그대로, 보통 0) */
  avgWallHpRatio: number
  /** 클리어한 런들의 평균 소요 시간(초). 클리어 0회면 null */
  avgClearSeconds: number | null
  results: BotRunResult[]
}

export function evaluateBots(
  stage: StageDef,
  unitDefs: UnitDef[],
  enemyDefs: EnemyDef[],
  bots: BotSpec[],
  runsPerBot = 5,
  opts: RunOptions = {},
): BotAggregate[] {
  return bots.map((bot) => {
    const runs = bot.runs ?? runsPerBot
    const results: BotRunResult[] = []
    for (let i = 0; i < runs; i++) {
      results.push(runHeadless(stage, unitDefs, enemyDefs, bot.create(i), opts))
    }
    const clears = results.filter((r) => r.status === 'won').length
    const clearSeconds = results.filter((r) => r.status === 'won').map((r) => r.seconds)
    return {
      name: bot.name,
      runs,
      clears,
      clearRate: clears / runs,
      avgWallHpRatio: results.reduce((s, r) => s + r.wallHpRatio, 0) / runs,
      avgClearSeconds:
        clearSeconds.length > 0
          ? clearSeconds.reduce((s, v) => s + v, 0) / clearSeconds.length
          : null,
      results,
    }
  })
}
