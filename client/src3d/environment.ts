// 성채·배경 비주얼 (M2a-1) — 전부 절차 생성 (캔버스 텍스처 + 지오메트리 조합).
// 렌더링 전용 모듈: sim을 모르고, 장식 배치의 유사 난수는 결정론 해시(연출 전용).

import * as THREE from 'three'
import { FIELD, WALL_X } from '../../siege/sim/world'

const rand01 = (i: number, salt: number): number =>
  (((i * 73856093) ^ (salt * 19349663)) % 1000) / 1000

// ---------------------------------------------------------------- 절차 텍스처

function canvasTex(size: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  draw(c.getContext('2d')!)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** 석벽 벽돌 텍스처 */
function brickTexture(): THREE.CanvasTexture {
  return canvasTex(256, (ctx) => {
    ctx.fillStyle = '#4e4e66'
    ctx.fillRect(0, 0, 256, 256)
    const bh = 32
    const bw = 64
    let i = 0
    for (let y = 0; y < 256; y += bh) {
      const off = (y / bh) % 2 === 0 ? 0 : bw / 2
      for (let x = -bw; x < 256 + bw; x += bw) {
        const shade = 0.82 + rand01(i++, 7) * 0.3
        ctx.fillStyle = `rgb(${Math.floor(84 * shade)},${Math.floor(84 * shade)},${Math.floor(108 * shade)})`
        ctx.fillRect(x + off + 2, y + 2, bw - 4, bh - 4)
      }
    }
  })
}

/** 들판 텍스처 (어두운 풀 + 흙 반점) */
function grassTexture(): THREE.CanvasTexture {
  return canvasTex(256, (ctx) => {
    ctx.fillStyle = '#2c3626'
    ctx.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 900; i++) {
      const x = rand01(i, 1) * 256
      const y = rand01(i, 2) * 256
      const g = rand01(i, 3)
      ctx.fillStyle = g < 0.6 ? '#333f2b' : g < 0.85 ? '#26301f' : '#3d4a33'
      ctx.fillRect(x, y, 3 + g * 4, 2 + g * 3)
    }
  })
}

/** 흙길 텍스처 */
function dirtTexture(): THREE.CanvasTexture {
  return canvasTex(128, (ctx) => {
    ctx.fillStyle = '#4a3d2c'
    ctx.fillRect(0, 0, 128, 128)
    for (let i = 0; i < 260; i++) {
      const x = rand01(i, 11) * 128
      const y = rand01(i, 12) * 128
      const g = rand01(i, 13)
      ctx.fillStyle = g < 0.5 ? '#413524' : g < 0.8 ? '#544634' : '#5e503c'
      ctx.fillRect(x, y, 2 + g * 5, 2 + g * 3)
    }
  })
}

/** 돌바닥(안뜰) 텍스처 */
function flagstoneTexture(): THREE.CanvasTexture {
  return canvasTex(256, (ctx) => {
    ctx.fillStyle = '#3a3a4a'
    ctx.fillRect(0, 0, 256, 256)
    let i = 0
    for (let y = 0; y < 256; y += 42) {
      for (let x = 0; x < 256; x += 42) {
        const s = 0.85 + rand01(i++, 21) * 0.25
        ctx.fillStyle = `rgb(${Math.floor(64 * s)},${Math.floor(64 * s)},${Math.floor(80 * s)})`
        ctx.fillRect(x + 2, y + 2, 38, 38)
      }
    }
  })
}

// ---------------------------------------------------------------- 성채

export interface WorldDecor {
  torchLights: THREE.PointLight[]
  flags: THREE.Mesh[]
}

