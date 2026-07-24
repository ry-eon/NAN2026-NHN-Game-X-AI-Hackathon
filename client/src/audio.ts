// 절차적 사운드 — 외부 에셋 0 원칙 유지 (docs/asset-licenses.md).
// WebAudio 오실레이터+노이즈 합성. 브라우저 정책상 첫 사용자 제스처에서 unlock 필요.
// 연타(다중 명중)로 인한 소음 폭주는 종류별 최소 간격으로 스로틀한다.

type SfxName =
  | 'click' // UI
  | 'deploy'
  | 'withdraw'
  | 'shoot' // 원거리 공격
  | 'slash' // 근접 공격
  | 'thud' // 아군 피격
  | 'enemyDie'
  | 'unitDie'
  | 'wallHit'
  | 'rockfall' // 낙석
  | 'repair'
  | 'heal'
  | 'skill' // 캐릭터 액티브
  | 'recruit'
  | 'victory'
  | 'defeat'

/** 종류별 최소 재생 간격(ms) — 광역·다중 명중 프레임의 소음 폭주 방지 */
const THROTTLE: Partial<Record<SfxName, number>> = {
  shoot: 45,
  slash: 60,
  thud: 70,
  enemyDie: 50,
  heal: 250,
}

class SoundKit {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private lastPlayed = new Map<string, number>()
  muted = false

  /** 첫 포인터 입력에서 호출 — AudioContext 생성/재개 */
  unlock(): void {
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext()
        this.master = this.ctx.createGain()
        this.master.gain.value = 0.28
        this.master.connect(this.ctx.destination)
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume()
    } catch {
      // 오디오 불가 환경(헤드리스 등) — 무음으로 진행
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted
    return this.muted
  }

  play(name: SfxName): void {
    if (this.muted || !this.ctx || !this.master || this.ctx.state !== 'running') return
    const gap = THROTTLE[name]
    if (gap) {
      const now = performance.now()
      if (now - (this.lastPlayed.get(name) ?? 0) < gap) return
      this.lastPlayed.set(name, now)
    }
    switch (name) {
      case 'click':
        this.tone({ freq: 660, end: 660, dur: 0.04, type: 'square', vol: 0.12 })
        break
      case 'deploy':
        this.tone({ freq: 240, end: 480, dur: 0.09, type: 'square', vol: 0.2 })
        break
      case 'withdraw':
        this.tone({ freq: 480, end: 240, dur: 0.09, type: 'square', vol: 0.16 })
        break
      case 'shoot':
        this.tone({ freq: 900, end: 1400, dur: 0.03, type: 'square', vol: 0.07 })
        break
      case 'slash':
        this.noise({ dur: 0.05, vol: 0.12, filter: 2600 })
        break
      case 'thud':
        this.tone({ freq: 150, end: 90, dur: 0.08, type: 'triangle', vol: 0.16 })
        break
      case 'enemyDie':
        this.tone({ freq: 320, end: 70, dur: 0.14, type: 'sawtooth', vol: 0.14 })
        this.noise({ dur: 0.08, vol: 0.08, filter: 1200 })
        break
      case 'unitDie':
        this.tone({ freq: 260, end: 50, dur: 0.3, type: 'sawtooth', vol: 0.22 })
        this.noise({ dur: 0.18, vol: 0.12, filter: 900 })
        break
      case 'wallHit':
        this.tone({ freq: 70, end: 40, dur: 0.28, type: 'sine', vol: 0.3 })
        this.noise({ dur: 0.1, vol: 0.1, filter: 500 })
        break
      case 'rockfall':
        this.noise({ dur: 0.35, vol: 0.28, filter: 700 })
        this.tone({ freq: 90, end: 35, dur: 0.4, type: 'sine', vol: 0.3, delay: 0.03 })
        break
      case 'repair':
        this.tone({ freq: 420, end: 420, dur: 0.06, type: 'square', vol: 0.12 })
        this.tone({ freq: 630, end: 630, dur: 0.08, type: 'square', vol: 0.12, delay: 0.07 })
        break
      case 'heal':
        this.tone({ freq: 520, end: 820, dur: 0.12, type: 'sine', vol: 0.08 })
        break
      case 'skill':
        this.tone({ freq: 500, end: 1000, dur: 0.12, type: 'square', vol: 0.18 })
        this.tone({ freq: 750, end: 1500, dur: 0.1, type: 'square', vol: 0.1, delay: 0.05 })
        break
      case 'recruit':
        this.arpeggio([392, 494, 587], 0.09, 0.16)
        break
      case 'victory':
        this.arpeggio([392, 494, 587, 784], 0.11, 0.2)
        break
      case 'defeat':
        this.arpeggio([330, 262, 196], 0.16, 0.2, 'sawtooth')
        break
    }
  }

  private tone(o: {
    freq: number
    end: number
    dur: number
    type: OscillatorType
    vol: number
    delay?: number
  }): void {
    const ctx = this.ctx!
    const t0 = ctx.currentTime + (o.delay ?? 0)
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = o.type
    osc.frequency.setValueAtTime(o.freq, t0)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.end), t0 + o.dur)
    gain.gain.setValueAtTime(o.vol, t0)
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + o.dur)
    osc.connect(gain).connect(this.master!)
    osc.start(t0)
    osc.stop(t0 + o.dur + 0.02)
  }

  private noise(o: { dur: number; vol: number; filter: number; delay?: number }): void {
    const ctx = this.ctx!
    const t0 = ctx.currentTime + (o.delay ?? 0)
    const len = Math.max(1, Math.floor(ctx.sampleRate * o.dur))
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1 // 연출용 — 결정론 무관(core 밖)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = o.filter
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(o.vol, t0)
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + o.dur)
    src.connect(filter).connect(gain).connect(this.master!)
    src.start(t0)
  }

  private arpeggio(freqs: number[], step: number, vol: number, type: OscillatorType = 'square'): void {
    freqs.forEach((f, i) =>
      this.tone({ freq: f, end: f, dur: step * 1.1, type, vol, delay: i * step }),
    )
  }
}

export const Sfx = new SoundKit()
