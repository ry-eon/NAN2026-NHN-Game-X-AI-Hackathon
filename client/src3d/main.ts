// 농성전 3D 렌더러 (M1 뼈대) — three.js.
// sim(siege/sim/world.ts)은 렌더링을 모른다. 여기는 상태를 그리고 입력을 모을 뿐.

import * as THREE from 'three'
import {
  CASTLE,
  FIELD,
  LORD_SKILLS,
  MAGE_SKILLS,
  SEGMENTS,
  createSiege,
  heightNear,
  isCrewManned,
  manningMap,
  mountPoint,
  stepSiege,
  TICKS_PER_SECOND,
} from '../../siege/sim/world'
import type { FriendlyUnit, SiegeEvent, SiegeInput, SkillDef } from '../../siege/sim/world'
// 봇의 표준 장착 수순을 B(자동 장착) 매크로가 그대로 쓴다 — 순수 함수라 렌더 계층에서 안전
import { deployPrep } from '../../siege/bots/policy'
import { Sfx, type SfxName } from './audio'
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
  makeLord,
  makeMage,
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
// fps를 보고 내부 렌더 스케일을 0.7~1.0 사이에서 자동 조절 (RTS라 약간 소프트해도 무방)
// 상한 1.0: 1.5 슈퍼샘플링은 Retina(DPR 2)에서 시작부터 fill 폭탄이었다 —
// 2026-08-06 계측에서 스케일 1.0=42fps, 0.7=60fps로 fill-rate bound 확인.
const RES_MAX = Math.min(window.devicePixelRatio, 1.0)
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
// 성주 — 갑옷 없는 귀족 예복 별도 조형 (2026-08-09 사용자: "귀족 복장, 갑옷 없는 버전").
// 더블릿·부츠·하이칼라·맨틀·왕관·확장 케이프·지휘봉 — 전장의 유일한 비무장 실루엣
const lordRig = makeLord()
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
/** 병종 → 발사음. 없으면 화살음으로 대체 (프리셋으로 새 병종을 넣어도 소리는 난다) */
const SFX_BY_UNIT: Record<string, SfxName> = {
  cannon: 'cannon',
  ballista: 'ballista',
  soldier: 'arrow',
  hero: 'heroSwing',
}
const _sfxFwd = new THREE.Vector3() // 매 프레임 카메라 방향 — 할당 없이 재사용

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
const mountedPrev = new Map<number, boolean>() // 병기별 직전 장착 상태 — 장착 성사 펄스 트리거용

// 아군 유닛 비주얼 풀 — 병종별 절차 모델. 그룹→유닛 id 역참조는 피킹에 사용
interface UnitVisual {
  group: THREE.Group
  rig?: Rig // 사람(궁수·수비병·영웅)
  weapon?: WeaponRig // 병기 본체 — 발사 반동
  mats: THREE.Material[] // 개체 전용 머티리얼 — 피격 플래시·소멸 페이드
  kind: string
  /** 조작 필요 병기 전용 — 미장착 표시 링 (장착되면 숨김) */
  mountRing?: THREE.Mesh
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

function ensureUnitVisual(u: FriendlyUnit): UnitVisual {
  let v = unitVisuals.get(u.id)
  if (v) return v
  if (u.kind === 'soldier') {
    // 궁수 — 활·화살통 실루엣, 녹갈색 천
    const rig = makeKnight(0x3a4a2e, false, true)
    rig.root.scale.setScalar(0.88)
    v = { group: rig.root, rig, mats: rig.mats, kind: u.kind }
  } else if (u.kind === 'guard') {
    // 수비병 — 병기에서 내려온 조작 병사. 활이 없는 근접 실루엣(강철빛)이라
    // 성벽 위 궁수·병기와 한눈에 갈린다
    const rig = makeKnight(0x6a6f7a, false, false)
    rig.root.scale.setScalar(0.94)
    v = { group: rig.root, rig, mats: rig.mats, kind: u.kind }
  } else if (u.kind === 'hero' || u.kind === 'mage') {
    // 영웅 2종 — 전사(판금 기사 + 뽑아 든 검) / 마법사(전신 로브 별도 조형 + 화염 지팡이).
    // 마법사는 기사 몸체 재사용이 아니라 makeMage — "갑옷이 동일하다" 반려(2026-08-09) 반영
    const isMage = u.kind === 'mage'
    const rig = isMage ? makeMage() : makeKnight(0x1d4e8c, true, false, { held: 'sword' })
    rig.root.scale.setScalar(isMage ? 1.08 : 1.15)
    rig.root.add(
      makeNameplate(state.kinds.units[u.kind]!.name, isMage ? '#ff9d5c' : '#ffd870').translateY(2.5),
    )
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.74, 28),
      new THREE.MeshBasicMaterial({
        color: isMage ? 0xd05a2a : 0xd8a832, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false,
      }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.05
    rig.root.add(ring)
    v = { group: rig.root, rig, mats: rig.mats, kind: u.kind }
  } else {
    // 병기: 본체 머티리얼은 개체 사본 (피격 플래시·소멸 페이드가 개체 단위로 걸리게).
    // 구 장식 조작병(attachCrew)은 장착제(2026-08-08)로 제거 — 조작하는 병사는 이제
    // sim의 실제 수비병 유닛이고, 붙어 있는 가짜 병사는 "움직이지도 쏘지도 않는 잔재"였다.
    const weapon = u.kind === 'cannon' ? makeCannon() : makeBallista()
    const weaponMats = ownMaterials(weapon.group)
    v = { group: weapon.group, weapon, mats: weaponMats, kind: u.kind }
    // 미장착 링 — "이 병기는 아직 안 쏜다"를 바닥에 그린다. 장착 확인이 발사 말고는
    // 없다는 피드백(2026-08-08)으로 추가: 준비 단계 배치 확인 + 전투 중 이탈 경보.
    if (state.kinds.units[u.kind]?.crew) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.05, 1.32, 28),
        new THREE.MeshBasicMaterial({
          color: 0xd8dee8, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false,
        }),
      )
      ring.material.userData.owned = true // 개체 전용 — 재시작 시 disposeTree가 회수하게
      ring.rotation.x = -Math.PI / 2
      ring.position.y = 0.07
      weapon.group.add(ring)
      v.mountRing = ring
    }
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

// 스킬 조준 레티클 (원신식 — 반경이 그대로 보인다). 반경 1로 만들고 스킬별로 스케일한다
const aimReticle = new THREE.Group()
{
  // 레티클도 벽 너머로 보인다 — 성벽 뒤 지점을 겨눌 때 가려지면 조준이 불가능하다
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.94, 1.0, 48),
    new THREE.MeshBasicMaterial({
      color: 0xff7a3a, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
      depthWrite: false, depthTest: false,
    }),
  )
  ring.renderOrder = 998
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(1.0, 48),
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
  // 시전자 → 착탄점 연결선 (조준 중에만). **사거리 원은 폐지** [2026-08-09 확정]:
  // 반경 14짜리 얇은 원이 높이 11 성벽을 가로지르면 어느 높이에 그리든 화면에서는
  // 조각난 호로만 보인다(시전자 평면=공중에 뜸 / 지면=시전자와 끊김 — 5회 반복 실패).
  // 사거리 정보는 **레티클이 경계에서 멈추는 것**으로 전달하고(clampToRange), 여기서는
  // "누가 어디에 쏘는가"만 한 줄로 잇는다 — 원기둥을 2D로 그리려던 시도 자체를 접었다.
  if (aiming && aimingCast) {
    const c = state.units.find((u) => u.id === aimingCast!.casterId)
    if (c) {
      const pos = castLineGeo.getAttribute('position') as THREE.BufferAttribute
      pos.setXYZ(0, c.pos.x, c.h + 1.3, c.pos.z)
      pos.setXYZ(1, aimReticle.position.x, aimReticle.position.y + 0.1, aimReticle.position.z)
      pos.needsUpdate = true
      castLineGeo.computeBoundingSphere()
      castLine.visible = true
    }
  } else {
    castLine.visible = false
  }
}
// 스킬 조준 상태 (QWE 개편 2026-08-08) — 지점 스킬만 레티클 조준, 자기 중심·버프는 즉발
// ---- 스킬 전용 이펙트 헬퍼 (2026-08-09 "이펙트가 다 같다" 반려 — 스킬마다 고유 형태)

/** 링 — pulse: 반경까지 확장 소멸(타격 순간) / boundary: 실제 효과 반경에 지속(장판·버프 영역) */
function spawnSkillRing(
  x: number, z: number, y: number, radius: number, color: number, durMs: number,
  mode: 'pulse' | 'boundary' = 'pulse',
  follow?: () => { x: number; y: number; z: number }, // 성주 오라 — 링이 시전자를 따라간다
): void {
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false,
  })
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.0, 48), mat)
  ring.rotation.x = -Math.PI / 2
  ring.position.set(x, y, z)
  scene.add(ring)
  const t0 = performance.now()
  const anim = (): void => {
    const t = performance.now() - t0
    const k = t / durMs
    if (k >= 1) {
      scene.remove(ring)
      ring.geometry.dispose()
      mat.dispose()
      return
    }
    if (follow) {
      const f = follow()
      ring.position.set(f.x, f.y, f.z)
    }
    if (mode === 'pulse') {
      ring.scale.setScalar(radius * (0.3 + 0.7 * k))
      mat.opacity = 0.85 * (1 - k)
    } else {
      ring.scale.setScalar(radius)
      // 은은한 맥동, 마지막 15%에서 페이드 — "아직 유효하다"가 읽히게
      mat.opacity = k > 0.85 ? 0.5 * ((1 - k) / 0.15) : 0.32 + 0.16 * Math.sin(t * 0.006)
    }
    requestAnimationFrame(anim)
  }
  anim()
}

/** 회전 검기 아크 — 시전자 둘레를 한 바퀴 도는 강철빛 호 (회전베기 전용) */
function spawnSlashArc(x: number, z: number, y: number, radius: number): void {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xdfe8ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false,
  })
  const arc = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.06, 6, 26, Math.PI * 1.2), mat)
  arc.rotation.x = -Math.PI / 2
  arc.position.set(x, y, z)
  scene.add(arc)
  const t0 = performance.now()
  const anim = (): void => {
    const k = (performance.now() - t0) / 340
    if (k >= 1) {
      scene.remove(arc)
      arc.geometry.dispose()
      mat.dispose()
      return
    }
    arc.rotation.z = k * Math.PI * 2.2 // 한 바퀴 이상 휘두른다
    mat.opacity = 0.9 * (1 - k * k)
    requestAnimationFrame(anim)
  }
  anim()
}

