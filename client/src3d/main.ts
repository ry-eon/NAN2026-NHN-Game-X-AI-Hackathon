// 농성전 3D 렌더러 (M1 뼈대) — three.js.
// sim(siege/sim/world.ts)은 렌더링을 모른다. 여기는 상태를 그리고 입력을 모을 뿐.

import * as THREE from 'three'
import {
  HERO_SKILL,
  SEGMENTS,
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
import {
  HIT_REACT_MS,
  animateMonster,
  animateRig,
  animateWeapon,
  disposeTree,
  makeBallista,
  makeCannon,
  makeFire,
  makeKnight,
  makeMonster,
  ownMaterials,
  setFlash,
  setOpacity,
} from './models'
import type { MonsterRig, Rig, WeaponRig } from './models'
import { createParticles } from './particles'

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
// 통계는 프레임 단위로 누적한다 — 기본값(autoReset)이면 마지막 포스트 패스만 남아
// "드로우콜 1"처럼 읽혀서 성능 원인 판별에 쓸 수 없다. 리셋은 frame() 첫머리에서.
renderer.info.autoReset = false
document.getElementById('game')!.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.fog = new THREE.Fog(0xc9d4e2, 75, 235) // 낮 대기 원근 — 지평선이 뿌옇게 잠긴다

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 240)

// ---------------------------------------------------------------- 로딩 화면
// HDRI·PBR 텍스처·GLTF는 전부 비동기라 씬이 "덜 지어진 채" 먼저 뜬다. 개발기에선 순간이지만
// 회선이 느리면 검은 들판·민무늬 성벽이 그대로 보인다(제출 링크로 처음 여는 심사자가 그 경우다).
// 로더 등록보다 먼저 콜백을 걸어야 해서 에셋 호출부(loadSky/buildCastle) 위에 둔다.
const loadingEl = document.createElement('div')
loadingEl.style.cssText =
  'position:fixed;inset:0;z-index:50;background:#0b0d12;color:#c8d0e0;font-family:monospace;' +
  'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;transition:opacity .5s'
loadingEl.innerHTML = `
  <div style="font-size:15px;letter-spacing:2px;color:#8fa4c8">성을 세우는 중…</div>
  <div style="width:260px;height:4px;background:#1c2130;border-radius:2px;overflow:hidden">
    <div id="load-bar" style="height:100%;width:6%;background:#5b7fb8;transition:width .25s"></div>
  </div>
  <div id="load-text" style="font-size:11px;color:#5a6478"></div>`
