// 봇 러너 — 정책으로 판을 끝까지 돌리고 결과 + **커맨드 시퀀스**를 남긴다.
//
// 커맨드 시퀀스가 곧 리플레이 포맷이다. sim이 결정론이라 (시드, 커맨드 시퀀스)만 있으면
// 누구든 같은 판을 재현할 수 있다 — `replay()`가 그 재현이 실제로 일치하는지 확인한다.
// "봇이 검증했다"는 주장이 말이 되려면 검증 결과를 다시 돌려볼 수 있어야 한다.

import { DEFAULT_LOADOUT, TICKS_PER_SECOND, createSiege, mulberry32, stepSiege } from '../sim/world'
import type { Loadout, SiegeInput, SiegeStatus } from '../sim/world'
import type { BotPolicy } from './policy'

/**
 * 기록된 커맨드 한 건.
 *
 * 키는 **틱이 아니라 스텝 번호**다 — sim이 침공 개시 때 `state.tick = 0`으로 되돌리기 때문에
 * (침공 타임라인 기준으로 다시 세는 설계) 틱은 판 전체에서 고유하지 않다.
 * 틱으로 키를 잡으면 준비 단계의 마지막 커맨드와 침공 첫 틱의 커맨드가 같은 키로 뭉개진다.
 * tick은 사람이 읽기 위한 참고값으로만 남긴다.
 */
export interface Command {
  step: number
  tick: number
  input: SiegeInput
}

export interface Playout {
  seed: number
  policy: string
  loadout: string
  status: SiegeStatus
  ticks: number
  seconds: number
  wallHp: number
  unitsAlive: number
  enemiesKilled: number
  unitsLost: number
  /** 리플레이 포맷 — 이 시퀀스를 같은 시드에 넣으면 같은 결과가 나온다 */
  commands: Command[]
}

/** 무한 루프 방지 — 어떤 정책도 이 안에 끝나야 한다 (기준 판이 90초) */
const MAX_TICKS = TICKS_PER_SECOND * 300

export function playout(
  seed: number,
  policy: BotPolicy,
  loadout: Loadout = DEFAULT_LOADOUT,
  botSeed = seed ^ 0x5eed,
): Playout {
  const { state, spawns } = createSiege(seed, loadout)
  const rand = mulberry32(botSeed)
  const commands: Command[] = []
  let killed = 0
  let lost = 0
  let step = 0

  while (state.status === 'prep' || state.status === 'assault') {
    if (step >= MAX_TICKS) break
    const input = policy.act(state, rand) ?? {}
    if (Object.keys(input).length > 0) commands.push({ step, tick: state.tick, input })
    step++
    stepSiege(state, spawns, input)
    for (const ev of state.events) {
      if (ev.type === 'enemyDied') killed++
      else if (ev.type === 'unitDied') lost++
    }
  }

  return {
    seed,
    policy: policy.name,
    loadout: loadout.name,
    status: state.status,
    ticks: state.tick,
    seconds: +(state.tick / TICKS_PER_SECOND).toFixed(1),
    wallHp: state.wallHp,
    unitsAlive: state.units.length,
    enemiesKilled: killed,
    unitsLost: lost,
    commands,
  }
}

/** 기록된 커맨드만 재생 — 봇 없이도 같은 판이 나오는지 확인한다 */
export function replay(
  seed: number,
  commands: Command[],
  loadout: Loadout = DEFAULT_LOADOUT,
): { status: SiegeStatus; ticks: number; wallHp: number; unitsAlive: number } {
  const { state, spawns } = createSiege(seed, loadout)
  const byStep = new Map<number, SiegeInput>()
  for (const c of commands) byStep.set(c.step, c.input)
  let step = 0
  while (state.status === 'prep' || state.status === 'assault') {
    if (step >= MAX_TICKS) break
    stepSiege(state, spawns, byStep.get(step) ?? {})
    step++
  }
  return {
    status: state.status,
    ticks: state.tick,
    wallHp: state.wallHp,
    unitsAlive: state.units.length,
  }
}
