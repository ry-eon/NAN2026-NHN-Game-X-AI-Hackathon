// 절차 조형 모델 v2 — "제대로 된" 절차 모델링 검증 슬라이스.
// 원칙: 베벨(모서리가 빛을 받게), 프로파일(건축·갑주 몰딩), 부품 조립(단일 프리미티브 금지).
// 기사는 풀헬름으로 얼굴 문제를 회피 — 하드서피스만으로 성립하는 디자인.

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

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

// ---------------------------------------------------------------- 드로우콜 절감 (정적 부품 병합)

/**
 * 본 그룹 안의 **정적** 부품들을 머티리얼별 메시 1개로 합친다.
 *
 * 왜: 08-01 실플레이 계측에서 병목이 fill-rate가 아니라 **드로우콜**로 판명됐다
 * (기본 씬만으로 934콜, 전투 중 1240콜, 동적 해상도는 이미 하한). 기사 1기가 메시 ~30개라
 * 리그 수가 곧 프레임 예산이었다. 애니메이션은 본 그룹(몸통·팔·다리) 단위로 도니까
 * 그 안쪽은 서로 움직이지 않는다 — 즉 실루엣·동작을 하나도 잃지 않고 합칠 수 있다.
 *
 * exclude에는 따로 애니메이션되는 자식(머리·망토·반동 부품)을 넘긴다.
 * 병합 실패(속성 불일치) 시 원본을 그대로 두므로 모델이 사라지는 일은 없다.
 */
function mergeStatic(group: THREE.Group, exclude: THREE.Object3D[] = []): void {
  const skip = new Set<THREE.Object3D>(exclude)
  const byMat = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; src: THREE.Mesh[] }>()

  const walk = (o: THREE.Object3D, m: THREE.Matrix4): void => {
    for (const child of o.children) {
      if (skip.has(child)) continue
      child.updateMatrix()
      const cm = m.clone().multiply(child.matrix)
      if (child instanceof THREE.Mesh && !Array.isArray(child.material)) {
        // 인덱스 유무가 섞여 있으면 mergeGeometries가 거부한다 → 전부 비인덱스로 통일
        const g = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone()
        // 속성 집합도 통일 (position/normal/uv 외에는 버린다)
        for (const name of Object.keys(g.attributes)) {
          if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name)
        }
        g.applyMatrix4(cm)
        g.clearGroups()
        const mat = child.material as THREE.Material
        const bucket = byMat.get(mat)
        if (bucket) {
          bucket.geos.push(g)
          bucket.src.push(child)
        } else {
          byMat.set(mat, { geos: [g], src: [child] })
        }
      } else {
        walk(child, cm)
      }
    }
  }
  walk(group, new THREE.Matrix4())

  for (const [mat, { geos, src }] of byMat) {
    if (geos.length < 2) {
      geos[0]?.dispose()
      continue // 혼자면 합칠 게 없다 — 원본 유지
    }
    const merged = mergeGeometries(geos, false)
    geos.forEach((g) => g.dispose())
    if (!merged) continue // 실패 — 원본을 그대로 둔다
    for (const s of src) {
      s.parent?.remove(s)
      s.geometry.dispose()
    }
    const mesh = new THREE.Mesh(merged, mat)
    // 그림자는 실루엣을 만드는 덩어리만 — 합쳐진 결과가 작으면(활·발톱·가시류) 그림자 패스에서 뺀다.
    // 그림자 패스가 드로우콜의 절반이라 이 판정이 곧 프레임 예산이다.
    merged.computeBoundingSphere()
    mesh.castShadow = (merged.boundingSphere?.radius ?? 1) > 0.3
    group.add(mesh)
  }
  // 부품을 다 내준 빈 그룹은 씬 그래프에서 치운다 (행렬 갱신 비용도 공짜가 아니다)
  for (const child of [...group.children]) {
    if (!skip.has(child) && child.type === 'Group' && child.children.length === 0) {
      group.remove(child)
    }
  }
}

/**
 * 그림자 캐스터 지정 — 부감 카메라에서 바닥 그림자의 형태를 만드는 건 사실상 몸통·다리다.
 * 팔·머리·장비까지 그림자 패스에 넣으면 캐릭터 1기당 드로우콜이 배로 든다
 * (08-01 계측: 그림자 패스가 전체 드로우콜의 45%, 그중 리그가 182/286).
 */