document.body.appendChild(loadingEl)
{
  let started = false
  let done = false
  const finish = (): void => {
    if (done) return
    done = true
    loadingEl.style.opacity = '0'
    setTimeout(() => loadingEl.remove(), 600)
  }
  const mgr = THREE.DefaultLoadingManager
  mgr.onStart = (): void => {
    started = true
  }
  mgr.onProgress = (_url, loaded, total): void => {
    started = true
    const pct = Math.max(6, Math.round((loaded / Math.max(1, total)) * 100))
    ;(document.getElementById('load-bar') as HTMLDivElement).style.width = `${pct}%`
    document.getElementById('load-text')!.textContent = `${loaded} / ${total}`
  }
  mgr.onLoad = finish
  mgr.onError = (url): void => {
    // 에셋 하나가 실패해도 게임은 성립한다(절차 생성이 본체) — 로딩 화면에 갇히지 않게
    console.warn('[load] 실패:', url)
  }
  // 안전장치: 로드가 아예 시작되지 않거나(캐시 전량 적중) 에러로 onLoad가 안 뜰 때
  setTimeout(() => {
    if (!started) finish()
  }, 1500)
  setTimeout(finish, 20000)
}

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
// 톤 그레이딩 + 비네트 — 기존 비네트 패스를 확장했다. 패스를 늘리지 않는 게 핵심:
// 전화면 패스 하나가 곧 프레임 비용이라(SSAO를 뺀 이유) 그레이딩은 공짜로 얹는다.
//
// 여기는 톤매핑(OutputPass의 ACES) **이전**의 선형 HDR 공간이다. 그래서
// 화이트밸런스·노출성 조작은 자연스럽게 먹고, 대비는 중간 회색(0.18) 피벗 기준으로 건다.
// 방향: 그림자는 하늘빛으로 식히고 하이라이트는 햇빛으로 데운다 + 채도를 살짝 빼
// 돌·금속의 명암이 색보다 먼저 읽히게 (사용자 기준 "다크소울 = 렌더링 퀄리티").
const grade = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    vignette: { value: 0.3 },
    // 강도는 A/B 스크린샷으로 고른 중간값 — 더 세게(1.16/0.85) 가면 안뜰이 푸르게 잠겨
    // "밤 같다"는 기존 반려 사유에 가까워진다. 가독성 우선.
    contrast: { value: 1.12 },
    saturation: { value: 0.88 },
    lift: { value: new THREE.Vector3(0.92, 0.965, 1.1) }, // 그림자 — 푸른 하늘 반사
    gain: { value: new THREE.Vector3(1.1, 1.0, 0.87) }, // 하이라이트 — 오전 햇살
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float vignette, contrast, saturation;
    uniform vec3 lift, gain;
    varying vec2 vUv;
    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
    void main(){
      vec3 c = max(texture2D(tDiffuse, vUv).rgb, 0.0);
      // 1) 스플릿 톤 — HDR이라 밝기를 0~1로 정규화해서 섞는다
      float l = dot(c, LUMA);
      c *= mix(lift, gain, l / (l + 0.35));
      // 2) 대비 (중간 회색 피벗)
      c = pow(c / 0.18, vec3(contrast)) * 0.18;
      // 3) 채도
      c = mix(vec3(dot(c, LUMA)), c, saturation);
      // 4) 비네트 — 가장자리를 침잠시켜 시선을 성주 쪽에 묶는다
      c *= smoothstep(0.95, 0.42, distance(vUv, vec2(0.5)) * (1.0 + vignette));
      gl_FragColor = vec4(c, 1.0);
    }`,
})
composer.addPass(grade)
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
/** 자기가 치는 벽면을 바라보는 각 — 회절 레인으로 북/남벽에 붙은 개체는 서쪽이 아니다 */
function faceWall(e: { seg: number }): number {
  const n = SEGMENTS[e.seg]?.normal
  return n ? Math.atan2(-n.x, -n.z) : ENEMY_FACE_WEST
}
/** 피격 리액션 — 착탄 시각 + 밀려날 방향(정규화 XZ) + 무게(대포·스킬은 크게) */
interface HitReact {
  t0: number
  dx: number
  dz: number
  heavy: number
}
const FLASH_MS = 150 // 피격 플래시 길이 — 리액션(HIT_REACT_MS)보다 짧게 터뜨린다
const enemyHit = new Map<number, HitReact>()
const unitHit = new Map<number, HitReact>() // 아군 피격 (meleeHit)
const unitAttackT = new Map<number, number>() // unitFired 시각 — 활 놓기/검 스윙/병기 반동

// 아군 유닛 비주얼 풀 — 병종별 절차 모델. 그룹→유닛 id 역참조는 피킹에 사용
interface UnitVisual {
  group: THREE.Group
  rig?: Rig // 사람(궁수·영웅·병기 조작병)
  weapon?: WeaponRig // 병기 본체 — 발사 반동
  mats: THREE.Material[] // 개체 전용 머티리얼 — 피격 플래시·소멸 페이드
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
  s.material.userData.owned = true // 개체 전용 캔버스 텍스처 — 폐기 시 함께 dispose
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
    v = { group: rig.root, rig, mats: rig.mats, kind: u.kind }
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
    v = { group: rig.root, rig, mats: rig.mats, kind: u.kind }
  } else {
    // 병기: 본체 머티리얼도 개체 사본으로 (조작병과 함께 페이드·플래시되게)
    const weapon = u.kind === 'cannon' ? makeCannon() : makeBallista()
    const weaponMats = ownMaterials(weapon.group)
    const crew = attachCrew(weapon.group, u.kind === 'cannon' ? 0.55 : 0, u.kind === 'cannon' ? -1.05 : -1.15)
    v = { group: weapon.group, weapon, rig: crew, mats: [...weaponMats, ...crew.mats], kind: u.kind }
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

// 고정 병기의 조준선 — 화망이 어디에 그려져 있는지 보이지 않으면 유도 규칙 자체가 안 읽힌다.
// 선택한 병기에 대해서만 그린다(전부 그리면 화면이 선으로 덮인다).
const AIM_MAX = 24 // 동시에 그릴 병기 수 상한
// 병기당 선분 2개: 포신→조준점, 그리고 조준점의 수직 표식.
// WebGL은 선 두께가 1px로 고정이라 선만으로는 끝점이 안 읽힌다 — 표식이 그 보완이다.
const aimLineGeo = new THREE.BufferGeometry()
aimLineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(AIM_MAX * 12), 3))
const aimLines = new THREE.LineSegments(
  aimLineGeo,
  // depthTest를 끈다 — 지휘 오버레이라 성벽 너머로도 보여야 한다.
  // (켜두면 안뜰 시점에서 선이 통째로 벽에 가려져 조준이 안 보인다 — 실측으로 확인)
  new THREE.LineBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.62, depthTest: false, depthWrite: false }),
)
aimLines.renderOrder = 999
aimLines.frustumCulled = false
scene.add(aimLines)

/** 선택된 고정 병기 → 조준점 선분을 갱신 (프레임마다, 할당 없이 버퍼만 덮어쓴다) */
function updateAimLines(): void {
  const pos = aimLineGeo.getAttribute('position') as THREE.BufferAttribute
  let n = 0
  for (const u of state.units) {
    if (n >= AIM_MAX || !u.aim || !selected.has(u.id)) continue
    const v = n * 4
    pos.setXYZ(v, u.pos.x, u.h + 1.2, u.pos.z) // 포신에서
    pos.setXYZ(v + 1, u.aim.x, 0.35, u.aim.z) // 조준점까지
    pos.setXYZ(v + 2, u.aim.x, 0.05, u.aim.z) // 조준점 수직 표식
    pos.setXYZ(v + 3, u.aim.x, 2.6, u.aim.z)
    n++
  }
  pos.needsUpdate = true
  aimLineGeo.setDrawRange(0, n * 4)
  aimLines.visible = n > 0
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
let pendingUnitAim: { ids: number[]; to: { x: number; z: number } } | undefined
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
    // 고정 병기(대포·발리스타)는 못 옮긴다 — 같은 우클릭이 **조준 명령**이 된다.
    // 한 번의 명령으로 둘이 섞여도 각자 맞는 쪽으로 간다.
    const guns: number[] = []
    const movers: number[] = []
    for (const id of selected) {
      const u = state.units.find((v) => v.id === id)
      if (!u) continue
      ;(state.kinds.units[u.kind]?.emplaced ? guns : movers).push(id)
    }
    if (guns.length > 0) {
      pendingUnitAim = { ids: guns, to: { x: p.x, z: p.z } }
      showMoveMarker(p.x, p.z, p.h, 0xffb347) // 조준은 주황 — 이동(녹색)과 구분
    }
    if (movers.length > 0) {
      pendingUnitMove = { ids: movers, to: p }
      if (guns.length === 0) showMoveMarker(p.x, p.z, p.h, 0x53d6a2)
    }
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
  // 재시작은 판이 끝난 뒤에만 — 전투 중 오타로 판이 날아가면 안 된다
  if (e.code === 'KeyR' && (state.status === 'won' || state.status === 'lost')) {
    resetGame()
    return
  }
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
    드래그: 선택 · 더블클릭: 같은 병종 · <b>Ctrl+1~5</b>: 부대 지정 / <b>1~5</b>: 호출 · 우클릭: <b>병기 조준</b> / 이동(무선택 시 성주) · <b>E</b>: 스킬 · <b>T</b>: 조준 전환 · ESC: 해제 · <b>Space</b>: 침공
  </div>
  <div id="endcard" style="position:absolute;inset:0;display:none;align-items:center;justify-content:center;
       background:radial-gradient(ellipse at center, #0007 0%, #000b 70%)">
    <div style="text-align:center">
      <div id="end-title" style="font-size:34px;font-weight:bold;letter-spacing:4px;margin-bottom:10px"></div>
      <div id="end-sub" style="font-size:13px;color:#b8c0d0;line-height:1.8;margin-bottom:18px"></div>
      <div id="end-btn" style="pointer-events:auto;cursor:pointer;display:inline-block;padding:9px 22px;
           border:1px solid #5b7fb8;border-radius:5px;color:#dce6f5;font-size:14px;background:#16203058">
        다시 하기 <b>(R)</b></div>
    </div>
  </div>`
