// 수제 스테이지 001 — W1 완료 기준의 기준 스테이지.
// "사람이 브라우저에서, 봇이 헤드리스에서 각각 클리어 가능"을 이 스테이지로 검증한다.
// 파이프라인 생성 스테이지도 이 스키마(StageDef)를 그대로 따른다.
//
// v3 지형 (동적 길찾기): 외길 회랑 + 알코브.
//   y2  WXGXGXGXXX   ← 알코브(막다른 지상칸): 브루저 측면 타격·감속사 니치
//   y3  WRRRRRRRRR   ← 회랑: (9,3) 스폰 → (1,3) 성벽 접점. 봉쇄하면 괴수가 교전
//   y4  WXGXGXGXXX
// 첫 스테이지 = 봉쇄의 기본기를 배우는 판. 우회 분기는 stage-002부터.

import { TICKS_PER_SECOND } from '../../types'
import type { SpawnDef, StageDef } from '../../types'

const sec = (s: number) => Math.round(s * TICKS_PER_SECOND)

const at = (s: number, enemyDefId: string, wave: number): SpawnDef => ({
  tick: sec(s),
  enemyDefId,
  pathIndex: 0,
  wave,
})

export const STAGE_001: StageDef = {
  id: 'stage-001',
  name: '첫 번째 성벽',
  tilesRows: [
    'XXXXXXXXXX',
    'XXXXXXXXXX',
    'WXGXGXGXXX',
    'WRRRRRRRRR',
    'WXGXGXGXXX',
    'XXXXXXXXXX',
    'XXXXXXXXXX',
  ],
  paths: [
    [
      { x: 9, y: 3 },
      { x: 8, y: 3 },
      { x: 7, y: 3 },
      { x: 6, y: 3 },
      { x: 5, y: 3 },
      { x: 4, y: 3 },
      { x: 3, y: 3 },
      { x: 2, y: 3 },
      { x: 1, y: 3 },
    ],
  ],
  wallHp: 1000,
  initialCost: 15,
  costRegenPerSec: 1,
  costMax: 99,
  spawns: [
    // 웨이브 1: 보병 정찰
    at(3, 'grunt', 1),
    at(5, 'grunt', 1),
    at(7, 'grunt', 1),
    // 웨이브 2: 보병 + 속행병 혼성
    at(14, 'grunt', 2),
    at(15, 'runner', 2),
    at(16, 'grunt', 2),
    at(17, 'runner', 2),
    // 웨이브 3: 중장병 선두
    at(26, 'tank', 3),
    at(28, 'grunt', 3),
    at(29, 'runner', 3),
    at(30, 'grunt', 3),
  ],
  seed: 20260716,
}
