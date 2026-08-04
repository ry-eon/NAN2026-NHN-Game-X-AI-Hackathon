// 농성전 3D — 새 시뮬레이션 (v5, 처음부터 재설계).
// 기존 그리드 게임과 무관한 연속 공간(XZ 평면) 시뮬이다. 원칙만 계승한다:
//   - 고정 틱(30/s) 결정론: 같은 (시드, 입력 시퀀스) = 같은 결과 → 봇 검증·리플레이
//   - 렌더링 무지: three.js/DOM을 모른다. 헤드리스에서 그대로 돈다.
// 좌표계: x 동(+)서(-), z 남북. 성벽은 x = WALL_X 평면(z 스팬), 괴수는 동쪽에서 온다.

export const TICKS_PER_SECOND = 30
const DT = 1 / TICKS_PER_SECOND

// ---------------------------------------------------------------- 월드 상수 [초안]
// z 폭은 성벽(±18)보다 넓어야 한다 — 모서리를 돌아 북/남벽을 치는 회절 레인의 통로.
export const FIELD = { minX: -34, maxX: 42, minZ: -30, maxZ: 30 }
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
  /** 위협 회피 성향 — 0이면 화망을 무시하고 온다, 클수록 빈 구간으로 흐른다 */
  threatAvoidance: number
  /** 모서리 회절 레인(북/남벽) 선호도 — 1이 동벽 정면과 동등, 0이면 절대 안 돈다 */
  flankBias: number
  /** 벽에 붙지 않고 이만큼 떨어져 멈춘다 (보스처럼 뒤에서 지휘하는 개체) */
  standoff?: number
  /** 부활술 — 지정 시 쿨마다 반경 안의 시체를 되살린다 (네크로맨서) */
  raise?: { cooldown: number /* 초 */; radius: number; count: number; hpRatio: number }
}

// 언데드 군세 — 네크로맨서가 일으킨 것들 (기획 확정 2026-08-04, docs/02-game-design.md §4-2)
export const ENEMY_KINDS: Record<string, EnemyKindDef> = {
  // 되살아난 병사 — 생전의 기억으로 화망을 제대로 피한다. 유도가 가장 잘 먹히는 표준 개체
  grunt: {
    kind: 'grunt', name: '야귀', hp: 660, dmg: 70, atkInterval: 1.5, speed: 2.4, radius: 0.55,
    wallDamage: 21, threatAvoidance: 1.0, flankBias: 0.25,
  },
  // 되살린 짐승 — 겁이 많아 회피 폭이 크고, 크게 돌아 모서리로 파고든다
  runner: {
    kind: 'runner', name: '질주귀', hp: 300, dmg: 50, atkInterval: 1.0, speed: 4.6, radius: 0.45,
    wallDamage: 14, threatAvoidance: 1.6, flankBias: 0.9,
  },
  // 속이 빈 판금 갑옷 — 두려움이 없다. 화망을 무시하고 정면으로 밀고 온다
  tank: {
    kind: 'tank', name: '갑주귀', hp: 2050, dmg: 90, atkInterval: 2.0, speed: 1.4, radius: 0.8,
    wallDamage: 46, threatAvoidance: 0, flankBias: 0.05,
  },
  // 이 군세를 일으킨 자. 뒤에 서서 쓰러진 것들을 다시 세운다 — 직접 공격은 약하다.
  // 킬존에서 잡은 것들이 계속 일어나므로 "먼저 이 자를 끊는다"는 판단이 생긴다.
  // 수치는 후보 13종을 봇으로 돌려 고른 것. 더 세게(hp3200·쿨7×3기·0.55) 두면 무개입이
  // 무너진다 — 자동 조준은 가까운 적부터 치므로 뒤에 선 술사를 영영 못 끊기 때문이다.
  necromancer: {
    kind: 'necromancer', name: '네크로맨서', hp: 2000, dmg: 30, atkInterval: 3.0, speed: 1.1,
    radius: 0.9, wallDamage: 12, threatAvoidance: 2.2, flankBias: 0.15,
    standoff: 6, // 벽에 붙지 않되 성벽 화력 안에는 들어온다 — 무개입으로도 끊을 수 있어야 한다
    raise: { cooldown: 8, radius: 13, count: 2, hpRatio: 0.4 },
  },
}
// 개체당 벽 피해는 2026-08-04에 크게 낮췄다(60/40/130 → 21/14/46). 대신 수를 34 → 62로 늘렸다.
// 이유는 절벽이다: 성벽 HP가 공유 풀이라 벽에 붙은 수가 임계를 넘으면 초당 800+ 피해로
// 한순간에 무너졌고, 그래서 웨이브를 조금만 올려도 판정이 통째로 뒤집혔다(51기 4/6 → 61기 0/6).
// 개체를 약하게·수를 많게 바꾸자 성벽이 완만하게 깎여 플레이어가 판단할 시간이 생겼고,
// 그제서야 "일부러 한 구간을 비우는" 유도 도박이 성립한다.

