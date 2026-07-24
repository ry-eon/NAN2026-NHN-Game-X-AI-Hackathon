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
 */
export function makeKnight(accent = 0x4a1414, gilded = false): Rig {
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
  // 크레스트 (세로 볏)
  const crest = bevelBox(0.035, 0.22, 0.38, cloth, 0.012)
  crest.position.set(0, 2.04, -0.02)
  torso.add(crest)
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

  root.add(lLeg, rLeg, torso, lArm, rArm)
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true
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