export function buildCastle(scene: THREE.Scene): WorldDecor {
  const decor: WorldDecor = { torchLights: [], flags: [] }
  const brick = brickTexture()
  brick.repeat.set(3, 1.2)
  const stone = new THREE.MeshStandardMaterial({ map: brick, roughness: 0.92 })
  const stoneDark = new THREE.MeshStandardMaterial({ color: 0x3e3e54, roughness: 0.95 })
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 0.9 })
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x6a3a3a, roughness: 0.8 })

  const span = FIELD.maxZ - FIELD.minZ + 8
  const GATE_HALF = 3 // 성문 개구부 반폭 (z)

  // 성벽 본체 — 성문 개구부를 남기고 두 구간
  for (const [z0, z1] of [
    [-span / 2, -GATE_HALF],
    [GATE_HALF, span / 2],
  ] as const) {
    const len = z1 - z0
    const seg = new THREE.Mesh(new THREE.BoxGeometry(3, 6, len), stone)
    seg.position.set(WALL_X - 1.5, 3, (z0 + z1) / 2)
    seg.castShadow = true
    seg.receiveShadow = true
    scene.add(seg)
    // 흉벽
    for (let z = z0 + 1.2; z < z1 - 0.6; z += 2.4) {
      const merlon = new THREE.Mesh(new THREE.BoxGeometry(3, 1.2, 1.3), stoneDark)
      merlon.position.set(WALL_X - 1.5, 6.6, z)
      merlon.castShadow = true
      scene.add(merlon)
    }
  }

  // 성문루 (게이트하우스): 개구부 위 상판 + 나무 성문 (반개방)
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.6, GATE_HALF * 2 + 2.4), stone)
  lintel.position.set(WALL_X - 1.5, 6, 0)
  lintel.castShadow = true
  scene.add(lintel)
  for (const side of [-1, 1]) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4.6, GATE_HALF * 0.95), wood)
    door.position.set(WALL_X - 0.4, 2.3, side * GATE_HALF * 0.62)
    door.rotation.y = side * 0.5 // 반쯤 열린 문
    door.castShadow = true
    scene.add(door)
  }

  // 성문 좌우 탑 + 모서리 망루 (원뿔 지붕 + 깃발)
  const towerZs = [-GATE_HALF - 2.2, GATE_HALF + 2.2, FIELD.minZ - 2, FIELD.maxZ + 2]
  for (const [ti, tz] of towerZs.entries()) {
    const big = ti >= 2
    const r = big ? 2.6 : 1.9
    const h = big ? 11 : 9
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r, h, 10), stone)
    tower.position.set(WALL_X - 1.5, h / 2, tz)
    tower.castShadow = true
    scene.add(tower)
    const roof = new THREE.Mesh(new THREE.ConeGeometry(r * 1.15, 2.6, 10), roofMat)
    roof.position.set(WALL_X - 1.5, h + 1.3, tz)
    roof.castShadow = true
    scene.add(roof)
    // 깃대 + 깃발
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), stoneDark)
    pole.position.set(WALL_X - 1.5, h + 3.6, tz)
    scene.add(pole)
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x8a2a2a, side: THREE.DoubleSide }),
    )
    flag.position.set(WALL_X - 1.5 + 0.85, h + 4.1, tz)
    decor.flags.push(flag)
    scene.add(flag)
  }

  // 횃불 (성벽 앞면, 성문 양옆 + 구간별) — 포인트 라이트는 4개로 제한 (성능)
  const torchZs = [-GATE_HALF - 1, GATE_HALF + 1, -14, 14]
  for (const tz of torchZs) {
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.18), wood)
    bracket.position.set(WALL_X + 0.15, 3.6, tz)
    scene.add(bracket)
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.55, 6),
      new THREE.MeshBasicMaterial({ color: 0xffb050 }),
    )
    flame.position.set(WALL_X + 0.15, 4.05, tz)
    scene.add(flame)
    const light = new THREE.PointLight(0xff9040, 14, 12, 1.8)
    light.position.set(WALL_X + 0.5, 4.2, tz)
    decor.torchLights.push(light)
    scene.add(light)
  }

  // 내성 (donjon) — 안뜰 뒤편의 본성 실루엣
  const keep = new THREE.Mesh(new THREE.BoxGeometry(5, 10, 8), stone)
  keep.position.set(FIELD.minX - 3, 5, 0)
  keep.castShadow = true
  scene.add(keep)
  const keepRoof = new THREE.Mesh(new THREE.ConeGeometry(5.4, 3.4, 4), roofMat)
  keepRoof.position.set(FIELD.minX - 3, 11.7, 0)
  keepRoof.rotation.y = Math.PI / 4
  scene.add(keepRoof)

  return decor
}

// ---------------------------------------------------------------- 지형·배경