document.body.appendChild(hud)

// ---------------------------------------------------------------- 루프
// 재시작 때 새 판으로 갈아끼우므로 let (모듈 스코프라 아래 클로저들이 새 참조를 그대로 본다)
const SEED = 20260725
let { state, spawns } = createSiege(SEED)
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
  kind: string
  targetId: number
  hit: boolean // 착탄 처리 1회 보장
}
const projectiles: Projectile[] = []
const flashes: { mesh: THREE.Sprite; t0: number; dur: number; grow: number }[] = []
/** 쓰러지는 시신 — 맞은 방향으로 넘어가며 말미에 페이드. mats는 개체 전용이라 이 개체만 사라진다 */
interface Dying {
  obj: THREE.Object3D
  t0: number
  dur: number
  mats: THREE.Material[]
  axis: THREE.Vector3
  q0: THREE.Quaternion
}
const dying: Dying[] = []

/** dir = 넘어질 방향의 헤딩각(atan2(dx, dz) 규약) */
function startDying(obj: THREE.Object3D, mats: THREE.Material[], dur: number, dir: number): void {
  setFlash(mats, 0)
  dying.push({
    obj,
    t0: performance.now(),
    dur,
    mats,
    // 넘어질 방향에 수직인 월드 축 — 이 축으로 90° 돌면 몸이 dir 쪽으로 눕는다
    axis: new THREE.Vector3(Math.cos(dir), 0, -Math.sin(dir)),
    q0: obj.quaternion.clone(),
  })
}
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
// 영웅은 검을 휘두른다 — 날아가는 것도 화살이 아니라 검기(가로로 긴 발광 판)
const slashGeo = new THREE.BoxGeometry(0.9, 0.16, 0.28)
const projMat = new THREE.MeshBasicMaterial({ color: 0xfff2c8 })
const ballMat = new THREE.MeshBasicMaterial({ color: 0x1a1a20 })
const slashMat = new THREE.MeshBasicMaterial({ color: 0xffd070, transparent: true, opacity: 0.9 })

/** 발사 연출 — 병종별 궤적. 피해는 sim이 이미 적용했으므로 여긴 그림뿐 */
function spawnProjectile(kind: string, targetId: number, from: THREE.Vector3, to: THREE.Vector3): void {
  const spec =
    kind === 'cannon'
      ? { geo: ballGeo, mat: ballMat, dur: 480, arc: 4.2, explode: true }
      : kind === 'ballista'
        ? { geo: boltGeo, mat: projMat, dur: 170, arc: 0.3, explode: false }
        : kind === 'hero'
          ? { geo: slashGeo, mat: slashMat, dur: 200, arc: 0.6, explode: false }
          : { geo: arrowGeo, mat: projMat, dur: 260, arc: 1.6, explode: false }
  const mesh = new THREE.Mesh(spec.geo, spec.mat)
  mesh.position.copy(from)
  scene.add(mesh)
  projectiles.push({
    mesh,
    from,
    to,
    t0: performance.now(),
    dur: spec.dur,
    arc: spec.arc,
    explode: spec.explode,
    kind,
    targetId,
    hit: false,
  })
}

// 연기·파편 입자 풀 (고정 크기 — 프레임 예산이 늘지 않는다)
const fx = createParticles(scene)

// ---- 카메라 흔들림 (trauma 모델) — 폭발·충격이 화면으로 전달되게. 전화면 패스가 아니라 비용 0
let trauma = 0
/** amount = 0~1, 발생 지점이 화면 중심(성주)에서 멀면 감쇠 */
function addTrauma(amount: number, x?: number, z?: number): void {
  let k = 1
  if (x !== undefined && z !== undefined) {
    const d = Math.hypot(x - state.lord.pos.x, z - state.lord.pos.z)
    k = Math.max(0, 1 - d / 42)
  }
  trauma = Math.min(1, trauma + amount * k)
}