/** 돌진 잔상 — 출발점→도착점을 잇는 빛나는 세로 리본 (돌진 전용) */
function spawnDashTrail(x0: number, z0: number, x1: number, z1: number, y: number): void {
  const dx = x1 - x0
  const dz = z1 - z0
  const len = Math.hypot(dx, dz)
  if (len < 0.5) return
  const mat = new THREE.MeshBasicMaterial({
    color: 0xbfd8ff, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false,
  })
  const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.0), mat)
  ribbon.position.set((x0 + x1) / 2, y, (z0 + z1) / 2)
  ribbon.rotation.y = Math.atan2(-dz, dx)
  scene.add(ribbon)
  const t0 = performance.now()
  const anim = (): void => {
    const k = (performance.now() - t0) / 320
    if (k >= 1) {
      scene.remove(ribbon)
      ribbon.geometry.dispose()
      mat.dispose()
      return
    }
    mat.opacity = 0.75 * (1 - k)
    ribbon.scale.y = 1 - k * 0.6
    requestAnimationFrame(anim)
  }
  anim()
}

let aiming = false
let aimingCast: { casterId: number; slot: number; def: SkillDef } | null = null
let pendingCast: { casterId?: number; slot: number; x?: number; z?: number } | undefined

// 시전 사거리 원 — 조준 중 시전자 둘레에 그린다. "어디까지 닿는지"가 안 보이면
// 사거리 제한이 버그처럼 느껴진다 (2026-08-09 "시전되는 곳이 정해져 있는 것 같다")
/**
 * 시전 사거리 원 — **지형을 타고 도는** 폴리라인 (2026-08-09 재수정).
 * 평면 링을 depthTest off로 그렸더니 성벽을 뚫고 공중에 뜬 띠로 보였다("범위 표시와
 * 실제 범위가 다르다"). 이제 96점마다 그 지점의 지형 높이를 찍어 벽 위로는 올라타고
 * 안뜰·평지에서는 바닥에 붙는다 — 원이 지면에 그려진 것으로 읽힌다.
 */
// LineSegments인 이유: 원이 성벽을 넘는 지점에서 지형 높이가 0↔11로 뛰는데, 이어진
// 선(LineStrip)이면 그 두 점을 잇는 **수직선**이 화면을 가로질러 "가끔 선이 이상해진다"가
// 된다 (2026-08-09 사용자 실측). 구간별로 끊어 그리고 높이 점프 구간은 아예 생략한다.
// 시전 연결선 — 시전자 가슴에서 착탄점까지 한 줄. 사거리 원을 대신하는 표시로,
// "이 스킬은 저 사람이 저기에 쏜다"만 말한다 (원기둥을 2D로 그리려는 시도는 폐지)
const castLineGeo = new THREE.BufferGeometry()
castLineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2 * 3), 3))
const castLine = new THREE.Line(
  castLineGeo,
  new THREE.LineBasicMaterial({
    color: 0xffb060, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false,
  }),
)
castLine.renderOrder = 998
castLine.frustumCulled = false
castLine.visible = false
scene.add(castLine)

/** 클릭 지점을 시전 사거리 안으로 클램프 (LoL 관례) — 사거리 밖 클릭도 무시하지 않고
 *  최대 사거리 지점에 시전한다. sim 검증은 그대로 통과하므로 리플레이 안전 */
function clampToRange(p: { x: number; z: number; h?: number }): { x: number; z: number; h?: number } {
  if (!aimingCast) return p
  const caster = state.units.find((u) => u.id === aimingCast!.casterId)
  if (!caster) return p
  const dx = p.x - caster.pos.x
  const dz = p.z - caster.pos.z
  const d = Math.hypot(dx, dz)
  const r = aimingCast.def.range - 0.05 // 경계 부동소수 오차 여유
  if (d <= r) return p
  return { x: caster.pos.x + (dx / d) * r, z: caster.pos.z + (dz / d) * r, h: p.h }
}

// ---------------------------------------------------------------- 입력 (LoL식)
let spaceLatch = false
let muted = false
window.addEventListener('keydown', (e) => {
  // 브라우저 정책상 사용자 제스처 전에는 오디오가 안 난다 — 첫 입력에서 연다
  Sfx.unlock()
  // Space: 준비 단계 = 침공 개시, 전투 중 = 성주 카메라 복귀 (LoL 관례 — Space는 내 캐릭터)
  if (e.code === 'Space') {
    if (state.status === 'prep') spaceLatch = true
    else camFollow = true
    e.preventDefault()
  }
  if (e.code === 'KeyM') muted = Sfx.toggleMute()
  if (e.code === 'KeyG') toggleCrewSelection()
  if (e.code === 'KeyA') enterAttackMove()
  if (e.code === 'KeyB') startAutoDeploy()
  if (e.code === 'KeyV') allMelee()
  // H = 홀드 (SC·LoL 공통 관례). 이 게임은 정지 시에만 사격하므로 홀드와 정지가 동치다
  if (e.code === 'KeyS' || e.code === 'KeyH') stopSelected()
})

// ---- 조작 액션 (키보드·커맨드 카드 버튼 공용 — 규칙이 두 벌 되지 않게 함수를 공유)

/** G — 선택한 병기의 조작 중인 수비병을 선택으로 전환 (그다음 우클릭으로 빼거나 되돌린다).
 *  병사가 선택돼 있으면 반대로 지금 조작 중인 병기를 선택 — 쌍을 오가는 토글.
 *  장착제(2026-08-08): 고정 짝이 없으므로 "쌍"은 지금 이 순간의 동적 배정(manningMap)이다. */
function toggleCrewSelection(): void {
  if (selected.size === 0) return
  const map = manningMap(state) // 병기 id → 조작 중 수비병 id
  const crews: number[] = []
  const weapons: number[] = []
  for (const id of selected) {
    const g = map.get(id)
    if (g !== undefined) crews.push(g)
    for (const [w, gid] of map) if (gid === id) weapons.push(w)
  }
  const next = crews.length > 0 ? crews : weapons
  if (next.length > 0) {
    selected.clear()
    for (const id of next) selected.add(id)
  }
}

/** F2 — 전군 선택 (SC2 관례) */
function selectAllArmy(): void {
  selected.clear()
  for (const u of state.units) selected.add(u.id)
}

/** F1 — 영웅 선택 (전사 ↔ 마법사 순환 — SC의 영웅 탭 관례) */
function selectHero(): void {
  const heroes = state.units.filter((u) => state.kinds.units[u.kind]?.skills)
  if (heroes.length === 0) return
  const curIdx = heroes.findIndex((h) => selected.size === 1 && selected.has(h.id))
  const next = heroes[(curIdx + 1) % heroes.length]!
  selected.clear()
  selected.add(next.id)
}

/** 현재 QWE의 시전자 — 선택된 영웅(낮은 id) 우선, 없으면 선택된 성주(버프) */
function activeCaster(): { caster: FriendlyUnit | null; skills: SkillDef[] } | null {
  const hero = state.units
    .filter((u) => state.kinds.units[u.kind]?.skills && selected.has(u.id))
    .sort((a, b) => a.id - b.id)[0]
  if (hero) return { caster: hero, skills: state.kinds.units[hero.kind]!.skills! }
  if (selected.has(LORD_ID)) return { caster: null, skills: LORD_SKILLS }
  return null
}

/** Q/W/E — 스킬 시전. 지점 스킬은 레티클 조준 진입, 자기 중심·버프는 즉발 */
function castSlot(slot: number): void {
  const ac = activeCaster()
  if (!ac) return
  const def = ac.skills[slot]
  if (!def) return
  const cds = ac.caster ? ac.caster.cds : state.lord.cds
  if ((cds[slot] ?? 1) > 0) return
  if (def.targeted && ac.caster) {
    aiming = true
    aimingCast = { casterId: ac.caster.id, slot, def }
    aimReticle.scale.setScalar(def.radius)
    aimReticle.visible = true
  } else {
    pendingCast = ac.caster ? { casterId: ac.caster.id, slot } : { slot }
  }
}

/** 선택 중 이동 가능(비고정) 유닛 id */
function selectedMovers(): number[] {
  return [...selected].filter((id) => {
    const u = state.units.find((v) => v.id === id)
    return u && !state.kinds.units[u.kind]!.emplaced
  })
}

/** A — 어택땅 모드 진입: 다음 좌클릭 지점으로 이동하되 접적 시 멈춰 교전 */
let attackMove = false
function enterAttackMove(): void {
  if (selectedMovers().length === 0) return
  attackMove = true
  document.body.style.cursor = 'crosshair'
}
function cancelAttackMove(): void {
  attackMove = false
  document.body.style.cursor = ''
}

/** S — 정지: 경로를 버리고 그 자리에서 교전 태세 */
function stopSelected(): void {
  const ids = selectedMovers()
  if (ids.length > 0) pendingUnitStop = { ids }
}

// ---- 부대 매크로 (2026-08-08 사용자: "자동 세팅과 전체 백병전 단축키가 필요하다")

/** B — 자동 장착: deploy 봇과 **같은 수순**(deployPrep)을 스텝마다 흘려보낸다.
 *  봇 검증의 표준 장착과 플레이어의 원클릭 장착이 문자 그대로 동일한 커맨드 시퀀스다. */
let autoDeploy = false
function startAutoDeploy(): void {
  if (state.status === 'prep' || state.status === 'assault') autoDeploy = true
}

/** V — 총 백병전: 수비병 전원이 병기를 버리고 지상으로 내려가 교전한다(어택땅).
 *  침입자가 있으면 그쪽으로, 없으면 성문 안쪽 지상 집결. 최후 국면의 전환 스위치 */
function allMelee(): void {
  autoDeploy = false
  const crewKinds = new Set(
    Object.values(state.kinds.units).filter((d) => d.crew).map((d) => d.crew!),
  )
  const guards = state.units.filter((u) => crewKinds.has(u.kind))
  if (guards.length === 0) return
  const intruders = state.enemies.filter(
    (e) => e.mode === 'breach' && e.pos.x < CASTLE.east - CASTLE.wallT / 2,
  )
  const to = intruders.length > 0
    ? { x: intruders[0]!.pos.x, z: intruders[0]!.pos.z, h: 0 }
    : { x: CASTLE.east - CASTLE.wallT / 2 - 4, z: 0, h: 0 }
  pendingUnitMove = { ids: guards.map((g) => g.id), to, attack: true }
  showMoveMarker(to.x, to.z, 0, 0xff5a4a, 2.2)
}
window.addEventListener('pointerdown', () => Sfx.unlock())

// 부감 카메라: 남쪽에서 북쪽을 내려다봄 (서=성벽=왼쪽, 동=적=오른쪽). 휠 줌.
// 2026-08-06 사용자 지시로 자유 이동 추가 — "멀리서 오는 것도 스타/롤처럼 움직여서 보고 싶다".
// 기본은 성주 추적(camFollow), 가장자리 스크롤·화살표·미니맵 좌클릭이 추적을 풀고 C로 복귀.
let camDist = 26
let camFollow = true
const camPos = { x: -15, z: 2 } // 자유 모드의 시점 (지면 기준). follow 중엔 매 프레임 성주로 덮인다
let camY = 0 // 시점 높이 (성주가 성벽 위면 11) — 모드 전환 시 튀지 않게 보간
let camPrevT = performance.now()
const EDGE_PX = 18
let mouseX = -1
let mouseY = -1
let mouseIn = false
// 커서가 창 밖으로 나가도(듀얼 모니터) 팬을 끊지 않는다 — 브라우저는 커서를 화면에 가둘 수
// 없으므로, 나간 변의 띠로 좌표를 고정해 그 방향으로 계속 민다. 창모드 RTS의 표준 동작.
// 멈추는 조건은 blur(다른 앱/창 클릭) 또는 커서 복귀뿐.
document.documentElement.addEventListener('mouseleave', (e) => {
  if (e.clientX <= 0) mouseX = 0
  else if (e.clientX >= window.innerWidth - 1) mouseX = window.innerWidth - 1
  if (e.clientY <= 0) mouseY = 0
  else if (e.clientY >= window.innerHeight - 1) mouseY = window.innerHeight - 1
})
window.addEventListener('blur', () => (mouseIn = false))
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

