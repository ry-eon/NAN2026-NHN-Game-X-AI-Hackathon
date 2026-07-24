// 농성전 3D — 새 시뮬레이션 (v5, 처음부터 재설계).
// 기존 그리드 게임과 무관한 연속 공간(XZ 평면) 시뮬이다. 원칙만 계승한다:
//   - 고정 틱(30/s) 결정론: 같은 (시드, 입력 시퀀스) = 같은 결과 → 봇 검증·리플레이
//   - 렌더링 무지: three.js/DOM을 모른다. 헤드리스에서 그대로 돈다.
// 좌표계: x 동(+)서(-), z 남북. 성벽은 x = WALL_X 평면(z 스팬), 괴수는 동쪽에서 온다.

export const TICKS_PER_SECOND = 30
const DT = 1 / TICKS_PER_SECOND

// ---------------------------------------------------------------- 월드 상수 [초안]
export const FIELD = { minX: -34, maxX: 42, minZ: -22, maxZ: 22 }
/** 성벽 평면 x — 이 서쪽이 성 내부 */
export const WALL_X = -6
export const WALL_HP = 2000

/** 성 배치 — sim이 단일 진실 원천 (렌더러·충돌·높이가 공유) */
export const CASTLE = {
  east: WALL_X,
  west: WALL_X - 24,
  north: -18,
  south: 18,
  wallH: 11,
  wallT: 8.0, // 성벽 보도 폭 — 대포 + 병사 2열이 서는 넓이
  gateHalf: 3.2,
}

// ---------------------------------------------------------------- 충돌·높이 지형
interface RectC {
  x0: number
  x1: number
  z0: number
  z1: number
}
const C = CASTLE
const halfT = C.wallT / 2
/** 지상 통행 불가 사각 (동벽은 높이 규칙이 담당, 성문 측면 스트립만 예외 추가) */
const RECT_COLLIDERS: RectC[] = [
  { x0: C.west - halfT, x1: C.west + halfT, z0: C.north, z1: C.south }, // 서벽
  { x0: C.west, x1: C.east, z0: C.north - halfT, z1: C.north + halfT }, // 북벽
  { x0: C.west, x1: C.east, z0: C.south - halfT, z1: C.south + halfT }, // 남벽
  { x0: C.west + 1.5, x1: C.west + 10.5, z0: -6.5, z1: 6.5 }, // 내성
]
/** 망루 (원형) */
const TOWER_COLLIDERS: { x: number; z: number; r: number }[] = [
  // 모서리 망루는 성곽 바깥으로 돌출 (보도·시야를 막지 않는 능보 배치)
  { x: C.east + 2.5, z: C.north - 1.5, r: 4.0 },
  { x: C.east + 2.5, z: C.south + 1.5, r: 4.0 },
  { x: C.west - 2.5, z: C.north - 1.5, r: 4.0 },
  { x: C.west - 2.5, z: C.south + 1.5, r: 4.0 },
]

const inRect = (x: number, z: number, r: RectC): boolean =>
  x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1

function blockedGround(x: number, z: number): boolean {
  for (const r of RECT_COLLIDERS) if (inRect(x, z, r)) return true
  for (const t of TOWER_COLLIDERS) if (Math.hypot(x - t.x, z - t.z) < t.r) return true
  return false
}

/** 성벽 보도·계단 높이. 계단 2기(성문 남북 안쪽 벽면), 보도는 동벽 상단(성문 구간 제외) */
export function heightAt(x: number, z: number): number {
  const stairX0 = C.east - halfT - 2.4
  const stairX1 = C.east - halfT + 0.2 // 계단↔보도 겹침 여유
  // 남측 계단: z 4.5(바닥) → 15(정상)
  if (x >= stairX0 && x <= stairX1 && z >= 4.5 && z <= 15) {
    return (C.wallH * (z - 4.5)) / 10.5
  }
  // 북측 계단: z -4.5(바닥) → -15(정상)
  if (x >= stairX0 && x <= stairX1 && z <= -4.5 && z >= -15) {
    return (C.wallH * (-z - 4.5)) / 10.5
  }
  // 동벽 보도 (성문 상부 구간 제외)
  if (
    x >= C.east - halfT &&
    x <= C.east + halfT &&
    Math.abs(z) >= C.gateHalf &&
    z >= C.north + 0.5 &&
    z <= C.south - 0.5
  ) {
    return C.wallH
  }
  return 0
}