/** 피격 반응 등록 — 플래시·리액션·넉백은 여기 한 곳에서 (연출 전용) */
function hitEnemy(id: number, dx: number, dz: number, heavy: number, y = 0.9): boolean {
  const e = state.enemies.find((x) => x.id === id)
  if (!e) return false
  const len = Math.hypot(dx, dz) || 1
  enemyHit.set(id, { t0: performance.now(), dx: dx / len, dz: dz / len, heavy })
  spawnFlash(
    new THREE.Vector3(e.pos.x, y, e.pos.z),
    0.55 + heavy * 0.9,
    heavy > 0.5 ? 0xffc070 : 0xffe6c0,
    heavy > 0.5 ? 240 : 160,
  )
  return true
}

/** 착탄 — 명중한 괴수(대포는 폭심 반경 전원)에 반응을 준다 */
function impact(p: Projectile): void {
  p.hit = true
  const def = state.kinds.units[p.kind]
  const dx = p.to.x - p.from.x
  const dz = p.to.z - p.from.z
  if (def?.aoe) {
    addTrauma(0.34, p.to.x, p.to.z)
    // 포탄 착탄 — 흙먼지 기둥 + 파헤쳐진 흙덩이
    fx.smoke(p.to.x, 0.5, p.to.z, { count: 5, scale: 1.5, rise: 1.6, spread: 0.7, dur: 1300, tint: 0x9a8f7c, opacity: 0.6 })
    fx.debris(p.to.x, 0.2, p.to.z, { count: 9, speed: 6, kind: 'dirt' })
    fx.debris(p.to.x, 0.3, p.to.z, { count: 3, speed: 5, kind: 'ember' })
    for (const e of state.enemies) {
      if (Math.hypot(e.pos.x - p.to.x, e.pos.z - p.to.z) > def.aoe) continue
      hitEnemy(e.id, e.pos.x - p.to.x, e.pos.z - p.to.z, 1, 1.1)
    }
  } else if (!hitEnemy(p.targetId, dx, dz, p.kind === 'ballista' ? 0.55 : 0.25)) {
    // 표적이 착탄 전에 죽었다 — 그래도 화살이 꽂힌 자리는 보인다
    spawnFlash(p.to.clone(), 0.6, 0xffcaa0, 150)
  }
}

/** 병종별 총구 높이 (모델 형상 기준) */
const MUZZLE_H: Record<string, number> = { soldier: 1.35, hero: 1.4, cannon: 0.9, ballista: 0.8 }

/** 괴수 비주얼을 살아있는 풀에서 떼어낸다 (시신 연출로 넘길 때·스테일 스윕 공용) */
function dropEnemyVisual(id: number, v: EnemyVisual): void {
  enemyVisuals.delete(id)
  enemyGroupToId.delete(v.group.uuid)
  enemyAttackT.delete(id)
  enemyFacing.delete(id)
}

let wallHitT = -1e9 // 마지막 성벽 피격 시각 — HUD 게이지 반응용

