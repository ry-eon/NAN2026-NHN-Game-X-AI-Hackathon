// 봇 캠페인 시뮬레이터 — 연전 전체(성벽 이월·부분 회복·레벨업·영입)를 헤드리스로.
// 목적: 회복률 스윕으로 데스 스파이럴 경계를 실측해 RECOVERY_RATE [초안]을 확정한다.
// 영입 정책: 항상 첫 후보 영입 (결정론 — 영입 전략의 좋고 나쁨은 측정 대상이 아니다).

import { ENEMY_DEFS, battleRoster, currentStage, newCampaign, onStageCleared, recruit } from '@core'
import type { CampaignState } from '@core'
import { runHeadless } from './runner'
import type { BotPolicy } from './runner'

export interface CampaignSimResult {
  status: 'won' | 'lost'
  stagesCleared: number
  /** 각 전투의 시작 성벽 비율 (이월+회복 반영) */
  startRatios: number[]
  /** 각 전투 종료 시점의 성벽 비율 */
  endRatios: number[]
}

export function simulateCampaign(
  createPolicy: () => BotPolicy,
  seed: number,
  recoveryRate: number,
): CampaignSimResult {
  let campaign: CampaignState = newCampaign(seed)
  const startRatios: number[] = []
  const endRatios: number[] = []

  while (campaign.status === 'active') {
    const stage = currentStage(campaign)
    startRatios.push(campaign.wallRatio)
    const roster = battleRoster(campaign)
    const result = runHeadless(stage, roster, ENEMY_DEFS, createPolicy(), {
      startWallHp: Math.round(campaign.wallRatio * stage.wallHp),
    })
    endRatios.push(result.wallHpRatio)
    if (result.status !== 'won') {
      return { status: 'lost', stagesCleared: startRatios.length - 1, startRatios, endRatios }
    }
    const deployed = [
      ...new Set(
        result.actionLog
          .filter((a) => a.action.type === 'deploy')
          .map((a) => (a.action.type === 'deploy' ? a.action.unitDefId : '')),
      ),
    ]
    campaign = onStageCleared(campaign, result.wallHpRatio, deployed, recoveryRate)
    if (campaign.pendingCandidateIds?.length) {
      campaign = recruit(campaign, campaign.pendingCandidateIds[0]!)
    }
  }
  return {
    status: campaign.status === 'won' ? 'won' : 'lost',
    stagesCleared: startRatios.length,
    startRatios,
    endRatios,
  }
}
