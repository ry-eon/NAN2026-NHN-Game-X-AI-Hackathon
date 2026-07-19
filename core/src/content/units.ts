// 유닛 로스터 6종 (docs/02-game-design.md: 블로커/브루저/원거리/광역/힐러/특수).
// 수치는 전부 [초안] — 봇 시뮬·파이프라인 판정 결과 보며 조정한다.

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
  {
    // 광역 딜러 — 동시 클럼프의 해답. 단일 DPS는 아처보다 낮다
    id: 'mage',
    name: '술사',
    placement: 'wallTop',
    cost: 13,
    hp: 380,
    atk: 150,
    def: 5,
    atkIntervalTicks: sec(2.0),
    range: 3.0,
    blockCount: 0,
    redeployTicks: sec(30),
    aoeRadius: 1.3,
  },
  {
    // 힐러/지원 — 저지선의 수명을 늘린다. 공격 불가
    id: 'healer',
    name: '의무병',
    placement: 'wallTop',
    cost: 10,
    hp: 420,
    atk: 100, // 치유량
    def: 10,
    atkIntervalTicks: sec(1.4),
    range: 3.2,
    blockCount: 0,
    redeployTicks: sec(30),
    heals: true,
  },
  {
    // 특수 — 감속 오라. 킬존 체류 시간을 늘려 원거리 화력을 증폭
    id: 'slower',
    name: '감속사',
    placement: 'ground',
    cost: 8,
    hp: 700,
    atk: 60,
    def: 20,
    atkIntervalTicks: sec(1.6),
    range: 0,
    blockCount: 1,
    redeployTicks: sec(25),
    aura: { radius: 1.8, speedFactor: 0.6 },
  },
]
