// 기술 라이브러리 12종 (패시브 4 / 자동 4 / 액티브 4) — docs/07 최소 성립선.
// 캐릭터 생성 파이프라인이 이 풀에서 슬롯별 1종씩 조합한다. 수치는 전부 [초안],
// 조합 밸런스는 봇 교체 투입 시뮬(OP/USELESS 판정)로 검증한다.

import { TICKS_PER_SECOND } from '../types'
import type { SkillDef } from '../types'

const sec = (s: number) => Math.round(s * TICKS_PER_SECOND)

export const SKILL_LIBRARY: SkillDef[] = [
  // ---- 패시브 (Lv1 해금) ----
  {
    id: 'p-pierce',
    name: '꿰뚫기',
    desc: '적 방어력을 50% 무시한다.',
    slot: 'passive',
    effect: { kind: 'armorPierce', ratio: 0.5 },
  },
  {
    id: 'p-guard',
    name: '수호 본능',
    desc: '저지 수 +1.',
    slot: 'passive',
    effect: { kind: 'statMod', blockAdd: 1 },
  },
  {
    id: 'p-eagle',
    name: '매의 눈',
    desc: '사거리 +0.5 (원거리 전용).',
    slot: 'passive',
    effect: { kind: 'statMod', rangeAdd: 0.5 },
  },
  {
    id: 'p-scavenge',
    name: '전리품',
    desc: '적 처치 시 코스트 +1.',
    slot: 'passive',
    effect: { kind: 'onKillCost', amount: 1 },
  },
  // ---- 자동 (Lv3 해금) ----
  {
    id: 'a-pulse',
    name: '파문',
    desc: '3회 공격마다 표적 주변에 70% 광역 피해.',
    slot: 'auto',
    effect: { kind: 'aoePulse', everyNAttacks: 3, radius: 1.2, dmgMul: 0.7 },
  },
  {
    id: 'a-mend',
    name: '응급 처치',
    desc: 'HP 50% 미만이 되면 200 회복 (8초 주기).',
    slot: 'auto',
    effect: { kind: 'selfHeal', thresholdRatio: 0.5, amount: 200, cooldownTicks: sec(8) },
  },
  {
    id: 'a-bulwark',
    name: '방벽',
    desc: '12초마다 피해를 흡수하는 보호막 150.',
    slot: 'auto',
    effect: { kind: 'shield', amount: 150, intervalTicks: sec(12) },
  },
  {
    id: 'a-regen',
    name: '재생',
    desc: '3초마다 40 회복.',
    slot: 'auto',
    effect: { kind: 'selfHeal', thresholdRatio: 1, amount: 40, cooldownTicks: sec(3) },
  },
  // ---- 액티브 (Lv5 해금, 수동) ----
  {
    id: 'x-frenzy',
    name: '전의 폭발',
    desc: '6초간 공격 속도 2배.',
    slot: 'active',
    effect: { kind: 'frenzy', atkSpeedMul: 2, durationTicks: sec(6) },
    cooldownTicks: sec(30),
  },
  {
    id: 'x-repel',
    name: '밀쳐내기',
    desc: '저지 중인 적을 2타일 밀쳐내고 저지를 푼다.',
    slot: 'active',
    effect: { kind: 'knockback', tiles: 2 },
    cooldownTicks: sec(25),
  },
  {
    id: 'x-second-wind',
    name: '재기',
    desc: '즉시 400 회복.',
    slot: 'active',
    effect: { kind: 'heal', amount: 400 },
    cooldownTicks: sec(30),
  },
  {
    id: 'x-nova',
    name: '충격파',
    desc: '자기 주변 1.6타일에 방어 무시 250 피해.',
    slot: 'active',
    effect: { kind: 'nova', damage: 250, radius: 1.6 },
    cooldownTicks: sec(35),
  },
]
