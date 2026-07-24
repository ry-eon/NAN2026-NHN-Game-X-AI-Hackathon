// [1] 생성 — 절차적 스테이지 생성기 v3 (회랑 조각 방식).
// v3 동적 길찾기 전제: 맵은 "전부 벽(X)"에서 시작해 도로망을 판다.
//   - 레인 1~2개 (동쪽 스폰 → 연결로 → 서쪽 회랑 → 성벽)
//   - 세로 연결로: 레인 간 우회를 만든다 (한쪽을 봉쇄하면 돌아간다)
//   - 알코브(막다른 지상칸): 근접 측면 니치 / 다리(회랑 사이 지상칸): 소프트 우회
// 같은 시드 = 같은 스테이지 (mulberry32, core와 동일 RNG).

import { TICKS_PER_SECOND, rngFloat, rngInt } from '@core'
import type { CellPos, RngState, SpawnDef, StageDef } from '@core'

const sec = (s: number) => Math.round(s * TICKS_PER_SECOND)

/** 시드 하나로 스테이지 하나를 결정론적으로 생성 */
export function generateStage(seed: number): StageDef {
  const rng: RngState = { rngState: seed | 0 }

  const width = 11 + rngInt(rng, 3) // 11~13
  const height = 7 + rngInt(rng, 3) // 7~9
  const twoLanes = rngFloat(rng) < 0.65
  const connX = 5 + rngInt(rng, Math.max(1, width - 8)) // 연결로 x (5..width-4)

  // 전부 벽에서 시작
  const grid: string[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => 'X'),
  )
  const carve = (x: number, y: number, ch = 'R'): void => {
    if (y >= 1 && y <= height - 2 && x >= 1 && x <= width - 1) grid[y]![x] = ch
  }

  // 서쪽 회랑 행(성벽 접점)과 동쪽 레인 행
  const corrA = 2
  const corrB = twoLanes ? height - 3 : corrA
  const laneA = 1
  const laneB = twoLanes ? height - 2 : laneA

  // 동쪽 레인: connX..width-1, 서쪽 회랑: 1..connX
  for (let x = connX; x <= width - 1; x++) carve(x, laneA)
  for (let x = 1; x <= connX; x++) carve(x, corrA)
  if (twoLanes) {
    for (let x = connX; x <= width - 1; x++) carve(x, laneB)
    for (let x = 1; x <= connX; x++) carve(x, corrB)
  }
  // 세로 연결로: 레인·회랑을 전부 잇는다 (우회의 핵심)
  for (let y = Math.min(laneA, corrA); y <= Math.max(laneB, corrB); y++) carve(connX, y)

  // 단일 레인이면 고리형 우회로를 하나 더 판다 (봉쇄 시 돌아갈 길)
  if (!twoLanes && corrA + 2 <= height - 2) {
    const loopY = corrA + 2
    const loopStart = 2
    for (let x = loopStart; x <= connX; x++) carve(x, loopY)
    carve(loopStart, corrA + 1)
    // connX 세로줄이 이미 corrA..loopY를 관통하도록
    for (let y = corrA; y <= loopY; y++) carve(connX, y)
  }

  // 알코브(막다른 G): 회랑 위/아래 X칸 중 일부
  const alcoveRoll = 0.3 + rngFloat(rng) * 0.2
  for (const cy of twoLanes ? [corrA, corrB] : [corrA]) {
    for (let x = 2; x < connX; x += 2) {
      if (rngFloat(rng) > alcoveRoll) continue
      const dy = cy === corrA ? 1 : -1
      const ay = cy + (cy === corrA ? -1 : 1)
      const ay2 = cy + dy
      const target = grid[ay]?.[x] === 'X' ? ay : grid[ay2]?.[x] === 'X' ? ay2 : -1
      if (target > 0) grid[target]![x] = 'G'
    }
  }
  // 두 회랑 사이 다리(지상): 소프트 우회 1개 (두 레인일 때만, 낮은 확률)
  if (twoLanes && corrB - corrA === 2 && rngFloat(rng) < 0.5) {
    const bx = 2 + rngInt(rng, Math.max(1, connX - 3))
    grid[corrA + 1]![bx] = 'G'
  }

  // 성벽: x0, 회랑 행에 W (goal = (1, corr))
  grid[corrA]![0] = 'W'
  if (twoLanes) grid[corrB]![0] = 'W'
  // 추가 원거리 슬롯: 회랑 사이/인접 x0 (배치 여유, goal은 안 늘어남 — 인접 칸이 X)
  const extraW = corrA + 1
  if (extraW <= height - 2 && grid[extraW]![0] === 'X' && grid[extraW]![1] === 'X') {
    grid[extraW]![0] = 'W'
  }

  // 권장 진격로 (paths[i][0]이 스폰 지점)
  const west = (fromX: number, toX: number, y: number): CellPos[] => {
    const cells: CellPos[] = []
    for (let x = fromX; x >= toX; x--) cells.push({ x, y })
    return cells
  }
  const vert = (x: number, fromY: number, toY: number): CellPos[] => {
    const cells: CellPos[] = []
    const step = fromY < toY ? 1 : -1
    for (let y = fromY + step; step > 0 ? y <= toY : y >= toY; y += step) cells.push({ x, y })
    return cells
  }
  const pathA: CellPos[] = [
    ...west(width - 1, connX, laneA),
    ...vert(connX, laneA, corrA),
    ...west(connX - 1, 1, corrA),
  ]
  const paths: CellPos[][] = [pathA]
  if (twoLanes) {
    paths.push([
      ...west(width - 1, connX, laneB),
      ...vert(connX, laneB, corrB),
      ...west(connX - 1, 1, corrB),
    ])
  }

  // 경제
  const wallHp = [350, 450, 550][rngInt(rng, 3)]!
  const initialCost = 8 + rngInt(rng, 5) // 8~12
  const costRegenPerSec = 0.7 + rngInt(rng, 4) * 0.1 // 0.7~1.0

  // 웨이브: 완만한 시작 → 페어 → 총공세 램프. 물량은 경제·공격성 연동
  const rich = costRegenPerSec >= 0.9 ? 1 : 0
  const aggro = rngInt(rng, 3)
  const spawns: SpawnDef[] = []
  const lane = () => rngInt(rng, paths.length)

  let t = 5 + rngInt(rng, 3)
  const w1Count = 3 + rngInt(rng, 3)
  for (let i = 0; i < w1Count; i++) {
    spawns.push({ tick: sec(t), enemyDefId: rngFloat(rng) < 0.25 ? 'runner' : 'grunt', pathIndex: lane(), wave: 1 })
    t += 2 + rngInt(rng, 3)
  }

  t = Math.max(t + 4, 20) + rngInt(rng, 4)
  const w2Groups = 2 + rngInt(rng, 2) + rich + (aggro >= 2 ? 1 : 0)
  for (let g = 0; g < w2Groups; g++) {
    const li = lane()
    const kind = rngFloat(rng) < 0.5 ? 'runner' : 'grunt'
    spawns.push({ tick: sec(t), enemyDefId: kind, pathIndex: li, wave: 2 })
    spawns.push({ tick: sec(t + rngInt(rng, 2)), enemyDefId: kind, pathIndex: li, wave: 2 })
    t += 3 + rngInt(rng, 3)
  }

  t = Math.max(t + 6, 38) + rngInt(rng, 5)
  for (let li = 0; li < paths.length; li++) {
    spawns.push({ tick: sec(t + li * 2), enemyDefId: 'tank', pathIndex: li, wave: 3 })
  }
  if (rngFloat(rng) < 0.35) {
    spawns.push({ tick: sec(t + 3), enemyDefId: 'siege', pathIndex: lane(), wave: 3 })
  }
  const clumpLane = lane()
  const clumpSize = 2 + rngInt(rng, 2) + rich + (aggro >= 1 ? 1 : 0)
  const clumpT = t + 4 + rngInt(rng, 3)
  for (let i = 0; i < clumpSize; i++) {
    spawns.push({ tick: sec(clumpT), enemyDefId: 'grunt', pathIndex: clumpLane, wave: 3 })
  }
  if (aggro >= 2) {
    spawns.push({ tick: sec(clumpT + 6), enemyDefId: 'tank', pathIndex: lane(), wave: 3 })
  }
  const tailCount = 2 + rngInt(rng, 2) + rich + (aggro >= 1 ? 1 : 0)
  for (let i = 0; i < tailCount; i++) {
    spawns.push({
      tick: sec(clumpT + 4 + i * (2 + rngInt(rng, 2))),
      enemyDefId: rngFloat(rng) < 0.5 ? 'runner' : 'grunt',
      pathIndex: lane(),
      wave: 3,
    })
  }

  spawns.sort((a, b) => a.tick - b.tick)

  return {
    id: `gen-${String(seed).padStart(4, '0')}`,
    name: `자동 생성 #${seed}`,
    tilesRows: grid.map((row) => row.join('')),
    paths,
    wallHp,
    initialCost,
    costRegenPerSec: Number(costRegenPerSec.toFixed(1)),
    costMax: 30,
    spawns,
    seed,
  }
}