/**
 * 스킬 조준 전용 픽킹 — **지면(y=0)만** 집는다.
 *
 * 일반 pickPoint는 구조물 윗면을 우선하는데(보도 위 이동 명령을 위해 필요하다), 스킬
 * 조준에 쓰면 성 안쪽 시점에서 **들판이 있어야 할 화면 영역을 성벽·성가퀴 윗면이 가로채**
 * 레티클이 벽 위로 튀어오른다 — 커서 격자 실측에서 절반 가까이가 '보도'로 찍혔다
 * ("1~3시 방향에 못 쓴다"의 나머지 절반, 2026-08-09).
 * 괴수는 항상 지면에 있으므로 스킬의 표적면은 지면 하나로 충분하고, 그래야 레티클이
 * 커서를 따라 **끊김 없이** 움직인다.
 */
function pickGround(clientX: number, clientY: number): { x: number; z: number; h: number } | null {
  const ndc = new THREE.Vector2(
    (clientX / window.innerWidth) * 2 - 1,
    -(clientY / window.innerHeight) * 2 + 1,
  )
  raycaster.setFromCamera(ndc, camera)
  const hit = new THREE.Vector3()
  if (raycaster.ray.intersectPlane(groundPlane, hit)) return { x: hit.x, z: hit.z, h: 0 }
  return null
}

/** 화면 좌표에서 병기(조작 병사가 필요한 병종) 픽킹 — 우클릭 장착 스냅용.
 *  병기 모델은 지형 픽킹(occluders)에 없어서, 이 스냅이 없으면 대포를 클릭해도
 *  "그 뒤 바닥"이 찍혀 수비병이 애매한 곳에 선다. */
function pickWeapon(clientX: number, clientY: number): FriendlyUnit | null {
  const ndc = new THREE.Vector2(
    (clientX / window.innerWidth) * 2 - 1,
    -(clientY / window.innerHeight) * 2 + 1,
  )
  raycaster.setFromCamera(ndc, camera)
  const groups = [...unitVisuals.values()].filter((v) => v.weapon).map((v) => v.group)
  const hits = raycaster.intersectObjects(groups, true)
  if (hits.length === 0) return null
  let obj: THREE.Object3D | null = hits[0]!.object
  while (obj && !groupToUnitId.has(obj.uuid)) obj = obj.parent
  if (!obj) return null
  const u = state.units.find((x) => x.id === groupToUnitId.get(obj!.uuid))
  return u && state.kinds.units[u.kind]?.crew ? u : null
}

// ---- 스타크래프트식 부대 선택 (좌클릭 드래그) + 명령 (우클릭)
let pendingMove: { x: number; z: number; h?: number } | undefined
let pendingUnitMove: { ids: number[]; to: { x: number; z: number; h?: number }; attack?: boolean } | undefined
let pendingUnitAim: { ids: number[]; to: { x: number; z: number } } | undefined
let pendingUnitStop: { ids: number[] } | undefined
const selected = new Set<number>()
// 성주도 선택 체계의 일원 (SC 관례 — 조작 가능한 개체는 전부 같은 선택·명령 규칙을 탄다).
// sim의 units에는 없으므로 클라이언트 선택 집합에서만 쓰는 전용 id.
// 게임은 성주 선택 상태로 시작 — 준비 단계의 첫 우클릭이 그대로 성주 이동이 된다.
const LORD_ID = -1
selected.add(LORD_ID)
let inspectedEnemy: number | null = null // 클릭 조사 대상 (상태창)
let lastClickUnit = -1 // 더블클릭 판정
let lastClickTime = 0

const dragBox = document.createElement('div')
dragBox.style.cssText =
  'position:fixed;border:1px solid #53d6a2;background:#53d6a222;pointer-events:none;display:none;z-index:5'
document.body.appendChild(dragBox)
let dragStart: { x: number; y: number } | null = null

renderer.domElement.addEventListener('pointerdown', (e) => {
  // 스킬 조준 중: 좌클릭 = 시전, 우클릭 = 취소 (드래그 선택·이동 명령은 봉인)
  if (aiming) {
    if (e.button === 0 && aimingCast) {
      const raw = pickGround(e.clientX, e.clientY) // 조준은 지면만 — 성벽 윗면에 스냅되지 않게
      if (raw) {
        const p = clampToRange(raw) // 사거리 밖 클릭 → 최대 사거리 지점 시전
        pendingCast = { casterId: aimingCast.casterId, slot: aimingCast.slot, x: p.x, z: p.z }
      }
    }
    aiming = false
    aimingCast = null
    aimReticle.visible = false
    castLine.visible = false
    return
  }
  // 어택땅 모드: 좌클릭 = 접적 이동 명령, 우클릭 = 취소 (SC 관례)
  if (attackMove) {
    if (e.button === 0) {
      const p = pickPoint(e.clientX, e.clientY)
      const ids = selectedMovers()
      if (p && ids.length > 0) {
        pendingUnitMove = { ids, to: p, attack: true }
        showMoveMarker(p.x, p.z, p.h, 0xff5a4a) // 어택땅은 적색 — 이동(녹)·조준(주황)과 구분
      }
    }
    cancelAttackMove()
    return
  }
  if (e.button === 0) {
    dragStart = { x: e.clientX, y: e.clientY }
    return
  }
  if (e.button !== 2) return
  // 우클릭: 선택 부대가 있으면 부대 명령. 병기를 직접 우클릭하면 명령 지점을
  // 그 병기의 **조작 위치**로 스냅한다 — 수비병 장착이 "병사 선택 → 병기 우클릭"이 되게.
  const w = pickWeapon(e.clientX, e.clientY)
  const p = w ? mountPoint(w) : pickPoint(e.clientX, e.clientY)
  if (!p) return
  issueCommand(p, w !== null)
})

// 우클릭 명령 공통 — 화면 클릭과 미니맵 클릭이 같은 의미를 갖는다.
// SC 관례: 빈 선택의 우클릭은 명령이 아니다 (구 "선택 없으면 성주 이동" 폴백은
// 성주 단일 조작 시절의 잔재라 2026-08-07 폐지 — 성주도 선택해서 명령한다)
function issueCommand(p: { x: number; z: number; h?: number }, mountSnap = false): void {
  if (selected.size === 0) return
  // 고정 병기(대포·발리스타)는 못 옮긴다 — 같은 우클릭이 **조준 명령**이 된다.
  // 한 번의 명령으로 성주·보행·병기가 섞여도 각자 맞는 쪽으로 간다.
  const guns: number[] = []
  const movers: number[] = []
  for (const id of selected) {
    const u = state.units.find((v) => v.id === id)
    if (!u) continue
    ;(state.kinds.units[u.kind]?.emplaced ? guns : movers).push(id)
  }
  if (selected.has(LORD_ID)) pendingMove = p
  if (guns.length > 0) {
    pendingUnitAim = { ids: guns, to: { x: p.x, z: p.z } }
    showMoveMarker(p.x, p.z, p.h, 0xffb347) // 조준은 주황 — 이동(녹색)과 구분
  }
  if (movers.length > 0 || selected.has(LORD_ID)) {
    if (movers.length > 0) pendingUnitMove = { ids: movers, to: p }
    // 병기 우클릭 장착 스냅은 금색 — "이동"이 아니라 "장착하러 간다"로 읽히게
    if (guns.length === 0) showMoveMarker(p.x, p.z, p.h, mountSnap ? 0xffd870 : 0x53d6a2, mountSnap ? 1.8 : 1)
  }
}

window.addEventListener('pointermove', (e) => {
  mouseX = e.clientX
  mouseY = e.clientY
  mouseIn = true
  if (aiming) {
    const raw = pickGround(e.clientX, e.clientY) // 조준은 지면만 (성벽 윗면 스냅 방지)
    if (raw && aimingCast) {
      // 레티클도 클램프된 실제 시전 지점을 보여준다 — 커서가 밖이어도 "여기에 떨어진다".
      // 높이는 **클램프된 xz의 지형**으로 재계산 — 클릭 지점 높이를 그대로 쓰면 성벽 위를
      // 겨눴다 클램프될 때 레티클이 공중에 뜬다 ("위쪽은 마우스 이동이 안 된다" 2026-08-09)
      const p = clampToRange(raw)
      const clamped = p !== raw // 커서가 사거리 밖 → 레티클이 경계에 물려 더 안 나간다
      const y = heightNear(p.x, p.z, 0) // 지면 픽킹이므로 표시 높이는 그 자리 지형으로
      aimReticle.position.set(p.x, y + 0.08, p.z)
      // 경계에 물리면 색이 바뀐다 — 사거리 원 없이 한계를 알리는 유일한 신호라 분명해야 한다
      for (const c of aimReticle.children)
        ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(clamped ? 0xffd050 : 0xff7a3a)
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
        // 더블클릭·Ctrl+클릭 = 같은 병종 전체 (SC 관례) · Shift+클릭 = 추가/제외 토글
        const now = performance.now()
        if (e.ctrlKey || e.metaKey || (id === lastClickUnit && now - lastClickTime < 350)) {
          const kind = state.units.find((u) => u.id === id)?.kind
          for (const u of state.units) if (u.kind === kind) selected.add(u.id)
        } else if (e.shiftKey && selected.has(id)) {
          selected.delete(id)
        } else {
          selected.add(id)
        }
        lastClickUnit = id
        lastClickTime = now
      }
      return
    }
    // 성주 픽킹 — 아군 유닛과 같은 규칙 (선택 → 우클릭 이동)
    if (raycaster.intersectObject(lordMesh, true).length > 0) {
      if (e.shiftKey && selected.has(LORD_ID)) selected.delete(LORD_ID)
      else selected.add(LORD_ID)
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
  // 성주도 박스에 든다 — 부대와 성주를 한 번에 끌어 같이 명령할 수 있게
  {
    const p = new THREE.Vector3(state.lord.pos.x, state.lord.h + 1, state.lord.pos.z).project(camera)
    const sx = ((p.x + 1) / 2) * window.innerWidth
    const sy = ((1 - p.y) / 2) * window.innerHeight
    if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1 && p.z < 1) selected.add(LORD_ID)
  }
})

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    selected.clear()
    inspectedEnemy = null
    aiming = false
    aimingCast = null
    aimReticle.visible = false
    castLine.visible = false
    cancelAttackMove()
  }
})

