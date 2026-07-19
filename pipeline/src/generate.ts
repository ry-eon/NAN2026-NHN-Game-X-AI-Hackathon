// [1] 생성 — 절차적 스테이지 생성기 (템플릿 + 시드 변형).
// W2 경보 폴백 원칙(docs/04-milestones.md)에 따라 절차적 생성을 기본으로 두고,
// LLM 생성은 같은 StageDef 스키마로 후일 교체/병행 가능하게 한다.
// 같은 시드 = 같은 스테이지 (mulberry32, core와 동일 RNG).

import { TICKS_PER_SECOND, rngFloat, rngInt } from '@core'
import type { CellPos, RngState, SpawnDef, StageDef } from '@core'

const sec = (s: number) => Math.round(s * TICKS_PER_SECOND)

/** 시드 하나로 스테이지 하나를 결정론적으로 생성 */
export function generateStage(seed: number): StageDef {
  const rng: RngState = { rngState: seed | 0 }

  const width = 11 + rngInt(rng, 3) // 11~13
  const height = 8 + rngInt(rng, 2) // 8~9
  const twoLanes = rngFloat(rng) < 0.65

  // 레인 행: 위/아래 절반에서 하나씩 (단일 레인이면 중앙 부근)
  const laneRows = twoLanes
    ? [1 + rngInt(rng, 2), height - 2 - rngInt(rng, 2)]
    : [2 + rngInt(rng, height - 4)]

  // 경로 생성: 오른쪽 끝에서 서진, 확률적으로 한 번 꺾여 행 이동 후 x=1까지
  const paths: CellPos[][] = laneRows.map((row, li) => {
    const cells: CellPos[] = []
    let y = row
    for (let x = width - 1; x >= 1; x--) {
      cells.push({ x, y })
      if (x > 3 && x < width - 3 && rngFloat(rng) < 0.18) {
        // 꺾임: 위 레인은 아래로, 아래 레인은 위로 1~2행 (중앙 침범 금지)
        const dir = li === 0 ? 1 : -1
        const shift = 1 + rngInt(rng, 2)
        for (let s = 0; s < shift; s++) {
          const ny = y + dir
          const limit = li === 0 ? Math.floor(height / 2) - 1 : Math.ceil(height / 2)
          if (twoLanes && (li === 0 ? ny > limit : ny < limit)) break
          if (ny < 1 || ny > height - 2) break
          y = ny
          cells.push({ x, y })
        }
      }
    }
    return cells
  })

  // 타일: 기본 G, 경로는 R, 테두리·성벽열은 X, 성벽 위 슬롯만 W
  const grid: string[][] = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) =>
      y === 0 || y === height - 1 || x === 0 ? 'X' : 'G',
    ),
  )
  for (const path of paths) for (const c of path) grid[c.y]![c.x] = 'R'

  // 성벽 위 슬롯 2~4칸: 각 레인 종점을 커버하는 행을 반드시 포함
  const slotCount = 2 + rngInt(rng, 3)
  const slots = new Set<number>()
  for (const path of paths) slots.add(path[path.length - 1]!.y)
  while (slots.size < slotCount) {
    const y = 1 + rngInt(rng, height - 2)
    slots.add(y)
  }
  for (const y of slots) grid[y]![0] = 'W'

  // 경제
  const wallHp = [350, 450, 550][rngInt(rng, 3)]!
  const initialCost = 8 + rngInt(rng, 5) // 8~12
  const costRegenPerSec = 0.7 + rngInt(rng, 4) * 0.1 // 0.7~1.0

  // 웨이브: 완만한 시작 → 페어 → 총공세(중장병 + 동시 클럼프) 램프.
  // 물량은 경제에 연동 — 수입(재생률)이 낮으면 감당 가능한 총 HP도 낮다
  const rich = costRegenPerSec >= 0.9 ? 1 : 0
  const spawns: SpawnDef[] = []
  const lane = () => rngInt(rng, paths.length)

  let t = 5 + rngInt(rng, 3)
  const w1Count = 3 + rngInt(rng, 3)
  for (let i = 0; i < w1Count; i++) {
    spawns.push({ tick: sec(t), enemyDefId: rngFloat(rng) < 0.25 ? 'runner' : 'grunt', pathIndex: lane(), wave: 1 })
    t += 2 + rngInt(rng, 3)
  }

  t = Math.max(t + 4, 20) + rngInt(rng, 4)
  const w2Groups = 2 + rngInt(rng, 2) + rich
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
  // 35% 확률로 공성차 투입 — 경로 안쪽 커버가 없는 맵이면 봇이 못 잡고
  // 판정에서 UNSOLVABLE로 자동 반려된다 (검증기가 맵 결함을 거른다)
  if (rngFloat(rng) < 0.35) {
    spawns.push({ tick: sec(t + 3), enemyDefId: 'siege', pathIndex: lane(), wave: 3 })
  }
  const clumpLane = lane()
  const clumpSize = 2 + rngInt(rng, 2) + rich // 2~4 동시 (경제 연동)
  const clumpT = t + 4 + rngInt(rng, 3)
  for (let i = 0; i < clumpSize; i++) {
    spawns.push({ tick: sec(clumpT), enemyDefId: 'grunt', pathIndex: clumpLane, wave: 3 })
  }
  const tailCount = 2 + rngInt(rng, 2) + rich
  for (let i = 0; i < tailCount; i++) {
    spawns.push({
      tick: sec(clumpT + 4 + i * (2 + rngInt(rng, 2))),
      enemyDefId: rngFloat(rng) < 0.5 ? 'runner' : 'grunt',
      pathIndex: lane(),
      wave: 3,
    })
  }

  spawns.sort((a, b) => a.tick - b.tick)

  const id = `gen-${String(seed).padStart(4, '0')}`
  return {
    id,
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
