// 절차적 사운드 (v5) — 오디오 파일 0개. WebAudio 오실레이터+노이즈로 실시간 합성한다.
//
// 왜 합성인가: 이 프로젝트는 시각 요소도 전부 코드 생성이고(캐릭터·괴수·성채),
// 외부 에셋은 CC0만 쓴다. 사운드를 합성하면 라이선스·번들 크기·다운로드가 전부 0이 되고
// 같은 원칙이 유지된다 (docs/asset-licenses.md).
//
// 3D라서 레거시 2D 버전과 다른 점 둘:
//   - **거리 감쇠**: 멀리서 터진 대포는 작게 들린다
//   - **스테레오 패닝**: 카메라의 오른쪽 축에 투영해 좌우를 가른다
// 둘 다 렌더 계층이라 sim·결정론과 무관하다.

/** 사운드 종류 — sim 이벤트에 대응 */
export type SfxName =
  | 'cannon' // 대포 발사
  | 'ballista' // 발리스타 발사
  | 'arrow' // 궁수 (현재 출고 편성엔 없지만 프리셋으로 되살릴 수 있다)
  | 'heroSwing' // 영웅 검격
  | 'melee' // 접전 타격
  | 'wallHit' // 성벽 피격
  | 'enemyDie'
  | 'unitDie'
  | 'skill' // 업화
  | 'raise' // 부활 — 유일하게 상승하는 소리
  | 'horn' // 침공 개시
  | 'mount' // 수비병 장착 성사 — 걸쇠 클릭 (장착제 2026-08-08)
  | 'fireball' // 마법사 Q — 짧은 화염 팝
  | 'firewall' // 마법사 W — 낮게 타닥이는 장판 점화
  | 'dash' // 전사 Q — 바람 가르는 돌진
  | 'rally' // 성주 Q/W — 상승 브라스 2음 (버프 = 긍정 신호)
  | 'victory'
  | 'defeat'

/** 종류별 최소 재생 간격(ms) — 광역 피해로 한 프레임에 수십 발이 겹치는 걸 막는다 */
const THROTTLE: Partial<Record<SfxName, number>> = {
  cannon: 70,
  ballista: 60,
  arrow: 40,
  heroSwing: 70,
  melee: 80,
  wallHit: 90,
  enemyDie: 60,
  mount: 120, // 부대 도착으로 여러 병기가 같은 프레임에 장착돼도 걸쇠음이 겹쳐 터지지 않게
}

/** 이 거리를 넘으면 안 들린다 (월드 유닛) */
const MAX_DIST = 62
/** 동시 발성 상한 — 넘으면 새 소리를 버린다 (오디오 스레드 폭주 방지) */
const MAX_VOICES = 20

class SoundKit {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private lastPlayed = new Map<string, number>()
  private voices = 0
  /** 리스너(카메라) 위치와 오른쪽 축 — 매 프레임 갱신 */
  private lx = 0
  private lz = 0
  private rx = 1
  private rz = 0
  muted = false

  /** 첫 사용자 제스처에서 호출 — 브라우저 정책상 그 전에는 소리가 안 난다 */
  unlock(): void {
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext()
        this.master = this.ctx.createGain()
        this.master.gain.value = 0.32
        this.master.connect(this.ctx.destination)
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume()
    } catch {
      // 오디오 불가 환경(헤드리스 등) — 무음으로 계속 진행한다
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.32
    return this.muted
  }

  /** 카메라 위치와 오른쪽 축(월드 XZ)을 넘겨 좌우·거리감을 만든다 */
  setListener(x: number, z: number, rightX: number, rightZ: number): void {
    this.lx = x
    this.lz = z
    const len = Math.hypot(rightX, rightZ) || 1
    this.rx = rightX / len
    this.rz = rightZ / len
  }

  /** 위치 있는 소리 */
  at(name: SfxName, x: number, z: number): void {
    const dx = x - this.lx
    const dz = z - this.lz
    const d = Math.hypot(dx, dz)
    if (d > MAX_DIST) return
    // 가까울수록 크게. 1/(1+d/k) 곡선 — 선형이면 먼 소리가 갑자기 사라진다
    const vol = 1 / (1 + d / 18)
    const pan = Math.max(-0.85, Math.min(0.85, (dx * this.rx + dz * this.rz) / 26))
    this.play(name, vol, pan)
  }

