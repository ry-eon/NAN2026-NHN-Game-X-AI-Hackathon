// 적 4종 (docs/02-game-design.md: 일반/속행/탱커/공성). 수치는 전부 [초안].
// 세계관 확정(생존 서사 — 괴수 침략)에 따라 명명은 괴수 계열.
// 괴수 이름은 [초안] — W3 세계관 문서·캐릭터 파이프라인에서 재론.

import { TICKS_PER_SECOND } from '../types'
import type { EnemyDef } from '../types'

const sec = (s: number) => Math.round(s * TICKS_PER_SECOND)

export const ENEMY_DEFS: EnemyDef[] = [
  {
    id: 'grunt',
    name: '야귀',
    hp: 480,
    atk: 70,
    def: 20,
    atkIntervalTicks: sec(1.5),
    speedTilesPerSec: 0.55,
    wallDamage: 60,
  },
  {
    id: 'runner',
    name: '질주귀',
    hp: 190,
    atk: 50,
    def: 0,
    atkIntervalTicks: sec(1.0),
    speedTilesPerSec: 1.1,
    wallDamage: 40,
  },
  {
    id: 'tank',
    name: '갑주귀',
    hp: 1250,
    atk: 90,
    def: 60,
    atkIntervalTicks: sec(2.0),
    speedTilesPerSec: 0.3,
    wallDamage: 120,
  },
  {
    // 공성 — 성벽 우선 타격. 경로 끝 2.5타일 앞에서 멈춰 포격하므로
    // 성벽 접점 커버만으로는 못 잡는다 (경로 안쪽 커버 또는 전방 저지 강요)
    id: 'siege',
    name: '파성귀',
    hp: 900,
    atk: 0,
    def: 40,
    atkIntervalTicks: sec(2.5),
    speedTilesPerSec: 0.35,
    wallDamage: 90,
    wallAttackRange: 2.5,
  },
]
