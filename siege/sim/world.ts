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
      lord: { pos: { x: WALL_X - 9, z: 2 }, facing: 0, target: null },
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

  // 성주 이동 (우클릭 명령 → 목표 지점까지 걸어감. 준비/침공 공통)
  if (input.moveTo) {
    state.lord.target = {
      x: clamp(input.moveTo.x, FIELD.minX, FIELD.maxX),
      z: clamp(input.moveTo.z, FIELD.minZ, FIELD.maxZ),
    }
  }
  if (state.lord.target) {
    const dx = state.lord.target.x - state.lord.pos.x
    const dz = state.lord.target.z - state.lord.pos.z
    const dist = Math.hypot(dx, dz)
    const step = LORD_SPEED * DT
    if (dist <= step) {
      state.lord.pos = { ...state.lord.target }
      state.lord.target = null
    } else {
      state.lord.pos.x += (dx / dist) * step
      state.lord.pos.z += (dz / dist) * step
      state.lord.facing = Math.atan2(dx / dist, dz / dist)
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