/** 1유닛 격자 BFS — 계단·성문을 경유하는 보행 경로. 결정론(고정 이웃 순서) */
export function findPath(from: Vec2, to: Vec2): Vec2[] | null {
  const res = 1.0
  const W = Math.ceil((FIELD.maxX - FIELD.minX) / res) + 1
  const H = Math.ceil((FIELD.maxZ - FIELD.minZ) / res) + 1
  const toCell = (v: Vec2): [number, number] => [
    Math.round((v.x - FIELD.minX) / res),
    Math.round((v.z - FIELD.minZ) / res),
  ]
  const toWorld = (cx: number, cz: number): Vec2 => ({
    x: FIELD.minX + cx * res,
    z: FIELD.minZ + cz * res,
  })
  const [sx, sz] = toCell(from)
  const [tx, tz] = toCell(to)
  const idx = (cx: number, cz: number): number => cz * W + cx
  const prev = new Int32Array(W * H).fill(-2) // -2 미방문, -1 시작점
  const queue: number[] = [idx(sx, sz)]
  prev[idx(sx, sz)] = -1
  let found = -1
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi]!
    if (cur === idx(tx, tz)) {
      found = cur
      break
    }
    const cx = cur % W
    const cz = Math.floor(cur / W)
    const cw = toWorld(cx, cz)
    for (const [dx, dz] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ] as const) {
      const nx = cx + dx
      const nz = cz + dz
      if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue
      const ni = idx(nx, nz)
      if (prev[ni] !== -2) continue
      const nw = toWorld(nx, nz)
      if (!canStand(cw.x, cw.z, nw.x, nw.z)) continue
      prev[ni] = cur
      queue.push(ni)
    }
  }
  if (found < 0) return null
  const path: Vec2[] = []
  for (let i = found; i >= 0; i = prev[i]!) {
    path.unshift(toWorld(i % W, Math.floor(i / W)))
    if (prev[i] === -1) break
  }
  // 최종 목표점 근사 (같은 높이면 정확 지점으로)
  const last = path[path.length - 1]!
  if (canStand(last.x, last.z, to.x, to.z)) path.push({ ...to })
  return path
}

/**
 * 이동 가능성 판정: 절벽(높이 차 1.5+)과 지상 충돌체를 막는다.
 * 성벽 위 보행·계단·성문 통과는 높이 연속성으로 자연히 허용된다.
 */
export function canStand(fromX: number, fromZ: number, toX: number, toZ: number): boolean {
  const h0 = heightAt(fromX, fromZ)
  const h1 = heightAt(toX, toZ)
  if (Math.abs(h1 - h0) > 1.5) return false
  if (h1 < 1 && blockedGround(toX, toZ)) return false
  return true
}
export const LORD_SPEED = 7.5 // 유닛/초
export const HERO_SPEED = 5.5

export interface Vec2 {
  x: number
  z: number
}

export interface EnemySpawn {
  tick: number
  kind: string
  z: number // 스폰 z (동쪽 가장자리에서 출발)
  wave: number
}

export interface EnemyKindDef {
  kind: string
  name: string
  hp: number
  dmg: number
  atkInterval: number // 초
  speed: number // 유닛/초
  radius: number
  wallDamage: number
}

export const ENEMY_KINDS: Record<string, EnemyKindDef> = {
  grunt: { kind: 'grunt', name: '야귀', hp: 480, dmg: 70, atkInterval: 1.5, speed: 2.4, radius: 0.55, wallDamage: 60 },
  runner: { kind: 'runner', name: '질주귀', hp: 190, dmg: 50, atkInterval: 1.0, speed: 4.6, radius: 0.45, wallDamage: 40 },
  tank: { kind: 'tank', name: '갑주귀', hp: 1400, dmg: 90, atkInterval: 2.0, speed: 1.4, radius: 0.8, wallDamage: 130 },
}