// 컨트롤 그룹 (스타크래프트식): Ctrl+1~9 = 지정, Shift+1~9 = 추가 지정, 1~9 = 호출
const ctrlGroups = new Map<number, number[]>()
function groupOf(id: number): number | null {
  for (const [slot, ids] of ctrlGroups) if (ids.includes(id)) return slot
  return null
}
window.addEventListener('keydown', (e) => {
  const m = /^Digit([1-9])$/.exec(e.code)
  if (!m) return
  const slot = Number(m[1])
  if (e.ctrlKey || e.metaKey) {
    // 지정은 배타 — 한 유닛은 한 그룹에만 속한다 (SC 관례, 뱃지도 하나만 그린다)
    for (const [s, ids] of ctrlGroups) ctrlGroups.set(s, ids.filter((id) => !selected.has(id)))
    ctrlGroups.set(slot, [...selected])
    selPanelKey = '' // 칩 그룹 뱃지 즉시 갱신
    e.preventDefault()
  } else if (e.shiftKey) {
    const cur = ctrlGroups.get(slot) ?? []
    for (const [s, ids] of ctrlGroups)
      if (s !== slot) ctrlGroups.set(s, ids.filter((id) => !selected.has(id)))
    ctrlGroups.set(slot, [...new Set([...cur, ...selected])])
    selPanelKey = ''
  } else {
    const ids = ctrlGroups.get(slot)
    if (!ids || ids.length === 0) return
    selected.clear()
    for (const id of ids) if (id === LORD_ID || state.units.some((u) => u.id === id)) selected.add(id)
  }
})

// 전군/영웅/카메라: F2 = 전군 (SC2 관례), F1 = 영웅 (LoL 관례 — F1은 내 챔피언), C = 성주 카메라
// H는 영웅 선택에서 홀드로 반납 — SC·LoL 근육기억(H=홀드)과 충돌했다 (2026-08-07)
window.addEventListener('keydown', (e) => {
  if (e.code === 'F2') {
    selectAllArmy()
    e.preventDefault()
  }
  if (e.code === 'F1') {
    selectHero()
    e.preventDefault()
  }
  if (e.code === 'KeyC') camFollow = true
})

// 화살표 키 팬 (SC식) — 카메라 로직은 frame()에서 소비
const keysPan = new Set<string>()
window.addEventListener('keydown', (e) => {
  if (e.code.startsWith('Arrow')) {
    keysPan.add(e.code)
    e.preventDefault()
  }
})
window.addEventListener('keyup', (e) => keysPan.delete(e.code))

window.addEventListener('keydown', (e) => {
  // 재시작은 판이 끝난 뒤에만 — 전투 중 오타로 판이 날아가면 안 된다
  if (e.code === 'KeyR' && (state.status === 'won' || state.status === 'lost')) {
    resetGame()
    return
  }
  // Q/W/E — 선택된 영웅(전사·마법사)/성주의 스킬 (2026-08-08 개편, 구 E=업화·T=자동조준 폐지)
  if (e.code === 'KeyQ') castSlot(0)
  if (e.code === 'KeyW') castSlot(1)
  if (e.code === 'KeyE') castSlot(2)
})

// 이동 마커 (LoL식 클릭 링) — 성주 초록, 부대 명령 청록
function showMoveMarker(x: number, z: number, y = 0.05, color = 0x62c462, scale = 1): void {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.4 * scale, 0.6 * scale, 24),
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
  <div style="position:absolute;top:14px;left:16px;font-size:18px;font-weight:bold">최후의 벽, 최후의 사람 (M1)</div>
  <div style="position:absolute;top:44px;left:16px;font-size:13px">
    성벽 <span id="wall"></span><div style="width:280px;height:10px;background:#000a;margin-top:3px"><div id="wallbar" style="height:100%;width:100%;background:#62c462"></div></div>
  </div>
  <div id="phase" style="position:absolute;top:14px;left:50%;transform:translateX(-50%);font-size:15px;color:#ffd870"></div>
  <div id="army" style="position:absolute;top:78px;left:16px;font-size:12px;color:#9fc4a8"></div>
  <div id="fps" style="position:absolute;top:14px;right:16px;font-size:12px;color:#88a088"></div>
  <!-- SC식 하단 컨트롤 바 — 전폭 통합 패널: 미니맵 ‖ 영웅 ‖ 선택/상세 ‖ 커맨드 카드 -->
  <div id="bottombar" style="position:absolute;left:0;right:0;bottom:0;height:178px;
       background:linear-gradient(180deg,#131a24e8 0%,#0c1119f6 28%,#090d13fc 100%);
       border-top:1px solid #33445c;box-shadow:0 -10px 28px #000a;pointer-events:auto;
       display:flex;align-items:stretch;padding:12px 16px;box-sizing:border-box">
    <div style="align-self:center">
      <div style="font-size:10px;color:#5a708c;letter-spacing:2px;margin:0 0 4px 1px">전황</div>
      <canvas id="minimap" width="190" height="132" style="display:block;background:#0a0e14;
           border:1px solid #3a4a5e;border-radius:3px"></canvas>
      <div style="margin-top:5px;display:flex;gap:5px">
        <div id="btn-army" style="flex:1;cursor:pointer;text-align:center;font-size:11px;
             background:#131b26d8;border:1px solid #3a4a5e;border-radius:4px;padding:4px 0;color:#cfe0f0;
             user-select:none">전군 <b>F2</b></div>
        <div id="btn-hero" style="flex:1;cursor:pointer;text-align:center;font-size:11px;
             background:#131b26d8;border:1px solid #3a4a5e;border-radius:4px;padding:4px 0;color:#cfe0f0;
             user-select:none">영웅 <b>F1</b></div>
      </div>
      <div style="margin-top:5px;display:flex;gap:5px">
        <div id="btn-deploy" style="flex:1;cursor:pointer;text-align:center;font-size:11px;
             background:#13261bd8;border:1px solid #3a5e4a;border-radius:4px;padding:4px 0;color:#cff0e0;
             user-select:none">자동 장착 <b>B</b></div>
        <div id="btn-melee" style="flex:1;cursor:pointer;text-align:center;font-size:11px;
             background:#261613d8;border:1px solid #5e3f3a;border-radius:4px;padding:4px 0;color:#f0d5cf;
             user-select:none">총 백병전 <b>V</b></div>
      </div>
    </div>
    <div style="width:1px;background:#232f40;margin:4px 16px"></div>
    <div id="herobar" style="display:flex;gap:8px;align-items:flex-end;align-self:flex-end"></div>
    <div style="flex:1;display:flex;align-items:center;justify-content:center;gap:16px;min-width:0;padding:0 10px">
      <div id="selhint" style="color:#3d4c60;font-size:12px;letter-spacing:1px">
        드래그로 부대 선택 · 우클릭 이동/조준 · <b>A</b> 어택땅</div>
      <div id="selpanel" style="display:none">
        <div id="selcount" style="font-size:11px;color:#9fc4a8;margin-bottom:6px"></div>
        <div id="selgrid" style="display:flex;flex-wrap:wrap;gap:4px;max-width:470px"></div>
      </div>
      <div id="panel" style="width:205px;display:none;border-left:1px solid #232f40;
           padding-left:16px;font-size:12px;flex-shrink:0">
        <div id="p-name" style="font-size:14px;font-weight:bold;margin-bottom:5px"></div>
        <div id="p-hptext"></div>
        <div style="width:100%;height:8px;background:#0008;margin:3px 0 7px">
          <div id="p-hpbar" style="height:100%;background:#62c462"></div>
        </div>
        <div id="p-stats" style="color:#b8b8c8;line-height:1.6"></div>
      </div>
    </div>
    <div style="width:1px;background:#232f40;margin:4px 16px"></div>
    <div id="cmdwrap" style="align-self:center">
      <div style="font-size:10px;color:#5a708c;letter-spacing:2px;margin:0 0 4px 1px">명령</div>
      <div id="cmdcard" style="display:grid;grid-template-columns:repeat(3,72px);gap:5px"></div>
    </div>
  </div>
  <div style="position:absolute;top:100px;left:16px;font-size:11px;color:#8a8aa0;max-width:430px;line-height:1.7">
    드래그: 선택 — 성주 포함 (Shift 추가/제외 · Ctrl클릭/더블클릭: 같은 병종) · <b>Ctrl/Shift+1~9</b>: 부대 지정/추가 · <b>1~9</b>: 호출 ·
    우클릭: 이동/조준/장착 · <b>A</b>: 어택땅 · <b>S/H</b>: 정지 · <b>Q/W/E</b>: 스킬(영웅·성주) ·
    <b>B</b>: 자동 장착 · <b>V</b>: 총 백병전 · <b>F1</b>: 영웅 순환 · <b>F2</b>: 전군 ·
    <b>Space/C</b>: 성주 카메라 · ESC: 해제 · <b>M</b>: 음소거
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

// ---------------------------------------------------------------- 미니맵 (SC식)
// 카메라가 성주 고정 추적이라 미니맵의 역할은 화면 점프가 아니라 **전황 파악 + 원격 명령**이다.
// 우클릭 의미는 화면과 동일(issueCommand) — 조작 규칙이 두 개가 되지 않게 한다.
const miniCanvas = document.getElementById('minimap') as HTMLCanvasElement
const miniCtx = miniCanvas.getContext('2d')!
const miniX = (x: number) => ((x - FIELD.minX) / (FIELD.maxX - FIELD.minX)) * miniCanvas.width
const miniZ = (z: number) => ((z - FIELD.minZ) / (FIELD.maxZ - FIELD.minZ)) * miniCanvas.height

function miniToWorld(clientX: number, clientY: number): { x: number; z: number } {
  const r = miniCanvas.getBoundingClientRect()
  return {
    x: FIELD.minX + ((clientX - r.left) / r.width) * (FIELD.maxX - FIELD.minX),
    z: FIELD.minZ + ((clientY - r.top) / r.height) * (FIELD.maxZ - FIELD.minZ),
  }
}
let miniCamDrag = false
miniCanvas.addEventListener('pointerdown', (e) => {
  e.stopPropagation()
  const p = miniToWorld(e.clientX, e.clientY)
  if (e.button === 0) {
    // 좌클릭(+드래그) = 카메라 점프 (SC 관례) — 성주 추적이 풀린다, C로 복귀
    camFollow = false
    camPos.x = p.x
    camPos.z = p.z
    miniCamDrag = true
  } else if (e.button === 2) {
    issueCommand(p)
  }
})
window.addEventListener('pointermove', (e) => {
  if (!miniCamDrag || !(e.buttons & 1)) return
  const p = miniToWorld(e.clientX, e.clientY)
  camPos.x = Math.max(FIELD.minX, Math.min(FIELD.maxX, p.x))
  camPos.z = Math.max(FIELD.minZ, Math.min(FIELD.maxZ, p.z))
})
window.addEventListener('pointerup', () => (miniCamDrag = false))

// ---------------------------------------------------------------- 커맨드 카드 (SC식)
// SC의 조직 원리: **카드 = 현재 선택이 할 수 있는 일**. 유닛 명령만 올라온다 —
// 전군/영웅 같은 선택 유틸과 카메라는 명령이 아니므로 카드 밖(키·미니맵 옆)이다.
// 슬롯 위치는 고정(근육기억), 해당 없는 명령은 흐려진다, 빈 선택이면 카드 자체가 없다.
// 키보드와 같은 함수를 호출한다 — 버튼과 단축키의 동작이 갈라질 수 없다.
const CMD_BUTTONS: Array<{ id: string; label: string; key: string; fn: () => void }> = [
  { id: 'cmd-a', label: '어택', key: 'A', fn: enterAttackMove },
  { id: 'cmd-s', label: '정지', key: 'S·H', fn: stopSelected },
  { id: 'cmd-g', label: '병사', key: 'G', fn: toggleCrewSelection },
  // Q/W/E — 스킬 3슬롯 (2026-08-08 개편). 라벨은 선택된 시전자의 스킬 이름으로 매 프레임 갱신
  { id: 'cmd-q', label: 'Q', key: 'Q', fn: () => castSlot(0) },
  { id: 'cmd-w', label: 'W', key: 'W', fn: () => castSlot(1) },
  { id: 'cmd-e', label: 'E', key: 'E', fn: () => castSlot(2) },
]
{
  const card = document.getElementById('cmdcard')!
  for (const b of CMD_BUTTONS) {
    const btn = document.createElement('div')
    btn.id = b.id
    btn.style.cssText =
      'cursor:pointer;text-align:center;background:#131b26d8;border:1px solid #3a4a5e;border-radius:5px;' +
      'padding:7px 0 6px;font-family:monospace;color:#cfe0f0;user-select:none'
    btn.innerHTML = `<div class="lbl" style="font-size:13px;font-weight:bold">${b.label}</div>
      <div style="font-size:10px;color:#7d94ad;margin-top:2px">${b.key}</div>`
    btn.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      if (e.button === 0) b.fn()
    })
    card.appendChild(btn)
  }
  // 선택 유틸 — 명령이 아니므로 카드 밖, 미니맵 아래 (키보드와 같은 함수)
  for (const [id, fn] of [
    ['btn-army', selectAllArmy],
    ['btn-hero', selectHero],
    ['btn-deploy', startAutoDeploy],
    ['btn-melee', allMelee],
  ] as const) {
    document.getElementById(id)!.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      if (e.button === 0) fn()
    })
  }
}

