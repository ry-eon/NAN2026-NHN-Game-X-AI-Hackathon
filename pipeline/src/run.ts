// 파이프라인 오케스트레이터: 생성 → 정적검증 → 봇 시뮬 → 판정 → 출고 + 리포트.
// 사용: pnpm pipeline [--count 8] [--seed 123] [--tier HARD] [--dry]
//   --seed 없으면 현재 시각 기반(리포트에 기록되므로 재현 가능)
//   --dry: 출고(코드젠) 없이 리포트만

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ENEMY_DEFS, UNIT_DEFS } from '@core'
import {
  createGreedyPolicy,
  createPlannerPolicy,
  createRandomPolicy,
  evaluateBots,
} from '../../bots/src/index'
import { generateStage } from './generate'
import { CRITERIA_V0, judge, validateStage } from './judge'
import type { Tier, Verdict } from './judge'
import { writeReport } from './report'
import type { CandidateResult } from './report'
import { shipStages } from './ship'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const count = Number(arg('count') ?? 8)
const baseSeed = Number(arg('seed') ?? Date.now() % 100_000)
const targetTier = arg('tier') as Tier | undefined
const dry = process.argv.includes('--dry')

console.log(`[pipeline] 후보 ${count}개 생성 (시드 ${baseSeed}부터)${targetTier ? `, 목표 티어 ${targetTier}` : ''}`)

const candidates: CandidateResult[] = []
for (let i = 0; i < count; i++) {
  const seed = baseSeed + i
  const stage = generateStage(seed)

  const staticCheck = validateStage(stage)
  let verdict: Verdict
  let aggregates = null
  if (!staticCheck.ok) {
    verdict = { accepted: false, reason: 'SCHEMA_INVALID', detail: staticCheck.detail }
  } else {
    aggregates = evaluateBots(
      stage,
      UNIT_DEFS,
      ENEMY_DEFS,
      [
        { name: 'planner', create: () => createPlannerPolicy() },
        { name: 'greedy', create: () => createGreedyPolicy() },
        { name: 'random', create: (run) => createRandomPolicy(seed * 100 + run) },
      ],
      CRITERIA_V0.runsPerBot,
    )
    verdict = judge(aggregates, CRITERIA_V0, targetTier)
  }
  candidates.push({ stage, verdict, aggregates })
  console.log(
    `  ${stage.id}: ${verdict.accepted ? `✅ 출고 (${verdict.tier})` : `❌ ${verdict.reason} — ${verdict.detail}`}`,
  )
}

const accepted = candidates.filter((c) => c.verdict.accepted)
const rejected: Record<string, number> = {}
for (const c of candidates) {
  if (!c.verdict.accepted) rejected[c.verdict.reason] = (rejected[c.verdict.reason] ?? 0) + 1
}

const { mdPath } = writeReport(join(root, 'pipeline', 'reports'), {
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
  const { total } = shipStages(
    join(root, 'pipeline', 'accepted'),
    join(root, 'core', 'src', 'content', 'stages', 'generated.ts'),
    accepted.map((c) => c.stage),
  )
  console.log(`[pipeline] 출고 ${accepted.length}개 → generated.ts 재생성 (누적 ${total}개)`)
} else if (dry) {
  console.log('[pipeline] --dry: 출고 생략')
}
console.log(
  `[pipeline] 완료: 출고 ${accepted.length}/${count}, 반려 ${count - accepted.length} (${Object.entries(rejected).map(([k, v]) => `${k} ${v}`).join(', ') || '없음'})`,
)
