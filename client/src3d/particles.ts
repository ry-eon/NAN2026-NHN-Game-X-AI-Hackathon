// 전투 입자 FX — 연기·먼지·파편. 포스트 패스 없음, 할당 없음(고정 풀 재사용).
//
// 성능 규칙(08-status §렌더 핵심): 개발기 GPU는 Intel UHD 630 = fill-rate 한계.
// 그래서 (1) 전화면 효과 금지, (2) 스프라이트는 작고 짧게, (3) 동시 개수를 풀 크기로 못박는다.
// 풀이 꽉 차면 가장 오래된 입자를 재활용한다 — 프레임마다 늘어나는 일이 없다.
//
// 난수는 환경 배치와 같은 해시 방식(인덱스+소금)을 쓴다. sim은 이 파일을 모른다 (연출 전용).

import * as THREE from 'three'

const hash01 = (i: number, salt: number): number =>
  ((((i * 73856093) ^ (salt * 19349663)) >>> 0) % 1000) / 1000

const SMOKE_MAX = 48
const DEBRIS_MAX = 96
const GRAVITY = 17

/** 부드러운 연기 알파 — 원형 그라데이션 + 뭉게 덩어리 3개 (단색 원보다 연기처럼 보인다) */
function smokeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const ctx = c.getContext('2d')!
  const blob = (cx: number, cy: number, r: number, a: number): void => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    g.addColorStop(0, `rgba(255,255,255,${a})`)
    g.addColorStop(0.55, `rgba(255,255,255,${a * 0.45})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 64, 64)
  }
  blob(32, 34, 26, 0.85)
  blob(24, 26, 16, 0.5)
  blob(42, 30, 14, 0.45)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

interface Smoke {
  sprite: THREE.Sprite
  mat: THREE.SpriteMaterial
  t0: number
  dur: number
  s0: number
  s1: number
  vx: number
  vy: number
  vz: number
  x: number
  y: number
  z: number
  op: number
  live: boolean
}

interface Debris {
  mesh: THREE.Mesh
  t0: number
  dur: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  spin: number
  floorY: number
  sLand: number // 바닥에 닿는 시각(초) — 그 뒤로는 수평 이동도 멈춘다
  scale: number
  live: boolean
}

export interface SmokeOpts {
  count?: number
  scale?: number // 시작 크기 (끝 크기는 이것의 2.4배)
  rise?: number // 상승 속도 (m/s)
  spread?: number // 초기 확산 반경
  dur?: number
  tint?: number
  opacity?: number
}

export interface DebrisOpts {
  count?: number
  speed?: number
  kind?: 'stone' | 'dirt' | 'ember'
  floorY?: number // 조각이 쌓일 바닥 높이 (성벽 위면 11)
  dirX?: number // 튀는 방향 편향 (성벽 파편은 바깥으로)
  dirZ?: number
}

export interface Particles {
  /** 연기·먼지 — 위치와 옵션만. 나머지는 풀이 알아서 */
  smoke(x: number, y: number, z: number, o?: SmokeOpts): void
  /** 파편 — 포물선으로 튀었다가 바닥에 눕는다 */
  debris(x: number, y: number, z: number, o?: DebrisOpts): void
  update(now: number): void
}

export function createParticles(scene: THREE.Scene): Particles {
  const tex = smokeTexture()
  const smokes: Smoke[] = []
  const debrisPool: Debris[] = []
  let seq = 0 // 해시 난수용 인덱스 — 입자마다 다른 흩어짐

  for (let i = 0; i < SMOKE_MAX; i++) {
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false, // 연기끼리 z-싸움 없이 겹치게
      opacity: 0,
    })
    const sprite = new THREE.Sprite(mat)
    sprite.visible = false
    sprite.renderOrder = 5
    scene.add(sprite)
    smokes.push({ sprite, mat, t0: 0, dur: 1, s0: 1, s1: 1, vx: 0, vy: 0, vz: 0, x: 0, y: 0, z: 0, op: 1, live: false })
  }

  // 파편은 형상 2종(각진 돌·납작한 흙덩이)을 공유 — 지오메트리·머티리얼 모두 풀 공용
  const chipGeo = new THREE.TetrahedronGeometry(0.13)
  const slabGeo = new THREE.BoxGeometry(0.16, 0.06, 0.12)
  const MATS = {
    stone: new THREE.MeshStandardMaterial({ color: 0x8d8b86, roughness: 0.9 }),
    dirt: new THREE.MeshStandardMaterial({ color: 0x4c4030, roughness: 0.95 }),
    ember: new THREE.MeshBasicMaterial({ color: 0xff9040 }),
  }
  for (let i = 0; i < DEBRIS_MAX; i++) {
    const mesh = new THREE.Mesh(i % 2 ? chipGeo : slabGeo, MATS.stone)
    mesh.visible = false
    scene.add(mesh)
    debrisPool.push({ mesh, t0: 0, dur: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, floorY: 0, sLand: 0, scale: 1, live: false })
  }

  /** 빈 슬롯 우선, 없으면 가장 오래된 것을 뺏는다 (프레임 예산이 늘어나지 않게) */
  function take<T extends { t0: number; live: boolean }>(pool: T[]): T {
    let oldest = pool[0]!
    for (const p of pool) {
      if (!p.live) return p
      if (p.t0 < oldest.t0) oldest = p
    }
    return oldest
  }

  return {
    smoke(x, y, z, o = {}) {
      const count = o.count ?? 3
      const scale = o.scale ?? 1
      const spread = o.spread ?? 0.35
      const now = performance.now()
      for (let k = 0; k < count; k++) {
        const i = seq++
        const p = take(smokes)
        p.live = true
        p.t0 = now
        p.dur = (o.dur ?? 1100) * (0.75 + hash01(i, 11) * 0.5)
        p.s0 = scale * (0.55 + hash01(i, 12) * 0.4)
        p.s1 = p.s0 * 2.4
        p.x = x + (hash01(i, 13) - 0.5) * spread * 2
        p.y = y + (hash01(i, 14) - 0.5) * spread
        p.z = z + (hash01(i, 15) - 0.5) * spread * 2
        p.vx = (hash01(i, 16) - 0.5) * 0.7
        p.vy = (o.rise ?? 0.9) * (0.7 + hash01(i, 17) * 0.6)
        p.vz = (hash01(i, 18) - 0.5) * 0.7
        p.op = o.opacity ?? 0.5
        p.mat.color.setHex(o.tint ?? 0xb8b2a6)
        p.sprite.visible = true
      }
    },

    debris(x, y, z, o = {}) {
      const count = o.count ?? 6
      const speed = o.speed ?? 4
      const kind = o.kind ?? 'stone'
      const now = performance.now()
      for (let k = 0; k < count; k++) {
        const i = seq++
        const p = take(debrisPool)
        p.live = true
        p.t0 = now
        p.dur = 1200 + hash01(i, 21) * 700
        p.x = x
        p.y = y
        p.z = z
        // 반구 방향 + 요청된 편향 (성벽 파편은 벽 바깥으로 튀어야 읽힌다)
        const ang = hash01(i, 22) * Math.PI * 2
        const sp = speed * (0.5 + hash01(i, 23) * 0.8)
        p.vx = Math.sin(ang) * sp * 0.6 + (o.dirX ?? 0) * sp * 0.7
        p.vz = Math.cos(ang) * sp * 0.6 + (o.dirZ ?? 0) * sp * 0.7
        p.vy = sp * (0.55 + hash01(i, 24) * 0.5)
        p.spin = (hash01(i, 25) - 0.5) * 26
        p.floorY = o.floorY ?? 0
        p.sLand = (p.vy + Math.sqrt(p.vy * p.vy + 2 * GRAVITY * Math.max(0, p.y - p.floorY))) / GRAVITY
        p.scale = kind === 'ember' ? 0.45 : 0.7 + hash01(i, 26) * 0.7
        p.mesh.material = MATS[kind]
        p.mesh.scale.setScalar(p.scale)
        p.mesh.visible = true
      }
    },

    update(now) {
      for (const p of smokes) {
        if (!p.live) continue
        const t = (now - p.t0) / p.dur
        if (t >= 1) {
          p.live = false
          p.sprite.visible = false
          continue
        }
        // 처음에 빠르게 퍼졌다 느려진다(감속) — 연기가 공기에 붙는 느낌
        const e = 1 - (1 - t) * (1 - t)
        const s = (p.dur / 1000) * e
        p.sprite.position.set(p.x + p.vx * s, p.y + p.vy * s, p.z + p.vz * s)
        p.sprite.scale.setScalar(p.s0 + (p.s1 - p.s0) * e)
        // 짧게 차올랐다가 길게 사라진다
        p.mat.opacity = p.op * Math.min(1, t * 8) * (1 - t) * (1 - t)
      }
      for (const p of debrisPool) {
        if (!p.live) continue
        const t = (now - p.t0) / p.dur
        if (t >= 1) {
          p.live = false
          p.mesh.visible = false
          continue
        }
        const s = (t * p.dur) / 1000
        // 바닥에 닿은 뒤로는 시간이 멈춘 것처럼 그 자리에 눕는다 (물리 시늉만, 구르지 않음)
        const se = Math.min(s, p.sLand)
        const y = p.y + p.vy * se - 0.5 * GRAVITY * se * se
        p.mesh.position.set(p.x + p.vx * se, y + 0.05 * p.scale, p.z + p.vz * se)
        p.mesh.rotation.set(p.spin * se, p.spin * se * 0.6, p.spin * se * 0.3)
        // 말미 25%에 오그라들며 사라진다 (머티리얼 공유라 개별 페이드는 못 한다)
        const k = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1
        p.mesh.scale.setScalar(p.scale * k)
      }
    },
  }
}
