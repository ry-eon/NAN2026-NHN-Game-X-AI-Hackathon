// 절차 조형 모델 v2 — "제대로 된" 절차 모델링 검증 슬라이스.
// 원칙: 베벨(모서리가 빛을 받게), 프로파일(건축·갑주 몰딩), 부품 조립(단일 프리미티브 금지).
// 기사는 풀헬름으로 얼굴 문제를 회피 — 하드서피스만으로 성립하는 디자인.

import * as THREE from 'three'

// ---------------------------------------------------------------- 재질

export const MATS = {
  steel: new THREE.MeshStandardMaterial({ color: 0x8a8f9a, metalness: 0.85, roughness: 0.38 }),
  steelDark: new THREE.MeshStandardMaterial({ color: 0x4a4e58, metalness: 0.8, roughness: 0.45 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xb08d3e, metalness: 0.9, roughness: 0.32 }),
  clothRed: new THREE.MeshStandardMaterial({ color: 0x4a1414, roughness: 0.95 }),
  clothDark: new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.95 }),
  leather: new THREE.MeshStandardMaterial({ color: 0x3a2c1e, roughness: 0.85 }),
  iron: new THREE.MeshStandardMaterial({ color: 0x33353c, metalness: 0.75, roughness: 0.55 }),
}

/** 베벨 박스 — 모서리가 빛을 받아 '모델링된' 인상을 만든다 */
export function bevelBox(
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  bevel = 0.03,
): THREE.Mesh {
  const shape = new THREE.Shape()
  const hw = w / 2 - bevel
  const hh = h / 2 - bevel
  shape.moveTo(-hw, -hh)
  shape.lineTo(hw, -hh)
  shape.lineTo(hw, hh)
  shape.lineTo(-hw, hh)
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: d - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
  })
  geo.translate(0, 0, -(d - bevel * 2) / 2)
  const mesh = new THREE.Mesh(geo, mat)
  mesh.castShadow = true
  return mesh
}

/** 회전 프로파일 (lathe) 헬퍼 */
function lathe(
  points: [number, number][],
  mat: THREE.Material,
  segments = 20,
): THREE.Mesh {
  const geo = new THREE.LatheGeometry(
    points.map(([x, y]) => new THREE.Vector2(x, y)),
    segments,
  )
  const mesh = new THREE.Mesh(geo, mat)
  mesh.castShadow = true
  return mesh
}

// ---------------------------------------------------------------- 기사 (성주/영웅 공용 골격)

export interface Rig {
  root: THREE.Group
  lArm: THREE.Group
  rArm: THREE.Group
  lLeg: THREE.Group
  rLeg: THREE.Group
  torso: THREE.Group
  cloak?: THREE.Mesh
}

/**
 * 풀아머 기사 (신장 ≈1.9). accent = 천 색상(진영/영웅 구분).
 * 부품: 투구(프로파일+바이저 슬릿+크레스트) / 흉갑(lathe 배럴) / 견갑(반구 2겹) /
 * 폴드 스커트 / 팔·다리(상완·전완 분절+장갑) / 망토 / 검+칼집.
 * archer = 궁수 변형: 검·크레스트 대신 활 + 화살통 (실루엣으로 병종 구분)
 */