  /** 화면 전체에 걸리는 소리 (개시 뿔피리·승패) */
  global(name: SfxName): void {
    this.play(name, 1, 0)
  }

  private play(name: SfxName, vol: number, pan: number): void {
    if (this.muted || !this.ctx || !this.master || this.ctx.state !== 'running') return
    if (this.voices >= MAX_VOICES) return
    const gap = THROTTLE[name]
    if (gap) {
      const now = performance.now()
      if (now - (this.lastPlayed.get(name) ?? 0) < gap) return
      this.lastPlayed.set(name, now)
    }
    const out = this.ctx.createStereoPanner()
    out.pan.value = pan
    out.connect(this.master)
    const g = vol
    switch (name) {
      case 'cannon':
        // 저역 붐 + 파열 노이즈. 성벽 위에서 나는 가장 큰 소리
        this.tone(out, { freq: 132, end: 34, dur: 0.42, type: 'sine', vol: 0.55 * g })
        this.noise(out, { dur: 0.3, vol: 0.34 * g, filter: 1500, sweepTo: 260 })
        this.tone(out, { freq: 62, end: 28, dur: 0.55, type: 'triangle', vol: 0.3 * g, delay: 0.015 })
        break
      case 'ballista':
        // 굵은 시위 튕김 — 나무·밧줄
        this.noise(out, { dur: 0.09, vol: 0.22 * g, filter: 2600, sweepTo: 700 })
        this.tone(out, { freq: 240, end: 96, dur: 0.14, type: 'triangle', vol: 0.24 * g })
        break
      case 'arrow':
        this.noise(out, { dur: 0.06, vol: 0.14 * g, filter: 4200, sweepTo: 1600 })
        break
      case 'heroSwing':
        this.noise(out, { dur: 0.13, vol: 0.2 * g, filter: 5200, sweepTo: 900 })
        this.tone(out, { freq: 700, end: 300, dur: 0.1, type: 'triangle', vol: 0.12 * g })
        break
      case 'melee':
        // 갑주에 부딪히는 둔탁한 금속
        this.tone(out, { freq: 190, end: 78, dur: 0.1, type: 'square', vol: 0.16 * g })
        this.noise(out, { dur: 0.07, vol: 0.16 * g, filter: 3000, sweepTo: 800 })
        break
      case 'wallHit':
        // 돌이 맞는다 — 아주 낮게, 부스러기 노이즈를 얹어
        this.tone(out, { freq: 78, end: 36, dur: 0.34, type: 'sine', vol: 0.42 * g })
        this.noise(out, { dur: 0.22, vol: 0.2 * g, filter: 900, sweepTo: 320 })
        break
      case 'enemyDie':
        // 짧은 그르렁 하강
        this.tone(out, { freq: 300, end: 62, dur: 0.24, type: 'sawtooth', vol: 0.2 * g })
        this.noise(out, { dur: 0.16, vol: 0.12 * g, filter: 1100 })
        break
      case 'unitDie':
        // 아군은 더 길고 무겁게 — 잃었다는 게 들려야 한다
        this.tone(out, { freq: 220, end: 44, dur: 0.5, type: 'sawtooth', vol: 0.3 * g })
        this.noise(out, { dur: 0.3, vol: 0.16 * g, filter: 800 })
        break
      case 'skill':
        // 업화 — 불이 번지는 스윕 + 저역 충격
        this.noise(out, { dur: 0.65, vol: 0.34 * g, filter: 3200, sweepTo: 240 })
        this.tone(out, { freq: 96, end: 40, dur: 0.6, type: 'triangle', vol: 0.34 * g })
        this.tone(out, { freq: 300, end: 900, dur: 0.22, type: 'sawtooth', vol: 0.12 * g })
        break
      case 'raise':
        // 부활 — 이 게임에서 **유일하게 올라가는 소리**. 죽음(하강)과 반대라 귀로도 구분된다
        this.tone(out, { freq: 70, end: 420, dur: 0.5, type: 'sine', vol: 0.3 * g })
        this.tone(out, { freq: 105, end: 630, dur: 0.5, type: 'triangle', vol: 0.14 * g, delay: 0.04 })
        this.noise(out, { dur: 0.4, vol: 0.12 * g, filter: 600, sweepTo: 2600 })
        break
      case 'horn':
        // 침공 개시 — 뿔피리. 배음을 겹쳐 두껍게
        for (const [f, v, d] of [[146, 0.3, 0], [219, 0.16, 0.01], [292, 0.09, 0.02]] as const) {
          this.tone(out, { freq: f, end: f * 0.97, dur: 1.5, type: 'sawtooth', vol: v * g, delay: d })
        }
        break
      case 'mount':
        // 장착 걸쇠 — 짧은 금속 이중 클릭, 끝이 올라간다 (긍정 피드백. 죽음=하강과 반대)
        this.tone(out, { freq: 340, end: 310, dur: 0.05, type: 'square', vol: 0.11 * g })
        this.tone(out, { freq: 520, end: 660, dur: 0.08, type: 'triangle', vol: 0.15 * g, delay: 0.05 })
        this.noise(out, { dur: 0.04, vol: 0.09 * g, filter: 5200, sweepTo: 2200 })
        break
      case 'fireball':
        // 화염구 — 짧은 휘익 + 팝 (업화의 묵직함과 대비되는 속사감)
        this.noise(out, { dur: 0.16, vol: 0.2 * g, filter: 3800, sweepTo: 700 })
        this.tone(out, { freq: 220, end: 70, dur: 0.18, type: 'triangle', vol: 0.22 * g, delay: 0.04 })
        break
      case 'firewall':
        // 불의 장막 — 낮게 깔리며 오래 타닥거린다 (지속 장판이라 소리도 길다)
        this.noise(out, { dur: 0.85, vol: 0.22 * g, filter: 2200, sweepTo: 500 })
        this.tone(out, { freq: 110, end: 60, dur: 0.7, type: 'triangle', vol: 0.16 * g })
        break
      case 'dash':
        // 돌진 — 바람을 가른다. 고역에서 뚝 떨어지는 스윕
        this.noise(out, { dur: 0.22, vol: 0.24 * g, filter: 6000, sweepTo: 900 })
        this.tone(out, { freq: 480, end: 140, dur: 0.16, type: 'sawtooth', vol: 0.1 * g })
        break
      case 'rally':
        // 군기·나팔 — 상승 브라스 2음. 부활(sine 상승)과 달리 금관 배음
        this.tone(out, { freq: 262, end: 262, dur: 0.16, type: 'sawtooth', vol: 0.16 * g })
        this.tone(out, { freq: 392, end: 392, dur: 0.22, type: 'sawtooth', vol: 0.18 * g, delay: 0.14 })
        break
      case 'victory':
        this.arpeggio(out, [196, 262, 330, 392], 0.16, 0.22 * g, 'triangle')
        break
      case 'defeat':
        this.arpeggio(out, [220, 175, 131, 98], 0.22, 0.24 * g, 'sawtooth')
        break
    }
  }

