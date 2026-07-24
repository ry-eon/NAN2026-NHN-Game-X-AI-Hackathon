// 성채·배경 비주얼 v2 (M2a-1b) — 실사풍 전환.
// CC0 PBR 텍스처(ambientCG)·HDRI(Poly Haven) 사용 — docs/asset-licenses.md 기록.
// 전체 성: 4면 성곽 + 모서리 망루 4 + 동면 성문루 + 내성. 동면이 전장 정면.

import * as THREE from 'three'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { FIELD, WALL_X } from '../../siege/sim/world'

const rand01 = (i: number, salt: number): number =>
  (((i * 73856093) ^ (salt * 19349663)) % 1000) / 1000

// 성곽 평면 배치: 동벽 = WALL_X (전장 정면), 서·남·북벽으로 폐곡
export const CASTLE = {
  east: WALL_X,
  west: WALL_X - 24,
  north: -18,
  south: 18,
  wallH: 7,
  wallT: 2.6,
  gateHalf: 3,
}

// ---------------------------------------------------------------- PBR 재질

const texLoader = new THREE.TextureLoader()

function pbr(
  name: string,
  repeatX: number,
  repeatY: number,
  extra: Partial<THREE.MeshStandardMaterialParameters> = {},
): THREE.MeshStandardMaterial {
  const load = (file: string, srgb = false): THREE.Texture => {
    const t = texLoader.load(`/assets/tex/${name}/${file}.jpg`)
    t.wrapS = THREE.RepeatWrapping
    t.wrapT = THREE.RepeatWrapping
    t.repeat.set(repeatX, repeatY)
    if (srgb) t.colorSpace = THREE.SRGBColorSpace
    return t
  }
  return new THREE.MeshStandardMaterial({
    map: load('color', true),
    normalMap: load('normal'),
    roughnessMap: load('rough'),
    ...extra,
  })
}

// ---------------------------------------------------------------- 환경광 (HDRI)

export function loadSky(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
  new RGBELoader().load('/assets/hdr/dusk_1k.hdr', (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping
    scene.environment = hdr // PBR 반사·간접광
    scene.background = hdr
    scene.backgroundIntensity = 0.5 // 황혼 무드로 감쇠
    scene.environmentIntensity = 0.55
    void renderer
  })
}

// ---------------------------------------------------------------- 성채

export interface WorldDecor {
  torchLights: THREE.PointLight[]
  flags: THREE.Mesh[]
}

/** 흉벽 달린 성벽 구간 (축 정렬) */
function wallSegment(
  scene: THREE.Scene,
  mat: THREE.Material,
  darkMat: THREE.Material,
  axis: 'x' | 'z',
  fixed: number,
  from: number,
  to: number,
): void {
  const len = Math.abs(to - from)
  const mid = (from + to) / 2
  const { wallH, wallT } = CASTLE
  const geo =
    axis === 'z'
      ? new THREE.BoxGeometry(wallT, wallH, len)
      : new THREE.BoxGeometry(len, wallH, wallT)
  const seg = new THREE.Mesh(geo, mat)
  seg.position.set(axis === 'z' ? fixed : mid, wallH / 2, axis === 'z' ? mid : fixed)
  seg.castShadow = true
  seg.receiveShadow = true
  scene.add(seg)
  // 흉벽
  for (let d = -len / 2 + 1.1; d < len / 2 - 0.5; d += 2.3) {
    const m = new THREE.Mesh(
      axis === 'z'
        ? new THREE.BoxGeometry(wallT, 1.1, 1.25)
        : new THREE.BoxGeometry(1.25, 1.1, wallT),
      darkMat,
    )
    m.position.set(
      axis === 'z' ? fixed : mid + d,
      wallH + 0.55,
      axis === 'z' ? mid + d : fixed,
    )
    m.castShadow = true
    scene.add(m)
  }
}