export function makeKnight(accent = 0x4a1414, gilded = false, archer = false): Rig {
  const root = new THREE.Group()
  const cloth = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.95 })
  const trim = gilded ? MATS.gold : MATS.steelDark

  // ---- 다리 (엉덩이 피벗 그룹 — 보행 애니메이션용)
  const mkLeg = (side: number): THREE.Group => {
    const leg = new THREE.Group()
    leg.position.set(side * 0.16, 0.95, 0)
    const thigh = lathe(
      [
        [0.11, 0],
        [0.13, -0.12],
        [0.1, -0.42],
      ],
      MATS.steelDark,
      12,
    )
    const shin = lathe(
      [
        [0.09, -0.42],
        [0.11, -0.5],
        [0.08, -0.86],
      ],
      MATS.steel,
      12,
    )
    const boot = bevelBox(0.2, 0.1, 0.34, MATS.steelDark, 0.02)
    boot.position.set(0, -0.9, 0.06)
    leg.add(thigh, shin, boot)
    return leg
  }
  const lLeg = mkLeg(-1)
  const rLeg = mkLeg(1)

  // ---- 몸통 그룹 (호흡·기울임)
  const torso = new THREE.Group()
  // 폴드(허리 치마 장갑) — 계단식 링 3장
  for (let i = 0; i < 3; i++) {
    const fauld = lathe(
      [
        [0.26 + i * 0.03, 1.06 - i * 0.07],
        [0.29 + i * 0.03, 0.99 - i * 0.07],
      ],
      i % 2 ? MATS.steelDark : MATS.steel,
      16,
    )
    torso.add(fauld)
  }
  // 흉갑 — 배럴 프로파일 (허리 좁고 가슴 넓은)
  const cuirass = lathe(
    [
      [0.24, 1.06],
      [0.3, 1.18],
      [0.32, 1.34],
      [0.28, 1.5],
      [0.19, 1.58],
    ],
    MATS.steel,
    18,
  )
  torso.add(cuirass)
  // 가슴 문장 (마름모)
  const emblem = bevelBox(0.12, 0.12, 0.02, trim, 0.01)
  emblem.rotation.z = Math.PI / 4
  emblem.position.set(0, 1.36, 0.315)
  torso.add(emblem)
  // 벨트
  const belt = lathe(
    [
      [0.255, 1.1],
      [0.255, 1.05],
    ],
    MATS.leather,
    16,
  )
  torso.add(belt)

  // ---- 견갑 (겹판 2장씩)
  for (const side of [-1, 1]) {
    const p1 = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      MATS.steel,
    )
    p1.position.set(side * 0.33, 1.5, 0)
    p1.castShadow = true
    const p2 = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      MATS.steelDark,
    )
    p2.position.set(side * 0.38, 1.42, 0)
    p2.castShadow = true
    torso.add(p1, p2)
  }

  // ---- 팔 (어깨 피벗)
  const mkArm = (side: number): THREE.Group => {
    const arm = new THREE.Group()
    arm.position.set(side * 0.36, 1.46, 0)
    const upper = lathe(
      [
        [0.08, 0],
        [0.09, -0.1],
        [0.07, -0.3],
      ],
      cloth,
      10,
    )
    const lower = lathe(
      [
        [0.065, -0.3],
        [0.08, -0.38],
        [0.06, -0.58],
      ],
      MATS.steel,
      10,
    )
    const gauntlet = bevelBox(0.11, 0.13, 0.13, MATS.steelDark, 0.02)
    gauntlet.position.y = -0.63
    arm.add(upper, lower, gauntlet)
    return arm
  }
  const lArm = mkArm(-1)
  const rArm = mkArm(1)

  // ---- 투구: 프로파일 돔 + 바이저 슬릿 + 크레스트
  const helm = lathe(
    [
      [0.155, 1.62],
      [0.175, 1.7],
      [0.175, 1.84],
      [0.15, 1.94],
      [0.09, 2.0],
      [0.0, 2.02],
    ],
    MATS.steel,
    18,
  )
  torso.add(helm)
  // 바이저 슬릿 (검은 띠) — 얼굴 없음이 곧 디자인
  const visor = new THREE.Mesh(
    new THREE.CylinderGeometry(0.178, 0.178, 0.045, 18, 1, true, -0.7, 1.4),
    new THREE.MeshBasicMaterial({ color: 0x000000 }),
  )
  visor.position.y = 1.8
  torso.add(visor)
  // 크레스트 (세로 볏) — 궁수는 없음 (실루엣 구분)
  if (!archer) {
    const crest = bevelBox(0.035, 0.22, 0.38, cloth, 0.012)
    crest.position.set(0, 2.04, -0.02)
    torso.add(crest)
  }
  if (gilded) {
    const circlet = new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.022, 8, 18), MATS.gold)
    circlet.rotation.x = Math.PI / 2
    circlet.position.y = 1.88
    circlet.castShadow = true
    torso.add(circlet)
  }

  // ---- 망토 (등 뒤, 바람 애니메이션 대상)
  const cloakGeo = new THREE.PlaneGeometry(0.55, 1.05, 4, 8)
  cloakGeo.translate(0, -0.52, 0)
  const cloak = new THREE.Mesh(
    cloakGeo,
    new THREE.MeshStandardMaterial({ color: accent, roughness: 0.98, side: THREE.DoubleSide }),
  )
  cloak.position.set(0, 1.52, -0.2)
  cloak.castShadow = true
  torso.add(cloak)

  if (archer) {
    // ---- 활 (왼손 고정 — 팔과 함께 흔들린다) + 등 뒤 화살통
    const bowGroup = new THREE.Group()
    const bowArc = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.022, 6, 14, Math.PI * 0.92),
      MATS.leather,
    )
    bowArc.rotation.z = Math.PI / 2 - Math.PI * 0.46 // 호가 세로로 서게
    const string = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.77, 4),
      new THREE.MeshBasicMaterial({ color: 0xd8d2c0 }),
    )
    string.position.x = -0.08
    bowGroup.add(bowArc, string)
    bowGroup.position.set(0, -0.66, 0.12)
    bowGroup.rotation.y = Math.PI / 2
    lArm.add(bowGroup)
    const quiver = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.5, 8), MATS.leather)
    quiver.position.set(0.14, 1.42, -0.22)
    quiver.rotation.z = -0.3
    quiver.castShadow = true
    torso.add(quiver)
    for (let i = 0; i < 3; i++) {
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.09, 5), MATS.steelDark)
      tip.position.set(0.1 + i * 0.045, 1.72, -0.24)
      torso.add(tip)
    }
  } else {
    // ---- 검 (칼집, 왼쪽 허리)
    const scabbard = new THREE.Group()
    const sheath = bevelBox(0.05, 0.78, 0.09, MATS.leather, 0.015)
    sheath.position.y = -0.32
    const guard = bevelBox(0.16, 0.03, 0.05, trim, 0.01)
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.14, 8), MATS.leather)
    grip.position.y = 0.08
    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), trim)
    pommel.position.y = 0.16
    scabbard.add(sheath, guard, grip, pommel)
    scabbard.position.set(-0.3, 1.02, 0.05)
    scabbard.rotation.z = 0.18
    torso.add(scabbard)
  }

  root.add(lLeg, rLeg, torso, lArm, rArm)
  // 그림자는 실루엣을 만드는 큰 부품만 — 기사 1기당 그림자 패스 드로우콜 절반 이하
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.computeBoundingSphere()
      o.castShadow = (o.geometry.boundingSphere?.radius ?? 1) > 0.16
    }
  })
  return { root, lArm, rArm, lLeg, rLeg, torso, cloak }
}