function setCast(o: THREE.Object3D, on: boolean): void {
  o.traverse((c) => {
    if (c instanceof THREE.Mesh) c.castShadow = on
  })
}

// ---------------------------------------------------------------- 개체별 머티리얼 (피격 플래시·소멸 페이드용)

/**
 * 리그 안의 공유 머티리얼(MATS.*)을 인스턴스 사본으로 교체한다.
 * 개체 하나만 번쩍이거나 사라지게 하려면 머티리얼이 그 개체 것이어야 한다.
 * 사본은 `userData.owned`로 표시 — 폐기 시 이것만 dispose 해서 공유 머티리얼을 깨지 않는다.
 * 리그당 사본 4~6개(원본별 1개) 수준이라 셰이더 프로그램은 그대로 재사용된다.
 */
export function ownMaterials(root: THREE.Object3D): THREE.Material[] {
  const map = new Map<THREE.Material, THREE.Material>()
  root.traverse((o) => {
    const holder = o as THREE.Mesh | THREE.Sprite
    const src = holder.material as THREE.Material | THREE.Material[] | undefined
    if (!src || Array.isArray(src)) return
    let mine = map.get(src)
    if (!mine) {
      mine = src.clone()
      mine.userData.owned = true
      map.set(src, mine)
    }
    holder.material = mine
  })
  return [...map.values()]
}

/** 피격 플래시 — k=0이면 원상. emissive는 항상 컴파일되는 유니폼이라 재컴파일이 없다.
 *  따뜻한 백색: 붉은 괴수 피부에 순백을 더하면 분홍 사탕색으로 뜬다 (실기기 스크린샷 검증) */
export function setFlash(mats: THREE.Material[], k: number): void {
  for (const m of mats) {
    if (m instanceof THREE.MeshStandardMaterial) m.emissive.setRGB(k, k * 0.78, k * 0.52)
  }
}

/** 소멸 페이드 — 개체 전용 머티리얼이므로 이 개체만 사라진다 */
export function setOpacity(mats: THREE.Material[], o: number): void {
  for (const m of mats) {
    m.transparent = o < 1
    m.opacity = o
  }
}

/** 리그 폐기 — 메시 지오메트리는 전부 인스턴스 것, 머티리얼은 owned 표시된 사본만.
 *  스프라이트 지오메트리는 three.js 내부 공유물이라 절대 dispose 하지 않는다 */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const holder = o as THREE.Mesh | THREE.Sprite
    if (o instanceof THREE.Mesh) o.geometry.dispose()
    const mat = holder.material as THREE.Material | THREE.Material[] | undefined
    for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      if (!m.userData.owned) continue
      const map = (m as THREE.MeshStandardMaterial).map
      if (map) map.dispose()
      m.dispose()
    }
  })
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
  mats: THREE.Material[] // 개체 전용 사본 — 피격 플래시·소멸 페이드
  atkStyle: 'bow' | 'sword' // 공격 모션 (궁수=활 놓기, 그 외=검 내려치기)
  atkDur: number // 공격 모션 길이 (ms)
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
  // 그림자는 실루엣을 만드는 큰 부품만 — 병합 전에 판정해야 부품 크기를 볼 수 있다
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.computeBoundingSphere()
      o.castShadow = (o.geometry.boundingSphere?.radius ?? 1) > 0.16
    }
  })
  // 본 그룹별 정적 병합 — 망토는 따로 흔들리므로 제외
  mergeStatic(torso, cloak ? [cloak] : [])
  mergeStatic(lArm)
  mergeStatic(rArm)
  mergeStatic(lLeg)
  mergeStatic(rLeg)
  // 그림자는 몸통·다리만 (팔·활·검은 그림자 패스에서 제외)
  setCast(torso, true)
  setCast(lLeg, true)
  setCast(rLeg, true)
  setCast(lArm, false)
  setCast(rArm, false)
  return {
    root,
    lArm,
    rArm,
    lLeg,
    rLeg,
    torso,
    cloak,
    mats: ownMaterials(root),
    atkStyle: archer ? 'bow' : 'sword',
    atkDur: archer ? 460 : 430,
  }
}

