// 성채·배경 비주얼 v2 (M2a-1b) — 실사풍 전환.
// CC0 PBR 텍스처(ambientCG)·HDRI(Poly Haven) 사용 — docs/asset-licenses.md 기록.
// 전체 성: 4면 성곽 + 모서리 망루 4 + 동면 성문루 + 내성. 동면이 전장 정면.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
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
  const mat = new THREE.MeshStandardMaterial({
    map: load('color', true),
    normalMap: load('normal'),
    roughnessMap: load('rough'),
    ...extra,
  })
  return mat
}

/** 변위(요철) 버전 — 세분화된 지오메트리와 함께 사용 */
function pbrDisplaced(
  name: string,
  repeatX: number,
  repeatY: number,
  scale: number,
  extra: Partial<THREE.MeshStandardMaterialParameters> = {},
): THREE.MeshStandardMaterial {
  const mat = pbr(name, repeatX, repeatY, extra)
  const t = texLoader.load(`/assets/tex/${name}/disp.jpg`)
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeatX, repeatY)
  mat.displacementMap = t
  mat.displacementScale = scale
  mat.displacementBias = -scale / 2
  return mat
}

// ---------------------------------------------------------------- 환경광 (HDRI)

export function loadSky(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
  new RGBELoader().load('/assets/hdr/dusk_1k.hdr', (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping
    scene.environment = hdr // PBR 미세 간접광만 (반사 디테일용)
    scene.environmentIntensity = 0.16
    void renderer
  })
  // 배경: 칠흑에 가까운 밤 — 다크소울 톤
  scene.background = new THREE.Color(0x05060c)

  // 창백한 달 (안개 무시, 낮게)
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(3.2, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0x9aa4bd, fog: false }),
  )
  moon.position.set(FIELD.maxX + 60, 30, -40)
  scene.add(moon)
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(4.6, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0x6a7490, transparent: true, opacity: 0.22, fog: false }),
  )
  halo.position.copy(moon.position)
  scene.add(halo)
}

