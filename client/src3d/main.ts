// 농성전 3D 렌더러 (M1 뼈대) — three.js.
// sim(siege/sim/world.ts)은 렌더링을 모른다. 여기는 상태를 그리고 입력을 모을 뿐.

import * as THREE from 'three'
import {
  ENEMY_KINDS,
  FIELD,
  WALL_HP,
  WALL_X,
  createSiege,
  stepSiege,
  TICKS_PER_SECOND,
} from '../../siege/sim/world'
import type { SiegeInput } from '../../siege/sim/world'

const STEP_MS = 1000 / TICKS_PER_SECOND

// ---------------------------------------------------------------- 씬
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
document.getElementById('game')!.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0d0d17)
scene.fog = new THREE.Fog(0x0d0d17, 45, 90)

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200)

const hemi = new THREE.HemisphereLight(0x8899bb, 0x223322, 0.9)
scene.add(hemi)
const sun = new THREE.DirectionalLight(0xffeecc, 1.1)
sun.position.set(-20, 30, 10)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.left = -50
sun.shadow.camera.right = 50
sun.shadow.camera.top = 50
sun.shadow.camera.bottom = -50
scene.add(sun)

// 들판
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(FIELD.maxX - FIELD.minX + 30, FIELD.maxZ - FIELD.minZ + 20),
  new THREE.MeshStandardMaterial({ color: 0x2a3328, roughness: 1 }),
)
ground.rotation.x = -Math.PI / 2
ground.position.set((FIELD.minX + FIELD.maxX) / 2, 0, 0)
ground.receiveShadow = true
scene.add(ground)

// 성벽: WALL_X 평면, z 스팬 — 흉벽 있는 돌벽
const wallGroup = new THREE.Group()
const stone = new THREE.MeshStandardMaterial({ color: 0x5a5a72, roughness: 0.9 })
const stoneDark = new THREE.MeshStandardMaterial({ color: 0x46465a, roughness: 0.95 })
const span = FIELD.maxZ - FIELD.minZ
const wallBody = new THREE.Mesh(new THREE.BoxGeometry(2.4, 5, span + 4), stone)
wallBody.position.set(WALL_X - 1.2, 2.5, 0)
wallBody.castShadow = true
wallBody.receiveShadow = true
wallGroup.add(wallBody)
for (let z = FIELD.minZ - 1; z <= FIELD.maxZ + 1; z += 2.2) {
  const merlon = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 1.2), stoneDark)
  merlon.position.set(WALL_X - 1.2, 5.55, z)
  merlon.castShadow = true
  wallGroup.add(merlon)
}
// 망루 2개
for (const tz of [FIELD.minZ - 1, FIELD.maxZ + 1]) {
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 9, 8), stone)
  tower.position.set(WALL_X - 1.2, 4.5, tz)
  tower.castShadow = true
  wallGroup.add(tower)
}
scene.add(wallGroup)

// 성 내부 바닥 (돌)
const courtyard = new THREE.Mesh(
  new THREE.PlaneGeometry(Math.abs(FIELD.minX - WALL_X) + 6, span + 6),
  new THREE.MeshStandardMaterial({ color: 0x3a3a48, roughness: 1 }),
)
courtyard.rotation.x = -Math.PI / 2
courtyard.position.set((FIELD.minX + WALL_X) / 2 - 1, 0.02, 0)
courtyard.receiveShadow = true
scene.add(courtyard)

// 성주 (복셀풍 임시 모델: 몸+머리+망토)
function makeLord(): THREE.Group {
  const g = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 1.1, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x5aa0d0 }),
  )
  body.position.y = 0.85
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.5, 0.5),
    new THREE.MeshStandardMaterial({ color: 0xd8b090 }),
  )
  head.position.y = 1.7
  const crown = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.18, 0.55),
    new THREE.MeshStandardMaterial({ color: 0xffd048, emissive: 0x332200 }),
  )
  crown.position.y = 2.0
  const cape = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 1.0, 0.15),
    new THREE.MeshStandardMaterial({ color: 0x8a2a2a }),
  )
  cape.position.set(0, 0.85, -0.3)
  for (const m of [body, head, crown, cape]) m.castShadow = true
  g.add(body, head, crown, cape)
  return g
}
const lordMesh = makeLord()
scene.add(lordMesh)

// 괴수 메시 풀
const enemyMeshes = new Map<number, THREE.Mesh>()
const enemyMats: Record<string, THREE.MeshStandardMaterial> = {
  grunt: new THREE.MeshStandardMaterial({ color: 0x9a4444 }),
  runner: new THREE.MeshStandardMaterial({ color: 0xc07c3e }),
  tank: new THREE.MeshStandardMaterial({ color: 0x6a4a9a }),
}

// ---------------------------------------------------------------- 입력
const keys = new Set<string>()
window.addEventListener('keydown', (e) => keys.add(e.code))
window.addEventListener('keyup', (e) => keys.delete(e.code))

