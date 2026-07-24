// 소프트 파이프라인 [3] 밸런스 판정 — 교체 투입 시뮬 (docs/07 확정 설계).
// 기준 로스터(시작 가신 3인, Lv5)의 같은 배치군(근접/원거리) 자리를 후보로 교체해
// 기준 스테이지 셋을 봇으로 돌리고, 기준선 대비 변화로 판정한다.
// 임계값은 전부 [초안].

import { CHARACTERS, ENEMY_DEFS, GENERATED_STAGES, STAGE_001, STAGE_002, applyLevel } from '@core'
import type { CharacterDef, StageDef, UnitDef } from '@core'
import { createGreedyPolicy, createPlannerPolicy, runHeadless } from '../../bots/src/index'

export const CHAR_CRITERIA_V0 = {
  /** 판정 레벨: 풀 파워(Lv5) 기준 — OP는 만렙에서 판정해야 의미가 있다 */
  judgeLevel: 5,
  /** OP: 기준선 대비 Greedy 평균 성벽 잔여율 상승이 이 이상 */
  opWallDelta: 0.2,
  /**
   * 기준 스테이지 셋: EASY/분리 검증/HARD.
   * HARD가 있어야 기준선에 천장이 생겨 OP(상승 폭) 판정이 작동한다 —
   * 기준선이 전부 만점이면 "게임을 하찮게 만드는" 후보를 못 거른다.
   * HARD는 출고 티어 기록에서 동적으로 선택 (재출고에 강건).
   */
  stages: [
    STAGE_001,
    STAGE_002,
    ...(GENERATED_STAGES.find((s) => s.tier === 'HARD')
      ? [GENERATED_STAGES.find((s) => s.tier === 'HARD')!]
      : GENERATED_STAGES.slice(-1)),
  ] as StageDef[],
}

export type CharRejectReason = 'USELESS' | 'OP' | 'NO_IDENTITY'

export type CharVerdict =
  | { accepted: true; detail: string }
  | { accepted: false; reason: CharRejectReason; detail: string }

interface StageScore {
  plannerCleared: boolean
  greedyWall: number
}

/** 시작 가신 3인 (D1 확정: 도하/세아/단비) */
export function baselineRoster(): CharacterDef[] {
  const ids = ['doha', 'sea', 'danbi']
  return ids.map((id) => CHARACTERS.find((c) => c.id === id)!)
}

function scoreRoster(roster: UnitDef[], stage: StageDef): StageScore {
  const planner = runHeadless(stage, roster, ENEMY_DEFS, createPlannerPolicy())
  const greedy = runHeadless(stage, roster, ENEMY_DEFS, createGreedyPolicy())
  return { plannerCleared: planner.status === 'won', greedyWall: greedy.wallHpRatio }
}

/** 기준 로스터(Lv5)의 스테이지별 기준선 — 실행당 1회만 계산 */
export function computeBaseline(): StageScore[] {
  const roster = baselineRoster().map((c) => applyLevel(c, CHAR_CRITERIA_V0.judgeLevel))
  return CHAR_CRITERIA_V0.stages.map((stage) => scoreRoster(roster, stage))
}

/** 후보의 기술 조합 서명 — 중복(NO_IDENTITY) 판정용 */
export function comboKey(c: CharacterDef): string {
  const s = c.skillSet!
  return `${c.role}:${s.passive.id}:${s.auto.id}:${s.active.id}`
}

export function judgeCharacter(
  candidate: CharacterDef,
  baseline: StageScore[],
  seenCombos: Set<string>,
): CharVerdict {
  // NO_IDENTITY: 같은 역할 + 같은 기술 조합이 이미 존재
  const key = comboKey(candidate)
  if (seenCombos.has(key)) {
    return { accepted: false, reason: 'NO_IDENTITY', detail: `중복 조합 ${key}` }
  }

  // 교체 투입: 후보와 같은 배치군(근접/성벽 위) 자리를 후보로 교체
  const base = baselineRoster()
  const roster = base
    .map((c) => (c.placement === candidate.placement ? candidate : c))
    .map((c) => applyLevel(c, CHAR_CRITERIA_V0.judgeLevel))

  const deltas: number[] = []
  for (const [i, stage] of CHAR_CRITERIA_V0.stages.entries()) {
    const score = scoreRoster(roster, stage)
    const ref = baseline[i]!
    // USELESS: 기준선이 깨던 스테이지를 후보 투입 시 최상위 봇이 못 깬다
    if (ref.plannerCleared && !score.plannerCleared) {
      return {
        accepted: false,
        reason: 'USELESS',
        detail: `${stage.id}: 교체 투입 시 Planner 클리어 실패`,
      }
    }
    deltas.push(score.greedyWall - ref.greedyWall)
  }

  // OP: 전 스테이지 평균 성벽 잔여율 상승이 임계 초과 — 게임을 하찮게 만든다
  const avgDelta = deltas.reduce((s, v) => s + v, 0) / deltas.length
  if (avgDelta > CHAR_CRITERIA_V0.opWallDelta) {
    return {
      accepted: false,
      reason: 'OP',
      detail: `Greedy 성벽 잔여율 +${(avgDelta * 100).toFixed(0)}%p (> ${CHAR_CRITERIA_V0.opWallDelta * 100}%p)`,
    }
  }
  return {
    accepted: true,
    detail: `Δ성벽 ${deltas.map((d) => (d >= 0 ? '+' : '') + (d * 100).toFixed(0) + '%p').join(', ')}`,
  }
}