  private tone(
    dest: AudioNode,
    o: { freq: number; end: number; dur: number; type: OscillatorType; vol: number; delay?: number },
  ): void {
    const ctx = this.ctx!
    const t0 = ctx.currentTime + (o.delay ?? 0)
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = o.type
    osc.frequency.setValueAtTime(o.freq, t0)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.end), t0 + o.dur)
    gain.gain.setValueAtTime(Math.max(0.0001, o.vol), t0)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur)
    osc.connect(gain).connect(dest)
    this.voices++
    osc.onended = () => {
      this.voices--
      gain.disconnect()
    }
    osc.start(t0)
    osc.stop(t0 + o.dur + 0.02)
  }

  private noise(
    dest: AudioNode,
    o: { dur: number; vol: number; filter: number; sweepTo?: number; delay?: number },
  ): void {
    const ctx = this.ctx!
    const t0 = ctx.currentTime + (o.delay ?? 0)
    const len = Math.max(1, Math.floor(ctx.sampleRate * o.dur))
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    // 연출용 난수 — 렌더 계층이라 sim 결정론과 무관하다
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(o.filter, t0)
    if (o.sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(40, o.sweepTo), t0 + o.dur)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(Math.max(0.0001, o.vol), t0)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur)
    src.connect(filter).connect(gain).connect(dest)
    this.voices++
    src.onended = () => {
      this.voices--
      gain.disconnect()
      filter.disconnect()
    }
    src.start(t0)
  }

  private arpeggio(dest: AudioNode, freqs: number[], step: number, vol: number, type: OscillatorType): void {
    freqs.forEach((f, i) => this.tone(dest, { freq: f, end: f, dur: step * 1.2, type, vol, delay: i * step }))
  }
}

export const Sfx = new SoundKit()