/**
 * 보행/대기 + 공격 + 피격 절차 애니메이션.
 * attackMs = unitFired 이벤트로부터 경과 ms, hitMs = 피격(meleeHit)으로부터 경과 ms (없으면 음수).
 * 셋 다 연출 전용 — 피해·명중은 sim이 이미 확정했다.
 */
export function animateRig(
  rig: Rig,
  t: number,
  moving: boolean,
  attackMs = -1,
  hitMs = -1,
): void {
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
  rig.torso.rotation.y = 0
  rig.torso.rotation.z = 0

  // ---- 공격: 궁수는 시위를 놓는 순간부터 복귀, 검사는 윈드업→내려치기
  if (attackMs >= 0 && attackMs < rig.atkDur) {
    const p = attackMs / rig.atkDur
    if (rig.atkStyle === 'bow') {
      // 발사 직후 0.12까지 사격 자세 유지 → 나머지 구간에 대기 자세로 복귀
      const hold = p < 0.12 ? 1 : 1 - (p - 0.12) / 0.88
      const ease = hold * hold
      rig.lArm.rotation.x = -1.5 * ease // 활 든 왼팔을 전방으로
      // 시위를 놓는 순간 오른손이 뒤로 튀었다가(0.45) 앞으로 풀린다
      rig.rArm.rotation.x = (p < 0.08 ? 0.45 : THREE.MathUtils.lerp(0.45, -0.1, Math.min(1, (p - 0.08) / 0.3))) * ease
      rig.torso.rotation.y = 0.3 * ease // 몸을 틀어 겨눈 자세
      rig.torso.rotation.x -= 0.05 * ease
    } else {
      // 윈드업을 짧게 — 사격 이벤트가 곧 타격 시점이라 크게 뜸을 들이면 검기와 어긋난다
      const wind = 0.25
      const arm =
        p < wind
          ? THREE.MathUtils.lerp(0.1, 2.5, p / wind)
          : THREE.MathUtils.lerp(2.5, -0.95, (p - wind) / (1 - wind))
      rig.rArm.rotation.x = arm
      rig.lArm.rotation.x = arm * 0.25
      rig.torso.rotation.x +=
        p < wind ? -0.16 * (p / wind) : THREE.MathUtils.lerp(-0.16, 0.3, (p - wind) / (1 - wind))
      rig.torso.rotation.y = p < wind ? -0.2 * (p / wind) : THREE.MathUtils.lerp(-0.2, 0.15, (p - wind) / (1 - wind))
    }
  }

  // ---- 피격: 뒤로 젖혀졌다가 떨림이 잦아든다 (공격 모션 위에 덧씌운다)
  if (hitMs >= 0 && hitMs < HIT_REACT_MS) {
    const q = 1 - hitMs / HIT_REACT_MS
    rig.torso.rotation.x -= 0.32 * q * q
    rig.torso.rotation.z = 0.14 * q * Math.sin(hitMs * 0.05)
    rig.torso.position.y -= 0.04 * q * q
  }
}

/** 피격 리액션 길이 (ms) — 리그·플래시 공용 */
export const HIT_REACT_MS = 230

// ---------------------------------------------------------------- 공성 병기 (전방 = +Z, 기사와 동일 규약)

const MAT_WOOD = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.88 })
const MAT_WOOD_DARK = new THREE.MeshStandardMaterial({ color: 0x33261a, roughness: 0.9 })

/** 공성 병기 — recoil 그룹은 발사 시 뒤로 밀렸다 돌아오는 부품(포신·시위) */
export interface WeaponRig {
  group: THREE.Group
  recoil: THREE.Group
  recoilDist: number // 반동 이동량 (병기 로컬 z)
  reloadMs: number
}

/** 대포 — 포신(lathe 프로파일) + 목재 포가 + 바퀴 2륜 */
export function makeCannon(): WeaponRig {
  const g = new THREE.Group()
  const recoil = new THREE.Group() // 포신 일체 — 발사 때 포가 위를 뒤로 미끄러진다
  g.add(recoil)
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
    recoil.add(ring)
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
  recoil.add(barrel)
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true
  })
  mergeStatic(g, [recoil]) // 포가·바퀴는 한 덩어리, 포신은 따로 밀린다
  mergeStatic(recoil)
  return { group: g, recoil, recoilDist: 0.34, reloadMs: 900 }
}

