import { describe, expect, it } from 'vitest'
import { generateCharacter } from '../src/char-generate'
import { CHAR_CRITERIA_V0, comboKey, judgeCharacter } from '../src/char-judge'
import { CHARACTERS } from '@core'

describe('캐릭터 생성기', () => {
  it('같은 시드는 같은 캐릭터 (결정론)', () => {
    expect(JSON.stringify(generateCharacter(77))).toBe(JSON.stringify(generateCharacter(77)))
    expect(generateCharacter(77).id).not.toBe(generateCharacter(78).id)
  })

  it('생성 캐릭터는 항상 기술 3슬롯과 정체성을 갖는다', () => {
    for (let seed = 100; seed < 140; seed++) {
      const c = generateCharacter(seed)
      expect(c.skillSet?.passive.slot).toBe('passive')
      expect(c.skillSet?.auto.slot).toBe('auto')
      expect(c.skillSet?.active.slot).toBe('active')
      expect(c.name.length).toBeGreaterThanOrEqual(2)
      expect(c.lore).toContain('출신')
      // 근접에게 사거리 패시브(매의 눈)가 가면 안 된다 (무의미 조합 방지)
      if (c.range === 0) {
        const eff = c.skillSet!.passive.effect
        expect(eff.kind === 'statMod' && eff.rangeAdd !== undefined).toBe(false)
      }
    }
  })

  it('스탯 변주는 ±8% 안에 있다', () => {
    for (let seed = 200; seed < 230; seed++) {
      const c = generateCharacter(seed)
      const arch = CHARACTERS.find((h) => h.role === c.role) // 원형 스탯 비교용
      if (!arch) continue
      expect(c.hp).toBeGreaterThanOrEqual(Math.floor(arch.hp * 0.92))
      expect(c.hp).toBeLessThanOrEqual(Math.ceil(arch.hp * 1.08))
    }
  })
})

describe('캐릭터 판정', () => {
  it('기준 스테이지 셋에 HARD가 포함된다 — OP 판정의 천장 확보', () => {
    expect(CHAR_CRITERIA_V0.stages.length).toBeGreaterThanOrEqual(3)
    expect(CHAR_CRITERIA_V0.stages.some((s) => s.id.startsWith('gen-'))).toBe(true)
  })

  it('중복 기술 조합은 NO_IDENTITY로 반려된다', () => {
    const c = generateCharacter(300)
    const seen = new Set([comboKey(c)])
    const verdict = judgeCharacter(c, [], seen)
    expect(verdict).toMatchObject({ accepted: false, reason: 'NO_IDENTITY' })
  })
})
