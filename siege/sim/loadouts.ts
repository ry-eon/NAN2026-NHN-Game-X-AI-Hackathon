// 로드아웃 프리셋 — 기획 시험용 편성안.
//
// sim 로직을 건드리지 않고 편성만 갈아끼운다. `pnpm verify --compare`가 이 전부를
// 봇 3등급으로 돌려 표로 뽑아주므로, "대포를 늘리면 실제로 나아지는가"를 손감이 아니라
// 판정으로 답할 수 있다.
//
// 새 안을 추가하는 법: 아래 배열에 항목 하나를 더한다. sim·렌더러 수정은 필요 없다
// (모르는 병종을 넣으면 렌더러가 기사 모델로 대체하므로 형상만 나중에 붙이면 된다).

import { CASTLE, DEFAULT_LOADOUT, UNIT_KINDS, WALL_X } from './world'
import type { Loadout, UnitPlacement } from './world'

const H = CASTLE.wallH
const at = (kind: string, z: number, h = H): UnitPlacement => ({ kind, x: WALL_X, z, h })
const hero: UnitPlacement = { kind: 'hero', x: WALL_X - 6, z: 0, h: 0 }

/** 대포 편성 — 사용자 지적("대포가 너무 적다"). 궁수 2를 대포 2로 바꿔 화력 축을 옮긴다 */
const CANNON_HEAVY: Loadout = {
  ...DEFAULT_LOADOUT,
  name: 'cannon-heavy',
  placements: [
    ...[-15, -5, 5, 15].map((z) => at('soldier', z)),
    at('cannon', -18),
    at('cannon', -9),
    at('cannon', 9),
    at('cannon', 18),
    at('ballista', -1.6),
    at('ballista', 1.6),
    hero,
  ],
}

/** 폐지된 구 출고 편성 — 궁수를 뺀 결정이 옳았는지 계속 재는 대조군 (2026-08-04까지 출고) */
const MIXED_LINE: Loadout = {
  ...DEFAULT_LOADOUT,
  name: 'mixed-line',
  placements: [
    ...[-15, -9, -5, 5, 9, 15].map((z) => at('soldier', z)),
    at('cannon', -12),
    at('cannon', 12),
    at('ballista', -1.6),
    at('ballista', 1.6),
    hero,
  ],
}

/** 궁수 다수 — 반대쪽 대조군 (단일 표적 화력 + 넓은 커버리지) */
const ARCHER_LINE: Loadout = {
  ...DEFAULT_LOADOUT,
  name: 'archer-line',
  placements: [
    ...[-18, -14, -10, -6, 6, 10, 14, 18].map((z) => at('soldier', z)),
    at('cannon', -2.6),
    at('cannon', 2.6),
    hero,
  ],
}

/** 성벽 여유 확대 — 편성이 아니라 노브 하나만 바꾼 대조군 (봇 검증의 기준선 비교용) */
const THICK_WALL: Loadout = {
  ...DEFAULT_LOADOUT,
  name: 'thick-wall',
  wallHp: 3000,
}

export const LOADOUTS: Loadout[] = [DEFAULT_LOADOUT, CANNON_HEAVY, MIXED_LINE, ARCHER_LINE, THICK_WALL]

export function findLoadout(name: string): Loadout | undefined {
  return LOADOUTS.find((l) => l.name === name)
}

/** 편성 요약 (리포트 표기용) — "궁수 6 · 대포 2 · 발리스타 2 · 영웅 1" */
export function describeLoadout(l: Loadout): string {
  const counts = new Map<string, number>()
  for (const p of l.placements) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1)
  return [...counts]
    .map(([k, n]) => `${(l.unitKinds[k] ?? UNIT_KINDS[k])?.name ?? k} ${n}`)
    .join(' · ')
}
