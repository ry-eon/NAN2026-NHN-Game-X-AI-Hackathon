// W1 최소 렌더러: 사각형+원+텍스트로 core 상태를 그린다.
// 규칙 (docs/03-architecture.md): 게임 룰 로직 금지 —
//   - 배치 유효성 판단은 전부 core가 하고, client는 반려 이벤트를 토스트로 보여줄 뿐이다.
//   - 시뮬레이션은 고정 틱(TICKS_PER_SECOND)으로 core.step()을 돌리고, 입력은
//     {tick, action} 시퀀스로 큐잉된다 (봇·리플레이와 동일한 입력 형식).

import Phaser from 'phaser'
import {
  ENEMY_DEFS,
  STAGES,
  Simulation,
  TICKS_PER_SECOND,
  UNIT_DEFS,
  enemyWorldPos,
} from '@core'
import type { DeployRejectReason, PlayerAction, TimedAction, TileType, UnitDef } from '@core'

const GRID_X = 20
const GRID_Y = 64
/** 그리드가 차지할 수 있는 최대 픽셀 영역 (우측 HUD·하단 카드와 겹치지 않게) */
const GRID_MAX_W = 620
const GRID_MAX_H = 415
const STEP_MS = 1000 / TICKS_PER_SECOND

const TILE_COLORS: Record<TileType, number> = {
  ground: 0x32324a,
  road: 0x63523a,
  wallTop: 0x4a4a68,
  blocked: 0x14141f,
}
const UNIT_COLORS: Record<string, number> = {
  blocker: 0x4e9a5a,
  bruiser: 0xc4644a,
  archer: 0x5aa0d0,
  mage: 0x8a5ad0,
  healer: 0x5ad0a0,
  slower: 0xd0c05a,
}
const ENEMY_STYLE: Record<string, { color: number; radius: number }> = {
  grunt: { color: 0xd05a5a, radius: 13 },
  runner: { color: 0xe0a050, radius: 9 },
  tank: { color: 0x9a4ad0, radius: 17 },
  siege: { color: 0xd07a3a, radius: 15 },
}
const REJECT_LABELS: Record<DeployRejectReason, string> = {
  insufficientCost: '코스트 부족',
  invalidTile: '배치할 수 없는 타일',
  occupied: '이미 유닛이 있음',
  onCooldown: '재배치 대기 중',
  unknownUnit: '알 수 없는 유닛',
  gameOver: '게임 종료됨',
}

interface UnitCard {
  def: UnitDef
  bg: Phaser.GameObjects.Rectangle
  label: Phaser.GameObjects.Text
  sub: Phaser.GameObjects.Text
}

export class BattleScene extends Phaser.Scene {
  private sim!: Simulation
  private queued: PlayerAction[] = []
  private actionLog: TimedAction[] = []
  private accMs = 0
  private selectedDefId: string | null = null
  private hoverCell: { x: number; y: number } | null = null
  private gfx!: Phaser.GameObjects.Graphics
  private hud!: Record<'time' | 'wall' | 'wave' | 'cost' | 'status', Phaser.GameObjects.Text>
  private cards: UnitCard[] = []
  private overlayShown = false
  /** scene.restart() 후에도 유지 — 선택한 스테이지 */
  private stageIndex = 0
  /** 스테이지 크기에 맞춘 타일 픽셀 (create에서 계산) */
  private tile = 60

  constructor() {
    super('battle')
  }

  create(): void {
    const stage = STAGES[this.stageIndex] ?? STAGES[0]!
    this.sim = new Simulation(stage, UNIT_DEFS, ENEMY_DEFS)
    this.tile = Math.min(
      60,
      Math.floor(GRID_MAX_W / this.sim.ctx.width),
      Math.floor(GRID_MAX_H / this.sim.ctx.height),
    )
    this.queued = []
    this.actionLog = []
    this.accMs = 0
    this.selectedDefId = null
    this.hoverCell = null
    this.overlayShown = false
    this.cards = [] // scene.restart()는 인스턴스를 재사용하므로 초기화 필수

    this.drawStaticGrid()
    this.createHud()
    this.createCards()
    this.gfx = this.add.graphics().setDepth(10)
    this.bindInput()
  }

  // ---------------------------------------------------------------- 입력

