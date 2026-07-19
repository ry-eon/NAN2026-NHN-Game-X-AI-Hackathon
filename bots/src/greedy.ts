// Greedy 봇: 단순 휴리스틱 하한선 (docs/03-architecture.md의 3등급 중 최하 지능).
// 규칙: 코스트가 모이는 대로 즉시 배치. 계획·예측·철수 없음.
//   - 근접/원거리를 번갈아 채운다 (현재 생존 수가 적은 쪽 우선)
//   - 근접: 경로 끝(성벽 앞)에 가까운 진입로 셀부터
//   - 원거리: 사거리로 경로 셀을 가장 많이 커버하는 성벽 위 셀부터
// 스테이지 구조를 하드코딩하지 않는다 — 파이프라인이 생성한 임의 StageDef에서 동작해야 함.

import { enemyWorldPos } from '@core'
import type { CellPos, GameState, PlayerAction, SimContext, UnitDef } from '@core'
import type { BotPolicy } from './runner'

export function createGreedyPolicy(): BotPolicy {
  return (ctx, state) => {
    if (state.status !== 'playing') return []
    const actions: PlayerAction[] = []
    const deploy = pickDeploy(ctx, state)
    if (deploy) actions.push(deploy)

    // 낙석: 준비되면 성벽에 가장 가까운 적에게 즉시 사용 (Greedy는 아끼지 않는다)
    if (state.wallSkillReadyAt <= state.tick && state.enemies.length > 0) {
      let target = state.enemies[0]!
      let best = Infinity
      for (const e of state.enemies) {
        const remaining = ctx.stage.paths[e.pathIndex]!.length - 1 - e.pathPos
        if (remaining < best) {
          best = remaining
          target = e
        }
      }
      const p = enemyWorldPos(ctx, target)
      actions.push({ type: 'wallSkill', x: Math.round(p.x), y: Math.round(p.y) })
    }

    // 수리: 성벽 절반 이하일 때만 (Greedy 수준의 생존 본능). 배치와 코스트 경합 회피
    const spent = deploy && deploy.type === 'deploy' ? ctx.unitDefs[deploy.unitDefId]!.cost : 0
    if (
      state.repairReadyAt <= state.tick &&
      state.wallHp < ctx.stage.wallHp * 0.5 &&
      state.cost - spent >= ctx.wallActions.repair.cost
    ) {
      actions.push({ type: 'repairWall' })
    }
    return actions
  }
}

function pickDeploy(ctx: SimContext, state: GameState): PlayerAction | null {
  const defs = Object.values(ctx.unitDefs)
  // 유틸리티(오라) 유닛도 제외 — 저지·화력 가치가 낮아 봇 구매 풀에서 뺀다
  const melee = defs
    .filter((d) => d.placement === 'ground' && !d.aura)
    .sort((a, b) => b.blockCount - a.blockCount || a.id.localeCompare(b.id))
  // 힐러는 제외 — Greedy도 '치유는 화력이 아니다'까지는 안다 (봇 힐러 운용은 W3 과제)
  const ranged = defs
    .filter((d) => d.placement === 'wallTop' && !d.heals)
    .sort((a, b) => b.range - a.range || a.id.localeCompare(b.id))

  const meleeAlive = state.units.filter(
    (u) => ctx.unitDefs[u.defId]!.placement === 'ground',
  ).length
  const rangedAlive = state.units.length - meleeAlive
  const tryOrder = meleeAlive <= rangedAlive ? [melee, ranged] : [ranged, melee]

  for (const group of tryOrder) {
    for (const def of group) {
      if (state.cost < def.cost) continue
      if ((state.redeployReadyAt[def.id] ?? 0) > state.tick) continue
      const cell =
        def.placement === 'ground' ? bestMeleeCell(ctx, state) : bestRangedCell(ctx, state, def)
      if (cell) return { type: 'deploy', unitDefId: def.id, x: cell.x, y: cell.y }
    }
  }
  return null
}

/** 성벽에 가까운 순서의 진입로 셀 중 첫 빈 칸. */
function bestMeleeCell(ctx: SimContext, state: GameState): CellPos | null {
  const seen = new Set<string>()
  const candidates: { cell: CellPos; rank: number; pathIndex: number }[] = []
  for (const [pathIndex, path] of ctx.stage.paths.entries()) {
    // 마지막 셀(성벽 접점)은 비워두고 그 앞부터 — 성벽 앞 저지선
    for (let i = path.length - 2; i >= 1; i--) {
      const cell = path[i]!
      const key = `${cell.x},${cell.y}`
      if (seen.has(key)) continue
      seen.add(key)
      candidates.push({ cell, rank: path.length - 1 - i, pathIndex })
    }
  }
  candidates.sort((a, b) => a.rank - b.rank || a.pathIndex - b.pathIndex)
  for (const c of candidates) {
    if (!occupied(state, c.cell)) return c.cell
  }
  return null
}

/** 경로 커버리지(사거리 내 경로 셀 수)가 최대인 성벽 위 셀. */
function bestRangedCell(ctx: SimContext, state: GameState, def: UnitDef): CellPos | null {
  const pathCells = ctx.stage.paths.flat()
  const ends = ctx.stage.paths.map((p) => p[p.length - 1]!)

  let best: { cell: CellPos; score: number; endDist: number } | null = null
  for (let y = 0; y < ctx.height; y++) {
    for (let x = 0; x < ctx.width; x++) {
      if (ctx.tiles[y]?.[x] !== 'wallTop' || occupied(state, { x, y })) continue
      const score = pathCells.filter((c) => Math.hypot(c.x - x, c.y - y) <= def.range).length
      if (score === 0) continue
      const endDist = Math.min(...ends.map((c) => Math.hypot(c.x - x, c.y - y)))
      if (
        !best ||
        score > best.score ||
        (score === best.score && endDist < best.endDist) ||
        (score === best.score && endDist === best.endDist && (y < best.cell.y || (y === best.cell.y && x < best.cell.x)))
      ) {
        best = { cell: { x, y }, score, endDist }
      }
    }
  }
  return best?.cell ?? null
}

function occupied(state: GameState, cell: CellPos): boolean {
  return state.units.some((u) => u.x === cell.x && u.y === cell.y)
}
