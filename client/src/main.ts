import Phaser from 'phaser'
import { BattleScene } from './BattleScene'

// client는 core의 상태를 그리기만 한다. 게임 룰 로직 금지 (docs/03-architecture.md).

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 960,
  height: 540,
  backgroundColor: '#16162a',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BattleScene],
})
