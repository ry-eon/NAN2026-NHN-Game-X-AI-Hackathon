// 파이프라인 오케스트레이터: 생성 → 정적검증 → 봇 시뮬 → 판정 → 출고 + 리포트.
// 사용:
//   pnpm pipeline [--count 8] [--seed 123] [--tier HARD] [--dry]
//   pnpm pipeline --rejudge      # 기출고분 전체를 현행 규칙으로 재검사
//     (탈락분은 pipeline/retired/로 이동 — 이력을 지우지 않는다)

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { CHARACTERS, ENEMY_DEFS } from '@core'
import type { StageDef } from '@core'
import {
  createGreedyPolicy,
  createPlannerPolicy,
  createRandomPolicy,
  evaluateBots,
} from '../../bots/src/index'
import type { BotAggregate } from '../../bots/src/index'
import { generateStage } from './generate'
import { CRITERIA_V0, judge, validateStage } from './judge'
import type { Tier, Verdict } from './judge'
import { writeReport } from './report'
import type { CandidateResult } from './report'
import { shipStages } from './ship'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const acceptedDir = join(root, 'pipeline', 'accepted')
const retiredDir = join(root, 'pipeline', 'retired')
const generatedTs = join(root, 'core', 'src', 'content', 'stages', 'generated.ts')
const reportsDir = join(root, 'pipeline', 'reports')

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

/** 봇 3등급 시뮬 + 판정. 결정론 봇 1회, Random N회 (판정 기준 v1) */
function examine(
  stage: StageDef,
  seedBase: number,
  targetTier?: Tier,
): { verdict: Verdict; aggregates: BotAggregate[] | null } {
  const staticCheck = validateStage(stage)
  if (!staticCheck.ok) {
    return {
      verdict: { accepted: false, reason: 'SCHEMA_INVALID', detail: staticCheck.detail },
      aggregates: null,
    }
  }
  const aggregates = evaluateBots(stage, CHARACTERS, ENEMY_DEFS, [
    { name: 'planner', create: () => createPlannerPolicy(), runs: CRITERIA_V0.topBotRuns },
    { name: 'greedy', create: () => createGreedyPolicy(), runs: CRITERIA_V0.topBotRuns },
    {
      name: 'random',
      create: (run) => createRandomPolicy(seedBase * 100 + run),
      runs: CRITERIA_V0.randomRuns,
    },
  ])
  return { verdict: judge(aggregates, CRITERIA_V0, targetTier), aggregates }
}

function logVerdict(id: string, v: Verdict): void {
  console.log(
    `  ${id}: ${v.accepted ? `✅ 출고 (${v.tier})` : `❌ ${v.reason} — ${v.detail}`}`,
  )
}

const rejudge = process.argv.includes('--rejudge')
const dry = process.argv.includes('--dry')

if (rejudge) {
  // ---- 재검사 모드: 규칙이 바뀌면 기존 출고분을 전수 재검증한다 ----
  const files = existsSync(acceptedDir)
    ? readdirSync(acceptedDir).filter((f) => f.endsWith('.json')).sort()
    : []
  console.log(`[pipeline] 재검사: 기출고 ${files.length}개 (현행 판정 기준 v1)`)
  const candidates: CandidateResult[] = []
  let retiredCount = 0
  for (const f of files) {
    const stage = JSON.parse(readFileSync(join(acceptedDir, f), 'utf8')) as StageDef
    const { verdict, aggregates } = examine(stage, stage.seed)
    candidates.push({ stage, verdict, aggregates })
    logVerdict(stage.id, verdict)
    if (!verdict.accepted) {
      mkdirSync(retiredDir, { recursive: true })
      renameSync(join(acceptedDir, f), join(retiredDir, f))
      retiredCount++
    }
  }
  const rejected: Record<string, number> = {}
  for (const c of candidates) {
    if (!c.verdict.accepted) rejected[c.verdict.reason] = (rejected[c.verdict.reason] ?? 0) + 1
  }
  const { mdPath } = writeReport(reportsDir, {
    runAt: new Date().toISOString(),
    baseSeed: -1, // 재검사 표식
    count: candidates.length,
    criteria: CRITERIA_V0,
    accepted: candidates.length - retiredCount,
    rejected,
    candidates,
  })
  const { total } = shipStages(acceptedDir, generatedTs, [])
  console.log(`[pipeline] 재검사 완료: 유지 ${candidates.length - retiredCount}, 은퇴 ${retiredCount} → 수록 ${total}개`)
  console.log(`[pipeline] 리포트: ${mdPath}`)
} else {
  // ---- 생성 모드 ----
  const count = Number(arg('count') ?? 8)
  const baseSeed = Number(arg('seed') ?? Date.now() % 100_000)
  const targetTier = arg('tier') as Tier | undefined

  console.log(
    `[pipeline] 후보 ${count}개 생성 (시드 ${baseSeed}부터)${targetTier ? `, 목표 티어 ${targetTier}` : ''}`,
  )
  const candidates: CandidateResult[] = []
  for (let i = 0; i < count; i++) {
    const seed = baseSeed + i
    const stage = generateStage(seed)
    const { verdict, aggregates } = examine(stage, seed, targetTier)
    candidates.push({ stage, verdict, aggregates })
    logVerdict(stage.id, verdict)
  }

  const accepted = candidates.filter((c) => c.verdict.accepted)
  const rejected: Record<string, number> = {}
  for (const c of candidates) {
    if (!c.verdict.accepted) rejected[c.verdict.reason] = (rejected[c.verdict.reason] ?? 0) + 1
  }

  const { mdPath } = writeReport(reportsDir, {
    runAt: new Date().toISOString(),
    baseSeed,
    count,
    criteria: CRITERIA_V0,
    accepted: accepted.length,
    rejected,
    candidates,
  })
  console.log(`[pipeline] 리포트: ${mdPath}`)

  if (!dry && accepted.length > 0) {
    const tiers: Record<string, 'EASY' | 'NORMAL' | 'HARD'> = {}
    for (const c of accepted) if (c.verdict.accepted) tiers[c.stage.id] = c.verdict.tier
    const { total } = shipStages(acceptedDir, generatedTs, accepted.map((c) => c.stage), tiers)
    console.log(`[pipeline] 출고 ${accepted.length}개 → generated.ts 재생성 (누적 ${total}개)`)
  } else if (dry) {
    console.log('[pipeline] --dry: 출고 생략')
  }
  console.log(
    `[pipeline] 완료: 출고 ${accepted.length}/${count}, 반려 ${count - accepted.length} (${Object.entries(rejected).map(([k, v]) => `${k} ${v}`).join(', ') || '없음'})`,
  )
}
