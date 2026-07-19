// W1 테스트 적 3종. 수치는 전부 [초안].
// W2에서 공성(성벽 우선 타격) 추가 검토 (docs/02-game-design.md: 적 3~4종).

import { TICKS_PER_SECOND } from '../types'
import type { EnemyDef } from '../types'

const sec = (s: number) => Math.round(s * TICKS_PER_SECOND)

export const ENEMY_DEFS: EnemyDef[] = [
  {
    id: 'grunt',
    name: '보병',
    hp: 480,
    atk: 70,
    def: 20,
    atkIntervalTicks: sec(1.5),
    speedTilesPerSec: 0.55,
    wallDamage: 60,
  },
  {
    id: 'runner',
    name: '속행병',
    hp: 190,
    atk: 50,
    def: 0,
    atkIntervalTicks: sec(1.0),
    speedTilesPerSec: 1.1,
    wallDamage: 40,
  },
  {
    id: 'tank',
    name: '중장병',
    hp: 1250,
    atk: 90,
    def: 60,
    atkIntervalTicks: sec(2.0),
    speedTilesPerSec: 0.3,
    wallDamage: 120,
  },
]
