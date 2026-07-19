// 고정 틱 시뮬레이션 엔진. step(ctx, state, actions) -> state.
// 같은 (스테이지, 시드, 입력 시퀀스)면 항상 같은 결과 — 봇 검증과 리플레이의 전제.
// 틱 내 처리 순서 고정: 입력 → 스폰 → 이동/저지 → 유닛 공격 → 적 공격 → 코스트 → 승패.

import { TICKS_PER_SECOND, TILE_CHARS } from './types'
import type {
  ActiveEnemy,
  ActiveUnit,
  CellPos,
  DeployRejectReason,
  EnemyDef,
  GameState,
  PlayerAction,
  StageDef,
  TileType,
  UnitDef,
} from './types'

/** 스테이지·정의 테이블을 검증해 만든 불변 컨텍스트. state와 달리 틱마다 변하지 않는다. */
export interface SimContext {
  stage: StageDef
  tiles: TileType[][]
  width: number
  height: number
  unitDefs: Record<string, UnitDef>
  enemyDefs: Record<string, EnemyDef>
}

export function createContext(
  stage: StageDef,
  unitDefs: UnitDef[],
  enemyDefs: EnemyDef[],
): SimContext {
  const tiles = parseTiles(stage.tilesRows)
  const height = tiles.length
  const width = tiles[0]?.length ?? 0

  const unitMap: Record<string, UnitDef> = {}
  for (const d of unitDefs) unitMap[d.id] = d
  const enemyMap: Record<string, EnemyDef> = {}
  for (const d of enemyDefs) enemyMap[d.id] = d

  for (const [pi, path] of stage.paths.entries()) {
    if (path.length < 2) throw new Error(`paths[${pi}]: 경로는 2셀 이상이어야 함`)
    for (const [ci, cell] of path.entries()) {
      if (tileTypeAt(tiles, cell.x, cell.y) !== 'road')
        throw new Error(`paths[${pi}][${ci}] (${cell.x},${cell.y})가 road 타일이 아님`)
      if (ci > 0) {
        const prev = path[ci - 1]!
        if (Math.abs(cell.x - prev.x) + Math.abs(cell.y - prev.y) !== 1)
          throw new Error(`paths[${pi}][${ci}]가 이전 셀과 인접하지 않음`)
      }
    }
  }
  for (const [si, s] of stage.spawns.entries()) {
    if (!enemyMap[s.enemyDefId]) throw new Error(`spawns[${si}]: 미정의 적 '${s.enemyDefId}'`)
    if (!stage.paths[s.pathIndex]) throw new Error(`spawns[${si}]: 경로 ${s.pathIndex} 없음`)
    if (si > 0 && stage.spawns[si - 1]!.tick > s.tick)
      throw new Error(`spawns는 tick 오름차순이어야 함 (index ${si})`)
  }

  return { stage, tiles, width, height, unitDefs: unitMap, enemyDefs: enemyMap }
}

export function parseTiles(rows: string[]): TileType[][] {
  return rows.map((row, y) =>
    [...row].map((ch, x) => {
      const t = TILE_CHARS[ch]
      if (!t) throw new Error(`알 수 없는 타일 문자 '${ch}' (${x},${y})`)
      return t
    }),
  )
}

function tileTypeAt(tiles: TileType[][], x: number, y: number): TileType | undefined {
  return tiles[y]?.[x]
}

export function createInitialState(ctx: SimContext, seed?: number): GameState {
  return {
    tick: 0,
    status: 'playing',
    rngState: (seed ?? ctx.stage.seed) | 0,
    cost: ctx.stage.initialCost,
    wallHp: ctx.stage.wallHp,
    units: [],
    enemies: [],
    spawnCursor: 0,
    redeployReadyAt: {},
    nextEntityId: 1,
    events: [],
  }
}

/** 1틱 전진. state를 제자리에서 변경하고 그대로 반환한다. */
export function step(ctx: SimContext, state: GameState, actions: PlayerAction[] = []): GameState {
  state.events = []
  if (state.status !== 'playing') return state
  state.tick++

  applyActions(ctx, state, actions)
  spawnEnemies(ctx, state)
  moveAndBlock(ctx, state)
  unitsAttack(ctx, state)
  enemiesAttack(ctx, state)
  state.cost = Math.min(ctx.stage.costMax, state.cost + ctx.stage.costRegenPerSec / TICKS_PER_SECOND)
  resolveOutcome(ctx, state)
  return state
}

// ---------------------------------------------------------------- 입력

function applyActions(ctx: SimContext, state: GameState, actions: PlayerAction[]): void {
  for (const action of actions) {
    if (action.type === 'deploy') applyDeploy(ctx, state, action)
    else applyWithdraw(ctx, state, action.unitId)
  }
}