export interface ActiveEnemy {
  id: number
  kind: string
  pos: Vec2
  hp: number
  cooldown: number // 틱
  atWall: boolean
  wave: number
  /** 목표 접근 구간 id — 스폰 시 한 번 정해지고 이후 불변 (지연 규칙, §4-2) */
  seg: number
  /** 최종 정지 지점 = 벽 바깥 면 + 자기 반경 */
  aim: Vec2
  /** 회절 레인 경유점 (성 동쪽 바깥). 통과하면 null이 되고 aim으로 향한다 */
  via: Vec2 | null
  /** 부활술 남은 쿨다운 (틱). 부활술이 없는 종류는 항상 0 */
  raiseCd: number
}

/** 쓰러진 자리 — 네크로맨서가 다시 세울 수 있는 대상. 되살아나면 소모된다 */
export interface Corpse {
  kind: string
  pos: Vec2
  /** 이 틱이 지나면 삭는다 (무한히 쌓여 후반에 몰아서 부활하는 걸 막는다) */
  rotAt: number
}

// ---------------------------------------------------------------- 접근 구간 (침공 설계)
//
// 「위협 회피 유도」— 괴수는 스폰 시 목표 구간을 하나 고르고, 그 뒤로는 바꾸지 않는다.
// 구간 선택은 **성벽 위 유닛의 화력만** 위협으로 센다(가시성 규칙). 안뜰·성문 안쪽의
// 지상 병력과 영웅은 계산에서 빠지므로, 플레이어가 화망을 한쪽에 몰아 비워둔 구간은
// 괴수 눈에 "무방비"로 보인다 — 그게 킬존이 성립하는 이유다.
// 자세한 근거는 docs/02-game-design.md §2 「침공 설계」.

export interface ApproachSegment {
  id: number
  face: 'east' | 'north' | 'south'
  /** 위협을 재는 기준점 — 벽 바깥 면 위의 대표 지점 */
  probe: Vec2
  /** 벽면 바깥 방향 단위 벡터 (aim = probe + normal * (반경 + 여유)) */
  normal: Vec2
  /** 회절 레인 경유점 — 성 동쪽 바깥을 돌아 들어오게 한다. 동벽은 null */
  via: Vec2 | null
}

