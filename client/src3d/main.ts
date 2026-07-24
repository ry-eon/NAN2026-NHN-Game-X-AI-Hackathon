// 농성전 3D 렌더러 (M1 뼈대) — three.js.
// sim(siege/sim/world.ts)은 렌더링을 모른다. 여기는 상태를 그리고 입력을 모을 뿐.

import * as THREE from 'three'
import {
  ENEMY_KINDS,
  WALL_HP,
  createSiege,
  stepSiege,
  TICKS_PER_SECOND,
} from '../../siege/sim/world'
import type { SiegeInput } from '../../siege/sim/world'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { buildAsh, buildCastle, buildEnvironment, loadSky } from './environment'

const STEP_MS = 1000 / TICKS_PER_SECOND

// ---------------------------------------------------------------- 씬
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.12
document.getElementById('game')!.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.fog = new THREE.Fog(0x0a0c16, 50, 140) // 밤안개 — 시야 끝이 어둠에 잠긴다

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200)

loadSky(scene, renderer)
const hemi = new THREE.HemisphereLight(0x55608a, 0x20222c, 1.1)
scene.add(hemi)
// 달빛 — 차갑고 낮은 키 라이트 (동쪽에서 길게 드리우는 그림자)
const sun = new THREE.DirectionalLight(0x9fb0dd, 2.6)
sun.position.set(34, 22, -16)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.left = -50
sun.shadow.camera.right = 50
sun.shadow.camera.top = 50
sun.shadow.camera.bottom = -50
scene.add(sun)

// 성채·배경 (M2a-1: 절차 생성 비주얼)
const decor = buildCastle(scene)
buildEnvironment(scene)
const ash = buildAsh(scene)

// ---------------------------------------------------------------- 포스트프로세싱
const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
const ssao = new SSAOPass(scene, camera, window.innerWidth, window.innerHeight)
ssao.kernelRadius = 0.7
ssao.minDistance = 0.002
ssao.maxDistance = 0.09
composer.addPass(ssao)
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.55, // strength — 횃불·달만 은은히
  0.6,
  0.82, // threshold
)
composer.addPass(bloom)
// 비네트 (다크소울식 화면 가장자리 침잠)
const vignette = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, strength: { value: 0.42 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float strength; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float d = distance(vUv, vec2(0.5));
      c.rgb *= smoothstep(0.95, 0.42, d * (1.0 + strength));
      gl_FragColor = c;
    }`,
})
composer.addPass(vignette)
composer.addPass(new OutputPass())

// 성주 (임시 — M2a-2에서 캐릭터 퀄리티 확정 후 교체)
function makeLord(): THREE.Group {
  const g = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.34, 0.85, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0x3a5a80, roughness: 0.6, metalness: 0.25 }),
  )
  body.position.y = 0.95
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xd8b090, roughness: 0.7 }),
  )
  head.position.y = 1.75
  const crown = new THREE.Mesh(
    new THREE.TorusGeometry(0.2, 0.05, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0xd4a838, roughness: 0.35, metalness: 0.8 }),
  )
  crown.rotation.x = Math.PI / 2
  crown.position.y = 1.95
  const cape = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 1.05, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x6a1e1e, roughness: 0.85 }),
  )
  cape.position.set(0, 0.95, -0.32)
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
let camDist = 17
window.addEventListener('contextmenu', (e) => e.preventDefault())
window.addEventListener('wheel', (e) => {
  camDist = Math.max(8, Math.min(34, camDist + e.deltaY * 0.02))
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
        new THREE.SphereGeometry(def.radius, 8, 7),
        enemyMats[e.kind] ?? enemyMats.grunt!,
      )
      mesh.scale.y = 1.25
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
  // 비스듬한 앵글(약 43°) — 성벽·인물·바위의 수직면이 화면에 실린다
  camera.position.set(target.x, camDist * 0.7, target.z + camDist * 0.74)
  camera.lookAt(target.x, 1.0, target.z - 1.5)

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
  // 장식 애니메이션 (연출 전용 — sim 무관)
  const t = now / 1000
  decor.torchLights.forEach((l, i) => {
    l.intensity = 12 + Math.sin(t * 9 + i * 1.7) * 2.5 + Math.sin(t * 23 + i) * 1.5
  })
  decor.flags.forEach((f, i) => {
    f.rotation.y = Math.sin(t * 2.2 + i) * 0.35
  })
  // 재 입자: 느리게 흩날린다
  const ap = ash.geometry.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < ap.count; i++) {
    let y = ap.getY(i) - 0.006
    if (y < 0) y = 14
    ap.setY(i, y)
    ap.setX(i, ap.getX(i) + Math.sin(t * 0.5 + i) * 0.003)
  }
  ap.needsUpdate = true

  syncScene()
  composer.render()
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  composer.setSize(window.innerWidth, window.innerHeight)
})
