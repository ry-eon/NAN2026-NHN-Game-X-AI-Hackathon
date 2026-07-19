// 봇 액티브 기술 독트린 v0 [초안]:
// "저지 2기 이상(교전 과부하) 또는 HP 50% 미만(위기)이면 액티브를 쓴다."
// 검증 봇이 액티브를 실제로 써야 기술 밸런스 판정(OP/USELESS)이 성립한다.
// Greedy/Planner 공용 — 등급 차는 배치 판단에서 나고, 기술 사용은 동일 규칙.

import type { GameState, PlayerAction, SimContext } from '@core'

export function activeSkillActions(ctx: SimContext, state: GameState): PlayerAction[] {
  const actions: PlayerAction[] = []
  for (const u of state.units) {
    const def = ctx.unitDefs[u.defId]!
    const active = def.skills?.find((s) => s.slot === 'active')
    if (!active || u.activeReadyAt > state.tick) continue
    if (u.blockedEnemyIds.length >= 2 || u.hp < def.hp * 0.5) {
      actions.push({ type: 'useSkill', unitId: u.id })
    }
  }
  return actions
}
