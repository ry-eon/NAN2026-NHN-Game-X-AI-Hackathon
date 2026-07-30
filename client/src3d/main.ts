// 농성전 3D 렌더러 (M1 뼈대) — three.js.
// sim(siege/sim/world.ts)은 렌더링을 모른다. 여기는 상태를 그리고 입력을 모을 뿐.

import * as THREE from 'three'
import {
  ENEMY_KINDS,
  HERO_SKILL,
  UNIT_KINDS,
  WALL_HP,
  createSiege,
  stepSiege,
  TICKS_PER_SECOND,
} from '../../siege/sim/world'
import type { FriendlyUnit, SiegeEvent, SiegeInput } from '../../siege/sim/world'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { buildAsh, buildCastle, buildEnvironment, loadSky } from './environment'
import { animateMonster, animateRig, makeBallista, makeCannon, makeFire, makeKnight, makeMonster } from './models'
import type { MonsterRig, Rig } from './models'

const STEP_MS = 1000 / TICKS_PER_SECOND

// ---------------------------------------------------------------- 씬
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance', // 듀얼 GPU 노트북에서 외장 GPU 선택
  stencil: false,
})
renderer.setSize(window.innerWidth, window.innerHeight)
// 동적 해상도: iGPU(UHD 630)는 fill-rate 한계라 화면이 크면 어떤 최적화로도 60이 안 나온다.
// fps를 보고 내부 렌더 스케일을 0.7~1.5 사이에서 자동 조절 (RTS라 약간 소프트해도 무방)
const RES_MAX = Math.min(window.devicePixelRatio, 1.5)
const RES_MIN = 0.7
let resScale = RES_MAX
renderer.setPixelRatio(resScale)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.15
document.getElementById('game')!.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.fog = new THREE.Fog(0xc9d4e2, 75, 235) // 낮 대기 원근 — 지평선이 뿌옇게 잠긴다

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 240)

loadSky(scene, renderer)
const hemi = new THREE.HemisphereLight(0xa8c0e0, 0x6b6f62, 1.15)
scene.add(hemi)
// 오전 햇살 — 따뜻한 키 라이트 (동쪽에서 길게 드리우는 그림자)
const sun = new THREE.DirectionalLight(0xfff0d2, 2.7)
sun.position.set(40, 34, -18)
sun.castShadow = true
sun.shadow.mapSize.set(1536, 1536)
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


// ---------------------------------------------------------------- 포스트프로세싱
const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
// SSAO는 제거 (2026-07-27): 씬 전체 재렌더 + 풀해상도 커널 = 최대 프레임 비용.
// 낮 씬은 태양 그림자·헤미 지면색이 음영을 충분히 만든다 — 조작감이 우선.
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.35, // strength — 낮: 태양·화염 FX만 은은히
  0.6,
  0.9, // threshold
)
composer.addPass(bloom)
// 비네트 (다크소울식 화면 가장자리 침잠)
const vignette = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, strength: { value: 0.3 } },
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
lordMesh.add(makeNameplate('성주', '#ff9a7a').translateY(2.5))
scene.add(lordMesh)

// 괴수 비주얼 풀 — 절차 괴수 리그 (models.makeMonster)
interface EnemyVisual {
  group: THREE.Group
  rig: MonsterRig
}
const enemyVisuals = new Map<number, EnemyVisual>()
const enemyGroupToId = new Map<string, number>()
const enemyAttackT = new Map<number, number>() // meleeHit/wallHit 시각 — 내리찍기 스윙 재생용
const enemyFacing = new Map<number, number>() // 접전 중 바라볼 방향 (기본은 서쪽 -x)
const ENEMY_FACE_WEST = -Math.PI / 2

// 아군 유닛 비주얼 풀 — 병종별 절차 모델. 그룹→유닛 id 역참조는 피킹에 사용
interface UnitVisual {
  group: THREE.Group
  rig?: Rig
  kind: string
}
const unitVisuals = new Map<number, UnitVisual>()
const groupToUnitId = new Map<string, number>()

/** 머리 위 이름표 — 영웅·성주 식별 (사용자 피드백: 캐릭터 구분이 안 됨) */
function makeNameplate(text: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = 192
  c.height = 64
  const ctx = c.getContext('2d')!
  ctx.font = 'bold 40px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = '#000'
  ctx.shadowBlur = 8
  ctx.fillStyle = color
  ctx.fillText(text, 96, 34)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
  )
  s.scale.set(1.7, 0.57, 1)
  s.renderOrder = 10
  return s
}

