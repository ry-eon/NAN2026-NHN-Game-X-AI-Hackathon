// M2b 전투 sim 검증 — 렌더 없이 판이 성립함을 단언한다 ("생성이 아니라 보증").
// 결정론 · 무방비 패배 · 기본 배치 승리(시드 검증) · 부대 이동 · 지상 접전.

import { describe, expect, it } from 'vitest'
import {
  CASTLE,
  ENEMY_KINDS,
  findPath,
  HERO_SKILL,
  stepHeight,
  WALL_HP,
  createSiege,
  stepSiege,
  UNIT_KINDS,
  SEGMENTS,
  DEFAULT_LOADOUT,
  type ActiveEnemy,
  type Loadout,
  type SiegeInput,
  type SiegeState,
} from '../sim/world'

const SEED = 20260725
const MAX_TICKS = 30 * 300 // 5분 상한 — 이 안에 승패가 나야 한다

/** 테스트용 괴수 직접 배치 — 스폰 경로를 거치지 않으므로 접근 구간을 손으로 채운다 */
function placeEnemy(state: SiegeState, kind: string, x: number, z: number, hp: number): ActiveEnemy {
  const r = ENEMY_KINDS[kind]!.radius
  const e: ActiveEnemy = {
    id: state.nextId++,
    kind,
    pos: { x, z },
    hp,
    cooldown: 0,
    atWall: false,
    wave: 0,
    seg: 0,
    aim: { x: CASTLE.east + CASTLE.wallT / 2 + r + 0.2, z },
    via: null,
    raiseCd: 0,
    mode: 'wall',
  }
  state.enemies.push(e)
  return e
}

/** 스크립트 입력으로 판 전체 실행. 종료 틱·최종 상태 반환 */
function runSiege(
  seed: number,
  inputAt: (tick: number, state: SiegeState) => SiegeInput,
  mutate?: (state: SiegeState) => void,
): SiegeState {
  const { state, spawns } = createSiege(seed)
  mutate?.(state)
  for (let i = 0; i < MAX_TICKS; i++) {
    stepSiege(state, spawns, inputAt(i, state))
    if (state.status === 'won' || state.status === 'lost') break
  }
  return state
}

