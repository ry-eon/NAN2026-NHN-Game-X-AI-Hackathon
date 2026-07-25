// 농성전 3D 렌더러 (M1 뼈대) — three.js.
// sim(siege/sim/world.ts)은 렌더링을 모른다. 여기는 상태를 그리고 입력을 모을 뿐.

import * as THREE from 'three'
import {
  ENEMY_KINDS,
  UNIT_KINDS,
  WALL_HP,
  createSiege,
  stepSiege,
  TICKS_PER_SECOND,
} from '../../siege/sim/world'
import type { FriendlyUnit, SiegeEvent, SiegeInput } from '../../siege/sim/world'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { buildAsh, buildCastle, buildEnvironment, loadSky } from './environment'
import { animateRig, makeBallista, makeCannon, makeFire, makeKnight } from './models'
import type { Rig } from './models'

const STEP_MS = 1000 / TICKS_PER_SECOND

// ---------------------------------------------------------------- 씬
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.3
document.getElementById('game')!.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.fog = new THREE.Fog(0x0c0e1a, 55, 170) // 밤안개 — 시야 끝이 어둠에 잠긴다

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200)

loadSky(scene, renderer)
const hemi = new THREE.HemisphereLight(0x5d6a98, 0x262832, 1.35)
scene.add(hemi)
// 달빛 — 차갑고 낮은 키 라이트 (동쪽에서 길게 드리우는 그림자)
const sun = new THREE.DirectionalLight(0xa8b8e4, 3.1)
sun.position.set(40, 34, -18)
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

// 화염 FX — 횃불·화톳불 광원 위치에 부착
const fires = decor.torchLights.map((l) => {
  const f = makeFire(l.position.y > 3 ? 0.7 : 1.4)
  f.group.position.copy(l.position).add(new THREE.Vector3(-0.25, -0.85, 0))
  scene.add(f.group)
  return f
})

// 달빛 광선 (가짜 볼류메트릭) — 어둠을 가르는 빛줄기
for (let i = 0; i < 3; i++) {
  const shaft = new THREE.Mesh(
    new THREE.PlaneGeometry(7 + i * 3, 46),
    new THREE.MeshBasicMaterial({
      color: 0x5a6a9a,
      transparent: true,
      opacity: 0.05,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  )
  shaft.position.set(8 + i * 11, 18, -6 + i * 7)
  shaft.rotation.set(0.28, 0.5, 0.62)
  scene.add(shaft)
}

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

// 성주 — 절차 조형 풀아머 기사 (금장, 검증 슬라이스 v2)
const lordRig = makeKnight(0x4a1414, true)
const lordMesh = lordRig.root
scene.add(lordMesh)

// 괴수 메시 풀
const enemyMeshes = new Map<number, THREE.Mesh>()
const enemyMats: Record<string, THREE.MeshStandardMaterial> = {
  grunt: new THREE.MeshStandardMaterial({ color: 0x9a4444 }),
  runner: new THREE.MeshStandardMaterial({ color: 0xc07c3e }),
  tank: new THREE.MeshStandardMaterial({ color: 0x6a4a9a }),
}

// 아군 유닛 비주얼 풀 — 병종별 절차 모델. 그룹→유닛 id 역참조는 피킹에 사용
interface UnitVisual {
  group: THREE.Group
  rig?: Rig
  kind: string
}
const unitVisuals = new Map<number, UnitVisual>()
const groupToUnitId = new Map<string, number>()

function ensureUnitVisual(u: FriendlyUnit): UnitVisual {
  let v = unitVisuals.get(u.id)
  if (v) return v
  if (u.kind === 'soldier') {
    const rig = makeKnight(0x28303e)
    rig.root.scale.setScalar(0.88)
    v = { group: rig.root, rig, kind: u.kind }
  } else if (u.kind === 'hero') {
    const rig = makeKnight(0x14355c, true)
    rig.root.scale.setScalar(1.04)
    v = { group: rig.root, rig, kind: u.kind }
  } else if (u.kind === 'cannon') {
    v = { group: makeCannon(), kind: u.kind }
  } else {
    v = { group: makeBallista(), kind: u.kind }
  }
  unitVisuals.set(u.id, v)
  groupToUnitId.set(v.group.uuid, u.id)
  scene.add(v.group)
  return v
}

// 선택 링 풀
const selectionRings: THREE.Mesh[] = []
const ringMat = new THREE.MeshBasicMaterial({
  color: 0x53d6a2,
  transparent: true,
  opacity: 0.85,
  side: THREE.DoubleSide,
  depthWrite: false,
})
function getSelectionRing(i: number): THREE.Mesh {
  while (selectionRings.length <= i) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 28), ringMat)
    ring.rotation.x = -Math.PI / 2
    ring.visible = false
    scene.add(ring)
    selectionRings.push(ring)
  }
  return selectionRings[i]!
}

