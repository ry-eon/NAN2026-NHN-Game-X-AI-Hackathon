import { describe, expect, it } from 'vitest'
import {
  ENEMY_DEFS,
  SKILL_LIBRARY,
  Simulation,
  TICKS_PER_SECOND,
  UNIT_DEFS,
  applyLevel,
} from '../src/index'
import type { CharacterDef, SkillDef, StageDef, UnitDef } from '../src/index'

const skill = (id: string): SkillDef => SKILL_LIBRARY.find((s) => s.id === id)!
const archetype = (id: string): UnitDef => UNIT_DEFS.find((d) => d.id === id)!

/** 역할 원형 + 해금된 기술로 배틀 def 픽스처 생성 */
const withSkills = (roleId: string, skillIds: string[], id = `test-${roleId}`): UnitDef => ({
  ...archetype(roleId),
  id,
  skills: skillIds.map(skill),
})

function lineStage(overrides: Partial<StageDef> = {}): StageDef {
  return {
    id: 'test-line',
    name: '외길',
    tilesRows: ['XXXXXXXX', 'WRRRRRRR', 'XXXXXXXX', 'XXXXXXXX'],
    paths: [[7, 6, 5, 4, 3, 2, 1].map((x) => ({ x, y: 1 }))],
    wallHp: 500,
    initialCost: 99,
    costRegenPerSec: 0,
    costMax: 99,
    spawns: [{ tick: 99999, enemyDefId: 'grunt', pathIndex: 0, wave: 9 }],
    seed: 1,
    ...overrides,
  }
}

const run = (sim: Simulation, seconds: number) => {
  for (let i = 0; i < seconds * TICKS_PER_SECOND; i++) sim.step()
}

describe('레벨 적용 (applyLevel)', () => {
  const fixture: CharacterDef = {
    ...archetype('blocker'),
    id: 'fx',
    name: '픽스처',
    role: 'blocker',
    epithet: '시험의',
    lore: '.',
    lines: { deploy: '.', skill: '.', victory: '.' },
    skillSet: { passive: skill('p-guard'), auto: skill('a-mend'), active: skill('x-repel') },
  }

  it('해금: Lv1 패시브 → Lv3 자동 → Lv5 액티브', () => {
    expect(applyLevel(fixture, 1).skills?.map((s) => s.slot)).toEqual(['passive'])
    expect(applyLevel(fixture, 3).skills?.map((s) => s.slot)).toEqual(['passive', 'auto'])
    expect(applyLevel(fixture, 5).skills?.map((s) => s.slot)).toEqual([
      'passive',
      'auto',
      'active',
    ])
  })

  it('스탯 스케일 + statMod 패시브 굽기 (저지 +1)', () => {
    const lv1 = applyLevel(fixture, 1)
    expect(lv1.blockCount).toBe(archetype('blocker').blockCount + 1) // p-guard 굽힘
    expect(lv1.hp).toBe(archetype('blocker').hp) // Lv1은 스케일 없음

    const lv5 = applyLevel(fixture, 5)
    expect(lv5.hp).toBe(Math.round(archetype('blocker').hp * Math.pow(1.08, 4)))
    expect(lv5.atk).toBe(Math.round(archetype('blocker').atk * Math.pow(1.08, 4)))
  })
})

