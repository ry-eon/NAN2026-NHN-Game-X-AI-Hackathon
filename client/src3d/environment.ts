// 성채·배경 비주얼 v2 (M2a-1b) — 실사풍 전환.
// CC0 PBR 텍스처(ambientCG)·HDRI(Poly Haven) 사용 — docs/asset-licenses.md 기록.
// 전체 성: 4면 성곽 + 모서리 망루 4 + 동면 성문루 + 내성. 동면이 전장 정면.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { CASTLE, FIELD } from '../../siege/sim/world'

const rand01 = (i: number, salt: number): number =>
  (((i * 73856093) ^ (salt * 19349663)) % 1000) / 1000

// 성곽 평면 배치는 sim(siege/sim/world.ts CASTLE)이 단일 진실 원천 —
// 충돌·높이 지형과 렌더 지오메트리가 반드시 일치해야 하기 때문.
export { CASTLE }

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
  // 낮 씬 (2026-07-27 사용자 피드백: "밤이 생각보다 안 보인다 — 낮이 낫겠다")
  new RGBELoader().load('/assets/hdr/dusk_1k.hdr', (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping
    scene.environment = hdr // PBR 미세 간접광·반사 디테일용 (강도만 낮 기준으로)
    scene.environmentIntensity = 0.55
    void renderer
  })
  // 하늘: 절차 그라데이션 돔 (천정 청색 → 지평선 뿌연 백청)
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x6f9fd8) },
      horizon: { value: new THREE.Color(0xe4ecf4) },
    },
    vertexShader: `varying vec3 vPos; void main(){ vPos = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vPos;
      void main(){
        float h = clamp(normalize(vPos).y, 0.0, 1.0);
        gl_FragColor = vec4(mix(horizon, top, pow(h, 0.55)), 1.0);
      }`,
  })
  const dome = new THREE.Mesh(new THREE.SphereGeometry(185, 24, 16), skyMat)
  scene.add(dome)
  scene.background = new THREE.Color(0xe4ecf4) // 돔 바깥 폴백

  // 태양 (동쪽 상공 — 키 라이트와 같은 방향, 블룸이 광휘를 만든다)
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(6, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xfff4d8, fog: false }),
  )
  sun.position.set(120, 102, -54)
  scene.add(sun)
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
  /** 카메라-성주 사이에 끼면 반투명 처리할 대형 구조물 */
  occluders: THREE.Mesh[]
}

/** 흉벽 달린 성벽 구간 (축 정렬) */
function wallSegment(
  scene: THREE.Scene,
  decor: WorldDecor,
  darkMat: THREE.Material,
  axis: 'x' | 'z',
  fixed: number,
  from: number,
  to: number,
  outerSign = 1, // 흉벽을 놓을 바깥 가장자리 방향
): void {
  const len = Math.abs(to - from)
  const mid = (from + to) / 2
  const { wallH, wallT } = CASTLE
  // 텍스처 반복을 벽 크기에 비례 — 늘어짐 방지 (구간별 독립 재질)
  const mat = pbrDisplaced('bricks', len / 5.5, wallH / 5.5, 0.22, { color: 0x9aa0b0 })
  // 변위 맵이 실제 요철을 만들도록 세분화
  // 본체는 0.25 낮게 — 변위 요철(≤0.22)이 보도 상판을 뚫지 않도록 (상판이 걷는 면)
  const bodyH = wallH - 0.25
  // 세분화는 변위가 읽히는 최소선까지만 — 성능 패스(2026-07-27)에서 밀도 절반 인하
  const segLen = Math.max(14, Math.floor(len))
  const geo =
    axis === 'z'
      ? new THREE.BoxGeometry(wallT, bodyH, len, 2, 12, segLen)
      : new THREE.BoxGeometry(len, bodyH, wallT, segLen, 12, 2)
  const seg = new THREE.Mesh(geo, mat)
  decor.occluders.push(seg)
  seg.position.set(axis === 'z' ? fixed : mid, bodyH / 2, axis === 'z' ? mid : fixed)
  seg.castShadow = true
  seg.receiveShadow = true
  scene.add(seg)
  // 흉벽 — 보도 바깥 가장자리 (안쪽은 배치 공간으로 비운다)
  // 연속 낮은 파라펫 위에 성가퀴가 솟는 총안 구조: 사이가 비지 않고 낮은 벽으로 이어진다
  const lip = (wallT / 2 - 0.55) * outerSign
  const parapet = new THREE.Mesh(
    axis === 'z' ? new THREE.BoxGeometry(1.1, 1.15, len) : new THREE.BoxGeometry(len, 1.15, 1.1),
    darkMat,
  )
  parapet.position.set(
    axis === 'z' ? fixed + lip : mid,
    wallH + 0.575,
    axis === 'z' ? mid : fixed + lip,
  )
  parapet.castShadow = true
  parapet.receiveShadow = true
  scene.add(parapet)
  // 성가퀴는 월드 좌표 4.2 그리드에 정렬 — 구간·성문 이음새에서도 간격이 일정
  const step = 4.2
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  for (let w = Math.ceil((lo + 0.8) / step) * step; w <= hi - 0.8; w += step) {
    const m = new THREE.Mesh(
      axis === 'z'
        ? new THREE.BoxGeometry(1.1, 2.2, 2.1)
        : new THREE.BoxGeometry(2.1, 2.2, 1.1),
      darkMat,
    )
    m.position.set(
      axis === 'z' ? fixed + lip : w,
      wallH + 1.1,
      axis === 'z' ? w : fixed + lip,
    )
    m.castShadow = true
    scene.add(m)
  }
}