export interface ActiveEnemy {
  id: number
  kind: string
  pos: Vec2
  hp: number
  cooldown: number // 틱
  atWall: boolean
  wave: number
}

export interface LordState {
  pos: Vec2
  /** 향하고 있는 방향 (렌더링용) */
  facing: number
  /** 이동 목표 (우클릭 명령). null = 정지 */
  target: Vec2 | null
  /** 경로 탐색 웨이포인트 (BFS) — 계단 경유 등벽이 여기서 나온다 */
  path: Vec2[]
}

export type SiegeStatus = 'prep' | 'assault' | 'won' | 'lost'

export interface SiegeInput {
  /** 성주 이동 명령 (우클릭 지점) — 명령형 입력이라 리플레이 기록에 적합 */
  moveTo?: Vec2
  /** 준비 종료 → 침공 개시 */
  startAssault?: boolean
}

export interface SiegeState {
  tick: number
  status: SiegeStatus
  wallHp: number
  lord: LordState
  enemies: ActiveEnemy[]
  spawnCursor: number
  nextId: number
  /** 이번 틱 이벤트 (렌더러 소비) */
  events: SiegeEvent[]
}

export type SiegeEvent =
  | { type: 'spawned'; id: number; kind: string; wave: number }
  | { type: 'wallHit'; id: number; damage: number; wallHp: number }
  | { type: 'assaultStarted' }
  | { type: 'won' }
  | { type: 'lost' }

// ---------------------------------------------------------------- 시드 RNG (독립 구현)
export function mulberry32(seed: number) {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000
  }
}

/** 침공 시나리오 — 시드에서 결정론 생성 (후일 파이프라인 생성·검증 대상) */
export function buildSpawnTable(seed: number): EnemySpawn[] {
  const rand = mulberry32(seed)
  const spawns: EnemySpawn[] = []
  const zSpread = () => FIELD.minZ + 2 + rand() * (FIELD.maxZ - FIELD.minZ - 4)
  const sec = (s: number) => Math.round(s * TICKS_PER_SECOND)
  // W1 정찰 6
  for (let i = 0; i < 6; i++) spawns.push({ tick: sec(4 + i * 2.5), kind: 'grunt', z: zSpread(), wave: 1 })
  // W2 양익 속공
  for (let i = 0; i < 7; i++)
    spawns.push({ tick: sec(28 + i * 1.6), kind: i % 2 ? 'runner' : 'grunt', z: zSpread(), wave: 2 })
  // W3 중장 + 무리
  spawns.push({ tick: sec(52), kind: 'tank', z: -4, wave: 3 })
  spawns.push({ tick: sec(55), kind: 'tank', z: 6, wave: 3 })
  for (let i = 0; i < 8; i++) spawns.push({ tick: sec(54 + i * 1.2), kind: 'grunt', z: zSpread(), wave: 3 })
  return spawns.sort((a, b) => a.tick - b.tick)
}

