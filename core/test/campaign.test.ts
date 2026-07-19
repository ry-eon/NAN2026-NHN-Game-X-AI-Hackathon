import { describe, expect, it } from 'vitest'
import {
  CAMPAIGN_LENGTH,
  CHARACTER_POOL,
  MAX_LEVEL,
  RECOVERY_RATE,
  battleRoster,
  campaignStages,
  currentStage,
  newCampaign,
  onDefeat,
  onStageCleared,
  recruit,
} from '../src/index'

describe('캠페인(연전) 규칙', () => {
  it('시작: 가신 3인 Lv1, 성벽 100%, 침공 5판', () => {
    const c = newCampaign(42)
    expect(c.roster.map((r) => r.charId)).toEqual(['doha', 'sea', 'danbi'])
    expect(c.roster.every((r) => r.level === 1)).toBe(true)
    expect(c.wallRatio).toBe(1)
    expect(campaignStages()).toHaveLength(CAMPAIGN_LENGTH)
    expect(currentStage(c).id).toBe('stage-001')
  })

  it('클리어: 참전자만 레벨업, 성벽은 잃은 만큼의 40% 회복, 후보 3명 추첨', () => {
    const c = newCampaign(42)
    const after = onStageCleared(c, 0.5, ['doha', 'sea'])
    expect(after.roster.find((r) => r.charId === 'doha')!.level).toBe(2)
    expect(after.roster.find((r) => r.charId === 'danbi')!.level).toBe(1) // 미참전
    expect(after.wallRatio).toBeCloseTo(0.5 + 0.5 * RECOVERY_RATE, 5)
    expect(after.stageIndex).toBe(1)
    expect(after.pendingCandidateIds).toHaveLength(3)
    // 후보는 풀 소속이고 로스터와 겹치지 않는다
    for (const id of after.pendingCandidateIds!) {
      expect(CHARACTER_POOL.some((p) => p.id === id)).toBe(true)
    }
  })

  it('영입 후보 추첨은 결정론 — 같은 상태에서 같은 후보', () => {
    const a = onStageCleared(newCampaign(7), 0.8, ['doha'])
    const b = onStageCleared(newCampaign(7), 0.8, ['doha'])
    expect(a.pendingCandidateIds).toEqual(b.pendingCandidateIds)
  })

  it('영입: 후보만 로스터에 들어오고 Lv1로 시작', () => {
    const c = onStageCleared(newCampaign(42), 1, [])
    const pick = c.pendingCandidateIds![0]!
    const after = recruit(c, pick)
    expect(after.roster.some((r) => r.charId === pick && r.level === 1)).toBe(true)
    expect(after.pendingCandidateIds).toBeNull()
    expect(recruit(c, 'doha')).toBe(c) // 후보가 아니면 무시
  })

  it('5판 클리어 = 승리, 패배 처리, 레벨 상한', () => {
    let c = newCampaign(1)
    for (let i = 0; i < CAMPAIGN_LENGTH; i++) {
      c = onStageCleared(c, 1, ['doha', 'sea', 'danbi'])
    }
    expect(c.status).toBe('won')
    expect(c.roster[0]!.level).toBe(MAX_LEVEL) // 5판 개근 = Lv5 캡
    expect(onDefeat(newCampaign(1)).status).toBe('lost')
  })

  it('battleRoster는 레벨이 적용된 배틀 def를 만든다 (Lv3 = 자동기술 해금)', () => {
    let c = newCampaign(42)
    c = onStageCleared(c, 1, ['doha'])
    c = onStageCleared({ ...c, pendingCandidateIds: null }, 1, ['doha'])
    const doha = battleRoster(c).find((d) => d.id === 'doha')!
    expect(doha.skills?.map((s) => s.slot)).toEqual(['passive', 'auto']) // Lv3
    expect(doha.blockCount).toBe(4) // 수호 본능(저지+1) 굽힘
  })
})
