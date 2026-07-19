// bots — core를 헤드리스로 구동하는 플레이 에이전트.
// W1: Greedy 1종. W2에서 Planner/Random 추가 → 등급 간 성과 차이가 난이도 신호가 된다.

export { runHeadless, runReplay } from './runner'
export type { BotPolicy, BotRunResult, RunOptions } from './runner'
export { createGreedyPolicy } from './greedy'
