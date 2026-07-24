// 기본 병사·공성 병기 (v4 농성전 스펙 — 사용자 확정).
// 영웅(가신)과 달리 structure 플래그 = 복수 배치·레벨 없음. 수치 전부 [초안].

import { TICKS_PER_SECOND } from '../types'
import type { UnitDef } from '../types'

const sec = (s: number) => Math.round(s * TICKS_PER_SECOND)

/** 기본 병사 — 값싸고 여럿 세우는 소모 전력 */
export const SOLDIER_DEFS: UnitDef[] = [
  {
    id: 'spearman',
    name: '창병',
    placement: 'ground',
    cost: 5,
    hp: 750,
    atk: 70,
    def: 15,
    atkIntervalTicks: sec(1.4),
    range: 0,
    blockCount: 2,
    redeployTicks: sec(8),
    structure: true,
  },
  {
    id: 'bowman',
    name: '궁병',
    placement: 'ground',
    cost: 7,
    hp: 300,
    atk: 60,
    def: 5,
    atkIntervalTicks: sec(1.1),
    range: 2.8,
    blockCount: 0,
    redeployTicks: sec(8),
    structure: true,
  },
]

/** 공성 병기 — 고가·고화력. 발리스타(단발 저격)와 대포(광역 포격) */
export const SIEGE_DEFS: UnitDef[] = [
  {
    id: 'ballista',
    name: '발리스타',
    placement: 'ground',
    cost: 18,
    hp: 550,
    atk: 420,
    def: 10,
    atkIntervalTicks: sec(3.5),
    range: 5.5,
    blockCount: 0,
    redeployTicks: sec(25),
    structure: true,
  },
  {
    id: 'cannon',
    name: '대포',
    placement: 'ground',
    cost: 22,
    hp: 500,
    atk: 180,
    def: 10,
    atkIntervalTicks: sec(4.0),
    range: 4.5,
    blockCount: 0,
    redeployTicks: sec(25),
    structure: true,
    aoeRadius: 1.5,
  },
]
