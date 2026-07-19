// 시드 RNG (mulberry32). core의 모든 무작위성은 이 모듈만 경유한다.
// 상태(rngState)는 GameState에 number 하나로 직렬화되어, 어느 틱에서든
// 상태 스냅샷만으로 시뮬레이션을 재현할 수 있다.

export interface RngState {
  rngState: number
}

/** 32비트 무부호 정수 하나를 뽑고 상태를 전진시킨다. */
export function rngNextU32(s: RngState): number {
  s.rngState = (s.rngState + 0x6d2b79f5) | 0
  let t = s.rngState
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return (t ^ (t >>> 14)) >>> 0
}

/** [0, 1) 구간 float. */
export function rngFloat(s: RngState): number {
  return rngNextU32(s) / 0x1_0000_0000
}

/** [0, maxExclusive) 구간 정수. */
export function rngInt(s: RngState, maxExclusive: number): number {
  return Math.floor(rngFloat(s) * maxExclusive)
}