describe('M2b 전투', () => {
  it('결정론: 같은 (시드, 입력 시퀀스)는 같은 결과', () => {
    const script = (tick: number, state: SiegeState): SiegeInput => {
      if (tick === 0) return { startAssault: true }
      if (tick === 60)
        return { unitMove: { ids: state.units.slice(0, 3).map((u) => u.id), to: { x: -6, z: -8, h: 11 } } }
      if (tick === 300) return { moveTo: { x: -6, z: 8, h: 11 } }
      if (tick === 600) {
        const hero = state.units.find((u) => u.kind === 'hero')
        return hero ? { unitMove: { ids: [hero.id], to: { x: 2, z: 0 } } } : {}
      }
      return {}
    }
    const a = runSiege(SEED, script)
    const b = runSiege(SEED, script)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('무방비(유닛 0)면 성벽이 뚫려 패배한다', () => {
    const end = runSiege(
      SEED,
      (tick) => (tick === 0 ? { startAssault: true } : {}),
      (state) => {
        state.units = []
      },
    )
    expect(end.status).toBe('lost')
    expect(end.wallHp).toBe(0)
  })

  it('기본 배치는 시드 판을 막아낸다 — 봇 검증의 원형', () => {
    const end = runSiege(SEED, (tick) => (tick === 0 ? { startAssault: true } : {}))
    expect(end.status).toBe('won')
    expect(end.wallHp).toBeGreaterThan(0)
    expect(end.enemies).toHaveLength(0)
  })

  it('고정 병기는 옮길 수 없고 조준만 받는다', () => {
    // 「대포 고정 + 조준」 [확정 2026-08-04]. 이동 명령 한 번이 곧 영구 침묵이던 문제를
    // 룰 차원에서 없앤다 — 플레이어의 손잡이가 "어디로 옮기나"에서 "어디를 겨누나"로 바뀐다.
    const { state, spawns } = createSiege(SEED)
    const gun = state.units.find((u) => u.kind === 'cannon')!
    const at = { ...gun.pos }
    stepSiege(state, spawns, { unitMove: { ids: [gun.id], to: { x: -14, z: -8 } } })
    for (let i = 0; i < 60; i++) stepSiege(state, spawns, {})
    expect(gun.pos).toEqual(at) // 꿈쩍도 안 한다
    expect(gun.h).toBe(11)
    expect(gun.path).toHaveLength(0)
    // 조준은 즉시 먹는다 (이동 시간이 없다 = 화망을 빠르게 다시 그릴 수 있다)
    stepSiege(state, spawns, { unitAim: { ids: [gun.id], to: { x: 6, z: -15 } } })
    expect(gun.aim).toEqual({ x: 6, z: -15 })
  })

  it('부대 명령: 성벽 위 유닛이 계단을 거쳐 지상 목표로 이동한다', () => {
    // 이동 가능한 병종(궁수)으로 계단 경유 하강을 확인한다. 출고 편성은 전부 고정 병기라
    // 이 기능을 쓰지 않지만, 규칙 자체는 살아 있어야 프리셋을 바꿔도 판이 성립한다.
    const withArcher: Loadout = {
      ...DEFAULT_LOADOUT,
      name: 'test-archer',
      // 보도 **안쪽 차선**(x = east-3)에 세운다. 고정 병기는 밀리지 않으므로 병기가 늘어선
      // 중앙선(x = east)에 이동 유닛을 끼워 넣으면 양옆 포좌 사이에 갇혀 못 빠져나온다
      // (실측: 1200틱 동안 26노드 중 2노드만 전진). 보도 폭이 8인 건 이러라고 있는 것이다.
      // 나중에 「침입 시 백병전 전환」을 넣을 때 병사 기본 자리를 안쪽 차선으로 잡아야 한다.
      placements: [
        { kind: 'soldier', x: CASTLE.east - 3, z: -10.5, h: CASTLE.wallH },
        ...DEFAULT_LOADOUT.placements,
      ],
    }
    const { state, spawns } = createSiege(SEED, withArcher)
    const unit = state.units.find((u) => u.kind === 'soldier')!
    expect(unit.h).toBe(11)
    stepSiege(state, spawns, { unitMove: { ids: [unit.id], to: { x: -14, z: -8 } } })
    for (let i = 0; i < 1200 && unit.path.length > 0; i++) stepSiege(state, spawns, {})
    expect(unit.h).toBe(0)
    expect(Math.hypot(unit.pos.x - -14, unit.pos.z - -8)).toBeLessThan(2.5)
  })

  it('지상 아군은 괴수와 접전한다 — 성벽 대신 유닛을 때린다', () => {
    const { state, spawns } = createSiege(SEED)
    stepSiege(state, spawns, { startAssault: true })
    const hero = state.units.find((u) => u.kind === 'hero')!
    // 영웅 바로 옆에 야귀 배치 (첫 정규 스폰은 4초 뒤라 간섭 없음)
    placeEnemy(state, 'grunt', hero.pos.x + 1.0, hero.pos.z, 480)
    for (let i = 0; i < 60; i++) stepSiege(state, spawns, {})
    expect(hero.hp).toBeLessThan(UNIT_KINDS.hero!.hp)
    expect(state.wallHp).toBe(WALL_HP)
  })

  it('영역 정합: 흉벽 띠는 설 수 없고, 터널은 통행, 괴수는 벽 바깥 면에서 멈춘다', () => {
    const outerFace = CASTLE.east + CASTLE.wallT / 2 // -2
    // 보도에서 흉벽 띠(동벽 바깥 1.3)로는 못 들어간다 — 성가퀴 돌 속에 서던 문제
    expect(stepHeight(CASTLE.wallH, outerFace - 0.5, 10)).toBeNull()
    // 북벽 바깥 띠·모서리 캡도 마찬가지
    expect(stepHeight(CASTLE.wallH, -6, CASTLE.north - CASTLE.wallT / 2 + 0.5)).toBeNull()
    expect(stepHeight(CASTLE.wallH, outerFace - 0.5, CASTLE.north - CASTLE.wallT / 2 + 0.5)).toBeNull()
    // 성문 터널은 벽 두께 전체가 지상 통행
    expect(stepHeight(0, outerFace - 0.5, 0)).toBe(0)
    // 흉벽 위(설 수 없는 지점) 클릭 → 가장 가까운 보도 지점으로 근접 이동 (명령 무시 대신)
    const path = findPath({ x: -6, z: 10 }, { x: outerFace - 0.4, z: 10 }, CASTLE.wallH, CASTLE.wallH)
    expect(path).not.toBeNull()
    // 괴수 정지선 = 벽 바깥 면 + 반경 (벽 속으로 파고들던 문제)
    const { state, spawns } = createSiege(SEED)
    state.units = []
    stepSiege(state, spawns, { startAssault: true })
    for (let i = 0; i < 30 * 40; i++) stepSiege(state, spawns, {})
    // 회절 레인으로 북/남벽에 붙은 개체는 동벽 기준으로 재면 안 된다 (자기가 치는 면으로 판정)
    const atWall = state.enemies.filter((e) => e.atWall && SEGMENTS[e.seg]!.face === 'east')
    expect(atWall.length).toBeGreaterThan(0)
    for (const e of atWall) {
      expect(e.pos.x).toBeGreaterThanOrEqual(outerFace + ENEMY_KINDS[e.kind]!.radius)
    }
  })

  it('위협 회피 유도: 화망을 한쪽에 몰면 괴수가 반대쪽으로 흐른다', () => {
    // 이 판의 핵심 규칙. 플레이어가 성벽 위 화력을 북쪽에 몰면 남쪽이 "무방비"로 보여
    // 괴수가 그리로 흐르고, 비워둔 그 구간이 킬존이 된다 (docs/02-game-design.md §2).
    const manyGrunts: Loadout = {
      ...DEFAULT_LOADOUT,
      name: 'test-many',
      // 표본이 작으면(60기) 구간별 편차가 노이즈에 묻힌다 — 비율을 재려면 수를 키운다
      waves: [{ wave: 1, kind: 'grunt', count: 400, at: 1, every: 0.02 }],
    }
    // 스폰 시점의 배정을 센다 — 생존자만 세면 "위협이 낮은 쪽이 더 오래 산다"는
    // 생존 편향이 끼어서 유도 자체의 세기를 측정할 수 없다.
    const countSouth = (clusterZ: number): { south: number; far: number; near: number } => {
      const { state, spawns } = createSiege(SEED, manyGrunts)
      // 성벽 위 병기를 전부 한쪽으로 **겨눈다** — 대포는 고정이라 화망은 조준으로만 그린다
      const ids = state.units.filter((u) => u.h >= 1).map((u) => u.id)
      stepSiege(state, spawns, { unitAim: { ids, to: { x: 4, z: clusterZ } } })
      stepSiege(state, spawns, { startAssault: true })
      const seen = new Map<number, number>()
      for (let i = 0; i < 30 * 12; i++) {
        stepSiege(state, spawns, {})
        for (const e of state.enemies) if (!seen.has(e.id)) seen.set(e.id, e.seg)
      }
      const east = [...seen.values()].filter((s) => SEGMENTS[s]!.face === 'east')
      expect(east.length).toBeGreaterThan(300) // 표본이 충분해야 비율이 의미가 있다
      const at = (z: number): number => east.filter((s) => SEGMENTS[s]!.probe.z === z).length
      return { south: east.filter((s) => SEGMENTS[s]!.probe.z > 0).length / east.length, far: at(15), near: at(-15) }
    }
    const northHeavy = countSouth(-14) // 화망을 북쪽에 몰았다 → 남쪽으로 흘러야 한다
    const southHeavy = countSouth(14)
    // 반쪽 비율보다 양 끝 구간의 대비가 이 규칙의 실제 세기다
    expect(northHeavy.far).toBeGreaterThan(northHeavy.near * 3)
    expect(southHeavy.near).toBeGreaterThan(southHeavy.far * 3)
    expect(northHeavy.south).toBeGreaterThan(0.6)
    expect(southHeavy.south).toBeLessThan(0.4)
  })

  it('지연 규칙: 목표 구간은 스폰 시 정해지고 이후 재배치에 반응하지 않는다', () => {
    // "늦게 옮긴 대포는 지금 오는 무리에 안 통하고 다음 웨이브부터 통한다"
    const { state, spawns } = createSiege(SEED)
    stepSiege(state, spawns, { startAssault: true })
    for (let i = 0; i < 30 * 6; i++) stepSiege(state, spawns, {})
    const before = state.enemies.map((e) => [e.id, e.seg] as const)
    expect(before.length).toBeGreaterThan(0)
    // 화망을 한쪽 끝으로 다시 그려도 이미 달려든 무리는 목표를 안 바꾼다
    const wallIds = state.units.filter((u) => u.h >= 1).map((u) => u.id)
    stepSiege(state, spawns, { unitAim: { ids: wallIds, to: { x: 4, z: -16 } } })
    for (let i = 0; i < 30 * 5; i++) stepSiege(state, spawns, {})
    for (const [id, seg] of before) {
      const e = state.enemies.find((x) => x.id === id)
      if (e) expect(e.seg).toBe(seg)
    }
  })

  it('모서리 회절: 북/남벽을 치는 괴수는 성벽 모서리를 돌아 벽 바깥 면에서 멈춘다', () => {
    // 회절 레인만 뽑히도록 flankBias를 극단으로 준 로드아웃
    const flankOnly: Loadout = {
      ...DEFAULT_LOADOUT,
      name: 'test-flank',
      enemyKinds: {
        ...DEFAULT_LOADOUT.enemyKinds,
        grunt: { ...DEFAULT_LOADOUT.enemyKinds.grunt!, flankBias: 999, threatAvoidance: 0 },
      },
      waves: [{ wave: 1, kind: 'grunt', count: 12, at: 1, every: 0.2 }],
    }
    const { state, spawns } = createSiege(SEED, flankOnly)
    state.units = [] // 방해 없이 벽까지 도달시킨다
    stepSiege(state, spawns, { startAssault: true })
    for (let i = 0; i < 30 * 60 && state.status === 'assault'; i++) stepSiege(state, spawns, {})
    const flank = state.enemies.filter((e) => SEGMENTS[e.seg]!.face !== 'east')
    expect(flank.length).toBeGreaterThan(0)
    const r = DEFAULT_LOADOUT.enemyKinds.grunt!.radius
    for (const e of flank) {
      // 벽 속으로 파고들지 않았다 — 북벽 바깥 면(z=-22) 바깥에 서 있다
      const face = SEGMENTS[e.seg]!.face
      if (face === 'north') expect(e.pos.z).toBeLessThanOrEqual(CASTLE.north - CASTLE.wallT / 2 - r)
      else expect(e.pos.z).toBeGreaterThanOrEqual(CASTLE.south + CASTLE.wallT / 2 + r)
    }
  })

  describe('조작 병사 하차 (백병전 전환)', () => {
    it('병기를 버리고 지상 병사를 얻는다 — 그 병기는 다시 쏘지 못한다', () => {
      const { state, spawns } = createSiege(SEED)
      stepSiege(state, spawns, { startAssault: true })
      const gun = state.units.find((u) => u.kind === 'cannon')!
      const before = state.units.length
      stepSiege(state, spawns, { dismount: { ids: [gun.id] } })
      expect(gun.crewGone).toBe(true)
      expect(state.units).toHaveLength(before + 1)
      const guard = state.units.find((u) => u.kind === 'guard')!
      expect(guard.h).toBe(0) // 지상이다 — 그래서 괴수의 위협 계산에 안 잡힌다
      expect(state.events.some((e) => e.type === 'crewDismounted')).toBe(true)

      // 침묵 확인 — 사거리 안에 표적을 세워도 이 병기는 쏘지 않는다
      state.units = [gun]
      placeEnemy(state, 'grunt', gun.pos.x + 10, gun.pos.z, 660).atWall = true
      gun.cooldown = 0
      for (let i = 0; i < 30 * 10; i++) stepSiege(state, spawns, {})
      expect(state.events.some((e) => e.type === 'unitFired')).toBe(false)
      expect(state.shots).toHaveLength(0)
    })

    it('편도다 — 같은 병기를 두 번 내려보낼 수 없다', () => {
      const { state, spawns } = createSiege(SEED)
      stepSiege(state, spawns, { startAssault: true })
      const gun = state.units.find((u) => u.kind === 'ballista')!
      stepSiege(state, spawns, { dismount: { ids: [gun.id] } })
      const after = state.units.length
      stepSiege(state, spawns, { dismount: { ids: [gun.id] } })
      expect(state.units).toHaveLength(after) // 두 번째는 무시된다
    })

    it('영웅처럼 이동 가능한 병종이다 — 고정 병기가 아니다', () => {
      const { state, spawns } = createSiege(SEED)
      stepSiege(state, spawns, { startAssault: true })
      const gun = state.units.find((u) => u.kind === 'cannon')!
      stepSiege(state, spawns, { dismount: { ids: [gun.id] } })
      const guard = state.units.find((u) => u.kind === 'guard')!
      const from = { ...guard.pos }
      stepSiege(state, spawns, { unitMove: { ids: [guard.id], to: { x: CASTLE.east - 12, z: 0 } } })
      for (let i = 0; i < 30 * 20 && guard.path.length > 0; i++) stepSiege(state, spawns, {})
      expect(Math.hypot(guard.pos.x - from.x, guard.pos.z - from.z)).toBeGreaterThan(3)
    })
  })

  describe('투사체 비행', () => {
    it('포탄은 날아가는 동안 피해가 없고, 도착해서야 터진다', () => {
      const { state, spawns } = createSiege(SEED)
      stepSiege(state, spawns, { startAssault: true })
      const gun = state.units.find((u) => u.kind === 'cannon')!
      state.units = [gun]
      // 정지한 표적 — 예측이 개입하지 않게
      const tgt = placeEnemy(state, 'grunt', gun.pos.x + 14, gun.pos.z, 660)
      tgt.atWall = true
      gun.cooldown = 0
      stepSiege(state, spawns, {})
      const fired = state.events.find((e) => e.type === 'unitFired')
      expect(fired && fired.type === 'unitFired' && fired.flight).toBeGreaterThan(1)
      expect(tgt.hp).toBe(660) // 아직 안 맞았다
      expect(state.shots).toHaveLength(1)
      const flight = state.shots[0]!.flight
      for (let i = 0; i < flight - 1; i++) stepSiege(state, spawns, {})
      expect(tgt.hp).toBe(660) // 비행 중에는 여전히 무사하다
      stepSiege(state, spawns, {})
      expect(tgt.hp).toBeLessThan(660) // 착탄
      expect(state.shots).toHaveLength(0)
      expect(state.events.some((e) => e.type === 'shotLanded')).toBe(true)
    })

    it('발사 시점의 지점에 터진다 — 비켜선 개체는 흘린다', () => {
      const { state, spawns } = createSiege(SEED)
      stepSiege(state, spawns, { startAssault: true })
      const gun = state.units.find((u) => u.kind === 'ballista')!
      state.units = [gun]
      const tgt = placeEnemy(state, 'grunt', gun.pos.x + 12, gun.pos.z, 660)
      tgt.atWall = true
      gun.cooldown = 0
      stepSiege(state, spawns, {})
      expect(state.shots).toHaveLength(1)
      // 날아가는 동안 표적을 착탄점 밖으로 순간이동시킨다
      const flight = state.shots[0]!.flight // 착탄하면 배열이 비므로 먼저 잡아둔다
      tgt.pos.x += 9
      for (let i = 0; i < flight + 1; i++) stepSiege(state, spawns, {})
      expect(tgt.hp).toBe(660) // 헛맞았다
    })
  })

  describe('성문 돌파', () => {
    /** 성벽 위 병기를 전부 한쪽 끝으로 겨눠 성문 화망을 비운다 */
    const run = (emptyGate: boolean) => {
      const { state, spawns } = createSiege(SEED)
      stepSiege(state, spawns, { startAssault: true })
      if (emptyGate) {
        const ids = state.units.filter((u) => u.h >= 1).map((u) => u.id)
        stepSiege(state, spawns, { unitAim: { ids, to: { x: 6, z: -16 } } })
      }
      const breached = new Set<number>()
      for (let i = 0; i < 30 * 200 && state.status === 'assault'; i++) {
        stepSiege(state, spawns, {})
        for (const e of state.enemies) if (e.mode === 'breach') breached.add(e.id)
      }
      return breached.size
    }

    it('성문을 지키면 아무도 안 들어오고, 비우면 들어온다', () => {
      // 이 규칙의 전부: 화망을 몰 때 성문 몫을 남겨야 하는 이유가 여기서 생긴다
      expect(run(false)).toBe(0)
      expect(run(true)).toBeGreaterThan(5)
    })

    it('성문 터널은 성벽 위에서 쏠 수 없다 — 안뜰 방어는 지상 전력의 몫', () => {
      // 터널은 보도 **아래**를 지난다. 이 사각이 없으면 돌파가 성립하지 않는다
      // (실측: 사각이 없을 때 돌파병은 터널 안에서 전멸했다)
      const { state, spawns } = createSiege(SEED)
      stepSiege(state, spawns, { startAssault: true })
      const gunner = state.units.find((u) => u.h >= 1)!
      const inTunnel = placeEnemy(state, 'runner', CASTLE.east, 0, 300) // 터널 한가운데
      const outside = placeEnemy(state, 'runner', CASTLE.east + CASTLE.wallT / 2 + 1, 0, 300)
      // 둘 다 제자리에 묶는다 — 목표를 향해 걸어나가면 무엇 때문에 맞았는지 알 수 없다
      for (const e of [inTunnel, outside]) {
        e.aim = { ...e.pos }
        e.atWall = true
      }
      state.units = [gunner] // 지상 유닛(영웅)을 빼고 성벽 위 병기 하나만 남긴다
      gunner.cooldown = 0
      for (let i = 0; i < 30 * 8; i++) stepSiege(state, spawns, {})
      expect(inTunnel.hp).toBe(300) // 터널 안은 못 맞힌다
      expect(outside.hp).toBeLessThan(300) // 바깥은 맞는다
    })

    it('돌파한 개체는 성벽을 때리지 않는다 — 지상 병력을 문다', () => {
      const { state, spawns } = createSiege(SEED)
      stepSiege(state, spawns, { startAssault: true })
      state.units = []
      const e = placeEnemy(state, 'runner', CASTLE.east - CASTLE.wallT / 2 - 3, 0, 300)
      e.mode = 'breach'
      e.via = null
      const before = state.wallHp
      for (let i = 0; i < 30 * 20; i++) stepSiege(state, spawns, {})
      expect(state.wallHp).toBe(before) // 안뜰에 있어도 성벽 HP는 안 깎인다
    })
  })

  describe('보스 네크로맨서', () => {
    /** 술사 1기 + 시체 n구만 있는 최소 판 — 부활만 떼어내서 본다 */
    const raiseBed = (corpses: number) => {
      const { state, spawns } = createSiege(SEED, { ...DEFAULT_LOADOUT, name: 'test-raise', waves: [] })
      state.units = [] // 사격 간섭 제거
      stepSiege(state, spawns, { startAssault: true })
      const boss = placeEnemy(state, 'necromancer', 8, 0, 2000)
      for (let i = 0; i < corpses; i++) {
        state.corpses.push({ kind: 'grunt', pos: { x: 8 + i * 0.5, z: 1 }, rotAt: state.tick + 30 * 60 })
      }
      return { state, spawns, boss }
    }

    it('쿨마다 반경 안의 시체를 되살리고, 그 시체는 소모된다', () => {
      const { state, spawns } = raiseBed(5)
      stepSiege(state, spawns, {})
      const raised = state.events.filter((e) => e.type === 'enemyRaised')
      expect(raised).toHaveLength(2) // count: 2
      expect(state.corpses).toHaveLength(3) // 되살아난 둘은 소모됐다
      const def = DEFAULT_LOADOUT.enemyKinds.grunt!
      const back = state.enemies.filter((e) => e.kind === 'grunt')
      expect(back).toHaveLength(2)
      for (const e of back) expect(e.hp).toBe(Math.round(def.hp * 0.4)) // hpRatio
      // 쿨 안에는 더 안 일어난다
      for (let i = 0; i < 30 * 5; i++) stepSiege(state, spawns, {})
      expect(state.corpses).toHaveLength(3)
    })

    it('술사를 끊으면 부활이 멈춘다 — 이것이 이 판의 판단 지점이다', () => {
      const { state, spawns, boss } = raiseBed(6)
      stepSiege(state, spawns, {})
      expect(state.corpses).toHaveLength(4)
      boss.hp = 0 // 술사만 제거
      stepSiege(state, spawns, {})
      expect(state.enemies.some((e) => e.kind === 'necromancer')).toBe(false)
      for (let i = 0; i < 30 * 30; i++) stepSiege(state, spawns, {})
      expect(state.corpses).toHaveLength(4) // 더는 아무도 일어나지 않는다
    })

    it('술사는 시체를 남기지 않는다 — 스스로를 되살릴 수 없다', () => {
      const { state, spawns, boss } = raiseBed(0)
      boss.hp = 0
      stepSiege(state, spawns, {})
      expect(state.corpses).toHaveLength(0)
    })

    it('시체는 삭는다 — 무한히 쌓아두고 후반에 몰아서 되살릴 수 없다', () => {
      const { state, spawns, boss } = raiseBed(0)
      boss.raiseCd = 30 * 60 // 술사를 쿨에 묶어두고 삭는 것만 본다
      state.corpses.push({ kind: 'grunt', pos: { x: 8, z: 1 }, rotAt: state.tick + 10 })
      for (let i = 0; i < 40; i++) stepSiege(state, spawns, {})
      expect(state.corpses).toHaveLength(0)
      expect(state.enemies.some((e) => e.kind === 'grunt')).toBe(false)
    })
  })

  it('영웅 스킬: 반경 내 광역 피해 + 쿨다운·사거리 검증', () => {
    const { state, spawns } = createSiege(SEED)
    stepSiege(state, spawns, { startAssault: true })
    const hero = state.units.find((u) => u.kind === 'hero')!
    state.units = [hero] // 다른 유닛 사격이 수치 단언에 끼지 않게
    // 시전점 (2,0) — 영웅(-12,0)에서 d=14 ≤ 사거리 18. 반경 4.5 안 2마리 + 밖 1마리
    placeEnemy(state, 'grunt', 2, 0, 700)
    placeEnemy(state, 'grunt', 3, 1.5, 700)
    placeEnemy(state, 'grunt', 2, 8, 700)
    stepSiege(state, spawns, { heroSkill: { x: 2, z: 0 } })
    expect(state.enemies.filter((e) => e.hp === 700 - HERO_SKILL.dmg)).toHaveLength(2)
    expect(state.enemies.filter((e) => e.hp === 700).length).toBeGreaterThanOrEqual(1)
    expect(hero.skillCd).toBeGreaterThan(0)
    // 쿨다운 중 재시전은 무시된다
    const cdBefore = hero.skillCd
    stepSiege(state, spawns, { heroSkill: { x: 2, z: 0 } })
    expect(hero.skillCd).toBe(cdBefore - 1)
    // 사거리 밖 시전은 쿨다운도 소모하지 않는다
    hero.skillCd = 0
    stepSiege(state, spawns, { heroSkill: { x: 40, z: 0 } })
    expect(hero.skillCd).toBe(0)
  })
})
