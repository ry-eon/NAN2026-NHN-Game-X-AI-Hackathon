// 캠페인(연전) 규칙 — 순수 로직 (docs/02 성벽 지속 [확정], docs/07 v2 [확정]).
// 저장·UI는 client 몫. 여기 있는 이유: 캠페인도 게임 룰이며,
// 봇이 캠페인 전체를 시뮬해 회복률 등을 튜닝할 수 있어야 한다.
// 모든 무작위(영입 후보 추첨)는 시드 RNG 경유 — 같은 시드 = 같은 캠페인.

import { rngInt } from './rng'
import { CHARACTERS } from './content/characters'
import { CHARACTER_POOL } from './content/characters-generated'
import { STAGES } from './content/stages/registry'
import { MAX_LEVEL, applyLevel } from './leveling'
import type { CharacterDef, StageDef } from './types'

/** 연전 길이 (심사자 30초 이해 요건 — 짧게) [초안] */
export const CAMPAIGN_LENGTH = 5
/**
 * 전투 사이 회복: 잃은 성벽의 이 비율을 되찾는다.
 * [확정 근거 2026-07-23] 봇 캠페인 스윕(0~100%, reports/*campaign-recovery-sweep.md):
 * 전 구간 데스 스파이럴 없음 — 판 내 수리 경제가 생존을 담당하므로 이 값은
 * 생존 임계가 아니라 "이월의 체감 강도" 파라미터다. 40% = 이월이 느껴지되
 * (100% 리셋 아님) 벌점이 과하지 않은 중간값으로 유지.
 */
export const RECOVERY_RATE = 0.4
/** 시작 가신 (D1 확정) */
export const STARTING_IDS = ['doha', 'sea', 'danbi']
/** 침공 순서: 쉬움 → 변별 → 어려움 램프 [초안]. 없는 id는 건너뛰고 STAGES에서 보충 */
const CAMPAIGN_STAGE_IDS = ['stage-001', 'gen-0100', 'stage-002', 'gen-0904', 'gen-0902']
/** 클리어 시 제시되는 영입 후보 수 (A3 확정: 3택1) */
export const RECRUIT_CHOICES = 3

export interface RosterEntry {
  charId: string
  level: number
}

export interface CampaignState {
  seed: number
  rngState: number
  /** 다음 전투 인덱스 (0부터) */
  stageIndex: number
  /** 이월 성벽 비율 (스테이지별 최대치가 달라 비율로 이월) */
  wallRatio: number
  roster: RosterEntry[]
  /** 클리어 후 영입 대기 중인 후보 id 3개 (선택 전 재로드에도 동일 유지) */
  pendingCandidateIds: string[] | null
  status: 'active' | 'won' | 'lost'
}

const ALL_CHARACTERS: CharacterDef[] = [...CHARACTERS, ...CHARACTER_POOL]

export function characterById(id: string): CharacterDef {
  const c = ALL_CHARACTERS.find((ch) => ch.id === id)
  if (!c) throw new Error(`캐릭터 없음: ${id}`)
  return c
}

export function campaignStages(): StageDef[] {
  const byId = new Map(STAGES.map((s) => [s.id, s]))
  const picked = CAMPAIGN_STAGE_IDS.map((id) => byId.get(id)).filter(
    (s): s is StageDef => s !== undefined,
  )
  // 램프 id가 빠져 있으면(재출고 등) 수록 순서대로 보충
  for (const s of STAGES) {
    if (picked.length >= CAMPAIGN_LENGTH) break
    if (!picked.includes(s)) picked.push(s)
  }
  return picked.slice(0, CAMPAIGN_LENGTH)
}

export function newCampaign(seed: number): CampaignState {
  return {
    seed,
    rngState: seed | 0,
    stageIndex: 0,
    wallRatio: 1,
    roster: STARTING_IDS.map((charId) => ({ charId, level: 1 })),
    pendingCandidateIds: null,
    status: 'active',
  }
}

export function currentStage(state: CampaignState): StageDef {
  return campaignStages()[Math.min(state.stageIndex, CAMPAIGN_LENGTH - 1)]!
}

/** 이번 전투에 투입되는 배틀 def 목록 (레벨 적용됨) */
export function battleRoster(state: CampaignState): CharacterDef[] {
  return state.roster.map((r) => applyLevel(characterById(r.charId), r.level))
}

/**
 * 클리어 처리: 참전(배치했던) 가신 레벨 +1, 성벽 부분 회복, 영입 후보 추첨.
 * state를 변경하지 않고 새 상태를 반환한다.
 */
export function onStageCleared(
  state: CampaignState,
  endWallRatio: number,
  deployedCharIds: string[],
  recoveryRate: number = RECOVERY_RATE, // 봇 캠페인 시뮬의 회복률 스윕용 오버라이드
): CampaignState {
  const next: CampaignState = {
    ...state,
    roster: state.roster.map((r) =>
      deployedCharIds.includes(r.charId)
        ? { ...r, level: Math.min(MAX_LEVEL, r.level + 1) }
        : r,
    ),
    wallRatio: Math.min(1, endWallRatio + (1 - endWallRatio) * recoveryRate),
    stageIndex: state.stageIndex + 1,
    pendingCandidateIds: null,
  }
  if (next.stageIndex >= CAMPAIGN_LENGTH) {
    next.status = 'won'
    return next
  }
  // 영입 후보 추첨 (시드 RNG — 재로드에도 동일)
  const rng = { rngState: next.rngState }
  const taken = new Set(next.roster.map((r) => r.charId))
  const pool = CHARACTER_POOL.filter((c) => !taken.has(c.id))
  const picks: string[] = []
  while (picks.length < Math.min(RECRUIT_CHOICES, pool.length)) {
    const cand = pool[rngInt(rng, pool.length)]!
    if (!picks.includes(cand.id)) picks.push(cand.id)
  }
  next.rngState = rng.rngState
  next.pendingCandidateIds = picks.length > 0 ? picks : null
  return next
}

/** 영입: 후보 중 1명을 로스터(Lv1)에 추가. 후보가 아니면 무시하고 그대로 반환 */
export function recruit(state: CampaignState, charId: string): CampaignState {
  if (!state.pendingCandidateIds?.includes(charId)) return state
  return {
    ...state,
    roster: [...state.roster, { charId, level: 1 }],
    pendingCandidateIds: null,
  }
}

/** 영입을 건너뛴다 (후보가 마음에 안 들 때) */
export function skipRecruit(state: CampaignState): CampaignState {
  return { ...state, pendingCandidateIds: null }
}

export function onDefeat(state: CampaignState): CampaignState {
  return { ...state, status: 'lost' }
}