export function buildCastle(scene: THREE.Scene): WorldDecor {
  const decor: WorldDecor = { torchLights: [], flags: [] }
  const stone = pbr('bricks', 2.5, 1)
  const stoneDark = pbr('bricks', 1.2, 0.6, { color: 0x9a9aa8 })
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.85 })
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x5a3232, roughness: 0.7 })
  const { east, west, north, south, wallH, gateHalf } = CASTLE

  // 4면 성곽 (동면은 성문 개구부)
  wallSegment(scene, stone, stoneDark, 'z', east, north, -gateHalf)
  wallSegment(scene, stone, stoneDark, 'z', east, gateHalf, south)
  wallSegment(scene, stone, stoneDark, 'z', west, north, south)
  wallSegment(scene, stone, stoneDark, 'x', north, west, east)
  wallSegment(scene, stone, stoneDark, 'x', south, west, east)

  // 성문루: 상판 + 반개방 목재 성문
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3, gateHalf * 2 + 2.6), stone)
  lintel.position.set(east, wallH - 0.4, 0)
  lintel.castShadow = true
  scene.add(lintel)
  for (const side of [-1, 1]) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.35, 5.2, gateHalf * 0.95), wood)
    door.position.set(east + 0.5, 2.6, side * gateHalf * 0.6)
    door.rotation.y = side * 0.55
    door.castShadow = true
    scene.add(door)
  }

  // 망루: 모서리 4 + 성문 좌우 2 (원통 + 원뿔 지붕 + 깃발)
  const towers: [number, number, boolean][] = [
    [east, north, true],
    [east, south, true],
    [west, north, true],
    [west, south, true],
    [east, -gateHalf - 2.4, false],
    [east, gateHalf + 2.4, false],
  ]
  for (const [ti, [tx, tz, big]] of towers.entries()) {
    const r = big ? 3.0 : 2.0
    const h = big ? 12 : 10
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r, h, 12), stone)
    tower.position.set(tx, h / 2, tz)
    tower.castShadow = true
    tower.receiveShadow = true
    scene.add(tower)
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.08, r * 1.08, 0.9, 12), stoneDark)
    rim.position.set(tx, h - 0.2, tz)
    rim.castShadow = true
    scene.add(rim)
    const roof = new THREE.Mesh(new THREE.ConeGeometry(r * 1.2, big ? 3.4 : 2.8, 12), roofMat)
    roof.position.set(tx, h + (big ? 1.7 : 1.4), tz)
    roof.castShadow = true
    scene.add(roof)
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.8, 6), wood)
    pole.position.set(tx, h + (big ? 4.4 : 3.8), tz)
    scene.add(pole)
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.7, 0.95),
      new THREE.MeshStandardMaterial({ color: 0x8a2020, side: THREE.DoubleSide, roughness: 0.7 }),
    )
    flag.position.set(tx + 0.9, h + (big ? 4.9 : 4.3), tz)
    decor.flags.push(flag)
    scene.add(flag)
    void ti
  }

  // 횃불 (성문 양옆 + 동벽) — 포인트 라이트 4개 제한
  for (const tz of [-gateHalf - 1, gateHalf + 1, -12, 12]) {
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.2, 0.5, 6),
      new THREE.MeshBasicMaterial({ color: 0xffb050 }),
    )
    flame.position.set(east + 1.45, 4.4, tz)
    scene.add(flame)
    const light = new THREE.PointLight(0xff8838, 20, 14, 1.9)
    light.position.set(east + 1.7, 4.6, tz)
    decor.torchLights.push(light)
    scene.add(light)
  }

  // 내성 (안뜰 서쪽): 본성 + 지붕 + 창 불빛
  const keep = new THREE.Mesh(new THREE.BoxGeometry(7, 12, 10), stone)
  keep.position.set(west + 6, 6, 0)
  keep.castShadow = true
  keep.receiveShadow = true
  scene.add(keep)
  const keepRoof = new THREE.Mesh(new THREE.ConeGeometry(6.6, 4, 4), roofMat)
  keepRoof.position.set(west + 6, 14, 0)
  keepRoof.rotation.y = Math.PI / 4
  keepRoof.castShadow = true
  scene.add(keepRoof)
  for (const [wy, wz] of [
    [7, -2.4],
    [7, 2.4],
    [9.5, 0],
  ] as const) {
    const win = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7, 1.1),
      new THREE.MeshBasicMaterial({ color: 0xffc060 }),
    )
    win.position.set(west + 9.52, wy, wz)
    win.rotation.y = Math.PI / 2
    scene.add(win)
  }

  // 안뜰 소품: 우물, 궤짝 더미, 천막
  const wellBase = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 1, 10), stoneDark)
  wellBase.position.set(west + 14, 0.5, -6)
  wellBase.castShadow = true
  scene.add(wellBase)
  const wellRoof = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1, 6), roofMat)
  wellRoof.position.set(west + 14, 2.4, -6)
  scene.add(wellRoof)
  for (let i = 0; i < 5; i++) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), wood)
    crate.position.set(
      west + 4 + rand01(i, 61) * 6,
      0.5 + (i === 4 ? 1 : 0),
      6 + rand01(i, 62) * 5,
    )
    crate.rotation.y = rand01(i, 63)
    crate.castShadow = true
    scene.add(crate)
  }

  return decor
}

