// Planner 봇: 경로·DPS 계산 기반 (3등급 중 최상위 지능).
// Greedy와의 차이:
//   1. 스폰 테이블 사전 계획 — 클럼프(동시 도착 무리)를 예측해 도착 전에 그 레인에
//      다중 저지를 준비한다. Greedy는 눈앞 상황에만 반응한다.
//   2. 킬존 계획 — 원거리 커버리지 기준 초크포인트 + 최약 레인 균형 오프너.
//   3. 필요 기반 배치 — 저지 부족이면 근접, DPS 부족이면 원거리를 판단해 배치.
//      필요한 유닛을 제때 모을 수 있으면 코스트를 저축한다 (Greedy는 즉시 소비).
//   4. 누수 대응 — 초크포인트를 통과한 적의 전방 셀에 긴급 저지선을 친다.
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
/** 저지 부족 판정에 포함할 적의 범위: 성벽 도달 ETA가 이 시간(초) 이내 */
const URGENT_ETA_SEC = 10
/** 클럼프 판정: 같은 경로에 이 시간(초) 창 안에 도착하는 적 수 */
const CLUMP_WINDOW_SEC = 4
/** 클럼프 대비 착수 리드타임(초): 도착까지 이 시간 이내로 다가오면 준비 시작 */
const CLUMP_LEAD_SEC = 20

/** 스폰 테이블에서 예측한 저지 수요: path에 tick 시점까지 capacity가 필요하다 */
interface ClumpMilestone {
  pathIndex: number
  arrivalTick: number
  requiredBlock: number
}

export function createPlannerPolicy(): BotPolicy {
  let choke: CellPos | null = null
  let milestones: ClumpMilestone[] | null = null
  return (ctx, state) => {
    if (state.status !== 'playing') return []
    choke ??= findChokepoint(ctx)
    milestones ??= predictClumps(ctx)
    const action = decide(ctx, state, choke, milestones)
    return action ? [action] : []
  }
}

/**
 * 스폰 테이블 → 경로별 성벽 도착 시각 → CLUMP_WINDOW_SEC 창에서 겹치는 최대 무리.
 * 겹침이 2 이상인 지점마다 "도착 전까지 저지 capacity N 확보" 마일스톤을 만든다.
 */
