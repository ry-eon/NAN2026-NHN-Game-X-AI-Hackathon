// Random 봇: 하한 측정용 (docs/03-architecture.md의 3등급 중 최하위).
// 1초마다 동전 던지기 → 무작위 유닛을 무작위 유효 타일에 배치 시도.
// "Random도 깨는 스테이지 = 너무 쉬움" 신호를 만들기 위해 존재한다.
// 모든 무작위성은 core의 시드 RNG 경유 — 같은 시드면 같은 플레이.

import { TICKS_PER_SECOND, enemyWorldPos, rngFloat, rngInt } from '@core'
import type { CellPos, PlayerAction, RngState, SimContext, UnitDef } from '@core'
import type { BotPolicy } from './runner'

export function createRandomPolicy(seed: number): BotPolicy {
  const rng: RngState = { rngState: seed | 0 }

  return (ctx, state) => {
    if (state.status !== 'playing') return []
    if (state.tick % TICKS_PER_SECOND !== 0) return []
    const actions: PlayerAction[] = []

    // 성벽 액션도 무작위로 (25% 낙석 아무 적에게, 15% 수리)
    if (
      state.wallSkillReadyAt <= state.tick &&
      state.enemies.length > 0 &&
      rngFloat(rng) < 0.25
    ) {
      const e = state.enemies[rngInt(rng, state.enemies.length)]!
      const pos = enemyWorldPos(ctx, e)
      actions.push({ type: 'wallSkill', x: Math.round(pos.x), y: Math.round(pos.y) })
    }
    if (
      state.repairReadyAt <= state.tick &&
      state.wallHp < ctx.stage.wallHp &&
      state.cost >= ctx.wallActions.repair.cost &&
      rngFloat(rng) < 0.15
    ) {
      actions.push({ type: 'repairWall' })
    }

    if (rngFloat(rng) < 0.5) return actions

    const defs = Object.values(ctx.unitDefs).sort((a, b) => a.id.localeCompare(b.id))
    const affordable = defs.filter(
      (d) => state.cost >= d.cost && (state.redeployReadyAt[d.id] ?? 0) <= state.tick,
    )
    if (affordable.length === 0) return actions
    const def = affordable[rngInt(rng, affordable.length)]!

    const cells = placeableCells(ctx, def).filter(
      (c) => !state.units.some((u) => u.x === c.x && u.y === c.y),
    )
    if (cells.length === 0) return actions
    const cell = cells[rngInt(rng, cells.length)]!
    actions.push({ type: 'deploy', unitDefId: def.id, x: cell.x, y: cell.y })
    return actions
  }
}

function placeableCells(ctx: SimContext, def: UnitDef): CellPos[] {
  const cells: CellPos[] = []
  for (let y = 0; y < ctx.height; y++) {
    for (let x = 0; x < ctx.width; x++) {
      const t = ctx.tiles[y]?.[x]
      const ok = def.placement === 'wallTop' ? t === 'wallTop' : t === 'ground' || t === 'road'
      if (ok) cells.push({ x, y })
    }
  }
  return cells
}
