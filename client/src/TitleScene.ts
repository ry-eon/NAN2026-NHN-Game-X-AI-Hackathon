// 타이틀 화면 — 심사자의 첫 30초를 위한 관문.
// 목표 한 줄 + 시작 버튼 두 개(캠페인/자유 연습) + 픽셀 디오라마.

import Phaser from 'phaser'
import { CAMPAIGN_LENGTH } from '@core'
import { Sfx } from './audio'
import { loadCampaign } from './meta/save'
import { ENEMY_SCALE, registerPixelTextures } from './pixel'

/** 게임 제목 [가제 — 확정 시 여기만 교체] */
export const GAME_TITLE = '마지막 성벽'
export const GAME_TAGLINE = '끝없이 밀려오는 괴수들로부터, 그대의 성을 지켜라'

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('title')
  }

  create(): void {
    registerPixelTextures(this)
    const W = 960
    const H = 540

    // 배경 그라데이션 느낌 (위 어두움 → 아래 더 어두움)
    this.add.rectangle(W / 2, H / 2, W, H, 0x10101c)
    this.add.rectangle(W / 2, H * 0.82, W, H * 0.36, 0x0b0b14)

    // 디오라마: 성벽 위 가신 3인 ← 진입로 → 괴수 무리
    const groundY = 396
    for (let x = 0; x < 16; x++) {
      this.add.image(60 + x * 56, groundY + 40, 'tile-road').setDisplaySize(56, 56).setAlpha(0.85)
    }
    for (let y = 0; y < 3; y++) {
      this.add.image(60, groundY + 40 - 56 - y * 56, 'tile-wallTop').setDisplaySize(56, 56)
    }
    // 가신들: 성벽 위 아처, 흙길 위 블로커·의무병
    this.add.image(60, 262, 'unit-archer').setDisplaySize(44, 44)
    this.add.image(170, groundY + 12, 'unit-blocker').setDisplaySize(44, 44)
    this.add.image(118, groundY + 12, 'unit-healer').setDisplaySize(44, 44)
    const horde: [string, number, number][] = [
      ['enemy-grunt', 620, 0],
      ['enemy-runner', 700, 6],
      ['enemy-grunt', 760, -4],
      ['enemy-tank', 840, -2],
      ['enemy-siege', 920, 2],
    ]
    for (const [key, x, dy] of horde) {
      const id = key.replace('enemy-', '')
      const scale = (ENEMY_SCALE[id] ?? 0.6) * 62
      const spr = this.add.image(x, groundY + 14 + dy, key).setDisplaySize(scale, scale)
      // 은근한 전진 흔들림
      this.tweens.add({
        targets: spr,
        x: x - 10,
        duration: 900 + (x % 5) * 120,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut',
      })
    }

    // 제목·태그라인
    this.add
      .text(W / 2, 128, GAME_TITLE, {
        fontFamily: 'monospace',
        fontSize: '58px',
        fontStyle: 'bold',
        color: '#e8e8f0',
      })
      .setOrigin(0.5)
      .setShadow(0, 4, '#000000', 8)
    this.add
      .text(W / 2, 182, GAME_TAGLINE, {
        fontFamily: 'monospace',
        fontSize: '15px',
        color: '#a0a0b8',
      })
      .setOrigin(0.5)

    // 시작 버튼
    const save = loadCampaign()
    const canContinue = save !== null && save.status === 'active'
    this.makeButton(
      W / 2,
      262,
      canContinue
        ? `침공 계속 (제${save!.stageIndex + 1}침공/${CAMPAIGN_LENGTH} · 가신 ${save!.roster.length}명)`
        : '침공에 맞선다 — 캠페인 시작',
      '#ffd870',
      () => this.scene.start('battle', { mode: 'campaign' }),
      true,
    )
    this.makeButton(W / 2, 312, '자유 연습 (스테이지 선택)', '#8888aa', () =>
      this.scene.start('battle', { mode: 'free' }),
    )

    // 한 줄 규칙 (심사자 30초 이해)
    this.add
      .text(
        W / 2,
        360,
        `${CAMPAIGN_LENGTH}번의 침공을 버티면 승리 · 가신을 배치해 괴수를 막고, 성벽이 무너지면 끝\n격퇴할 때마다 새 가신을 영입하고 가신은 전투로 성장한다 · 성벽 피해는 다음 침공으로 이어진다`,
        { fontFamily: 'monospace', fontSize: '12px', color: '#70708a', align: 'center', lineSpacing: 6 },
      )
      .setOrigin(0.5)

    this.add
      .text(W / 2, 522, 'NHN NAN 2026 — AI가 생성하고, 봇이 검증한 스테이지만 출고됩니다', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#4a4a60',
      })
      .setOrigin(0.5)
  }

  private makeButton(
    x: number,
    y: number,
    label: string,
    color: string,
    onClick: () => void,
    primary = false,
  ): void {
    const btn = this.add
      .text(x, y, label, {
        fontFamily: 'monospace',
        fontSize: primary ? '18px' : '14px',
        color,
        backgroundColor: primary ? '#33334e' : '#232338',
        padding: { x: 22, y: primary ? 12 : 8 },
      })
      .setOrigin(0.5)
      .setDepth(10)
      .setInteractive({ useHandCursor: true })
    btn.on('pointerover', () => btn.setBackgroundColor(primary ? '#3f3f5e' : '#2b2b44'))
    btn.on('pointerout', () => btn.setBackgroundColor(primary ? '#33334e' : '#232338'))
    btn.on('pointerdown', () => {
      Sfx.unlock()
      Sfx.play('click')
      onClick()
    })
    if (primary) {
      this.tweens.add({ targets: btn, alpha: 0.82, duration: 900, yoyo: true, repeat: -1 })
    }
  }
}