// ---------------------------------------------------------------- 지형·배경

export function buildEnvironment(scene: THREE.Scene): void {
  // 들판 (PBR 풀)
  const grassMat = pbr('grass', 18, 12, { color: 0x8a9a7a }) // 황혼 감쇠 틴트
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD.maxX - FIELD.minX + 90, FIELD.maxZ - FIELD.minZ + 70),
    grassMat,
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.set((FIELD.minX + FIELD.maxX) / 2, 0, 0)
  ground.receiveShadow = true
  scene.add(ground)

  // 흙길: 동쪽 지평 → 성문
  const dirtMat = pbr('dirt', 7, 1)
  const road = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.maxX - CASTLE.east + 20, 5.5), dirtMat)
  road.rotation.x = -Math.PI / 2
  road.position.set((CASTLE.east + FIELD.maxX) / 2 + 10, 0.02, 0)
  road.receiveShadow = true
  scene.add(road)

  // 안뜰 돌바닥 (PBR 포석)
  const paveMat = pbr('stone', 8, 10)
  const courtyard = new THREE.Mesh(
    new THREE.PlaneGeometry(CASTLE.east - CASTLE.west - 1, CASTLE.south - CASTLE.north - 1),
    paveMat,
  )
  courtyard.rotation.x = -Math.PI / 2
  courtyard.position.set((CASTLE.east + CASTLE.west) / 2, 0.03, 0)
  courtyard.receiveShadow = true
  scene.add(courtyard)

  // 바위 (PBR 아님 — 원경 소품)
  const rockGeo = new THREE.DodecahedronGeometry(1, 1)
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x33333c, roughness: 1, envMapIntensity: 0.25 })
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 24)
  const m = new THREE.Matrix4()
  let placed = 0
  for (let i = 0; i < 40 && placed < 24; i++) {
    const x = CASTLE.east + 8 + rand01(i, 31) * (FIELD.maxX - CASTLE.east - 8)
    const z = FIELD.minZ + rand01(i, 32) * (FIELD.maxZ - FIELD.minZ)
    if (Math.abs(z) < 4) continue
    const s = 0.5 + rand01(i, 33) * 1.2
    m.makeRotationY(rand01(i, 34) * Math.PI * 2)
    m.setPosition(x, s * 0.35, z)
    m.scale(new THREE.Vector3(s, s * 0.65, s))
    rocks.setMatrixAt(placed++, m)
  }
  rocks.count = placed
  rocks.castShadow = true
  rocks.receiveShadow = true
  scene.add(rocks)

  // 고사목
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x30281f, roughness: 1 })
  for (let i = 0; i < 9; i++) {
    const x = CASTLE.east + 12 + rand01(i, 41) * (FIELD.maxX - CASTLE.east - 12)
    const z = FIELD.minZ + rand01(i, 42) * (FIELD.maxZ - FIELD.minZ)
    if (Math.abs(z) < 4.5) continue
    const h = 2.6 + rand01(i, 43) * 2.2
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.22, h, 6), trunkMat)
    trunk.position.set(x, h / 2, z)
    trunk.rotation.z = (rand01(i, 44) - 0.5) * 0.3
    trunk.castShadow = true
    scene.add(trunk)
    for (let b = 0; b < 3; b++) {
      const bl = 0.9 + rand01(i * 3 + b, 45) * 0.9
      const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.08, bl, 4), trunkMat)
      branch.position.set(
        x + (rand01(i * 3 + b, 46) - 0.5) * 1.3,
        h * (0.55 + b * 0.16),
        z + (rand01(i * 3 + b, 47) - 0.5) * 1.3,
      )
      branch.rotation.z = (rand01(i * 3 + b, 48) - 0.5) * 2.1
      branch.castShadow = true
      scene.add(branch)
    }
  }
}
