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
    expect(run.wallHp).toBe(1239) // 2026-08-04: 유도 → 궁수 폐지 → 조준 → 증원·재조정 (500 → 1239)
    expect(run.seconds).toBeGreaterThan(60)
  })

  it('적극 플레이는 무개입보다 성벽을 더 지킨다 (개입이 보상된다)', () => {
    // 2026-08-04 복원. 유도 도입 직후엔 무개입이 1550/2000으로 압승이라 영웅이 손댈
    // 여지가 없어 둘이 동률이었다. 웨이브를 조정해 여유를 대역 안(640)으로 되돌리자
    // 개입이 다시 값어치를 갖는다 — 6시드 전부에서 적극 플레이가 무개입을 앞선다.
    const a = playout(SHIPPING_SEED, afk)
    const g = playout(SHIPPING_SEED, greedy)
    expect(g.status).toBe('won')
    expect(g.wallHp).toBeGreaterThan(a.wallHp)
  })
})

describe('판정', () => {
  it('출고 시드가 판정을 통과한다', () => {
    // 2026-08-04: 반려 → **통과**. 이전 단언은 "무작위 조작에서 패배"라는 반려 사유를
    // 고정하고 있었고, 통과로 바뀌면 먼저 깨지도록 설계돼 있었다 — 그 설계대로 깨져서
    // 언제 통과하게 됐는지가 커밋에 남았다.
    // 통과에 이르기까지: 위협 회피 유도 → 궁수 폐지(대포 6) → 대포 고정·조준 지정 →
    // 병기 증원(8·4) + 개체당 벽 피해 하향·수 증가로 절벽 완화.
    const v = verifySeed(SHIPPING_SEED)
    expect(v.seed).toBe(SHIPPING_SEED)
    expect(v.reasons).toEqual([])
    expect(v.pass).toBe(true)
  })
})