/** 보행/대기 절차 애니메이션 — moving 여부에 따라 팔다리 스윙·호흡 */
export function animateRig(rig: Rig, t: number, moving: boolean): void {
  if (moving) {
    const swing = Math.sin(t * 9)
    rig.lLeg.rotation.x = swing * 0.55
    rig.rLeg.rotation.x = -swing * 0.55
    rig.lArm.rotation.x = -swing * 0.4
    rig.rArm.rotation.x = swing * 0.4
    rig.root.position.y = Math.abs(Math.cos(t * 9)) * 0.05
    rig.torso.rotation.x = 0.06
    if (rig.cloak) rig.cloak.rotation.x = 0.25 + Math.sin(t * 9) * 0.06
  } else {
    const breathe = Math.sin(t * 1.8)
    rig.lLeg.rotation.x = 0
    rig.rLeg.rotation.x = 0
    rig.lArm.rotation.x = breathe * 0.03
    rig.rArm.rotation.x = -breathe * 0.03
    rig.root.position.y = 0
    rig.torso.rotation.x = 0
    rig.torso.position.y = breathe * 0.008
    if (rig.cloak) rig.cloak.rotation.x = 0.08 + breathe * 0.02
  }
}

// ---------------------------------------------------------------- 공성 병기 (전방 = +Z, 기사와 동일 규약)

const MAT_WOOD = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.88 })
const MAT_WOOD_DARK = new THREE.MeshStandardMaterial({ color: 0x33261a, roughness: 0.9 })

