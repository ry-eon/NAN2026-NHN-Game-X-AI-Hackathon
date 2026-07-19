// [2] 정적 검증 + [5] 판정.
// 판정 임계값은 전부 [초안] — 실측 리포트가 쌓이면 사용자와 논의해 확정한다
// (docs/05-pipeline.md "판정 기준 v0 제안" 참조).

import { ENEMY_DEFS, UNIT_DEFS, createContext } from '@core'
import type { StageDef } from '@core'
import type { BotAggregate } from '../../bots/src/index'

export type RejectReason =
  | 'SCHEMA_INVALID' // 스키마·경로·커버리지 정적 결함
  | 'UNSOLVABLE' // 최상위 봇(Planner)도 클리어 실패
  | 'TRIVIAL' // 하한 봇(Random)이 절반 이상 클리어
  | 'DEGENERATE' // 단일 유닛 유형만으로 클리어 (전략 다양성 없음)
  | 'OFF_CURVE' // 요청한 난이도 티어와 불일치

export type Tier = 'EASY' | 'NORMAL' | 'HARD'

export type Verdict =
  | { accepted: true; tier: Tier }
  | { accepted: false; reason: RejectReason; detail: string }

/** 판정 기준 v0 [초안 — 사용자 논의 후 확정] */
export const CRITERIA_V0 = {
  runsPerBot: 5,
  /** Random 클리어율이 이 이상이면 TRIVIAL */
  trivialRandomClearRate: 0.5,
  /** EASY/NORMAL 경계: Greedy 평균 성벽 잔여율 */
  easyGreedyWallRatio: 0.7,
  /** DEGENERATE 판정: Planner가 사용한 유닛 종류 최소 수 */
  minUnitDiversity: 2,
}

/** 정적 검증: 시뮬 없이 걸러낼 수 있는 결함 */
export function validateStage(stage: StageDef): { ok: true } | { ok: false; detail: string } {
  try {
    const ctx = createContext(stage, UNIT_DEFS, ENEMY_DEFS)
    if (stage.spawns.length < 5) return { ok: false, detail: `스폰 ${stage.spawns.length}개 (<5)` }
    for (const [pi, path] of stage.paths.entries()) {
      if (path.length < 7) return { ok: false, detail: `경로 ${pi} 길이 ${path.length} (<7)` }
      // 각 경로 종점이 최소 한 개의 성벽 위 칸 사거리(최대 원거리 기준)에 들어야
      // 성벽 캠핑 적을 처치할 수단이 존재한다
      const end = path[path.length - 1]!
      const maxRange = Math.max(...UNIT_DEFS.filter((d) => d.range > 0).map((d) => d.range))
      let covered = false
      for (let y = 0; y < ctx.height && !covered; y++) {
        for (let x = 0; x < ctx.width && !covered; x++) {
          if (ctx.tiles[y]?.[x] !== 'wallTop') continue
          if (Math.hypot(end.x - x, end.y - y) <= maxRange) covered = true
        }
      }
      if (!covered) return { ok: false, detail: `경로 ${pi} 종점이 원거리 사거리 밖` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

/** 봇 지표 → 출고/반려 판정. aggregates는 [planner, greedy, random] 순서 가정. */
export function judge(
  aggregates: BotAggregate[],
  criteria = CRITERIA_V0,
  targetTier?: Tier,
): Verdict {
  const [planner, greedy, random] = aggregates
  if (!planner || !greedy || !random) throw new Error('planner/greedy/random 집계 필요')

  if (planner.clearRate < 1) {
    return {
      accepted: false,
      reason: 'UNSOLVABLE',
      detail: `Planner 클리어율 ${planner.clearRate.toFixed(2)} < 1`,
    }
  }
  if (random.clearRate >= criteria.trivialRandomClearRate) {
    return {
      accepted: false,
      reason: 'TRIVIAL',
      detail: `Random 클리어율 ${random.clearRate.toFixed(2)} ≥ ${criteria.trivialRandomClearRate}`,
    }
  }

  // 전략 다양성: Planner의 승리 플레이가 몇 종류의 유닛을 썼는가
  const usedDefs = new Set(
    planner.results
      .flatMap((r) => r.actionLog)
      .filter((a) => a.action.type === 'deploy')
      .map((a) => (a.action.type === 'deploy' ? a.action.unitDefId : '')),
  )
  if (usedDefs.size < criteria.minUnitDiversity) {
    return {
      accepted: false,
      reason: 'DEGENERATE',
      detail: `Planner가 유닛 ${usedDefs.size}종만 사용 (< ${criteria.minUnitDiversity})`,
    }
  }

  const tier: Tier =
    greedy.clearRate < 1
      ? 'HARD'
      : greedy.avgWallHpRatio >= criteria.easyGreedyWallRatio
        ? 'EASY'
        : 'NORMAL'

  if (targetTier && tier !== targetTier) {
    return {
      accepted: false,
      reason: 'OFF_CURVE',
      detail: `판정 티어 ${tier} ≠ 목표 ${targetTier}`,
    }
  }
  return { accepted: true, tier }
}
