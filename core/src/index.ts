// core — 순수 TS 시뮬레이션 (단일 진실 원천)
// 규칙 (docs/03-architecture.md):
//   - Phaser·DOM·window 참조 금지. Node/브라우저 양쪽에서 동일 동작.
//   - 고정 틱, 시드 RNG. Math.random() 금지.
export const CORE_VERSION = '0.1.0'

export * from './types'
export * from './rng'
export * from './sim'
export { UNIT_DEFS } from './content/units'
export { ENEMY_DEFS } from './content/enemies'
export { STAGE_001 } from './content/stages/stage-001'