function handleEvents(events: SiegeEvent[]): void {
  for (const ev of events) {
    if (ev.type === 'unitFired') {
      const from = new THREE.Vector3(ev.from.x, ev.from.h + (MUZZLE_H[ev.unitKind] ?? 1), ev.from.z)
      spawnProjectile(ev.unitKind, ev.targetId, from, new THREE.Vector3(ev.to.x, 0.7, ev.to.z))
      // 발사 섬광 — 어디서 쏘는지 읽히게 (대포는 크게)
      spawnFlash(from.clone(), ev.unitKind === 'cannon' ? 2.4 : 0.8, 0xffdf9a, 200)
      unitAttackT.set(ev.unitId, performance.now()) // 사격 모션·병기 반동
      if (ev.unitKind === 'cannon') {
        spawnLight(from.clone(), 0xffb060, 40, 300)
        addTrauma(0.3, ev.from.x, ev.from.z) // 대포는 쏠 때부터 화면이 울린다
        // 포연 — 포구 앞(사격 방향)으로 뭉게뭉게. 성벽 위 대포라 rise는 낮게(보도를 덮지 않게)
        const mdx = ev.to.x - ev.from.x
        const mdz = ev.to.z - ev.from.z
        const mlen = Math.hypot(mdx, mdz) || 1
        fx.smoke(ev.from.x + (mdx / mlen) * 1.1, from.y, ev.from.z + (mdz / mlen) * 1.1, {
          count: 4,
          scale: 1.1,
          rise: 0.7,
          spread: 0.4,
          dur: 1400,
          tint: 0xa9a49c,
          opacity: 0.55,
        })
      }
    } else if (ev.type === 'enemyDied') {
      const v = enemyVisuals.get(ev.id)
      if (v) {
        dropEnemyVisual(ev.id, v)
        // 마지막으로 맞은 방향으로 넘어간다 — 죽음이 타격의 결과로 읽히게
        const h = enemyHit.get(ev.id)
        startDying(v.group, v.rig.mats, 620, h ? Math.atan2(h.dx, h.dz) : 0)
      }
      enemyHit.delete(ev.id)
      spawnFlash(new THREE.Vector3(ev.pos.x, 0.8, ev.pos.z), 1.6, 0xff6a4a, 300)
      // 쓰러지며 이는 흙먼지 — 시신이 바닥에 닿는 쪽이라 낮고 넓게
      fx.smoke(ev.pos.x, 0.3, ev.pos.z, { count: 3, scale: 1, rise: 0.35, spread: 0.6, dur: 900, tint: 0x9c9184, opacity: 0.4 })
    } else if (ev.type === 'enemyRaised') {
      // 부활 — 잡았던 것이 다시 선다. 죽음(붉은 섬광)과 반대로 **차가운 보라**로 읽히게 해서
      // "내가 방금 죽인 게 일어났다"가 한눈에 구분되게 한다. 술사를 끊으라는 신호이기도 하다.
      spawnFlash(new THREE.Vector3(ev.pos.x, 0.9, ev.pos.z), 2.2, 0x9a5cff, 420)
      fx.smoke(ev.pos.x, 0.25, ev.pos.z, { count: 5, scale: 1.1, rise: 1.5, spread: 0.5, dur: 1100, tint: 0x3a2258, opacity: 0.55 })
      addTrauma(0.08, ev.pos.x, ev.pos.z)
    } else if (ev.type === 'unitDied') {
      const v = unitVisuals.get(ev.id)
      if (v) {
        unitVisuals.delete(ev.id)
        groupToUnitId.delete(v.group.uuid)
        unitAttackT.delete(ev.id)
        const h = unitHit.get(ev.id)
        startDying(v.group, v.mats, 800, h ? Math.atan2(h.dx, h.dz) : 0)
      }
      unitHit.delete(ev.id)
      selected.delete(ev.id)
      spawnFlash(new THREE.Vector3(ev.pos.x, 1.0, ev.pos.z), 1.8, 0xff3a3a, 400)
      addTrauma(0.18, ev.pos.x, ev.pos.z)
      // 아군은 성벽 위에서도 죽는다 — 먼지는 그 층 바닥에서 (sim에선 이미 지워진 유닛이라
      // 마지막 렌더 위치의 y를 쓴다)
      const uy = v ? v.group.position.y : 0
      fx.smoke(ev.pos.x, uy + 0.3, ev.pos.z, { count: 3, scale: 0.9, rise: 0.4, spread: 0.5, dur: 850, tint: 0xa8a196, opacity: 0.4 })
    } else if (ev.type === 'heroSkillCast') {
      spawnFlash(new THREE.Vector3(ev.x, 1.6, ev.z), 8, 0xffa040, 650)
      spawnFlash(new THREE.Vector3(ev.x, 3.6, ev.z), 4.5, 0xfff0c0, 450)
      spawnShockwave(ev.x, ev.z, HERO_SKILL.radius + 1.2)
      spawnLight(new THREE.Vector3(ev.x, 2.5, ev.z), 0xff8030, 90, 700)
      // 화염 기둥 — 1.2초간 타오른다
      const fire = makeFire(2.6)
      fire.group.position.set(ev.x, 0.1, ev.z)
      scene.add(fire.group)
      fireCols.push({ fx: fire, t0: performance.now(), dur: 1200 })
      addTrauma(0.75, ev.x, ev.z)
      // 업화 뒤에 남는 검은 연기와 튀어오르는 잔해 — 폭심이 오래 읽히게
      fx.smoke(ev.x, 1.2, ev.z, { count: 6, scale: 2.2, rise: 2.2, spread: 1.6, dur: 2000, tint: 0x6b6259, opacity: 0.5 })
      fx.debris(ev.x, 0.4, ev.z, { count: 10, speed: 7, kind: 'ember' })
      fx.debris(ev.x, 0.3, ev.z, { count: 6, speed: 5.5, kind: 'dirt' })
      // 반경 안 전원이 밖으로 밀려난다 (피해는 sim이 이미 확정)
      for (const e of state.enemies) {
        if (Math.hypot(e.pos.x - ev.x, e.pos.z - ev.z) > HERO_SKILL.radius) continue
        hitEnemy(e.id, e.pos.x - ev.x, e.pos.z - ev.z, 1, 1.2)
      }
    } else if (ev.type === 'meleeHit') {
      enemyAttackT.set(ev.enemyId, performance.now())
      const u = state.units.find((x) => x.id === ev.unitId)
      const e = state.enemies.find((x) => x.id === ev.enemyId)
      if (u) {
        spawnFlash(new THREE.Vector3(u.pos.x, u.h + 1.1, u.pos.z), 0.9, 0xff5a5a, 200)
        // 아군 피격 — 괴수가 미는 방향으로 휘청인다
        const dx = e ? u.pos.x - e.pos.x : -1
        const dz = e ? u.pos.z - e.pos.z : 0
        const len = Math.hypot(dx, dz) || 1
        unitHit.set(ev.unitId, { t0: performance.now(), dx: dx / len, dz: dz / len, heavy: 0.5 })
        addTrauma(0.12, u.pos.x, u.pos.z)
        // 갑주에 부딪히는 불똥 — 접전이 어디서 벌어지는지 원거리에서도 보이게
        fx.debris(u.pos.x, u.h + 1.1, u.pos.z, { count: 3, speed: 2.6, kind: 'ember', floorY: u.h })
        // 접전 대상을 바라보게 — sim에 방향 개념이 없으므로 연출 전용
        if (e) enemyFacing.set(ev.enemyId, Math.atan2(u.pos.x - e.pos.x, u.pos.z - e.pos.z))
      }
    } else if (ev.type === 'wallHit') {
      enemyAttackT.set(ev.id, performance.now())
      const we = state.enemies.find((x) => x.id === ev.id)
      enemyFacing.set(ev.id, we ? faceWall(we) : ENEMY_FACE_WEST)
      wallHitT = performance.now() // HUD 성벽 게이지 반응
      const e = state.enemies.find((x) => x.id === ev.id)
      if (e) {
        addTrauma(0.16, e.pos.x, e.pos.z) // 성벽이 얻어맞으면 화면이 울린다
        spawnFlash(new THREE.Vector3(e.pos.x - 0.6, 1.4, e.pos.z), 1.1, 0xffb060, 220)
        // 돌 부스러기가 벽에서 바깥(괴수 쪽)으로 튀고 석분이 인다
        fx.debris(e.pos.x - 0.7, 1.5, e.pos.z, { count: 4, speed: 3.4, kind: 'stone', dirX: 1 })
        fx.smoke(e.pos.x - 0.7, 1.5, e.pos.z, {
          count: 2,
          scale: 0.75,
          rise: 0.5,
          spread: 0.3,
          dur: 800,
          tint: 0xbfb8ad,
          opacity: 0.45,
        })
      }
    }
  }
}