function drawMinimap(): void {
  const c = miniCtx
  c.clearRect(0, 0, miniCanvas.width, miniCanvas.height)
  // 성 윤곽 — 안뜰 채움 + 성벽 선. 동벽은 성문(gateHalf) 구간을 비워 그린다
  c.fillStyle = '#1c2530'
  c.fillRect(
    miniX(CASTLE.west), miniZ(CASTLE.north),
    miniX(CASTLE.east) - miniX(CASTLE.west), miniZ(CASTLE.south) - miniZ(CASTLE.north),
  )
  c.strokeStyle = '#7d8fa5'
  c.lineWidth = 2
  c.beginPath()
  c.moveTo(miniX(CASTLE.east), miniZ(CASTLE.north))
  c.lineTo(miniX(CASTLE.west), miniZ(CASTLE.north))
  c.lineTo(miniX(CASTLE.west), miniZ(CASTLE.south))
  c.lineTo(miniX(CASTLE.east), miniZ(CASTLE.south))
  c.moveTo(miniX(CASTLE.east), miniZ(CASTLE.north))
  c.lineTo(miniX(CASTLE.east), miniZ(-CASTLE.gateHalf))
  c.moveTo(miniX(CASTLE.east), miniZ(CASTLE.gateHalf))
  c.lineTo(miniX(CASTLE.east), miniZ(CASTLE.south))
  c.stroke()
  // 적 — 표준 적색, 네크로맨서(보스)는 자색으로 크게
  for (const en of state.enemies) {
    const boss = en.kind === 'necromancer'
    c.fillStyle = boss ? '#c07df5' : '#e05545'
    const s = boss ? 5 : 3
    c.fillRect(miniX(en.pos.x) - s / 2, miniZ(en.pos.z) - s / 2, s, s)
  }
  // 아군 — 녹색(조작 병사가 비운 병기는 회색), 영웅 금색, 선택은 흰 테두리
  for (const u of state.units) {
    const hero = state.kinds.units[u.kind]?.skills !== undefined
    const idle = state.kinds.units[u.kind]?.emplaced && !isCrewManned(state, u)
    c.fillStyle = hero ? (u.kind === 'mage' ? '#ff9d5c' : '#ffd870') : idle ? '#4a5a52' : '#53d6a2'
    const s = hero ? 5 : 3.5
    c.fillRect(miniX(u.pos.x) - s / 2, miniZ(u.pos.z) - s / 2, s, s)
    if (selected.has(u.id)) {
      c.strokeStyle = '#fff'
      c.lineWidth = 1
      c.strokeRect(miniX(u.pos.x) - s / 2 - 1, miniZ(u.pos.z) - s / 2 - 1, s + 2, s + 2)
    }
  }
  // 성주 — 흰 점
  c.fillStyle = '#fff'
  c.beginPath()
  c.arc(miniX(state.lord.pos.x), miniZ(state.lord.pos.z), 2.4, 0, Math.PI * 2)
  c.fill()
  // 카메라 시야 (SC식 뷰포트 사각형) — 어디를 보고 있는지, 얼마나 벗어났는지
  const vw = camDist * 0.95
  const vh = camDist * 0.72
  c.strokeStyle = '#ffffff88'
  c.lineWidth = 1
  c.strokeRect(miniX(camPos.x - vw), miniZ(camPos.z - vh), miniX(camPos.x + vw) - miniX(camPos.x - vw), miniZ(camPos.z + vh) - miniZ(camPos.z - vh))
}

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
function spawnProjectile(
  kind: string,
  targetId: number,
  from: THREE.Vector3,
  to: THREE.Vector3,
  flightMs = 0,
): void {
  const spec =
    kind === 'cannon'
      ? { geo: ballGeo, mat: ballMat, dur: 480, arc: 4.2, explode: true }
      : kind === 'ballista'
        ? { geo: boltGeo, mat: projMat, dur: 170, arc: 0.3, explode: false }
        : kind === 'hero'
          ? { geo: slashGeo, mat: slashMat, dur: 200, arc: 0.6, explode: false }
          : { geo: arrowGeo, mat: projMat, dur: 260, arc: 1.6, explode: false }
  // sim이 비행 시간을 확정한 병기는 그 시간에 맞춘다 — 연출이 sim보다 먼저·나중에
  // 터지면 "보이는 것"과 "일어난 일"이 어긋난다 (이 프로젝트에서 그건 버그다)
  if (flightMs > 0) spec.dur = flightMs
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
      // 근접 병종(전사·수비병)은 투사체를 날리지 않고 **표적 자리에서 베는 궤적**을 그린다.
      // 수비병은 화살 투사체 + 화살음으로 그려지고 있었다 — 칼을 든 병사인데 활을 쏘는 셈
      // (구 전사 검기 투사체와 같은 계열의 잔재, 2026-08-09 정리)
      if (ev.unitKind === 'hero' || ev.unitKind === 'guard') {
        const big = ev.unitKind === 'hero'
        spawnSlashArc(ev.to.x, ev.to.z, ev.from.h + 0.9, big ? 1.3 : 0.85)
        spawnFlash(new THREE.Vector3(ev.to.x, ev.from.h + 0.9, ev.to.z), big ? 0.9 : 0.6, 0xdfe8ff, 160)
        unitAttackT.set(ev.unitId, performance.now())
        Sfx.at(big ? 'heroSwing' : 'melee', ev.from.x, ev.from.z)
        continue
      }
      spawnProjectile(ev.unitKind, ev.targetId, from, new THREE.Vector3(ev.to.x, 0.7, ev.to.z), (ev.flight / TICKS_PER_SECOND) * 1000)
      // 발사 섬광 — 어디서 쏘는지 읽히게 (대포는 크게)
      spawnFlash(from.clone(), ev.unitKind === 'cannon' ? 2.4 : 0.8, 0xffdf9a, 200)
      unitAttackT.set(ev.unitId, performance.now()) // 사격 모션·병기 반동
      Sfx.at(SFX_BY_UNIT[ev.unitKind] ?? 'arrow', ev.from.x, ev.from.z)
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
      Sfx.at('enemyDie', ev.pos.x, ev.pos.z)
    } else if (ev.type === 'enemyRaised') {
      // 부활 — 잡았던 것이 다시 선다. 죽음(붉은 섬광)과 반대로 **차가운 보라**로 읽히게 해서
      // "내가 방금 죽인 게 일어났다"가 한눈에 구분되게 한다. 술사를 끊으라는 신호이기도 하다.
      spawnFlash(new THREE.Vector3(ev.pos.x, 0.9, ev.pos.z), 2.2, 0x9a5cff, 420)
      fx.smoke(ev.pos.x, 0.25, ev.pos.z, { count: 5, scale: 1.1, rise: 1.5, spread: 0.5, dur: 1100, tint: 0x3a2258, opacity: 0.55 })
      addTrauma(0.08, ev.pos.x, ev.pos.z)
      Sfx.at('raise', ev.pos.x, ev.pos.z)
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
      Sfx.at('unitDie', ev.pos.x, ev.pos.z)
    } else if (ev.type === 'skillCast') {
      // 스킬 9종 각자 고유 연출 (2026-08-09 "이펙트가 다 같다" 반려로 전면 분화).
      // 피해·판정은 sim이 이미 확정 — 여기는 그림·소리만. 형태 언어:
      //   전사 = 강철빛 궤적(리본·호·석분) / 마법사 = 화염 3단(팝→장판→기둥) / 성주 = 영역 링
      const caster = ev.casterId !== undefined ? state.units.find((x) => x.id === ev.casterId) : undefined
      const groundY = (caster?.h ?? 0) + 0.08
      if (ev.casterKind === 'mage') {
        // 시전 순간 지팡이 구슬 섬광 — "누가 쐈는지"가 스킬 낙하점만큼 중요하다
        if (caster) {
          spawnFlash(new THREE.Vector3(caster.pos.x, caster.h + 1.7, caster.pos.z), 1.3, 0xffb060, 260)
          spawnLight(new THREE.Vector3(caster.pos.x, caster.h + 1.8, caster.pos.z), 0xff8030, 14, 280)
        }
        if (ev.slot === 0) {
          // Q 화염구 — 빠른 화구 작렬: 순간 화염 + 팝. 기둥 없음 (속사감이 정체성)
          spawnFlash(new THREE.Vector3(ev.x, 1.2, ev.z), 3.4, 0xffa040, 320)
          spawnFlash(new THREE.Vector3(ev.x, 2.0, ev.z), 1.8, 0xfff0c0, 240)
          spawnLight(new THREE.Vector3(ev.x, 1.8, ev.z), 0xff8030, 44, 340)
          const puff = makeFire(0.9)
          puff.group.position.set(ev.x, 0.1, ev.z)
          scene.add(puff.group)
          fireCols.push({ fx: puff, t0: performance.now(), dur: 450 })
          spawnSkillRing(ev.x, ev.z, 0.1, ev.radius, 0xff8a30, 300)
          fx.debris(ev.x, 0.6, ev.z, { count: 8, speed: 5.5, kind: 'ember' })
          fx.smoke(ev.x, 0.8, ev.z, { count: 2, scale: 1.0, rise: 1.2, spread: 0.6, dur: 900, tint: 0x6b6259, opacity: 0.4 })
          addTrauma(0.18, ev.x, ev.z)
          Sfx.at('fireball', ev.x, ev.z)
        } else if (ev.slot === 1) {
          // W 불의 장막 — 중앙 + 링 배치 화염 5기가 지속시간 내내 타오르는 '불의 벽'
          const durMs = (MAGE_SKILLS[1]!.zone?.sec ?? 10) * 1000
          const center = makeFire(1.3)
          center.group.position.set(ev.x, 0.1, ev.z)
          center.group.scale.y = 0.6
          scene.add(center.group)
          fireCols.push({ fx: center, t0: performance.now(), dur: durMs })
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + Math.PI / 4
            const f = makeFire(0.9)
            f.group.position.set(ev.x + Math.sin(a) * ev.radius * 0.62, 0.1, ev.z + Math.cos(a) * ev.radius * 0.62)
            f.group.scale.y = 0.7
            scene.add(f.group)
            fireCols.push({ fx: f, t0: performance.now(), dur: durMs })
          }
          spawnSkillRing(ev.x, ev.z, 0.12, ev.radius, 0xff6a20, durMs, 'boundary')
          fx.smoke(ev.x, 0.6, ev.z, { count: 5, scale: 1.4, rise: 0.9, spread: ev.radius * 0.55, dur: 2000, tint: 0x5c5049, opacity: 0.42 })
          Sfx.at('firewall', ev.x, ev.z)
        } else {
          // E 업화(궁극) — 대형 화염 기둥 + 충격파 + 검은 연기 (판을 바꾸는 무게감)
          spawnFlash(new THREE.Vector3(ev.x, 1.6, ev.z), 9, 0xffa040, 650)
          spawnFlash(new THREE.Vector3(ev.x, 3.6, ev.z), 5.3, 0xfff0c0, 450)
          spawnShockwave(ev.x, ev.z, ev.radius + 1.2)
          spawnLight(new THREE.Vector3(ev.x, 2.5, ev.z), 0xff8030, 105, 700)
          const fire = makeFire(2.6)
          fire.group.position.set(ev.x, 0.1, ev.z)
          scene.add(fire.group)
          fireCols.push({ fx: fire, t0: performance.now(), dur: 1200 })
          addTrauma(0.75, ev.x, ev.z)
          Sfx.at('skill', ev.x, ev.z)
          fx.smoke(ev.x, 1.2, ev.z, { count: 6, scale: 2.2, rise: 2.2, spread: 1.6, dur: 2000, tint: 0x6b6259, opacity: 0.5 })
          fx.debris(ev.x, 0.4, ev.z, { count: 10, speed: 7, kind: 'ember' })
          for (const e of state.enemies) {
            if (Math.hypot(e.pos.x - ev.x, e.pos.z - ev.z) > ev.radius) continue
            hitEnemy(e.id, e.pos.x - ev.x, e.pos.z - ev.z, 1, 1.2)
          }
        }
      } else if (ev.casterKind === 'hero') {
        if (ev.slot === 0) {
          // Q 돌진 — 출발점→도착점 잔상 리본 (직전 틱 위치가 곧 출발점)
          const prev = ev.casterId !== undefined ? prevUnits.get(ev.casterId) : undefined
          if (caster && prev) {
            spawnDashTrail(prev.x, prev.z, caster.pos.x, caster.pos.z, caster.h + 1.0)
            fx.debris(prev.x, 0.3, prev.z, { count: 3, speed: 3, kind: 'dirt' })
            fx.debris(caster.pos.x, 0.3, caster.pos.z, { count: 4, speed: 3.5, kind: 'dirt' })
          }
          Sfx.at('dash', ev.x, ev.z)
        } else if (ev.slot === 1) {
          // W 회전베기 — 둘레를 한 바퀴 도는 검기 호 + 불똥
          spawnSlashArc(ev.x, ev.z, groundY + 1.0, 2.1)
          fx.debris(ev.x, 1.0, ev.z, { count: 6, speed: 4.5, kind: 'ember' })
          addTrauma(0.2, ev.x, ev.z)
          Sfx.at('heroSwing', ev.x, ev.z)
        } else {
          // E 대지파쇄(궁극) — 이중 충격파 + 석분·흙먼지 + 강한 흔들림
          spawnShockwave(ev.x, ev.z, ev.radius * 0.55)
          spawnShockwave(ev.x, ev.z, ev.radius + 0.8)
          spawnSkillRing(ev.x, ev.z, groundY, ev.radius, 0xc9b89a, 520)
          addTrauma(0.85, ev.x, ev.z)
          fx.debris(ev.x, 0.3, ev.z, { count: 12, speed: 6.5, kind: 'stone' })
          fx.smoke(ev.x, 0.8, ev.z, { count: 6, scale: 1.8, rise: 1.2, spread: 2.2, dur: 1400, tint: 0x8b8378, opacity: 0.5 })
          Sfx.at('wallHit', ev.x, ev.z)
        }
      } else {
        // 성주 버프 — **실제 효과 반경**을 링으로 그린다 (범위가 안 보이면 버프가 없는 것과 같다)
        const lordY = state.lord.h + 0.08
        if (ev.slot === 2) {
          // E 총력전(궁극) — 전역: 삼중 금 링이 서로 다른 속도로 퍼진다 + 뿔피리
          spawnSkillRing(ev.x, ev.z, lordY, 14, 0xffd870, 500)
          spawnSkillRing(ev.x, ev.z, lordY, 24, 0xffd870, 800)
          spawnSkillRing(ev.x, ev.z, lordY, 36, 0xffe8a8, 1100)
          spawnLight(new THREE.Vector3(ev.x, 2.6, ev.z), 0xffd870, 60, 900)
          Sfx.global('horn')
        } else {
          // Q 군기(금) / W 진군 나팔(청록) — 확장 펄스 + **성주를 따라다니는 오라 링**
          // (2026-08-09: 버프는 시전 지점 고정이 아니라 성주로부터의 거리 — sim과 일치)
          const color = ev.slot === 0 ? 0xffd870 : 0x53d6c8
          const durMs = (LORD_SKILLS[ev.slot]!.buff?.sec ?? 6) * 1000
          spawnSkillRing(ev.x, ev.z, lordY, ev.radius, color, 550)
          spawnSkillRing(ev.x, ev.z, lordY, ev.radius, color, durMs, 'boundary', () => ({
            x: lordMesh.position.x, y: lordMesh.position.y + 0.08, z: lordMesh.position.z,
          }))
          spawnLight(new THREE.Vector3(ev.x, 2.2, ev.z), color, 34, 600)
          Sfx.at('rally', ev.x, ev.z)
        }
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
        Sfx.at('melee', u.pos.x, u.pos.z)
      }
    } else if (ev.type === 'wallHit') {
      enemyAttackT.set(ev.id, performance.now())
      const we = state.enemies.find((x) => x.id === ev.id)
      enemyFacing.set(ev.id, we ? faceWall(we) : ENEMY_FACE_WEST)
      wallHitT = performance.now() // HUD 성벽 게이지 반응
      if (we) Sfx.at('wallHit', we.pos.x, we.pos.z)
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

function buildHeroCard(heroId: number, kind: string): HeroCard {
  const def = state.kinds.units[kind]!
  const ult = def.skills![2]!
  const isMage = kind === 'mage'
  const root = document.createElement('div')
  root.style.cssText =
    'pointer-events:auto;width:172px;background:#000d;border:1px solid #345;border-radius:6px;' +
    'padding:8px 10px;cursor:pointer;font-family:monospace;color:#e8e8f0;user-select:none'
  root.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center">
      <div style="width:38px;height:38px;border-radius:5px;border:1px solid ${isMage ? '#a75' : '#57a'};flex:none;
           display:flex;align-items:center;justify-content:center;font-size:20px;
           background:radial-gradient(circle at 35% 30%, ${isMage ? '#b0522d, #401812' : '#2d64b0, #122340'})">${isMage ? '🔥' : '⚔'}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <b style="color:${isMage ? '#ffab7a' : '#7ab0ff'};font-size:13px">${def.name}</b>
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
      <div style="font-size:11px;color:#c8b890;line-height:1.35">${ult.name} (궁극)<br>
        <span class="sk-mode" style="color:#8898a8">Q·W·E는 커맨드 카드</span></div>
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
    selected.clear()
    selected.add(heroId)
    castSlot(2)
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

/** 성주 카드 — 영웅 카드와 같은 틀. HP 대신 '지휘', 궁극은 총력전(E) */
function buildLordCard(): HeroCard {
  const ult = LORD_SKILLS[2]!
  const root = document.createElement('div')
  root.style.cssText =
    'pointer-events:auto;width:172px;background:#000d;border:1px solid #345;border-radius:6px;' +
    'padding:8px 10px;cursor:pointer;font-family:monospace;color:#e8e8f0;user-select:none'
  root.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center">
      <div style="width:38px;height:38px;border-radius:5px;border:1px solid #a86;flex:none;
           display:flex;align-items:center;justify-content:center;font-size:20px;
           background:radial-gradient(circle at 35% 30%, #3a3550, #15151d)">👑</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <b style="color:#ff9a7a;font-size:13px">성주</b>
          <span class="hp-t" style="font-size:10px;color:#8898a8">지휘</span>
        </div>
        <div style="width:100%;height:7px;background:#0009;margin-top:4px;border-radius:2px">
          <div class="hp-b" style="height:100%;width:100%;background:#b08d3e;border-radius:2px"></div>
        </div>
      </div>
    </div>
    <div style="display:flex;gap:7px;align-items:center;margin-top:7px">
      <div class="sk" style="position:relative;width:36px;height:36px;border:1px solid #764;border-radius:5px;
           overflow:hidden;flex:none;cursor:pointer;
           background:radial-gradient(circle at 50% 65%, #ffd870, #6a4c0a)">
        <span style="position:absolute;top:1px;left:4px;font-size:10px;font-weight:bold;color:#fff4d0;text-shadow:0 1px 2px #000">E</span>
        <div class="sk-ov" style="position:absolute;left:0;bottom:0;width:100%;height:0;background:#000b"></div>
        <span class="sk-cd" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
              font-size:12px;font-weight:bold;text-shadow:0 1px 2px #000"></span>
      </div>
      <div style="font-size:11px;color:#c8b890;line-height:1.35">${ult.name} (궁극)<br>
        <span class="sk-mode" style="color:#8898a8">Q·W·E는 커맨드 카드</span></div>
    </div>`
  root.addEventListener('pointerdown', (e) => {
    e.stopPropagation()
    selected.clear()
    selected.add(LORD_ID)
  })
  const skillBtn = root.querySelector('.sk') as HTMLDivElement
  skillBtn.addEventListener('pointerdown', (e) => {
    e.stopPropagation()
    selected.clear()
    selected.add(LORD_ID)
    castSlot(2)
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
  document.getElementById('herobar')!.appendChild(card.root)
  return card
}

function updateHeroBar(): void {
  const heroes = state.units.filter((u) => state.kinds.units[u.kind]?.skills)
  // 전사한 영웅 카드 제거 (성주 카드는 전사 개념이 없으므로 유지)
  for (const [id, card] of heroCards) {
    if (id !== LORD_ID && !heroes.some((h) => h.id === id)) {
      card.root.remove()
      heroCards.delete(id)
    }
  }
  // 성주 카드 — 영웅과 같은 줄에 (2026-08-08 사용자: "성주도 하단 프로필에 포함되면 좋겠다").
  // 성주는 sim의 units가 아니라 lord 상태라 HP가 없다 — 그 자리에 '지휘' 표기를 쓴다
  {
    let card = heroCards.get(LORD_ID)
    if (!card) {
      card = buildLordCard()
      heroCards.set(LORD_ID, card)
    }
    const ult = LORD_SKILLS[2]!
    const cd = state.lord.cds[2] ?? 0
    card.root.style.borderColor = selected.has(LORD_ID) ? '#ffd870' : '#345'
    if (cd > 0) {
      card.skillOv.style.height = `${(cd / (ult.cooldown * TICKS_PER_SECOND)) * 100}%`
      card.skillCd.textContent = `${Math.ceil(cd / TICKS_PER_SECOND)}`
    } else {
      card.skillOv.style.height = '0'
      card.skillCd.textContent = ''
    }
  }
  for (const h of heroes) {
    let card = heroCards.get(h.id)
    if (!card) {
      card = buildHeroCard(h.id, h.kind)
      heroCards.set(h.id, card)
    }
    const def = state.kinds.units[h.kind]!
    const maxHp = def.hp
    card.hpText.textContent = `${h.hp}/${maxHp}`
    card.hpBar.style.width = `${Math.max(0, (h.hp / maxHp) * 100)}%`
    card.hpBar.style.background = h.hp / maxHp > 0.35 ? '#62c462' : '#d05050'
    card.root.style.borderColor = selected.has(h.id) ? '#ffd870' : '#345'
    const ult = def.skills![2]!
    const cdMax = ult.cooldown * TICKS_PER_SECOND
    const cd = h.cds[2] ?? 0
    if (cd > 0) {
      // 쿨다운 스윕 — 아래에서 위로 차오르는 LoL식 오버레이
      card.skillOv.style.height = `${(cd / cdMax) * 100}%`
      card.skillCd.textContent = `${Math.ceil(cd / TICKS_PER_SECOND)}`
    } else {
      card.skillOv.style.height = '0'
      card.skillCd.textContent = ''
    }
    card.mode.textContent =
      aiming && aimingCast?.casterId === h.id ? '조준 중…' : 'Q·W·E 커맨드 카드'
  }
}

// 선택 부대 패널 (SC식) — 칩 그리드, 칩 클릭 = 단독 선택
const KIND_SHORT: Record<string, string> = { soldier: '궁', ballista: '발', cannon: '포', hero: '전', mage: '마', guard: '수' }
const selChips = new Map<number, { root: HTMLDivElement; hp: HTMLDivElement }>()
let selPanelKey = ''

function updateSelPanel(): void {
  const sel = state.units.filter((u) => selected.has(u.id))
  const lordSel = selected.has(LORD_ID)
  const panel = document.getElementById('selpanel')!
  if (sel.length === 0 && !lordSel) {
    panel.style.display = 'none'
    selPanelKey = ''
    return
  }
  panel.style.display = 'block'
  const key = (lordSel ? 'L,' : '') + sel.map((u) => u.id).join(',')
  if (key !== selPanelKey) {
    selPanelKey = key
    const grid = document.getElementById('selgrid')!
    grid.innerHTML = ''
    selChips.clear()
    if (lordSel) {
      // 성주 칩 — HP 없는 유일한 개체라 게이지 없이 이름표 색으로 구분
      const chip = document.createElement('div')
      chip.style.cssText =
        'width:34px;cursor:pointer;text-align:center;font-family:monospace;font-size:12px;' +
        'background:#241a18;border:1px solid #ff9a7a;border-radius:4px;padding:2px 0 3px;color:#ffcaba'
      chip.textContent = '성'
      chip.addEventListener('pointerdown', (e) => {
        e.stopPropagation()
        selected.clear()
        selected.add(LORD_ID)
      })
      grid.appendChild(chip)
    }
    for (const u of sel) {
      const chip = document.createElement('div')
      chip.style.cssText =
        'width:34px;cursor:pointer;text-align:center;font-family:monospace;font-size:12px;' +
        'background:#1a2430;border:1px solid #456;border-radius:4px;padding:2px 0 3px;color:#cde'
      const grp = groupOf(u.id)
      chip.style.position = 'relative'
      chip.innerHTML = `${KIND_SHORT[u.kind] ?? '?'}<div style="height:4px;background:#0009;margin:2px 3px 0">
        <div class="c-hp" style="height:100%;width:100%;background:#62c462"></div></div>` +
        (grp !== null
          ? `<div style="position:absolute;top:-5px;right:-4px;font-size:9px;line-height:1;
               background:#345;border-radius:3px;padding:1px 3px;color:#ffd870">${grp}</div>`
          : '')
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
    `선택 ${sel.length + (lordSel ? 1 : 0)} — ` +
    [...(lordSel ? ['성주 1'] : []), ...[...counts].map(([k, n]) => `${state.kinds.units[k]!.name} ${n}`)].join(' · ')
  for (const u of sel) {
    const chip = selChips.get(u.id)
    if (chip) chip.hp.style.width = `${Math.max(0, (u.hp / state.kinds.units[u.kind]!.hp) * 100)}%`
  }
}

let renderAlpha = 1
let frameNo = 0

/**
 * 계단 표시 높이 — sim은 연속 경사(이동·검증의 진실)지만 렌더 계단은 14단 불연속이라,
 * sim 높이 그대로 세우면 디딤판 앞쪽에서 최대 0.79(=11/14)만큼 하반신이 돌에 잠긴다
 * ("계단 올라갈 때 하반신이 계단 아래로 간다" — 2026-08-08 사용자 지적).
 * 표시 y만 지금 밟고 있는 디딤판 윗면으로 올린다 — sim 좌표 불변, 클릭·판정 영향 없음.
 * 상수는 environment.ts의 계단 건설(STEPS 14, z 4.5~15)과 일치해야 한다.
 */
const STAIR_STEPS = 14
function stairDisplayH(x: number, z: number, h: number): number {
  const az = Math.abs(z)
  const x0 = CASTLE.east - CASTLE.wallT / 2 - 2.4
  const x1 = CASTLE.east - CASTLE.wallT / 2 + 0.2
  if (x < x0 || x > x1 || az < 4.5 || az > 15) return h
  // 보도 합류 띠 (x −10~−9.8): 렌더 계단은 x=−10에서 끝나고 그 너머는 보도 몸체의 수직
  // 옆면이다 — 경사 그대로 두면 합류 순간 하체가 보도 돌에 묻힌다("성벽 안쪽으로 들어간다"
  // 2026-08-09). 꼭대기 부근에서만 이 띠를 지나므로(Δh≤1.5 전이 규칙) 보도 윗면으로 스냅.
  if (x > CASTLE.east - CASTLE.wallT / 2 && h > CASTLE.wallH - 1.6) return CASTLE.wallH
  // 반 단 리드(+0.5): 발바닥을 현재 디딤판에 정확히 맞춰도(실측 7.046 vs 7.071),
  // 걷는 중에는 몸이 **다음 단의 수직면을 관통하며** 전진해 하반신이 잠겨 보인다
  // ("조금 더 올려야 해, 여전히 정강이" — 2026-08-08). 반 단 먼저 다음 디딤판에
  // 올라서게 하면 관통 구간이 절반으로 줄고, 남는 쪽은 잠김이 아니라 살짝 뜸이라 덜 읽힌다.
  // 리드 1.0 = 항상 한 단 위 디딤판 기준 (0.5로는 부족하다는 사용자 확인 → 반 칸 추가)
  const i = Math.min(STAIR_STEPS - 1, Math.floor(((az - 4.5) / 10.5) * STAIR_STEPS + 1.0))
  return Math.max(h, (CASTLE.wallH * (i + 1)) / STAIR_STEPS)
}

function syncScene(now: number): void {
  fadeOccluders(frameNo % 4 === 0)
  frameNo++
  const lx = THREE.MathUtils.lerp(prevLord.x, state.lord.pos.x, renderAlpha)
  const lz = THREE.MathUtils.lerp(prevLord.z, state.lord.pos.z, renderAlpha)
  const ly = stairDisplayH(lx, lz, THREE.MathUtils.lerp(prevLordH, state.lord.h, renderAlpha))
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
    const uy = stairDisplayH(ux, uz, prev ? THREE.MathUtils.lerp(prev.h, u.h, renderAlpha) : u.h)
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
  // 성주 선택 링 — 유닛과 같은 규칙 (렌더 좌표는 위에서 이미 보간된 lordMesh 위치)
  if (selected.has(LORD_ID)) {
    const ring = getSelectionRing(ringIdx++)
    ring.visible = true
    ring.scale.setScalar(1.15)
    ring.position.set(lordMesh.position.x, lordMesh.position.y + 0.06, lordMesh.position.z)
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

  // 카메라: 기본은 성주 추적, 가장자리·화살표·미니맵으로 자유 이동 (C로 복귀)
  const camDt = Math.min(0.05, (now - camPrevT) / 1000)
  camPrevT = now
  let panX = 0
  let panZ = 0
  if (mouseIn && !dragStart) {
    // 드래그 선택 중엔 가장자리 팬 금지 — 박스를 끌다 화면이 밀려나면 선택을 망친다
    if (mouseX <= EDGE_PX) panX -= 1
    else if (mouseX >= window.innerWidth - EDGE_PX) panX += 1
    if (mouseY <= EDGE_PX) panZ -= 1
    else if (mouseY >= window.innerHeight - EDGE_PX) panZ += 1
  }
  if (keysPan.has('ArrowLeft')) panX -= 1
  if (keysPan.has('ArrowRight')) panX += 1
  if (keysPan.has('ArrowUp')) panZ -= 1
  if (keysPan.has('ArrowDown')) panZ += 1
  if (panX !== 0 || panZ !== 0) {
    camFollow = false
    const spd = camDist * 1.15 // 줌 비례 — 당겨 보면 세밀하게, 빼면 빠르게
    camPos.x = Math.max(FIELD.minX, Math.min(FIELD.maxX, camPos.x + panX * spd * camDt))
    camPos.z = Math.max(FIELD.minZ, Math.min(FIELD.maxZ, camPos.z + panZ * spd * camDt))
  }
  if (camFollow) {
    camPos.x = lx
    camPos.z = lz
  }
  // 시점 높이: 추적 중엔 성주의 층(성벽 위 11), 자유 모드는 지면 — 전환 시 보간으로 튐 방지
  camY += ((camFollow ? ly : 0) - camY) * Math.min(1, camDt * 8)
  // 비스듬한 앵글(약 43°) — 성벽·인물·바위의 수직면이 화면에 실린다
  camera.position.set(camPos.x, camY + camDist * 0.82, camPos.z + camDist * 0.68)
  camera.lookAt(camPos.x, camY + 1.0, camPos.z - 1.5)
  // 흔들림은 lookAt 뒤에 덧붙인다 — 제곱 감쇠라 큰 충격만 확실히 느껴지고 잔진동은 빨리 사라진다
  if (trauma > 0.002) {
    const s = trauma * trauma
    camera.position.x += Math.sin(now * 0.041) * s * 0.75
    camera.position.y += Math.sin(now * 0.053 + 1.7) * s * 0.55
    camera.position.z += Math.sin(now * 0.037 + 3.1) * s * 0.6
    camera.rotation.z += Math.sin(now * 0.047 + 0.8) * s * 0.02
  }

  // HUD
  drawMinimap()
  // 커맨드 카드 = f(선택): 해당 없는 명령은 흐려지고, 올릴 명령이 없으면 카드 자체가 사라진다
  const hasMovers = selectedMovers().length > 0
  // 장착제: 쌍은 동적 배정 — 선택이 조작 중인 병기이거나 조작 중인 수비병일 때만 G가 산다
  const manning = manningMap(state)
  // 장착 상태 피드백 — 미장착 병기: 흰 점멸 링 / 장착 성사 순간: 금색 펄스 + 걸쇠음.
  // 준비 단계엔 적이 없어 발사라는 확인 수단 자체가 없다 — 이 링이 유일한 배치 피드백이다.
  for (const u of state.units) {
    if (!state.kinds.units[u.kind]?.crew) continue
    const v = unitVisuals.get(u.id)
    if (!v?.mountRing) continue
    const manned = manning.has(u.id)
    v.mountRing.visible = !manned
    if (!manned)
      (v.mountRing.material as THREE.MeshBasicMaterial).opacity = 0.32 + 0.22 * Math.sin(now * 0.006)
    if (manned && mountedPrev.get(u.id) === false) {
      showMoveMarker(u.pos.x, u.pos.z, u.h, 0xffd870, 2.4) // 장착! — 금색 확장 펄스
      Sfx.at('mount', u.pos.x, u.pos.z)
    }
    mountedPrev.set(u.id, manned)
  }
  let hasCrewPair = false
  for (const id of selected) {
    if (manning.has(id) || [...manning.values()].includes(id)) {
      hasCrewPair = true
      break
    }
  }
  // Q/W/E 스킬 버튼 — 라벨은 현재 시전자의 스킬 이름, 쿨다운 중이면 남은 초 표시
  const ac = activeCaster()
  const cmdApplicable: Record<string, boolean> = {
    'cmd-a': hasMovers,
    'cmd-s': hasMovers,
    'cmd-g': hasCrewPair,
    'cmd-q': ac !== null,
    'cmd-w': ac !== null,
    'cmd-e': ac !== null,
  }
  document.getElementById('cmdwrap')!.style.display =
    Object.values(cmdApplicable).some(Boolean) ? '' : 'none'
  for (const [id, on] of Object.entries(cmdApplicable)) {
    const el = document.getElementById(id)
    if (!el) continue
    el.style.opacity = on ? '1' : '0.28'
    el.style.pointerEvents = on ? '' : 'none'
  }
  for (const [slot, id] of [['0', 'cmd-q'], ['1', 'cmd-w'], ['2', 'cmd-e']] as const) {
    const lbl = document.querySelector(`#${id} .lbl`) as HTMLElement | null
    if (!lbl) continue
    if (ac) {
      const def = ac.skills[Number(slot)]
      const cds = ac.caster ? ac.caster.cds : state.lord.cds
      const cd = cds[Number(slot)] ?? 0
      lbl.textContent = def ? (cd > 0 ? `${def.name} ${Math.ceil(cd / TICKS_PER_SECOND)}` : def.name) : '—'
    } else {
      lbl.textContent = ['Q', 'W', 'E'][Number(slot)]!
    }
  }
  // 어택땅 대기 중엔 버튼을 점등 — 다음 클릭이 명령이 된다는 상태 표시
  const aBtn = document.getElementById('cmd-a')
  if (aBtn) aBtn.style.borderColor = attackMove ? '#ff5a4a' : '#3a4a5e'
  // 아무것도 선택·조사하지 않았을 때만 중앙 힌트
  const selPanelEl = document.getElementById('selpanel')!
  const infoPanelEl = document.getElementById('panel')!
  document.getElementById('selhint')!.style.display =
    selPanelEl.style.display === 'none' && infoPanelEl.style.display === 'none' ? 'block' : 'none'
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
        (def.skills ? `<br>스킬 ${def.skills.map((s) => `${s.key} ${s.name}`).join(' · ')}` : '')
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
  // 준비 단계의 핵심 안내 — 장착제(2026-08-08): 병기는 빈 채로 시작하므로,
  // 장착을 모르는 채 Space를 누르면 반드시 진다. 미장착 수를 문구로 세워 배치를 유도한다.
  if (state.status === 'prep') {
    const unmannedN = state.units.filter(
      (u) => state.kinds.units[u.kind]?.crew && !manning.has(u.id),
    ).length
    phase.textContent =
      unmannedN > 0
        ? `준비 — 병기 ${unmannedN}기 미장착! 수비병 선택 → 병기 우클릭으로 장착 · Space 침공 개시`
        : '준비 완료 — 전 병기 장착. Space로 침공 개시'
  } else {
    phase.textContent =
      state.status === 'assault'
        ? `침공 진행 중 — 괴수 ${state.enemies.length}`
        : state.status === 'won'
          ? '성을 지켜냈다!'
          : '성이 함락됐다'
  }

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
  mountedPrev.clear()
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
  selected.add(LORD_ID) // 새 판도 성주 선택으로 시작 — 첫 우클릭이 곧 성주 이동
  ctrlGroups.clear()
  inspectedEnemy = null
  aiming = false
  aimingCast = null
  aimReticle.visible = false
  trauma = 0
  wallHitT = -1e9
  spaceLatch = false
  pendingMove = undefined
  pendingUnitMove = undefined
  pendingUnitAim = undefined
  pendingUnitStop = undefined
  pendingCast = undefined
  cancelAttackMove()

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

/** 동적 해상도 조절 — 하락은 빠르게(-0.2), 회복은 천천히.
 *  최저 스케일에서도 40 미만이면 블룸까지 끄고, 여유가 돌아오면 순서대로 복구.
 *  초기 3초는 에셋 로딩 히치라 판단 유보.
 *
 *  스케일 변경 = 렌더 타깃 재할당 = 그 프레임이 히치다. 2026-08-06 계측에서
 *  구버전(+0.05/500ms, 문턱 57)이 0.7↔0.85를 무한 왕복하며 20초에 재할당 ~10회 —
 *  "낮은 fps"가 아니라 이 진동이 체감 버벅임이었다. 그래서:
 *  - 변경 사이 쿨다운(하락 1.5s / 상승 5s) — 진동 주기를 구조적으로 차단
 *  - 상승은 58fps가 쿨다운 내내 유지될 때만 — 한계선 근처에서는 오르지 않는다 */
const ADAPT_WARMUP_MS = 3000
const DOWN_COOLDOWN_MS = 1500
const UP_COOLDOWN_MS = 5000
let lastScaleChange = 0
let sustainedHigh = 0 // 58fps 연속 유지 시작 시각 (0 = 미달)
function adaptQuality(fps: number, now: number): void {
  if (now < ADAPT_WARMUP_MS) return
  if (fps <= 58) sustainedHigh = 0
  else if (sustainedHigh === 0) sustainedHigh = now
  if (fps < 45 && resScale > RES_MIN) {
    if (now - lastScaleChange < DOWN_COOLDOWN_MS) return
    resScale = Math.max(RES_MIN, resScale - 0.2)
    lastScaleChange = now
    applyResScale()
  } else if (fps < 40 && resScale <= RES_MIN && bloom.enabled) {
    bloom.enabled = false // 블룸 토글은 재할당이 없어 쿨다운 불요
  } else if (sustainedHigh > 0 && now - sustainedHigh >= UP_COOLDOWN_MS) {
    if (resScale < RES_MAX) {
      if (now - lastScaleChange < UP_COOLDOWN_MS) return
      resScale = Math.min(RES_MAX, resScale + 0.1)
      lastScaleChange = now
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
      `${Math.round(fps)} fps · 해상도 ${Math.round((resScale / RES_MAX) * 100)}%${bloom.enabled ? '' : ' · 블룸 꺼짐'}${muted ? ' · 음소거' : ''}`
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
    if (pendingUnitStop) {
      input.unitStop = pendingUnitStop
      pendingUnitStop = undefined
    }
    if (pendingCast) {
      input.castSkill = pendingCast
      pendingCast = undefined
    }
    // B 자동 장착 — deploy 봇과 같은 수순을 스텝마다 한 명령씩. 플레이어 명령이 우선한다
    if (autoDeploy) {
      const step = deployPrep(state)
      if (step === null) autoDeploy = false
      else if (step.unitMove && !input.unitMove) input.unitMove = step.unitMove
    }
    const before = state.status
    stepSiege(state, spawns, input)
    // 상태 전이는 이벤트로 오지 않으므로 여기서 잡는다 (뿔피리·승패음)
    if (before !== state.status) {
      if (state.status === 'assault') Sfx.global('horn')
      else if (state.status === 'won') Sfx.global('victory')
      else if (state.status === 'lost') Sfx.global('defeat')
    }
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
    // 병기는 본체가 반동하고, 사람(궁수·수비병·영웅)은 팔이 움직인다
    if (v.weapon) {
      animateWeapon(v.weapon, atkMs)
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
  // 리스너 = 카메라. 오른쪽 축을 월드 XZ로 투영해 좌우 패닝에 쓴다
  camera.getWorldDirection(_sfxFwd)
  Sfx.setListener(camera.position.x, camera.position.z, -_sfxFwd.z, _sfxFwd.x)
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
  // 사운드 핸들 — 소리는 정지 화면으로 판정할 수 없으므로 빌드 없이 하나씩 들어보기 위한 훅.
  // 예) __siege.sfx.at('cannon', -6, 0) / __siege.sfx.global('horn') / __siege.sfx.toggleMute()
  sfx: Sfx,
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
