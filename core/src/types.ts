// core 공용 타입. 스테이지·유닛·적 정의는 전부 데이터(JSON 직렬화 가능)이고,
// 파이프라인이 같은 스키마로 스테이지를 생성한다 (docs/03-architecture.md).

/** 초당 시뮬레이션 틱 수. 모든 시간 단위는 틱으로 환산해 저장한다. */
export const TICKS_PER_SECOND = 30

// ---------------------------------------------------------------- 타일/스테이지

/**
 * 타일 종류 (docs/02-game-design.md):
 * - ground:  지상. 근접 유닛 배치 가능. 적은 지나지 않는다.
 * - road:    적 진입로. 근접 유닛 배치 가능 → 블로킹은 여기서 일어난다.
 * - wallTop: 성벽 위. 원거리·지원 유닛 배치 가능. 적이 닿지 못한다.
 * - blocked: 배치 불가.
 */
export type TileType = 'ground' | 'road' | 'wallTop' | 'blocked'

/** tilesRows 문자 → TileType 매핑: G=ground, R=road, W=wallTop, X=blocked */
export const TILE_CHARS: Record<string, TileType> = {
  G: 'ground',
  R: 'road',
  W: 'wallTop',
  X: 'blocked',
}

export interface CellPos {
  x: number
  y: number
}

export interface SpawnDef {
  /** 스폰 틱 (스테이지 시작 기준 절대 틱) */
  tick: number
  enemyDefId: string
  /** StageDef.paths 인덱스 */
  pathIndex: number
  /** 웨이브 번호 (표시·리포트용, 1부터) */
  wave: number
}

export interface StageDef {
  id: string
  name: string
  /** 행 단위 타일 문자열 (y=0이 첫 행). 모든 행 길이 동일해야 함. */
  tilesRows: string[]
  /**
   * 적 이동 경로. 스폰 지점 → 성벽 방향, 인접 셀의 연속.
   * 모든 셀은 road 타일이어야 하며, 마지막 셀 도달 시 적이 성벽을 타격한다.
   */
  paths: CellPos[][]
  wallHp: number
  initialCost: number
  costRegenPerSec: number
  costMax: number
  /** tick 오름차순 정렬 필수 */
  spawns: SpawnDef[]
  /** 기본 시뮬레이션 시드 (봇 검증·리플레이 재현용) */
  seed: number
}

// ---------------------------------------------------------------- 유닛/적 정의

export interface UnitDef {
  id: string
  name: string
  /** ground: 지상/진입로 배치(근접) · wallTop: 성벽 위 배치(원거리) */
  placement: 'ground' | 'wallTop'
  cost: number
  hp: number
  atk: number
  def: number
  atkIntervalTicks: number
  /**
   * 사거리 (타일 단위, 유닛 셀 중심 기준 유클리드).
   * 0이면 근접: 자신이 저지 중인 적만 공격한다.
   */
  range: number
  /** 동시 저지 수. 0이면 저지 없음(원거리). */
  blockCount: number
  /** 철수·사망 후 재배치 대기 틱 */
  redeployTicks: number
  /** 광역 반경 (타일). 지정 시 주 표적 주변까지 피해 (술사류) */
  aoeRadius?: number
  /** true면 공격 대신 사거리 내 가장 다친 아군을 atk만큼 치유 (힐러류) */
  heals?: boolean
  /** 감속 오라: 반경 내 적 이동 속도에 speedFactor를 곱한다 (특수류) */
  aura?: { radius: number; speedFactor: number }
  /** 해금된 기술 목록 (applyLevel이 채운다). statMod 패시브는 이미 스탯에 구워져 있음 */
  skills?: SkillDef[]
}

// ---------------------------------------------------------------- 기술 (docs/07 v2)

/** 패시브: 레벨 적용 시 스탯에 굽거나(statMod), 전투 중 상시 발동(관통/처치 코스트) */
export type PassiveEffect =
  | { kind: 'statMod'; atkMul?: number; hpMul?: number; rangeAdd?: number; blockAdd?: number; defAdd?: number }
  | { kind: 'armorPierce'; ratio: number } // 적 방어력을 ratio만큼 무시
  | { kind: 'onKillCost'; amount: number } // 처치 시 코스트 획득

