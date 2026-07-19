import { describe, expect, it } from 'vitest'
import { CHARACTERS, UNIT_DEFS } from '../src/index'

// 캐릭터 중심 개편(2026-07-20 확정)의 계약:
// 캐릭터 = 역할 원형의 스탯 + 정체성. 스탯이 원형과 어긋나면 밸런스 검증이 무효가 된다.
describe('캐릭터 로스터', () => {
  it('6인 — 역할 원형마다 정확히 1명', () => {
    expect(CHARACTERS).toHaveLength(6)
    const roles = CHARACTERS.map((c) => c.role).sort()
    expect(roles).toEqual(UNIT_DEFS.map((d) => d.id).sort())
  })

  it('스탯이 역할 원형과 정확히 일치한다 (정체성 레이어만 추가)', () => {
    for (const c of CHARACTERS) {
      const archetype = UNIT_DEFS.find((d) => d.id === c.role)!
      const { id, name, role, epithet, lore, lines, skillSet, ...stats } = c
      const { id: aId, name: aName, ...aStats } = archetype
      expect(stats, `${name}(${role})의 스탯`).toEqual(aStats)
      expect(id).not.toBe(aId) // 캐릭터 id는 원형 id와 달라야 한다
      expect(epithet.length).toBeGreaterThan(0)
      expect(lore.length).toBeGreaterThan(0)
      expect(lines.deploy && lines.skill && lines.victory).toBeTruthy()
      expect(skillSet, `${name} 기술 3종`).toBeDefined()
    }
  })

  it('캐릭터 id는 중복 없다', () => {
    expect(new Set(CHARACTERS.map((c) => c.id)).size).toBe(6)
  })
})
