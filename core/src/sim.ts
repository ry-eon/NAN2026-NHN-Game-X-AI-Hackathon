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
  WallActionDefs,
} from './types'

/** 유닛 재배치(이동) 쿨다운 [초안] — 철수+재배치보다 가볍되 남용은 막는다 */
export const MOVE_COOLDOWN_TICKS = 8 * TICKS_PER_SECOND
/** 이동 직후 전열 재정비 시간 (공격 불가) [초안] */
const MOVE_SETTLE_TICKS = Math.round(0.5 * TICKS_PER_SECOND)

/** 성벽 액션 기본 규칙 [초안]. createContext에서 교체 가능 (데이터 주도) */
export const DEFAULT_WALL_ACTIONS: WallActionDefs = {
  repair: { cost: 12, heal: 180, cooldownTicks: 8 * TICKS_PER_SECOND },
  skill: { damage: 320, radius: 1.8, cooldownTicks: 40 * TICKS_PER_SECOND },
}

/** 스테이지·정의 테이블을 검증해 만든 불변 컨텍스트. state와 달리 틱마다 변하지 않는다. */
export interface SimContext {
  stage: StageDef
  tiles: TileType[][]
  width: number
  height: number
  unitDefs: Record<string, UnitDef>
  enemyDefs: Record<string, EnemyDef>
  wallActions: WallActionDefs
  /** v3: 성벽(wallTop) 타일 목록 — 공성 사거리 판정용 */
  wallCells: CellPos[]
  /** v3: 목표 셀(성벽에 4방 인접한 통행 가능 셀) — 도달 시 성벽 타격 */
  goalCells: CellPos[]
}

export function createContext(
  stage: StageDef,
  unitDefs: UnitDef[],
  enemyDefs: EnemyDef[],
  wallActions: WallActionDefs = DEFAULT_WALL_ACTIONS,
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

  const wallCells: CellPos[] = []
  const goalCells: CellPos[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (tiles[y]![x] === 'wallTop') wallCells.push({ x, y })
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = tiles[y]![x]
      if (t !== 'ground' && t !== 'road') continue
      const adjWall = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ].some(([ax, ay]) => tiles[ay!]?.[ax!] === 'wallTop')
      if (adjWall) goalCells.push({ x, y })
    }
  }
  if (goalCells.length === 0) throw new Error('목표 셀 없음: 성벽(wallTop)에 인접한 통행 가능 셀이 필요')

  return { stage, tiles, width, height, unitDefs: unitMap, enemyDefs: enemyMap, wallActions, wallCells, goalCells }
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

/**
 * @param startWallHp 연전(캠페인)에서 이월된 시작 성벽 HP.
 *   생략 시 만피. 스테이지 최대치로 캡, 최소 1 (docs/02 성벽 지속 구조).
 */
export function createInitialState(
  ctx: SimContext,
  seed?: number,
  startWallHp?: number,
): GameState {
  return {
    tick: 0,
    status: 'playing',
    rngState: (seed ?? ctx.stage.seed) | 0,
    cost: ctx.stage.initialCost,
    wallHp:
      startWallHp !== undefined
        ? Math.max(1, Math.min(ctx.stage.wallHp, Math.floor(startWallHp)))
        : ctx.stage.wallHp,
    units: [],
    enemies: [],
    spawnCursor: 0,
    redeployReadyAt: {},
    repairReadyAt: 0,
    wallSkillReadyAt: 0,
    obstacleVersion: 0,
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
  runAutoSkills(ctx, state)
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
    else if (action.type === 'withdraw') applyWithdraw(ctx, state, action.unitId)
    else if (action.type === 'moveUnit') applyMove(ctx, state, action)
    else if (action.type === 'repairWall') applyRepair(ctx, state)
    else if (action.type === 'wallSkill') applyWallSkill(ctx, state, action.x, action.y)
    else applyUseSkill(ctx, state, action.unitId)
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
    moveReadyAt: 0,
    shield: 0,
    attackCount: 0,
    autoReadyAt: 0,
    activeReadyAt: 0,
    activeUntil: 0,
  }
  state.units.push(unit)
  if (def.placement !== 'wallTop') state.obstacleVersion++
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
  if (def.placement !== 'wallTop') state.obstacleVersion++
  state.events.push({ type: 'withdrawn', unitId, unitDefId: def.id, refund })
}

