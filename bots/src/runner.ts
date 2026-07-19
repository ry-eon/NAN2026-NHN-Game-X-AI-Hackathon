// 헤드리스 러너: core를 브라우저 없이 구동한다.
// 클라이언트와 완전히 같은 core.step()을 돌리므로 "봇이 검증한 스테이지 =
// 플레이어가 하는 스테이지"가 성립한다 (docs/03-architecture.md).
// W2 파이프라인의 봇 시뮬 N회가 이 러너를 그대로 재사용한다.

import { Simulation, TICKS_PER_SECOND } from '@core'
import type {
  EnemyDef,
  GameState,
  GameStatus,
  PlayerAction,
  SimContext,
  StageDef,
  TimedAction,
  UnitDef,
} from '@core'

/** 봇 = 관측 가능한 상태 → 이번 틱의 행동. 상태를 변경해선 안 된다. */
export type BotPolicy = (ctx: SimContext, state: GameState) => PlayerAction[]

export interface RunOptions {
  seed?: number
  /** 안전 상한 (기본 10분) */
  maxTicks?: number
}

export interface BotRunResult {
  status: GameStatus
  ticks: number
  seconds: number
  wallHp: number
  /** 잔여 성벽 HP 비율 — 난이도 지표 후보 (docs/02-game-design.md [미결]) */
  wallHpRatio: number
  deploys: number
  enemiesKilled: number
  wallHits: number
  /** 전체 플레이 기록. runReplay로 재현 가능하고, 클라이언트 입력과 같은 형식 */
  actionLog: TimedAction[]
  finalState: GameState
}

const DEFAULT_MAX_TICKS = 10 * 60 * TICKS_PER_SECOND

export function runHeadless(
  stage: StageDef,
  unitDefs: UnitDef[],
  enemyDefs: EnemyDef[],
  policy: BotPolicy,
  opts: RunOptions = {},
): BotRunResult {
  const sim = new Simulation(stage, unitDefs, enemyDefs, opts.seed)
  const actionLog: TimedAction[] = []
  const tally = { deploys: 0, enemiesKilled: 0, wallHits: 0 }
  const maxTicks = opts.maxTicks ?? DEFAULT_MAX_TICKS

  while (sim.state.status === 'playing' && sim.state.tick < maxTicks) {
    const actions = policy(sim.ctx, sim.state)
    for (const action of actions) actionLog.push({ tick: sim.state.tick + 1, action })
    sim.step(actions)
    countEvents(sim.state, tally)
  }
  return toResult(stage, sim.state, actionLog, tally)
}

/** 기록된 액션 로그를 그대로 재생. 같은 스테이지·시드면 원 플레이와 결과가 일치해야 한다. */
export function runReplay(
  stage: StageDef,
  unitDefs: UnitDef[],
  enemyDefs: EnemyDef[],
  actionLog: TimedAction[],
  opts: RunOptions = {},
): BotRunResult {
  const sim = new Simulation(stage, unitDefs, enemyDefs, opts.seed)
  const byTick = new Map<number, PlayerAction[]>()
  for (const { tick, action } of actionLog) {
    const list = byTick.get(tick) ?? []
    list.push(action)
    byTick.set(tick, list)
  }
  const tally = { deploys: 0, enemiesKilled: 0, wallHits: 0 }
  const maxTicks = opts.maxTicks ?? DEFAULT_MAX_TICKS

  while (sim.state.status === 'playing' && sim.state.tick < maxTicks) {
    sim.step(byTick.get(sim.state.tick + 1) ?? [])
    countEvents(sim.state, tally)
  }
  return toResult(stage, sim.state, actionLog, tally)
}

function countEvents(
  state: GameState,
  tally: { deploys: number; enemiesKilled: number; wallHits: number },
): void {
  for (const e of state.events) {
    if (e.type === 'deployed') tally.deploys++
    else if (e.type === 'enemyKilled') tally.enemiesKilled++
    else if (e.type === 'wallHit') tally.wallHits++
  }
}

function toResult(
  stage: StageDef,
  state: GameState,
  actionLog: TimedAction[],
  tally: { deploys: number; enemiesKilled: number; wallHits: number },
): BotRunResult {
  return {
    status: state.status,
    ticks: state.tick,
    seconds: state.tick / TICKS_PER_SECOND,
    wallHp: state.wallHp,
    wallHpRatio: state.wallHp / stage.wallHp,
    ...tally,
    actionLog,
    finalState: state,
  }
}
