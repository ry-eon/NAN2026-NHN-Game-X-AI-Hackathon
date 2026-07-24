// 성채 방어 시설 3종 (플레이 피드백 ④-1: "성인데 공성 옵션이 없다").
// 시설 = 구조물 플래그가 붙은 유닛 — 가신과 달리 복수 건설 가능, 레벨·기술 없음.
// v3 길찾기와 맞물린다: 바리케이드로 길을 조각하고, 파수탑으로 지형+화력을 겸하고,
// 기름 가마로 몰아넣은 길목을 태운다. 수치는 전부 [초안].

import { TICKS_PER_SECOND } from '../types'
import type { UnitDef } from '../types'

const sec = (s: number) => Math.round(s * TICKS_PER_SECOND)

export const STRUCTURE_DEFS: UnitDef[] = [
  {
    // 순수 장애물 — 공격하지 않는 벽. 괴수는 돌아가거나, 길이 없으면 부수고 지나간다
    id: 'barricade',
    name: '바리케이드',
    placement: 'ground',
    cost: 6,
    hp: 1600,
    atk: 0,
    def: 30,
    atkIntervalTicks: sec(9999),
    range: 0,
    blockCount: 0,
    redeployTicks: sec(10),
    structure: true,
  },
  {
    // 지상 건설형 원거리 — 성벽 위 슬롯이 모자랄 때의 화력 + 그 자체로 장애물
    id: 'watchtower',
    name: '파수탑',
    placement: 'ground',
    cost: 16,
    hp: 700,
    atk: 95,
    def: 20,
    atkIntervalTicks: sec(1.2),
    range: 3.0,
    blockCount: 0,
    redeployTicks: sec(20),
    structure: true,
  },
  {
    // 주변 전체를 주기적으로 태운다 — 몰아넣은 길목·대기 행렬에 최적
    id: 'cauldron',
    name: '기름 가마',
    placement: 'ground',
    cost: 14,
    hp: 500,
    atk: 55,
    def: 10,
    atkIntervalTicks: sec(1.2),
    range: 1.6,
    blockCount: 0,
    redeployTicks: sec(20),
    structure: true,
    areaPulse: true,
  },
]
