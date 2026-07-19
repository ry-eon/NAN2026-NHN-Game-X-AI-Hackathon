// W1 테스트 로스터 (3종). 수치는 전부 [초안] — 봇 시뮬 결과 보며 조정한다.
// W2에서 6종(블로커/브루저/원거리/광역/힐러/특수)으로 확장 (docs/02-game-design.md).

import { TICKS_PER_SECOND } from '../types'
import type { UnitDef } from '../types'

const sec = (s: number) => Math.round(s * TICKS_PER_SECOND)

export const UNIT_DEFS: UnitDef[] = [
  {
    id: 'blocker',
    name: '블로커',
    placement: 'ground',
    cost: 14,
    hp: 1400,
    atk: 90,
    def: 40,
    atkIntervalTicks: sec(1.5),
    range: 0,
    blockCount: 3,
    redeployTicks: sec(30),
  },
  {
    id: 'bruiser',
    name: '브루저',
    placement: 'ground',
    cost: 11,
    hp: 900,
    atk: 240,
    def: 25,
    atkIntervalTicks: sec(1.3),
    range: 0,
    blockCount: 1,
    redeployTicks: sec(30),
  },
  {
    id: 'archer',
    name: '아처',
    placement: 'wallTop',
    cost: 9,
    hp: 450,
    atk: 130,
    def: 10,
    atkIntervalTicks: sec(1.0),
    range: 3.5,
    blockCount: 0,
    redeployTicks: sec(30),
  },
]
