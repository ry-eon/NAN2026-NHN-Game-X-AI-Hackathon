import { describe, expect, it } from 'vitest'
import { RECOVERY_RATE } from '@core'
import { createGreedyPolicy, createPlannerPolicy, simulateCampaign } from '../src/index'

// 캠페인 플레이 가능성 게이트: 상위 봇이 확정 회복률로 5연전을 완주해야 한다.
// 스테이지 재출고·밸런스 변경·캠페인 램프 수정이 연전을 깨뜨리면 여기서 잡힌다.
describe('캠페인 완주 게이트', () => {
  it('Planner가 현행 회복률로 5연전을 완주한다', () => {
    const r = simulateCampaign(() => createPlannerPolicy(), 20260722, RECOVERY_RATE)
    expect(r.status).toBe('won')
    expect(r.stagesCleared).toBe(5)
  })

  it('Greedy도 완주한다 (중수 하한 보장)', () => {
    const r = simulateCampaign(() => createGreedyPolicy(), 20260722, RECOVERY_RATE)
    expect(r.status).toBe('won')
  })

  it('캠페인 시뮬은 결정론이다', () => {
    const a = simulateCampaign(() => createPlannerPolicy(), 7, 0.4)
    const b = simulateCampaign(() => createPlannerPolicy(), 7, 0.4)
    expect(a).toEqual(b)
  })
})