/** FX 갱신 — 매 프레임 */
function updateFx(now: number): void {
  fx.update(now)
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i]!
    const t = (now - p.t0) / p.dur
    if (t >= 1) {
      scene.remove(p.mesh)
      if (p.explode) {
        spawnFlash(p.to.clone(), 3.2, 0xffc070, 380)
        if (!p.hit) impact(p) // 포탄은 터지는 순간이 곧 타격
      }
      projectiles.splice(i, 1)
      continue
    }
    if (t >= 0.95 && !p.explode && p.mesh.visible) {
      // 착탄 순간 — 명중이 읽히게 (섬광은 표적의 현재 위치에서, 발사 시점 좌표가 아니라)
      if (!p.hit) impact(p)
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
      disposeTree(d.obj) // 지오메트리·개체 머티리얼 회수 (웨이브마다 수십 기가 죽는다)
      dying.splice(i, 1)
      continue
    }
    // 넘어짐: 초반에 빨리 기울고 바닥에서 멈춘다 (뒤로 젖혀졌다가 무너지는 느낌)
    const fall = 1 - Math.pow(1 - Math.min(1, t * 1.5), 3)
    tipQuat.setFromAxisAngle(d.axis, Math.PI * 0.48 * fall)
    d.obj.quaternion.copy(tipQuat).multiply(d.q0)
    d.obj.position.y -= 0.008
    if (t > 0.65) setOpacity(d.mats, 1 - (t - 0.65) / 0.35) // 말미에만 사라진다
  }
}
const tipQuat = new THREE.Quaternion()

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
    const maxHp = state.kinds.units.hero!.hp
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
    `선택 ${sel.length} — ` + [...counts].map(([k, n]) => `${state.kinds.units[k]!.name} ${n}`).join(' · ')
  for (const u of sel) {
    const chip = selChips.get(u.id)
    if (chip) chip.hp.style.width = `${Math.max(0, (u.hp / state.kinds.units[u.kind]!.hp) * 100)}%`
  }
}

let renderAlpha = 1
let frameNo = 0