/** 발리스타 — 목재 받침대 + 활대(양팔) + 장전 볼트 */
export function makeBallista(): WeaponRig {
  const g = new THREE.Group()
  const recoil = new THREE.Group() // 시위 + 장전 볼트 — 발사 때 앞으로 튕겼다 재장전된다
  g.add(recoil)
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
  g.add(base, post, rail)
  recoil.add(string, bolt)
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true
  })
  mergeStatic(g, [recoil]) // 받침대·활대는 한 덩어리, 시위·볼트는 따로 튕긴다
  mergeStatic(recoil)
  return { group: g, recoil, recoilDist: -0.45, reloadMs: 700 }
}

/** 병기 반동 — 발사 순간 튕겼다가 재장전 시간에 걸쳐 제자리로 (연출 전용) */
export function animateWeapon(w: WeaponRig, attackMs: number): void {
  if (attackMs < 0 || attackMs >= w.reloadMs) {
    w.recoil.position.z = 0
    return
  }
  const p = attackMs / w.reloadMs
  // 앞 15%에 튕기고(급가속) 나머지 구간에 천천히 복귀 — 무게가 실려 보이게
  const k = p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85
  w.recoil.position.z = -w.recoilDist * k * k
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
  // 보스 — 짙은 자주 로브. 병졸(붉은 계열)과 색으로도 갈린다
  necromancer: new THREE.MeshStandardMaterial({ color: 0x241d38, roughness: 0.96 }),
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
  mats: THREE.Material[] // 개체 전용 사본 — 피격 플래시·소멸 페이드
}