/** 떠다니는 재(灰) 입자 — 렌더러 전용 연출 */
export function buildAsh(scene: THREE.Scene): THREE.Points {
  const N = 380
  const positions = new Float32Array(N * 3)
  for (let i = 0; i < N; i++) {
    positions[i * 3] = FIELD.minX - 10 + rand01(i, 71) * (FIELD.maxX - FIELD.minX + 30)
    positions[i * 3 + 1] = rand01(i, 72) * 14
    positions[i * 3 + 2] = FIELD.minZ - 10 + rand01(i, 73) * (FIELD.maxZ - FIELD.minZ + 20)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const pts = new THREE.Points(
    geo,
    new THREE.PointsMaterial({ color: 0x9a9aa2, size: 0.08, transparent: true, opacity: 0.32 }),
  )
  scene.add(pts)
  return pts
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
  // 변위 맵이 실제 요철을 만들도록 세분화
  const geo =
    axis === 'z'
      ? new THREE.BoxGeometry(wallT, wallH, len, 4, 24, Math.max(24, Math.floor(len * 2)))
      : new THREE.BoxGeometry(len, wallH, wallT, Math.max(24, Math.floor(len * 2)), 24, 4)
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
  const stone = pbrDisplaced('bricks', 2.5, 1, 0.22, { color: 0x9aa0b0 })
  const stoneDark = pbr('bricks', 1.2, 0.6, { color: 0x9a9aa8 })
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.85 })
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x22232e, roughness: 0.75 })
  const { east, west, north, south, wallH, gateHalf } = CASTLE

  // 4면 성곽 (동면은 성문 개구부)
  wallSegment(scene, stone, stoneDark, 'z', east, north, -gateHalf)
  wallSegment(scene, stone, stoneDark, 'z', east, gateHalf, south)
  wallSegment(scene, stone, stoneDark, 'z', west, north, south)
  wallSegment(scene, stone, stoneDark, 'x', north, west, east)
  wallSegment(scene, stone, stoneDark, 'x', south, west, east)

  // 성문루: 아치형 개구 (Shape에 구멍) + 상부 총안
  const arch = new THREE.Shape()
  const gw = gateHalf + 1.4
  arch.moveTo(-gw, 0)
  arch.lineTo(-gw, wallH + 1.6)
  arch.lineTo(gw, wallH + 1.6)
  arch.lineTo(gw, 0)
  arch.lineTo(gateHalf * 0.9, 0)
  arch.lineTo(gateHalf * 0.9, 3.4)
  arch.absarc(0, 3.4, gateHalf * 0.9, 0, Math.PI, false)
  arch.lineTo(-gateHalf * 0.9, 0)
  arch.lineTo(-gw, 0)
  const gateGeo = new THREE.ExtrudeGeometry(arch, { depth: CASTLE.wallT + 1, bevelEnabled: false })
  const gatehouse = new THREE.Mesh(gateGeo, pbr('bricks', 0.5, 0.35, { color: 0x9aa0b0 }))
  gatehouse.rotation.y = -Math.PI / 2
  gatehouse.position.set(east + (CASTLE.wallT + 1) / 2, 0, -gw)
  // ExtrudeGeometry 좌표계 보정: shape의 x가 -z가 되도록 회전했으므로 z 오프셋
  gatehouse.position.z = gw
  gatehouse.castShadow = true
  gatehouse.receiveShadow = true
  scene.add(gatehouse)
  // 아치 위 머시콜레이션(내밀린 총안 돌기)
  for (let z = -gw + 0.6; z < gw; z += 1.2) {
    const cor = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), stone)
    cor.position.set(east + 1.6, wallH + 1.2, z)
    cor.castShadow = true
    scene.add(cor)
  }
  for (const side of [-1, 1]) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.35, 5.2, gateHalf * 0.95), wood)
    door.position.set(east + 0.5, 2.6, side * gateHalf * 0.6)
    door.rotation.y = side * 0.55
    door.castShadow = true
    scene.add(door)
  }

  // 버트레스: 동벽 바깥 경사 지지벽 — 성벽 실루엣을 풍부하게
  for (const bz of [-14, -8.5, 8.5, 14]) {
    const but = new THREE.Mesh(new THREE.BoxGeometry(1.6, wallH * 0.75, 1.4), stone)
    but.position.set(east + 0.9, (wallH * 0.75) / 2, bz)
    but.rotation.z = -0.06
    but.castShadow = true
    scene.add(but)
    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 1.7), stoneDark)
    cap.position.set(east + 0.85, wallH * 0.75, bz)
    cap.castShadow = true
    scene.add(cap)
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
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r, h, 24, 16), stone)
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
      new THREE.MeshStandardMaterial({ color: 0x4e1616, side: THREE.DoubleSide, roughness: 0.85 }),
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
  {
    const crateLoader = new GLTFLoader()
    crateLoader.load('/assets/models/wooden_crate_01/wooden_crate_01.gltf', (g) => {
      g.scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = true
          o.receiveShadow = true
        }
      })
      for (let i = 0; i < 5; i++) {
        const inst = g.scene.clone(true)
        inst.position.set(west + 4 + rand01(i, 61) * 6, i === 4 ? 0.95 : 0, 6 + rand01(i, 62) * 5)
        inst.rotation.y = rand01(i, 63) * Math.PI
        scene.add(inst)
      }
    })
  }

  // 길가 화톳불 2기 — 어둠을 견디는 전초의 불빛
  for (const [bx, bz] of [
    [east + 10, -5],
    [east + 22, 5.5],
  ] as const) {
    const pit = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.85, 0.45, 8), stoneDark)
    pit.position.set(bx, 0.22, bz)
    pit.castShadow = true
    scene.add(pit)
    const fire = new THREE.Mesh(
      new THREE.ConeGeometry(0.4, 0.9, 7),
      new THREE.MeshBasicMaterial({ color: 0xff9a40 }),
    )
    fire.position.set(bx, 0.85, bz)
    scene.add(fire)
    const light = new THREE.PointLight(0xff7a30, 26, 16, 1.9)
    light.position.set(bx, 1.6, bz)
    decor.torchLights.push(light)
    scene.add(light)
  }

  return decor
}

