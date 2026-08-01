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
  // 북/남벽은 동/서벽 두께 끝까지 — 렌더의 모서리 연장과 일치
  { x0: C.west - halfT, x1: C.east + halfT, z0: C.north - halfT, z1: C.north + halfT }, // 북벽
  { x0: C.west - halfT, x1: C.east + halfT, z0: C.south - halfT, z1: C.south + halfT }, // 남벽
  { x0: C.west + 1.5, x1: C.west + 10.5, z0: -6.5, z1: 6.5 }, // 내성
]
/** 망루 (원형) */
const TOWER_COLLIDERS: { x: number; z: number; r: number }[] = [
  // 동쪽 망루는 제거(보도 시야) — 서쪽 실루엣 망루만
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

/** 보도 바깥쪽 흉벽(파라펫+성가퀴) 점유 폭 — 렌더의 립 1.1 + 유닛 여유.
 *  이 띠는 돌벽 그 자체라 설 수 없다 (빈 배열 = 통행 불가) */
const PARAPET_KEEPOUT = 1.3

/**
 * 해당 지점에서 설 수 있는 높이 후보들. 빈 배열 = 어느 층에도 설 수 없음(벽체).
 * 성문 위는 2층: 보도(11) + 아래 터널(0) — 보도가 성문 위로 끊김 없이 이어지면서
 * 성문 통행도 유지된다. 이동은 현재 높이에서 가장 가까운 후보로 연속 전이.
 * 보도의 바깥 가장자리(흉벽 띠)는 제외 — 유닛이 성가퀴 돌 속에 서지 않게.
 */
export function heightLevels(x: number, z: number): number[] {
  const stairX0 = C.east - halfT - 2.4
  const stairX1 = C.east - halfT + 0.2 // 계단↔보도 겹침 여유
  // 남측 계단: z 4.5(바닥) → 15(정상)
  if (x >= stairX0 && x <= stairX1 && z >= 4.5 && z <= 15) {
    return [(C.wallH * (z - 4.5)) / 10.5]
  }
  // 북측 계단
  if (x >= stairX0 && x <= stairX1 && z <= -4.5 && z >= -15) {
    return [(C.wallH * (-z - 4.5)) / 10.5]
  }
  // 내성 몸체가 서벽 보도에 파고드는 구간 — 보도·지상 모두 통행 불가 (지상은 콜라이더가 차단)
  if (x >= C.west + 1.5 && x <= C.west + 10.5 && z >= -6.5 && z <= 6.5) return [0]
  // 흉벽 띠 경계 (보도에서 설 수 있는 한계선)
  const walkE = C.east + halfT - PARAPET_KEEPOUT // 동벽 바깥(+x) 한계
  const walkW = C.west - halfT + PARAPET_KEEPOUT // 서벽 바깥(-x) 한계
  const inZSpan = z >= C.north - halfT && z <= C.south + halfT
  // 모서리 포함 북/남 바깥 z 띠 (밴드 공통 제외선)
  const outerZ = z < C.north - halfT + PARAPET_KEEPOUT || z > C.south + halfT - PARAPET_KEEPOUT
  // 동벽 밴드
  if (x >= C.east - halfT && x <= C.east + halfT && inZSpan) {
    if (Math.abs(z) < C.gateHalf) {
      // 성문 폭: 터널(0)은 벽 두께 전체 통행, 위 다리는 흉벽 안쪽까지만
      return x > walkE ? [0] : [C.wallH, 0]
    }
    return x > walkE || outerZ ? [] : [C.wallH]
  }
  // 서벽 밴드
  if (x >= C.west - halfT && x <= C.west + halfT && inZSpan) {
    return x < walkW || outerZ ? [] : [C.wallH]
  }
  // 북/남벽 밴드 — 바깥쪽 z 가장자리 + 모서리 캡(동/서 바깥 x 띠) 제외
  const onNorth = Math.abs(z - C.north) <= halfT
  const onSouth = Math.abs(z - C.south) <= halfT
  if (x >= C.west - halfT && x <= C.east + halfT && (onNorth || onSouth)) {
    if (x > walkE || x < walkW) return []
    if (onNorth && z < C.north - halfT + PARAPET_KEEPOUT) return []
    if (onSouth && z > C.south + halfT - PARAPET_KEEPOUT) return []
    return [C.wallH]
  }
  return [0]
}

/** 렌더러 참고용 단일 높이 (기준 높이에서 가장 가까운 층) */
export function heightNear(x: number, z: number, refH: number): number {
  const levels = heightLevels(x, z)
  if (levels.length === 0) return refH
  let best = levels[0]!
  for (const h of levels) if (Math.abs(h - refH) < Math.abs(best - refH)) best = h
  return best
}

/** 1유닛 격자 BFS (층 확장) — 계단·성문·성문 위 보도를 경유. 결정론(고정 이웃 순서) */
export function findPath(from: Vec2, to: Vec2, fromH = 0, toHint = 0): Vec2[] | null {
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
  // 노드 = 셀 × 층 (0층/상층) — 성문 위 보도와 아래 터널을 구분
  const lvlOf = (h: number): number => (h > 5 ? 1 : 0)
  const key = (cx: number, cz: number, lvl: number): number => (cz * W + cx) * 2 + lvl
  const prev = new Int32Array(W * H * 2).fill(-2)
  const nodeH = new Float32Array(W * H * 2)
  const startKey = key(sx, sz, lvlOf(fromH))
  prev[startKey] = -1
  nodeH[startKey] = fromH
  const queue: number[] = [startKey]
  const targetKeyPreferred = key(tx, tz, lvlOf(toHint))
  let found = -1
  let foundAny = -1
  let nearBest = -1 // 목표 셀이 벽체(설 수 없음)일 때: 가장 가까운 도달 가능 셀 (RTS 관례)
  let nearDist = Infinity
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi]!
    const cell = Math.floor(cur / 2)
    const cx = cell % W
    const cz = Math.floor(cell / W)
    if (cur === targetKeyPreferred) {
      found = cur
      break
    }
    if (cx === tx && cz === tz && foundAny < 0) foundAny = cur
    const dCell = Math.abs(cx - tx) + Math.abs(cz - tz)
    if (dCell < nearDist) {
      nearDist = dCell
      nearBest = cur
    }
    const curH = nodeH[cur]!
    for (const [dx, dz] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ] as const) {
      const nx = cx + dx
      const nz = cz + dz
      if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue
      const nw = toWorld(nx, nz)
      for (const cand of heightLevels(nw.x, nw.z)) {
        if (Math.abs(cand - curH) > 1.5) continue
        if (cand < 1 && blockedGround(nw.x, nw.z)) continue
        const nk = key(nx, nz, lvlOf(cand))
        if (prev[nk] !== -2) continue
        prev[nk] = cur
        nodeH[nk] = cand
        queue.push(nk)
      }
    }
  }
  const goal = found >= 0 ? found : foundAny >= 0 ? foundAny : nearDist <= 8 ? nearBest : -1
  if (goal < 0) return null
  const path: Vec2[] = []
  for (let i = goal; i >= 0; i = prev[i]!) {
    const cell = Math.floor(i / 2)
    path.unshift(toWorld(cell % W, Math.floor(cell / W)))
    if (prev[i] === -1) break
  }
  const last = path[path.length - 1]!
  if (stepHeight(nodeH[goal]!, to.x, to.z) !== null && Math.hypot(last.x - to.x, last.z - to.z) < 1.5) {
    path.push({ ...to })
  }
  return path
}

