// 봇 검증 자체를 검증한다.
// 봇이 "이 판은 성립한다"고 말하려면 (1) 같은 조건이면 같은 결과가 나와야 하고
// (2) 봇이 남긴 커맨드로 그 판을 다시 돌려볼 수 있어야 한다. 둘 중 하나라도 깨지면
// 검증 결과는 주장에 불과하다.

import { describe, expect, it } from 'vitest'
import { afk, greedy, random } from '../bots/policy'
import { playout, replay } from '../bots/runner'
import { SHIPPING_SEED, verifySeed } from '../bots/verify'

const POLICIES = [afk, greedy, random]

describe('봇 러너', () => {
  it('같은 시드·정책이면 결과가 완전히 같다 (결정론)', () => {
    for (const p of POLICIES) {
      const a = playout(SHIPPING_SEED, p)
      const b = playout(SHIPPING_SEED, p)
      expect({ ...a, commands: a.commands.length }).toEqual({ ...b, commands: b.commands.length })
    }
  })

  it('봇이 남긴 커맨드를 재생하면 같은 판이 나온다 (리플레이 포맷 보증)', () => {
    for (const p of POLICIES) {
      const run = playout(SHIPPING_SEED, p)
      const rep = replay(SHIPPING_SEED, run.commands)
      expect(rep.status).toBe(run.status)
      expect(rep.ticks).toBe(run.ticks)
      expect(rep.wallHp).toBe(run.wallHp)
      expect(rep.unitsAlive).toBe(run.unitsAlive)
    }
  })

  // 회귀 방지: sim은 침공 개시 시 state.tick을 0으로 되돌린다(침공 타임라인 기준).
  // 그래서 tick은 판 전체에서 고유하지 않고, 커맨드를 tick으로 키잡으면 준비 단계의
  // 커맨드가 침공 첫 틱 커맨드에 덮여 리플레이가 통째로 어긋난다 (실제로 겪은 버그).
  it('커맨드 키는 스텝 번호이고 tick은 중복될 수 있다', () => {
    const run = playout(SHIPPING_SEED, random)
    const steps = new Set(run.commands.map((c) => c.step))
    expect(steps.size).toBe(run.commands.length)
    // 침공 개시 커맨드는 반드시 첫 스텝에 있다
    expect(run.commands[0]!.step).toBe(0)
    expect(run.commands[0]!.input.startAssault).toBe(true)
  })

  it('출고 시드는 무개입으로도 방어에 성공한다 (기본 배치가 성립한다)', () => {
    const run = playout(SHIPPING_SEED, afk)
    expect(run.status).toBe('won')
    expect(run.wallHp).toBe(500)
    expect(run.seconds).toBeGreaterThan(60)
  })

  it('적극 플레이는 무개입보다 성벽을 더 지킨다 (개입이 보상된다)', () => {
    const a = playout(SHIPPING_SEED, afk)
    const g = playout(SHIPPING_SEED, greedy)
    expect(g.status).toBe('won')
    expect(g.wallHp).toBeGreaterThan(a.wallHp)
  })
})

describe('판정', () => {
  it('출고 시드 판정이 사유와 함께 나온다', () => {
    const v = verifySeed(SHIPPING_SEED)
    expect(v.seed).toBe(SHIPPING_SEED)
    // 현재는 무작위 조작에서 패배해 반려 상태 — 밸런스 조정 전까지 이 단언이 현황을 고정한다.
    // 통과로 바뀌면 이 테스트가 먼저 깨져서 "언제 통과하게 됐는지"가 커밋에 남는다.
    expect(v.reasons.some((r) => r.includes('무작위 조작에서 패배'))).toBe(true)
    expect(v.pass).toBe(false)
  })
})
