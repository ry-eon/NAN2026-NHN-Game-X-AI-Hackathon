// 소프트 파이프라인 [1] 생성 — 랜덤 캐릭터 생성기 (docs/07 v2).
// 캐릭터 = 역할 원형 × 스탯 변주(±8%) × 기술 3종 조합 × 생존 톤 정체성.
// 같은 시드 = 같은 캐릭터 (mulberry32). 이름·서사는 조합 풀 [초안] —
// LLM 생성으로 교체 가능하되 같은 CharacterDef 스키마를 지킨다.

import { SKILL_LIBRARY, UNIT_DEFS, rngFloat, rngInt } from '@core'
import type { CharacterDef, RngState, SkillDef } from '@core'

// 봇이 운용 가능한 역할만 생성 (힐러·감속사 운용 독트린은 W3 후속 —
// 봇이 못 쓰는 역할은 밸런스 판정이 불가능하다)
const GENERATABLE_ROLES = ['blocker', 'bruiser', 'archer', 'mage']

const FIRST = ['하', '서', '도', '무', '가', '단', '유', '재', '시', '은', '란', '세', '진', '채', '온', '수']
const SECOND = ['람', '온', '영', '비', '안', '율', '아', '준', '주', '겸', '솔', '우', '찬', '해', '린', '목']

const EPITHETS = [
  '잿빛', '무너진 문의', '탑그림자', '녹슨 칼날의', '재투성이', '밤을 걷는',
  '동트기 전의', '한파의', '침묵하는', '불씨를 쥔', '마지막 보루의', '상처 입은',
]
const PLACES = [
  '무너진 동쪽 관문', '불탄 곡창 마을', '버려진 수도원', '얼어붙은 나루터',
  '함락된 북쪽 초소', '재가 된 시장거리', '무너진 등대', '폐쇄된 갱도',
]
const LOSSES = ['가족', '고향', '전우', '스승', '이름', '왼눈']
const REASONS = ['다시는 잃지 않으려', '빚을 갚으려', '돌아갈 곳이 없어', '괴수의 피를 갚으려']

const DEPLOY_LINES = [
  '여기까지다.', '자리는 내가 지킨다.', '…왔군.', '숨죽여라.', '벽 뒤로 물러서라.', '시작하지.',
]
const SKILL_LINES = ['지금이다!', '무너져라!', '버텨!', '…끝을 보자.', '전부 쓸어낸다!']
const VICTORY_LINES = [
  '아직 살아 있다.', '성은 지켜졌다.', '…다음이 또 온다.', '오늘 몫은 했다.', '수고했다, 모두.',
]

const pick = <T>(rng: RngState, arr: readonly T[]): T => arr[rngInt(rng, arr.length)]!

function pickSkill(rng: RngState, slot: SkillDef['slot']): SkillDef {
  const pool = SKILL_LIBRARY.filter((s) => s.slot === slot)
  return pool[rngInt(rng, pool.length)]!
}

/** 시드 하나 → 캐릭터 하나 (결정론). 레벨 무관한 원본 def — 전투 투입은 applyLevel 경유 */
export function generateCharacter(seed: number): CharacterDef {
  const rng: RngState = { rngState: seed | 0 }

  const role = pick(rng, GENERATABLE_ROLES)
  const archetype = UNIT_DEFS.find((d) => d.id === role)!

  // 스탯 변주 ±8% — 정체성을 위한 변주이되 판정(OP/USELESS)이 걸러낼 범위
  const hpMul = 0.92 + rngFloat(rng) * 0.16
  const atkMul = 0.92 + rngFloat(rng) * 0.16

  // 아처 전용 패시브(매의 눈)가 근접에게 가면 무의미(NO_IDENTITY감) —
  // 근접 역할이 뽑으면 다시 뽑는다 (결정론 유지: 같은 시드는 같은 재추첨 경로)
  let passive = pickSkill(rng, 'passive')
  while (
    archetype.range === 0 &&
    passive.effect.kind === 'statMod' &&
    passive.effect.rangeAdd !== undefined
  ) {
    passive = pickSkill(rng, 'passive')
  }

  const name = pick(rng, FIRST) + pick(rng, SECOND)
  return {
    ...archetype,
    id: `c-${String(seed).padStart(4, '0')}`,
    name,
    role,
    hp: Math.round(archetype.hp * hpMul),
    atk: Math.round(archetype.atk * atkMul),
    epithet: pick(rng, EPITHETS),
    lore: `${pick(rng, PLACES)} 출신. ${pick(rng, LOSSES)}을(를) 잃고, ${pick(rng, REASONS)} 성벽에 섰다.`,
    lines: {
      deploy: pick(rng, DEPLOY_LINES),
      skill: pick(rng, SKILL_LINES),
      victory: pick(rng, VICTORY_LINES),
    },
    skillSet: {
      passive,
      auto: pickSkill(rng, 'auto'),
      active: pickSkill(rng, 'active'),
    },
  }
}