function predictClumps(ctx: SimContext): ClumpMilestone[] {
  const windowTicks = CLUMP_WINDOW_SEC * TICKS_PER_SECOND
  const milestones: ClumpMilestone[] = []
  for (let pi = 0; pi < ctx.stage.paths.length; pi++) {
    const travel = (ctx.stage.paths[pi]!.length - 1) * TICKS_PER_SECOND
    const arrivals = ctx.stage.spawns
      .filter((s) => s.pathIndex === pi)
      .map((s) => s.tick + travel / ctx.enemyDefs[s.enemyDefId]!.speedTilesPerSec)
      .sort((a, b) => a - b)
    for (let i = 0; i < arrivals.length; i++) {
      const clump = arrivals.filter((t) => t >= arrivals[i]! && t < arrivals[i]! + windowTicks)
      if (clump.length >= 2) {
        milestones.push({
          pathIndex: pi,
          arrivalTick: Math.round(arrivals[i]!),
          requiredBlock: Math.min(clump.length, 4),
        })
      }
    }
  }
  return milestones.sort((a, b) => a.arrivalTick - b.arrivalTick)
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

function decide(
  ctx: SimContext,
  state: GameState,
  choke: CellPos,
  milestones: ClumpMilestone[],
): PlayerAction | null {
  const melee = Object.values(ctx.unitDefs)
    .filter((d) => d.placement === 'ground')
    .sort((a, b) => b.blockCount - a.blockCount || b.hp - a.hp || a.id.localeCompare(b.id))
  const ranged = Object.values(ctx.unitDefs)
    .filter((d) => d.placement === 'wallTop')
    .sort((a, b) => b.range - a.range || a.id.localeCompare(b.id))

  const deployable = (d: UnitDef) =>
    state.cost >= d.cost && (state.redeployReadyAt[d.id] ?? 0) <= state.tick

  // 0. 원거리 0기면 커버리지 최대 원거리부터 — 성벽에 붙은 적은 원거리 없이
  //    영원히 못 죽이므로, 최소 한 기의 광역 커버가 모든 계획의 전제다.
  const rangedAlive = state.units.filter(
    (u) => ctx.unitDefs[u.defId]!.placement === 'wallTop',
  ).length
  if (rangedAlive === 0) {
    const opener = ranged.filter(deployable).sort((a, b) => a.cost - b.cost)[0]
    const cell = opener && balancedRangedCell(ctx, state, opener)
    if (opener && cell) return { type: 'deploy', unitDefId: opener.id, x: cell.x, y: cell.y }
  }

  // 1. 초크포인트에 저지 유닛 확보가 최우선.
  //    최적 블로커를 적 도착 전에 모을 수 있으면 기다리고, 못 모을 때만
  //    (그리고 적이 코앞일 때만) 아무 근접으로 때운다.
  const chokeUnit = state.units.find((u) => u.x === choke.x && u.y === choke.y)
  if (!chokeUnit) {
    const bestBlocker = melee[0]
    if (bestBlocker && deployable(bestBlocker)) {
      return { type: 'deploy', unitDefId: bestBlocker.id, x: choke.x, y: choke.y }
    }
    if (bestBlocker && affordableBefore(ctx, state, bestBlocker, earliestThreatTick(ctx, state))) {
      return null // 블로커 저축 — Greedy와 갈라지는 지점
    }
    if (threatImminent(ctx, state)) {
      const fallback = melee.find(deployable)
      if (fallback) return { type: 'deploy', unitDefId: fallback.id, x: choke.x, y: choke.y }
    }
    return null
  }

  // 2. 성벽 캠핑 청소: 성벽을 때리는 중인데 아무 원거리도 못 닿는 적이 있으면
  //    그 접점을 커버하는 원거리 구매가 최우선 (놔두면 무한 출혈)
  const camperCell = uncoveredWallCamper(ctx, state)
  if (camperCell) {
    const shooter = ranged.find(deployable)
    const cell = shooter && bestRangedCell(ctx, state, shooter, camperCell)
    if (shooter && cell) return { type: 'deploy', unitDefId: shooter.id, x: cell.x, y: cell.y }
    return null // 원거리 저축 — 캠퍼 방치가 제일 비싸다
  }

  // 2.4 클럼프 사전 대비: 예측된 동시 도착 무리보다 먼저 해당 레인의 저지
  //     capacity를 맞춘다. 블로커를 제때 모을 수 있으면 저축하며 기다린다.
  const leadTicks = CLUMP_LEAD_SEC * TICKS_PER_SECOND
  for (const m of milestones) {
    if (m.arrivalTick <= state.tick) continue
    if (m.arrivalTick - state.tick > leadTicks) break // 정렬돼 있으므로 이후는 더 멀다
    if (pathBlockCapacity(ctx, state, m.pathIndex) >= m.requiredBlock) continue
    const cell = nextMeleeCell(ctx, state, m.pathIndex)
    if (!cell) continue
    const bestBlocker = melee[0]!
    if (deployable(bestBlocker))
      return { type: 'deploy', unitDefId: bestBlocker.id, x: cell.x, y: cell.y }
    if (affordableBefore(ctx, state, bestBlocker, m.arrivalTick - 2 * TICKS_PER_SECOND))
      return null // 블로커 저축
    const fallback = melee.find(deployable)
    if (fallback) return { type: 'deploy', unitDefId: fallback.id, x: cell.x, y: cell.y }
    return null // 뭐라도 모일 때까지 저축
  }

  // 2.5 누수 대응: 초크포인트를 지나 성벽에 근접한 무저지 적 앞을 막는다
  const leakCell = findLeakCell(ctx, state)
  if (leakCell) {
    const stopper = melee.find(deployable)
    if (stopper) return { type: 'deploy', unitDefId: stopper.id, x: leakCell.x, y: leakCell.y }
  }

  // 3. 저지 용량 부족 → 근접 증원. 판정은 경로별 — 다른 레인의 빈 저지 슬롯은
  //    이 레인을 못 지킨다. 근접이 필요한데 코스트가 모자라면:
  //    적 도착 전에 모을 수 있을 때만 저축하고(싼 원거리의 코스트 선점 방지),
  //    어차피 늦으면 원거리 화력에라도 투자한다 (저축 고사 방지).
  const worst = worstBlockDeficitPath(ctx, state)
  if (leakCell !== null || worst !== null) {
    // 부족이 2 이상이면 다중 저지(블로커)가 필요하다 — 제때 모을 수 있으면 기다린다
    const wantMulti = (worst?.deficit ?? 1) >= 2
    const preferred = wantMulti ? melee[0] : undefined
    const reinforcement =
      preferred && deployable(preferred) ? preferred : melee.find(deployable)
    const cell = nextMeleeCell(ctx, state, worst?.pathIndex)
    if (wantMulti && preferred && !deployable(preferred) && savingIsWorthIt(ctx, state, melee))
      return null
    if (reinforcement && cell)
      return { type: 'deploy', unitDefId: reinforcement.id, x: cell.x, y: cell.y }
    if (savingIsWorthIt(ctx, state, melee)) return null
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

/** tick 시점 전에 해당 유닛 코스트를 모을 수 있는가 (재배치 쿨다운 포함) */
function affordableBefore(
  ctx: SimContext,
  state: GameState,
  def: UnitDef,
  deadlineTick: number,
): boolean {
  if ((state.redeployReadyAt[def.id] ?? 0) > deadlineTick) return false
  const regenPerTick = ctx.stage.costRegenPerSec / TICKS_PER_SECOND
  if (state.cost >= def.cost) return true
  if (regenPerTick <= 0) return false
  return state.tick + (def.cost - state.cost) / regenPerTick < deadlineTick
}

/** 무저지 적 중 가장 이른 성벽 도달 틱 (없으면 무한대) */
function earliestThreatTick(ctx: SimContext, state: GameState): number {
  const etas = state.enemies
    .filter((e) => e.blockedBy === null && !e.atWall)
    .map((e) => state.tick + etaTicks(ctx, e))
  return etas.length > 0 ? Math.min(...etas) : Infinity
}

/** 해당 경로의 셀 위에 서 있는 아군 근접의 저지 수 총합 (현재 점유 무관 총량) */
function pathBlockCapacity(ctx: SimContext, state: GameState, pathIndex: number): number {
  const cells = new Set(ctx.stage.paths[pathIndex]!.map((c) => `${c.x},${c.y}`))
  return state.units.reduce((sum, u) => {
    if (!cells.has(`${u.x},${u.y}`)) return sum
    return sum + ctx.unitDefs[u.defId]!.blockCount
  }, 0)
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

/** 성벽을 때리는 중인데 사거리 안에 둔 아군 원거리가 없는 적의 위치(경로 끝 셀) */
function uncoveredWallCamper(ctx: SimContext, state: GameState): CellPos | null {
  for (const e of state.enemies) {
    if (!e.atWall) continue
    const cell = ctx.stage.paths[e.pathIndex]![ctx.stage.paths[e.pathIndex]!.length - 1]!
    const covered = state.units.some((u) => {
      const d = ctx.unitDefs[u.defId]!
      return d.range > 0 && Math.hypot(u.x - cell.x, u.y - cell.y) <= d.range
    })
    if (!covered) return cell
  }
  return null
}

/** 성벽 도달까지 남은 틱 */
function etaTicks(ctx: SimContext, e: { pathIndex: number; pathPos: number; defId: string }): number {
  const remaining = ctx.stage.paths[e.pathIndex]!.length - 1 - e.pathPos
  return (remaining / ctx.enemyDefs[e.defId]!.speedTilesPerSec) * TICKS_PER_SECOND
}

/**
 * 근접을 기다리는 게 의미 있는가: 가장 싼 근접을 가장 급한 적의 도착 전에
 * 모을 수 있으면 true (저축). 못 모으면 false (원거리 화력이라도 사는 게 낫다).
 */
function savingIsWorthIt(ctx: SimContext, state: GameState, melee: UnitDef[]): boolean {
  const cheapest = melee
    .filter((d) => (state.redeployReadyAt[d.id] ?? 0) <= state.tick)
    .sort((a, b) => a.cost - b.cost)[0]
  if (!cheapest) return false
  const regenPerTick = ctx.stage.costRegenPerSec / TICKS_PER_SECOND
  if (regenPerTick <= 0) return false
  const ticksToAfford = (cheapest.cost - state.cost) / regenPerTick
  const urgentEtas = state.enemies
    .filter((e) => e.blockedBy === null && !e.atWall)
    .map((e) => etaTicks(ctx, e))
  if (urgentEtas.length === 0) return true
  return ticksToAfford < Math.min(...urgentEtas)
}

/** 저지 부족이 가장 심한 경로와 부족량. 부족한 경로가 없으면 null.
 *  성벽 도달 ETA가 URGENT_ETA_SEC 이내인 적만 센다 — 먼 적 때문에 저축 고사하지 않도록. */
function worstBlockDeficitPath(
  ctx: SimContext,
  state: GameState,
): { pathIndex: number; deficit: number } | null {
  let worst: { pathIndex: number; deficit: number } | null = null
  for (let pi = 0; pi < ctx.stage.paths.length; pi++) {
    const pathCells = new Set(ctx.stage.paths[pi]!.map((c) => `${c.x},${c.y}`))
    const unblocked = state.enemies.filter(
      (e) =>
        e.pathIndex === pi &&
        e.blockedBy === null &&
        !e.atWall &&
        etaTicks(ctx, e) <= URGENT_ETA_SEC * TICKS_PER_SECOND,
    ).length
    const freeSlots = state.units.reduce((sum, u) => {
      if (!pathCells.has(`${u.x},${u.y}`)) return sum
      const d = ctx.unitDefs[u.defId]!
      return sum + Math.max(0, d.blockCount - u.blockedEnemyIds.length)
    }, 0)
    const deficit = unblocked - freeSlots
    if (deficit > 0 && (!worst || deficit > worst.deficit)) {
      worst = { pathIndex: pi, deficit }
    }
  }
  return worst
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
  // 근접 DPS는 저지 중일 때만 실현되므로 절반만 인정 — 과대평가하면 원거리를 안 산다
  const teamDps = state.units.reduce((sum, u) => {
    const d = ctx.unitDefs[u.defId]!
    const dps = (Math.max(1, d.atk - avgDef) * TICKS_PER_SECOND) / d.atkIntervalTicks
    return sum + (d.range > 0 ? dps : dps * 0.5)
  }, 0)
  return teamDps * DPS_HORIZON_SEC < hpPool
}

/** 성벽에 가까운 순서의 빈 진입로 셀. targetPath를 주면 해당 경로로 한정. */
function nextMeleeCell(
  ctx: SimContext,
  state: GameState,
  targetPath?: number,
): CellPos | null {
  const candidates: { cell: CellPos; rank: number; pathIndex: number }[] = []
  const seen = new Set<string>()
  for (const [pathIndex, path] of ctx.stage.paths.entries()) {
    if (targetPath !== undefined && pathIndex !== targetPath) continue
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

/**
 * 오프너용: 가장 얇게 커버되는 경로의 커버 셀 수를 최대화하는 성벽 위 셀.
 * 단일 원거리로 전 레인을 고르게 봐야 초반 어느 쪽 캠핑에도 대응된다.
 */
function balancedRangedCell(ctx: SimContext, state: GameState, def: UnitDef): CellPos | null {
  let best: { cell: CellPos; minCover: number; total: number } | null = null
  for (let y = 0; y < ctx.height; y++) {
    for (let x = 0; x < ctx.width; x++) {
      if (ctx.tiles[y]?.[x] !== 'wallTop') continue
      if (state.units.some((u) => u.x === x && u.y === y)) continue
      const covers = ctx.stage.paths.map(
        (p) => p.filter((c) => Math.hypot(c.x - x, c.y - y) <= def.range).length,
      )
      const total = covers.reduce((s, v) => s + v, 0)
      if (total === 0) continue
      const minCover = Math.min(...covers)
      if (!best || minCover > best.minCover || (minCover === best.minCover && total > best.total)) {
        best = { cell: { x, y }, minCover, total }
      }
    }
  }
  return best?.cell ?? null
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