export function makeMonster(kind: string): MonsterRig {
  const skin = MONSTER_SKIN[kind] ?? MONSTER_SKIN.grunt!
  const root = new THREE.Group()
  const K =
    kind === 'runner'
      ? // 사족보행 — 몸통이 수평이라 hunch는 거의 0. 보폭이 짧아 gait를 올린다
        { hipH: 0.68, hunch: 0.06, gait: 15, atkDur: 320, legR: 0.075, spread: 0.19 }
      : kind === 'tank'
        ? // 스케일 상향 — 성벽 높이 11 대비 작아 보였다. 굵고 넓게 (sim radius도 함께 올림)
          { hipH: 1.32, hunch: 0.12, gait: 5.2, atkDur: 620, legR: 0.24, spread: 0.36 }
        : kind === 'necromancer'
          ? // 부유 — 다리가 없으니 보행 주파수 0. 로브 자락이 지면 가까이 내려와 떠 있는 것처럼 보인다
            { hipH: 1.15, hunch: 0, gait: 0, atkDur: 760, legR: 0.001, spread: 0 }
          : { hipH: 0.92, hunch: 0.3, gait: 8, atkDur: 450, legR: 0.15, spread: 0.26 }

  // ---- 다리 (골반 피벗) — 맨발엔 발톱, 갑주귀는 정강받이+쇠발
  const mkLeg = (side: number): THREE.Group => {
    const leg = new THREE.Group()
    leg.position.set(side * K.spread, K.hipH, 0)
    if (kind === 'necromancer') return leg // 다리가 없다 — 로브 아래로 떠 있다
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
    // ---- 질주귀 — 되살린 짐승. **유일한 사족보행**이라 부감에서 즉시 갈린다.
    //      앞다리를 lArm/rArm에 매핑하면 기존 보행 애니메이션(팔·다리 역위상)이
    //      그대로 대각 보행(트롯)이 된다. 공격 모션의 앞발 들기도 짐승에 맞는다.
    // 몸통 — 수평. 지오메트리 자체를 z축으로 눕혀 회전 트릭을 쓰지 않는다
    const body = lathe(
      [
        [0.0, -0.52],
        [0.19, -0.4],
        [0.24, 0.0],
        [0.21, 0.34],
        [0.14, 0.5],
      ],
      skin,
      12,
    )
    body.rotation.x = Math.PI / 2 // 세로 몸통을 z축을 따라 눕힌다
    torso.add(body)
    // 어깨·엉덩이 융기 — 옆에서 봤을 때 짐승 실루엣의 굴곡
    for (const [z, r] of [[0.34, 0.2], [-0.3, 0.18]] as const) {
      const hump = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), skin)
      hump.position.set(0, 0.09, z)
      hump.scale.set(1, 0.75, 1.1)
      torso.add(hump)
    }
    // 등뼈 가시 — 목덜미에서 꼬리까지 낮게
    for (let i = 0; i < 5; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.15, 5), MAT_BONE)
      spike.rotation.x = -0.35
      spike.position.set(0, 0.19, 0.3 - i * 0.17)
      torso.add(spike)
    }
    // 꼬리 — 뒤로 뻗어 사족 실루엣을 길게 만든다
    const tail = lathe(
      [
        [0.06, 0],
        [0.04, 0.26],
        [0.0, 0.46],
      ],
      skin,
      7,
    )
    tail.rotation.x = -Math.PI / 2 + 0.5
    tail.position.set(0, 0.06, -0.5)
    torso.add(tail)
    // 머리 — 몸 앞쪽 낮게. 긴 주둥이 + 벌어진 턱
    head.position.set(0, 0.02, 0.6)
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), skin)
    skull.scale.set(0.85, 0.85, 1.25)
    const snout = lathe(
      [
        [0.1, 0],
        [0.075, 0.16],
        [0.05, 0.28],
      ],
      skin,
      8,
    )
    snout.rotation.x = -Math.PI / 2
    snout.position.set(0, -0.02, 0.12)
    const jaw = bevelBox(0.13, 0.05, 0.24, skin, 0.012)
    jaw.position.set(0, -0.09, 0.2)
    jaw.rotation.x = 0.18
    head.add(skull, snout, jaw)
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), MAT_EYE)
      eye.position.set(s * 0.085, 0.07, 0.1)
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 5), skin)
      ear.rotation.x = -0.5
      ear.rotation.z = -s * 0.35
      ear.position.set(s * 0.09, 0.15, -0.03)
      const fang = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.1, 5), MAT_BONE)
      fang.rotation.x = Math.PI
      fang.position.set(s * 0.05, -0.03, 0.26)
      head.add(eye, ear, fang)
    }
    // 다리 — 넷 다 같은 형상. 앞다리(=팔)는 몸 앞, 뒷다리(=lLeg/rLeg)는 root에서 뒤로 옮긴다
    const legProf = (): [[number, number][], [number, number][]] => [
      [
        [0.062, 0],
        [0.07, -0.18],
        [0.05, -0.38],
      ],
      [
        [0.05, -0.38],
        [0.058, -0.46],
        [0.042, -0.66],
      ],
    ]
    lArm = mkArm(-1, [0.19, 0.02], ...legProf(), 0.085, -0.68)
    rArm = mkArm(1, [0.19, 0.02], ...legProf(), 0.085, -0.68)
    for (const paw of [lArm, rArm]) {
      paw.position.z = 0.36 // 앞다리를 가슴 아래로
      for (const dx of [-1, 0, 1]) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.11, 5), MAT_BONE)
        claw.rotation.x = 2.5
        claw.position.set(dx * 0.032, -0.72, 0.05)
        paw.add(claw)
      }
    }
    for (const hind of [lLeg, rLeg]) hind.position.z = -0.3 // 뒷다리를 엉덩이 아래로
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
  } else if (kind === 'necromancer') {
    // ---- 네크로맨서 — 이 군세를 일으킨 자. 유일하게 다리가 없는 실루엣이라
    //      멀리서도 "저건 병졸이 아니다"가 즉시 읽힌다.
    // 로브 — 어깨에서 바닥 가까이까지 한 덩어리로 떨어진다 (골반 아래로 -1.05까지)
    torso.add(
      lathe(
        [
          [0.0, 0.62],
          [0.2, 0.5],
          [0.26, 0.2],
          [0.34, -0.4],
          [0.46, -1.0],
          [0.5, -1.12],
        ],
        skin,
        16,
      ),
    )
    // 어깨 망토 — 로브와 색을 갈라 실루엣에 층을 준다
    const mantle = lathe(
      [
        [0.12, 0.6],
        [0.3, 0.42],
        [0.38, 0.1],
      ],
      MATS.clothDark,
      16,
    )
    torso.add(mantle)
    // 머리 — 후드. 얼굴은 없고 빈 어둠 속에 눈만 떠 있다
    head.position.set(0, 0.62, 0)
    const hood = lathe(
      [
        [0.0, 0.34],
        [0.15, 0.26],
        [0.22, 0.02],
        [0.24, -0.12],
      ],
      skin,
      14,
    )
    const voidFace = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: 0x000000 }))
    voidFace.position.set(0, 0.04, 0.05)
    head.add(hood, voidFace)
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), MAT_EYE)
      eye.position.set(s * 0.06, 0.06, 0.14)
      head.add(eye)
    }
    // 팔 — 가늘고 긴 소매. 오른손에 지팡이
    const armProf = (): [[number, number][], [number, number][]] => [
      [
        [0.09, 0],
        [0.11, -0.2],
        [0.08, -0.42],
      ],
      [
        [0.085, -0.42],
        [0.1, -0.52],
        [0.06, -0.74],
      ],
    ]
    lArm = mkArm(-1, [0.3, 0.44], ...armProf(), 0.11, -0.8)
    rArm = mkArm(1, [0.3, 0.44], ...armProf(), 0.11, -0.8)
    const staff = new THREE.Group()
    staff.position.y = -0.8
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.024, 1.9, 8), MAT_WOOD_DARK)
    shaft.position.y = 0.18
    // 끝에 물린 뼈 고리 + 발광 구슬 — 부활술의 출처가 눈에 보이게
    const claw = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.025, 6, 12), MAT_BONE)
    claw.rotation.x = Math.PI / 2
    claw.position.y = 1.06
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), MAT_EYE)
    orb.position.y = 1.06
    staff.add(shaft, claw, orb)
    rArm.add(staff)
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
  // 그림자는 실루엣 부품만 — 병합 전에 판정 (병합 후엔 부품 크기를 알 수 없다)
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.computeBoundingSphere()
      o.castShadow = (o.geometry.boundingSphere?.radius ?? 1) > 0.16
    }
  })
  // 본 그룹별 정적 병합 — 머리·팔은 따로 도는 자식이라 제외하고 각자 병합
  mergeStatic(torso, [head, lArm, rArm])
  mergeStatic(head)
  mergeStatic(lArm)
  mergeStatic(rArm)
  mergeStatic(lLeg)
  mergeStatic(rLeg)
  // 그림자는 몸통·다리만 — 괴수는 덩치가 곧 실루엣이라 팔·머리를 빼도 바닥 그림자는 유지된다
  setCast(torso, true) // torso 하위(머리·팔)까지 켠 뒤 아래에서 다시 끈다
  setCast(lLeg, true)
  setCast(rLeg, true)
  setCast(head, false)
  setCast(lArm, false)
  setCast(rArm, false)
  return {
    root,
    torso,
    head,
    lArm,
    rArm,
    lLeg,
    rLeg,
    hunch: K.hunch,
    hipH: K.hipH,
    gait: K.gait,
    atkDur: K.atkDur,
    mats: ownMaterials(root),
  }
}

/** 괴수 보행/대기 + 공격 스윙 + 피격 리액션.
 *  attackMs = meleeHit/wallHit, hitMs = 아군 공격 착탄으로부터 경과 ms (없으면 음수) */
export function animateMonster(
  rig: MonsterRig,
  t: number,
  moving: boolean,
  attackMs: number,
  hitMs = -1,
): void {
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
  // 피격 — 상체가 뒤로 젖혀지고 머리가 튄다. 공격 모션 위에 덧씌워 "맞으면서도 친다"
  if (hitMs >= 0 && hitMs < HIT_REACT_MS) {
    const q = 1 - hitMs / HIT_REACT_MS
    rig.torso.rotation.x -= 0.3 * q * q
    rig.torso.rotation.z += 0.16 * q * Math.sin(hitMs * 0.055)
    rig.head.rotation.x -= 0.25 * q * q
    rig.torso.position.y -= 0.05 * q * q
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
