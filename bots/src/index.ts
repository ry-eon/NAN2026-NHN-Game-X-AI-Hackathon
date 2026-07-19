// bots — core를 헤드리스로 구동하는 플레이 에이전트 3등급.
// Planner(계획) > Greedy(즉흥) > Random(하한). 등급 간 성과 격차가 난이도 신호다.

export { runHeadless, runReplay } from './runner'
export type { BotPolicy, BotRunResult, RunOptions } from './runner'
export { createGreedyPolicy } from './greedy'
export { createPlannerPolicy } from './planner'
export { createRandomPolicy } from './random'
export { evaluateBots } from './evaluate'
export { activeSkillActions } from './skills'
export type { BotAggregate, BotSpec } from './evaluate'