/** 동벽 정면 6구간 + 북/남벽 동쪽 끝 회절 레인 2구간 */
export const SEGMENTS: ApproachSegment[] = (() => {
  const out: ApproachSegment[] = []
  const eastFace = C.east + halfT
  const span = C.south - C.north
  const n = 6
  for (let i = 0; i < n; i++) {
    const z = C.north + (span * (i + 0.5)) / n
    out.push({ id: out.length, face: 'east', probe: { x: eastFace, z }, normal: { x: 1, z: 0 }, via: null })
  }
  // 회절 레인 — 북/남벽의 동쪽 끝. 성 동쪽 바깥(x=6)을 경유해 벽 모서리를 돌아 붙는다
  const flankX = C.east - 10
  const viaX = C.east + 12
  out.push({
    id: out.length, face: 'north',
    probe: { x: flankX, z: C.north - halfT }, normal: { x: 0, z: -1 }, via: { x: viaX, z: C.north - halfT - 4 },
  })
  out.push({
    id: out.length, face: 'south',
    probe: { x: flankX, z: C.south + halfT }, normal: { x: 0, z: 1 }, via: { x: viaX, z: C.south + halfT + 4 },
  })
  return out
})()

/**
 * 이 구간을 겨누고 있는 성벽 위 화력의 합 (dps) = 괴수가 읽는 위협.
 *
 * 두 가지를 세지 않는다:
 *  - 지상 유닛 (가시성 규칙) — 안뜰·성문 안쪽은 괴수에게 보이지 않는다. 그래서 킬존이 성립한다.
 *  - **조준이 다른 곳을 향한 병기** — 대포가 고정된 뒤로 화망을 그리는 수단은 조준뿐이다.
 *    포구가 북쪽을 향하면 북쪽이 위험해지고, 괴수는 남쪽으로 흐른다.
 *
 * 조준의 영향은 벽면을 따라가는 **가로 거리**로 잰다 — 동쪽 멀리를 겨눠도 z가 맞으면
 * 그 구간을 덮고 있는 것이다(포구가 향한 방향이 곧 위협).
 */
function segmentThreat(state: SiegeState, seg: ApproachSegment): number {
  let dps = 0
  for (const u of state.units) {
    if (u.h < 1) continue
    const def = state.kinds.units[u.kind]!
    if (Math.hypot(u.pos.x - seg.probe.x, u.pos.z - seg.probe.z) > def.range) continue
    if (u.aim && def.aimRadius) {
      const lateral = seg.face === 'east' ? Math.abs(u.aim.z - seg.probe.z) : Math.abs(u.aim.x - seg.probe.x)
      if (lateral > def.aimRadius) continue
    }
    dps += def.dmg / def.atkInterval
  }
  return dps
}

/** 개체별 결정론 난수 — 상태를 늘리지 않기 위해 (시드, 개체 id) 해시로 뽑는다 */
function hashRand(seed: number, id: number): number {
  let t = (seed ^ Math.imul(id, 0x9e3779b9)) | 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000
}

/**
 * 목표 구간 선택 — 위협이 낮은 구간일수록 뽑힐 확률이 높다.
 * 위협은 구간 평균으로 정규화해서 로드아웃(총 화력)이 바뀌어도 성향이 그대로 유지되게 한다.
 * 화력을 고르게 펴면 모든 구간이 평균이라 유도가 안 생기고, 한쪽에 몰아야 비로소 흐름이 생긴다.
 */
function pickSegment(state: SiegeState, def: EnemyKindDef, id: number): ApproachSegment {
  const threats = SEGMENTS.map((s) => segmentThreat(state, s))
  const mean = threats.reduce((a, b) => a + b, 0) / threats.length
  const weights = SEGMENTS.map((s, i) => {
    const base = s.face === 'east' ? 1 : def.flankBias
    const ratio = mean > 0 ? threats[i]! / mean : 1
    // 제곱 응답 — 선형이면 유닛 사거리가 길어(대포 24) 구간 간 위협 차이가 뭉개져서
    // 플레이어가 화망을 몰아도 흐름이 눈에 안 보인다. 제곱하면 "몰았다"가 읽힌다.
    return base / (1 + def.threatAvoidance * ratio * ratio)
  })
  const total = weights.reduce((a, b) => a + b, 0)
  let r = hashRand(state.seed, id) * total
  for (let i = 0; i < SEGMENTS.length; i++) {
    r -= weights[i]!
    if (r <= 0) return SEGMENTS[i]!
  }
  return SEGMENTS[0]!
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
  /**
   * 고정 병기 — 옮길 수 없고 **조준만** 지정한다 (기획 확정 2026-08-04, §4-3).
   * 이동 명령 한 번이 곧 영구 침묵이던 문제(무작위 조작 0/6)를 룰 차원에서 없앤다.
   * 플레이어의 개입 수단은 "어디로 옮기나"에서 "어디를 겨누나"로 바뀐다.
   */
  emplaced?: boolean
  /** 조준점 주변 이 반경 안의 적을 우선 노린다 (없으면 사거리 내 최근접으로 폴백) */
  aimRadius?: number
}

