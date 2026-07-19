// 레벨 → 전투용 def 변환 (docs/07 v2 확정).
// sim은 레벨을 모른다 — 메타 레이어(캠페인/로스터)가 이 함수로 배틀 def를 만들어
// Simulation에 넘긴다. 같은 (캐릭터, 레벨)이면 항상 같은 배틀 def (결정론).

import type { CharacterDef, SkillDef } from './types'

export const MAX_LEVEL = 5
/** 기술 해금 레벨: 패시브 Lv1 → 자동 Lv3 → 액티브 Lv5 */
export const SKILL_UNLOCK = { passive: 1, auto: 3, active: 5 } as const
/** 레벨당 스탯 스케일 [초안] */
export const STAT_SCALE_PER_LEVEL = 0.08

/**
 * 캐릭터 + 레벨 → 전투용 CharacterDef.
 * - hp/atk는 레벨 스케일 (1.08^(lv-1))
 * - 해금된 기술만 skills에 실린다
 * - statMod 패시브는 여기서 스탯에 굽는다 (sim은 statMod를 해석하지 않음)
 * - rangeAdd는 원거리(range>0) 유닛에만 적용 — 근접을 원거리로 바꾸지 않는다
 */
export function applyLevel(ch: CharacterDef, level: number): CharacterDef {
  const lv = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)))
  const scale = Math.pow(1 + STAT_SCALE_PER_LEVEL, lv - 1)

  const skills: SkillDef[] = []
  if (ch.skillSet) {
    if (lv >= SKILL_UNLOCK.passive) skills.push(ch.skillSet.passive)
    if (lv >= SKILL_UNLOCK.auto) skills.push(ch.skillSet.auto)
    if (lv >= SKILL_UNLOCK.active) skills.push(ch.skillSet.active)
  }

  const battle: CharacterDef = {
    ...ch,
    hp: Math.round(ch.hp * scale),
    atk: Math.round(ch.atk * scale),
    skills,
  }

  const passive = skills.find((s) => s.slot === 'passive')?.effect
  if (passive && passive.kind === 'statMod') {
    battle.hp = Math.round(battle.hp * (passive.hpMul ?? 1))
    battle.atk = Math.round(battle.atk * (passive.atkMul ?? 1))
    battle.def = battle.def + (passive.defAdd ?? 0)
    battle.blockCount = battle.blockCount + (passive.blockAdd ?? 0)
    if (battle.range > 0) battle.range = battle.range + (passive.rangeAdd ?? 0)
  }
  return battle
}
