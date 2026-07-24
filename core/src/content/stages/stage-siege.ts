// 농성전 (v4 단일 라운드) — 대형 성채, 전면 침공.
// 서쪽 전체가 성벽(전선 14칸), 동쪽 5개 진입로에서 웨이브가 몰려오고
// 들판(지상)이 전부 통행 가능해 봉쇄하면 옆으로 흘러넘친다.
// 바위(X) 무리가 자연 초크포인트를 만든다. 수치 전부 [초안].

import { TICKS_PER_SECOND } from '../../types'
import type { CellPos, SpawnDef, StageDef } from '../../types'

const sec = (s: number) => Math.round(s * TICKS_PER_SECOND)

const W = 26
const H = 16
const LANES = [2, 5, 8, 11, 14]

function buildRows(): string[] {
  const g: string[][] = Array.from({ length: H }, (_, y) =>
    Array.from({ length: W }, (_, x) => {
      if (y === 0 || y === H - 1) return 'X'
      if (x === 0) return 'W' // 서쪽 성벽 전체
      if (x === W - 1) return LANES.includes(y) ? 'R' : 'X'
      return LANES.includes(y) ? 'R' : 'G'
    }),
  )
  // 바위 무리 (결정론 배치): 들판에 자연 초크포인트
  const rocks: [number, number][] = [
    [6, 3], [6, 4], [12, 3], [18, 4],
    [8, 6], [14, 7], [20, 6], [4, 7],
    [10, 9], [16, 10], [6, 12], [22, 9],
    [12, 12], [18, 13], [8, 13], [21, 12],
  ]
  for (const [x, y] of rocks) {
    if (!LANES.includes(y) && x > 2 && x < W - 2) g[y]![x] = 'X'
  }
  return g.map((r) => r.join(''))
}

const lanePath = (y: number): CellPos[] => {
  const cells: CellPos[] = []
  for (let x = W - 1; x >= 1; x--) cells.push({ x, y })
  return cells
}

// 웨이브 5개 — 단일 라운드 내부 페이싱. lane 분산은 결정론 순환.
function buildSpawns(): SpawnDef[] {
  const spawns: SpawnDef[] = []
  let li = 0
  const lane = () => {
    li = (li + 1) % LANES.length
    return li
  }
  const add = (t: number, id: string, pi = lane(), wave = 1): void => {
    spawns.push({ tick: sec(t), enemyDefId: id, pathIndex: pi, wave })
  }
  // W1 정찰 (5~22s): 야귀 6
  for (let i = 0; i < 6; i++) add(5 + i * 3, 'grunt', lane(), 1)
  // W2 양익 속공 (32~48s): 질주귀 6 + 야귀 4
  for (let i = 0; i < 6; i++) add(32 + i * 2, 'runner', i % 2 === 0 ? 0 : 4, 2)
  for (let i = 0; i < 4; i++) add(36 + i * 3, 'grunt', lane(), 2)
  // W3 중앙 돌파 (62~82s): 갑주귀 2 + 야귀 클럼프 8 (중앙 레인 집중)
  add(62, 'tank', 2, 3)
  add(66, 'tank', 2, 3)
  for (let i = 0; i < 8; i++) add(68 + (i % 2), 'grunt', i < 4 ? 1 : 3, 3)
  // W4 공성 (95~115s): 파성귀 2 + 혼성 10
  add(95, 'siege', 0, 4)
  add(99, 'siege', 4, 4)
  for (let i = 0; i < 10; i++) add(98 + i * 2, i % 3 === 0 ? 'runner' : 'grunt', lane(), 4)
  // W5 총공세 (130~158s): 전 레인 폭풍 18
  add(130, 'tank', 1, 5)
  add(132, 'tank', 3, 5)
  add(140, 'siege', 2, 5)
  for (let i = 0; i < 15; i++) add(131 + i * 1.8, i % 4 === 0 ? 'runner' : 'grunt', lane(), 5)
  return spawns.sort((a, b) => a.tick - b.tick)
}

export const STAGE_SIEGE: StageDef = {
  id: 'stage-siege',
  name: '농성전 — 마지막 성벽',
  tilesRows: buildRows(),
  paths: LANES.map(lanePath),
  wallHp: 1600,
  initialCost: 22,
  costRegenPerSec: 1.1,
  costMax: 45,
  spawns: buildSpawns(),
  seed: 20260725,
}