/** 대포 — 포신(lathe 프로파일) + 목재 포가 + 바퀴 2륜 */
export function makeCannon(): THREE.Group {
  const g = new THREE.Group()
  // 포신: 포미(두꺼움)→포구(좁아짐) 프로파일, 수평으로 눕혀 +Z를 향한다
  const barrel = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.0, 0),
        new THREE.Vector2(0.22, 0),
        new THREE.Vector2(0.24, 0.18),
        new THREE.Vector2(0.17, 0.55),
        new THREE.Vector2(0.15, 1.35),
        new THREE.Vector2(0.17, 1.5),
        new THREE.Vector2(0.13, 1.52),
      ],
      16,
    ),
    MATS.iron,
  )
  barrel.rotation.x = Math.PI / 2 - 0.1 // 살짝 들린 앙각
  barrel.position.set(0, 0.62, -0.25)
  // 포신 보강 링 2개
  for (const t of [0.35, 0.95]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.03, 8, 14), MATS.steelDark)
    ring.position.set(0, 0.62 + t * 0.1, -0.25 + t) // 포신 축을 따라
    ring.rotation.x = -0.1
    ring.castShadow = true
    g.add(ring)
  }
  // 포가 (양측 목재 프레임)
  for (const side of [-1, 1]) {
    const frame = bevelBox(0.09, 0.5, 1.3, MAT_WOOD, 0.02)
    frame.position.set(side * 0.28, 0.42, -0.1)
    frame.rotation.x = -0.12
    g.add(frame)
  }
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.95, 10), MAT_WOOD_DARK)
  axle.rotation.z = Math.PI / 2
  axle.position.set(0, 0.33, 0.28)
  g.add(axle)
  // 바퀴
  for (const side of [-1, 1]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.09, 14), MAT_WOOD)
    wheel.rotation.z = Math.PI / 2
    wheel.position.set(side * 0.45, 0.33, 0.28)
    wheel.castShadow = true
    const hub = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.028, 8, 16), MATS.iron)
    hub.rotation.y = Math.PI / 2
    hub.position.copy(wheel.position)
    hub.castShadow = true
    g.add(wheel, hub)
  }
  g.add(barrel)
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true
  })
  return g
}

/** 발리스타 — 목재 받침대 + 활대(양팔) + 장전 볼트 */
export function makeBallista(): THREE.Group {
  const g = new THREE.Group()
  const base = bevelBox(0.85, 0.14, 0.95, MAT_WOOD_DARK, 0.025)
  base.position.y = 0.07
  const post = bevelBox(0.16, 0.5, 0.16, MAT_WOOD, 0.02)
  post.position.y = 0.38
  // 발사 레일 (앞으로 길게, 살짝 들림)
  const rail = bevelBox(0.12, 0.08, 1.5, MAT_WOOD, 0.02)
  rail.position.set(0, 0.62, 0.1)
  rail.rotation.x = -0.16
  // 활대 (좌우로 벌어진 팔) + 시위
  for (const side of [-1, 1]) {
    const arm = bevelBox(0.07, 0.07, 0.85, MAT_WOOD, 0.015)
    arm.position.set(side * 0.42, 0.66, -0.35)
    arm.rotation.y = side * 1.25
    g.add(arm)
  }
  const string = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 1.55, 6),
    MATS.steelDark,
  )
  string.rotation.z = Math.PI / 2
  string.position.set(0, 0.66, -0.62)
  // 장전된 볼트
  const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.012, 1.15, 8), MATS.iron)
  bolt.rotation.x = Math.PI / 2 - 0.16
  bolt.position.set(0, 0.72, 0.15)
  g.add(base, post, rail, string, bolt)
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true
  })
  return g
}

// ---------------------------------------------------------------- 괴수 (야귀·질주귀·갑주귀)
// 기사와 같은 원칙(프로파일·부품 조립)이되 실루엣으로 병종이 읽히게 한다:
// 야귀 = 구부정한 덩치 + 곤봉, 질주귀 = 전경 자세 + 갈퀴손 + 후방 뿔, 갑주귀 = 판금 거구 + 대형 망치.
// 발광 눈은 부감 거리에서도 "괴수"임을 읽게 하는 최소 비용 장치 (블룸이 살짝 잡아준다).

const MAT_BONE = new THREE.MeshStandardMaterial({ color: 0xd6c9a8, roughness: 0.55 })
const MAT_EYE = new THREE.MeshBasicMaterial({ color: 0xffb63a })
// 갑주는 iron(0x33353c)이 아니라 steelDark 계열 — 대낮 들판에서 iron은 검은 덩어리로 뭉개진다 (스크린샷 검증)
const MAT_ARMOR = new THREE.MeshStandardMaterial({ color: 0x565b68, metalness: 0.75, roughness: 0.5 })
const MONSTER_SKIN: Record<string, THREE.MeshStandardMaterial> = {
  grunt: new THREE.MeshStandardMaterial({ color: 0x8a4038, roughness: 0.92 }),
  runner: new THREE.MeshStandardMaterial({ color: 0x9c4f28, roughness: 0.9 }),
  tank: new THREE.MeshStandardMaterial({ color: 0x52406b, roughness: 0.88 }),
}