/** 재배치: 배치 규칙 동일 검증, 저지 해제, 짧은 재정비 후 전투 재개 */
function applyMove(
  ctx: SimContext,
  state: GameState,
  a: { unitId: number; x: number; y: number },
): void {
  const reject = (reason: 'unknownUnit' | 'onCooldown' | 'invalidTile' | 'occupied'): void => {
    state.events.push({ type: 'moveRejected', unitId: a.unitId, reason })
  }
  const unit = state.units.find((u) => u.id === a.unitId)
  if (!unit) return reject('unknownUnit')
  if (unit.moveReadyAt > state.tick) return reject('onCooldown')
  const def = ctx.unitDefs[unit.defId]!
  const tile = tileTypeAt(ctx.tiles, a.x, a.y)
  const placeable =
    def.placement === 'wallTop' ? tile === 'wallTop' : tile === 'ground' || tile === 'road'
  if (!placeable) return reject('invalidTile')
  if (state.units.some((u) => u.id !== unit.id && u.x === a.x && u.y === a.y))
    return reject('occupied')

  releaseBlocked(state, unit)
  unit.x = a.x
  unit.y = a.y
  unit.cooldown = Math.max(unit.cooldown, MOVE_SETTLE_TICKS)
  unit.moveReadyAt = state.tick + MOVE_COOLDOWN_TICKS
  if (def.placement !== 'wallTop') state.obstacleVersion++
  state.events.push({ type: 'unitMoved', unitId: unit.id, x: a.x, y: a.y })
}

function applyRepair(ctx: SimContext, state: GameState): void {
  const def = ctx.wallActions.repair
  const reject = (reason: 'insufficientCost' | 'onCooldown' | 'wallFull'): void => {
    state.events.push({ type: 'wallActionRejected', action: 'repair', reason })
  }
  if (state.repairReadyAt > state.tick) return reject('onCooldown')
  if (state.cost < def.cost) return reject('insufficientCost')
  if (state.wallHp >= ctx.stage.wallHp) return reject('wallFull')

  state.cost -= def.cost
  const before = state.wallHp
  state.wallHp = Math.min(ctx.stage.wallHp, state.wallHp + def.heal)
  state.repairReadyAt = state.tick + def.cooldownTicks
  state.events.push({ type: 'wallRepaired', amount: state.wallHp - before, wallHp: state.wallHp })
}

function applyWallSkill(ctx: SimContext, state: GameState, x: number, y: number): void {
  const def = ctx.wallActions.skill
  const reject = (reason: 'onCooldown' | 'invalidTarget'): void => {
    state.events.push({ type: 'wallActionRejected', action: 'skill', reason })
  }
  if (state.wallSkillReadyAt > state.tick) return reject('onCooldown')
  if (x < 0 || y < 0 || x >= ctx.width || y >= ctx.height) return reject('invalidTarget')

  let hits = 0
  for (const e of state.enemies) {
    if (e.hp <= 0) continue
    const p = enemyWorldPos(ctx, e)
    if (Math.hypot(p.x - x, p.y - y) > def.radius) continue
    e.hp -= def.damage // 낙석: 방어력 무시 고정 피해
    hits++
    if (e.hp <= 0) killEnemy(state, e, 0) // by 0 = 성벽 액션
  }
  state.enemies = state.enemies.filter((e) => e.hp > 0)
  state.wallSkillReadyAt = state.tick + def.cooldownTicks
  state.events.push({ type: 'wallSkillFired', x, y, hits })
}

