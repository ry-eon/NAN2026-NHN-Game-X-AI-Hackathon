import { describe, expect, it } from 'vitest'
import { CHARACTERS, ENEMY_DEFS, STAGE_001 } from '@core'
import { createGreedyPolicy, runHeadless, runReplay } from '../src/index'

describe('Greedy 봇', () => {
  it('stage-001을 헤드리스로 클리어한다 — W1 완료 기준의 봇 절반', () => {
    const result = runHeadless(STAGE_001, CHARACTERS, ENEMY_DEFS, createGreedyPolicy())
    expect(result.status).toBe('won')
    expect(result.deploys).toBeGreaterThan(0)
    expect(result.enemiesKilled).toBe(STAGE_001.spawns.length)
  })

  it('봇의 액션 로그를 리플레이하면 동일한 최종 상태가 재현된다', () => {
    // "봇이 검증한 플레이 = 재생 가능한 리플레이" — 파이프라인 리포트의 재현성 근거
    const play = runHeadless(STAGE_001, CHARACTERS, ENEMY_DEFS, createGreedyPolicy())
    const replay = runReplay(STAGE_001, CHARACTERS, ENEMY_DEFS, play.actionLog)
    expect(replay.status).toBe(play.status)
    expect(JSON.stringify(replay.finalState)).toBe(JSON.stringify(play.finalState))
  })

  it('같은 스테이지·시드에서 봇 실행은 결정론적이다', () => {
    const a = runHeadless(STAGE_001, CHARACTERS, ENEMY_DEFS, createGreedyPolicy())
    const b = runHeadless(STAGE_001, CHARACTERS, ENEMY_DEFS, createGreedyPolicy())
    expect(JSON.stringify(a.finalState)).toBe(JSON.stringify(b.finalState))
    expect(a.actionLog).toEqual(b.actionLog)
  })
})