export interface MonsterRig {
  root: THREE.Group
  torso: THREE.Group
  head: THREE.Group
  lArm: THREE.Group
  rArm: THREE.Group
  lLeg: THREE.Group
  rLeg: THREE.Group
  hunch: number // 기본 전경(앞으로 숙임) 각
  hipH: number // 골반 높이 — torso 피벗이 여기 있어 hunch가 골반 기준으로 돈다
  gait: number // 보행 주파수 — sim 이동 속도와 보폭이 맞게
  atkDur: number // 공격 스윙 길이 (ms)
}

export function makeMonster(kind: string): MonsterRig {
  const skin = MONSTER_SKIN[kind] ?? MONSTER_SKIN.grunt!
  const root = new THREE.Group()
  const K =
    kind === 'runner'
      ? { hipH: 0.78, hunch: 0.5, gait: 13, atkDur: 300, legR: 0.09, spread: 0.16 }
      : kind === 'tank'
        ? { hipH: 1.12, hunch: 0.12, gait: 5.5, atkDur: 620, legR: 0.2, spread: 0.3 }
        : { hipH: 0.84, hunch: 0.3, gait: 8, atkDur: 450, legR: 0.14, spread: 0.24 }

  // ---- 다리 (골반 피벗) — 맨발엔 발톱, 갑주귀는 정강받이+쇠발
  const mkLeg = (side: number): THREE.Group => {
    const leg = new THREE.Group()
    leg.position.set(side * K.spread, K.hipH, 0)
    const thigh = lathe(
      [
        [K.legR * 1.15, 0],
        [K.legR * 1.25, -K.hipH * 0.2],
        [K.legR * 0.85, -K.hipH * 0.55],
      ],
      skin,
      10,
    )
    const shin = lathe(
      [
        [K.legR * 0.8, -K.hipH * 0.55],
        [K.legR * 0.95, -K.hipH * 0.65],
        [K.legR * 0.7, -K.hipH * 0.97],
      ],
      skin,
      10,
    )
    leg.add(thigh, shin)
    if (kind === 'tank') {
      const greave = lathe(
        [
          [K.legR * 0.85, -K.hipH * 0.55],
          [K.legR * 1.05, -K.hipH * 0.63],
          [K.legR * 0.8, -K.hipH * 0.92],
        ],
        MAT_ARMOR,
        10,
      )
      const foot = bevelBox(0.3, 0.12, 0.42, MAT_ARMOR, 0.02)
      foot.position.set(0, -K.hipH + 0.06, 0.08)
      leg.add(greave, foot)
    } else {
      for (const dx of [-1, 0, 1]) {
        const toe = new THREE.Mesh(new THREE.ConeGeometry(K.legR * 0.38, K.legR * 1.6, 6), MAT_BONE)
        toe.rotation.x = Math.PI / 2 - 0.25
        toe.position.set(dx * K.legR * 0.55, -K.hipH + K.legR * 0.35, K.legR * 1.1)
        leg.add(toe)
      }
    }
    return leg
  }
  const lLeg = mkLeg(-1)
  const rLeg = mkLeg(1)

  // ---- 몸통 (골반 피벗 — 로컬 y=0이 골반)
  const torso = new THREE.Group()
  torso.position.y = K.hipH
  const head = new THREE.Group()

  const mkArm = (
    side: number,
    at: [number, number],
    upper: [number, number][],
    fore: [number, number][],
    fistS: number,
    fistY: number,
  ): THREE.Group => {
    const arm = new THREE.Group()
    arm.position.set(side * at[0], at[1], 0)
    const fist = bevelBox(fistS, fistS * 0.9, fistS, skin, 0.02)
    fist.position.y = fistY
    arm.add(lathe(upper, skin, 10), lathe(fore, skin, 10), fist)
    return arm
  }
  let lArm: THREE.Group
  let rArm: THREE.Group

  if (kind === 'runner') {
    // 몸통 — 마르고 좁게
    torso.add(
      lathe(
        [
          [0.17, 0],
          [0.24, 0.2],
          [0.2, 0.42],
          [0.12, 0.52],
        ],
        skin,
        12,
      ),
    )
    // 등뼈 가시 4개
    for (let i = 0; i < 4; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.13, 5), MAT_BONE)
      spike.rotation.x = -2.3
      spike.position.set(0, 0.1 + i * 0.12, -0.2)
      torso.add(spike)
    }
    // 머리 — 뒤로 긴 두개골 + 후방 단일 뿔
    head.position.set(0, 0.55, 0.1)
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), skin)
    skull.scale.set(0.9, 0.8, 1.3)
    skull.position.y = 0.08
    const jaw = bevelBox(0.16, 0.07, 0.16, skin, 0.015)
    jaw.position.set(0, -0.03, 0.12)
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.4, 7), MAT_BONE)
    horn.rotation.x = -0.9
    horn.position.set(0, 0.2, -0.12)
    head.add(skull, jaw, horn)
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), MAT_EYE)
      eye.position.set(s * 0.07, 0.1, 0.19)
      head.add(eye)
    }
    // 팔 — 길고 가늘게 + 갈퀴 3개
    const armProf = (): [[number, number][], [number, number][]] => [
      [
        [0.06, 0],
        [0.065, -0.16],
        [0.05, -0.4],
      ],
      [
        [0.05, -0.4],
        [0.06, -0.48],
        [0.045, -0.75],
      ],
    ]
    lArm = mkArm(-1, [0.26, 0.44], ...armProf(), 0.1, -0.79)
    rArm = mkArm(1, [0.26, 0.44], ...armProf(), 0.1, -0.79)
    for (const arm of [lArm, rArm])
      for (const dx of [-1, 0, 1]) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.17, 5), MAT_BONE)
        claw.rotation.x = Math.PI
        claw.position.set(dx * 0.04, -0.9, 0.02)
        arm.add(claw)
      }
  } else if (kind === 'tank') {
    // 몸통 — 거구 + 판금 흉갑·폴드
    torso.add(
      lathe(
        [
          [0.34, 0],
          [0.5, 0.3],
          [0.46, 0.62],
          [0.28, 0.78],
        ],
        skin,
        14,
      ),
      lathe(
        [
          [0.48, 0.28],
          [0.54, 0.45],
          [0.44, 0.66],
          [0.3, 0.76],
        ],
        MAT_ARMOR,
        14,
      ),
      lathe(
        [
          [0.4, 0.05],
          [0.46, -0.08],
        ],
        MAT_ARMOR,
        14,
      ),
      lathe(
        [
          [0.44, -0.06],
          [0.5, -0.2],
        ],
        MATS.steelDark,
        14,
      ),
    )
    // 견갑 (반구 + 정수리 스파이크)
    for (const s of [-1, 1]) {
      const pauldron = new THREE.Mesh(
        new THREE.SphereGeometry(0.26, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        MAT_ARMOR,
      )
      pauldron.position.set(s * 0.52, 0.72, 0)
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 7), MATS.steelDark)
      spike.position.set(s * 0.52, 0.98, 0)
      torso.add(pauldron, spike)
    }
    // 머리 — 뿔투구, 슬릿 안쪽 발광 눈
    head.position.set(0, 0.82, 0.1)
    const helm = lathe(
      [
        [0.19, 0],
        [0.21, 0.08],
        [0.21, 0.22],
        [0.16, 0.3],
        [0.0, 0.34],
      ],
      MAT_ARMOR,
      14,
    )
    const slit = new THREE.Mesh(
      new THREE.CylinderGeometry(0.213, 0.213, 0.05, 14, 1, true, -0.7, 1.4),
      new THREE.MeshBasicMaterial({ color: 0x000000 }),
    )
    slit.position.y = 0.13
    head.add(helm, slit)
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.42, 8), MAT_BONE)
      horn.rotation.z = -s * 0.9
      horn.position.set(s * 0.24, 0.22, 0)
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), MAT_EYE)
      eye.position.set(s * 0.07, 0.13, 0.19)
      const tusk = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.13, 6), MAT_BONE)
      tusk.position.set(s * 0.08, -0.04, 0.17)
      head.add(horn, eye, tusk)
    }
    // 팔 + 철 건틀릿, 오른손 대형 망치
    const armProf = (): [[number, number][], [number, number][]] => [
      [
        [0.13, 0],
        [0.14, -0.18],
        [0.11, -0.45],
      ],
      [
        [0.115, -0.45],
        [0.15, -0.56],
        [0.11, -0.85],
      ],
    ]
    lArm = mkArm(-1, [0.6, 0.68], ...armProf(), 0.22, -0.92)
    rArm = mkArm(1, [0.6, 0.68], ...armProf(), 0.22, -0.92)
    for (const arm of [lArm, rArm]) {
      const gauntlet = lathe(
        [
          [0.12, -0.68],
          [0.16, -0.76],
          [0.13, -0.9],
        ],
        MAT_ARMOR,
        10,
      )
      arm.add(gauntlet)
    }
    const maul = new THREE.Group()
    maul.position.y = -0.92
    maul.rotation.x = 0.8
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.95, 8), MAT_WOOD_DARK)
    handle.position.y = -0.42
    const maulHead = bevelBox(0.36, 0.3, 0.3, MATS.iron, 0.03)
    maulHead.position.y = -0.95
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.03, 6, 12), MATS.steelDark)
    band.rotation.x = Math.PI / 2
    band.position.y = -0.78
    maul.add(handle, maulHead, band)
    rArm.add(maul)
  } else {
    // ---- 야귀 (기본) — 구부정한 덩치
    torso.add(
      lathe(
        [
          [0.24, 0],
          [0.4, 0.22],
          [0.42, 0.42],
          [0.3, 0.6],
          [0.18, 0.68],
        ],
        skin,
        14,
      ),
    )
    for (const s of [-1, 1]) {
      const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), skin)
      shoulder.position.set(s * 0.34, 0.56, 0)
      torso.add(shoulder)
    }
    // 등뼈 가시 3개 + 허리 천
    for (let i = 0; i < 3; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 5), MAT_BONE)
      spike.rotation.x = -2.3
      spike.position.set(0, 0.24 + i * 0.16, -0.33)
      torso.add(spike)
    }
    const cloth = bevelBox(0.34, 0.3, 0.05, MATS.clothDark, 0.015)
    cloth.position.set(0, -0.1, 0.24)
    cloth.rotation.x = 0.12
    torso.add(cloth)
    // 머리 — 하악 돌출 + 송곳니 + 양뿔
    head.position.set(0, 0.68, 0.14)
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), skin)
    skull.scale.set(1, 0.85, 1)
    skull.position.y = 0.1
    const jaw = bevelBox(0.26, 0.1, 0.2, skin, 0.02)
    jaw.position.set(0, -0.04, 0.1)
    head.add(skull, jaw)
    for (const s of [-1, 1]) {
      const tusk = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 6), MAT_BONE)
      tusk.position.set(s * 0.09, 0.03, 0.19)
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), MAT_EYE)
      eye.position.set(s * 0.08, 0.14, 0.16)
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.3, 7), MAT_BONE)
      horn.rotation.z = -s * 0.55
      horn.rotation.x = -0.2
      horn.position.set(s * 0.15, 0.26, -0.02)
      head.add(tusk, eye, horn)
    }
    // 팔 — 전완이 굵은 곤봉팔, 오른손 나무 곤봉
    const armProf = (): [[number, number][], [number, number][]] => [
      [
        [0.1, 0],
        [0.11, -0.14],
        [0.08, -0.36],
      ],
      [
        [0.085, -0.36],
        [0.12, -0.46],
        [0.09, -0.72],
      ],
    ]
    lArm = mkArm(-1, [0.44, 0.5], ...armProf(), 0.17, -0.78)
    rArm = mkArm(1, [0.44, 0.5], ...armProf(), 0.17, -0.78)
    const club = new THREE.Group()
    club.position.y = -0.78
    club.rotation.x = 0.85
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.028, 0.5, 8), MAT_WOOD_DARK)
    handle.position.y = -0.25
    const clubHead = lathe(
      [
        [0.05, -0.48],
        [0.11, -0.56],
        [0.12, -0.68],
        [0.0, -0.76],
      ],
      MAT_WOOD_DARK,
      10,
    )
    club.add(handle, clubHead)
    for (let i = 0; i < 3; i++) {
      const stud = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.09, 5), MATS.iron)
      const a = (i / 3) * Math.PI * 2
      stud.position.set(Math.sin(a) * 0.11, -0.62, Math.cos(a) * 0.11)
      stud.rotation.z = -Math.sin(a) * 1.3
      stud.rotation.x = Math.cos(a) * 1.3
      club.add(stud)
    }
    rArm.add(club)
  }

  torso.add(head, lArm, rArm)
  root.add(lLeg, rLeg, torso)
  // 그림자는 실루엣 부품만 — 기사와 동일한 드로우콜 절약 규칙
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.computeBoundingSphere()
      o.castShadow = (o.geometry.boundingSphere?.radius ?? 1) > 0.16
    }
  })
  return { root, torso, head, lArm, rArm, lLeg, rLeg, hunch: K.hunch, hipH: K.hipH, gait: K.gait, atkDur: K.atkDur }
}