// ---------------------------------------------------------------- 지형·배경

export function buildEnvironment(scene: THREE.Scene): void {
  // 들판 (PBR 풀)
  const grassMat = pbr('grass', 18, 12, { color: 0x60604f }) // 죽은 들판 — 잿빛 감쇠
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD.maxX - FIELD.minX + 90, FIELD.maxZ - FIELD.minZ + 70),
    grassMat,
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.set((FIELD.minX + FIELD.maxX) / 2, 0, 0)
  ground.receiveShadow = true
  scene.add(ground)

  // 흙길: 동쪽 지평 → 성문
  const dirtMat = pbr('dirt', 7, 1, { color: 0x8a8078 })
  const road = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.maxX - CASTLE.east + 20, 5.5), dirtMat)
  road.rotation.x = -Math.PI / 2
  road.position.set((CASTLE.east + FIELD.maxX) / 2 + 10, 0.02, 0)
  road.receiveShadow = true
  scene.add(road)

  // 안뜰 돌바닥 (PBR 포석)
  const paveMat = pbr('stone', 8, 10, { color: 0x9098a8 })
  const courtyard = new THREE.Mesh(
    new THREE.PlaneGeometry(CASTLE.east - CASTLE.west - 1, CASTLE.south - CASTLE.north - 1),
    paveMat,
  )
  courtyard.rotation.x = -Math.PI / 2
  courtyard.position.set((CASTLE.east + CASTLE.west) / 2, 0.03, 0)
  courtyard.receiveShadow = true
  scene.add(courtyard)

  // 포토스캔 소품 (Poly Haven CC0): 이끼 바위 세트·고사목 — 실사 디테일 담당
  const gltf = new GLTFLoader()
  const scatter = (
    url: string,
    placements: { x: number; z: number; s: number; ry: number }[],
    tint?: number,
  ): void => {
    gltf.load(url, (g) => {
      g.scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = true
          o.receiveShadow = true
          if (tint) {
            const m = o.material as THREE.MeshStandardMaterial
            m.color.multiplyScalar(1)
            m.color.setHex(tint).multiply(new THREE.Color(1, 1, 1))
          }
        }
      })
      for (const p of placements) {
        const inst = g.scene.clone(true)
        inst.position.set(p.x, 0, p.z)
        inst.scale.setScalar(p.s)
        inst.rotation.y = p.ry
        scene.add(inst)
      }
    })
  }
  const rockPlaces = []
  for (let i = 0; i < 9; i++) {
    const x = CASTLE.east + 8 + rand01(i, 31) * (FIELD.maxX - CASTLE.east - 8)
    const z = FIELD.minZ + rand01(i, 32) * (FIELD.maxZ - FIELD.minZ)
    if (Math.abs(z) < 4.5) continue
    rockPlaces.push({ x, z, s: 0.35 + rand01(i, 33) * 0.55, ry: rand01(i, 34) * Math.PI * 2 })
  }
  scatter('/assets/models/rock_moss_set_01/rock_moss_set_01.gltf', rockPlaces)

  const treePlaces = []
  for (let i = 0; i < 6; i++) {
    const x = CASTLE.east + 13 + rand01(i, 41) * (FIELD.maxX - CASTLE.east - 13)
    const z = FIELD.minZ + rand01(i, 42) * (FIELD.maxZ - FIELD.minZ)
    if (Math.abs(z) < 5) continue
    treePlaces.push({ x, z, s: 0.9 + rand01(i, 43) * 0.6, ry: rand01(i, 44) * Math.PI * 2 })
  }
  scatter('/assets/models/dead_tree_trunk/dead_tree_trunk.gltf', treePlaces)
}
