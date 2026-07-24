import { describe, expect, it } from 'vitest'
import { CHARACTERS, ENEMY_DEFS, STAGE_002 } from '@core'
import {
  createGreedyPolicy,
  createPlannerPolicy,
  createRandomPolicy,
  evaluateBots,
} from '../src/index'

// stage-002의 존재 이유: 봇 등급 간 성과 격차 = 난이도 신호 (docs/logs/2026-07-20.md).
// 모든 봇이 결정론적(Random은 시드 고정)이므로 이 어서션은 플레이크 없이 재현된다.
describe('stage-002 등급 변별력', () => {
  it('Planner > Greedy > Random 순서로 성과가 갈린다', () => {
    const [planner, greedy, random] = evaluateBots(
      STAGE_002,
      CHARACTERS,
      ENEMY_DEFS,
      [
        { name: 'planner', create: () => createPlannerPolicy() },
        { name: 'greedy', create: () => createGreedyPolicy() },
        { name: 'random', create: (i) => createRandomPolicy(1000 + i) },
      ],
      5,
    )

    // v3 기준: 상위 두 등급은 클리어, Random은 절반 미만 — 상급 변별은 HARD 티어가 담당
    expect(planner!.clearRate).toBe(1)
    expect(greedy!.clearRate).toBe(1)
    expect(random!.clearRate).toBeLessThan(0.5)
    expect(planner!.avgWallHpRatio).toBeGreaterThanOrEqual(greedy!.avgWallHpRatio)
    expect(greedy!.avgWallHpRatio).toBeGreaterThan(random!.avgWallHpRatio)
  })
})