/** 괴수 보행/대기 + 공격 스윙. attackMs = meleeHit/wallHit 이벤트로부터 경과 ms (없으면 음수) */
export function animateMonster(rig: MonsterRig, t: number, moving: boolean, attackMs: number): void {
  if (moving) {
    const s = Math.sin(t * rig.gait)
    const lift = Math.abs(Math.cos(t * rig.gait))
    rig.lLeg.rotation.x = s * 0.62
    rig.rLeg.rotation.x = -s * 0.62
    rig.lArm.rotation.x = -s * 0.5
    rig.rArm.rotation.x = s * 0.5
    rig.torso.rotation.x = rig.hunch + lift * 0.06
    rig.torso.rotation.z = s * 0.05
    rig.torso.position.y = rig.hipH + lift * 0.05
  } else {
    const breathe = Math.sin(t * 1.6)
    rig.lLeg.rotation.x = 0
    rig.rLeg.rotation.x = 0
    rig.lArm.rotation.x = breathe * 0.04
    rig.rArm.rotation.x = -breathe * 0.04
    rig.torso.rotation.x = rig.hunch + breathe * 0.015
    rig.torso.rotation.z = 0
    rig.torso.position.y = rig.hipH
  }
  rig.head.rotation.x = -rig.hunch * 0.55 // 숙여도 시선은 전방
  // 공격 — 크게 들어올렸다(윈드업) 내리찍기. 피해는 sim이 이미 적용, 이것은 연출
  if (attackMs >= 0 && attackMs < rig.atkDur) {
    const p = attackMs / rig.atkDur
    const wind = 0.42
    const arm =
      p < wind
        ? THREE.MathUtils.lerp(0.2, 2.3, p / wind)
        : THREE.MathUtils.lerp(2.3, -0.7, (p - wind) / (1 - wind))
    rig.rArm.rotation.x = arm
    rig.lArm.rotation.x = arm * 0.35
    rig.torso.rotation.x =
      rig.hunch +
      (p < wind ? -0.12 * (p / wind) : THREE.MathUtils.lerp(-0.12, 0.28, (p - wind) / (1 - wind)))
  }
}

