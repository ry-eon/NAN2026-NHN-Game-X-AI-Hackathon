// 캠페인 저장 — localStorage (client 전용. core는 저장을 모른다)

import type { CampaignState } from '@core'

const KEY = 'nan2026-campaign-v1'

export function loadCampaign(): CampaignState | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const state = JSON.parse(raw) as CampaignState
    // 최소한의 무결성 확인 — 깨진 저장은 버린다
    if (!Array.isArray(state.roster) || typeof state.stageIndex !== 'number') return null
    return state
  } catch {
    return null
  }
}

export function saveCampaign(state: CampaignState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // 저장 실패(시크릿 모드 등)는 치명적이지 않다 — 진행만 안 남을 뿐
  }
}

export function clearCampaign(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* noop */
  }
}
