// 수제 스테이지 002 — 등급 변별력을 위한 첫 "난이도" 스테이지.
// stage-001이 Random도 100% 깨는 하급으로 정량 확인된 것의 대응 (docs/logs/2026-07-20.md).
//
// 설계 의도:
//   - 이중 레인(위 A / 아래 B): 한 덩어리 방어로는 못 막고 전력을 나눠야 한다.
//   - 레인 A는 x6에서 한 번 꺾여 성벽 근처 킬존(원거리 커버 밀집 구간)으로 유도.
//   - 타이트한 경제(초기 10, 재생 0.8/s): 낭비 배치가 곧 실점 — Random 하한 분리.
//   - 두 레인 동시 압박 웨이브: 반응 순서/저축 판단이 필요 — Greedy와 Planner 분리.
//
//   y0  XXXXXXXXXXXX
//   y1  WGGGGGRRRRRR   ← 레인 A: (11,1) 스폰, x6까지 서진 후
//   y2  WRRRRRRGGGGX      (6,2)로 꺾여 (1,2)에서 성벽 타격
//   y3  WGGGGGGGGGGX
//   y4  WGGGGGGGGGGX
//   y5  WGGGGGGGGGGX
//   y6  WRRRRRRRRRRR   ← 레인 B: (11,6) 스폰, 직진, (1,6)에서 성벽 타격
//   y7  XXXXXXXXXXXX

import { TICKS_PER_SECOND } from '../../types'
import type { CellPos, SpawnDef, StageDef } from '../../types'

const sec = (s: number) => Math.round(s * TICKS_PER_SECOND)

const at = (s: number, enemyDefId: string, pathIndex: number, wave: number): SpawnDef => ({
  tick: sec(s),
  enemyDefId,
  pathIndex,
  wave,
})

const west = (fromX: number, toX: number, y: number): CellPos[] => {
  const cells: CellPos[] = []
  for (let x = fromX; x >= toX; x--) cells.push({ x, y })
  return cells
}

export const STAGE_002: StageDef = {
  id: 'stage-002',
  name: '갈라진 진격로',
  // 성벽 위 배치 칸은 y2~y4의 3칸뿐 (나머지는 파손 구간) — 원거리 스팸 상한.
  // 레인 A 킬존은 두텁고 레인 B 커버는 (0,4) 하나뿐이라 배치 선택이 갈린다.
  tilesRows: [
    'XXXXXXXXXXXX',
    'XGGGGGRRRRRR',
    'WRRRRRRGGGGX',
    'WGGGGGGGGGGX',
    'WGGGGGGGGGGX',
    'XGGGGGGGGGGX',
    'XRRRRRRRRRRR',
    'XXXXXXXXXXXX',
  ],
  paths: [
    // 레인 A: 위쪽 진입 → x6에서 남쪽으로 꺾여 y2 킬존 통과
    [...west(11, 6, 1), ...west(6, 1, 2)],
    // 레인 B: 아래쪽 직진
    [...west(11, 1, 6)],
  ],
  wallHp: 400,
  initialCost: 10,
  costRegenPerSec: 0.8,
  costMax: 30,
  spawns: [
    // 웨이브 1: 완만한 시작 — 양 레인 단독 스폰으로 초기 배치를 유도
    at(6, 'grunt', 1, 1),
    at(9, 'grunt', 1, 1),
    at(10, 'runner', 0, 1),
    at(14, 'grunt', 0, 1),
    // 웨이브 2: 커버 얇은 레인 B에 속행병 페어 + 레인 A 클럼프 — 동시 대응 시험
    at(22, 'grunt', 0, 2),
    at(23, 'grunt', 0, 2),
    at(24, 'runner', 1, 2),
    at(24, 'runner', 1, 2),
    at(26, 'runner', 0, 2),
    at(28, 'runner', 1, 2),
    // 웨이브 3: 양 레인 총공세. 레인 B의 동시 4기 클럼프는 저지 1짜리 유닛으로는
    // 3기가 새므로 다중 저지(블로커)를 준비한 쪽만 막는다 — 저축·계획의 시험대
    at(40, 'tank', 1, 3),
    at(42, 'tank', 0, 3),
    at(44, 'grunt', 1, 3),
    at(44, 'grunt', 1, 3),
    at(44, 'grunt', 1, 3),
    at(44, 'grunt', 1, 3),
    at(46, 'runner', 0, 3),
    at(46, 'runner', 0, 3),
    at(50, 'grunt', 0, 3),
    at(52, 'runner', 1, 3),
    at(54, 'grunt', 0, 3),
    at(56, 'runner', 0, 3),
  ],
  seed: 20260720,
}