function applyDeploy(
  ctx: SimContext,
  state: GameState,
  a: { unitDefId: string; x: number; y: number },
): void {
  const reject = (reason: DeployRejectReason): void => {
    state.events.push({ type: 'deployRejected', unitDefId: a.unitDefId, x: a.x, y: a.y, reason })
  }

  const def = ctx.unitDefs[a.unitDefId]
  if (!def) return reject('unknownUnit')
  if ((state.redeployReadyAt[def.id] ?? 0) > state.tick) return reject('onCooldown')
  if (state.cost < def.cost) return reject('insufficientCost')

  const tile = tileTypeAt(ctx.tiles, a.x, a.y)
  const placeable =
    def.placement === 'wallTop' ? tile === 'wallTop' : tile === 'ground' || tile === 'road'
  if (!placeable) return reject('invalidTile')
  if (state.units.some((u) => u.x === a.x && u.y === a.y)) return reject('occupied')

  state.cost -= def.cost
  const unit: ActiveUnit = {
    id: state.nextEntityId++,
    defId: def.id,
    x: a.x,
    y: a.y,
    hp: def.hp,
    cooldown: 0,
    blockedEnemyIds: [],
  }
  state.units.push(unit)
  state.events.push({ type: 'deployed', unitId: unit.id, unitDefId: def.id, x: a.x, y: a.y })
}

function applyWithdraw(ctx: SimContext, state: GameState, unitId: number): void {
  const idx = state.units.findIndex((u) => u.id === unitId)
  if (idx < 0) return
  const unit = state.units[idx]!
  const def = ctx.unitDefs[unit.defId]!
  releaseBlocked(state, unit)
  state.units.splice(idx, 1)
  const refund = Math.floor(def.cost / 2)
  state.cost = Math.min(ctx.stage.costMax, state.cost + refund)
  state.redeployReadyAt[def.id] = state.tick + def.redeployTicks
  state.events.push({ type: 'withdrawn', unitId, unitDefId: def.id, refund })
}

// ---------------------------------------------------------------- 스폰/이동/저지

function spawnEnemies(ctx: SimContext, state: GameState): void {
  const spawns = ctx.stage.spawns
  while (state.spawnCursor < spawns.length && spawns[state.spawnCursor]!.tick <= state.tick) {
    const s = spawns[state.spawnCursor++]!
    const def = ctx.enemyDefs[s.enemyDefId]!
    const enemy: ActiveEnemy = {
      id: state.nextEntityId++,
      defId: def.id,
      pathIndex: s.pathIndex,
      pathPos: 0,
      hp: def.hp,
      cooldown: 0,
      blockedBy: null,
      atWall: false,
      wave: s.wave,
    }
    state.enemies.push(enemy)
    state.events.push({ type: 'enemySpawned', enemyId: enemy.id, enemyDefId: def.id, wave: s.wave })
  }
}

function moveAndBlock(ctx: SimContext, state: GameState): void {
  for (const enemy of state.enemies) {
    if (enemy.blockedBy !== null || enemy.atWall) continue
    const def = ctx.enemyDefs[enemy.defId]!
    const path = ctx.stage.paths[enemy.pathIndex]!
    const last = path.length - 1

    enemy.pathPos = Math.min(last, enemy.pathPos + def.speedTilesPerSec / TICKS_PER_SECOND)

    // 현재 셀(반올림 = 셀 중심 반타일 이내)에 여유 있는 블로커가 있으면 저지.
    // 여유가 없으면 그대로 통과한다 (저지 수 초과).
    const cellIdx = Math.round(enemy.pathPos)
    const cell = path[cellIdx]!
    const blocker = state.units.find((u) => {
      if (u.x !== cell.x || u.y !== cell.y) return false
      const bdef = ctx.unitDefs[u.defId]!
      return bdef.blockCount > u.blockedEnemyIds.length
    })
    if (blocker) {
      enemy.blockedBy = blocker.id
      enemy.pathPos = cellIdx
      blocker.blockedEnemyIds.push(enemy.id)
    } else if (enemy.pathPos >= last) {
      enemy.atWall = true
    }
  }
}

// ---------------------------------------------------------------- 전투

/** 경로 진행도를 남은 거리로 환산 — 성벽에 가까운 적이 우선 표적. */
function distanceToWall(ctx: SimContext, e: ActiveEnemy): number {
  return ctx.stage.paths[e.pathIndex]!.length - 1 - e.pathPos
}

