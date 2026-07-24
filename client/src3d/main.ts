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
scene.fog = new THREE.Fog(0x12121e, 55, 110)

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200)

const hemi = new THREE.HemisphereLight(0xaabbdd, 0x334433, 1.35)
scene.add(hemi)
const sun = new THREE.DirectionalLight(0xffeecc, 1.5)
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

// ---------------------------------------------------------------- 입력 (LoL식)
let spaceLatch = false
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') spaceLatch = true
})

// 고정 부감 카메라: 남쪽에서 북쪽을 내려다봄 (서=성벽=왼쪽, 동=적=오른쪽). 휠 줌만.
let camDist = 22
window.addEventListener('contextmenu', (e) => e.preventDefault())
window.addEventListener('wheel', (e) => {
  camDist = Math.max(10, Math.min(38, camDist + e.deltaY * 0.02))
})

// 우클릭 → 지면 좌표로 이동 명령
const raycaster = new THREE.Raycaster()
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
let pendingMove: { x: number; z: number } | undefined
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 2) return
  const ndc = new THREE.Vector2(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1,
  )
  raycaster.setFromCamera(ndc, camera)
  const hit = new THREE.Vector3()
  if (raycaster.ray.intersectPlane(groundPlane, hit)) {
    pendingMove = { x: hit.x, z: hit.z }
    showMoveMarker(hit.x, hit.z)
  }
})

// 이동 마커 (LoL식 클릭 링)
function showMoveMarker(x: number, z: number): void {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.4, 0.6, 24),
    new THREE.MeshBasicMaterial({ color: 0x62c462, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
  )
  ring.rotation.x = -Math.PI / 2
  ring.position.set(x, 0.05, z)
  scene.add(ring)
  const t0 = performance.now()
  const anim = (): void => {
    const k = (performance.now() - t0) / 450
    if (k >= 1) {
      scene.remove(ring)
      return
    }
    ring.scale.setScalar(1 - k * 0.6)
    ;(ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k)
    requestAnimationFrame(anim)
  }
  anim()
}

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
    우클릭: 이동 · 휠: 줌 · <b>Space</b>: 침공 개시
  </div>`
const startBtn = document.createElement('div')
document.body.appendChild(hud)
void startBtn

// ---------------------------------------------------------------- 루프
const { state, spawns } = createSiege(20260725)
let acc = 0
let last = performance.now()

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

  // 카메라: LoL식 고정 부감 — 성주 남쪽 상공에서 내려다보며 추적
  const target = new THREE.Vector3(state.lord.pos.x, 0, state.lord.pos.z)
  camera.position.set(target.x, camDist * 0.95, target.z + camDist * 0.62)
  camera.lookAt(target.x, 0, target.z - 2)

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
  while (acc >= STEP_MS) {
    acc -= STEP_MS
    // 래치는 실제로 도는 스텝에서만 소비 — 0스텝 프레임에서 입력이 유실되지 않게
    const input: SiegeInput = {}
    if (spaceLatch) {
      input.startAssault = true
      spaceLatch = false
    }
    if (pendingMove) {
      input.moveTo = pendingMove
      pendingMove = undefined
    }
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