export const UNIT_KINDS: Record<string, UnitKindDef> = {
  soldier: { kind: 'soldier', name: '궁수', hp: 260, dmg: 33, atkInterval: 1.3, range: 14, speed: 3.5, radius: 0.4 },
  ballista: {
    kind: 'ballista', name: '발리스타', hp: 420, dmg: 200, atkInterval: 2.8, range: 21, speed: 1.2,
    radius: 0.8, emplaced: true, aimRadius: 7,
  },
  cannon: {
    kind: 'cannon', name: '대포', hp: 500, dmg: 140, atkInterval: 3.8, range: 24, speed: 1.0,
    radius: 0.9, aoe: 2.8, emplaced: true, aimRadius: 9,
  },
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
  /** 고정 병기 전용 — 겨누고 있는 지점. 화망의 실체이자 괴수가 읽는 위협의 출처 */
  aim: Vec2 | null
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
  /** 고정 병기 조준 명령 — 옮기는 대신 겨눈다. 이게 화망을 그리는 유일한 수단이다 */
  unitAim?: { ids: number[]; to: Vec2 }
  /** 영웅 스킬 시전 지점 — 사거리·쿨다운은 sim이 검증. heroId 생략 시 첫 영웅 (다영웅 대비) */
  heroSkill?: Vec2 & { heroId?: number }
  /** 준비 종료 → 침공 개시 */
  startAssault?: boolean
}