/** 캐릭터 액티브 기술 발동 (docs/07 v2 — 수동, 쿨다운제) */
function applyUseSkill(ctx: SimContext, state: GameState, unitId: number): void {
  const reject = (reason: 'unknownUnit' | 'noActiveSkill' | 'onCooldown'): void => {
    state.events.push({ type: 'skillRejected', unitId, reason })
  }
  const unit = state.units.find((u) => u.id === unitId)
  if (!unit) return reject('unknownUnit')
  const skill = skillOf(ctx, unit, 'active')
  if (!skill) return reject('noActiveSkill')
  if (unit.activeReadyAt > state.tick) return reject('onCooldown')

  const effect = skill.effect
  if (effect.kind === 'frenzy') {
    unit.activeUntil = state.tick + effect.durationTicks
  } else if (effect.kind === 'knockback') {
    for (const id of unit.blockedEnemyIds) {
      const e = state.enemies.find((en) => en.id === id)
      if (!e) continue
      e.blockedBy = null
      e.pathPos = Math.max(0, e.pathPos - effect.tiles)
      e.atWall = false
    }
    unit.blockedEnemyIds = []
  } else if (effect.kind === 'heal') {
    unit.hp = Math.min(ctx.unitDefs[unit.defId]!.hp, unit.hp + effect.amount)
  } else if (effect.kind === 'nova') {
    for (const e of state.enemies) {
      if (e.hp <= 0) continue
      const p = enemyWorldPos(ctx, e)
      if (Math.hypot(p.x - unit.x, p.y - unit.y) > effect.radius) continue
      e.hp -= effect.damage // 방어 무시
      if (e.hp <= 0) killEnemy(state, e, unit.id)
    }
    state.enemies = state.enemies.filter((e) => e.hp > 0)
  }
  unit.activeReadyAt = state.tick + (skill.cooldownTicks ?? 0)
  state.events.push({ type: 'skillUsed', unitId, skillId: skill.id })
}

/** 유닛의 슬롯별 기술 (statMod 패시브는 레벨 적용 시 이미 스탯에 구워짐) */
function skillOf(ctx: SimContext, unit: ActiveUnit, slot: 'passive' | 'auto' | 'active') {
  return ctx.unitDefs[unit.defId]!.skills?.find((sk) => sk.slot === slot)
}

/** 방어 관통 패시브를 반영한 대적 피해 */
function damageVsEnemy(ctx: SimContext, unit: ActiveUnit, atk: number, enemyDef: number): number {
  const pierce = skillOf(ctx, unit, 'passive')?.effect
  const effDef =
    pierce && pierce.kind === 'armorPierce' ? enemyDef * (1 - pierce.ratio) : enemyDef
  return Math.max(1, Math.round(atk - effDef))
}

