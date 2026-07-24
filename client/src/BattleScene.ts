// W1 최소 렌더러: 사각형+원+텍스트로 core 상태를 그린다.
// 규칙 (docs/03-architecture.md): 게임 룰 로직 금지 —
//   - 배치 유효성 판단은 전부 core가 하고, client는 반려 이벤트를 토스트로 보여줄 뿐이다.
//   - 시뮬레이션은 고정 틱(TICKS_PER_SECOND)으로 core.step()을 돌리고, 입력은
//     {tick, action} 시퀀스로 큐잉된다 (봇·리플레이와 동일한 입력 형식).

import Phaser from 'phaser'
import {
  CHARACTERS,
  CHARACTER_POOL,
  ENEMY_DEFS,
  STAGES,
  Simulation,
  TICKS_PER_SECOND,
  UNIT_DEFS,
  battleRoster,
  characterById,
  currentStage,
  enemyWorldPos,
  newCampaign,
  onDefeat,
  onStageCleared,
  recruit,
  skipRecruit,
} from '@core'
import type {
  CampaignState,
  CharacterDef,
  DeployRejectReason,
  PlayerAction,
  TimedAction,
  UnitDef,
} from '@core'
import { Sfx } from './audio'
import { clearCampaign, loadCampaign, saveCampaign } from './meta/save'
import { ENEMY_SCALE, registerPixelTextures } from './pixel'

const GRID_X = 20
const GRID_Y = 64
/** 그리드가 차지할 수 있는 최대 픽셀 영역 (우측 HUD·하단 카드와 겹치지 않게) */
const GRID_MAX_W = 620
const GRID_MAX_H = 415
const STEP_MS = 1000 / TICKS_PER_SECOND