export interface SiegeState {
  tick: number
  /** 이 판의 시드 — 스폰 시 구간 선택을 (시드, 개체 id) 해시로 뽑기 위해 state가 들고 있는다 */
  seed: number
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
  /** 아직 삭지 않은 시체 — 네크로맨서의 재료 */
  corpses: Corpse[]
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
  | { type: 'enemyRaised'; id: number; kind: string; pos: Vec2; byId: number }
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

/**
 * 현재 출고 중인 구성 — 동벽 보도(대포 6), 성문 위 다리(발리스타 2), 지상(영웅 1).
 *
 * 궁수 폐지 [기획 확정 2026-08-04]. 유도 규칙을 넣은 뒤 봇으로 재보니 궁수 편성은
 * 적을 밀어내기만 하고 못 죽여서 무너졌다(궁수 6 편성 무개입 3/6 · 궁수 8 편성 0/6).
 * 대포 6은 무개입 6/6(잔존 1297)에 더해 **적극 플레이가 무개입을 앞지른 유일한 편성**
 * (1372 > 1297) — 판정 기준 "개입이 보상되는가"를 처음 만족한다.
 * 궁수 정의는 UNIT_KINDS에 남아 있으므로 프리셋 한 줄로 되살릴 수 있다.
 */
export const DEFAULT_LOADOUT: Loadout = {
  name: 'default',
  wallHp: WALL_HP,
  unitKinds: UNIT_KINDS,
  enemyKinds: ENEMY_KINDS,
  // 증원 [2026-08-04]: 병기 8 → 12. "성을 지키기엔 대포와 발리스타가 너무 적다"(사용자).
  // 북/남벽에 발리스타를 둔 게 핵심이다 — 모서리 회절 레인이 그전까지 완전 무방비였다.
  placements: [
    // 안쪽 두 문은 ±4 — 성문 발리스타(±1.6)와 반경이 겹치지 않는 최소 간격이다.
    // 고정 병기는 밀려나지 않으므로 배치 단계에서 겹치지 않게 두어야 한다.
    ...[-18, -13, -8, -4, 4, 8, 13, 18].map((z) => ({ kind: 'cannon', x: WALL_X, z, h: C.wallH })),
    { kind: 'ballista', x: WALL_X, z: -1.6, h: C.wallH }, // 성문 위 다리
    { kind: 'ballista', x: WALL_X, z: 1.6, h: C.wallH },
    { kind: 'ballista', x: -14, z: C.north, h: C.wallH }, // 북벽 동쪽 끝 — 회절 레인 대응
    { kind: 'ballista', x: -14, z: C.south, h: C.wallH }, // 남벽 동쪽 끝
    { kind: 'hero', x: WALL_X - 6, z: 0, h: 0 }, // 성문 안쪽 지상 — 출격 가능
  ],
  // 난이도 재조정 [2026-08-04]. 유도 도입 + 대포 6으로 무개입이 너무 쉬워졌다(잔존 1550 > 상한 1400).
  // 봇 스윕으로 후보 11종을 돌려 고른 구성 — 무개입 6/6·여유 대역 6/6·개입 보상 6/6, 평균 93초.
  // 웨이브 성격도 언데드 서사에 맞췄다: 짐승 무리가 먼저 밀려오고, 그 뒤에 갑옷과 병사가 온다.
  waves: [
    { wave: 1, kind: 'grunt', count: 14, at: 4, every: 1.8 }, // 정찰 — 되살아난 병사들
    { wave: 2, kind: 'runner', count: 18, at: 26, every: 0.8 }, // 짐승 무리 (회절 레인으로 크게 돈다)
    { wave: 3, kind: 'tank', count: 5, at: 50, every: 2.5 }, // 중장 — 빈 갑옷
    { wave: 3, kind: 'grunt', altKind: 'runner', count: 25, at: 52, every: 0.6 }, // 본대
    { wave: 4, kind: 'necromancer', count: 1, at: 57, z: 0 }, // 이 군세를 일으킨 자
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
  return loadout.placements.map((p) => {
    const def = loadout.unitKinds[p.kind]!
    return {
      id: nextId(),
      kind: p.kind,
      pos: { x: p.x, z: p.z },
      h: p.h,
      hp: def.hp,
      facing: Math.PI / 2, // 동쪽(적 방향)을 본다
      target: null,
      path: [],
      cooldown: 0,
      skillCd: 0,
      // 초기값은 **자동 조준**(null = 사거리 내 최근접). 플레이어가 겨눠야 비로소 화망이
      // 좁아지고 흐름이 생긴다. 처음부터 좁게 겨눈 상태로 시작하면 손대지 않은 판이
      // 성립하지 않아서(무개입 0/6으로 측정됨) "조준은 선택적 개선"이라는 전제가 깨진다.
      aim: null,
    }
  })
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
      seed,
      status: 'prep',
      wallHp: loadout.wallHp,
      wallHpMax: loadout.wallHp,
      kinds: { units: loadout.unitKinds, enemies: loadout.enemyKinds },
      loadout: loadout.name,
      lord: { pos: { x: WALL_X - 9, z: 2 }, facing: 0, target: null, path: [], h: 0 },
      units,
      enemies: [],
      corpses: [],
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
/**
 * 표적 선택. 고정 병기는 **조준점 근처를 우선**하고, 거기에 아무도 없으면 사거리 내 최근접으로
 * 폴백한다. 완전 침묵시키지 않는 이유: 그러면 "한 번의 잘못된 명령이 곧 패배"라는,
 * 이동 규칙에서 막 걷어낸 문제가 조준으로 되살아난다. 빗나간 조준은 손해지 사형이 아니다.
 */
function acquireTarget(u: FriendlyUnit, enemies: ActiveEnemy[], def: UnitKindDef): ActiveEnemy | null {
  const pick = (near: Vec2, limit: number): ActiveEnemy | null => {
    let best: ActiveEnemy | null = null
    let bestD = Infinity
    for (const e of enemies) {
      if (Math.hypot(e.pos.x - u.pos.x, e.pos.z - u.pos.z) > def.range) continue // 사거리는 절대 조건
      const d = Math.hypot(e.pos.x - near.x, e.pos.z - near.z)
      if (d <= limit && (d < bestD || (d === bestD && best !== null && e.id < best.id))) {
        best = e
        bestD = d
      }
    }
    return best
  }
  if (u.aim && def.aimRadius) {
    const aimed = pick(u.aim, def.aimRadius)
    if (aimed) return aimed
  }
  return pick(u.pos, def.range)
}

/**
 * 괴수 1기 생성 — 스폰과 부활이 같은 경로를 쓴다.
 * 되살아난 것도 새로 온 것과 똑같이 목표 구간을 새로 뽑는다(그 시점의 화망을 보고 고른다).
 */
function makeEnemy(state: SiegeState, kind: string, pos: Vec2, hpRatio: number, wave: number): ActiveEnemy {
  const def = state.kinds.enemies[kind]!
  const id = state.nextId++
  const seg = pickSegment(state, def, id)
  // 보스는 벽에 붙지 않고 standoff만큼 떨어져 멈춘다 — 뒤에서 지휘하는 그림
  const gap = def.radius + 0.2 + (def.standoff ?? 0)
  return {
    id,
    kind,
    pos: { ...pos },
    hp: Math.max(1, Math.round(def.hp * hpRatio)),
    cooldown: 0,
    atWall: false,
    wave,
    seg: seg.id,
    aim: { x: seg.probe.x + seg.normal.x * gap, z: seg.probe.z + seg.normal.z * gap },
    via: seg.via ? { ...seg.via } : null,
    raiseCd: 0,
  }
}

/** 시체가 삭기까지 (초) — 무한히 쌓아두고 후반에 몰아서 되살리는 걸 막는다 */
const CORPSE_ROT_SECONDS = 22

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
      if (state.kinds.units[u.kind]!.emplaced) continue // 고정 병기는 못 옮긴다 — 조준만
      const off = FORMATION[Math.min(slot, FORMATION.length - 1)]!
      commandMove(u, { x: to.x + off[0], z: to.z + off[1] }, to.h ?? 0)
      slot++
    }
  }

