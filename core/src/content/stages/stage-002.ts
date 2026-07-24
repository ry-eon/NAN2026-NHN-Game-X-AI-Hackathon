// 수제 스테이지 002 — 등급 변별력을 위한 첫 "난이도" 스테이지.
// stage-001이 Random도 100% 깨는 하급으로 정량 확인된 것의 대응 (docs/logs/2026-07-20.md).
//
// v3 지형 (동적 길찾기): 두 갈래 회랑 + 세로 연결로 + 알코브/다리.
//   y1  ......RRRRRR   레인 A: (11,1) 스폰 → 서진 → x6에서 남하 가능
//   y2  WRRRRRRXGXXX   서쪽 회랑 A + 막다른 알코브 (8,2)
//   y3  WXGXGXRXXXXX   연결로(x6): A↔B 우회 / (2,3)(4,3)은 회랑 사이 다리(지상)
//   y4  WRRRRRRXGXXX   서쪽 회랑 B + 막다른 알코브 (8,4)
//   y5  ......RRRRRR   레인 B: (11,5) 스폰
// 한쪽 회랑을 봉쇄하면 연결로/다리로 우회한다 — 어디를 막고 어디로 몰 것인가.
// 타이트한 경제(초기 10, 재생 0.8/s) 유지.

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
  // 성벽 위 배치 칸은 x0의 y2~y4 3칸 (원거리 스팸 상한 유지)
  tilesRows: [
    'XXXXXXXXXXXX',
    'XXXXXXRRRRRR',
    'WRRRRRRXGXXX',
    'WXGXGXRXXXXX',
    'WRRRRRRXGXXX',
    'XXXXXXRRRRRR',
    'XXXXXXXXXXXX',
  ],
  paths: [
    // 레인 A (권장 진격로 — 실제 경로는 동적)
    [...west(11, 6, 1), ...west(6, 1, 2)],
    // 레인 B
    [...west(11, 6, 5), ...west(6, 1, 4)],
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