/** 경로 진행도를 셀 좌표로 보간. 렌더러·봇이 적의 화면/공간 위치를 얻는 유일한 통로. */
export function enemyWorldPos(ctx: SimContext, e: ActiveEnemy): CellPos {
  const path = ctx.stage.paths[e.pathIndex]!
  const i = Math.floor(e.pathPos)
  const a = path[Math.min(i, path.length - 1)]!
  const b = path[Math.min(i + 1, path.length - 1)]!
  const t = e.pathPos - i
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

function damage(atk: number, def: number): number {
  return Math.max(1, atk - def)
}

function unitsAttack(ctx: SimContext, state: GameState): void {
  for (const unit of state.units) {
    if (unit.cooldown > 0) unit.cooldown--
    if (unit.cooldown > 0) continue
    const def = ctx.unitDefs[unit.defId]!

    let target: ActiveEnemy | undefined
    if (def.range <= 0) {
      // 근접: 저지 중인 적 중 첫 번째(저지 시작 순)
      const firstId = unit.blockedEnemyIds[0]
      if (firstId !== undefined) target = state.enemies.find((e) => e.id === firstId)
    } else {
      // 원거리: 사거리 내에서 성벽에 가장 가까운 적 (동률이면 먼저 스폰된 적)
      let best = Infinity
      for (const e of state.enemies) {
        const p = enemyWorldPos(ctx, e)
        if (Math.hypot(p.x - unit.x, p.y - unit.y) > def.range) continue
        const d = distanceToWall(ctx, e)
        if (d < best) {
          best = d
          target = e
        }
      }
    }
    if (!target) continue

    target.hp -= damage(def.atk, ctx.enemyDefs[target.defId]!.def)
    unit.cooldown = def.atkIntervalTicks
    if (target.hp <= 0) killEnemy(state, target, unit.id)
  }
  state.enemies = state.enemies.filter((e) => e.hp > 0)
}

function enemiesAttack(ctx: SimContext, state: GameState): void {
  for (const enemy of state.enemies) {
    if (enemy.cooldown > 0) enemy.cooldown--
    if (enemy.cooldown > 0) continue
    const def = ctx.enemyDefs[enemy.defId]!

    if (enemy.blockedBy !== null) {
      const unit = state.units.find((u) => u.id === enemy.blockedBy)
      if (!unit) continue
      unit.hp -= damage(def.atk, ctx.unitDefs[unit.defId]!.def)
      enemy.cooldown = def.atkIntervalTicks
      if (unit.hp <= 0) {
        state.events.push({ type: 'unitDied', unitId: unit.id, unitDefId: unit.defId })
        releaseBlocked(state, unit)
        state.units = state.units.filter((u) => u.id !== unit.id)
        state.redeployReadyAt[unit.defId] =
          state.tick + ctx.unitDefs[unit.defId]!.redeployTicks
      }
    } else if (enemy.atWall) {
      state.wallHp -= def.wallDamage
      enemy.cooldown = def.atkIntervalTicks
      state.events.push({
        type: 'wallHit',
        enemyId: enemy.id,
        damage: def.wallDamage,
        wallHp: Math.max(0, state.wallHp),
      })
    }
  }
}

function killEnemy(state: GameState, enemy: ActiveEnemy, byUnitId: number): void {
  if (enemy.blockedBy !== null) {
    const blocker = state.units.find((u) => u.id === enemy.blockedBy)
    if (blocker)
      blocker.blockedEnemyIds = blocker.blockedEnemyIds.filter((id) => id !== enemy.id)
  }
  state.events.push({
    type: 'enemyKilled',
    enemyId: enemy.id,
    enemyDefId: enemy.defId,
    by: byUnitId,
  })
}

function releaseBlocked(state: GameState, unit: ActiveUnit): void {
  for (const id of unit.blockedEnemyIds) {
    const e = state.enemies.find((en) => en.id === id)
    if (e) e.blockedBy = null
  }
  unit.blockedEnemyIds = []
}

// ---------------------------------------------------------------- 승패

function resolveOutcome(ctx: SimContext, state: GameState): void {
  if (state.wallHp <= 0) {
    state.wallHp = 0
    state.status = 'lost'
    state.events.push({ type: 'lost' })
    return
  }
  if (state.spawnCursor >= ctx.stage.spawns.length && state.enemies.length === 0) {
    state.status = 'won'
    state.events.push({ type: 'won' })
  }
}

// ---------------------------------------------------------------- 편의 래퍼

/** 스테이지 하나를 돌리는 편의 래퍼. 봇·클라이언트 양쪽에서 사용. */
export class Simulation {
  readonly ctx: SimContext
  state: GameState

  constructor(stage: StageDef, unitDefs: UnitDef[], enemyDefs: EnemyDef[], seed?: number) {
    this.ctx = createContext(stage, unitDefs, enemyDefs)
    this.state = createInitialState(this.ctx, seed)
  }

  step(actions: PlayerAction[] = []): GameState {
    return step(this.ctx, this.state, actions)
  }
}