// 색상은 역할(원형) 기준 — 캐릭터가 늘어나도 역할이 같으면 같은 계열
const ROLE_COLORS: Record<string, number> = {
  blocker: 0x4e9a5a,
  bruiser: 0xc4644a,
  archer: 0x5aa0d0,
  mage: 0x8a5ad0,
  healer: 0x5ad0a0,
  slower: 0xd0c05a,
}
const CHAR_BY_ID = new Map([...CHARACTERS, ...CHARACTER_POOL].map((c) => [c.id, c]))
const colorFor = (defId: string): number =>
  ROLE_COLORS[CHAR_BY_ID.get(defId)?.role ?? defId] ?? 0xffffff
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
const WALL_REJECT_LABELS: Record<string, string> = {
  insufficientCost: '코스트 부족',
  onCooldown: '아직 준비되지 않음',
  wallFull: '성벽이 온전함',
  invalidTarget: '잘못된 목표 지점',
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
  /** 낙석 조준 모드 (버튼/Q 후 타일 클릭 대기) */
  private targetingSkill = false
  private repairBtn!: Phaser.GameObjects.Text
  private skillBtn!: Phaser.GameObjects.Text
  // 연출용 상태: 직전 틱의 엔티티 위치(사망 연출·트레이서용)와 피격 플래시 만료 시각
  private enemyPosMap = new Map<number, { x: number; y: number }>()
  private unitPosMap = new Map<number, { x: number; y: number }>()
  private enemyFlash = new Map<number, number>()
  private unitFlash = new Map<number, number>()
  private wallFlashUntil = 0
  // 픽셀 스프라이트 풀 (entityId → Image). scene.restart 시 오브젝트는 파괴되므로 맵만 비운다
  private unitSprites = new Map<number, Phaser.GameObjects.Image>()
  private enemySprites = new Map<number, Phaser.GameObjects.Image>()
  /** 웨이브 접근 배너 중복 방지 */
  private lastWaveSeen = 0
  /** 동시 데미지 팝업 상한 (연출 과부하 방지) */
  private popupCount = 0
  /** scene.restart() 후에도 유지 — 선택한 스테이지 */
  private stageIndex = 0
  /** 스테이지 크기에 맞춘 타일 픽셀 (create에서 계산) */
  private tile = 60
  // ---- 캠페인 메타 (scene.restart() 후에도 유지) ----
  /** campaign: 연전 진행 / free: 자유 연습 (스테이지 선택) */
  private mode: 'campaign' | 'free' = 'campaign'
  private campaign: CampaignState | null = null
  /** 이번 전투의 배틀 def 목록 (캠페인: 레벨 적용 로스터 / 자유: 수제 6인) */
  private battleDefs: CharacterDef[] = CHARACTERS
  /** 이번 전투에서 배치했던 캐릭터 id (참전 경험치 판정) */
  private deployedCharIds = new Set<string>()
  /** 영입 패널 표시 중 (전투 정지) */
  private recruitOpen = false
  /** 유닛 클릭 메뉴 (기술/이동/철수) 대상 */
  private unitMenuFor: number | null = null
  private menuSkillBtn!: Phaser.GameObjects.Text
  private menuMoveBtn!: Phaser.GameObjects.Text
  private menuWithdrawBtn!: Phaser.GameObjects.Text
  /** 이동 조준 중인 유닛 id (타일 클릭 대기) */
  private movingUnitId: number | null = null

  constructor() {
    super('battle')
  }

  init(data: { mode?: 'campaign' | 'free' }): void {
    if (data.mode) this.mode = data.mode
  }

  create(): void {
    let stage
    let startWallHp: number | undefined
    if (this.mode === 'campaign') {
      this.campaign ??= loadCampaign() ?? newCampaign(Date.now() % 100_000)
      if (this.campaign.status !== 'active') this.campaign = newCampaign(Date.now() % 100_000)
      stage = currentStage(this.campaign)
      this.battleDefs = battleRoster(this.campaign)
      startWallHp = Math.round(this.campaign.wallRatio * stage.wallHp)
    } else {
      stage = STAGES[this.stageIndex] ?? STAGES[0]!
      this.battleDefs = CHARACTERS
    }
    this.sim = new Simulation(stage, this.battleDefs, ENEMY_DEFS, undefined, startWallHp)
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
    this.targetingSkill = false
    this.cards = [] // scene.restart()는 인스턴스를 재사용하므로 초기화 필수
    this.enemyPosMap.clear()
    this.unitPosMap.clear()
    this.enemyFlash.clear()
    this.unitFlash.clear()
    this.wallFlashUntil = 0
    this.deployedCharIds.clear()
    this.recruitOpen = false
    this.unitMenuFor = null
    this.movingUnitId = null
    this.unitSprites.clear()
    this.enemySprites.clear()
    this.lastWaveSeen = 0
    this.popupCount = 0

    registerPixelTextures(this)
    this.drawStaticGrid()
    this.createHud()
    this.createCards()
    this.createUnitMenu()
    this.gfx = this.add.graphics().setDepth(10)
    this.bindInput()
    this.showOnboarding()

    // 재로드 시 영입 선택이 남아 있으면 전투 전에 먼저 처리
    if (this.mode === 'campaign' && this.campaign?.pendingCandidateIds) {
      this.openRecruitPanel()
    }
  }

  // ---------------------------------------------------------------- 입력

  private bindInput(): void {
    this.input.once('pointerdown', () => Sfx.unlock())
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      this.hoverCell = this.cellAt(p.x, p.y)
    })
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.recruitOpen) return
      if (this.unitMenuFor !== null) {
        this.closeUnitMenu()
        return
      }
      const cell = this.cellAt(p.x, p.y)
      if (!cell) return
      if (this.movingUnitId !== null) {
        this.queue({ type: 'moveUnit', unitId: this.movingUnitId, x: cell.x, y: cell.y })
        this.movingUnitId = null
        return
      }
      if (this.targetingSkill) {
        this.queue({ type: 'wallSkill', x: cell.x, y: cell.y })
        this.targetingSkill = false
        return
      }
      if (this.selectedDefId) {
        this.queue({ type: 'deploy', unitDefId: this.selectedDefId, x: cell.x, y: cell.y })
        this.selectedDefId = null
      } else {
        // 아군 유닛 클릭 → 기술/철수 메뉴 (상태 조회일 뿐 룰 판단이 아니다)
        const unit = this.sim.state.units.find((u) => u.x === cell.x && u.y === cell.y)
        if (unit) this.openUnitMenu(unit.id)
      }
    })
    const kb = this.input.keyboard
    if (kb) {
      const keys = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT'] as const
      keys.forEach((key, i) => {
        kb.on(`keydown-${key}`, () => this.selectCard(this.battleDefs[i]?.id ?? null))
      })
      kb.on('keydown-R', () => this.queue({ type: 'repairWall' }))
      kb.on('keydown-Q', () => this.toggleSkillTargeting())
      kb.on('keydown-M', () => this.toast(Sfx.toggleMute() ? '음소거' : '소리 켬'))
      kb.on('keydown-ESC', () => {
        this.selectedDefId = null
        this.targetingSkill = false
        this.movingUnitId = null
        this.closeUnitMenu()
      })
    }
  }

  private queue(action: PlayerAction): void {
    this.queued.push(action)
    this.actionLog.push({ tick: this.sim.state.tick + 1, action })
  }

  private selectCard(defId: string | null): void {
    // 캐릭터 유일성: 이미 전장에 있는 가신은 다시 배치할 수 없다 (메타 규칙)
    if (defId && this.sim.state.units.some((u) => u.defId === defId)) {
      this.toast('이미 전장에 있는 가신입니다')
      return
    }
    this.selectedDefId = this.selectedDefId === defId ? null : defId
    if (defId) this.targetingSkill = false
  }

  private toggleSkillTargeting(): void {
    // 준비 여부 판정은 core가 한다 — 여기선 조준 모드 토글만
    this.targetingSkill = !this.targetingSkill
    if (this.targetingSkill) this.selectedDefId = null
  }

  private cellAt(px: number, py: number): { x: number; y: number } | null {
    const x = Math.floor((px - GRID_X) / this.tile)
    const y = Math.floor((py - GRID_Y) / this.tile)
    if (x < 0 || y < 0 || x >= this.sim.ctx.width || y >= this.sim.ctx.height) return null
    return { x, y }
  }

  // ---------------------------------------------------------------- 시뮬 구동

  update(_time: number, delta: number): void {
    if (this.recruitOpen) {
      this.render()
      return
    }
    if (this.sim.state.status === 'playing') {
      this.accMs = Math.min(this.accMs + delta, STEP_MS * 6) // 프레임 드랍 시 폭주 방지
      while (this.accMs >= STEP_MS) {
        this.accMs -= STEP_MS
        this.snapshotPositions() // 이번 틱에 죽는 엔티티의 연출 위치 확보
        this.sim.step(this.queued)
        this.queued = []
        this.consumeEvents()
      }
    } else if (!this.overlayShown) {
      this.showOverlay()
    }
    this.render()
  }

  private snapshotPositions(): void {
    const { state, ctx } = this.sim
    for (const en of state.enemies) this.enemyPosMap.set(en.id, enemyWorldPos(ctx, en))
    for (const u of state.units) this.unitPosMap.set(u.id, { x: u.x, y: u.y })
  }

  private cellPx(x: number, y: number): { px: number; py: number } {
    return {
      px: GRID_X + x * this.tile + this.tile / 2,
      py: GRID_Y + y * this.tile + this.tile / 2,
    }
  }

  private consumeEvents(): void {
    const now = this.time.now
    for (const e of this.sim.state.events) {
      switch (e.type) {
        case 'deployRejected':
          this.toast(REJECT_LABELS[e.reason])
          break
        case 'deployed': {
          Sfx.play('deploy')
          this.deployRing(e.x, e.y, colorFor(e.unitDefId))
          this.deployedCharIds.add(e.unitDefId)
          const ch = CHAR_BY_ID.get(e.unitDefId)
          if (ch) this.toast(`${ch.name}: "${ch.lines.deploy}"`)
          break
        }
        case 'unitAttacked':
          Sfx.play((this.sim.ctx.unitDefs[e.unitDefId]?.range ?? 0) > 0 ? 'shoot' : 'slash')
          this.attackEffect(e.unitId, e.unitDefId, e.targetIds, now)
          e.targetIds.forEach((tid, i) => {
            const pos = this.enemyPosMap.get(tid)
            if (pos && e.damages[i] !== undefined) {
              const { px, py } = this.cellPx(pos.x, pos.y)
              this.damagePopup(px, py - 14, `${e.damages[i]}`, '#ffe8a0')
            }
          })
          break
        case 'enemyAttacked': {
          Sfx.play('thud')
          this.unitFlash.set(e.targetUnitId, now + 120)
          const u = this.unitPosMap.get(e.targetUnitId)
          if (u && e.damage > 0) {
            const { px, py } = this.cellPx(u.x, u.y)
            this.damagePopup(px, py - 16, `-${e.damage}`, '#ff8a7a')
          }
          break
        }
        case 'unitHealed':
          Sfx.play('heal')
          this.healBeam(e.healerId, e.targetId)
          break
        case 'enemyKilled': {
          Sfx.play('enemyDie')
          const pos = this.enemyPosMap.get(e.enemyId)
          if (pos)
            this.deathBurst(pos.x, pos.y, ENEMY_STYLE[e.enemyDefId]?.color ?? 0xffffff)
          break
        }
        case 'unitMoved':
          Sfx.play('deploy')
          this.deployRing(e.x, e.y, 0xffffff)
          break
        case 'moveRejected':
          this.toast(
            e.reason === 'onCooldown'
              ? '이동: 아직 대기 중'
              : e.reason === 'invalidTile'
                ? '이동: 배치할 수 없는 타일'
                : e.reason === 'occupied'
                  ? '이동: 이미 유닛이 있음'
                  : '이동 불가',
          )
          break
        case 'unitDied': {
          Sfx.play('unitDie')
          this.toast('가신이 쓰러졌다!')
          const pos = this.unitPosMap.get(e.unitId)
          if (pos) this.deathBurst(pos.x, pos.y, 0x9999aa)
          this.cameras.main.shake(120, 0.003)
          break
        }
        case 'enemySpawned':
          if (e.wave > this.lastWaveSeen) {
            this.lastWaveSeen = e.wave
            if (e.wave > 1) this.waveBanner(e.wave)
          }
          break
        case 'wallHit':
          Sfx.play('wallHit')
          this.wallFlashUntil = now + 160
          this.cameras.main.shake(90, 0.002)
          this.damagePopup(GRID_X + 400, 44, `-${e.damage}`, '#ff5a4a')
          break
        case 'wallRepaired':
          Sfx.play('repair')
          this.damagePopup(GRID_X + 400, 44, `+${e.amount}`, '#8ae08a')
          break
        case 'wallActionRejected':
          this.toast(`${e.action === 'repair' ? '수리' : '낙석'}: ${WALL_REJECT_LABELS[e.reason]}`)
          break
        case 'wallSkillFired':
          Sfx.play('rockfall')
          this.blastAt(e.x, e.y)
          this.cameras.main.shake(150, 0.004)
          break
        case 'skillUsed':
          Sfx.play('skill')
          break
        case 'won':
          Sfx.play('victory')
          break
        case 'lost':
          Sfx.play('defeat')
          this.cameras.main.shake(400, 0.008)
          break
        default:
          break
      }
    }
  }

  // ------------------------------------------------------------ 전투 이펙트

  /** 공격 연출: 원거리는 트레이서(술사는 광역 파문 추가), 근접은 슬래시 */
  private attackEffect(unitId: number, unitDefId: string, targetIds: number[], now: number): void {
    const def = this.sim.ctx.unitDefs[unitDefId]
    const from = this.unitPosMap.get(unitId)
    if (!def || !from) return
    const color = colorFor(unitDefId)
    const f = this.cellPx(from.x, from.y)

    for (const tid of targetIds) this.enemyFlash.set(tid, now + 120)

    const firstTarget = targetIds[0] !== undefined ? this.enemyPosMap.get(targetIds[0]) : null
    if (!firstTarget) return
    const t = this.cellPx(firstTarget.x, firstTarget.y)

    if (def.range > 0) {
      const g = this.add.graphics().setDepth(14)
      g.lineStyle(2, color, 0.9)
      g.lineBetween(f.px, f.py, t.px, t.py)
      if (def.aoeRadius) {
        g.lineStyle(2, color, 0.6)
        g.strokeCircle(t.px, t.py, def.aoeRadius * this.tile)
      }
      this.tweens.add({ targets: g, alpha: 0, duration: 160, onComplete: () => g.destroy() })
    } else {
      // 근접 슬래시: 표적 위 짧은 교차선
      const g = this.add.graphics().setDepth(14)
      g.lineStyle(3, 0xffffff, 0.9)
      const r = this.tile * 0.22
      g.lineBetween(t.px - r, t.py - r, t.px + r, t.py + r)
      this.tweens.add({ targets: g, alpha: 0, duration: 130, onComplete: () => g.destroy() })
    }
  }

  private healBeam(healerId: number, targetId: number): void {
    const from = this.unitPosMap.get(healerId)
    const to = this.unitPosMap.get(targetId)
    if (!from || !to) return
    const f = this.cellPx(from.x, from.y)
    const t = this.cellPx(to.x, to.y)
    const g = this.add.graphics().setDepth(14)
    g.lineStyle(2, 0x5ad0a0, 0.8)
    g.lineBetween(f.px, f.py, t.px, t.py)
    g.lineStyle(3, 0x8affce, 1)
    g.lineBetween(t.px - 5, t.py, t.px + 5, t.py)
    g.lineBetween(t.px, t.py - 5, t.px, t.py + 5)
    this.tweens.add({ targets: g, alpha: 0, duration: 300, onComplete: () => g.destroy() })
  }

  /** 사망 버스트: 확장 링 + 픽셀 파편 */
  private deathBurst(x: number, y: number, color: number): void {
    const { px, py } = this.cellPx(x, y)
    const g = this.add.graphics({ x: px, y: py }).setDepth(15)
    g.lineStyle(3, color, 0.9)
    g.strokeCircle(0, 0, this.tile * 0.22)
    g.fillStyle(color, 0.35)
    g.fillCircle(0, 0, this.tile * 0.18)
    this.tweens.add({
      targets: g,
      scale: 2.2,
      alpha: 0,
      duration: 320,
      onComplete: () => g.destroy(),
    })
    this.debris(px, py, color, 6)
  }

  private deployRing(x: number, y: number, color: number): void {
    const { px, py } = this.cellPx(x, y)
    const g = this.add.graphics({ x: px, y: py }).setDepth(15)
    g.lineStyle(2, color, 0.9)
    g.strokeCircle(0, 0, this.tile * 0.45)
    this.tweens.add({
      targets: g,
      scale: 0.4,
      alpha: 0,
      duration: 260,
      onComplete: () => g.destroy(),
    })
  }

  /** 데미지 팝업 — 위로 떠오르며 사라지는 숫자 (동시 40개 상한) */
  private damagePopup(px: number, py: number, text: string, color: string): void {
    if (this.popupCount > 40) return
    this.popupCount++
    const t = this.add
      .text(px + ((py * 7) % 9) - 4, py, text, {
        fontFamily: 'monospace',
        fontSize: '13px',
        fontStyle: 'bold',
        color,
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(32)
    this.tweens.add({
      targets: t,
      y: py - 22,
      alpha: 0,
      duration: 550,
      ease: 'Cubic.out',
      onComplete: () => {
        t.destroy()
        this.popupCount--
      },
    })
  }

  /** 웨이브 접근 배너 — 좌측에서 슬라이드 인 */
  private waveBanner(wave: number): void {
    Sfx.play('click')
    const t = this.add
      .text(-160, 210, `제${wave}파도 접근!`, {
        fontFamily: 'monospace',
        fontSize: '22px',
        fontStyle: 'bold',
        color: '#ffb050',
        backgroundColor: '#000000bb',
        padding: { x: 16, y: 8 },
      })
      .setOrigin(0.5)
      .setDepth(35)
    this.tweens.chain({
      targets: t,
      tweens: [
        { x: 330, duration: 260, ease: 'Back.out' },
        { x: 330, duration: 900 },
        { alpha: 0, x: 380, duration: 300, onComplete: () => t.destroy() },
      ],
    })
  }

  /** 낙석 연출: 바위 낙하 → 착탄 섬광 + 먼지 파편 */
  private blastAt(x: number, y: number): void {
    const px = GRID_X + x * this.tile + this.tile / 2
    const py = GRID_Y + y * this.tile + this.tile / 2
    const r = this.sim.ctx.wallActions.skill.radius * this.tile

    // 낙하하는 바위 (진한 사각 덩어리)
    const rock = this.add
      .rectangle(px + 6, py - 220, 16, 14, 0x6e5a44)
      .setStrokeStyle(2, 0x171720)
      .setDepth(34)
      .setAngle(20)
    this.tweens.add({
      targets: rock,
      y: py,
      x: px,
      angle: 65,
      duration: 200,
      ease: 'Quad.in',
      onComplete: () => {
        rock.destroy()
        const g = this.add.graphics().setDepth(15)
        g.fillStyle(0xffd870, 0.45)
        g.fillCircle(px, py, r)
        g.lineStyle(3, 0xffb050, 1)
        g.strokeCircle(px, py, r)
        this.tweens.add({ targets: g, alpha: 0, duration: 480, onComplete: () => g.destroy() })
        this.debris(px, py, 0x8a7050, 10)
      },
    })
  }

  /** 픽셀 파편 — 사망·착탄의 잔해 (각도는 인덱스 기반, 결정론 무관 연출) */
  private debris(px: number, py: number, color: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const ang = (Math.PI * 2 * i) / count + (i % 2) * 0.4
      const dist = 22 + (i % 3) * 9
      const p = this.add.rectangle(px, py, 4, 4, color).setDepth(16)
      this.tweens.add({
        targets: p,
        x: px + Math.cos(ang) * dist,
        y: py + Math.sin(ang) * dist - 8,
        alpha: 0,
        angle: 90 + i * 40,
        duration: 380 + (i % 4) * 60,
        ease: 'Cubic.out',
        onComplete: () => p.destroy(),
      })
    }
  }

  // ---------------------------------------------------------------- 렌더링

  private drawStaticGrid(): void {
    const { tiles, width, height } = this.sim.ctx
    // UI 패널: 우측 HUD·하단 카드 스트립 배경, 전장 테두리
    this.add
      .rectangle(806, 300, 300, 460, 0x1c1c2e)
      .setStrokeStyle(1, 0x33334e)
      .setDepth(1)
    this.add
      .rectangle(480, 516, 952, 46, 0x1c1c2e)
      .setStrokeStyle(1, 0x33334e)
      .setDepth(1)
    this.add
      .rectangle(
        GRID_X + (width * this.tile) / 2 - 1,
        GRID_Y + (height * this.tile) / 2 - 1,
        width * this.tile + 6,
        height * this.tile + 6,
        0x000000,
        0,
      )
      .setStrokeStyle(2, 0x3a3a56)
      .setDepth(1)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const t = tiles[y]?.[x]
        if (!t) continue
        this.add
          .image(
            GRID_X + x * this.tile + (this.tile - 2) / 2,
            GRID_Y + y * this.tile + (this.tile - 2) / 2,
            `tile-${t}`,
          )
          .setDisplaySize(this.tile - 2, this.tile - 2)
          .setDepth(2)
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
    const title =
      this.mode === 'campaign' && this.campaign
        ? `제${this.campaign.stageIndex + 1}침공/5 — ${stage.name}`
        : `${stage.name} (${stage.id})`
    this.add
      .text(GRID_X, 10, title, {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#e8e8f0',
      })
      .setDepth(20)

    // 타이틀로 돌아가기
    const titleBtn = this.add
      .text(560, 10, '타이틀', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#8888aa',
        backgroundColor: '#26263c',
        padding: { x: 6, y: 3 },
      })
      .setDepth(20)
      .setInteractive({ useHandCursor: true })
    titleBtn.on(
      'pointerdown',
      (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation()
        this.scene.start('title')
      },
    )

    // 우측 HUD (캠페인/자유 공통)
    this.hud = {
      time: text(GRID_X + 320, 12),
      wall: text(GRID_X, 36),
      wave: text(660, 70),
      cost: text(660, 94, 18, '#ffd870'),
      status: text(660, 126),
    }

    // 스테이지 선택 버튼 (자유 연습 전용) — 캠페인은 정해진 침공 순서를 따른다
    if (this.mode !== 'campaign') {
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
    }

    this.createActionButtons()
  }

  private createActionButtons(): void {
    // 성벽 액션 버튼 (수리 / 낙석)
    const makeBtn = (x: number, onClick: () => void) => {
      const btn = this.add
        .text(x, 156, '', {
          fontFamily: 'monospace',
          fontSize: '13px',
          color: '#e8e8f0',
          backgroundColor: '#26263c',
          padding: { x: 8, y: 5 },
        })
        .setDepth(20)
        .setInteractive({ useHandCursor: true })
      btn.on(
        'pointerdown',
        (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
          ev.stopPropagation()
          onClick()
        },
      )
      return btn
    }
    this.repairBtn = makeBtn(660, () => this.queue({ type: 'repairWall' }))
    this.skillBtn = makeBtn(790, () => this.toggleSkillTargeting())

    this.add
      .text(
        660,
        400,
        '조작\n 숫자키/카드 클릭: 가신 선택\n 타일 클릭: 배치 (core가 검증)\n 배치된 가신 클릭: 기술/철수 메뉴\n R: 성벽 수리 · Q: 낙석 조준\n ESC: 선택/메뉴 해제',
        { fontFamily: 'monospace', fontSize: '12px', color: '#8888aa', lineSpacing: 4 },
      )
      .setDepth(20)
  }

  private createCards(): void {
    // 로스터(최대 8)가 한 줄에 들어가는 콤팩트 카드
    this.battleDefs.forEach((def, i) => {
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
      const role = CHAR_BY_ID.get(def.id)?.role ?? def.id
      this.add
        .image(x + 14, y + 21, this.textures.exists(`unit-${role}`) ? `unit-${role}` : 'unit-blocker')
        .setDisplaySize(20, 20)
        .setDepth(21)
      const lv =
        this.mode === 'campaign'
          ? this.campaign?.roster.find((r) => r.charId === def.id)?.level
          : undefined
      const label = this.add
        .text(x + 27, y + 5, `${i + 1} ${def.name}${lv ? ` L${lv}` : ''}`, {
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

    // 메뉴 대상 유닛이 사라졌으면(사망/철수) 메뉴도 닫는다
    if (this.unitMenuFor !== null && !state.units.some((u) => u.id === this.unitMenuFor)) {
      this.closeUnitMenu()
    }

    // 배치/이동 미리보기: 대상 유닛의 배치 가능 타일 하이라이트 (판정은 core 몫)
    const previewDefId =
      this.movingUnitId !== null
        ? state.units.find((u) => u.id === this.movingUnitId)?.defId ?? null
        : this.selectedDefId
    if (previewDefId) {
      const def = ctx.unitDefs[previewDefId]
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
    // 이동 대상 유닛이 사라지면 조준 해제
    if (this.movingUnitId !== null && !state.units.some((u) => u.id === this.movingUnitId)) {
      this.movingUnitId = null
    }
    if (this.hoverCell) {
      g.lineStyle(2, 0xffffff, 0.5)
      g.strokeRect(GRID_X + this.hoverCell.x * this.tile, GRID_Y + this.hoverCell.y * this.tile, this.tile - 2, this.tile - 2)
      // 낙석 조준 중이면 반경 미리보기
      if (this.targetingSkill) {
        const r = ctx.wallActions.skill.radius * this.tile
        g.lineStyle(2, 0xffb050, 0.9)
        g.strokeCircle(
          GRID_X + this.hoverCell.x * this.tile + this.tile / 2,
          GRID_Y + this.hoverCell.y * this.tile + this.tile / 2,
          r,
        )
      }
    }

    const now = this.time.now

    // 유닛: 픽셀 스프라이트 동기화 + HP바 + 저지 점 (+피격 시 적색 틴트)
    for (const u of state.units) {
      const def = ctx.unitDefs[u.defId]!
      const px = GRID_X + u.x * this.tile
      const py = GRID_Y + u.y * this.tile
      let spr = this.unitSprites.get(u.id)
      if (!spr) {
        const role = CHAR_BY_ID.get(u.defId)?.role ?? u.defId
        spr = this.add
          .image(0, 0, this.textures.exists(`unit-${role}`) ? `unit-${role}` : 'unit-blocker')
          .setDepth(5)
        spr.setDisplaySize(this.tile * 0.82, this.tile * 0.82)
        this.unitSprites.set(u.id, spr)
      }
      spr.setPosition(px + this.tile / 2, py + this.tile / 2)
      if ((this.unitFlash.get(u.id) ?? 0) > now) spr.setTintFill(0xff6a5a)
      else spr.clearTint()
      this.bar(px + 8, py + this.tile - 8, this.tile - 18, u.hp / def.hp)
      g.fillStyle(0xffffff, 0.9)
      for (let b = 0; b < u.blockedEnemyIds.length; b++) g.fillCircle(px + 14 + b * 10, py + 14, 3)
    }
    // 사라진 유닛(사망·철수) 스프라이트 정리
    for (const [id, spr] of this.unitSprites) {
      if (!state.units.some((u) => u.id === id)) {
        spr.destroy()
        this.unitSprites.delete(id)
      }
    }

    // 괴수: 픽셀 스프라이트 동기화 (경로 보간 위치, 겹치면 id로 흩뜨림, 피격 시 백색 틴트)
    for (const e of state.enemies) {
      const pos = enemyWorldPos(ctx, e)
      const px = GRID_X + pos.x * this.tile + this.tile / 2 + ((e.id % 3) - 1) * 8
      const py = GRID_Y + pos.y * this.tile + this.tile / 2 + (((e.id * 7) % 3) - 1) * 6
      let spr = this.enemySprites.get(e.id)
      if (!spr) {
        spr = this.add
          .image(0, 0, this.textures.exists(`enemy-${e.defId}`) ? `enemy-${e.defId}` : 'enemy-grunt')
          .setDepth(6)
        const scale = ENEMY_SCALE[e.defId] ?? 0.6
        spr.setDisplaySize(this.tile * scale, this.tile * scale)
        this.enemySprites.set(e.id, spr)
      }
      spr.setPosition(px, py)
      if ((this.enemyFlash.get(e.id) ?? 0) > now) spr.setTintFill(0xffffff)
      else spr.clearTint()
      const maxHp = ctx.enemyDefs[e.defId]!.hp
      this.bar(px - 15, py - (spr.displayHeight / 2) - 7, 30, e.hp / maxHp)
    }
    for (const [id, spr] of this.enemySprites) {
      if (!state.enemies.some((e) => e.id === id)) {
        spr.destroy()
        this.enemySprites.delete(id)
      }
    }

    this.renderHud()

    // 성벽 위기 비네트: 33% 미만이면 화면 가장자리가 붉게 고동친다
    if (state.wallHp < ctx.stage.wallHp * 0.33 && state.status === 'playing') {
      const pulse = 0.10 + 0.08 * Math.sin(this.time.now / 260)
      g.fillStyle(0xff2a1a, pulse)
      g.fillRect(0, 0, 960, 8)
      g.fillRect(0, 532, 960, 8)
      g.fillRect(0, 0, 8, 540)
      g.fillRect(952, 0, 8, 540)
    }
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

    // 성벽 HP 바 (+피격 순간 붉은 플래시)
    const ratio = state.wallHp / ctx.stage.wallHp
    this.hud.wall.setText(`성벽 HP ${state.wallHp}/${ctx.stage.wallHp}`)
    g.fillStyle(0x000000, 0.6)
    g.fillRect(GRID_X + 190, 38, 410, 12)
    g.fillStyle(ratio > 0.5 ? 0x62c462 : ratio > 0.25 ? 0xe0c050 : 0xd05a5a, 1)
    g.fillRect(GRID_X + 190, 38, 410 * Phaser.Math.Clamp(ratio, 0, 1), 12)
    if (this.wallFlashUntil > this.time.now) {
      g.fillStyle(0xff5a4a, 0.5)
      g.fillRect(GRID_X + 190, 38, 410, 12)
    }

    this.hud.wave.setText(
      `스폰 ${state.spawnCursor}/${ctx.stage.spawns.length} · 적 생존 ${state.enemies.length}`,
    )
    this.hud.cost.setText(`코스트 ${Math.floor(state.cost)}`)
    this.hud.status.setText(
      state.status === 'playing' ? '' : state.status === 'won' ? '승리!' : '패배',
    )

    // 성벽 액션 버튼 상태
    const wa = ctx.wallActions
    const repairCd = (state.repairReadyAt - state.tick) / TICKS_PER_SECOND
    const skillCd = (state.wallSkillReadyAt - state.tick) / TICKS_PER_SECOND
    this.repairBtn.setText(
      repairCd > 0 ? `R 수리 ${repairCd.toFixed(0)}s` : `R 수리 (${wa.repair.cost})`,
    )
    this.repairBtn.setAlpha(repairCd > 0 || state.cost < wa.repair.cost ? 0.45 : 1)
    this.skillBtn.setText(skillCd > 0 ? `Q 낙석 ${skillCd.toFixed(0)}s` : 'Q 낙석 준비됨')
    this.skillBtn.setAlpha(skillCd > 0 ? 0.45 : 1)
    this.skillBtn.setBackgroundColor(this.targetingSkill ? '#3a3a58' : '#26263c')

    // 카드 상태: 선택 강조, 코스트 부족/쿨다운은 흐리게 (표시용 상태 조회)
    for (const card of this.cards) {
      const cdLeft = (state.redeployReadyAt[card.def.id] ?? 0) - state.tick
      const affordable = state.cost >= card.def.cost
      const fielded = state.units.some((u) => u.defId === card.def.id) // 캐릭터 유일성
      const selected = this.selectedDefId === card.def.id
      card.bg.setStrokeStyle(2, selected ? 0xffd870 : 0x44445f)
      card.bg.setFillStyle(selected ? 0x3a3a58 : 0x26263c)
      const alpha = fielded || cdLeft > 0 || !affordable ? 0.45 : 1
      card.bg.setAlpha(alpha)
      card.label.setAlpha(alpha)
      card.sub.setAlpha(alpha)
      card.sub.setText(
        fielded
          ? '출전 중'
          : cdLeft > 0
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

    if (this.mode === 'campaign' && this.campaign) {
      if (won) {
        const stage = this.sim.ctx.stage
        this.campaign = onStageCleared(
          this.campaign,
          this.sim.state.wallHp / stage.wallHp,
          [...this.deployedCharIds],
        )
        saveCampaign(this.campaign)
        if (this.campaign.status === 'won') {
          this.fullscreenNotice('침공 종식', '성을 지켜냈다. 성주의 기록은 여기서 끝난다 — 클릭하여 새 캠페인', () => {
            clearCampaign()
            this.campaign = null
            this.scene.restart()
          })
        } else if (this.campaign.pendingCandidateIds) {
          this.openRecruitPanel()
        } else {
          this.fullscreenNotice('침공 격퇴', '클릭하면 다음 침공', () => this.scene.restart())
        }
      } else {
        this.campaign = onDefeat(this.campaign)
        saveCampaign(this.campaign)
        this.fullscreenNotice('성이 함락됐다', '클릭하면 처음부터 — 새 캠페인', () => {
          clearCampaign()
          this.campaign = null
          this.scene.restart()
        })
      }
      return
    }

    // 자유 연습 모드: 기존 동작 (클릭 재시작)
    this.add.rectangle(480, 270, 960, 540, 0x000000, 0.55).setDepth(40)
    this.add
      .text(480, 240, won ? '승리!' : '패배', {
        fontFamily: 'monospace',
        fontSize: '48px',
        color: won ? '#8ae08a' : '#e08a8a',
      })
      .setOrigin(0.5)
      .setDepth(41)
    const survivor = this.sim.state.units[0]
    const ch = survivor ? CHAR_BY_ID.get(survivor.defId) : undefined
    if (won && ch) {
      this.add
        .text(480, 350, `${ch.epithet} ${ch.name} — "${ch.lines.victory}"`, {
          fontFamily: 'monospace',
          fontSize: '15px',
          color: '#c8c8dc',
        })
        .setOrigin(0.5)
        .setDepth(41)
    }
    this.add
      .text(480, 300, '클릭하면 다시 시작', { fontFamily: 'monospace', fontSize: '16px', color: '#c8c8dc' })
      .setOrigin(0.5)
      .setDepth(41)
    this.input.once('pointerdown', () => this.scene.restart())
  }

  /** 온보딩: 목표 배너(항상) + 첫 침공 한정 배치 힌트 */
  private showOnboarding(): void {
    const banner = this.add
      .text(
        480,
        230,
        this.mode === 'campaign' && this.campaign
          ? `제${this.campaign.stageIndex + 1}침공 — 괴수들로부터 성벽을 지켜라`
          : '괴수들로부터 성벽을 지켜라',
        {
          fontFamily: 'monospace',
          fontSize: '24px',
          fontStyle: 'bold',
          color: '#e8e8f0',
          backgroundColor: '#000000aa',
          padding: { x: 18, y: 10 },
        },
      )
      .setOrigin(0.5)
      .setDepth(35)
    this.tweens.add({ targets: banner, alpha: 0, delay: 2600, duration: 700, onComplete: () => banner.destroy() })

    // 첫 침공에서만: 배치가 없으면 카드로 유도하는 힌트
    if (this.mode === 'campaign' && this.campaign?.stageIndex === 0) {
      const hint = this.add
        .text(GRID_X + 150, 470, '▼ 가신을 선택해 흙길(진입로)에 배치하세요', {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#ffd870',
          backgroundColor: '#000000aa',
          padding: { x: 10, y: 6 },
        })
        .setDepth(35)
        .setVisible(false)
      this.tweens.add({ targets: hint, alpha: 0.55, duration: 650, yoyo: true, repeat: -1 })
      const timer = this.time.addEvent({
        delay: 400,
        loop: true,
        callback: () => {
          if (this.deployedCharIds.size > 0 || this.sim.state.status !== 'playing') {
            hint.destroy()
            timer.remove()
          } else if (this.sim.state.tick > 2 * TICKS_PER_SECOND) {
            hint.setVisible(true)
          }
        },
      })
    }
  }

  /** 전면 안내 오버레이 (캠페인 전환 화면) */
  private fullscreenNotice(title: string, subtitle: string, onClick: () => void): void {
    this.add.rectangle(480, 270, 960, 540, 0x000000, 0.65).setDepth(40)
    this.add
      .text(480, 230, title, { fontFamily: 'monospace', fontSize: '42px', color: '#e8e8f0' })
      .setOrigin(0.5)
      .setDepth(41)
    this.add
      .text(480, 290, subtitle, { fontFamily: 'monospace', fontSize: '15px', color: '#c8c8dc' })
      .setOrigin(0.5)
      .setDepth(41)
    this.input.once('pointerdown', onClick)
  }

  // ------------------------------------------------------------ 영입 패널

  private openRecruitPanel(): void {
    if (!this.campaign?.pendingCandidateIds) return
    this.recruitOpen = true
    const ids = this.campaign.pendingCandidateIds
    const roleName = (role: string) => UNIT_DEFS.find((d) => d.id === role)?.name ?? role

    this.add.rectangle(480, 270, 960, 540, 0x000000, 0.75).setDepth(50)
    this.add
      .text(480, 90, '침공 격퇴 — 가신을 영입하십시오', {
        fontFamily: 'monospace',
        fontSize: '24px',
        color: '#ffd870',
      })
      .setOrigin(0.5)
      .setDepth(51)

    ids.forEach((id, i) => {
      const c = characterById(id)
      const x = 480 + (i - (ids.length - 1) / 2) * 280
      const bg = this.add
        .rectangle(x, 280, 260, 240, 0x26263c)
        .setStrokeStyle(2, colorFor(c.id))
        .setDepth(51)
        .setInteractive({ useHandCursor: true })
      bg.on('pointerdown', () => {
        Sfx.play('recruit')
        this.campaign = recruit(this.campaign!, c.id)
        saveCampaign(this.campaign)
        this.scene.restart()
      })
      const line = (dy: number, txt: string, size = 12, color = '#c8c8dc') =>
        this.add
          .text(x, 280 + dy, txt, {
            fontFamily: 'monospace',
            fontSize: `${size}px`,
            color,
            align: 'center',
            wordWrap: { width: 236 },
          })
          .setOrigin(0.5, 0)
          .setDepth(52)
      line(-105, `${c.epithet} ${c.name}`, 16, '#e8e8f0')
      line(-78, `역할: ${roleName(c.role)}`, 12, '#8888aa')
      const sk = c.skillSet!
      line(-56, `${sk.passive.name} · ${sk.auto.name} · ${sk.active.name}`, 12, '#ffd870')
      line(-28, c.lore, 11)
    })

    const skipBtn = this.add
      .text(480, 452, '이번에는 영입하지 않는다', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#8888aa',
        backgroundColor: '#26263c',
        padding: { x: 10, y: 6 },
      })
      .setOrigin(0.5)
      .setDepth(51)
      .setInteractive({ useHandCursor: true })
    skipBtn.on('pointerdown', () => {
      this.campaign = skipRecruit(this.campaign!)
      saveCampaign(this.campaign)
      this.scene.restart()
    })
  }

  // ------------------------------------------------------------ 유닛 메뉴 (기술/철수)

  private createUnitMenu(): void {
    const makeMenuBtn = (label: string, onClick: () => void) => {
      const btn = this.add
        .text(0, 0, label, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#e8e8f0',
          backgroundColor: '#3a3a58',
          padding: { x: 8, y: 4 },
        })
        .setDepth(45)
        .setVisible(false)
        .setInteractive({ useHandCursor: true })
      btn.on(
        'pointerdown',
        (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
          ev.stopPropagation()
          onClick()
        },
      )
      return btn
    }
    this.menuSkillBtn = makeMenuBtn('기술 발동', () => {
      if (this.unitMenuFor !== null) this.queue({ type: 'useSkill', unitId: this.unitMenuFor })
      this.closeUnitMenu()
    })
    this.menuMoveBtn = makeMenuBtn('이동', () => {
      if (this.unitMenuFor !== null) {
        this.movingUnitId = this.unitMenuFor
        this.selectedDefId = null
        this.targetingSkill = false
        this.toast('이동할 타일을 클릭하세요')
      }
      this.closeUnitMenu()
    })
    this.menuWithdrawBtn = makeMenuBtn('철수 (50%)', () => {
      if (this.unitMenuFor !== null) {
        Sfx.play('withdraw')
        this.queue({ type: 'withdraw', unitId: this.unitMenuFor })
      }
      this.closeUnitMenu()
    })
  }

  private openUnitMenu(unitId: number): void {
    const unit = this.sim.state.units.find((u) => u.id === unitId)
    if (!unit) return
    this.unitMenuFor = unitId
    const { px, py } = this.cellPx(unit.x, unit.y)
    const def = this.sim.ctx.unitDefs[unit.defId]!
    const hasActive = def.skills?.some((sk) => sk.slot === 'active') ?? false
    const mx = px + this.tile / 2 + 4
    this.menuSkillBtn.setVisible(hasActive).setPosition(mx, py - 40)
    this.menuMoveBtn.setVisible(true).setPosition(mx, py - 12)
    this.menuWithdrawBtn.setVisible(true).setPosition(mx, py + 16)
  }

  private closeUnitMenu(): void {
    this.unitMenuFor = null
    this.menuSkillBtn.setVisible(false)
    this.menuMoveBtn.setVisible(false)
    this.menuWithdrawBtn.setVisible(false)
  }
}