export function createSiege(seed: number): { state: SiegeState; spawns: EnemySpawn[] } {
  return {
    state: {
      tick: 0,
      status: 'prep',
      wallHp: WALL_HP,
      lord: { pos: { x: WALL_X - 9, z: 2 }, facing: 0, target: null, path: [] },
      enemies: [],
      spawnCursor: 0,
      nextId: 1,
      events: [],
    },
    spawns: buildSpawnTable(seed),
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/** 고정 1틱 전진. 결정론 — 입력 외 외부 상태 없음 */
export function stepSiege(state: SiegeState, spawns: EnemySpawn[], input: SiegeInput): SiegeState {
  state.events = []
  if (state.status === 'won' || state.status === 'lost') return state
  state.tick++

  // 성주 이동 (우클릭 명령 → BFS 경로 추종 — 계단·성문 자동 경유)
  if (input.moveTo) {
    const goal = {
      x: clamp(input.moveTo.x, FIELD.minX, FIELD.maxX),
      z: clamp(input.moveTo.z, FIELD.minZ, FIELD.maxZ),
    }
    const path = findPath(state.lord.pos, goal)
    if (path && path.length > 0) {
      state.lord.path = path
      state.lord.target = goal
    }
  }
  if (state.lord.path.length > 0) {
    state.lord.target = state.lord.path[0]!
  }
  if (state.lord.target) {
    const dx = state.lord.target.x - state.lord.pos.x
    const dz = state.lord.target.z - state.lord.pos.z
    const dist = Math.hypot(dx, dz)
    const step = LORD_SPEED * DT
    const { x: px, z: pz } = state.lord.pos
    const nx = dist <= step ? state.lord.target.x : px + (dx / dist) * step
    const nz = dist <= step ? state.lord.target.z : pz + (dz / dist) * step

    if (canStand(px, pz, nx, nz)) {
      state.lord.pos.x = nx
      state.lord.pos.z = nz
    } else if (canStand(px, pz, nx, pz)) {
      state.lord.pos.x = nx // 벽면 슬라이드 (x축만)
    } else if (canStand(px, pz, px, nz)) {
      state.lord.pos.z = nz // 벽면 슬라이드 (z축만)
    } else {
      state.lord.path = []
      state.lord.target = null // 완전 봉착 — 명령 취소
    }
    if (dist > step) state.lord.facing = Math.atan2(dx / dist, dz / dist)
    const t2 = state.lord.target
    if (t2 && Math.hypot(t2.x - state.lord.pos.x, t2.z - state.lord.pos.z) <= step * 1.2) {
      // 웨이포인트 도달 → 다음
      if (state.lord.path.length > 0) state.lord.path.shift()
      state.lord.target = state.lord.path.length > 0 ? state.lord.path[0]! : null
    }
  }

  if (state.status === 'prep') {
    if (input.startAssault) {
      state.status = 'assault'
      state.tick = 0 // 침공 타임라인 기준으로 리셋
      state.events.push({ type: 'assaultStarted' })
    }
    return state
  }

  // 스폰
  while (state.spawnCursor < spawns.length && spawns[state.spawnCursor]!.tick <= state.tick) {
    const s = spawns[state.spawnCursor++]!
    const def = ENEMY_KINDS[s.kind]!
    const e: ActiveEnemy = {
      id: state.nextId++,
      kind: s.kind,
      pos: { x: FIELD.maxX - 1, z: s.z },
      hp: def.hp,
      cooldown: 0,
      atWall: false,
      wave: s.wave,
    }
    state.enemies.push(e)
    state.events.push({ type: 'spawned', id: e.id, kind: e.kind, wave: e.wave })
  }

  // 괴수 이동: 성벽 평면을 향해 직진 (M1 — 조향·회피는 M2에서)
  for (const e of state.enemies) {
    const def = ENEMY_KINDS[e.kind]!
    if (e.cooldown > 0) e.cooldown--
    if (!e.atWall) {
      e.pos.x -= def.speed * DT
      if (e.pos.x <= WALL_X + def.radius + 0.2) {
        e.pos.x = WALL_X + def.radius + 0.2
        e.atWall = true
      }
    } else if (e.cooldown <= 0) {
      state.wallHp -= def.wallDamage
      e.cooldown = Math.round(def.atkInterval * TICKS_PER_SECOND)
      state.events.push({ type: 'wallHit', id: e.id, damage: def.wallDamage, wallHp: Math.max(0, state.wallHp) })
    }
  }

  if (state.wallHp <= 0) {
    state.wallHp = 0
    state.status = 'lost'
    state.events.push({ type: 'lost' })
    return state
  }
  if (state.spawnCursor >= spawns.length && state.enemies.length === 0) {
    state.status = 'won'
    state.events.push({ type: 'won' })
  }
  return state
}
