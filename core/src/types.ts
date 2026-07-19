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
  nextEntityId: number
  /** 이번 틱에 발생한 이벤트 (틱 시작 시 초기화). 렌더링·리포트용 */
  events: SimEvent[]
}

// ---------------------------------------------------------------- 입력/이벤트

export type PlayerAction =
  | { type: 'deploy'; unitDefId: string; x: number; y: number }
  | { type: 'withdraw'; unitId: number }

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

export type SimEvent =
  | { type: 'deployed'; unitId: number; unitDefId: string; x: number; y: number }
  | { type: 'deployRejected'; unitDefId: string; x: number; y: number; reason: DeployRejectReason }
  | { type: 'withdrawn'; unitId: number; unitDefId: string; refund: number }
  | { type: 'enemySpawned'; enemyId: number; enemyDefId: string; wave: number }
  | { type: 'enemyKilled'; enemyId: number; enemyDefId: string; by: number }
  | { type: 'unitDied'; unitId: number; unitDefId: string }
  | { type: 'wallHit'; enemyId: number; damage: number; wallHp: number }
  | { type: 'won' }
  | { type: 'lost' }