// ---------------------------------------------------------------- 입력 (LoL식)
let spaceLatch = false
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') spaceLatch = true
})

// 고정 부감 카메라: 남쪽에서 북쪽을 내려다봄 (서=성벽=왼쪽, 동=적=오른쪽). 휠 줌만.
let camDist = 26
window.addEventListener('contextmenu', (e) => e.preventDefault())
window.addEventListener('wheel', (e) => {
  camDist = Math.max(9, Math.min(42, camDist + e.deltaY * 0.02))
})

// 피킹 공통: 화면 좌표 → 월드 지점 (구조물 상면 우선, 없으면 지면)
const raycaster = new THREE.Raycaster()
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
function pickPoint(clientX: number, clientY: number): { x: number; z: number; h: number } | null {
  const ndc = new THREE.Vector2(
    (clientX / window.innerWidth) * 2 - 1,
    -(clientY / window.innerHeight) * 2 + 1,
  )
  raycaster.setFromCamera(ndc, camera)
  // 구조물 상면(법선이 위) 클릭 → 성벽 보도·계단 위 좌표 사용
  const structHits = raycaster.intersectObjects(decor.occluders, false)
  const topHit = structHits.find((h) => h.face && h.face.normal.y > 0.55)
  if (topHit) return { x: topHit.point.x, z: topHit.point.z, h: topHit.point.y }
  const hit = new THREE.Vector3()
  if (raycaster.ray.intersectPlane(groundPlane, hit)) return { x: hit.x, z: hit.z, h: 0 }
  return null
}

// ---- 스타크래프트식 부대 선택 (좌클릭 드래그) + 명령 (우클릭)
let pendingMove: { x: number; z: number; h?: number } | undefined
let pendingUnitMove: { ids: number[]; to: { x: number; z: number; h?: number } } | undefined
const selected = new Set<number>()

const dragBox = document.createElement('div')
dragBox.style.cssText =
  'position:fixed;border:1px solid #53d6a2;background:#53d6a222;pointer-events:none;display:none;z-index:5'
document.body.appendChild(dragBox)
let dragStart: { x: number; y: number } | null = null

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button === 0) {
    dragStart = { x: e.clientX, y: e.clientY }
    return
  }
  if (e.button !== 2) return
  // 우클릭: 선택 부대가 있으면 부대 명령, 없으면 성주 이동
  const p = pickPoint(e.clientX, e.clientY)
  if (!p) return
  if (selected.size > 0) {
    pendingUnitMove = { ids: [...selected], to: p }
    showMoveMarker(p.x, p.z, p.h, 0x53d6a2)
  } else {
    pendingMove = p
    showMoveMarker(p.x, p.z, p.h)
  }
})

window.addEventListener('pointermove', (e) => {
  if (!dragStart) return
  const x0 = Math.min(dragStart.x, e.clientX)
  const y0 = Math.min(dragStart.y, e.clientY)
  dragBox.style.display = 'block'
  dragBox.style.left = `${x0}px`
  dragBox.style.top = `${y0}px`
  dragBox.style.width = `${Math.abs(e.clientX - dragStart.x)}px`
  dragBox.style.height = `${Math.abs(e.clientY - dragStart.y)}px`
})

