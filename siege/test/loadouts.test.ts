// 로드아웃 주입 — 콘텐츠(유닛 정의·배치·웨이브)를 sim 로직에서 떼어낸 것이 실제로 먹는지.
//
// 두 가지를 지킨다:
//   1) 기본 로드아웃은 리팩터링 전과 완전히 같은 판을 만든다 (출고 판이 흔들리지 않게)
//   2) 다른 편성을 주입하면 실제로 다른 판이 된다 (주입이 시늉이 아니게)

import { describe, expect, it } from 'vitest'
import { DEFAULT_LOADOUT, createSiege } from '../sim/world'
import { LOADOUTS, describeLoadout, findLoadout } from '../sim/loadouts'
import { afk } from '../bots/policy'
import { playout } from '../bots/runner'
import { SHIPPING_SEED } from '../bots/verify'

describe('로드아웃', () => {
  it('기본 로드아웃은 출고 중인 판 그대로다', () => {
    const run = playout(SHIPPING_SEED, afk, DEFAULT_LOADOUT)
    expect(run.status).toBe('won')
    expect(run.wallHp).toBe(500)
    expect(run.seconds).toBe(89.8)
    expect(describeLoadout(DEFAULT_LOADOUT)).toBe('궁수 6 · 대포 2 · 발리스타 2 · 영웅 1')
  })

  it('편성을 주입하면 배치와 결과가 실제로 바뀐다', () => {
    const heavy = findLoadout('cannon-heavy')!
    const { state } = createSiege(SHIPPING_SEED, heavy)
    expect(state.loadout).toBe('cannon-heavy')
    expect(state.units.filter((u) => u.kind === 'cannon')).toHaveLength(4)

    const base = playout(SHIPPING_SEED, afk, DEFAULT_LOADOUT)
    const run = playout(SHIPPING_SEED, afk, heavy)
    expect(run.wallHp).not.toBe(base.wallHp) // 편성이 판정에 영향을 준다
  })

  it('성벽 HP도 편성 데이터라 state가 최대치를 들고 있다', () => {
    const thick = findLoadout('thick-wall')!
    const { state } = createSiege(SHIPPING_SEED, thick)
    expect(state.wallHp).toBe(3000)
    expect(state.wallHpMax).toBe(3000)
  })

  it('모든 프리셋이 영웅 1기를 포함하고 이름이 고유하다', () => {
    const names = LOADOUTS.map((l) => l.name)
    expect(new Set(names).size).toBe(names.length)
    for (const l of LOADOUTS) {
      expect(l.placements.filter((p) => p.kind === 'hero')).toHaveLength(1)
      // 배치된 병종은 전부 정의가 있어야 한다 (오타 방지 — 없으면 런타임에 터진다)
      for (const p of l.placements) expect(l.unitKinds[p.kind], `${l.name}: ${p.kind}`).toBeDefined()
    }
  })

  it('웨이브도 데이터 — 정의대로 스폰 표가 만들어진다', () => {
    const { spawns } = createSiege(SHIPPING_SEED, DEFAULT_LOADOUT)
    const total = DEFAULT_LOADOUT.waves.reduce((n, w) => n + w.count, 0)
    expect(spawns).toHaveLength(total)
    expect(spawns.filter((s) => s.kind === 'tank')).toHaveLength(2)
    // 시간순 정렬이 보장돼야 스폰 커서가 성립한다
    for (let i = 1; i < spawns.length; i++) expect(spawns[i]!.tick).toBeGreaterThanOrEqual(spawns[i - 1]!.tick)
  })
})
