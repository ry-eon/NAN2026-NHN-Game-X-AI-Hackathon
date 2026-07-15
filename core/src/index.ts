// core — 순수 TS 시뮬레이션 (단일 진실 원천)
// 규칙 (docs/03-architecture.md):
//   - Phaser·DOM·window 참조 금지. Node/브라우저 양쪽에서 동일 동작.
//   - 고정 틱, 시드 RNG. Math.random() 금지.
// W1에서 그리드/성벽/블로킹/코스트/웨이브/승패 판정이 여기에 들어온다.

export const CORE_VERSION = '0.0.1'