window.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || !dragStart) return
  dragBox.style.display = 'none'
  const start = dragStart
  dragStart = null
  if (!e.shiftKey) selected.clear()
  const dragDist = Math.hypot(e.clientX - start.x, e.clientY - start.y)
  if (dragDist < 6) {
    // 단일 클릭 픽킹 — 유닛 모델 직접 레이캐스트
    const ndc = new THREE.Vector2(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1,
    )
    raycaster.setFromCamera(ndc, camera)
    const groups = [...unitVisuals.values()].map((v) => v.group)
    const hits = raycaster.intersectObjects(groups, true)
    if (hits.length > 0) {
      let obj: THREE.Object3D | null = hits[0]!.object
      while (obj && !groupToUnitId.has(obj.uuid)) obj = obj.parent
      if (obj) selected.add(groupToUnitId.get(obj.uuid)!)
    }
    return
  }
  // 박스 선택 — 유닛 위치를 화면에 투영
  const x0 = Math.min(start.x, e.clientX)
  const x1 = Math.max(start.x, e.clientX)
  const y0 = Math.min(start.y, e.clientY)
  const y1 = Math.max(start.y, e.clientY)
  for (const u of state.units) {
    const p = new THREE.Vector3(u.pos.x, u.h + 1, u.pos.z).project(camera)
    const sx = ((p.x + 1) / 2) * window.innerWidth
    const sy = ((1 - p.y) / 2) * window.innerHeight
    if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1 && p.z < 1) selected.add(u.id)
  }
})

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') selected.clear()
})