/**
 * 층 인지 전이 판정: 현재 높이(fromH)에서 도착점의 후보 층 중 연속(Δ1.5 이내)인
 * 높이를 반환. 불가하면 null. 절벽·지상 충돌 차단.
 */
export function stepHeight(fromH: number, toX: number, toZ: number): number | null {
  let best: number | null = null
  for (const h of heightLevels(toX, toZ)) {
    if (Math.abs(h - fromH) > 1.5) continue
    if (h < 1 && blockedGround(toX, toZ)) continue
    if (best === null || Math.abs(h - fromH) < Math.abs(best - fromH)) best = h
  }
  return best
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
  grunt: { kind: 'grunt', name: '야귀', hp: 660, dmg: 70, atkInterval: 1.5, speed: 2.4, radius: 0.55, wallDamage: 60 },
  runner: { kind: 'runner', name: '질주귀', hp: 300, dmg: 50, atkInterval: 1.0, speed: 4.6, radius: 0.45, wallDamage: 40 },
  tank: { kind: 'tank', name: '갑주귀', hp: 2050, dmg: 90, atkInterval: 2.0, speed: 1.4, radius: 0.8, wallDamage: 130 },
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

// ---------------------------------------------------------------- 아군 유닛 (M2b)
export interface UnitKindDef {
  kind: string
  name: string
  hp: number
  dmg: number
  atkInterval: number // 초
  range: number // 사거리 (XZ 평면)
  speed: number // 유닛/초
  radius: number
  /** 폭발 반경 — 지정 시 착탄점 주변 광역 피해 (대포) */
  aoe?: number
}

export const UNIT_KINDS: Record<string, UnitKindDef> = {
  soldier: { kind: 'soldier', name: '궁수', hp: 260, dmg: 33, atkInterval: 1.3, range: 14, speed: 3.5, radius: 0.4 },
  ballista: { kind: 'ballista', name: '발리스타', hp: 420, dmg: 200, atkInterval: 2.8, range: 21, speed: 1.2, radius: 0.8 },
  cannon: { kind: 'cannon', name: '대포', hp: 500, dmg: 140, atkInterval: 3.8, range: 24, speed: 1.0, radius: 0.9, aoe: 2.8 },
  hero: { kind: 'hero', name: '영웅', hp: 900, dmg: 110, atkInterval: 0.9, range: 13, speed: HERO_SPEED, radius: 0.5 },
}

export interface FriendlyUnit {
  id: number
  kind: string
  pos: Vec2
  h: number
  hp: number
  facing: number
  target: Vec2 | null
  path: Vec2[]
  cooldown: number // 틱
  /** 영웅 전용 — 스킬 남은 쿨다운 (틱) */
  skillCd: number
}

/** 영웅 스킬 「업화」 — 지점 지정 광역 화염. 조준(자동/수동)은 클라이언트 보조,
 *  sim은 커맨드(지점)만 받아 사거리·쿨다운을 검증한다 = 리플레이 가능 */
export const HERO_SKILL = { name: '업화', dmg: 500, radius: 4.5, range: 18, cooldown: 14 /* 초 */ }

export interface LordState {
  pos: Vec2
  /** 향하고 있는 방향 (렌더링용) */
  facing: number
  /** 이동 목표 (우클릭 명령). null = 정지 */
  target: Vec2 | null
  /** 경로 탐색 웨이포인트 (BFS) — 계단 경유 등벽이 여기서 나온다 */
  path: Vec2[]
  /** 현재 서 있는 높이 (2층 구조 대응 — 성문 위 보도 vs 아래 터널) */
  h: number
}

export type SiegeStatus = 'prep' | 'assault' | 'won' | 'lost'

export interface SiegeInput {
  /** 성주 이동 명령 (우클릭 지점 + 클릭한 면의 높이 힌트 — 보도 위 vs 터널 구분) */
  moveTo?: Vec2 & { h?: number }
  /** 부대 이동 명령 (스타크래프트식 선택 → 우클릭). 대형은 sim이 결정론으로 분산 */
  unitMove?: { ids: number[]; to: Vec2 & { h?: number } }
  /** 영웅 스킬 시전 지점 — 사거리·쿨다운은 sim이 검증. heroId 생략 시 첫 영웅 (다영웅 대비) */
  heroSkill?: Vec2 & { heroId?: number }
  /** 준비 종료 → 침공 개시 */
  startAssault?: boolean
}

export interface SiegeState {
  tick: number
  status: SiegeStatus
  wallHp: number
  /** 성벽 최대치 — 로드아웃마다 다를 수 있으므로 state가 들고 있는다 (HUD 게이지 기준) */
  wallHpMax: number
  /** 이 판의 유닛·몬스터 정의 (로드아웃 주입) — sim도 렌더러도 모듈 상수가 아니라 이걸 본다 */
  kinds: { units: Record<string, UnitKindDef>; enemies: Record<string, EnemyKindDef> }
  /** 로드아웃 이름 (리포트·디버그 표시용) */
  loadout: string
  lord: LordState
  units: FriendlyUnit[]
  enemies: ActiveEnemy[]
  spawnCursor: number
  nextId: number
  /** 이번 틱 이벤트 (렌더러 소비) */
  events: SiegeEvent[]
}

export type SiegeEvent =
  | { type: 'spawned'; id: number; kind: string; wave: number }
  | { type: 'wallHit'; id: number; damage: number; wallHp: number }
  | { type: 'unitFired'; unitId: number; unitKind: string; targetId: number; from: Vec2 & { h: number }; to: Vec2 }
  | { type: 'heroSkillCast'; x: number; z: number }
  | { type: 'meleeHit'; enemyId: number; unitId: number }
  | { type: 'enemyDied'; id: number; kind: string; pos: Vec2 }
  | { type: 'unitDied'; id: number; kind: string; pos: Vec2 }
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

// ---------------------------------------------------------------- 로드아웃 (콘텐츠 데이터)
//
// 유닛 정의·몬스터 정의·초기 배치·웨이브 구성을 sim 로직에서 떼어낸 데이터 묶음.
// 로직을 건드리지 않고 "대포를 늘려본다 / 유닛을 하나 추가한다 / 웨이브를 바꾼다"를 할 수 있어야
// 기획을 빠르게 시험하고, 그 결과를 봇 검증(`pnpm verify`)이 바로 판정해준다.
//
// 규칙: sim 내부는 모듈 상수(UNIT_KINDS/ENEMY_KINDS)를 직접 보지 않고 **state.kinds**를 본다.
// 그래야 한 프로세스에서 서로 다른 로드아웃을 동시에 돌려 비교할 수 있다(봇 스윕이 그렇게 돈다).

/** 초기 배치 한 자리 */
export interface UnitPlacement {
  kind: string
  x: number
  z: number
  h: number
}

/** 웨이브 한 덩어리 — `count`기를 `at`초부터 `every`초 간격으로 */
export interface WaveDef {
  wave: number
  kind: string
  count: number
  at: number // 초
  every?: number // 초 간격 (기본 0 = 동시)
  /** z 배치: 숫자면 고정, 생략하면 시드 기반 산개 */
  z?: number
  /** 짝수번째만 다른 종류로 (양익 속공처럼 섞을 때) */
  altKind?: string
}

export interface Loadout {
  name: string
  wallHp: number
  unitKinds: Record<string, UnitKindDef>
  enemyKinds: Record<string, EnemyKindDef>
  placements: UnitPlacement[]
  waves: WaveDef[]
}

/** 현재 출고 중인 구성 — 동벽 보도(궁수 6·대포 2), 성문 위 다리(발리스타 2), 지상(영웅 1) */
export const DEFAULT_LOADOUT: Loadout = {
  name: 'default',
  wallHp: WALL_HP,
  unitKinds: UNIT_KINDS,
  enemyKinds: ENEMY_KINDS,
  placements: [
    ...[-15, -9, -5, 5, 9, 15].map((z) => ({ kind: 'soldier', x: WALL_X, z, h: C.wallH })),
    { kind: 'cannon', x: WALL_X, z: -12, h: C.wallH },
    { kind: 'cannon', x: WALL_X, z: 12, h: C.wallH },
    { kind: 'ballista', x: WALL_X, z: -1.6, h: C.wallH }, // 성문 위 다리
    { kind: 'ballista', x: WALL_X, z: 1.6, h: C.wallH },
    { kind: 'hero', x: WALL_X - 6, z: 0, h: 0 }, // 성문 안쪽 지상 — 출격 가능
  ],
  waves: [
    { wave: 1, kind: 'grunt', count: 6, at: 4, every: 2.5 }, // 정찰
    { wave: 2, kind: 'grunt', altKind: 'runner', count: 7, at: 28, every: 1.6 }, // 양익 속공
    { wave: 3, kind: 'tank', count: 1, at: 52, z: -4 }, // 중장
    { wave: 3, kind: 'tank', count: 1, at: 55, z: 6 },
    { wave: 3, kind: 'grunt', count: 8, at: 54, every: 1.2 }, // 무리
  ],
}

/** 침공 시나리오 — 로드아웃의 웨이브 정의 + 시드로 결정론 생성 */
export function buildSpawnTable(seed: number, waves: WaveDef[] = DEFAULT_LOADOUT.waves): EnemySpawn[] {
  const rand = mulberry32(seed)
  const spawns: EnemySpawn[] = []
  const zSpread = (): number => FIELD.minZ + 2 + rand() * (FIELD.maxZ - FIELD.minZ - 4)
  const sec = (s: number): number => Math.round(s * TICKS_PER_SECOND)
  for (const w of waves) {
    for (let i = 0; i < w.count; i++) {
      const kind = w.altKind && i % 2 ? w.altKind : w.kind
      spawns.push({
        tick: sec(w.at + i * (w.every ?? 0)),
        kind,
        z: w.z ?? zSpread(),
        wave: w.wave,
      })
    }
  }
  return spawns.sort((a, b) => a.tick - b.tick)
}

/** 초기 배치를 실제 유닛으로 — 재배치는 부대 명령으로 */
function initialUnits(loadout: Loadout, nextId: () => number): FriendlyUnit[] {
  return loadout.placements.map((p) => ({
    id: nextId(),
    kind: p.kind,
    pos: { x: p.x, z: p.z },
    h: p.h,
    hp: loadout.unitKinds[p.kind]!.hp,
    facing: Math.PI / 2, // 동쪽(적 방향)을 본다
    target: null,
    path: [],
    cooldown: 0,
    skillCd: 0,
  }))
}

export function createSiege(
  seed: number,
  loadout: Loadout = DEFAULT_LOADOUT,
): { state: SiegeState; spawns: EnemySpawn[] } {
  let id = 1
  const units = initialUnits(loadout, () => id++)
  return {
    state: {
      tick: 0,
      status: 'prep',
      wallHp: loadout.wallHp,
      wallHpMax: loadout.wallHp,
      kinds: { units: loadout.unitKinds, enemies: loadout.enemyKinds },
      loadout: loadout.name,
      lord: { pos: { x: WALL_X - 9, z: 2 }, facing: 0, target: null, path: [], h: 0 },
      units,
      enemies: [],
      spawnCursor: 0,
      nextId: id,
      events: [],
    },
    spawns: buildSpawnTable(seed, loadout.waves),
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/** 이동체 공통 형상 — 성주·아군 유닛이 같은 이동 규칙(BFS 추종 + 층 전이 + 벽 슬라이드)을 공유 */
interface Mover {
  pos: Vec2
  h: number
  facing: number
  target: Vec2 | null
  path: Vec2[]
}

/** 이동 명령: BFS 경로를 세팅. 경로가 없으면 명령 무시 (제자리) */
function commandMove(m: Mover, to: Vec2, hHint: number): void {
  const goal = {
    x: clamp(to.x, FIELD.minX, FIELD.maxX),
    z: clamp(to.z, FIELD.minZ, FIELD.maxZ),
  }
  const path = findPath(m.pos, goal, m.h, hHint)
  if (path && path.length > 0) {
    m.path = path
    m.target = goal
  }
}

/** 1틱 이동 — 웨이포인트 추종. 층 전이 불가 시 벽면 슬라이드, 완전 봉착 시 명령 취소 */
function stepMover(m: Mover, speed: number): void {
  if (m.path.length > 0) m.target = m.path[0]!
  if (!m.target) return
  const dx = m.target.x - m.pos.x
  const dz = m.target.z - m.pos.z
  const dist = Math.hypot(dx, dz)
  const step = speed * DT
  const { x: px, z: pz } = m.pos
  const nx = dist <= step ? m.target.x : px + (dx / dist) * step
  const nz = dist <= step ? m.target.z : pz + (dz / dist) * step

  const h1 = stepHeight(m.h, nx, nz)
  const h2 = h1 === null ? stepHeight(m.h, nx, pz) : null
  const h3 = h1 === null && h2 === null ? stepHeight(m.h, px, nz) : null
  if (h1 !== null) {
    m.pos.x = nx
    m.pos.z = nz
    m.h = h1
  } else if (h2 !== null) {
    m.pos.x = nx // 벽면 슬라이드 (x축만)
    m.h = h2
  } else if (h3 !== null) {
    m.pos.z = nz // 벽면 슬라이드 (z축만)
    m.h = h3
  } else {
    m.path = []
    m.target = null // 완전 봉착 — 명령 취소
    return
  }
  if (dist > step) m.facing = Math.atan2(dx / dist, dz / dist)
  const t2 = m.target
  if (t2 && Math.hypot(t2.x - m.pos.x, t2.z - m.pos.z) <= step * 1.2) {
    // 웨이포인트 도달 → 다음
    if (m.path.length > 0) m.path.shift()
    m.target = m.path.length > 0 ? m.path[0]! : null
  }
}

/** 부대 대형 오프셋 — 목표점 주변 결정론 격자 분산 (선택 순서 무관: id 정렬 후 배정).
 *  간격 1.8 = 최대 유닛(대포 r0.9) 2기가 겹치지 않는 거리 */
const FORMATION: [number, number][] = [
  [0, 0], [1.8, 0], [-1.8, 0], [0, 1.8], [0, -1.8],
  [1.8, 1.8], [-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8],
  [3.6, 0], [-3.6, 0], [0, 3.6], [0, -3.6],
]

/** 사거리 내 최근접 적 (동거리 → 낮은 id — 결정론) */
function acquireTarget(u: FriendlyUnit, enemies: ActiveEnemy[], range: number): ActiveEnemy | null {
  let best: ActiveEnemy | null = null
  let bestD = Infinity
  for (const e of enemies) {
    const d = Math.hypot(e.pos.x - u.pos.x, e.pos.z - u.pos.z)
    if (d <= range && (d < bestD || (d === bestD && best !== null && e.id < best.id))) {
      best = e
      bestD = d
    }
  }
  return best
}

/** 고정 1틱 전진. 결정론 — 입력 외 외부 상태 없음 */
export function stepSiege(state: SiegeState, spawns: EnemySpawn[], input: SiegeInput): SiegeState {
  state.events = []
  if (state.status === 'won' || state.status === 'lost') return state
  state.tick++

  // 성주 이동 (우클릭 명령 → BFS 경로 추종 — 계단·성문 자동 경유)
  if (input.moveTo) commandMove(state.lord, input.moveTo, input.moveTo.h ?? 0)
  stepMover(state.lord, LORD_SPEED)

  // 부대 이동 명령 — id 정렬 후 대형 오프셋 배정 (결정론)
  if (input.unitMove) {
    const ids = [...input.unitMove.ids].sort((a, b) => a - b)
    const to = input.unitMove.to
    let slot = 0
    for (const id of ids) {
      const u = state.units.find((v) => v.id === id)
      if (!u) continue
      const off = FORMATION[Math.min(slot, FORMATION.length - 1)]!
      commandMove(u, { x: to.x + off[0], z: to.z + off[1] }, to.h ?? 0)
      slot++
    }
  }
  for (const u of state.units) {
    if (u.skillCd > 0) u.skillCd--
    stepMover(u, state.kinds.units[u.kind]!.speed)
  }

  // 영웅 스킬 「업화」 — 지점 광역. 사거리 밖·쿨다운 중이면 무시 (결정론 검증)
  if (input.heroSkill) {
    const wantId = input.heroSkill.heroId
    const hero = state.units.find((u) => u.kind === 'hero' && (wantId === undefined || u.id === wantId))
    if (hero && hero.skillCd <= 0) {
      const d = Math.hypot(input.heroSkill.x - hero.pos.x, input.heroSkill.z - hero.pos.z)
      if (d <= HERO_SKILL.range) {
        hero.skillCd = Math.round(HERO_SKILL.cooldown * TICKS_PER_SECOND)
        hero.facing = Math.atan2(input.heroSkill.x - hero.pos.x, input.heroSkill.z - hero.pos.z)
        for (const e of state.enemies) {
          if (Math.hypot(e.pos.x - input.heroSkill.x, e.pos.z - input.heroSkill.z) <= HERO_SKILL.radius)
            e.hp -= HERO_SKILL.dmg
        }
        state.events.push({ type: 'heroSkillCast', x: input.heroSkill.x, z: input.heroSkill.z })
      }
    }
  }

  // 유닛 간 겹침 분리 (같은 층만, 층 이탈 금지 — 성벽에서 밀려 떨어지지 않게)
  for (let i = 0; i < state.units.length; i++) {
    for (let j = i + 1; j < state.units.length; j++) {
      const a = state.units[i]!
      const b = state.units[j]!
      if (Math.abs(a.h - b.h) > 1.5) continue
      const minD = state.kinds.units[a.kind]!.radius + state.kinds.units[b.kind]!.radius + 0.15
      let dx = b.pos.x - a.pos.x
      let dz = b.pos.z - a.pos.z
      let d = Math.hypot(dx, dz)
      if (d >= minD) continue
      if (d < 1e-4) {
        dx = 1 // 완전 겹침 — 결정론 축 분리
        dz = 0
        d = 1
      }
      const push = (minD - d) * 0.4
      for (const [m, sign] of [[a, -1], [b, 1]] as const) {
        const nx = m.pos.x + (dx / d) * push * sign
        const nz = m.pos.z + (dz / d) * push * sign
        const h = stepHeight(m.h, nx, nz)
        if (h !== null) {
          m.pos.x = nx
          m.pos.z = nz
          m.h = h
        }
      }
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
    const def = state.kinds.enemies[s.kind]!
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

  // 아군 사격 — 정지 상태에서만 (이동 중 발사 불가). 히트스캔: 피해는 즉시, 투사체는 연출
  for (const u of state.units) {
    if (u.cooldown > 0) u.cooldown--
    if (u.path.length > 0 || u.cooldown > 0) continue
    const def = state.kinds.units[u.kind]!
    const tgt = acquireTarget(u, state.enemies, def.range)
    if (!tgt) continue
    u.facing = Math.atan2(tgt.pos.x - u.pos.x, tgt.pos.z - u.pos.z)
    u.cooldown = Math.round(def.atkInterval * TICKS_PER_SECOND)
    if (def.aoe) {
      for (const e of state.enemies) {
        if (Math.hypot(e.pos.x - tgt.pos.x, e.pos.z - tgt.pos.z) <= def.aoe) e.hp -= def.dmg
      }
    } else {
      tgt.hp -= def.dmg
    }
    state.events.push({
      type: 'unitFired',
      unitId: u.id,
      unitKind: u.kind,
      targetId: tgt.id,
      from: { x: u.pos.x, z: u.pos.z, h: u.h },
      to: { x: tgt.pos.x, z: tgt.pos.z },
    })
  }

  // 괴수: 지상 아군과 접전 > 성벽 공격 > 성벽으로 직진
  for (const e of state.enemies) {
    const def = state.kinds.enemies[e.kind]!
    if (e.cooldown > 0) e.cooldown--
    // 접전 판정 — 지상(h<1) 아군만 (보도 위는 닿지 못한다)
    let victim: FriendlyUnit | null = null
    let victimD = Infinity
    for (const u of state.units) {
      if (u.h >= 1) continue
      const d = Math.hypot(u.pos.x - e.pos.x, u.pos.z - e.pos.z)
      const engage = def.radius + state.kinds.units[u.kind]!.radius + 0.9
      if (d <= engage && d < victimD) {
        victim = u
        victimD = d
      }
    }
    if (victim) {
      if (e.cooldown <= 0) {
        victim.hp -= def.dmg
        e.cooldown = Math.round(def.atkInterval * TICKS_PER_SECOND)
        state.events.push({ type: 'meleeHit', enemyId: e.id, unitId: victim.id })
      }
    } else if (!e.atWall) {
      e.pos.x -= def.speed * DT
      // 성벽 "바깥 면"에서 정지 — WALL_X는 벽 중심선이라 두께 절반을 더한다
      // (벽 속으로 파고들어 보이지 않는 채 공격하던 문제)
      const wallFace = WALL_X + C.wallT / 2 + def.radius + 0.2
      if (e.pos.x <= wallFace) {
        e.pos.x = wallFace
        e.atWall = true
      }
    } else if (e.cooldown <= 0) {
      state.wallHp -= def.wallDamage
      e.cooldown = Math.round(def.atkInterval * TICKS_PER_SECOND)
      state.events.push({ type: 'wallHit', id: e.id, damage: def.wallDamage, wallHp: Math.max(0, state.wallHp) })
    }
  }

  // 사망 처리
  state.enemies = state.enemies.filter((e) => {
    if (e.hp > 0) return true
    state.events.push({ type: 'enemyDied', id: e.id, kind: e.kind, pos: { ...e.pos } })
    return false
  })
  state.units = state.units.filter((u) => {
    if (u.hp > 0) return true
    state.events.push({ type: 'unitDied', id: u.id, kind: u.kind, pos: { ...u.pos } })
    return false
  })

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
