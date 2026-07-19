// Planner 봇: 경로·DPS 계산 기반 (3등급 중 최상위 지능).
// Greedy와의 차이:
//   1. 킬존 계획 — 원거리 커버리지가 최대인 진입로 셀을 초크포인트로 정하고,
//      최적 블로커가 나올 때까지 코스트를 아껴 기다린다 (Greedy는 즉시 소비).
//   2. 필요 기반 배치 — 저지 부족이면 근접, DPS 부족이면 원거리를 판단해 배치.
//   3. 누수 대응 — 초크포인트를 통과한 적의 전방 셀에 긴급 저지선을 친다.
// 상수는 전부 [초안] — 난이도 지표 논의(W2)에서 재조정.

import { TICKS_PER_SECOND } from '@core'
import type { CellPos, GameState, PlayerAction, SimContext, UnitDef } from '@core'
import type { BotPolicy } from './runner'

/** DPS 여유 판정 계수: 팀 DPS × 이 시간(초) ≥ 유입 HP 풀이어야 충분하다고 본다 */
const DPS_HORIZON_SEC = 12
/** 유입 HP 풀에 포함할 미래 스폰 범위(초) */
const SPAWN_LOOKAHEAD_SEC = 10
/** 이 거리(타일) 안까지 적이 접근하면 초크포인트 저지를 긴급으로 간주 */
const IMMINENT_TILES = 5
/** 누수 판정: 성벽까지 남은 거리(타일)가 이보다 짧은 무저지 적 */
const LEAK_TILES = 3

export function createPlannerPolicy(): BotPolicy {
  let choke: CellPos | null = null
  return (ctx, state) => {
    if (state.status !== 'playing') return []
    choke ??= findChokepoint(ctx)
    const action = decide(ctx, state, choke)
    return action ? [action] : []
  }
}

/** 원거리 커버리지(사거리 내 성벽 위 셀 수)가 최대인 진입로 셀. 성벽 접점 바로 앞은 제외. */
function findChokepoint(ctx: SimContext): CellPos {
  const maxRange = Math.max(
    1,
    ...Object.values(ctx.unitDefs)
      .filter((d) => d.placement === 'wallTop')
      .map((d) => d.range),
  )
  let best: { cell: CellPos; score: number; rank: number } | null = null
  for (const path of ctx.stage.paths) {
    for (let i = path.length - 2; i >= 1; i--) {
      const cell = path[i]!
      let score = 0
      for (let y = 0; y < ctx.height; y++) {
        for (let x = 0; x < ctx.width; x++) {
          if (ctx.tiles[y]?.[x] !== 'wallTop') continue
          if (Math.hypot(cell.x - x, cell.y - y) <= maxRange) score++
        }
      }
      const rank = path.length - 1 - i // 성벽에 가까울수록 작음
      if (!best || score > best.score || (score === best.score && rank < best.rank)) {
        best = { cell, score, rank }
      }
    }
  }
  return best!.cell
}

function decide(ctx: SimContext, state: GameState, choke: CellPos): PlayerAction | null {
  const melee = Object.values(ctx.unitDefs)
    .filter((d) => d.placement === 'ground')
    .sort((a, b) => b.blockCount - a.blockCount || b.hp - a.hp || a.id.localeCompare(b.id))
  const ranged = Object.values(ctx.unitDefs)
    .filter((d) => d.placement === 'wallTop')
    .sort((a, b) => b.range - a.range || a.id.localeCompare(b.id))

  const deployable = (d: UnitDef) =>
    state.cost >= d.cost && (state.redeployReadyAt[d.id] ?? 0) <= state.tick

  // 1. 초크포인트에 저지 유닛 확보가 최우선
  const chokeUnit = state.units.find((u) => u.x === choke.x && u.y === choke.y)
  if (!chokeUnit) {
    const bestBlocker = melee[0]
    if (bestBlocker && deployable(bestBlocker)) {
      return { type: 'deploy', unitDefId: bestBlocker.id, x: choke.x, y: choke.y }
    }
    // 최적 블로커를 기다리는 동안 적이 코앞이면 아무 근접이라도 세운다
    if (threatImminent(ctx, state)) {
      const fallback = melee.find(deployable)
      if (fallback) return { type: 'deploy', unitDefId: fallback.id, x: choke.x, y: choke.y }
    }
    return null // 코스트 저축 — Greedy와 갈라지는 지점
  }

  // 2. 누수 대응: 초크포인트를 지나 성벽에 근접한 무저지 적 앞을 막는다
  const leakCell = findLeakCell(ctx, state)
  if (leakCell) {
    const stopper = melee.find(deployable)
    if (stopper) return { type: 'deploy', unitDefId: stopper.id, x: leakCell.x, y: leakCell.y }
  }

  // 3. 저지 용량 부족 → 근접 증원, DPS 부족 → 원거리 증원
  if (blockDeficit(ctx, state) > 0) {
    const reinforcement = melee.find(deployable)
    const cell = nextMeleeCell(ctx, state)
    if (reinforcement && cell)
      return { type: 'deploy', unitDefId: reinforcement.id, x: cell.x, y: cell.y }
  }
  if (dpsDeficit(ctx, state)) {
    const shooter = ranged.find(deployable)
    const cell = shooter && bestRangedCell(ctx, state, shooter, choke)
    if (shooter && cell) return { type: 'deploy', unitDefId: shooter.id, x: cell.x, y: cell.y }
  }

  // 4. 코스트가 상한 근처면 놀리지 않고 원거리에 투자
  if (state.cost >= ctx.stage.costMax * 0.9) {
    const shooter = ranged.find(deployable)
    const cell = shooter && bestRangedCell(ctx, state, shooter, choke)
    if (shooter && cell) return { type: 'deploy', unitDefId: shooter.id, x: cell.x, y: cell.y }
  }
  return null
}