// 이동 마커 (LoL식 클릭 링) — 성주 초록, 부대 명령 청록
function showMoveMarker(x: number, z: number, y = 0.05, color = 0x62c462): void {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.4, 0.6, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
  )
  ring.rotation.x = -Math.PI / 2
  ring.position.set(x, y + 0.05, z)
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
  <div id="army" style="position:absolute;top:78px;left:16px;font-size:12px;color:#9fc4a8"></div>
  <div style="position:absolute;bottom:14px;left:16px;font-size:12px;color:#a0a0b8">
    좌클릭 드래그: 부대 선택 · 우클릭: 이동 명령(선택 없으면 성주) · ESC: 선택 해제 · 휠: 줌 · <b>Space</b>: 침공 개시
  </div>`
const startBtn = document.createElement('div')
document.body.appendChild(hud)
void startBtn

// ---------------------------------------------------------------- 루프
const { state, spawns } = createSiege(20260725)
let acc = 0
let last = performance.now()

// ---------------------------------------------------------------- 전투 FX (연출 전용 — 피해는 sim에서 이미 확정)
interface Projectile {
  mesh: THREE.Object3D
  from: THREE.Vector3
  to: THREE.Vector3
  t0: number
  dur: number
  arc: number
  explode: boolean
}
const projectiles: Projectile[] = []
const flashes: { mesh: THREE.Sprite; t0: number; dur: number; grow: number }[] = []
const dying: { obj: THREE.Object3D; t0: number; dur: number }[] = []

const flashTex = ((): THREE.CanvasTexture => {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const ctx = c.getContext('2d')!
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.35, 'rgba(255,190,90,0.9)')
  grad.addColorStop(1, 'rgba(255,120,30,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
})()

function spawnFlash(pos: THREE.Vector3, scale: number, color = 0xffffff, dur = 280): void {
  const mat = new THREE.SpriteMaterial({
    map: flashTex,
    color,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const s = new THREE.Sprite(mat)
  s.position.copy(pos)
  s.scale.setScalar(scale * 0.4)
  scene.add(s)
  flashes.push({ mesh: s, t0: performance.now(), dur, grow: scale })
}

const arrowGeo = new THREE.BoxGeometry(0.03, 0.03, 0.55)
const boltGeo = new THREE.BoxGeometry(0.07, 0.07, 0.95)
const ballGeo = new THREE.SphereGeometry(0.16, 10, 8)
const projMat = new THREE.MeshBasicMaterial({ color: 0xd8d2c0 })
const ballMat = new THREE.MeshBasicMaterial({ color: 0x2a2a30 })

/** 발사 연출 — 병종별 궤적. 피해는 sim이 이미 적용했으므로 여긴 그림뿐 */
function spawnProjectile(kind: string, from: THREE.Vector3, to: THREE.Vector3): void {
  const spec =
    kind === 'cannon'
      ? { geo: ballGeo, mat: ballMat, dur: 480, arc: 4.2, explode: true }
      : kind === 'ballista'
        ? { geo: boltGeo, mat: projMat, dur: 170, arc: 0.3, explode: false }
        : { geo: arrowGeo, mat: projMat, dur: 260, arc: 1.6, explode: false }
  const mesh = new THREE.Mesh(spec.geo, spec.mat)
  mesh.position.copy(from)
  scene.add(mesh)
  projectiles.push({ mesh, from, to, t0: performance.now(), dur: spec.dur, arc: spec.arc, explode: spec.explode })
}

/** 병종별 총구 높이 (모델 형상 기준) */
const MUZZLE_H: Record<string, number> = { soldier: 1.35, hero: 1.4, cannon: 0.9, ballista: 0.8 }

function handleEvents(events: SiegeEvent[]): void {
  for (const ev of events) {
    if (ev.type === 'unitFired') {
      const from = new THREE.Vector3(ev.from.x, ev.from.h + (MUZZLE_H[ev.unitKind] ?? 1), ev.from.z)
      spawnProjectile(ev.unitKind, from, new THREE.Vector3(ev.to.x, 0.7, ev.to.z))
    } else if (ev.type === 'enemyDied') {
      const mesh = enemyMeshes.get(ev.id)
      if (mesh) {
        enemyMeshes.delete(ev.id)
        dying.push({ obj: mesh, t0: performance.now(), dur: 380 })
      }
      spawnFlash(new THREE.Vector3(ev.pos.x, 0.8, ev.pos.z), 1.6, 0xff6a4a, 300)
    } else if (ev.type === 'unitDied') {
      const v = unitVisuals.get(ev.id)
      if (v) {
        unitVisuals.delete(ev.id)
        groupToUnitId.delete(v.group.uuid)
        dying.push({ obj: v.group, t0: performance.now(), dur: 600 })
      }
      selected.delete(ev.id)
      spawnFlash(new THREE.Vector3(ev.pos.x, 1.0, ev.pos.z), 1.8, 0xff3a3a, 400)
    } else if (ev.type === 'meleeHit') {
      const u = state.units.find((x) => x.id === ev.unitId)
      if (u) spawnFlash(new THREE.Vector3(u.pos.x, u.h + 1.1, u.pos.z), 0.9, 0xff5a5a, 200)
    } else if (ev.type === 'wallHit') {
      const e = state.enemies.find((x) => x.id === ev.id)
      if (e) spawnFlash(new THREE.Vector3(e.pos.x - 0.6, 1.4, e.pos.z), 1.1, 0xffb060, 220)
    }
  }
}

/** FX 갱신 — 매 프레임 */
function updateFx(now: number): void {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i]!
    const t = (now - p.t0) / p.dur
    if (t >= 1) {
      scene.remove(p.mesh)
      if (p.explode) spawnFlash(p.to.clone(), 3.2, 0xffc070, 380)
      projectiles.splice(i, 1)
      continue
    }
    const pos = p.from.clone().lerp(p.to, t)
    pos.y += Math.sin(Math.PI * t) * p.arc
    // 진행 방향으로 정렬
    const ahead = p.from
      .clone()
      .lerp(p.to, Math.min(1, t + 0.05))
    ahead.y += Math.sin(Math.PI * Math.min(1, t + 0.05)) * p.arc
    p.mesh.position.copy(pos)
    p.mesh.lookAt(ahead)
  }
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i]!
    const t = (now - f.t0) / f.dur
    if (t >= 1) {
      scene.remove(f.mesh)
      flashes.splice(i, 1)
      continue
    }
    f.mesh.scale.setScalar(f.grow * (0.4 + t * 0.9))
    ;(f.mesh.material as THREE.SpriteMaterial).opacity = 1 - t
  }
  for (let i = dying.length - 1; i >= 0; i--) {
    const d = dying[i]!
    const t = (now - d.t0) / d.dur
    if (t >= 1) {
      scene.remove(d.obj)
      dying.splice(i, 1)
      continue
    }
    d.obj.rotation.x = -t * 1.2 // 쓰러짐
    d.obj.position.y -= 0.01
    d.obj.scale.setScalar(Math.max(0.01, 1 - t * 0.5))
  }
}

const occlusionRay = new THREE.Raycaster()

/** 카메라와 성주 사이를 가리는 구조물을 반투명 처리 (RTS 관례) */
function fadeOccluders(): void {
  const lordPos = new THREE.Vector3(state.lord.pos.x, 1.2, state.lord.pos.z)
  const dir = lordPos.clone().sub(camera.position)
  const dist = dir.length()
  occlusionRay.set(camera.position, dir.normalize())
  occlusionRay.far = dist - 0.5
  // 엄격 판정: 실제로 시선을 막는 것만 페이드. 성주가 성벽 위면 페이드 안 함
  // (벽 옆에 붙었을 때 훤히 뚫려 보이는 문제 방지)
  const lordElevated = state.lord.h > 1
  const hits = lordElevated
    ? new Set<THREE.Object3D>()
    : new Set<THREE.Object3D>(
        occlusionRay.intersectObjects(decor.occluders, false).map((h) => h.object),
      )
  for (const mesh of decor.occluders) {
    const mat = (mesh as THREE.Mesh).material as THREE.MeshStandardMaterial
    const targetOpacity = hits.has(mesh) ? 0.18 : 1
    if (mat.opacity !== targetOpacity) {
      mat.transparent = true
      mat.opacity += (targetOpacity - mat.opacity) * 0.25
      if (Math.abs(mat.opacity - targetOpacity) < 0.02) {
        mat.opacity = targetOpacity
        if (targetOpacity === 1) mat.transparent = false
      }
    }
  }
}

let renderAlpha = 1

function syncScene(): void {
  fadeOccluders()
  const lx = THREE.MathUtils.lerp(prevLord.x, state.lord.pos.x, renderAlpha)
  const lz = THREE.MathUtils.lerp(prevLord.z, state.lord.pos.z, renderAlpha)
  const ly = THREE.MathUtils.lerp(prevLordH, state.lord.h, renderAlpha)
  lordMesh.position.set(lx, ly, lz)
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
    const prev = prevEnemies.get(e.id)
    const ex = prev ? THREE.MathUtils.lerp(prev.x, e.pos.x, renderAlpha) : e.pos.x
    const ez = prev ? THREE.MathUtils.lerp(prev.z, e.pos.z, renderAlpha) : e.pos.z
    mesh.position.set(ex, def.radius * 1.2 + bob, ez)
  }
  for (const [id, mesh] of enemyMeshes) {
    if (!state.enemies.some((e) => e.id === id)) {
      scene.remove(mesh)
      enemyMeshes.delete(id)
    }
  }

  // 아군 유닛 — 위치·방향·선택 링
  let ringIdx = 0
  for (const u of state.units) {
    const v = ensureUnitVisual(u)
    const prev = prevUnits.get(u.id)
    const ux = prev ? THREE.MathUtils.lerp(prev.x, u.pos.x, renderAlpha) : u.pos.x
    const uz = prev ? THREE.MathUtils.lerp(prev.z, u.pos.z, renderAlpha) : u.pos.z
    const uy = prev ? THREE.MathUtils.lerp(prev.h, u.h, renderAlpha) : u.h
    v.group.position.set(ux, uy, uz)
    v.group.rotation.y = u.facing
    if (selected.has(u.id)) {
      const ring = getSelectionRing(ringIdx++)
      ring.visible = true
      const r = UNIT_KINDS[u.kind]!.radius
      ring.scale.setScalar(0.8 + r)
      ring.position.set(ux, uy + 0.06, uz)
    }
  }
  for (let i = ringIdx; i < selectionRings.length; i++) selectionRings[i]!.visible = false

  // 카메라: LoL식 고정 부감 — 성주 남쪽 상공에서 내려다보며 추적
  const target = new THREE.Vector3(lx, ly, lz)
  // 비스듬한 앵글(약 43°) — 성벽·인물·바위의 수직면이 화면에 실린다
  camera.position.set(target.x, target.y + camDist * 0.82, target.z + camDist * 0.68)
  camera.lookAt(target.x, target.y + 1.0, target.z - 1.5)

  // HUD
  document.getElementById('wall')!.textContent = `${state.wallHp}/${WALL_HP}`
  ;(document.getElementById('wallbar') as HTMLDivElement).style.width =
    `${(state.wallHp / WALL_HP) * 100}%`
  const counts = new Map<string, number>()
  for (const u of state.units) counts.set(u.kind, (counts.get(u.kind) ?? 0) + 1)
  document.getElementById('army')!.textContent =
    `병력 ${state.units.length} (${[...counts].map(([k, n]) => `${UNIT_KINDS[k]!.name} ${n}`).join(' · ')})` +
    (selected.size > 0 ? ` — 선택 ${selected.size}` : '')
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

// 렌더 보간용 이전 틱 위치 (30Hz 시뮬 ↔ 60fps+ 렌더의 버벅임 제거)
const prevLord = new THREE.Vector3()
let prevLordH = 0
const prevEnemies = new Map<number, { x: number; z: number }>()
const prevUnits = new Map<number, { x: number; z: number; h: number }>()

function snapshotPrev(): void {
  prevLordH = state.lord.h
  prevLord.set(state.lord.pos.x, 0, state.lord.pos.z)
  prevEnemies.clear()
  for (const e of state.enemies) prevEnemies.set(e.id, { x: e.pos.x, z: e.pos.z })
  prevUnits.clear()
  for (const u of state.units) prevUnits.set(u.id, { x: u.pos.x, z: u.pos.z, h: u.h })
}

function frame(now: number): void {
  acc = Math.min(acc + (now - last), STEP_MS * 6)
  last = now
  const frameEvents: SiegeEvent[] = []
  while (acc >= STEP_MS) {
    snapshotPrev()
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
    if (pendingUnitMove) {
      input.unitMove = pendingUnitMove
      pendingUnitMove = undefined
    }
    stepSiege(state, spawns, input)
    frameEvents.push(...state.events)
  }
  handleEvents(frameEvents)
  updateFx(now)
  // 장식 애니메이션 (연출 전용 — sim 무관)
  const t = now / 1000
  animateRig(lordRig, t, state.lord.target !== null)
  for (const u of state.units) {
    const v = unitVisuals.get(u.id)
    if (v?.rig) animateRig(v.rig, t + u.id * 0.7, u.path.length > 0)
  }
  for (const f of fires) f.update(t)
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

  renderAlpha = Math.min(1, acc / STEP_MS)
  syncScene()
  composer.render()
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

// 자동 검증 훅 — headless 스크린샷 테스트가 sim을 빨리감기(결정론이라 안전).
// FX 이벤트는 버리고 상태만 전진한다. 게임 플레이 입력 경로와 무관.
;(window as unknown as Record<string, unknown>).__siege = {
  state,
  fastForward: (n: number, input: SiegeInput = {}): void => {
    stepSiege(state, spawns, input)
    for (let i = 1; i < n; i++) stepSiege(state, spawns, {})
    snapshotPrev()
  },
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  composer.setSize(window.innerWidth, window.innerHeight)
})