describe('기술 전투 실행', () => {
  it('꿰뚫기(관통): 갑주귀 방어의 절반을 무시한다', () => {
    const stage = lineStage({
      spawns: [{ tick: 30, enemyDefId: 'tank', pathIndex: 0, wave: 1 }],
    })
    const plain = new Simulation(stage, [withSkills('archer', [], 'a1')], ENEMY_DEFS)
    const pierce = new Simulation(stage, [withSkills('archer', ['p-pierce'], 'a2')], ENEMY_DEFS)
    plain.step([{ type: 'deploy', unitDefId: 'a1', x: 0, y: 1 }])
    pierce.step([{ type: 'deploy', unitDefId: 'a2', x: 0, y: 1 }])
    run(plain, 15)
    run(pierce, 15)
    // 아처 130 vs 갑주귀 방어 60: 일반 70, 관통 round(130-30)=100 — 관통 쪽이 더 깎았다
    expect(pierce.state.enemies[0]!.hp).toBeLessThan(plain.state.enemies[0]!.hp)
  })

  it('방벽(보호막): 피해를 먼저 흡수해 본체 HP를 지킨다', () => {
    const stage = lineStage({
      spawns: [{ tick: 30, enemyDefId: 'grunt', pathIndex: 0, wave: 1 }],
    })
    const sim = new Simulation(stage, [withSkills('blocker', ['a-bulwark'], 'b1')], ENEMY_DEFS)
    sim.step([{ type: 'deploy', unitDefId: 'b1', x: 2, y: 1 }])
    run(sim, 11) // 야귀가 저지되어 몇 대 때림 (12s 주기 보호막 갱신 직전에 관찰)
    const unit = sim.state.units[0]!
    expect(unit.hp).toBe(archetype('blocker').hp) // 본체 무손상
    expect(unit.shield).toBeLessThan(150) // 보호막이 대신 깎임
  })

  it('전의 폭발(액티브): 공격 간격이 절반이 되고, 쿨다운 중 재사용은 반려된다', () => {
    const stage = lineStage({
      spawns: [{ tick: 30, enemyDefId: 'tank', pathIndex: 0, wave: 1 }],
    })
    const sim = new Simulation(stage, [withSkills('archer', ['x-frenzy'], 'a1')], ENEMY_DEFS)
    sim.step([{ type: 'deploy', unitDefId: 'a1', x: 0, y: 1 }])
    const unitId = sim.state.units[0]!.id
    run(sim, 10) // 교전 시작 대기

    sim.step([{ type: 'useSkill', unitId }])
    expect(sim.state.events.some((e) => e.type === 'skillUsed')).toBe(true)

    sim.step([{ type: 'useSkill', unitId }]) // 즉시 재사용 → 쿨다운 반려
    expect(
      sim.state.events.some((e) => e.type === 'skillRejected' && e.reason === 'onCooldown'),
    ).toBe(true)

    // 버프 지속 중 공격 간격 = base/2
    run(sim, 2)
    const unit = sim.state.units[0]!
    expect(unit.cooldown).toBeLessThanOrEqual(Math.round(archetype('archer').atkIntervalTicks / 2))
  })

  it('밀쳐내기(액티브): 저지 중인 적을 밀어내고 저지를 푼다', () => {
    const stage = lineStage({
      spawns: [{ tick: 30, enemyDefId: 'grunt', pathIndex: 0, wave: 1 }],
    })
    const sim = new Simulation(stage, [withSkills('blocker', ['x-repel'], 'b1')], ENEMY_DEFS)
    sim.step([{ type: 'deploy', unitDefId: 'b1', x: 2, y: 1 }])
    // 야귀가 (2,1)에 저지될 때까지
    while (
      sim.state.status === 'playing' &&
      sim.state.enemies[0]?.blockedBy == null &&
      sim.state.tick < 3000
    )
      sim.step()
    const before = sim.state.enemies[0]!.pathPos

    sim.step([{ type: 'useSkill', unitId: sim.state.units[0]!.id }])
    const enemy = sim.state.enemies[0]!
    expect(enemy.blockedBy).toBeNull()
    expect(enemy.pathPos).toBeLessThanOrEqual(before - 1.9) // 2타일 후퇴
    expect(sim.state.units[0]!.blockedEnemyIds).toHaveLength(0)
  })

  it('전리품(처치 코스트): 적 처치 시 코스트를 얻는다', () => {
    const stage = lineStage({
      spawns: [{ tick: 30, enemyDefId: 'runner', pathIndex: 0, wave: 1 }],
      initialCost: 20,
    })
    const sim = new Simulation(stage, [withSkills('bruiser', ['p-scavenge'], 'b1')], ENEMY_DEFS)
    sim.step([{ type: 'deploy', unitDefId: 'b1', x: 2, y: 1 }])
    const costAfterDeploy = sim.state.cost
    run(sim, 20) // 질주귀 저지·처치 (재생 0이라 코스트 변화는 처치 보상뿐)
    expect(sim.state.enemies).toHaveLength(0)
    expect(sim.state.cost).toBeCloseTo(costAfterDeploy + 1, 5)
  })
})