  // 조준 — 고정 병기에만. 즉시 반영되고 이동 시간이 없다(그래서 화망을 다시 그리는 게 빠르다)
  if (input.unitAim) {
    const to = input.unitAim.to
    for (const id of [...input.unitAim.ids].sort((a, b) => a - b)) {
      const u = state.units.find((v) => v.id === id)
      if (!u || !state.kinds.units[u.kind]!.emplaced) continue
      u.aim = { x: to.x, z: to.z }
      u.facing = Math.atan2(to.x - u.pos.x, to.z - u.pos.z)
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
        // 고정 병기는 밀리지 않는다 — 포좌는 배치된 자리에 박혀 있다.
        // (밀리게 두면 "고정"이라는 규칙과 어긋나고, 배치 좌표가 조용히 어긋난다)
        if (state.kinds.units[m.kind]!.emplaced) continue
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
    // 목표 구간은 지금 한 번만 정해진다 — 뒤늦게 옮긴 대포는 이 무리에 안 통하고
    // 다음 웨이브부터 통한다. 그래서 웨이브 사이가 판단 지점이 된다.
    const e = makeEnemy(state, s.kind, { x: FIELD.maxX - 1, z: s.z }, 1, s.wave)
    state.enemies.push(e)
    state.events.push({ type: 'spawned', id: e.id, kind: e.kind, wave: e.wave })
  }

  // 아군 사격 — 정지 상태에서만 (이동 중 발사 불가). 히트스캔: 피해는 즉시, 투사체는 연출
  for (const u of state.units) {
    if (u.cooldown > 0) u.cooldown--
    if (u.path.length > 0 || u.cooldown > 0) continue
    const def = state.kinds.units[u.kind]!
    const tgt = acquireTarget(u, state.enemies, def)
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
      // 목표 구간의 정지점(aim)으로 향한다. 회절 레인은 성 동쪽 바깥의 경유점(via)을 먼저
      // 지나 모서리를 돌아 들어온다 — 직선으로 가면 성벽 모서리를 뚫고 지나간다.
      // aim은 이미 "벽 바깥 면 + 자기 반경"이라 벽 속으로 파고들지 않는다.
      const wp = e.via ?? e.aim
      const dx = wp.x - e.pos.x
      const dz = wp.z - e.pos.z
      const d = Math.hypot(dx, dz)
      const step = def.speed * DT
      if (d <= step) {
        e.pos.x = wp.x
        e.pos.z = wp.z
        if (e.via) e.via = null
        else e.atWall = true
      } else {
        e.pos.x += (dx / d) * step
        e.pos.z += (dz / d) * step
      }
    } else if (e.cooldown <= 0) {
      state.wallHp -= def.wallDamage
      e.cooldown = Math.round(def.atkInterval * TICKS_PER_SECOND)
      state.events.push({ type: 'wallHit', id: e.id, damage: def.wallDamage, wallHp: Math.max(0, state.wallHp) })
    }
  }

