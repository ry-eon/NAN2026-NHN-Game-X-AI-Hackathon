// 초기 캐릭터 6인 — 성주의 가신들 (세계관: 생존 서사, 괴수 침략).
// 스탯은 역할 원형(units.ts)을 그대로 상속하고 정체성 레이어만 얹는다.
// 이름·서사·대사는 전부 [초안] — W3 소프트 파이프라인(생성→검증→사람 승인)의
// 첫 수혜 대상이며, 상세 원장은 docs/06-characters.md.

import { UNIT_DEFS } from './units'
import { SKILL_LIBRARY } from './skills'
import type { CharacterDef, SkillDef, UnitDef } from '../types'

const sk = (id: string): SkillDef => {
  const def = SKILL_LIBRARY.find((s) => s.id === id)
  if (!def) throw new Error(`기술 없음: ${id}`)
  return def
}
const set = (passive: string, auto: string, active: string) => ({
  passive: sk(passive),
  auto: sk(auto),
  active: sk(active),
})

function archetype(roleId: string): UnitDef {
  const def = UNIT_DEFS.find((d) => d.id === roleId)
  if (!def) throw new Error(`역할 원형 없음: ${roleId}`)
  return def
}

const from = (
  roleId: string,
  identity: Pick<CharacterDef, 'id' | 'name' | 'epithet' | 'lore' | 'lines' | 'skillSet'>,
): CharacterDef => ({
  ...archetype(roleId),
  ...identity,
  role: roleId,
})

export const CHARACTERS: CharacterDef[] = [
  from('blocker', {
    id: 'doha',
    name: '도하',
    epithet: '철벽의',
    lore: '남문이 무너지던 밤 홀로 문틈을 메운 방패병. 그날 이후 등을 보인 적이 없다.',
    lines: {
      deploy: '이 선은, 넘게 두지 않는다.',
      skill: '버텨라…!',
      victory: '성벽은 아직 서 있다.',
    },
    skillSet: set('p-guard', 'a-bulwark', 'x-repel'),
  }),
  from('bruiser', {
    id: 'garam',
    name: '가람',
    epithet: '외날의',
    lore: '괴수에게 마을을 잃고 칼 한 자루만 들고 성문을 두드린 유랑검객.',
    lines: {
      deploy: '베어야 할 게 많군.',
      skill: '한 놈씩 와라.',
      victory: '칼은 아직 무디지 않았어.',
    },
    skillSet: set('p-pierce', 'a-mend', 'x-frenzy'),
  }),
  from('archer', {
    id: 'sea',
    name: '세아',
    epithet: '바람눈의',
    lore: '망루에서 태어나 망루에서 자랐다. 바람을 읽는 눈은 성에서 제일이다.',
    lines: {
      deploy: '바람, 좋네.',
      skill: '놓치지 않아.',
      victory: '다음 침공도 여기서 지켜볼게.',
    },
    skillSet: set('p-eagle', 'a-pulse', 'x-frenzy'),
  }),
  from('mage', {
    id: 'muyeong',
    name: '무영',
    epithet: '잿불의',
    lore: '금서를 태운 재로 술식을 쓰는 은둔 술사. 이 불은 괴수만 태운다고 믿고 싶어 한다.',
    lines: {
      deploy: '물러서라. 탄다.',
      skill: '재가 되어라.',
      victory: '…아직 내 불은 꺼지지 않았다.',
    },
    skillSet: set('p-scavenge', 'a-pulse', 'x-nova'),
  }),
  from('healer', {
    id: 'danbi',
    name: '단비',
    epithet: '마지막 숨의',
    lore: '함락된 서쪽 성채의 유일한 생존 의무병. 더는 아무도 놓치지 않겠다고 다짐했다.',
    lines: {
      deploy: '다치면 바로 불러요.',
      skill: '숨을 붙들어요…!',
      victory: '오늘은 아무도 잃지 않았어요.',
    },
    skillSet: set('p-eagle', 'a-regen', 'x-second-wind'),
  }),
  from('slower', {
    id: 'hajan',
    name: '하잔',
    epithet: '늪그림자',
    lore: '성 밖 늪지에서 덫으로 괴수를 잡아 살아온 사냥꾼. 말수가 적다.',
    lines: {
      deploy: '…느려져라.',
      skill: '덫은 이미 놓였다.',
      victory: '…끝.',
    },
    skillSet: set('p-scavenge', 'a-regen', 'x-repel'),
  }),
]