export function buildEnvironment(scene: THREE.Scene): void {
  // 하늘: 황혼 그라데이션 돔
  const skyTex = canvasTex(256, (ctx) => {
    const grad = ctx.createLinearGradient(0, 0, 0, 256)
    grad.addColorStop(0, '#0b0b18')
    grad.addColorStop(0.55, '#1c1630')
    grad.addColorStop(0.8, '#4a2a3a')
    grad.addColorStop(1, '#7a4030')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 256, 256)
  })
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(140, 24, 12),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }),
  )
  scene.add(sky)

  // 들판
  const grass = grassTexture()
  grass.repeat.set(10, 7)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD.maxX - FIELD.minX + 60, FIELD.maxZ - FIELD.minZ + 50),
    new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.set((FIELD.minX + FIELD.maxX) / 2, 0, 0)
  ground.receiveShadow = true
  scene.add(ground)

  // 흙길: 동쪽 → 성문
  const dirt = dirtTexture()
  dirt.repeat.set(8, 1)
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD.maxX - WALL_X + 6, 5),
    new THREE.MeshStandardMaterial({ map: dirt, roughness: 1 }),
  )
  road.rotation.x = -Math.PI / 2
  road.position.set((WALL_X + FIELD.maxX) / 2 + 3, 0.015, 0)
  road.receiveShadow = true
  scene.add(road)

  // 안뜰 돌바닥
  const flagstone = flagstoneTexture()
  flagstone.repeat.set(2.5, 5)
  const courtyard = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.abs(FIELD.minX - WALL_X) + 8, FIELD.maxZ - FIELD.minZ + 10),
    new THREE.MeshStandardMaterial({ map: flagstone, roughness: 1 }),
  )
  courtyard.rotation.x = -Math.PI / 2
  courtyard.position.set((FIELD.minX + WALL_X) / 2 - 1, 0.02, 0)
  courtyard.receiveShadow = true
  scene.add(courtyard)

  // 바위 (인스턴스) — 들판 산개
  const rockGeo = new THREE.DodecahedronGeometry(1, 0)
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x4a4a56, roughness: 1 })
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 26)
  const m = new THREE.Matrix4()
  for (let i = 0; i < 26; i++) {
    const x = WALL_X + 6 + rand01(i, 31) * (FIELD.maxX - WALL_X - 8)
    const z = FIELD.minZ + rand01(i, 32) * (FIELD.maxZ - FIELD.minZ)
    if (Math.abs(z) < 3.5) continue // 흙길 위엔 안 놓음
    const s = 0.5 + rand01(i, 33) * 1.1
    m.makeRotationY(rand01(i, 34) * Math.PI * 2)
    m.setPosition(x, s * 0.4, z)
    m.scale(new THREE.Vector3(s, s * 0.7, s))
    rocks.setMatrixAt(i, m)
  }
  rocks.castShadow = true
  rocks.receiveShadow = true
  scene.add(rocks)

  // 고사목 (죽은 나무) — 생존 톤
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a3028, roughness: 1 })
  for (let i = 0; i < 10; i++) {
    const x = WALL_X + 10 + rand01(i, 41) * (FIELD.maxX - WALL_X - 10)
    const z = FIELD.minZ + rand01(i, 42) * (FIELD.maxZ - FIELD.minZ)
    if (Math.abs(z) < 4) continue
    const h = 2.4 + rand01(i, 43) * 2
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, h, 5), trunkMat)
    trunk.position.set(x, h / 2, z)
    trunk.rotation.z = (rand01(i, 44) - 0.5) * 0.25
    trunk.castShadow = true
    scene.add(trunk)
    for (let b = 0; b < 3; b++) {
      const bl = 0.8 + rand01(i * 3 + b, 45) * 0.8
      const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, bl, 4), trunkMat)
      branch.position.set(x + (rand01(i * 3 + b, 46) - 0.5) * 1.2, h * (0.55 + b * 0.15), z + (rand01(i * 3 + b, 47) - 0.5) * 1.2)
      branch.rotation.z = (rand01(i * 3 + b, 48) - 0.5) * 2
      branch.castShadow = true
      scene.add(branch)
    }
  }

  // 원경 산맥 실루엣 (동쪽 지평)
  const mountainMat = new THREE.MeshBasicMaterial({ color: 0x16121f, fog: false })
  for (let i = 0; i < 7; i++) {
    const mx = FIELD.maxX + 26 + rand01(i, 51) * 16
    const mz = -50 + i * 17 + rand01(i, 52) * 8
    const mh = 14 + rand01(i, 53) * 16
    const peak = new THREE.Mesh(new THREE.ConeGeometry(12 + rand01(i, 54) * 8, mh, 5), mountainMat)
    peak.position.set(mx, mh / 2 - 1, mz)
    scene.add(peak)
  }

  // 낮게 뜬 붉은 달
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(4, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xc06a4a, fog: false }),
  )
  moon.position.set(FIELD.maxX + 55, 26, -34)
  scene.add(moon)
}