// ---------------------------------------------------------------- 불 (스프라이트 화염 + 불티)

export interface FireFx {
  group: THREE.Group
  update: (t: number) => void
}

/** 진짜처럼 흔들리는 불: 절차 화염 스프라이트 3장 겹침 + 상승 불티 */
export function makeFire(scale = 1): FireFx {
  const group = new THREE.Group()

  const flameTex = (hue: number): THREE.CanvasTexture => {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 96
    const ctx = c.getContext('2d')!
    const grad = ctx.createRadialGradient(32, 70, 4, 32, 60, 46)
    grad.addColorStop(0, `hsla(${hue}, 100%, 72%, 1)`)
    grad.addColorStop(0.4, `hsla(${hue - 8}, 95%, 55%, 0.85)`)
    grad.addColorStop(1, 'hsla(20, 90%, 40%, 0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.moveTo(32, 4)
    ctx.quadraticCurveTo(52, 40, 46, 68)
    ctx.quadraticCurveTo(42, 88, 32, 92)
    ctx.quadraticCurveTo(22, 88, 18, 68)
    ctx.quadraticCurveTo(12, 40, 32, 4)
    ctx.fill()
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  const planes: THREE.Mesh[] = []
  for (const [i, hue] of [38, 28, 45].entries()) {
    const mat = new THREE.MeshBasicMaterial({
      map: flameTex(hue),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.55 * scale, 0.85 * scale), mat)
    plane.rotation.y = (i * Math.PI) / 3
    plane.position.y = 0.42 * scale
    planes.push(plane)
    group.add(plane)
  }

  // 불티
  const N = 14
  const pos = new Float32Array(N * 3)
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 0.3 * scale
    pos[i * 3 + 1] = Math.random() * 1.2 * scale
    pos[i * 3 + 2] = (Math.random() - 0.5) * 0.3 * scale
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const embers = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color: 0xffa050,
      size: 0.05 * scale,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  )
  group.add(embers)

  const update = (t: number): void => {
    for (const [i, p] of planes.entries()) {
      p.scale.x = 1 + Math.sin(t * 11 + i * 2.1) * 0.14
      p.scale.y = 1 + Math.sin(t * 13 + i * 1.3) * 0.18
      p.rotation.y += 0.004 + i * 0.001
    }
    const a = embers.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < N; i++) {
      let y = a.getY(i) + 0.008 * scale
      if (y > 1.3 * scale) y = 0.1
      a.setY(i, y)
      a.setX(i, a.getX(i) + Math.sin(t * 6 + i) * 0.0012)
    }
    a.needsUpdate = true
  }
  return { group, update }
}
