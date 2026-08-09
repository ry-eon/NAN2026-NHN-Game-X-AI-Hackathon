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
    // 이 층에서 밟을 수 있는 칸인가 — 대각선 코너컷 방지용 (양 옆 직교 칸 검사)
    const standable = (xx: number, zz: number): boolean => {
      if (xx < 0 || zz < 0 || xx >= W || zz >= H) return false
      const w2 = toWorld(xx, zz)
      return heightLevels(w2.x, w2.z).some(
        (h) => Math.abs(h - curH) <= 1.5 && !(h < 1 && blockedGround(w2.x, w2.z)),
      )
    }
    // 8방향 (2026-08-08): 직교만 있으면 경사로·안뜰에서 계단꼴 지그재그로 걷는다 —
    // "계단 올라가는 게 어색하다"(사용자). 대각선은 양 옆 직교 칸이 모두 밟을 수 있을
    // 때만 허용 — 벽 모서리·흉벽 띠를 대각선으로 뚫고 지나가지 못하게.
    for (const [dx, dz] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
      [1, -1],
      [1, 1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      const nx = cx + dx
      const nz = cz + dz
      if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue
      if (dx !== 0 && dz !== 0 && (!standable(cx + dx, cz) || !standable(cx, cz + dz))) continue
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
  /**
   * 성문 돌파 성향 (0~1). 성벽을 때리는 대신 성문 터널을 지나 안뜰로 들어가 지상 병력을 문다.
   * 실제 확률은 **성문 앞 화망이 얇을수록** 올라간다 — 유도 규칙과 같은 논리다.
   * 성문을 비워두면 뚫린다는 뜻이라, 화망을 몰 때 성문 몫을 남겨야 하는 이유가 생긴다.
   */
  breach?: number
}

// 언데드 군세 — 네크로맨서가 일으킨 것들 (기획 확정 2026-08-04, docs/02-game-design.md §4-2)
export const ENEMY_KINDS: Record<string, EnemyKindDef> = {
  // 되살아난 병사 — 생전의 기억으로 화망을 제대로 피한다. 유도가 가장 잘 먹히는 표준 개체
  grunt: {
    kind: 'grunt', name: '야귀', hp: 660, dmg: 70, atkInterval: 1.5, speed: 2.4, radius: 0.6,
    wallDamage: 21, threatAvoidance: 1.0, flankBias: 0.25,
  },
  // 되살린 짐승 — 겁이 많아 회피 폭이 크고, 크게 돌아 모서리로 파고든다
  runner: {
    kind: 'runner', name: '질주귀', hp: 300, dmg: 50, atkInterval: 1.0, speed: 4.6, radius: 0.5,
    wallDamage: 14, threatAvoidance: 1.6, flankBias: 0.9,
    breach: 0.75, // 성문이 비면 그리로 파고든다 — 성벽이 아니라 안뜰의 지상 병력을 문다
  },
  // 속이 빈 판금 갑옷 — 두려움이 없다. 화망을 무시하고 정면으로 밀고 온다
  tank: {
    kind: 'tank', name: '갑주귀', hp: 2050, dmg: 90, atkInterval: 2.0, speed: 1.4, radius: 1.0,
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
  /** 'wall' = 성벽을 깬다 / 'breach' = 성문으로 들어가 지상 병력을 문다 (성벽은 안 때린다) */
  mode: 'wall' | 'breach'
  /** 기절 남은 틱 (전사 대지파쇄) — 이동·공격·부활 전부 정지 */
  stunT: number
}

/**
 * 비행 중인 투사체. **발사 지점이 아니라 착탄 지점이 확정돼 있다** —
 * 발사 순간의 표적 위치로 날아가므로, 그 사이 움직인 개체는 흘린다.
 */
export interface Projectile {
  id: number
  unitKind: string
  from: Vec2 & { h: number }
  to: Vec2
  /** 이 틱에 착탄한다 */
  hitTick: number
  /** 비행 총 길이 (틱) — 렌더러가 보간에 쓴다 */
  flight: number
  dmg: number
  /** 광역 반경. 없으면 착탄점 근처 1기만 */
  aoe?: number
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
  /**
   * 투사체 속도 (유닛/초). 지정하면 **히트스캔이 아니라 비행**한다 —
   * 발사 시점의 표적 위치로 날아가고, 도착해서야 피해가 들어간다.
   * 그래서 빠른 개체는 포탄을 흘릴 수 있고, 대포는 예측 사격이 필요해진다.
   */
  projectileSpeed?: number
  /**
   * 조작 병사 — 이 병기를 조작하는 병종. **곁에 있어야만 병기가 쏜다**(CREW_MAN_RADIUS).
   * 빼면 병기가 멈추고, 돌아오면 다시 쏜다.
   * (2026-08-08 룰 개정 「장착제」 — 수비병은 판 시작 시 병기 곁이 아니라 **안뜰에 집결**해
   *  있고, 플레이어가 병기로 보내 장착해야 비로소 쏜다. 병기-병사 고정 짝(crewOf)도 폐지 —
   *  아무 수비병이나 곁에 오면 조작한다(동적 배정, manningMap). 배치가 곧 플레이라는
   *  디렉션: "아무것도 안 하면 지는 게 맞다". 그래서 무개입 승리였던 검증 기준도
   *  CRITERIA_V1로 함께 개정됐다(verify.ts).
   *  2026-08-06 상주 조작제(고정 짝 상주)→ 그 전은 dismount 편도 커맨드였다.)
   */
  crew?: string
  /** 스킬 3슬롯 (Q/W/E) — 영웅 병종만. 성주는 LORD_SKILLS (유닛이 아니므로 별도) */
  skills?: SkillDef[]
}

/**
 * 스킬 정의 — 영웅(전사·마법사)·성주가 Q/W/E 3슬롯을 갖는다 (2026-08-08 기획 확정).
 * E는 궁극기 슬롯(긴 쿨·판을 바꾸는 효과). 전사는 공격기만, 마법사는 화염 속성 통일,
 * 성주는 버프 계열만(성벽 회복류는 기획에서 제외). 시전은 castSkill 커맨드 하나로 통일.
 */
export interface SkillDef {
  key: 'Q' | 'W' | 'E'
  name: string
  cooldown: number // 초
  /** true면 지점 지정(사거리 검증), false면 시전자 중심 즉발 */
  targeted: boolean
  range: number
  radius: number // 효과 반경. dash는 경로 폭
  dmg?: number
  /** 돌진 — 시전자가 지점까지 즉시 주파하며 경로상 적에게 피해 (지형 검증, 같은 층만) */
  dash?: boolean
  /** 반경 내 적 기절 초 (이동·공격·부활 정지) */
  stunSec?: number
  /** 장판 — 지점에 남아 초당 피해 */
  zone?: { sec: number; dps: number }
  /** 버프 — reload: 반경 내 병기 재장전 2배 / move: 반경 내 아군 이속 배율 /
   *  all: 전역 공격력 배율 + 재장전 2배 (궁극) */
  buff?: { sec: number; stat: 'reload' | 'move' | 'all'; mult?: number; global?: boolean }
}

export const WARRIOR_SKILLS: SkillDef[] = [
  { key: 'Q', name: '돌진', cooldown: 10, targeted: true, range: 14, radius: 1.6, dmg: 200, dash: true },
  { key: 'W', name: '회전베기', cooldown: 8, targeted: false, range: 0, radius: 3.2, dmg: 260 },
  { key: 'E', name: '대지파쇄', cooldown: 22, targeted: false, range: 0, radius: 5, dmg: 450, stunSec: 1.5 },
]
/**
 * 사거리 18/16 [2026-08-09 재확정 — 14로 줄였다가 되돌림].
 *
 * 낮에 18 → 14로 줄였다. 근거는 "안뜰(x=-12)에 선 마법사가 성벽 36 중 30을 덮어 움직일
 * 이유가 없다"는 측정이었다. 그런데 그 뒤 **마법사를 성벽 위로 올리면서 전제가 바뀌었다**:
 * 보도(x=-9)에서 벽 바깥면(x=-2)까지가 이미 7이라, 14로는 들판으로 **7밖에 못 나간다**.
 * 실측(런타임): 커서를 1~4시 어디에 두어도 레티클이 13.9에 물려 x=+5를 못 넘었다
 * — 정작 괴수가 몰려오는 방향으로 스킬을 쓸 수 없었다(사용자 반려).
 * 18이면 x=+9까지 = 벽 너머 11. 병기(대포 24·발리스타 21)보다 여전히 짧다.
 * 재배치 축은 사거리가 아니라 **성벽을 따라 걷는 거리**(벽 길이 36)가 담당한다.
 */
export const MAGE_SKILLS: SkillDef[] = [
  { key: 'Q', name: '화염구', cooldown: 6, targeted: true, range: 18, radius: 2.5, dmg: 220 },
  { key: 'W', name: '불의 장막', cooldown: 14, targeted: true, range: 16, radius: 3.5, zone: { sec: 10, dps: 90 } },
  { key: 'E', name: '업화', cooldown: 24, targeted: true, range: 18, radius: 5.5, dmg: 650 },
]
export const LORD_SKILLS: SkillDef[] = [
  { key: 'Q', name: '군기', cooldown: 20, targeted: false, range: 0, radius: 12, buff: { sec: 8, stat: 'reload' } },
  { key: 'W', name: '진군 나팔', cooldown: 16, targeted: false, range: 0, radius: 12, buff: { sec: 6, stat: 'move', mult: 1.5 } },
  { key: 'E', name: '총력전', cooldown: 45, targeted: false, range: 0, radius: 0, buff: { sec: 6, stat: 'all', mult: 1.3, global: true } },
]

export const UNIT_KINDS: Record<string, UnitKindDef> = {
  soldier: { kind: 'soldier', name: '궁수', hp: 260, dmg: 33, atkInterval: 1.3, range: 14, speed: 3.5, radius: 0.4 },
  ballista: {
    kind: 'ballista', name: '발리스타', hp: 420, dmg: 260, atkInterval: 2.8, range: 21, speed: 1.2,
    radius: 0.8, emplaced: true, aimRadius: 7, crew: 'guard',
    projectileSpeed: 46, // 볼트 — 빠르지만 즉시는 아니다
  },
  cannon: {
    // 182 → 200 → 192 [2026-08-09]. 200은 전사 근접화로 사라진 지상 화력 보정값이었는데,
    // 그 뒤 "공격은 적 몸통에 닿는다"(acquireTarget 반경 포함)로 전 병종 도달이 늘자
    // 시드 1이 상한을 넘었다(1450 > 1400 "너무 쉽다"). 6시드 스윕으로 192 재확정
    // — 표준 장착 잔존 592~1244로 대역 한가운데, 적극 플레이 6/6 우세.
    kind: 'cannon', name: '대포', hp: 500, dmg: 192, atkInterval: 3.8, range: 24, speed: 1.0,
    radius: 0.9, aoe: 2.8, emplaced: true, aimRadius: 9, crew: 'guard',
    projectileSpeed: 22, // 포탄 — 느리다. 최대 사거리에서 1초 넘게 난다
  },
  // 피해 상향은 비행 도입의 대가다. 실측 명중률 65% — 35%가 빗나가므로 그만큼 화력이 준다.
  // 속도로 우겨 히트스캔에 가깝게 만드는 대신, **맞으면 무겁게** 해서 상쇄했다(×1.3).
  // 대포 140 → 182, 발리스타 200 → 260.
  // 영웅 2종 (2026-08-08 확정: "기존 영웅은 전사, 마법사 추가"). kind 'hero'를 유지하는 이유:
  // 프리셋·봇·테스트가 참조하는 식별자라 개명은 name(표시)만.
  // 전사는 **근접**이다 [2026-08-09 확정]. 구 사거리 13은 검기를 날리는 원거리였고,
  // 화면에서 "칼이 아니라 뭘 던진다"로 읽혔다(사용자). 더 큰 문제는 성벽 뒤에 선 채
  // 벽 너머를 계속 때려 **무개입 화력의 17%를 공짜로 주고 있었다**는 것 — 근접화로
  // 그 화력이 사라진 만큼 대포를 182→200으로 올려 보정했다(6시드 스윕).
  hero: { kind: 'hero', name: '전사', hp: 900, dmg: 300, atkInterval: 0.85, range: 2.4, speed: HERO_SPEED, radius: 0.5, skills: WARRIOR_SKILLS },
  mage: { kind: 'mage', name: '마법사', hp: 700, dmg: 70, atkInterval: 1.1, range: 16, speed: 3.4, radius: 0.5, skills: MAGE_SKILLS },
  // 병기에서 내려온 조작 병사 — 사거리 1.6은 사실상 백병전이다. 배치가 아니라 병기에서 나온다
  guard: { kind: 'guard', name: '수비병', hp: 320, dmg: 62, atkInterval: 0.8, range: 1.6, speed: 3.4, radius: 0.4 },
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
  /** 영웅 전용 — 스킬 슬롯별 남은 쿨다운 (틱, Q/W/E = 0/1/2) */
  cds: number[]
  /** 고정 병기 전용 — 겨누고 있는 지점. 화망의 실체이자 괴수가 읽는 위협의 출처 */
  aim: Vec2 | null
  /** 어택땅 이동 중 — 사거리 안에 적이 들어오면 정지·교전 (접적 시 해제) */
  aggro?: boolean
  /** 홀드(S·H) — 스스로 적에게 다가가지 않는다. 이동 명령을 받으면 풀린다.
   *  자동 교전이 생기면서 "가만히 있으라"를 표현할 수단이 필요해졌다 (2026-08-09) */
  holding?: boolean
}

/** 조작 판정 반경 — 겹침 분리의 정지 거리(반경 합 ≈1.45)보다 넉넉해야 곁에 선 병사가 항상 잡힌다 */
export const CREW_MAN_RADIUS = 2.4

/** 자동 교전 반경 — 근접 지상 유닛이 스스로 다가가는 거리. 7이면 "코앞"은 반응하고
 *  멀리 지나가는 무리는 쫓지 않는다(성문을 비우고 들판으로 끌려나가지 않게) */
export const AUTO_ENGAGE_RADIUS = 7

/**
 * 장착 배정 — 병기 id → 조작 중인 수비병 id (장착제, 2026-08-08).
 *
 * 고정 짝이 없으므로 매 판정마다 위치로 계산한다: 병기를 id 순으로 돌며 같은 층·반경 안의
 * **가장 가까운 미배정** 수비병을 배정한다(같은 거리면 낮은 id — 결정론). 수비병 하나가
 * 병기 두 대를 동시에 조작할 수는 없다 — 두 포좌 사이에 서서 양쪽을 다 살리는 꼼수를 막는다.
 * 규모가 병기 12 × 병사 12라 매 틱 전량 계산해도 비용은 무시할 수준이다.
 */
export function manningMap(state: SiegeState): Map<number, number> {
  const map = new Map<number, number>()
  const taken = new Set<number>()
  for (const w of state.units) {
    const crewKind = state.kinds.units[w.kind]!.crew
    if (!crewKind) continue
    let best: FriendlyUnit | null = null
    let bestD = Infinity
    for (const g of state.units) {
      if (g.kind !== crewKind || taken.has(g.id)) continue
      if (g.hp <= 0) continue // 전사 처리 후 정리 전 틱에도 조작 중으로 잡히면 안 된다
      if (Math.abs(g.h - w.h) > 1.5) continue
      const d = Math.hypot(g.pos.x - w.pos.x, g.pos.z - w.pos.z)
      if (d > CREW_MAN_RADIUS) continue
      if (d < bestD || (d === bestD && best !== null && g.id < best.id)) {
        best = g
        bestD = d
      }
    }
    if (best) {
      map.set(w.id, best.id)
      taken.add(best.id)
    }
  }
  return map
}

/** 병기가 조작되고 있는가 — 수비병이 같은 층·반경 안에 살아 있어야 쏜다.
 *  병사가 죽거나 자리를 비우면 병기는 침묵하고, 병사가 (누구든) 돌아서면 다시 쏜다. */
export function isCrewManned(state: SiegeState, u: FriendlyUnit): boolean {
  if (!state.kinds.units[u.kind]!.crew) return true
  return manningMap(state).has(u.id)
}

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
  /** 버프 스킬 슬롯별 남은 쿨다운 (틱) — LORD_SKILLS와 짝 */
  cds: number[]
}

/** 지속 효과 — 장판·버프. until은 틱 기준 (스킬은 침공 중에만 의미가 있다) */
export interface ActiveEffect {
  type: 'zone' | 'reload' | 'move' | 'all'
  x: number
  z: number
  radius: number
  until: number
  dps?: number
  mult?: number
  global?: boolean
  /** 성주 오라 — 시전 지점 고정이 아니라 **성주의 현재 위치**를 중심으로 잰다
   *  (2026-08-09 사용자: "성주 Q/W는 성주로부터의 거리로 계산해야") */
  followLord?: boolean
}

export type SiegeStatus = 'prep' | 'assault' | 'won' | 'lost'

export interface SiegeInput {
  /** 성주 이동 명령 (우클릭 지점 + 클릭한 면의 높이 힌트 — 보도 위 vs 터널 구분) */
  moveTo?: Vec2 & { h?: number }
  /** 부대 이동 명령 (스타크래프트식 선택 → 우클릭). 대형은 sim이 결정론으로 분산.
   *  attack = 어택땅(A) — 이동 중 사거리 안에 적이 들어오면 멈춰 교전한다
   *  (정지 상태에서만 사격하는 룰과 맞물려, 목적지가 아니라 접적이 이동을 끝낸다) */
  unitMove?: { ids: number[]; to: Vec2 & { h?: number }; attack?: boolean }
  /** 정지 명령 (S) — 경로·목표를 즉시 버리고 그 자리에서 교전 태세 */
  unitStop?: { ids: number[] }
  /** 고정 병기 조준 명령 — 옮기는 대신 겨눈다. 이게 화망을 그리는 유일한 수단이다 */
  unitAim?: { ids: number[]; to: Vec2 }
  /** 스킬 시전 (2026-08-08 — 구 heroSkill 대체·확장): casterId 생략 = 성주.
   *  slot = Q/W/E(0/1/2). 지점 스킬만 x/z 필요 — 사거리·쿨다운은 sim이 검증한다. */
  castSkill?: { casterId?: number; slot: number; x?: number; z?: number }
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
  /** 비행 중인 투사체 (히트스캔이 아닌 병기) */
  shots: Projectile[]
  /** 지속 효과 — 불의 장막·성주 버프 (skillCast로 생성, until 지나면 소멸) */
  effects: ActiveEffect[]
  spawnCursor: number
  nextId: number
  /** 이번 틱 이벤트 (렌더러 소비) */
  events: SiegeEvent[]
}

export type SiegeEvent =
  | { type: 'spawned'; id: number; kind: string; wave: number }
  | { type: 'wallHit'; id: number; damage: number; wallHp: number }
  | {
      type: 'unitFired'
      unitId: number
      unitKind: string
      targetId: number
      from: Vec2 & { h: number }
      to: Vec2
      /** 비행 틱 수. 0이면 히트스캔(즉시 명중) — 렌더러가 궤적 길이를 여기에 맞춘다 */
      flight: number
    }
  | { type: 'shotLanded'; x: number; z: number; unitKind: string; aoe?: number }
  | { type: 'skillCast'; casterKind: string; casterId?: number; slot: number; name: string; x: number; z: number; radius: number }
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
    { kind: 'hero', x: WALL_X - 6, z: 0, h: 0 }, // 전사 — 성문 안쪽 지상, 출격 가능
    { kind: 'mage', x: WALL_X - 6, z: 3, h: 0 }, // 마법사 (2026-08-08 영웅 2종 확정)
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

/** 병기 곁의 조작 위치 — 성 중심 쪽으로 2.0. 조작 반경(2.4) 안이면서 겹침 분리 정지
 *  거리(≈1.45) 밖이라 밀리지 않고, 보도 안쪽이라 흉벽 띠(바깥)에 걸리지 않는다.
 *  (1.5였다가 2.0으로 — "대포랑 수비병이 너무 붙어 있다" 2026-08-08 사용자 지적) */
export function mountPoint(weapon: { pos: Vec2; h: number }): Vec2 & { h: number } {
  const cx = (C.east + C.west) / 2
  const dx = cx - weapon.pos.x
  const dz = 0 - weapon.pos.z
  const d = Math.hypot(dx, dz) || 1
  return { x: weapon.pos.x + (dx / d) * 2.0, z: weapon.pos.z + (dz / d) * 2.0, h: weapon.h }
}

/** 초기 배치를 실제 유닛으로 — 재배치는 부대 명령으로.
 *
 *  장착제 (2026-08-08): crew가 정의된 병기 수만큼 수비병을 만들되, 병기 곁이 아니라
 *  **안뜰에 2열 종대로 집결**시킨다. 병기는 빈 채로 시작하고(전 병기 침묵), 플레이어가
 *  준비 단계에 수비병을 보내 장착해야 쏜다 — 배치가 곧 플레이의 첫 수다. */
function initialUnits(loadout: Loadout, nextId: () => number): FriendlyUnit[] {
  const units: FriendlyUnit[] = []
  const spawn = (kind: string, x: number, z: number, h: number): void => {
    units.push({
      id: nextId(),
      kind,
      pos: { x, z },
      h,
      hp: loadout.unitKinds[kind]!.hp,
      facing: Math.PI / 2, // 동쪽(적 방향)을 본다
      target: null,
      path: [],
      cooldown: 0,
      cds: [0, 0, 0],
      // 초기값은 **자동 조준**(null = 사거리 내 최근접). 플레이어가 겨눠야 비로소 화망이
      // 좁아지고 흐름이 생긴다. 처음부터 좁게 겨눈 상태로 시작하면 손대지 않은 판이
      // 성립하지 않아서(무개입 0/6으로 측정됨) "조준은 선택적 개선"이라는 전제가 깨진다.
      aim: null,
    })
  }
  let crews = 0
  for (const p of loadout.placements) {
    spawn(p.kind, p.x, p.z, p.h)
    const crewKind = loadout.unitKinds[p.kind]!.crew
    if (crewKind && loadout.unitKinds[crewKind]) crews++
  }
  // 안뜰 집결 대형 — 성문 안쪽, 동벽에서 한 발 물러난 2열 종대(열 6명, z 간격 2).
  // z 범위는 **두 경사로 입구(z≈±5) 사이**로 제한한다: 경사로는 바닥 끝에서만 오를 수
  // 있어서(중턱 옆은 Δh>1.5), 집결이 입구 밖(±7.5)에 있으면 절반이 목표를 등지고 걷다
  // 유턴하는 그림이 나온다 — "계단 올라가는 게 어색하다" 원인 실측(2026-08-08).
  // 내성 관통 차단 구간(x < west+10.5)과 영웅 초기 위치(WALL_X-6, 0)를 피한다.
  const crewKind = Object.values(loadout.unitKinds).find((d) => d.crew)?.crew
  for (let i = 0; i < crews; i++) {
    const row = Math.floor(i / 6)
    const col = i % 6
    spawn(crewKind!, WALL_X - 7 - row * 2, -5 + col * 2, 0)
  }
  return units
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
      lord: { pos: { x: WALL_X - 9, z: 2 }, facing: 0, target: null, path: [], h: 0, cds: [0, 0, 0] },
      units,
      enemies: [],
      corpses: [],
      shots: [],
      effects: [],
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
/**
 * 성문 터널 안인가. 터널은 보도 **아래**를 지나므로 성벽 위에서는 시야가 닿지 않는다.
 * 이 구멍이 「성문 돌파」가 성립하는 이유다 — 안뜰 방어는 지상 전력의 몫으로 남는다.
 */
function inGateTunnel(x: number, z: number): boolean {
  return Math.abs(z) <= C.gateHalf && x >= C.east - halfT && x <= C.east + halfT
}

function acquireTarget(
  u: FriendlyUnit,
  enemies: ActiveEnemy[],
  def: UnitKindDef,
  enemyKinds: Record<string, EnemyKindDef>,
): ActiveEnemy | null {
  /**
   * near 주변 limit 안에서 고른다. **사거리는 적의 반경까지 포함해 잰다** — 공격은 중심이
   * 아니라 몸통에 닿는다. 이게 없으면 근접이 일방적으로 맞는다: 괴수의 접전 거리는
   * (자기 반경 + 아군 반경 + 0.9)라 야귀 1.9·갑주귀 2.3에서 때리는데 수비병 사거리는
   * 1.6이라 반격이 불가능했다 ("병사가 검으로 공격을 안 한다" 실측 반려 2026-08-09).
   * addRadius=false인 조준(aimRadius) 경로는 "조준점에서 얼마나 퍼졌나"라 의미가 달라 제외.
   */
  const pick = (near: Vec2, limit: number, addRadius: boolean): ActiveEnemy | null => {
    let best: ActiveEnemy | null = null
    let bestD = Infinity
    for (const e of enemies) {
      if (u.h >= 1 && inGateTunnel(e.pos.x, e.pos.z)) continue // 발 밑 터널은 못 쏜다
      const er = enemyKinds[e.kind]?.radius ?? 0
      if (Math.hypot(e.pos.x - u.pos.x, e.pos.z - u.pos.z) > def.range + er) continue // 사거리 절대 조건
      const d = Math.hypot(e.pos.x - near.x, e.pos.z - near.z)
      if (d <= limit + (addRadius ? er : 0) && (d < bestD || (d === bestD && best !== null && e.id < best.id))) {
        best = e
        bestD = d
      }
    }
    return best
  }
  if (u.aim && def.aimRadius) {
    const aimed = pick(u.aim, def.aimRadius, false)
    if (aimed) return aimed
  }
  return pick(u.pos, def.range, true)
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
  const base: ActiveEnemy = {
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
    mode: 'wall',
    stunT: 0,
  }
  // 성문 돌파 — **성문 구간을 목표로 뽑힌 개체만**, 성문 앞 화망이 얇을 때.
  //
  // 여기까지 오는 데 두 번 틀렸다. ①스폰 시점에 아무나 성문으로 보냈더니 필드를
  // 혼자 가로질러 도착 전에 죽었다(판정 32건, 진입 0). ②벽에 닿은 뒤 전환하게 했더니
  // 벽면을 따라 성문까지 걷는 1초 동안 성문 발리스타 밑에서 HP 190→50이 됐다(진입 0).
  // 결국 **원래 목표가 성문 근처인 개체만** 곧장 성문으로 보내는 게 맞다 —
  // 무리와 같은 방향으로 접근하니 노출이 다른 개체와 다르지 않다.
  if (def.breach && Math.abs(seg.probe.z) <= C.gateHalf + 2 && seg.face === 'east' && wantsBreach(state, def, id)) {
    base.mode = 'breach'
    base.via = { x: C.east + halfT + def.radius + 0.3, z: 0 }
    base.aim = { x: C.east - halfT - 3, z: 0 }
  }
  return base
}

/** 성문 앞 화망 대비 돌파 확률. 성문을 평균 이상으로 지키면 0이 된다 */
function wantsBreach(state: SiegeState, def: EnemyKindDef, id: number): boolean {
  const gate: ApproachSegment = {
    id: -1,
    face: 'east',
    probe: { x: C.east + halfT, z: 0 },
    normal: { x: 1, z: 0 },
    via: null,
  }
  const east = SEGMENTS.filter((s) => s.face === 'east')
  const mean = east.reduce((a, s) => a + segmentThreat(state, s), 0) / east.length
  const gateThreat = segmentThreat(state, gate)
  const slack = mean > 0 ? Math.max(0, 1 - gateThreat / mean) : 1
  return hashRand(state.seed ^ 0x5bf03635, id) < def.breach! * slack
}

/** 개체의 현재 속도 벡터 (유닛/초). 벽에 붙었거나 목표가 없으면 0 */
function enemyVelocity(state: SiegeState, e: ActiveEnemy): Vec2 {
  if (e.atWall) return { x: 0, z: 0 }
  const wp = e.via ?? e.aim
  const dx = wp.x - e.pos.x
  const dz = wp.z - e.pos.z
  const d = Math.hypot(dx, dz)
  if (d < 1e-4) return { x: 0, z: 0 }
  const sp = state.kinds.enemies[e.kind]!.speed
  return { x: (dx / d) * sp, z: (dz / d) * sp }
}

/** 예측 사격 — 포탄이 도착할 시점의 표적 위치. 고정점 반복 2회면 수렴한다 */
function leadTarget(state: SiegeState, from: Vec2, tgt: ActiveEnemy, projSpeed: number): Vec2 {
  const v = enemyVelocity(state, tgt)
  let t = Math.hypot(tgt.pos.x - from.x, tgt.pos.z - from.z) / projSpeed
  for (let i = 0; i < 2; i++) {
    const px = tgt.pos.x + v.x * t
    const pz = tgt.pos.z + v.z * t
    t = Math.hypot(px - from.x, pz - from.z) / projSpeed
  }
  return { x: tgt.pos.x + v.x * t, z: tgt.pos.z + v.z * t }
}

/** 안뜰에서 쫓을 지상 아군 (결정론 — 거리 동률이면 id 순) */
function nearestGround(state: SiegeState, e: ActiveEnemy): FriendlyUnit | null {
  let best: FriendlyUnit | null = null
  let bestD = Infinity
  for (const u of state.units) {
    if (u.h >= 1) continue
    const d = Math.hypot(u.pos.x - e.pos.x, u.pos.z - e.pos.z)
    if (d < bestD || (d === bestD && best !== null && u.id < best.id)) {
      best = u
      bestD = d
    }
  }
  return best
}

/** 시체가 삭기까지 (초) — 무한히 쌓아두고 후반에 몰아서 되살리는 걸 막는다 */
const CORPSE_ROT_SECONDS = 22

/** 고정 1틱 전진. 결정론 — 입력 외 외부 상태 없음 */
export function stepSiege(state: SiegeState, spawns: EnemySpawn[], input: SiegeInput): SiegeState {
  state.events = []
  if (state.status === 'won' || state.status === 'lost') return state
  state.tick++

  // 만료된 지속 효과 정리 + 이동 버프 배율 (진군 나팔 — 반경 안 아군만)
  if (state.effects.length > 0) state.effects = state.effects.filter((e) => e.until > state.tick)
  const moveMult = (p: Vec2): number => {
    let m = 1
    for (const ef of state.effects) {
      if (ef.type !== 'move') continue
      const c = ef.followLord ? state.lord.pos : ef
      if (Math.hypot(p.x - c.x, p.z - c.z) <= ef.radius) m = Math.max(m, ef.mult ?? 1)
    }
    return m
  }

  // 성주 이동 (우클릭 명령 → BFS 경로 추종 — 계단·성문 자동 경유)
  if (input.moveTo) commandMove(state.lord, input.moveTo, input.moveTo.h ?? 0)
  stepMover(state.lord, LORD_SPEED * moveMult(state.lord.pos))
  for (let i = 0; i < state.lord.cds.length; i++) if (state.lord.cds[i]! > 0) state.lord.cds[i]!--

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
      u.aggro = input.unitMove.attack === true // 일반 이동은 어택땅을 해제한다
      u.holding = false // 이동 명령은 홀드를 푼다
      slot++
    }
  }

  // 정지 명령 — 그 자리에서 경로를 버린다 (정지 = 사격 가능 상태)
  if (input.unitStop) {
    for (const id of [...input.unitStop.ids].sort((a, b) => a - b)) {
      const u = state.units.find((v) => v.id === id)
      if (!u) continue
      u.path = []
      u.target = null
      u.aggro = false
      u.holding = true // 홀드 — 자동 교전으로도 자리를 뜨지 않는다
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
    for (let i = 0; i < u.cds.length; i++) if (u.cds[i]! > 0) u.cds[i]!--
    // 어택땅 — 이동 중 사거리(+반경) 안에 적이 들어오면 그 자리에 멈춰 교전.
    // 재개는 없다(SC와 달리): 웨이브가 계속 밀려오는 판이라 접적 후엔 그 자리가 전선이다.
    if (u.aggro && u.path.length > 0) {
      const def = state.kinds.units[u.kind]!
      const engage = def.range + def.radius
      for (const e of state.enemies) {
        if (Math.hypot(e.pos.x - u.pos.x, e.pos.z - u.pos.z) <= engage) {
          u.path = []
          u.target = null
          u.aggro = false
          break
        }
      }
    }
    stepMover(u, state.kinds.units[u.kind]!.speed * moveMult(u.pos))
  }

  // 스킬 시전 Q/W/E (2026-08-08 개편) — 성주는 버프, 전사는 공격기, 마법사는 화염.
  // 사거리 밖·쿨다운 중·시전자 없음이면 무시 (결정론 검증 — 봇과 플레이어가 같은 규칙)
  if (input.castSkill) {
    const c = input.castSkill
    const caster = c.casterId === undefined ? null : state.units.find((u) => u.id === c.casterId)
    const def = c.casterId === undefined ? LORD_SKILLS[c.slot] : state.kinds.units[caster?.kind ?? '']?.skills?.[c.slot]
    const cds = caster ? caster.cds : state.lord.cds
    const from = caster ? caster.pos : state.lord.pos
    const fromH = caster ? caster.h : state.lord.h
    if (def && (c.casterId === undefined || caster) && (cds[c.slot] ?? 1) <= 0) {
      // 지점 스킬은 지점·사거리 검증, 자기 중심 스킬은 시전자 위치가 곧 지점
      const at =
        !def.targeted
          ? { x: from.x, z: from.z }
          : c.x !== undefined && c.z !== undefined && Math.hypot(c.x - from.x, c.z - from.z) <= def.range
            ? { x: c.x, z: c.z }
            : null
      if (at) {
        cds[c.slot] = Math.round(def.cooldown * TICKS_PER_SECOND)
        if (caster && def.targeted) caster.facing = Math.atan2(at.x - from.x, at.z - from.z)
        if (def.dash && caster) {
          // 돌진 — 같은 층 연속 지형만 밟아 닿는 데까지 즉시 주파, 경로 폭 안의 적 피해
          const dx = at.x - from.x
          const dz = at.z - from.z
          const dist = Math.hypot(dx, dz) || 1
          const start = { x: from.x, z: from.z }
          let end = { x: from.x, z: from.z, h: fromH }
          for (let s = 0.5; s <= dist + 1e-6; s += 0.5) {
            const px = start.x + (dx / dist) * s
            const pz = start.z + (dz / dist) * s
            const nh = stepHeight(end.h, px, pz)
            if (nh === null) break
            end = { x: px, z: pz, h: nh }
          }
          const segX = end.x - start.x
          const segZ = end.z - start.z
          const segLen2 = segX * segX + segZ * segZ || 1
          for (const e of state.enemies) {
            const t = Math.max(0, Math.min(1, ((e.pos.x - start.x) * segX + (e.pos.z - start.z) * segZ) / segLen2))
            const qx = start.x + segX * t - e.pos.x
            const qz = start.z + segZ * t - e.pos.z
            if (Math.hypot(qx, qz) <= def.radius + state.kinds.enemies[e.kind]!.radius) e.hp -= def.dmg!
          }
          caster.pos.x = end.x
          caster.pos.z = end.z
          caster.h = end.h
          caster.path = []
          caster.target = null
        } else if (def.dmg) {
          for (const e of state.enemies) {
            if (Math.hypot(e.pos.x - at.x, e.pos.z - at.z) <= def.radius) {
              e.hp -= def.dmg
              if (def.stunSec) e.stunT = Math.max(e.stunT, Math.round(def.stunSec * TICKS_PER_SECOND))
            }
          }
        }
        if (def.zone) {
          state.effects.push({
            type: 'zone', x: at.x, z: at.z, radius: def.radius,
            until: state.tick + Math.round(def.zone.sec * TICKS_PER_SECOND), dps: def.zone.dps,
          })
        }
        if (def.buff) {
          state.effects.push({
            type: def.buff.stat, x: from.x, z: from.z, radius: def.radius,
            until: state.tick + Math.round(def.buff.sec * TICKS_PER_SECOND), mult: def.buff.mult, global: def.buff.global,
            followLord: !caster, // 성주 버프는 성주를 따라다니는 오라
          })
        }
        state.events.push({
          type: 'skillCast', casterKind: caster ? caster.kind : 'lord', casterId: caster?.id,
          slot: c.slot, name: def.name, x: at.x, z: at.z, radius: def.radius,
        })
      }
    }
  }

  // 유닛 간 겹침 분리 (같은 층만, 층 이탈 금지 — 성벽에서 밀려 떨어지지 않게)
  for (let i = 0; i < state.units.length; i++) {
    for (let j = i + 1; j < state.units.length; j++) {
      const a = state.units[i]!
      const b = state.units[j]!
      // 행군 관통 (장착제 2026-08-08): **이동 중인 유닛은 밀어내지도 밀리지도 않는다** —
      // 분리는 정지한 유닛 사이에서만. 두 번의 실측이 이 규칙을 요구했다:
      //  1) 안뜰에서 집결 출발한 수비병들이 폭 2.6짜리 경사로에 동시에 몰리면 서로 밀어내며
      //     영원히 오르지 못한다 (6기가 입구에서 100초+ 공회전 → 판이 prep에서 안 끝남)
      //  2) 경로 격자가 포좌 곁 1.0을 지나는데 분리가 1.45로 밀어내 웨이포인트 도달
      //     판정(0.14)을 영원히 못 넘긴다 (수비병 1기가 대포 옆에서 무한 제자리걸음)
      // 정지하면 그 자리에서 겹침이 풀린다. RTS 관례(행군 관통)와 같다.
      if (a.path.length > 0 || b.path.length > 0) continue
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

  // 자동 교전 [2026-08-09] — 근접 지상 유닛은 코앞의 적에게 **스스로 다가가 싸운다**.
  // 없을 때의 그림: 병사 무리와 괴수가 3~6 거리에서 서로 지나치며 아무 일도 안 일어난다
  // (괴수는 접전 거리 1.9 안에서만 때리고, 병사는 도달 2.2라 서로 안 닿는다 — 사용자 실측).
  // 규칙은 셋으로 좁혔다: ①근접(사거리 ≤3)만 ②지상만(성벽 위는 내려가면 안 된다)
  // ③**병기를 조작 중이면 제외**(자리를 뜨면 성벽 화력이 통째로 멈춘다 — 장착제의 뿌리).
  // 홀드(H) 중이거나 이미 명령을 수행 중이면 건드리지 않는다.
  {
    const manned = new Set(manningMap(state).values())
    for (const u of state.units) {
      const def = state.kinds.units[u.kind]!
      if (def.emplaced || def.range > 3) continue
      if (u.h >= 1 || u.holding || u.path.length > 0 || u.target) continue
      if (manned.has(u.id)) continue
      let best: ActiveEnemy | null = null
      let bestD = Infinity
      for (const e of state.enemies) {
        if (e.pos.x > FIELD.maxX - 2) continue // 이제 막 스폰된 개체까지 쫓아가진 않는다
        const d = Math.hypot(e.pos.x - u.pos.x, e.pos.z - u.pos.z)
        if (d > AUTO_ENGAGE_RADIUS) continue
        if (d < bestD || (d === bestD && best !== null && e.id < best.id)) {
          best = e
          bestD = d
        }
      }
      // 이미 닿는 거리면 그 자리에서 때린다(사격 루프가 처리) — 굳이 다가가지 않는다
      if (best && bestD > def.range + (state.kinds.enemies[best.kind]?.radius ?? 0)) {
        commandMove(u, { x: best.pos.x, z: best.pos.z }, 0)
        u.aggro = true // 접적하면 그 자리에 선다 (어택땅과 같은 규칙)
      }
    }
  }

  // 장착 정위치 (2026-08-08 사용자: "장착되면 자리가 딱 지정되면 좋겠다") —
  // 배정된 수비병은 명령 이동 중이 아니면 조작 위치(mountPoint)로 걸어 들어가 고정되고,
  // 정위치에선 **포와 같은 방향을 본다** (조준을 돌리면 병사도 함께 돈다 — 포병처럼).
  // 반경 2.4 안 아무 데나 서성이면 장착이 화면에서 읽히지 않는다.
  {
    const map = manningMap(state)
    for (const [wid, gid] of map) {
      const w = state.units.find((u) => u.id === wid)!
      const g = state.units.find((u) => u.id === gid)!
      if (g.path.length > 0) continue
      const p = mountPoint(w)
      const dx = p.x - g.pos.x
      const dz = p.z - g.pos.z
      const d = Math.hypot(dx, dz)
      const step = state.kinds.units[g.kind]!.speed * DT
      if (d > step) {
        const nx = g.pos.x + (dx / d) * step
        const nz = g.pos.z + (dz / d) * step
        const nh = stepHeight(g.h, nx, nz)
        if (nh !== null) {
          g.pos.x = nx
          g.pos.z = nz
          g.h = nh
          g.facing = Math.atan2(dx / d, dz / d)
        }
      } else {
        g.pos.x = p.x
        g.pos.z = p.z
        g.facing = w.facing // 정위치 — 포신과 함께 돈다
      }
    }
  }

  if (state.status === 'prep') {
    if (input.startAssault) {
      state.status = 'assault'
      state.tick = 0 // 침공 타임라인 기준으로 리셋
      state.effects = [] // 준비 단계 시전분은 이월하지 않는다 (until이 틱 기준이라 리셋과 어긋남)
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

  // 착탄 처리 — 이번 틱에 도착한 포탄. 발사 시점의 지점에 터지므로 그 사이 움직인 개체는 흘린다
  if (state.shots.length > 0) {
    const landed = state.shots.filter((p) => p.hitTick <= state.tick)
    if (landed.length > 0) {
      state.shots = state.shots.filter((p) => p.hitTick > state.tick)
      for (const p of landed) {
        if (p.aoe) {
          for (const e of state.enemies) {
            if (Math.hypot(e.pos.x - p.to.x, e.pos.z - p.to.z) <= p.aoe) e.hp -= p.dmg
          }
        } else {
          // 단일 표적 — 착탄점에 가장 가까운 1기만. 비켜섰으면 헛맞는다
          let best: ActiveEnemy | null = null
          let bestD = Infinity
          for (const e of state.enemies) {
            const d = Math.hypot(e.pos.x - p.to.x, e.pos.z - p.to.z)
            const reach = state.kinds.enemies[e.kind]!.radius + 0.5
            if (d <= reach && (d < bestD || (d === bestD && best !== null && e.id < best.id))) {
              best = e
              bestD = d
            }
          }
          if (best) best.hp -= p.dmg
        }
        state.events.push({ type: 'shotLanded', x: p.to.x, z: p.to.z, unitKind: p.unitKind, aoe: p.aoe })
      }
    }
  }

  // 불의 장막 — 장판 위의 적에게 초당 피해 (마법사 W)
  for (const ef of state.effects) {
    if (ef.type !== 'zone') continue
    const perTick = ef.dps! / TICKS_PER_SECOND
    for (const e of state.enemies) {
      if (Math.hypot(e.pos.x - ef.x, e.pos.z - ef.z) <= ef.radius + state.kinds.enemies[e.kind]!.radius) {
        e.hp -= perTick
      }
    }
  }

  // 성주 버프 — 군기(반경 내 병기 재장전 2배) / 총력전(전역 재장전 2배 + 공격력 배율)
  const allBuff = state.effects.find((e) => e.type === 'all')
  const dmgMult = allBuff?.mult ?? 1
  const reloadBoosted = (u: FriendlyUnit): boolean => {
    if (allBuff) return true
    for (const ef of state.effects) {
      if (ef.type !== 'reload') continue
      const c = ef.followLord ? state.lord.pos : ef
      if (Math.hypot(u.pos.x - c.x, u.pos.z - c.z) <= ef.radius) return true
    }
    return false
  }

  // 아군 사격 — 정지 상태에서만 (이동 중 발사 불가)
  for (const u of state.units) {
    if (u.cooldown > 0) u.cooldown = Math.max(0, u.cooldown - (reloadBoosted(u) ? 2 : 1))
    if (u.path.length > 0 || u.cooldown > 0 || !isCrewManned(state, u)) continue // 조작 병사가 곁에 없는 병기는 침묵한다
    const def = state.kinds.units[u.kind]!
    const tgt = acquireTarget(u, state.enemies, def, state.kinds.enemies)
    if (!tgt) continue
    u.facing = Math.atan2(tgt.pos.x - u.pos.x, tgt.pos.z - u.pos.z)
    u.cooldown = Math.round(def.atkInterval * TICKS_PER_SECOND)
    let to = { x: tgt.pos.x, z: tgt.pos.z }
    let flight = 0
    if (def.projectileSpeed) {
      // 비행 — 도착할 때까지 피해가 없다. 표적의 **현재 위치**로 쏘면 항상 뒤에 떨어지므로
      // (실측: 전 시드 패배) 포수처럼 예측해서 쏜다. 두 번 되풀이하면 충분히 수렴한다.
      // 직진하는 개체는 맞고, **방향을 트는 개체는 흘린다** — 그게 이 규칙이 만드는 차이다.
      to = leadTarget(state, u.pos, tgt, def.projectileSpeed)
      const d = Math.hypot(to.x - u.pos.x, to.z - u.pos.z)
      flight = Math.max(1, Math.round((d / def.projectileSpeed) * TICKS_PER_SECOND))
      state.shots.push({
        id: state.nextId++,
        unitKind: u.kind,
        from: { x: u.pos.x, z: u.pos.z, h: u.h },
        to,
        hitTick: state.tick + flight,
        flight,
        dmg: Math.round(def.dmg * dmgMult), // 총력전 중 발사분은 착탄까지 배율 유지
        aoe: def.aoe,
      })
    } else if (def.aoe) {
      for (const e of state.enemies) {
        if (Math.hypot(e.pos.x - to.x, e.pos.z - to.z) <= def.aoe) e.hp -= Math.round(def.dmg * dmgMult)
      }
    } else {
      tgt.hp -= Math.round(def.dmg * dmgMult)
    }
    state.events.push({
      type: 'unitFired',
      unitId: u.id,
      unitKind: u.kind,
      targetId: tgt.id,
      from: { x: u.pos.x, z: u.pos.z, h: u.h },
      to,
      flight,
    })
  }

  // 괴수: 지상 아군과 접전 > 성벽 공격 > 성벽으로 직진
  for (const e of state.enemies) {
    // 기절 (전사 대지파쇄) — 이동·공격 전부 정지. 쿨다운도 얼린다(깨어나자마자 치지 않게)
    if (e.stunT > 0) {
      e.stunT--
      continue
    }
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
      // 돌파 개체는 성문을 지난 뒤 안뜰의 지상 아군을 쫓는다 — 성벽은 때리지 않는다.
      // (성벽 위 병기는 이들에게 닿지 않는 대신, 위협 계산에 안 잡히던 지상 전력이
      //  비로소 값어치를 한다 — 가시성 규칙의 뒷면이다)
      if (e.mode === 'breach' && !e.via) {
        const prey = nearestGround(state, e)
        if (prey) {
          e.aim.x = prey.pos.x
          e.aim.z = prey.pos.z
        }
      }
      const wp = e.via ?? e.aim
      const dx = wp.x - e.pos.x
      const dz = wp.z - e.pos.z
      const d = Math.hypot(dx, dz)
      const step = def.speed * DT
      if (d <= step) {
        e.pos.x = wp.x
        e.pos.z = wp.z
        if (e.via) e.via = null
        else if (e.mode === 'wall') e.atWall = true
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
    if (boss.stunT > 0) continue // 기절한 술사는 되살리지 못한다
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