/** 자동 기술 틱 처리 (selfHeal / shield) — 유닛 공격 단계 직전에 호출 */
function runAutoSkills(ctx: SimContext, state: GameState): void {
  for (const unit of state.units) {
    const auto = skillOf(ctx, unit, 'auto')
    if (!auto) continue
    const def = ctx.unitDefs[unit.defId]!
    const effect = auto.effect
    if (effect.kind === 'selfHeal') {
      if (state.tick >= unit.autoReadyAt && unit.hp < def.hp * effect.thresholdRatio) {
        unit.hp = Math.min(def.hp, unit.hp + effect.amount)
        unit.autoReadyAt = state.tick + effect.cooldownTicks
      }
    } else if (effect.kind === 'shield') {
      if (state.tick >= unit.autoReadyAt) {
        unit.shield = Math.max(unit.shield, effect.amount)
        unit.autoReadyAt = state.tick + effect.intervalTicks
      }
    }
  }
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
      route: [],
      routeVersion: -1, // 첫 이동 틱에 계산
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

// v3 동적 길찾기: 다익스트라 (도로 선호 가중치). 결정론 — 고정 이웃 순서·인덱스 타이브레이크.
const COST_ROAD = 10
const COST_GROUND = 14
const COST_UNIT = 5000 // 봉쇄 돌파 모드에서 유닛 칸 통과 벌점
/** 근접 유닛이 저지 없이 직접 때릴 수 있는 거리 (자기 칸+인접) */
const MELEE_REACH = 1.05

function isWalkable(ctx: SimContext, x: number, y: number): boolean {
  const t = ctx.tiles[y]?.[x]
  return t === 'ground' || t === 'road'
}

/**
 * from에서 가장 가까운 목표 셀까지의 경로.
 * 1차: 지상 유닛 칸 통행 불가. 실패 시(완전 봉쇄) 2차: 유닛 칸 고비용 통과 —
 * 경로상 유닛과 교전해 뚫는다. null = 지형적으로 도달 불가.
 */
function computeRoute(
  ctx: SimContext,
  state: GameState,
  from: CellPos,
  penalizeUnits: boolean,
): CellPos[] | null {
  const W = ctx.width
  const H = ctx.height
  const occupied = new Set<number>()
  for (const u of state.units) {
    if (ctx.unitDefs[u.defId]!.placement === 'wallTop') continue
    occupied.add(u.y * W + u.x)
  }
  const dist = new Float64Array(W * H).fill(Infinity)
  const prev = new Int32Array(W * H).fill(-1)
  const done = new Uint8Array(W * H)
  const start = from.y * W + from.x
  dist[start] = 0

  for (;;) {
    // 최소 거리 미방문 노드 (인덱스 타이브레이크 → 결정론)
    let cur = -1
    let best = Infinity
    for (let i = 0; i < W * H; i++) {
      if (!done[i] && dist[i]! < best) {
        best = dist[i]!
        cur = i
      }
    }
    if (cur < 0) break
    done[cur] = 1
    const cx = cur % W
    const cy = Math.floor(cur / W)
    // 이웃: 상→우→하→좌 고정 순서
    const neighbors = [
      [cx, cy - 1],
      [cx + 1, cy],
      [cx, cy + 1],
      [cx - 1, cy],
    ] as const
    for (const [nx, ny] of neighbors) {
      if (!isWalkable(ctx, nx, ny)) continue
      const ni = ny * W + nx
      let cost = ctx.tiles[ny]![nx] === 'road' ? COST_ROAD : COST_GROUND
      if (occupied.has(ni)) {
        if (!penalizeUnits) continue
        cost += COST_UNIT
      }
      if (dist[cur]! + cost < dist[ni]!) {
        dist[ni] = dist[cur]! + cost
        prev[ni] = cur
      }
    }
  }

  // 가장 가까운 목표 셀 (거리 → 인덱스 순 타이브레이크)
  let goal = -1
  let goalDist = Infinity
  for (const g of ctx.goalCells) {
    const gi = g.y * W + g.x
    if (dist[gi]! < goalDist) {
      goalDist = dist[gi]!
      goal = gi
    }
  }
  if (goal < 0 || goalDist === Infinity) return null

  const route: CellPos[] = []
  for (let i = goal; i >= 0; i = prev[i]!) {
    route.unshift({ x: i % W, y: Math.floor(i / W) })
    if (i === start) break
  }
  return route[0]?.x === from.x && route[0]?.y === from.y ? route : null
}

/** 경로 확보 (장애물 변화 시 현재 셀에서 재계산) */
function ensureRoute(ctx: SimContext, state: GameState, enemy: ActiveEnemy): void {
  if (enemy.routeVersion === state.obstacleVersion && enemy.route.length > 0) return
  const pos = enemyWorldPos(ctx, enemy)
  const cur = { x: Math.round(pos.x), y: Math.round(pos.y) }
  const route =
    computeRoute(ctx, state, cur, false) ?? computeRoute(ctx, state, cur, true)
  enemy.route = route ?? [cur]
  enemy.pathPos = 0
  enemy.routeVersion = state.obstacleVersion
}

/** 감속 오라 적용 후의 이동 배율 (여러 오라가 겹치면 가장 강한 것 하나) */
function slowFactorAt(ctx: SimContext, state: GameState, pos: CellPos): number {
  let factor = 1
  for (const u of state.units) {
    const aura = ctx.unitDefs[u.defId]!.aura
    if (!aura) continue
    if (Math.hypot(u.x - pos.x, u.y - pos.y) <= aura.radius) {
      factor = Math.min(factor, aura.speedFactor)
    }
  }
  return factor
}

function nearestWallDistance(ctx: SimContext, pos: CellPos): number {
  let best = Infinity
  for (const w of ctx.wallCells) {
    const d = Math.hypot(w.x - pos.x, w.y - pos.y)
    if (d < best) best = d
  }
  return best
}

function moveAndBlock(ctx: SimContext, state: GameState): void {
  for (const enemy of state.enemies) {
    if (enemy.blockedBy !== null || enemy.atWall) continue
    const def = ctx.enemyDefs[enemy.defId]!
    ensureRoute(ctx, state, enemy)
    const route = enemy.route
    const last = route.length - 1

    const pos = enemyWorldPos(ctx, enemy)

    // 공성류: 성벽 직선 사거리 안이면 정지·포격
    if (def.wallAttackRange !== undefined && nearestWallDistance(ctx, pos) <= def.wallAttackRange) {
      enemy.atWall = true
      continue
    }

    // 다음 노드가 유닛 칸이면(봉쇄 돌파 경로) 그 앞에서 교전
    const nextIdx = Math.min(last, Math.floor(enemy.pathPos + 1e-6) + 1)
    const nextCell = route[nextIdx]!
    const blockingUnit = state.units.find(
      (u) =>
        u.x === nextCell.x &&
        u.y === nextCell.y &&
        ctx.unitDefs[u.defId]!.placement !== 'wallTop',
    )
    if (blockingUnit && enemy.pathPos >= nextIdx - 0.55) {
      const bdef = ctx.unitDefs[blockingUnit.defId]!
      if (bdef.blockCount > blockingUnit.blockedEnemyIds.length) {
        enemy.blockedBy = blockingUnit.id
        blockingUnit.blockedEnemyIds.push(enemy.id)
      }
      // 저지 슬롯이 없으면 그 자리에서 대기 (물리적으로 막혀 있다)
      continue
    }

    const cellHere = route[Math.min(last, Math.round(enemy.pathPos))]!
    const tileMul = ctx.tiles[cellHere.y]?.[cellHere.x] === 'road' ? 1 : 0.72
    const speed =
      (def.speedTilesPerSec / TICKS_PER_SECOND) * tileMul * slowFactorAt(ctx, state, pos)
    const cap = blockingUnit ? nextIdx - 0.55 : last
    enemy.pathPos = Math.min(cap, enemy.pathPos + speed)

    if (enemy.pathPos >= last) enemy.atWall = true
  }
}

// ---------------------------------------------------------------- 전투

/** 남은 경로 길이 — 성벽에 가까운 적이 우선 표적. */
function distanceToWall(_ctx: SimContext, e: ActiveEnemy): number {
  return Math.max(0, e.route.length - 1 - e.pathPos)
}

/** 경로 진행도를 셀 좌표로 보간. 렌더러·봇이 적의 화면/공간 위치를 얻는 유일한 통로. */
export function enemyWorldPos(ctx: SimContext, e: ActiveEnemy): CellPos {
  const route = e.route.length > 0 ? e.route : ctx.stage.paths[e.pathIndex]!.slice(0, 1)
  const i = Math.floor(e.pathPos)
  const a = route[Math.min(i, route.length - 1)]!
  const b = route[Math.min(i + 1, route.length - 1)]!
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

    // 힐러: 사거리 내 가장 다친(비율 기준) 아군을 치유. 대상 없으면 대기
    if (def.heals) {
      let patient: ActiveUnit | undefined
      let worst = 1
      for (const ally of state.units) {
        if (ally.id === unit.id) continue
        const maxHp = ctx.unitDefs[ally.defId]!.hp
        const ratio = ally.hp / maxHp
        if (ratio >= 1) continue
        if (Math.hypot(ally.x - unit.x, ally.y - unit.y) > def.range) continue
        if (ratio < worst) {
          worst = ratio
          patient = ally
        }
      }
      if (patient) {
        const before = patient.hp
        patient.hp = Math.min(ctx.unitDefs[patient.defId]!.hp, patient.hp + def.atk)
        unit.cooldown = def.atkIntervalTicks
        state.events.push({
          type: 'unitHealed',
          healerId: unit.id,
          targetId: patient.id,
          amount: patient.hp - before,
        })
      }
      continue
    }

    // 비무장 구조물(바리케이드): 공격 없음
    if (def.atk <= 0) continue

    // 광역 맥동(기름 가마): 사거리 내 모든 적을 동시 타격
    if (def.areaPulse) {
      const victims = state.enemies.filter((e) => {
        if (e.hp <= 0) return false
        const p = enemyWorldPos(ctx, e)
        return Math.hypot(p.x - unit.x, p.y - unit.y) <= def.range
      })
      if (victims.length === 0) continue
      const damages: number[] = []
      for (const v of victims) {
        const dmg = damageVsEnemy(ctx, unit, def.atk, ctx.enemyDefs[v.defId]!.def)
        v.hp -= dmg
        damages.push(dmg)
        if (v.hp <= 0) killEnemy(state, v, unit.id)
      }
      state.events.push({
        type: 'unitAttacked',
        unitId: unit.id,
        unitDefId: def.id,
        targetIds: victims.map((v) => v.id),
        damages,
      })
      unit.cooldown = def.atkIntervalTicks
      state.enemies = state.enemies.filter((e) => e.hp > 0)
      continue
    }

    let target: ActiveEnemy | undefined
    if (def.range <= 0) {
      // 근접: 저지 중인 적 중 첫 번째(저지 시작 순)
      const firstId = unit.blockedEnemyIds[0]
      if (firstId !== undefined) target = state.enemies.find((e) => e.id === firstId)
      if (!target) {
        // 저지 대상이 없으면 자기 칸(반타일 남짓) 안의 적을 직접 공격 —
        // 포격 정지한 공성차처럼 저지가 성립하지 않는 적의 유일한 근접 처치 수단
        let best = Infinity
        for (const e of state.enemies) {
          if (e.hp <= 0) continue
          const p = enemyWorldPos(ctx, e)
          const d = Math.hypot(p.x - unit.x, p.y - unit.y)
          if (d <= MELEE_REACH && d < best) {
            best = d
            target = e
          }
        }
      }
    } else {
      // 원거리: 사거리 내에서 성벽에 가장 가까운 적 (동률이면 먼저 스폰된 적)
      // 같은 틱에 이미 죽은 적(hp<=0, 제거 대기)은 표적에서 제외 — 중복 킬 방지
      let best = Infinity
      for (const e of state.enemies) {
        if (e.hp <= 0) continue
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

    // 광역: 주 표적 주변 aoeRadius 내 모든 적에 동일 피해 (주 표적 포함)
    const victims =
      def.aoeRadius !== undefined
        ? state.enemies.filter((e) => {
            if (e.hp <= 0) return false
            const tp = enemyWorldPos(ctx, target)
            const ep = enemyWorldPos(ctx, e)
            return Math.hypot(ep.x - tp.x, ep.y - tp.y) <= def.aoeRadius!
          })
        : [target]
    let kills = 0
    const damages: number[] = []
    for (const victim of victims) {
      const dmg = damageVsEnemy(ctx, unit, def.atk, ctx.enemyDefs[victim.defId]!.def)
      victim.hp -= dmg
      damages.push(dmg)
      if (victim.hp <= 0) {
        killEnemy(state, victim, unit.id)
        kills++
      }
    }
    unit.attackCount++

    // 자동 기술: n회 공격마다 주 표적 주변 광역 펄스
    const auto = skillOf(ctx, unit, 'auto')?.effect
    if (auto && auto.kind === 'aoePulse' && unit.attackCount % auto.everyNAttacks === 0) {
      const tp = enemyWorldPos(ctx, target)
      for (const e of state.enemies) {
        if (e.hp <= 0) continue
        const p = enemyWorldPos(ctx, e)
        if (Math.hypot(p.x - tp.x, p.y - tp.y) > auto.radius) continue
        e.hp -= damageVsEnemy(ctx, unit, Math.round(def.atk * auto.dmgMul), ctx.enemyDefs[e.defId]!.def)
        if (e.hp <= 0) {
          killEnemy(state, e, unit.id)
          kills++
        }
      }
    }

    // 패시브: 처치 시 코스트 획득
    const passive = skillOf(ctx, unit, 'passive')?.effect
    if (kills > 0 && passive && passive.kind === 'onKillCost') {
      state.cost = Math.min(ctx.stage.costMax, state.cost + passive.amount * kills)
    }

    state.events.push({
      type: 'unitAttacked',
      unitId: unit.id,
      unitDefId: def.id,
      targetIds: victims.map((v) => v.id),
      damages,
    })

    // 액티브 버프(frenzy): 지속 중이면 공격 간격 단축
    const active = skillOf(ctx, unit, 'active')?.effect
    const frenzied =
      active && active.kind === 'frenzy' && unit.activeUntil > state.tick
        ? active.atkSpeedMul
        : 1
    unit.cooldown = Math.max(1, Math.round(def.atkIntervalTicks / frenzied))
  }
  state.enemies = state.enemies.filter((e) => e.hp > 0)
}

function enemiesAttack(ctx: SimContext, state: GameState): void {
  for (const enemy of state.enemies) {
    if (enemy.cooldown > 0) enemy.cooldown--
    if (enemy.cooldown > 0) continue
    const def = ctx.enemyDefs[enemy.defId]!

    // v3: 앞길이 유닛으로 막혀 대기 중인 괴수는 그 유닛을 공격한다
    // (봉쇄는 공짜가 아니다 — 행렬 전체가 방벽을 두들긴다).
    // 우회 중에 스쳐 지나가는 괴수는 공격하지 않는다 (다음 칸이 막힌 경우만).
    if (enemy.blockedBy === null && !enemy.atWall && enemy.route.length > 0) {
      const nextIdx = Math.min(enemy.route.length - 1, Math.floor(enemy.pathPos + 1e-6) + 1)
      const nextCell = enemy.route[nextIdx]!
      const stalled = enemy.pathPos >= nextIdx - 0.6
      const target = stalled
        ? state.units.find(
            (u) =>
              u.x === nextCell.x &&
              u.y === nextCell.y &&
              ctx.unitDefs[u.defId]!.placement !== 'wallTop',
          )
        : undefined
      if (target) {
        const dmg = damage(def.atk, ctx.unitDefs[target.defId]!.def)
        const absorbed = Math.min(target.shield, dmg)
        target.shield -= absorbed
        target.hp -= dmg - absorbed
        enemy.cooldown = def.atkIntervalTicks
        state.events.push({
          type: 'enemyAttacked',
          enemyId: enemy.id,
          targetUnitId: target.id,
          damage: dmg - absorbed,
        })
        if (target.hp <= 0) {
          state.events.push({ type: 'unitDied', unitId: target.id, unitDefId: target.defId })
          releaseBlocked(state, target)
          state.units = state.units.filter((u) => u.id !== target!.id)
          state.redeployReadyAt[target.defId] =
            state.tick + ctx.unitDefs[target.defId]!.redeployTicks
          if (ctx.unitDefs[target.defId]!.placement !== 'wallTop') state.obstacleVersion++
        }
        continue
      }
    }

    if (enemy.blockedBy !== null) {
      const unit = state.units.find((u) => u.id === enemy.blockedBy)
      if (!unit) continue
      const dmg = damage(def.atk, ctx.unitDefs[unit.defId]!.def)
      const absorbed = Math.min(unit.shield, dmg)
      unit.shield -= absorbed
      unit.hp -= dmg - absorbed
      enemy.cooldown = def.atkIntervalTicks
      state.events.push({
        type: 'enemyAttacked',
        enemyId: enemy.id,
        targetUnitId: unit.id,
        damage: dmg - absorbed,
      })
      if (unit.hp <= 0) {
        state.events.push({ type: 'unitDied', unitId: unit.id, unitDefId: unit.defId })
        releaseBlocked(state, unit)
        state.units = state.units.filter((u) => u.id !== unit.id)
        if (ctx.unitDefs[unit.defId]!.placement !== 'wallTop') state.obstacleVersion++
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

  constructor(
    stage: StageDef,
    unitDefs: UnitDef[],
    enemyDefs: EnemyDef[],
    seed?: number,
    startWallHp?: number,
  ) {
    this.ctx = createContext(stage, unitDefs, enemyDefs)
    this.state = createInitialState(this.ctx, seed, startWallHp)
  }

  step(actions: PlayerAction[] = []): GameState {
    return step(this.ctx, this.state, actions)
  }
}