/** 자동: 조건/주기 충족 시 스스로 발동 */
export type AutoEffect =
  | { kind: 'aoePulse'; everyNAttacks: number; radius: number; dmgMul: number }
  | { kind: 'selfHeal'; thresholdRatio: number; amount: number; cooldownTicks: number }
  | { kind: 'shield'; amount: number; intervalTicks: number }

/** 액티브: 수동 발동(useSkill), 쿨다운제 — 성벽 액션과 같은 조작 결 */
export type ActiveEffect =
  | { kind: 'frenzy'; atkSpeedMul: number; durationTicks: number }
  | { kind: 'knockback'; tiles: number } // 저지 중인 적을 밀쳐내고 저지 해제
  | { kind: 'heal'; amount: number } // 즉시 자가 회복
  | { kind: 'nova'; damage: number; radius: number } // 자기 주변 폭발 (방어 무시)

export type SkillSlot = 'passive' | 'auto' | 'active'

export interface SkillDef {
  id: string
  name: string
  desc: string
  slot: SkillSlot
  effect: PassiveEffect | AutoEffect | ActiveEffect
  /** active 전용 재사용 대기 */
  cooldownTicks?: number
}

/**
 * 캐릭터 = 정체성을 가진 유닛 (2026-07-20 확정: 직군 → 캐릭터 중심 개편).
 * 기계적으로는 UnitDef와 동일하게 시뮬레이션된다 — sim은 정체성 필드를 모른다.
 * role은 역할 원형(구 직군) id로, 소프트 파이프라인 밸런스 검증의 기준점.
 *
 * v2 (docs/07): skillSet은 고유기술 3종(패시브/자동/액티브), 해금은 Lv1/3/5.
 * 전투에 들어가는 것은 applyLevel()이 만든 배틀 def — sim은 레벨을 모른다.
 */
export interface CharacterDef extends UnitDef {
  role: string
  epithet: string
  /** 한 문장 서사 (생존 세계관) */
  lore: string
  /** 대사: 배치/스킬/승리 (docs/02 캐릭터 구성 요소) */
  lines: { deploy: string; skill: string; victory: string }
  /** 고유기술 3종 (v2). 임시 로스터는 아직 없음 */
  skillSet?: { passive: SkillDef; auto: SkillDef; active: SkillDef }
}

export interface EnemyDef {
  id: string
  name: string
  hp: number
  atk: number
  def: number
  atkIntervalTicks: number
  /** 이동 속도 (타일/초) */
  speedTilesPerSec: number
  /** 성벽 타격 시 피해 (방어력 무시, atkIntervalTicks 주기) */
  wallDamage: number
  /**
   * 공성류: 경로 끝에서 이 거리(타일) 안에 들면 멈춰서 원거리로 성벽을 포격한다.
   * 성벽 접점의 원거리 커버만으론 못 잡는다 — 경로 안쪽 커버 또는 전방 저지가 필요.
   */
  wallAttackRange?: number
}

// ---------------------------------------------------------------- 런타임 상태

export interface ActiveUnit {
  id: number
  defId: string
  x: number
  y: number
  hp: number
  /** 다음 공격까지 남은 틱 */
  cooldown: number
  /** 저지 중인 적 id 목록 (저지 시작 순) */
  blockedEnemyIds: number[]
  // ---- 기술 런타임 (docs/07 v2) ----
  /** 남은 보호막 (피해를 먼저 흡수) */
  shield: number
  /** 누적 공격 횟수 (aoePulse 주기용) */
  attackCount: number
  /** 자동 기술 다음 발동 가능 틱 */
  autoReadyAt: number
  /** 액티브 기술 재사용 가능 틱 */
  activeReadyAt: number
  /** 액티브 버프(frenzy 등) 만료 틱 */
  activeUntil: number
}