function syncScene(now: number): void {
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
    let ex = prev ? THREE.MathUtils.lerp(prev.x, e.pos.x, renderAlpha) : e.pos.x
    let ez = prev ? THREE.MathUtils.lerp(prev.z, e.pos.z, renderAlpha) : e.pos.z
    // 피격 넉백 — 밀렸다 제자리로. sim 좌표는 건드리지 않는다(연출 전용, 결정론 불변)
    const hit = enemyHit.get(e.id)
    if (hit) {
      const q = 1 - (now - hit.t0) / HIT_REACT_MS
      if (q > 0) {
        const k = q * q * (0.12 + hit.heavy * 0.42)
        ex += hit.dx * k
        ez += hit.dz * k
      }
    }
    v.group.position.set(ex, 0, ez)
    // 이동 중엔 실제 진행 방향(회절 레인은 서쪽이 아니다), 정지 시엔 마지막 접전 방향
    const dx = prev ? e.pos.x - prev.x : 0
    const dz = prev ? e.pos.z - prev.z : 0
    const moving = Math.abs(dx) + Math.abs(dz) > 1e-4
    v.group.rotation.y = moving
      ? Math.atan2(dx, dz)
      : (enemyFacing.get(e.id) ?? faceWall(e))
  }
  for (const [id, v] of enemyVisuals) {
    if (!state.enemies.some((e) => e.id === id)) {
      scene.remove(v.group)
      disposeTree(v.group)
      dropEnemyVisual(id, v)
      enemyHit.delete(id)
    }
  }

  // 아군 유닛 — 위치·방향·선택 링
  let ringIdx = 0
  for (const u of state.units) {
    const v = ensureUnitVisual(u)
    const prev = prevUnits.get(u.id)
    let ux = prev ? THREE.MathUtils.lerp(prev.x, u.pos.x, renderAlpha) : u.pos.x
    let uz = prev ? THREE.MathUtils.lerp(prev.z, u.pos.z, renderAlpha) : u.pos.z
    const uy = prev ? THREE.MathUtils.lerp(prev.h, u.h, renderAlpha) : u.h
    const uhit = unitHit.get(u.id)
    if (uhit) {
      const q = 1 - (now - uhit.t0) / HIT_REACT_MS
      if (q > 0) {
        ux += uhit.dx * q * q * 0.16 // 성벽 위에서도 안전하도록 아주 짧게만 민다
        uz += uhit.dz * q * q * 0.16
      }
    }
    v.group.position.set(ux, uy, uz)
    v.group.rotation.y = u.facing
    if (selected.has(u.id)) {
      const ring = getSelectionRing(ringIdx++)
      ring.visible = true
      const r = state.kinds.units[u.kind]!.radius
      ring.scale.setScalar(0.8 + r)
      ring.position.set(ux, uy + 0.06, uz)
    }
  }
  for (let i = ringIdx; i < selectionRings.length; i++) selectionRings[i]!.visible = false
  // 스테일 스윕 — fastForward(검증 훅)는 이벤트를 버리므로 unitDied 연출 없이 사라진 유닛 정리
  for (const [id, v] of unitVisuals) {
    if (!state.units.some((u) => u.id === id)) {
      scene.remove(v.group)
      disposeTree(v.group)
      groupToUnitId.delete(v.group.uuid)
      unitVisuals.delete(id)
      unitAttackT.delete(id)
      unitHit.delete(id)
      selected.delete(id)
    }
  }

  // 카메라: LoL식 고정 부감 — 성주 남쪽 상공에서 내려다보며 추적
  const target = new THREE.Vector3(lx, ly, lz)
  // 비스듬한 앵글(약 43°) — 성벽·인물·바위의 수직면이 화면에 실린다
  camera.position.set(target.x, target.y + camDist * 0.82, target.z + camDist * 0.68)
  camera.lookAt(target.x, target.y + 1.0, target.z - 1.5)
  // 흔들림은 lookAt 뒤에 덧붙인다 — 제곱 감쇠라 큰 충격만 확실히 느껴지고 잔진동은 빨리 사라진다
  if (trauma > 0.002) {
    const s = trauma * trauma
    camera.position.x += Math.sin(now * 0.041) * s * 0.75
    camera.position.y += Math.sin(now * 0.053 + 1.7) * s * 0.55
    camera.position.z += Math.sin(now * 0.037 + 3.1) * s * 0.6
    camera.rotation.z += Math.sin(now * 0.047 + 0.8) * s * 0.02
  }

  // HUD
  document.getElementById('wall')!.textContent = `${state.wallHp}/${state.wallHpMax}`
  const wallBar = document.getElementById('wallbar') as HTMLDivElement
  wallBar.style.width = `${(state.wallHp / state.wallHpMax) * 100}%`
  // 성벽이 맞은 직후엔 게이지가 붉게 튄다 — 부감 시점에서 벽 상태가 눈에 들어오게
  const wq = 1 - (now - wallHitT) / 260
  wallBar.style.background = wq > 0 ? `rgb(${Math.round(98 + 157 * wq)},${Math.round(196 - 120 * wq)},98)` : '#62c462'
  const counts = new Map<string, number>()
  for (const u of state.units) counts.set(u.kind, (counts.get(u.kind) ?? 0) + 1)
  document.getElementById('army')!.textContent =
    `병력 ${state.units.length} (${[...counts].map(([k, n]) => `${state.kinds.units[k]!.name} ${n}`).join(' · ')})` +
    (selected.size > 0 ? ` — 선택 ${selected.size}` : '')

  updateHeroBar()
  updateSelPanel()

  // 상태창 — 선택 유닛 우선, 없으면 클릭 조사한 괴수
  const panel = document.getElementById('panel')!
  let shown = false
  if (selected.size > 0) {
    const first = state.units.filter((u) => selected.has(u.id)).sort((a, b) => a.id - b.id)[0]
    if (first) {
      const def = state.kinds.units[first.kind]!
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
      const def = state.kinds.enemies[e.kind]!
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

  // 종료 카드 — 결과 요약 + 재시작. 없으면 심사자가 새로고침 말고는 두 번째 판을 못 본다
  const endcard = document.getElementById('endcard') as HTMLDivElement
  const ended = state.status === 'won' || state.status === 'lost'
  if (ended && endcard.style.display === 'none') {
    const won = state.status === 'won'
    const title = document.getElementById('end-title')!
    title.textContent = won ? '성을 지켜냈다' : '성이 함락됐다'
    title.style.color = won ? '#ffd870' : '#e06a5a'
    document.getElementById('end-sub')!.innerHTML =
      `버틴 시간 ${(state.tick / TICKS_PER_SECOND).toFixed(1)}초` +
      ` · 성벽 ${state.wallHp}/${state.wallHpMax}<br>생존 병력 ${state.units.length}`
    endcard.style.display = 'flex'
  } else if (!ended && endcard.style.display !== 'none') {
    endcard.style.display = 'none'
  }
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

/**
 * 재시작 — 같은 시드로 새 판을 만든다.
 * sim은 `createSiege`로 통째로 새로 만들면 끝이지만(결정론이라 이전 판의 흔적이 남을 수 없다),
 * 렌더 쪽은 풀·시신·FX·선택 상태가 전부 이전 판의 것이라 여기서 직접 회수해야 한다.
 * 배경·성채·입자 풀은 판과 무관하므로 그대로 재사용한다(다시 짓지 않는다).
 */
function resetGame(): void {
  for (const [, v] of enemyVisuals) {
    scene.remove(v.group)
    disposeTree(v.group)
  }
  enemyVisuals.clear()
  enemyGroupToId.clear()
  enemyAttackT.clear()
  enemyFacing.clear()
  enemyHit.clear()
  for (const [, v] of unitVisuals) {
    scene.remove(v.group)
    disposeTree(v.group)
  }
  unitVisuals.clear()
  groupToUnitId.clear()
  unitAttackT.clear()
  unitHit.clear()
  for (const d of dying) {
    scene.remove(d.obj)
    disposeTree(d.obj)
  }
  dying.length = 0
  for (const p of projectiles) scene.remove(p.mesh)
  projectiles.length = 0
  for (const f of flashes) scene.remove(f.mesh)
  flashes.length = 0
  for (const w of shockwaves) scene.remove(w.mesh)
  shockwaves.length = 0
  for (const f of fireCols) scene.remove(f.fx.group)
  fireCols.length = 0
  for (const l of tempLights) scene.remove(l.light)
  tempLights.length = 0
  for (const [, card] of heroCards) card.root.remove()
  heroCards.clear()
  for (const ring of selectionRings) ring.visible = false

  selected.clear()
  ctrlGroups.clear()
  inspectedEnemy = null
  aimingHeroId = null
  aimReticle.visible = false
  trauma = 0
  wallHitT = -1e9
  spaceLatch = false
  pendingMove = undefined
  pendingUnitMove = undefined
  pendingUnitAim = undefined
  pendingHeroSkill = undefined

  const fresh = createSiege(SEED)
  state = fresh.state
  spawns = fresh.spawns
  snapshotPrev()
  acc = 0
  last = performance.now()
  document.getElementById('endcard')!.style.display = 'none'
}
document.getElementById('end-btn')!.addEventListener('click', resetGame)

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
  renderer.info.reset() // 이 프레임의 드로우콜·삼각형 누적 시작 (계측용)
  fpsFrames++
  if (now - fpsT0 >= 500) {
    const fps = (fpsFrames * 1000) / (now - fpsT0)
    document.getElementById('fps')!.textContent =
      `${Math.round(fps)} fps · 해상도 ${Math.round((resScale / RES_MAX) * 100)}%${bloom.enabled ? '' : ' · 블룸 꺼짐'}`
    adaptQuality(fps, now)
    fpsFrames = 0
    fpsT0 = now
  }
  const dt = Math.min(now - last, 100) / 1000
  trauma = Math.max(0, trauma - dt * 2.0) // 약 0.5초면 잦아든다
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
    if (pendingUnitAim) {
      input.unitAim = pendingUnitAim
      pendingUnitAim = undefined
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
    if (!v) continue
    const atk = unitAttackT.get(u.id)
    const atkMs = atk === undefined ? -1 : now - atk
    const hit = unitHit.get(u.id)
    const hitMs = hit ? now - hit.t0 : -1
    // 병기는 본체가 반동하고, 사람(궁수·영웅·조작병)은 팔이 움직인다
    if (v.weapon) {
      animateWeapon(v.weapon, atkMs)
      if (v.rig) animateRig(v.rig, t + u.id * 0.7, u.path.length > 0, -1, hitMs)
    } else if (v.rig) {
      animateRig(v.rig, t + u.id * 0.7, u.path.length > 0, atkMs, hitMs)
    }
    setFlash(v.mats, hitMs >= 0 && hitMs < FLASH_MS ? 0.85 * (1 - hitMs / FLASH_MS) : 0)
    if (hit && now - hit.t0 > HIT_REACT_MS) unitHit.delete(u.id)
  }
  for (const e of state.enemies) {
    const v = enemyVisuals.get(e.id)
    if (!v) continue
    const prev = prevEnemies.get(e.id)
    const moving = prev
      ? Math.abs(prev.x - e.pos.x) + Math.abs(prev.z - e.pos.z) > 1e-4
      : true
    const atk = enemyAttackT.get(e.id)
    const hit = enemyHit.get(e.id)
    const hitMs = hit ? now - hit.t0 : -1
    animateMonster(v.rig, t + e.id * 0.9, moving, atk === undefined ? -1 : now - atk, hitMs)
    // 맞은 순간 하얗게 달아올랐다 식는다 — 부감 거리에서 "맞았다"를 읽게 하는 주력 장치
    setFlash(v.rig.mats, hitMs >= 0 && hitMs < FLASH_MS ? 0.9 * (1 - hitMs / FLASH_MS) : 0)
    if (hit && now - hit.t0 > HIT_REACT_MS) enemyHit.delete(e.id)
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
  syncScene(now)
  updateAimLines()
  composer.render()
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

// 자동 검증 훅 — headless 스크린샷 테스트가 sim을 빨리감기(결정론이라 안전).
// FX 이벤트는 버리고 상태만 전진한다. 게임 플레이 입력 경로와 무관.
;(window as unknown as Record<string, unknown>).__siege = {
  // 게터 — 재시작하면 state가 새 객체로 갈아끼워지므로 스냅샷을 잡아두면 안 된다
  get state() {
    return state
  },
  restart: resetGame,
  fastForward: (n: number, input: SiegeInput = {}): void => {
    stepSiege(state, spawns, input)
    for (let i = 1; i < n; i++) stepSiege(state, spawns, {})
    snapshotPrev()
  },
  // 톤 그레이딩 라이브 조절 — 색감은 말로 합의가 안 되므로 빌드 없이 수치를 만져보는 개발 훅.
  // 예) __siege.grade.u.saturation.value = 1.0 / __siege.grade.exposure(1.3)
  grade: {
    u: grade.uniforms,
    exposure: (v: number): void => {
      renderer.toneMappingExposure = v
    },
  },
  // 성능 계측용 핸들 — 그림자 패스/배경/캐릭터의 몫을 따로 끄고 재보기 위해서만 쓴다.
  dbg: { scene, renderer, sun, composer },
  // 성능 계측 훅 — fps만으로는 원인(드로우콜인지 fill-rate인지)을 못 가른다.
  perf: (): Record<string, number> => ({
    calls: renderer.info.render.calls,
    tris: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    programs: renderer.info.programs?.length ?? 0,
    resScale,
    enemies: state.enemies.length,
  }),
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  composer.setSize(window.innerWidth, window.innerHeight)
})