  private bindInput(): void {
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      this.hoverCell = this.cellAt(p.x, p.y)
    })
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const cell = this.cellAt(p.x, p.y)
      if (!cell) return
      if (this.selectedDefId) {
        this.queue({ type: 'deploy', unitDefId: this.selectedDefId, x: cell.x, y: cell.y })
        this.selectedDefId = null
      } else {
        // 클릭한 셀의 아군 유닛 철수. "그 셀에 유닛이 있는가"는 상태 조회일 뿐 룰 판단이 아니다.
        const unit = this.sim.state.units.find((u) => u.x === cell.x && u.y === cell.y)
        if (unit) this.queue({ type: 'withdraw', unitId: unit.id })
      }
    })
    const kb = this.input.keyboard
    if (kb) {
      const keys = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'] as const
      keys.forEach((key, i) => {
        kb.on(`keydown-${key}`, () => this.selectCard(UNIT_DEFS[i]?.id ?? null))
      })
      kb.on('keydown-ESC', () => this.selectCard(null))
    }
  }

  private queue(action: PlayerAction): void {
    this.queued.push(action)
    this.actionLog.push({ tick: this.sim.state.tick + 1, action })
  }

  private selectCard(defId: string | null): void {
    this.selectedDefId = this.selectedDefId === defId ? null : defId
  }

  private cellAt(px: number, py: number): { x: number; y: number } | null {
    const x = Math.floor((px - GRID_X) / this.tile)
    const y = Math.floor((py - GRID_Y) / this.tile)
    if (x < 0 || y < 0 || x >= this.sim.ctx.width || y >= this.sim.ctx.height) return null
    return { x, y }
  }

  // ---------------------------------------------------------------- 시뮬 구동

  update(_time: number, delta: number): void {
    if (this.sim.state.status === 'playing') {
      this.accMs = Math.min(this.accMs + delta, STEP_MS * 6) // 프레임 드랍 시 폭주 방지
      while (this.accMs >= STEP_MS) {
        this.accMs -= STEP_MS
        this.sim.step(this.queued)
        this.queued = []
        this.consumeEvents()
      }
    } else if (!this.overlayShown) {
      this.showOverlay()
    }
    this.render()
  }

  private consumeEvents(): void {
    for (const e of this.sim.state.events) {
      if (e.type === 'deployRejected') this.toast(REJECT_LABELS[e.reason])
      else if (e.type === 'unitDied') this.toast('유닛 격파당함!')
    }
  }

  // ---------------------------------------------------------------- 렌더링

  private drawStaticGrid(): void {
    const g = this.add.graphics().setDepth(0)
    const { tiles, width, height } = this.sim.ctx
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const t = tiles[y]?.[x]
        if (!t) continue
        g.fillStyle(TILE_COLORS[t], 1)
        g.fillRect(GRID_X + x * this.tile, GRID_Y + y * this.tile, this.tile - 2, this.tile - 2)
      }
    }
    // 진입 방향 안내 (스폰 → 성벽)
    for (const path of this.sim.ctx.stage.paths) {
      const s = path[0]!
      this.add
        .text(GRID_X + s.x * this.tile + this.tile / 2 - 1, GRID_Y + s.y * this.tile + this.tile / 2 - 1, '◀ 침공', {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#ffb0b0',
        })
        .setOrigin(0.5)
        .setDepth(1)
    }
  }

  private createHud(): void {
    const text = (x: number, y: number, size = 14, color = '#c8c8dc') =>
      this.add.text(x, y, '', { fontFamily: 'monospace', fontSize: `${size}px`, color }).setDepth(20)

    const stage = this.sim.ctx.stage
    this.add
      .text(GRID_X, 10, `${stage.name} (${stage.id})`, {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#e8e8f0',
      })
      .setDepth(20)

    // 스테이지 선택 버튼 (우상단) — 생성 스테이지가 늘어도 넘치지 않게 콤팩트 배치
    STAGES.forEach((s, i) => {
      const current = i === this.stageIndex
      const col = i % 8
      const rowY = 12 + Math.floor(i / 8) * 26
      const label = s.id.startsWith('gen-') ? `G${i + 1}` : `${i + 1}`
      const btn = this.add
        .text(672 + col * 36, rowY, label, {
          fontFamily: 'monospace',
          fontSize: '13px',
          color: current ? '#ffd870' : '#8888aa',
          backgroundColor: current ? '#3a3a58' : '#26263c',
          padding: { x: 8, y: 4 },
        })
        .setDepth(20)
      if (!current) {
        btn.setInteractive({ useHandCursor: true })
        btn.on(
          'pointerdown',
          (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
            ev.stopPropagation()
            this.stageIndex = i
            this.scene.restart()
          },
        )
      }
    })

    this.hud = {
      time: text(GRID_X + 320, 12),
      wall: text(GRID_X, 36),
      wave: text(660, 40),
      cost: text(660, 64, 18, '#ffd870'),
      status: text(660, 96),
    }

    this.add
      .text(
        660,
        400,
        '조작\n 1~6 또는 카드 클릭: 유닛 선택\n 타일 클릭: 배치 (core가 검증)\n 배치된 유닛 클릭: 철수(50% 환급)\n ESC: 선택 해제',
        { fontFamily: 'monospace', fontSize: '12px', color: '#8888aa', lineSpacing: 4 },
      )
      .setDepth(20)
  }

  private createCards(): void {
    // 6종 로스터가 한 줄에 들어가는 콤팩트 카드 (96px × 6)
    UNIT_DEFS.forEach((def, i) => {
      const x = GRID_X + i * 102
      const y = 494
      const bg = this.add
        .rectangle(x, y, 96, 42, 0x26263c)
        .setOrigin(0, 0)
        .setStrokeStyle(2, 0x44445f)
        .setDepth(20)
        .setInteractive({ useHandCursor: true })
      bg.on(
        'pointerdown',
        (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
          ev.stopPropagation() // 그리드 클릭 핸들러와 분리
          this.selectCard(def.id)
        },
      )
      this.add
        .rectangle(x + 6, y + 13, 16, 16, UNIT_COLORS[def.id] ?? 0xffffff)
        .setOrigin(0, 0)
        .setDepth(21)
      const label = this.add
        .text(x + 27, y + 5, `${i + 1} ${def.name}`, {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#e8e8f0',
        })
        .setDepth(21)
      const sub = this.add
        .text(x + 27, y + 22, '', { fontFamily: 'monospace', fontSize: '11px', color: '#ffd870' })
        .setDepth(21)
      this.cards.push({ def, bg, label, sub })
    })
  }

  private render(): void {
    const { state, ctx } = this.sim
    const g = this.gfx
    g.clear()

    // 배치 미리보기: 선택한 유닛의 배치 가능 타일 하이라이트 (정의 데이터 표시일 뿐 판정은 core 몫)
    if (this.selectedDefId) {
      const def = ctx.unitDefs[this.selectedDefId]
      if (def) {
        g.fillStyle(0xffffff, 0.08)
        for (let y = 0; y < ctx.height; y++) {
          for (let x = 0; x < ctx.width; x++) {
            const t = ctx.tiles[y]?.[x]
            const ok = def.placement === 'wallTop' ? t === 'wallTop' : t === 'ground' || t === 'road'
            if (ok) g.fillRect(GRID_X + x * this.tile, GRID_Y + y * this.tile, this.tile - 2, this.tile - 2)
          }
        }
      }
    }
    if (this.hoverCell) {
      g.lineStyle(2, 0xffffff, 0.5)
      g.strokeRect(GRID_X + this.hoverCell.x * this.tile, GRID_Y + this.hoverCell.y * this.tile, this.tile - 2, this.tile - 2)
    }

    // 유닛: 사각형 + HP바 + 저지 점
    for (const u of state.units) {
      const def = ctx.unitDefs[u.defId]!
      const px = GRID_X + u.x * this.tile
      const py = GRID_Y + u.y * this.tile
      g.fillStyle(UNIT_COLORS[u.defId] ?? 0xffffff, 1)
      g.fillRect(px + 8, py + 8, this.tile - 18, this.tile - 18)
      this.bar(px + 8, py + this.tile - 8, this.tile - 18, u.hp / def.hp)
      g.fillStyle(0xffffff, 0.9)
      for (let b = 0; b < u.blockedEnemyIds.length; b++) g.fillCircle(px + 14 + b * 10, py + 14, 3)
    }

    // 적: 원 + HP바 (경로 보간 위치, 같은 셀에 겹치면 id로 살짝 흩뜨림)
    for (const e of state.enemies) {
      const style = ENEMY_STYLE[e.defId] ?? { color: 0xffffff, radius: 12 }
      const pos = enemyWorldPos(ctx, e)
      const px = GRID_X + pos.x * this.tile + this.tile / 2 + ((e.id % 3) - 1) * 8
      const py = GRID_Y + pos.y * this.tile + this.tile / 2 + (((e.id * 7) % 3) - 1) * 6
      g.fillStyle(style.color, 1)
      g.fillCircle(px, py, style.radius)
      const maxHp = ctx.enemyDefs[e.defId]!.hp
      this.bar(px - 15, py - style.radius - 7, 30, e.hp / maxHp)
    }

    this.renderHud()
  }

  private bar(x: number, y: number, w: number, ratio: number): void {
    const r = Phaser.Math.Clamp(ratio, 0, 1)
    if (r >= 1) return
    this.gfx.fillStyle(0x000000, 0.6)
    this.gfx.fillRect(x, y, w, 4)
    this.gfx.fillStyle(r > 0.5 ? 0x62c462 : r > 0.25 ? 0xe0c050 : 0xd05a5a, 1)
    this.gfx.fillRect(x, y, w * r, 4)
  }

  private renderHud(): void {
    const { state, ctx } = this.sim
    const g = this.gfx

    this.hud.time.setText(`t=${(state.tick / TICKS_PER_SECOND).toFixed(1)}s`)

    // 성벽 HP 바
    const ratio = state.wallHp / ctx.stage.wallHp
    this.hud.wall.setText(`성벽 HP ${state.wallHp}/${ctx.stage.wallHp}`)
    g.fillStyle(0x000000, 0.6)
    g.fillRect(GRID_X + 190, 38, 410, 12)
    g.fillStyle(ratio > 0.5 ? 0x62c462 : ratio > 0.25 ? 0xe0c050 : 0xd05a5a, 1)
    g.fillRect(GRID_X + 190, 38, 410 * Phaser.Math.Clamp(ratio, 0, 1), 12)

    this.hud.wave.setText(
      `스폰 ${state.spawnCursor}/${ctx.stage.spawns.length} · 적 생존 ${state.enemies.length}`,
    )
    this.hud.cost.setText(`코스트 ${Math.floor(state.cost)}`)
    this.hud.status.setText(
      state.status === 'playing' ? '' : state.status === 'won' ? '승리!' : '패배',
    )

    // 카드 상태: 선택 강조, 코스트 부족/쿨다운은 흐리게 (표시용 상태 조회)
    for (const card of this.cards) {
      const cdLeft = (state.redeployReadyAt[card.def.id] ?? 0) - state.tick
      const affordable = state.cost >= card.def.cost
      const selected = this.selectedDefId === card.def.id
      card.bg.setStrokeStyle(2, selected ? 0xffd870 : 0x44445f)
      card.bg.setFillStyle(selected ? 0x3a3a58 : 0x26263c)
      const alpha = cdLeft > 0 || !affordable ? 0.45 : 1
      card.bg.setAlpha(alpha)
      card.label.setAlpha(alpha)
      card.sub.setAlpha(alpha)
      card.sub.setText(
        cdLeft > 0
          ? `대기 ${(cdLeft / TICKS_PER_SECOND).toFixed(1)}s`
          : `코스트 ${card.def.cost}`,
      )
    }
  }

  private toast(msg: string): void {
    const t = this.add
      .text(GRID_X + 300, GRID_Y + 100, msg, {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffb0b0',
        backgroundColor: '#000000aa',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5)
      .setDepth(30)
    this.tweens.add({ targets: t, alpha: 0, y: t.y - 24, duration: 1400, onComplete: () => t.destroy() })
  }

  private showOverlay(): void {
    this.overlayShown = true
    const won = this.sim.state.status === 'won'
    this.add.rectangle(480, 270, 960, 540, 0x000000, 0.55).setDepth(40)
    this.add
      .text(480, 240, won ? '승리!' : '패배', {
        fontFamily: 'monospace',
        fontSize: '48px',
        color: won ? '#8ae08a' : '#e08a8a',
      })
      .setOrigin(0.5)
      .setDepth(41)
    this.add
      .text(480, 300, '클릭하면 다시 시작', { fontFamily: 'monospace', fontSize: '16px', color: '#c8c8dc' })
      .setOrigin(0.5)
      .setDepth(41)
    this.input.once('pointerdown', () => this.scene.restart())
  }
}
