// 봇 검증 자체를 검증한다.
// 봇이 "이 판은 성립한다"고 말하려면 (1) 같은 조건이면 같은 결과가 나와야 하고
// (2) 봇이 남긴 커맨드로 그 판을 다시 돌려볼 수 있어야 한다. 둘 중 하나라도 깨지면
// 검증 결과는 주장에 불과하다.

import { describe, expect, it } from 'vitest'
import { afk, deploy, greedy, random } from '../bots/policy'
import { playout, replay } from '../bots/runner'
import { SHIPPING_SEED, verifySeed } from '../bots/verify'

const POLICIES = [afk, deploy, greedy, random]

describe('봇 러너', () => {
  it('같은 시드·정책이면 결과가 완전히 같다 (결정론)', () => {
    for (const p of POLICIES) {
      const a = playout(SHIPPING_SEED, p)
      const b = playout(SHIPPING_SEED, p)
      expect({ ...a, commands: a.commands.length }).toEqual({ ...b, commands: b.commands.length })
    }
    // 6판 완주라 기본 5초를 넘긴다 (greedy 스킬 기준 상향으로 밀집 계산 빈도가 늘어 더 느려짐)
  }, 30000)

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
    // 장착제 이후: 준비 단계의 장착 이동 커맨드들이 앞서고, 침공 개시는 장착이 끝난 뒤다.
    // 준비 커맨드와 침공 커맨드가 tick 리셋을 사이에 두고 공존한다 — 스텝 키가 필요한 바로 그 상황.
    expect(run.commands[0]!.input.unitMove).toBeDefined()
    const assault = run.commands.find((c) => c.input.startAssault)
    expect(assault).toBeDefined()
    expect(assault!.step).toBeGreaterThan(0)
  })

  it('출고 시드에서 무개입은 패배한다 — 장착(배치)이 게임에 의미가 있다', () => {
    // 장착제 개정 (2026-08-08, 사용자: "아무것도 안 하면 지는 게 맞다"). 병기는 빈 채로
    // 시작하므로 정말 아무것도 안 하면 전 병기 침묵 = 패배가 **정상**이다.
    // 구 단언(무개입 승리 614)은 수비병이 처음부터 장착된 시절의 것.
    const run = playout(SHIPPING_SEED, afk)
    expect(run.status).toBe('lost')
  })

  it('출고 시드는 표준 장착만으로 방어에 성공한다 (배치가 성립한다)', () => {
    const run = playout(SHIPPING_SEED, deploy)
    expect(run.status).toBe('won')
    // 614 = 구 상주 조작제의 무개입 수치 그대로 — 걸어가 장착한 판과 처음부터 서 있던 판이
    // 같은 결과라는 등가 증명. 장착제가 밸런스를 건드리지 않고 "시작 절차"만 바꿨다는 뜻.
    expect(run.wallHp).toBe(614)
    expect(run.seconds).toBeGreaterThan(60)
  })

  it('적극 플레이는 표준 장착보다 성벽을 더 지킨다 (개입이 보상된다)', () => {
    // 2026-08-04 복원, 2026-08-08 기준선을 afk → deploy로 이관 (장착제).
    // 유도 도입 직후엔 무개입이 1550/2000으로 압승이라 영웅이 손댈
    // 여지가 없어 둘이 동률이었다. 웨이브를 조정해 여유를 대역 안으로 되돌리자
    // 개입이 다시 값어치를 갖는다 — 6시드 전부에서 적극 플레이가 기준선을 앞선다.
    const d = playout(SHIPPING_SEED, deploy)
    const g = playout(SHIPPING_SEED, greedy)
    expect(g.status).toBe('won')
    expect(g.wallHp).toBeGreaterThan(d.wallHp)
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