  // 부활술 — 네크로맨서가 쿨마다 반경 안의 시체를 다시 세운다.
  // 킬존에서 쓸어담은 것들이 계속 일어나므로 "먼저 이 자를 끊는다"는 판단이 생긴다.
  // 대상 목록을 먼저 스냅샷한다 — 되살아난 개체가 같은 틱에 또 되살리면 폭주한다.
  const raisers = state.enemies.filter((e) => state.kinds.enemies[e.kind]!.raise)
  for (const boss of raisers) {
    const r = state.kinds.enemies[boss.kind]!.raise!
    if (boss.raiseCd > 0) {
      boss.raiseCd--
      continue
    }
    const picked: number[] = []
    for (let i = 0; i < state.corpses.length && picked.length < r.count; i++) {
      const c = state.corpses[i]!
      if (Math.hypot(c.pos.x - boss.pos.x, c.pos.z - boss.pos.z) <= r.radius) picked.push(i)
    }
    if (picked.length === 0) continue
    boss.raiseCd = Math.round(r.cooldown * TICKS_PER_SECOND)
    for (const i of picked) {
      const c = state.corpses[i]!
      // 되살아난 것도 그 시점의 화망을 보고 목표 구간을 새로 고른다
      const e = makeEnemy(state, c.kind, c.pos, r.hpRatio, boss.wave)
      state.enemies.push(e)
      state.events.push({ type: 'enemyRaised', id: e.id, kind: e.kind, pos: { ...c.pos }, byId: boss.id })
    }
    const used = new Set(picked)
    state.corpses = state.corpses.filter((_, i) => !used.has(i))
  }
  // 삭은 시체 정리
  if (state.corpses.length > 0) state.corpses = state.corpses.filter((c) => c.rotAt > state.tick)

  // 사망 처리
  state.enemies = state.enemies.filter((e) => {
    if (e.hp > 0) return true
    state.events.push({ type: 'enemyDied', id: e.id, kind: e.kind, pos: { ...e.pos } })
    // 네크로맨서 자신은 시체를 남기지 않는다 — 스스로를 되살릴 수는 없다
    if (!state.kinds.enemies[e.kind]!.raise) {
      state.corpses.push({ kind: e.kind, pos: { ...e.pos }, rotAt: state.tick + CORPSE_ROT_SECONDS * TICKS_PER_SECOND })
    }
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