// 카메라 궤도 (우클릭 드래그 회전, 휠 줌)
let camYaw = -0.9
let camPitch = 0.62
let camDist = 16
window.addEventListener('contextmenu', (e) => e.preventDefault())
window.addEventListener('mousemove', (e) => {
  if (e.buttons & 2) {
    camYaw -= e.movementX * 0.005
    camPitch = Math.max(0.15, Math.min(1.3, camPitch + e.movementY * 0.004))
  }
})
window.addEventListener('wheel', (e) => {
  camDist = Math.max(7, Math.min(40, camDist + e.deltaY * 0.02))
})

// ---------------------------------------------------------------- HUD (DOM)
const hud = document.createElement('div')
hud.style.cssText =
  'position:fixed;inset:0;pointer-events:none;font-family:monospace;color:#e8e8f0;text-shadow:0 1px 3px #000'
hud.innerHTML = `
  <div style="position:absolute;top:14px;left:16px;font-size:18px;font-weight:bold">마지막 성벽 — 농성전 3D (M1)</div>
  <div style="position:absolute;top:44px;left:16px;font-size:13px">
    성벽 <span id="wall"></span><div style="width:280px;height:10px;background:#000a;margin-top:3px"><div id="wallbar" style="height:100%;width:100%;background:#62c462"></div></div>
  </div>
  <div id="phase" style="position:absolute;top:14px;left:50%;transform:translateX(-50%);font-size:15px;color:#ffd870"></div>
  <div style="position:absolute;bottom:14px;left:16px;font-size:12px;color:#a0a0b8">
    WASD 이동 · 우클릭 드래그 회전 · 휠 줌 · <b>Space</b> 침공 개시
  </div>`
const startBtn = document.createElement('div')
document.body.appendChild(hud)
void startBtn

// ---------------------------------------------------------------- 루프
const { state, spawns } = createSiege(20260725)
let acc = 0
let last = performance.now()

function collectInput(): SiegeInput {
  // 카메라 기준 이동 (W = 카메라가 보는 방향)
  let fx = 0
  let fz = 0
  if (keys.has('KeyW')) fz += 1
  if (keys.has('KeyS')) fz -= 1
  if (keys.has('KeyA')) fx -= 1
  if (keys.has('KeyD')) fx += 1
  const sin = Math.sin(camYaw)
  const cos = Math.cos(camYaw)
  return {
    moveX: fz * -sin + fx * cos,
    moveZ: fz * -cos - fx * sin,
    startAssault: keys.has('Space'),
  }
}

function syncScene(): void {
  lordMesh.position.set(state.lord.pos.x, 0, state.lord.pos.z)
  lordMesh.rotation.y = state.lord.facing

  for (const e of state.enemies) {
    let mesh = enemyMeshes.get(e.id)
    if (!mesh) {
      const def = ENEMY_KINDS[e.kind]!
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(def.radius * 2, def.radius * 2.4, def.radius * 2),
        enemyMats[e.kind] ?? enemyMats.grunt!,
      )
      mesh.castShadow = true
      enemyMeshes.set(e.id, mesh)
      scene.add(mesh)
    }
    const def = ENEMY_KINDS[e.kind]!
    const bob = e.atWall ? 0 : Math.sin(state.tick * 0.3 + e.id) * 0.08
    mesh.position.set(e.pos.x, def.radius * 1.2 + bob, e.pos.z)
  }
  for (const [id, mesh] of enemyMeshes) {
    if (!state.enemies.some((e) => e.id === id)) {
      scene.remove(mesh)
      enemyMeshes.delete(id)
    }
  }

  // 카메라: 성주 추적 궤도
  const target = new THREE.Vector3(state.lord.pos.x, 1.2, state.lord.pos.z)
  camera.position.set(
    target.x + Math.sin(camYaw) * Math.cos(camPitch) * camDist,
    target.y + Math.sin(camPitch) * camDist,
    target.z + Math.cos(camYaw) * Math.cos(camPitch) * camDist,
  )
  camera.lookAt(target)

  // HUD
  document.getElementById('wall')!.textContent = `${state.wallHp}/${WALL_HP}`
  ;(document.getElementById('wallbar') as HTMLDivElement).style.width =
    `${(state.wallHp / WALL_HP) * 100}%`
  const phase = document.getElementById('phase')!
  phase.textContent =
    state.status === 'prep'
      ? '준비 단계 — 성을 둘러보고, Space로 침공 개시'
      : state.status === 'assault'
        ? `침공 진행 중 — 괴수 ${state.enemies.length}`
        : state.status === 'won'
          ? '성을 지켜냈다!'
          : '성이 함락됐다'
}

function frame(now: number): void {
  acc = Math.min(acc + (now - last), STEP_MS * 6)
  last = now
  const input = collectInput()
  while (acc >= STEP_MS) {
    acc -= STEP_MS
    stepSiege(state, spawns, input)
  }
  syncScene()
  renderer.render(scene, camera)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})
