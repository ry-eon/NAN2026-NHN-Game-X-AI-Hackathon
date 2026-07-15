import Phaser from 'phaser'
import { CORE_VERSION } from '@core'

// client는 core의 상태를 그리기만 한다. 게임 룰 로직 금지 (docs/03-architecture.md).
// 지금은 배포 파이프라인 검증용 placeholder 씬 하나만 존재한다.

class PlaceholderScene extends Phaser.Scene {
  create(): void {
    const { width, height } = this.scale

    this.add
      .text(width / 2, height / 2 - 24, 'NAN 2026', {
        fontFamily: 'monospace',
        fontSize: '48px',
        color: '#e8e8f0',
      })
      .setOrigin(0.5)

    this.add
      .text(width / 2, height / 2 + 28, `placeholder build — core v${CORE_VERSION}`, {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#8888aa',
      })
      .setOrigin(0.5)
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 960,
  height: 540,
  backgroundColor: '#16162a',
  scene: [PlaceholderScene],
})