export interface ActiveEnemy {
  id: number
  defId: string
  pathIndex: number
  /** 경로 진행도. path[floor(pathPos)]~path[ceil(pathPos)] 사이를 보간 */
  pathPos: number
  hp: number
  cooldown: number
  /** 저지당한 유닛 id (null이면 이동 중) */
  blockedBy: number | null
  /** 경로 끝 도달 → 성벽 타격 중 */
  atWall: boolean
  /** 스폰 시점의 웨이브 번호 */
  wave: number
}

export type GameStatus = 'playing' | 'won' | 'lost'

export interface GameState {
  tick: number
  status: GameStatus
  rngState: number
  cost: number
  wallHp: number
  units: ActiveUnit[]
  enemies: ActiveEnemy[]
  /** StageDef.spawns 소비 위치 */
  spawnCursor: number
  /** unitDefId → 재배치 가능 틱 */
  redeployReadyAt: Record<string, number>
  /** 성벽 수리 재사용 가능 틱 */
  repairReadyAt: number
  /** 성벽 스킬 재사용 가능 틱 */
  wallSkillReadyAt: number
  nextEntityId: number
  /** 이번 틱에 발생한 이벤트 (틱 시작 시 초기화). 렌더링·리포트용 */
  events: SimEvent[]
}

// ---------------------------------------------------------------- 입력/이벤트

/** 성벽 액션 규칙 (딱 2종 — docs/02-game-design.md). 수치는 [초안] */
export interface WallActionDefs {
  /** 수리: 코스트를 소모해 성벽 HP 회복 — 배치 vs 수리 자원 딜레마 */
  repair: { cost: number; heal: number; cooldownTicks: number }
  /** 성벽 스킬(낙석): 쿨다운제 광역기. 방어력 무시 고정 피해 */
  skill: { damage: number; radius: number; cooldownTicks: number }
}

export type PlayerAction =
  | { type: 'deploy'; unitDefId: string; x: number; y: number }
  | { type: 'withdraw'; unitId: number }
  | { type: 'repairWall' }
  | { type: 'wallSkill'; x: number; y: number }
  | { type: 'useSkill'; unitId: number } // 캐릭터 액티브 기술 발동

/** 리플레이 = {tick, action} 시퀀스. 봇과 플레이어가 같은 형식을 쓴다. */
export interface TimedAction {
  tick: number
  action: PlayerAction
}

export type DeployRejectReason =
  | 'insufficientCost'
  | 'invalidTile'
  | 'occupied'
  | 'onCooldown'
  | 'unknownUnit'
  | 'gameOver'

export type WallActionRejectReason = 'insufficientCost' | 'onCooldown' | 'wallFull' | 'invalidTarget'

export type SimEvent =
  | { type: 'deployed'; unitId: number; unitDefId: string; x: number; y: number }
  | { type: 'deployRejected'; unitDefId: string; x: number; y: number; reason: DeployRejectReason }
  // 전투 연출용 이벤트 — 룰에는 영향 없고 렌더러·리포트가 소비한다
  | { type: 'unitAttacked'; unitId: number; unitDefId: string; targetIds: number[] }
  | { type: 'enemyAttacked'; enemyId: number; targetUnitId: number }
  | { type: 'unitHealed'; healerId: number; targetId: number; amount: number }
  | { type: 'wallRepaired'; amount: number; wallHp: number }
  | { type: 'wallSkillFired'; x: number; y: number; hits: number }
  | { type: 'wallActionRejected'; action: 'repair' | 'skill'; reason: WallActionRejectReason }
  | { type: 'skillUsed'; unitId: number; skillId: string }
  | { type: 'skillRejected'; unitId: number; reason: 'unknownUnit' | 'noActiveSkill' | 'onCooldown' }
  | { type: 'withdrawn'; unitId: number; unitDefId: string; refund: number }
  | { type: 'enemySpawned'; enemyId: number; enemyDefId: string; wave: number }
  | { type: 'enemyKilled'; enemyId: number; enemyDefId: string; by: number }
  | { type: 'unitDied'; unitId: number; unitDefId: string }
  | { type: 'wallHit'; enemyId: number; damage: number; wallHp: number }
  | { type: 'won' }
  | { type: 'lost' }