/** 공성 병기 옆 조작 병사 (사용자 피드백: 병기는 병사가 조작하는 형태) —
 *  병기 그룹의 자식이라 함께 이동·회전, 이동 시 미는 걸음 애니메이션 */
function attachCrew(weapon: THREE.Group, offsetX: number, offsetZ: number): Rig {
  const crew = makeKnight(0x28303e)
  crew.root.scale.setScalar(0.8)
  crew.root.position.set(offsetX, 0, offsetZ)
  weapon.add(crew.root)
  return crew
}

function ensureUnitVisual(u: FriendlyUnit): UnitVisual {
  let v = unitVisuals.get(u.id)
  if (v) return v
  if (u.kind === 'soldier') {
    // 궁수 — 활·화살통 실루엣, 녹갈색 천
    const rig = makeKnight(0x3a4a2e, false, true)
    rig.root.scale.setScalar(0.88)
    v = { group: rig.root, rig, kind: u.kind }
  } else if (u.kind === 'hero') {
    // 영웅 — 크게, 청색+금장, 이름표, 상시 금색 링
    const rig = makeKnight(0x1d4e8c, true)
    rig.root.scale.setScalar(1.15)
    rig.root.add(makeNameplate('영웅', '#ffd870').translateY(2.5))
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.74, 28),
      new THREE.MeshBasicMaterial({ color: 0xd8a832, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.05
    rig.root.add(ring)
    v = { group: rig.root, rig, kind: u.kind }
  } else if (u.kind === 'cannon') {
    const group = makeCannon()
    v = { group, rig: attachCrew(group, 0.55, -1.05), kind: u.kind }
  } else {
    const group = makeBallista()
    v = { group, rig: attachCrew(group, 0, -1.15), kind: u.kind }
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

// 영웅 스킬 조준 레티클 (원신식 — 반경이 그대로 보인다)
const aimReticle = new THREE.Group()
{
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(HERO_SKILL.radius - 0.18, HERO_SKILL.radius, 48),
    new THREE.MeshBasicMaterial({ color: 0xff7a3a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
  )
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(HERO_SKILL.radius, 48),
    new THREE.MeshBasicMaterial({ color: 0xff5a2a, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }),
  )
  ring.rotation.x = -Math.PI / 2
  disc.rotation.x = -Math.PI / 2
  disc.position.y = -0.01
  aimReticle.add(ring, disc)
  aimReticle.visible = false
  scene.add(aimReticle)
}
let aiming = false
let aimingHeroId: number | null = null // 수동 조준 중인 영웅
let skillAuto = true // 자동/수동 토글 (T)
let pendingHeroSkill: { x: number; z: number; heroId?: number } | undefined

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
let inspectedEnemy: number | null = null // 클릭 조사 대상 (상태창)
let lastClickUnit = -1 // 더블클릭 판정
let lastClickTime = 0

const dragBox = document.createElement('div')
dragBox.style.cssText =
  'position:fixed;border:1px solid #53d6a2;background:#53d6a222;pointer-events:none;display:none;z-index:5'
document.body.appendChild(dragBox)
let dragStart: { x: number; y: number } | null = null

renderer.domElement.addEventListener('pointerdown', (e) => {
  // 수동 조준 중: 좌클릭 = 시전, 우클릭 = 취소 (드래그 선택·이동 명령은 봉인)
  if (aiming) {
    if (e.button === 0) {
      const p = pickPoint(e.clientX, e.clientY)
      if (p) pendingHeroSkill = { x: p.x, z: p.z, heroId: aimingHeroId ?? undefined }
    }
    aiming = false
    aimingHeroId = null
    aimReticle.visible = false
    return
  }
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
  if (aiming) {
    const p = pickPoint(e.clientX, e.clientY)
    if (p) {
      aimReticle.position.set(p.x, p.h + 0.08, p.z)
      // 사거리 밖이면 흐리게 — 시전해도 sim이 무시한다는 시각 피드백
      const hero = state.units.find((u) => u.id === aimingHeroId)
      const inRange = hero && Math.hypot(p.x - hero.pos.x, p.z - hero.pos.z) <= HERO_SKILL.range
      for (const c of aimReticle.children)
        ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(inRange ? 0xff7a3a : 0x5a5a66)
    }
    return
  }
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
    // 단일 클릭 픽킹 — 아군 모델 우선, 없으면 괴수(조사용)
    inspectedEnemy = null
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
      if (obj) {
        const id = groupToUnitId.get(obj.uuid)!
        // 더블클릭 = 같은 병종 전체 선택 (스타크래프트 관례)
        const now = performance.now()
        if (id === lastClickUnit && now - lastClickTime < 350) {
          const kind = state.units.find((u) => u.id === id)?.kind
          for (const u of state.units) if (u.kind === kind) selected.add(u.id)
        } else {
          selected.add(id)
        }
        lastClickUnit = id
        lastClickTime = now
      }
      return
    }
    const enemyHits = raycaster.intersectObjects(
      [...enemyVisuals.values()].map((v) => v.group),
      true,
    )
    if (enemyHits.length > 0) {
      let obj: THREE.Object3D | null = enemyHits[0]!.object
      while (obj && !enemyGroupToId.has(obj.uuid)) obj = obj.parent
      if (obj) inspectedEnemy = enemyGroupToId.get(obj.uuid)!
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
  if (e.code === 'Escape') {
    selected.clear()
    inspectedEnemy = null
    aiming = false
    aimingHeroId = null
    aimReticle.visible = false
  }
})

// 컨트롤 그룹 (스타크래프트식): Ctrl+1~5 = 지정, 1~5 = 호출
const ctrlGroups = new Map<number, number[]>()
window.addEventListener('keydown', (e) => {
  const m = /^Digit([1-5])$/.exec(e.code)
  if (!m) return
  const slot = Number(m[1])
  if (e.ctrlKey) {
    ctrlGroups.set(slot, [...selected])
    e.preventDefault()
  } else {
    const ids = ctrlGroups.get(slot)
    if (!ids || ids.length === 0) return
    selected.clear()
    for (const id of ids) if (state.units.some((u) => u.id === id)) selected.add(id)
  }
})

/** 자동 조준: 사거리 내에서 "반경에 가장 많이 쓸려드는" 적 위치 (동률 시 앞선 스폰) */
function bestSkillTarget(hero: FriendlyUnit): { x: number; z: number } | null {
  let best: { x: number; z: number } | null = null
  let bestScore = 0
  for (const e of state.enemies) {
    if (Math.hypot(e.pos.x - hero.pos.x, e.pos.z - hero.pos.z) > HERO_SKILL.range) continue
    let n = 0
    for (const o of state.enemies)
      if (Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) <= HERO_SKILL.radius) n++
    if (n > bestScore) {
      bestScore = n
      best = { x: e.pos.x, z: e.pos.z }
    }
  }
  return best
}

/** 스킬 발동 (E 키·영웅 카드 버튼 공용) — 자동이면 즉시, 수동이면 조준 모드 진입 */
function triggerSkill(hero: FriendlyUnit): void {
  if (hero.skillCd > 0) return
  if (skillAuto) {
    const t = bestSkillTarget(hero)
    if (t) pendingHeroSkill = { ...t, heroId: hero.id }
  } else if (!aiming) {
    aiming = true
    aimingHeroId = hero.id
    aimReticle.position.set(hero.pos.x, hero.h + 0.08, hero.pos.z)
    aimReticle.visible = true
  }
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyT') skillAuto = !skillAuto
  if (e.code !== 'KeyE') return
  // 선택 중인 영웅 우선, 없으면 첫 영웅
  const heroes = state.units.filter((u) => u.kind === 'hero')
  const hero = heroes.find((h) => selected.has(h.id)) ?? heroes[0]
  if (hero) triggerSkill(hero)
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
  <div id="fps" style="position:absolute;top:14px;right:16px;font-size:12px;color:#88a088"></div>
  <div id="deck" style="position:absolute;bottom:40px;left:50%;transform:translateX(-50%);
       display:flex;gap:10px;align-items:flex-end">
    <div id="herobar" style="display:flex;gap:8px;align-items:flex-end"></div>
    <div id="selpanel" style="pointer-events:auto;display:none;background:#000d;border:1px solid #345;
         border-radius:6px;padding:8px 10px;max-width:340px">
      <div id="selcount" style="font-size:11px;color:#9fc4a8;margin-bottom:5px"></div>
      <div id="selgrid" style="display:flex;flex-wrap:wrap;gap:4px"></div>
    </div>
  </div>
  <div id="panel" style="position:absolute;bottom:14px;right:16px;width:215px;background:#000b;
       border:1px solid #333;border-radius:4px;padding:10px 12px;font-size:12px;display:none">
    <div id="p-name" style="font-size:14px;font-weight:bold;margin-bottom:5px"></div>
    <div id="p-hptext"></div>
    <div style="width:100%;height:8px;background:#0008;margin:3px 0 7px">
      <div id="p-hpbar" style="height:100%;background:#62c462"></div>
    </div>
    <div id="p-stats" style="color:#b8b8c8;line-height:1.6"></div>
  </div>
  <div style="position:absolute;bottom:14px;left:16px;font-size:12px;color:#a0a0b8">
    드래그: 선택 · 더블클릭: 같은 병종 · <b>Ctrl+1~5</b>: 부대 지정 / <b>1~5</b>: 호출 · 우클릭: 이동(무선택 시 성주) · <b>E</b>: 스킬 · <b>T</b>: 조준 전환 · ESC: 해제 · <b>Space</b>: 침공
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
const shockwaves: { mesh: THREE.Mesh; t0: number; dur: number; maxR: number }[] = []
const fireCols: { fx: ReturnType<typeof makeFire>; t0: number; dur: number }[] = []
const tempLights: { light: THREE.PointLight; t0: number; dur: number; peak: number }[] = []

/** 순간 광원 (폭발·스킬) — dur 동안 감쇠 후 제거 */
function spawnLight(pos: THREE.Vector3, color: number, peak: number, dur: number): void {
  const light = new THREE.PointLight(color, peak, 22, 1.8)
  light.position.copy(pos)
  scene.add(light)
  tempLights.push({ light, t0: performance.now(), dur, peak })
}

/** 스킬 착탄 충격파 — 바닥을 훑는 확장 링 */
function spawnShockwave(x: number, z: number, maxR: number): void {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(0.8, 1.0, 40),
    new THREE.MeshBasicMaterial({
      color: 0xffa050,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(x, 0.1, z)
  scene.add(mesh)
  shockwaves.push({ mesh, t0: performance.now(), dur: 550, maxR })
}

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

const arrowGeo = new THREE.BoxGeometry(0.06, 0.06, 0.75)
const boltGeo = new THREE.BoxGeometry(0.1, 0.1, 1.15)
const ballGeo = new THREE.SphereGeometry(0.2, 10, 8)
const projMat = new THREE.MeshBasicMaterial({ color: 0xfff2c8 })
const ballMat = new THREE.MeshBasicMaterial({ color: 0x1a1a20 })

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
      // 발사 섬광 — 어디서 쏘는지 읽히게 (대포는 크게)
      spawnFlash(from.clone(), ev.unitKind === 'cannon' ? 2.4 : 0.8, 0xffdf9a, 200)
      if (ev.unitKind === 'cannon') spawnLight(from.clone(), 0xffb060, 40, 300)
    } else if (ev.type === 'enemyDied') {
      const v = enemyVisuals.get(ev.id)
      if (v) {
        enemyVisuals.delete(ev.id)
        enemyGroupToId.delete(v.group.uuid)
        enemyAttackT.delete(ev.id)
        enemyFacing.delete(ev.id)
        dying.push({ obj: v.group, t0: performance.now(), dur: 380 })
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
    } else if (ev.type === 'heroSkillCast') {
      spawnFlash(new THREE.Vector3(ev.x, 1.6, ev.z), 8, 0xffa040, 650)
      spawnFlash(new THREE.Vector3(ev.x, 3.6, ev.z), 4.5, 0xfff0c0, 450)
      spawnShockwave(ev.x, ev.z, HERO_SKILL.radius + 1.2)
      spawnLight(new THREE.Vector3(ev.x, 2.5, ev.z), 0xff8030, 90, 700)
      // 화염 기둥 — 1.2초간 타오른다
      const fx = makeFire(2.6)
      fx.group.position.set(ev.x, 0.1, ev.z)
      scene.add(fx.group)
      fireCols.push({ fx, t0: performance.now(), dur: 1200 })
    } else if (ev.type === 'meleeHit') {
      enemyAttackT.set(ev.enemyId, performance.now())
      const u = state.units.find((x) => x.id === ev.unitId)
      const e = state.enemies.find((x) => x.id === ev.enemyId)
      if (u) {
        spawnFlash(new THREE.Vector3(u.pos.x, u.h + 1.1, u.pos.z), 0.9, 0xff5a5a, 200)
        // 접전 대상을 바라보게 — sim에 방향 개념이 없으므로 연출 전용
        if (e) enemyFacing.set(ev.enemyId, Math.atan2(u.pos.x - e.pos.x, u.pos.z - e.pos.z))
      }
    } else if (ev.type === 'wallHit') {
      enemyAttackT.set(ev.id, performance.now())
      enemyFacing.set(ev.id, ENEMY_FACE_WEST)
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
    if (t >= 0.95 && !p.explode && p.mesh.visible) {
      // 착탄 순간 소형 임팩트 — 명중이 읽히게
      spawnFlash(p.to.clone(), 0.6, 0xffcaa0, 150)
      p.mesh.visible = false
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
  for (let i = fireCols.length - 1; i >= 0; i--) {
    const f = fireCols[i]!
    const t = (now - f.t0) / f.dur
    if (t >= 1) {
      scene.remove(f.fx.group)
      fireCols.splice(i, 1)
      continue
    }
    f.fx.update(now / 1000)
    f.fx.group.scale.setScalar(t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1) // 말미에 잦아든다
  }
  for (let i = tempLights.length - 1; i >= 0; i--) {
    const l = tempLights[i]!
    const t = (now - l.t0) / l.dur
    if (t >= 1) {
      scene.remove(l.light)
      tempLights.splice(i, 1)
      continue
    }
    l.light.intensity = l.peak * (1 - t) * (1 - t)
  }
  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const w = shockwaves[i]!
    const t = (now - w.t0) / w.dur
    if (t >= 1) {
      scene.remove(w.mesh)
      shockwaves.splice(i, 1)
      continue
    }
    w.mesh.scale.setScalar(0.8 + t * w.maxR)
    ;(w.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - t)
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

/** 카메라와 성주 사이를 가리는 구조물을 반투명 처리 (RTS 관례).
 *  고폴리 벽 레이캐스트는 비싸므로 updateRay 프레임에만 — 페이드 자체는 매 프레임 */
let occluderHits = new Set<THREE.Object3D>()
function fadeOccluders(updateRay: boolean): void {
  if (updateRay) {
    // 엄격 판정: 실제로 시선을 막는 것만 페이드. 성주가 성벽 위면 페이드 안 함
    // (벽 옆에 붙었을 때 훤히 뚫려 보이는 문제 방지)
    if (state.lord.h > 1) {
      occluderHits = new Set()
    } else {
      const lordPos = new THREE.Vector3(state.lord.pos.x, 1.2, state.lord.pos.z)
      const dir = lordPos.clone().sub(camera.position)
      const dist = dir.length()
      occlusionRay.set(camera.position, dir.normalize())
      occlusionRay.far = dist - 0.5
      occluderHits = new Set(occlusionRay.intersectObjects(decor.occluders, false).map((h) => h.object))
    }
  }
  for (const mesh of decor.occluders) {
    const mat = (mesh as THREE.Mesh).material as THREE.MeshStandardMaterial
    const targetOpacity = occluderHits.has(mesh) ? 0.18 : 1
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

// ---------------------------------------------------------------- 영웅 캐릭터 창 + 선택 부대 패널 (SC/LoL식)
interface HeroCard {
  root: HTMLDivElement
  hpText: HTMLSpanElement
  hpBar: HTMLDivElement
  skillBtn: HTMLDivElement
  skillOv: HTMLDivElement
  skillCd: HTMLSpanElement
  mode: HTMLSpanElement
}
const heroCards = new Map<number, HeroCard>()

function buildHeroCard(heroId: number, index: number): HeroCard {
  const root = document.createElement('div')
  root.style.cssText =
    'pointer-events:auto;width:172px;background:#000d;border:1px solid #345;border-radius:6px;' +
    'padding:8px 10px;cursor:pointer;font-family:monospace;color:#e8e8f0;user-select:none'
  root.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center">
      <div style="width:38px;height:38px;border-radius:5px;border:1px solid #57a;flex:none;
           display:flex;align-items:center;justify-content:center;font-size:20px;
           background:radial-gradient(circle at 35% 30%, #2d64b0, #122340)">⚔</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <b style="color:#7ab0ff;font-size:13px">영웅${index > 0 ? ` ${index + 1}` : ''}</b>
          <span class="hp-t" style="font-size:10px"></span>
        </div>
        <div style="width:100%;height:7px;background:#0009;margin-top:4px;border-radius:2px">
          <div class="hp-b" style="height:100%;width:100%;background:#62c462;border-radius:2px"></div>
        </div>
      </div>
    </div>
    <div style="display:flex;gap:7px;align-items:center;margin-top:7px">
      <div class="sk" style="position:relative;width:36px;height:36px;border:1px solid #764;border-radius:5px;
           overflow:hidden;flex:none;cursor:pointer;
           background:radial-gradient(circle at 50% 65%, #ff9a40, #7a2808)">
        <span style="position:absolute;top:1px;left:4px;font-size:10px;font-weight:bold;color:#ffe0b0;text-shadow:0 1px 2px #000">E</span>
        <div class="sk-ov" style="position:absolute;left:0;bottom:0;width:100%;height:0;background:#000b"></div>
        <span class="sk-cd" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
              font-size:12px;font-weight:bold;text-shadow:0 1px 2px #000"></span>
      </div>
      <div style="font-size:11px;color:#c8b890;line-height:1.35">${HERO_SKILL.name}<br>
        <span class="sk-mode" style="color:#8898a8"></span></div>
    </div>`
  // 카드 클릭 = 해당 영웅만 선택 (LoL 초상 클릭 관례)
  root.addEventListener('pointerdown', (e) => {
    e.stopPropagation()
    selected.clear()
    selected.add(heroId)
  })
  const skillBtn = root.querySelector('.sk') as HTMLDivElement
  skillBtn.addEventListener('pointerdown', (e) => {
    e.stopPropagation()
    const hero = state.units.find((u) => u.id === heroId)
    if (hero) triggerSkill(hero)
  })
  const card: HeroCard = {
    root,
    hpText: root.querySelector('.hp-t') as HTMLSpanElement,
    hpBar: root.querySelector('.hp-b') as HTMLDivElement,
    skillBtn,
    skillOv: root.querySelector('.sk-ov') as HTMLDivElement,
    skillCd: root.querySelector('.sk-cd') as HTMLSpanElement,
    mode: root.querySelector('.sk-mode') as HTMLSpanElement,
  }
  document.getElementById('herobar')!.appendChild(root)
  return card
}

function updateHeroBar(): void {
  const heroes = state.units.filter((u) => u.kind === 'hero')
  // 전사한 영웅 카드 제거
  for (const [id, card] of heroCards) {
    if (!heroes.some((h) => h.id === id)) {
      card.root.remove()
      heroCards.delete(id)
    }
  }
  heroes.forEach((h, i) => {
    let card = heroCards.get(h.id)
    if (!card) {
      card = buildHeroCard(h.id, i)
      heroCards.set(h.id, card)
    }
    const maxHp = UNIT_KINDS.hero!.hp
    card.hpText.textContent = `${h.hp}/${maxHp}`
    card.hpBar.style.width = `${Math.max(0, (h.hp / maxHp) * 100)}%`
    card.hpBar.style.background = h.hp / maxHp > 0.35 ? '#62c462' : '#d05050'
    card.root.style.borderColor = selected.has(h.id) ? '#ffd870' : '#345'
    const cdMax = HERO_SKILL.cooldown * TICKS_PER_SECOND
    if (h.skillCd > 0) {
      // 쿨다운 스윕 — 아래에서 위로 차오르는 LoL식 오버레이
      card.skillOv.style.height = `${(h.skillCd / cdMax) * 100}%`
      card.skillCd.textContent = `${Math.ceil(h.skillCd / TICKS_PER_SECOND)}`
      card.mode.textContent = skillAuto ? '자동' : '수동'
    } else {
      card.skillOv.style.height = '0'
      card.skillCd.textContent = ''
      card.mode.textContent =
        aiming && aimingHeroId === h.id ? '조준 중…' : skillAuto ? '자동 (T)' : '수동 (T)'
    }
  })
}

// 선택 부대 패널 (SC식) — 칩 그리드, 칩 클릭 = 단독 선택
const KIND_SHORT: Record<string, string> = { soldier: '궁', ballista: '발', cannon: '포', hero: '영' }
const selChips = new Map<number, { root: HTMLDivElement; hp: HTMLDivElement }>()
let selPanelKey = ''

function updateSelPanel(): void {
  const sel = state.units.filter((u) => selected.has(u.id))
  const panel = document.getElementById('selpanel')!
  if (sel.length === 0) {
    panel.style.display = 'none'
    selPanelKey = ''
    return
  }
  panel.style.display = 'block'
  const key = sel.map((u) => u.id).join(',')
  if (key !== selPanelKey) {
    selPanelKey = key
    const grid = document.getElementById('selgrid')!
    grid.innerHTML = ''
    selChips.clear()
    for (const u of sel) {
      const chip = document.createElement('div')
      chip.style.cssText =
        'width:34px;cursor:pointer;text-align:center;font-family:monospace;font-size:12px;' +
        'background:#1a2430;border:1px solid #456;border-radius:4px;padding:2px 0 3px;color:#cde'
      chip.innerHTML = `${KIND_SHORT[u.kind] ?? '?'}<div style="height:4px;background:#0009;margin:2px 3px 0">
        <div class="c-hp" style="height:100%;width:100%;background:#62c462"></div></div>`
      chip.addEventListener('pointerdown', (e) => {
        e.stopPropagation()
        selected.clear()
        selected.add(u.id)
      })
      grid.appendChild(chip)
      selChips.set(u.id, { root: chip, hp: chip.querySelector('.c-hp') as HTMLDivElement })
    }
  }
  const counts = new Map<string, number>()
  for (const u of sel) counts.set(u.kind, (counts.get(u.kind) ?? 0) + 1)
  document.getElementById('selcount')!.textContent =
    `선택 ${sel.length} — ` + [...counts].map(([k, n]) => `${UNIT_KINDS[k]!.name} ${n}`).join(' · ')
  for (const u of sel) {
    const chip = selChips.get(u.id)
    if (chip) chip.hp.style.width = `${Math.max(0, (u.hp / UNIT_KINDS[u.kind]!.hp) * 100)}%`
  }
}

let renderAlpha = 1
let frameNo = 0

function syncScene(): void {
  fadeOccluders(frameNo % 4 === 0)
  frameNo++
  const lx = THREE.MathUtils.lerp(prevLord.x, state.lord.pos.x, renderAlpha)
  const lz = THREE.MathUtils.lerp(prevLord.z, state.lord.pos.z, renderAlpha)
  const ly = THREE.MathUtils.lerp(prevLordH, state.lord.h, renderAlpha)
  lordMesh.position.set(lx, ly, lz)
  lordMesh.rotation.y = state.lord.facing

  for (const e of state.enemies) {
    let v = enemyVisuals.get(e.id)
    if (!v) {
      const rig = makeMonster(e.kind)
      v = { group: rig.root, rig }
      enemyVisuals.set(e.id, v)
      enemyGroupToId.set(rig.root.uuid, e.id)
      scene.add(rig.root)
    }
    const prev = prevEnemies.get(e.id)
    const ex = prev ? THREE.MathUtils.lerp(prev.x, e.pos.x, renderAlpha) : e.pos.x
    const ez = prev ? THREE.MathUtils.lerp(prev.z, e.pos.z, renderAlpha) : e.pos.z
    v.group.position.set(ex, 0, ez)
    // 이동 중엔 서쪽(성벽), 정지 시엔 마지막 접전 방향
    const moving = prev
      ? Math.abs(prev.x - e.pos.x) + Math.abs(prev.z - e.pos.z) > 1e-4
      : true
    v.group.rotation.y = moving ? ENEMY_FACE_WEST : (enemyFacing.get(e.id) ?? ENEMY_FACE_WEST)
  }
  for (const [id, v] of enemyVisuals) {
    if (!state.enemies.some((e) => e.id === id)) {
      scene.remove(v.group)
      enemyGroupToId.delete(v.group.uuid)
      enemyAttackT.delete(id)
      enemyFacing.delete(id)
      enemyVisuals.delete(id)
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
  // 스테일 스윕 — fastForward(검증 훅)는 이벤트를 버리므로 unitDied 연출 없이 사라진 유닛 정리
  for (const [id, v] of unitVisuals) {
    if (!state.units.some((u) => u.id === id)) {
      scene.remove(v.group)
      groupToUnitId.delete(v.group.uuid)
      unitVisuals.delete(id)
      selected.delete(id)
    }
  }

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

  updateHeroBar()
  updateSelPanel()

  // 상태창 — 선택 유닛 우선, 없으면 클릭 조사한 괴수
  const panel = document.getElementById('panel')!
  let shown = false
  if (selected.size > 0) {
    const first = state.units.filter((u) => selected.has(u.id)).sort((a, b) => a.id - b.id)[0]
    if (first) {
      const def = UNIT_KINDS[first.kind]!
      document.getElementById('p-name')!.textContent =
        def.name + (selected.size > 1 ? ` 외 ${selected.size - 1}` : '')
      document.getElementById('p-hptext')!.textContent = `HP ${first.hp}/${def.hp}`
      ;(document.getElementById('p-hpbar') as HTMLDivElement).style.width =
        `${Math.max(0, (first.hp / def.hp) * 100)}%`
      document.getElementById('p-stats')!.innerHTML =
        `공격 ${def.dmg}${def.aoe ? ` (광역 ${def.aoe})` : ''} · 사거리 ${def.range}<br>공속 ${def.atkInterval}초` +
        (first.kind === 'hero'
          ? `<br>스킬 ${HERO_SKILL.name}: 피해 ${HERO_SKILL.dmg} · 반경 ${HERO_SKILL.radius}`
          : '')
      shown = true
    }
  } else if (inspectedEnemy !== null) {
    const e = state.enemies.find((x) => x.id === inspectedEnemy)
    if (e) {
      const def = ENEMY_KINDS[e.kind]!
      document.getElementById('p-name')!.textContent = def.name
      document.getElementById('p-hptext')!.textContent = `HP ${Math.max(0, e.hp)}/${def.hp}`
      ;(document.getElementById('p-hpbar') as HTMLDivElement).style.width =
        `${Math.max(0, (e.hp / def.hp) * 100)}%`
      ;(document.getElementById('p-hpbar') as HTMLDivElement).style.background = '#c05050'
      document.getElementById('p-stats')!.innerHTML =
        `공격 ${def.dmg} · 성벽 파괴 ${def.wallDamage}<br>속도 ${def.speed}`
      shown = true
    } else {
      inspectedEnemy = null
    }
  }
  if (shown && selected.size > 0)
    (document.getElementById('p-hpbar') as HTMLDivElement).style.background = '#62c462'
  panel.style.display = shown ? 'block' : 'none'
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

let fpsFrames = 0
let fpsT0 = performance.now()

function applyResScale(): void {
  renderer.setPixelRatio(resScale)
  composer.setPixelRatio(resScale)
  composer.setSize(window.innerWidth, window.innerHeight)
}

/** 동적 해상도 조절 — 하락은 빠르게(-0.2), 회복은 천천히(+0.05, 헌팅 방지).
 *  최저 스케일에서도 40 미만이면 블룸까지 끄고, 여유가 돌아오면 순서대로 복구.
 *  초기 3초는 에셋 로딩 히치라 판단 유보 */
const ADAPT_WARMUP_MS = 3000
function adaptQuality(fps: number, now: number): void {
  if (now < ADAPT_WARMUP_MS) return
  if (fps < 45 && resScale > RES_MIN) {
    resScale = Math.max(RES_MIN, resScale - 0.2)
    applyResScale()
  } else if (fps < 40 && resScale <= RES_MIN && bloom.enabled) {
    bloom.enabled = false
  } else if (fps > 57) {
    if (resScale < RES_MAX) {
      resScale = Math.min(RES_MAX, resScale + 0.05)
      applyResScale()
    } else if (!bloom.enabled) {
      bloom.enabled = true
    }
  }
}

function frame(now: number): void {
  fpsFrames++
  if (now - fpsT0 >= 500) {
    const fps = (fpsFrames * 1000) / (now - fpsT0)
    document.getElementById('fps')!.textContent =
      `${Math.round(fps)} fps · 해상도 ${Math.round((resScale / RES_MAX) * 100)}%${bloom.enabled ? '' : ' · 블룸 꺼짐'}`
    adaptQuality(fps, now)
    fpsFrames = 0
    fpsT0 = now
  }
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
    if (pendingHeroSkill) {
      input.heroSkill = pendingHeroSkill
      pendingHeroSkill = undefined
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
  for (const e of state.enemies) {
    const v = enemyVisuals.get(e.id)
    if (!v) continue
    const prev = prevEnemies.get(e.id)
    const moving = prev
      ? Math.abs(prev.x - e.pos.x) + Math.abs(prev.z - e.pos.z) > 1e-4
      : true
    const atk = enemyAttackT.get(e.id)
    animateMonster(v.rig, t + e.id * 0.9, moving, atk === undefined ? -1 : now - atk)
  }
  for (const f of fires) f.update(t)
  decor.torchLights.forEach((l, i) => {
    // 낮이라 횃불은 은은한 보조광만
    l.intensity = 5 + Math.sin(t * 9 + i * 1.7) * 1.2 + Math.sin(t * 23 + i) * 0.7
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