export function buildCastle(scene: THREE.Scene): WorldDecor {
  const decor: WorldDecor = { torchLights: [], flags: [], occluders: [] }
  const stone = pbrDisplaced('bricks', 2.5, 1, 0.22, { color: 0x9aa0b0 })
  const stoneDark = pbr('bricks', 1.2, 0.6, { color: 0x9a9aa8 })
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.85 })
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x22232e, roughness: 0.75 })
  const { east, west, north, south, wallH, gateHalf } = CASTLE

  // 4면 성곽 (동면은 성문 개구부)
  // 북/남벽은 동/서벽 두께 끝까지 연장 — 망루 제거 후 모서리 노치가 비지 않게
  const ext = CASTLE.wallT / 2 - 0.05 // 0.05 안쪽: 면 겹침(z-fighting) 방지
  wallSegment(scene, decor, stoneDark, 'z', east, north, -gateHalf, 1)
  wallSegment(scene, decor, stoneDark, 'z', east, gateHalf, south, 1)
  wallSegment(scene, decor, stoneDark, 'z', west, north, south, -1)
  wallSegment(scene, decor, stoneDark, 'x', north, west - ext, east + ext, -1)
  wallSegment(scene, decor, stoneDark, 'x', south, west - ext, east + ext, 1)

  // 보도 상판 — 벽 박스 윗면은 옆면 기준 UV라 길이 방향으로 텍스처가 죽 늘어진다.
  // 걷는 면 전체를 포장(paving) 데크로 덮어 4면이 같은 질감이 되게 한다.
  {
    const deck = (w: number, d: number, x: number, z: number, yTop: number): void => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.3, d),
        pbr('stone', w / 3.2, d / 3.2, { color: 0x9aa0b8 }),
      )
      m.position.set(x, yTop - 0.15, z)
      m.receiveShadow = true
      scene.add(m)
    }
    const spanZ = south - north + CASTLE.wallT
    const spanX = east - west + CASTLE.wallT
    // 동/서는 0.012 위 — 모서리 겹침에서 면 충돌(z-fighting) 방지
    deck(CASTLE.wallT, spanZ, east, 0, wallH + 0.012)
    deck(CASTLE.wallT, spanZ, west, 0, wallH + 0.012)
    deck(spanX, CASTLE.wallT, (east + west) / 2, north, wallH)
    deck(spanX, CASTLE.wallT, (east + west) / 2, south, wallH)
  }

  // 모서리 파라펫 이음 — 동/서벽 파라펫은 벽 구간 끝에서 멈추고 북/남벽 파라펫은
  // 바깥 립에 있어 그 사이가 계단처럼 비었다. 필러로 잇고 모서리는 캡 블록으로 마감.
  {
    const lip = CASTLE.wallT / 2 - 0.55
    const fillLen = lip + 1.15
    for (const cx of [east + lip, west - lip]) {
      for (const cz of [north, south]) {
        const dir = cz === north ? -1 : 1
        const fill = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.15, fillLen), stoneDark)
        fill.position.set(cx, wallH + 0.575, cz + dir * (fillLen / 2 - 0.3))
        fill.castShadow = true
        fill.receiveShadow = true
        scene.add(fill)
        const cap = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.2, 2.1), stoneDark)
        cap.position.set(cx, wallH + 1.1, cz + dir * lip)
        cap.castShadow = true
        cap.receiveShadow = true
        scene.add(cap)
      }
    }
  }

  // 성문루: 성벽과 같은 높이·두께의 플러시 벽 — 정면이 한 장으로 평평하다.
  // 첨두 아치가 아래를 관통 (보도는 sim상 성문 상부 6.4 구간만 비워둠)
  {
    const arch = new THREE.Shape()
    const gw = gateHalf + 0.05 // 벽 구간과 이음새 없이
    const gh = gateHalf * 0.95
    const archTop = 8.4
    arch.moveTo(-gw, 0)
    arch.lineTo(-gw, wallH)
    arch.lineTo(gw, wallH)
    arch.lineTo(gw, 0)
    arch.lineTo(gh, 0)
    arch.lineTo(gh, 5.4)
    arch.quadraticCurveTo(gh * 0.9, archTop * 0.94, 0, archTop)
    arch.quadraticCurveTo(-gh * 0.9, archTop * 0.94, -gh, 5.4)
    arch.lineTo(-gh, 0)
    arch.lineTo(-gw, 0)
    const gateGeo = new THREE.ExtrudeGeometry(arch, { depth: CASTLE.wallT, bevelEnabled: false })
    const gatehouse = new THREE.Mesh(gateGeo, pbr('bricks', 0.32, 0.55, { color: 0x9aa0b0 }))
    gatehouse.rotation.y = -Math.PI / 2
    gatehouse.position.set(east + CASTLE.wallT / 2, 0, 0)
    gatehouse.castShadow = true
    gatehouse.receiveShadow = true
    decor.occluders.push(gatehouse)
    scene.add(gatehouse)
    // 성문 상부 흉벽 (연속 실루엣) — 벽 구간과 같은 파라펫으로 이어붙임
    const lip2 = CASTLE.wallT / 2 - 0.55
    const gatePara = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.15, gw * 2), stoneDark)
    gatePara.position.set(east + lip2, wallH + 0.575, 0)
    gatePara.castShadow = true
    gatePara.receiveShadow = true
    scene.add(gatePara)
    // 성문 상부 성가퀴도 벽 구간과 같은 규격·같은 월드 4.2 그리드 (z=0 한 기)
    const m2 = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.2, 2.1), stoneDark)
    m2.position.set(east + lip2, wallH + 1.1, 0)
    m2.castShadow = true
    scene.add(m2)
  }
  // 홍예석(voussoir): 첨두 곡선을 따라 낱개 돌 — '조립된 석조'의 인상
  {
    const gh2 = gateHalf * 0.95
    const top = 8.4
    const curvePts: THREE.Vector2[] = []
    for (let i = 0; i <= 7; i++) {
      const u = i / 7
      // 좌측 곡선 (quadratic: (−gh2,6) → 제어(−gh2*0.9, top*0.92) → (0, top))
      const x = (1 - u) * (1 - u) * -gh2 + 2 * (1 - u) * u * (-gh2 * 0.9) + u * u * 0
      const y = (1 - u) * (1 - u) * 5.4 + 2 * (1 - u) * u * (top * 0.94) + u * u * top
      curvePts.push(new THREE.Vector2(x, y))
    }
    const allPts = [...curvePts, ...curvePts.slice(0, -1).reverse().map((p2) => new THREE.Vector2(-p2.x, p2.y))]
    for (let i = 0; i < allPts.length - 1; i++) {
      const a = allPts[i]!
      const b = allPts[i + 1]!
      const mid = a.clone().add(b).multiplyScalar(0.5)
      const ang = Math.atan2(b.y - a.y, b.x - a.x)
      const vous = new THREE.Mesh(new THREE.BoxGeometry(a.distanceTo(b) * 1.15, 0.75, CASTLE.wallT + 1.3), stoneDark)
      vous.position.set(east + 0.2, 0, 0)
      vous.position.z = -mid.x // shape x → 월드 -z (성문루 회전과 일치)
      vous.position.y = mid.y
      vous.rotation.x = ang // z축 곡선이므로 x축 회전
      vous.castShadow = true
      scene.add(vous)
    }
    // 쇠창살 (반쯤 내려온 포트컬리스)
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x2c2e36, metalness: 0.75, roughness: 0.5 })
    const grille = new THREE.Group()
    for (let z = -gh2 + 0.35; z <= gh2 - 0.3; z += 0.55) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 6.2, 6), ironMat)
      bar.position.set(0, 3.1, z)
      // 창끝
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 6), ironMat)
      tip.position.set(0, -0.1, z)
      tip.rotation.x = Math.PI
      grille.add(bar, tip)
    }
    for (let y = 1.2; y <= 5.6; y += 1.4) {
      const cross = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, gh2 * 2 - 0.4, 6), ironMat)
      cross.rotation.x = Math.PI / 2
      cross.position.set(0, y, 0)
      grille.add(cross)
    }
    grille.position.set(east, 5.4, 0) // 터널 중앙, 반쯤 올라간 상태
    grille.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true
    })
    scene.add(grille)
  }
  for (const side of [-1, 1]) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7.6, gateHalf * 0.95), wood)
    door.position.set(east + 0.5, 3.8, side * gateHalf * 0.6)
    door.rotation.y = side * 0.55
    door.castShadow = true
    scene.add(door)
  }

  // 망루: 모서리 4 + 성문 좌우 2 (원통 + 원뿔 지붕 + 깃발)
  // 동쪽 원통 망루는 보도 시야를 가려 전부 제거 — 서쪽(후방 실루엣)만 유지
  const towers: [number, number, boolean][] = [
    [west - 2.5, north - 1.5, true],
    [west - 2.5, south + 1.5, true],
  ]
  for (const [ti, [tx, tz, big]] of towers.entries()) {
    const r = big ? 3.6 : 2.4
    const h = big ? 26 : 18 // 모서리 탑은 안개 속으로, 성문탑은 절제
    const tower = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.9, r, h, 24, 16),
      pbrDisplaced('bricks', (r * 6.28) / 5.5, h / 5.5, 0.2, { color: 0x9aa0b0 }),
    )
    tower.position.set(tx, h / 2, tz)
    tower.castShadow = true
    tower.receiveShadow = true
    decor.occluders.push(tower)
    scene.add(tower)
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.08, r * 1.08, 0.9, 12), stoneDark)
    rim.position.set(tx, h - 0.2, tz)
    rim.castShadow = true
    scene.add(rim)
    const roof = new THREE.Mesh(new THREE.ConeGeometry(r * 1.15, big ? 9 : 7, 12), roofMat)
    roof.position.set(tx, h + (big ? 4.5 : 3.5), tz)
    roof.castShadow = true
    scene.add(roof)
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 6), wood)
    pole.position.set(tx, h + (big ? 10.5 : 8.5), tz)
    scene.add(pole)
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.7, 0.95),
      new THREE.MeshStandardMaterial({ color: 0x4e1616, side: THREE.DoubleSide, roughness: 0.85 }),
    )
    flag.position.set(tx + 1, h + (big ? 11 : 9), tz)
    decor.flags.push(flag)
    scene.add(flag)
    void ti
  }

  // 횃불 (성문 양옆 + 동벽) — 포인트 라이트 4개 제한
  for (const tz of [-gateHalf - 1, gateHalf + 1, -12, 12]) {
    const light = new THREE.PointLight(0xff8838, 20, 14, 1.9)
    light.position.set(east + CASTLE.wallT / 2 + 0.6, 6.4, tz)
    decor.torchLights.push(light)
    scene.add(light)
  }

  // 내성: 대성당형 본성 — 첨탑 군집이 밤하늘 실루엣을 만든다
  const keep = new THREE.Mesh(
    new THREE.BoxGeometry(9, 26, 13),
    pbrDisplaced('bricks', 13 / 5.5, 26 / 5.5, 0.2, { color: 0x9aa0b0 }),
  )
  keep.position.set(west + 6, 13, 0)
  keep.castShadow = true
  keep.receiveShadow = true
  decor.occluders.push(keep)
  scene.add(keep)
  const keepRoof = new THREE.Mesh(new THREE.ConeGeometry(8, 10, 4), roofMat)
  keepRoof.position.set(west + 6, 31, 0)
  keepRoof.rotation.y = Math.PI / 4
  keepRoof.castShadow = true
  scene.add(keepRoof)
  // 측면 첨탑 4기 (높이 차등 — 고딕 실루엣)
  for (const [si, [sx, sz, sh]] of ([
    [west + 2.5, -5.5, 34],
    [west + 2.5, 5.5, 30],
    [west + 9.5, -5.5, 28],
    [west + 9.5, 5.5, 36],
  ] as const).entries()) {
    const spireBody = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.4, sh, 8),
      pbr('bricks', 1.6, sh / 5.5, { color: 0x9aa0b0 }),
    )
    spireBody.position.set(sx, sh / 2, sz)
    spireBody.castShadow = true
    decor.occluders.push(spireBody)
    scene.add(spireBody)
    const spireTop = new THREE.Mesh(new THREE.ConeGeometry(1.5, 6, 8), roofMat)
    spireTop.position.set(sx, sh + 3, sz)
    spireTop.castShadow = true
    scene.add(spireTop)
    void si
  }
  for (const [wy, wz] of [
    [12, -3],
    [12, 3],
    [18, 0],
    [22, -3],
    [22, 3],
  ] as const) {
    const win = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 1.8),
      new THREE.MeshBasicMaterial({ color: 0xffc060 }),
    )
    win.position.set(west + 10.52, wy, wz)
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

  // 세로 대형 깃발 — 동벽에 늘어진 낡은 문장기 (다크소울 문법)
  for (const bz of [-10.5, 0, 10.5]) {
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 11),
      new THREE.MeshStandardMaterial({ color: 0x30100e, side: THREE.DoubleSide, roughness: 0.98 }),
    )
    banner.position.set(east + CASTLE.wallT / 2 + 0.12, wallH - 6.5, bz)
    banner.rotation.y = Math.PI / 2
    decor.flags.push(banner)
    scene.add(banner)
    // 문장 (밝은 마름모)
    const emblem = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 1.1),
      new THREE.MeshStandardMaterial({ color: 0x6a5830, side: THREE.DoubleSide, roughness: 0.85 }),
    )
    emblem.position.set(east + CASTLE.wallT / 2 + 0.16, wallH - 4.5, bz)
    emblem.rotation.y = Math.PI / 2
    emblem.rotation.z = Math.PI / 4
    scene.add(emblem)
  }

  // 성문 양옆 거대 석상 — 두건 쓴 파수꾼 (절차 조합, 6m)
  for (const side of [-1, 1]) {
    const g = new THREE.Group()
    const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.6, 4.2, 8), stoneDark)
    robe.position.y = 2.1
    const shoulders = new THREE.Mesh(new THREE.SphereGeometry(1.0, 8, 6), stoneDark)
    shoulders.position.y = 4.3
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.6, 8), stoneDark)
    hood.position.y = 5.4
    const swordBlade = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.6, 0.5), stoneDark)
    swordBlade.position.set(0, 1.8, 1.15)
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(3, 1.1, 3), stone)
    pedestal.position.y = 0.55
    for (const mm of [robe, shoulders, hood, swordBlade, pedestal]) {
      mm.castShadow = true
      g.add(mm)
    }
    g.position.set(east + CASTLE.wallT / 2 + 2.2, 0, side * (gateHalf + 4.6))
    g.rotation.y = Math.PI / 2
    scene.add(g)
  }

  // 성벽 계단 2기 (성문 남·북 안쪽 벽면) — sim heightAt와 동일 기울기
  {
    const stepMat = pbr('stone', 1.4, 0.5, { color: 0x9aa0b0 })
    const halfT2 = CASTLE.wallT / 2
    const sx = east - halfT2 - 1.2 // 계단 중심 x (sim 존과 일치)
    const STEPS = 14
    for (const dir of [1, -1]) {
      for (let i = 0; i < STEPS; i++) {
        const z0 = dir * (4.5 + (10.5 * i) / STEPS)
        const h = (wallH * (i + 1)) / STEPS
        const tread = new THREE.Mesh(new THREE.BoxGeometry(2.4, h, (10.5 / STEPS) * 1.05), stepMat)
        tread.position.set(sx, h / 2, z0 + (dir * (10.5 / STEPS)) / 2)
        tread.castShadow = true
        tread.receiveShadow = true
        scene.add(tread)
      }
      // 난간 (바깥쪽)
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.9, 10.8),
        new THREE.MeshStandardMaterial({ color: 0x3e3e50, roughness: 0.9 }),
      )
      rail.position.set(sx - 1.25, wallH / 2 + 0.45, dir * 9.75)
      rail.rotation.x = dir * -Math.atan2(wallH, 10.5)
      rail.castShadow = true
      scene.add(rail)
    }
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
  const grassMat = pbr('grass', 44, 30, { color: 0x787866 }) // 죽은 들판 — 잿빛 감쇠
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD.maxX - FIELD.minX + 90, FIELD.maxZ - FIELD.minZ + 70),
    grassMat,
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.set((FIELD.minX + FIELD.maxX) / 2, 0, 0)
  ground.receiveShadow = true
  scene.add(ground)

  // 흙길: 동쪽 지평 → 성문
  const dirtMat = pbr('dirt', 14, 2, { color: 0x9a9088 })
  const road = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.maxX - CASTLE.east + 20, 5.5), dirtMat)
  road.rotation.x = -Math.PI / 2
  road.position.set((CASTLE.east + FIELD.maxX) / 2 + 10, 0.02, 0)
  road.receiveShadow = true
  scene.add(road)

  // 안뜰 돌바닥 (PBR 포석)
  const paveMat = pbr('stone', 14, 16, { color: 0xa0a8b8 })
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