function threatImminent(ctx: SimContext, state: GameState): boolean {
  return state.enemies.some(
    (e) =>
      e.blockedBy === null &&
      !e.atWall &&
      ctx.stage.paths[e.pathIndex]!.length - 1 - e.pathPos <= IMMINENT_TILES,
  )
}

/** 누수 적의 전방(성벽 쪽) 빈 진입로 셀 중 성벽에 가장 가까운 곳 */
function findLeakCell(ctx: SimContext, state: GameState): CellPos | null {
  for (const e of state.enemies) {
    if (e.blockedBy !== null || e.atWall) continue
    const path = ctx.stage.paths[e.pathIndex]!
    if (path.length - 1 - e.pathPos >= LEAK_TILES) continue
    for (let i = path.length - 2; i > Math.round(e.pathPos); i--) {
      const cell = path[i]!
      if (!state.units.some((u) => u.x === cell.x && u.y === cell.y)) return cell
    }
  }
  return null
}

function blockDeficit(ctx: SimContext, state: GameState): number {
  const unblocked = state.enemies.filter((e) => e.blockedBy === null && !e.atWall).length
  const freeSlots = state.units.reduce((sum, u) => {
    const d = ctx.unitDefs[u.defId]!
    return sum + Math.max(0, d.blockCount - u.blockedEnemyIds.length)
  }, 0)
  return unblocked - freeSlots
}

function dpsDeficit(ctx: SimContext, state: GameState): boolean {
  const horizon = state.tick + SPAWN_LOOKAHEAD_SEC * TICKS_PER_SECOND
  const upcoming = ctx.stage.spawns
    .slice(state.spawnCursor)
    .filter((s) => s.tick <= horizon)
    .map((s) => ctx.enemyDefs[s.enemyDefId]!)
  const pool = [
    ...state.enemies.map((e) => ({ hp: e.hp, def: ctx.enemyDefs[e.defId]!.def })),
    ...upcoming.map((d) => ({ hp: d.hp, def: d.def })),
  ]
  if (pool.length === 0) return false
  const hpPool = pool.reduce((s, p) => s + p.hp, 0)
  const avgDef = pool.reduce((s, p) => s + p.def, 0) / pool.length
  const teamDps = state.units.reduce((sum, u) => {
    const d = ctx.unitDefs[u.defId]!
    return sum + (Math.max(1, d.atk - avgDef) * TICKS_PER_SECOND) / d.atkIntervalTicks
  }, 0)
  return teamDps * DPS_HORIZON_SEC < hpPool
}

/** 성벽에 가까운 순서의 빈 진입로 셀 (Greedy와 동일 기준) */
function nextMeleeCell(ctx: SimContext, state: GameState): CellPos | null {
  const candidates: { cell: CellPos; rank: number; pathIndex: number }[] = []
  const seen = new Set<string>()
  for (const [pathIndex, path] of ctx.stage.paths.entries()) {
    for (let i = path.length - 2; i >= 1; i--) {
      const cell = path[i]!
      const key = `${cell.x},${cell.y}`
      if (seen.has(key)) continue
      seen.add(key)
      candidates.push({ cell, rank: path.length - 1 - i, pathIndex })
    }
  }
  candidates.sort((a, b) => a.rank - b.rank || a.pathIndex - b.pathIndex)
  return candidates.find((c) => !state.units.some((u) => u.x === c.cell.x && u.y === c.cell.y))
    ?.cell ?? null
}

/** 초크포인트를 커버하면서 경로 커버리지가 최대인 빈 성벽 위 셀 */
function bestRangedCell(
  ctx: SimContext,
  state: GameState,
  def: UnitDef,
  choke: CellPos,
): CellPos | null {
  const pathCells = ctx.stage.paths.flat()
  let best: { cell: CellPos; chokeCovered: number; score: number } | null = null
  for (let y = 0; y < ctx.height; y++) {
    for (let x = 0; x < ctx.width; x++) {
      if (ctx.tiles[y]?.[x] !== 'wallTop') continue
      if (state.units.some((u) => u.x === x && u.y === y)) continue
      const score = pathCells.filter((c) => Math.hypot(c.x - x, c.y - y) <= def.range).length
      if (score === 0) continue
      const chokeCovered = Math.hypot(choke.x - x, choke.y - y) <= def.range ? 1 : 0
      if (
        !best ||
        chokeCovered > best.chokeCovered ||
        (chokeCovered === best.chokeCovered && score > best.score)
      ) {
        best = { cell: { x, y }, chokeCovered, score }
      }
    }
  }
  return best?.cell ?? null
}
