// [6] 리포트 — 모든 후보의 판정 결과(반려 사유 포함)를 pipeline/reports/에 축적.
// 반려 데이터를 숨기지 않는 것이 "검증기가 진짜"라는 증거다 (docs/05-pipeline.md).
// AI 활용 기술 문서(제출물 4)의 반려율 통계·대표 사례가 여기서 나온다.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StageDef } from '@core'
import type { BotAggregate } from '../../bots/src/index'
import type { Verdict } from './judge'

export interface CandidateResult {
  stage: StageDef
  verdict: Verdict
  /** [planner, greedy, random] — SCHEMA_INVALID면 시뮬 자체를 안 돌리므로 null */
  aggregates: BotAggregate[] | null
}

export interface RunReport {
  runAt: string
  baseSeed: number
  count: number
  criteria: object
  accepted: number
  rejected: Record<string, number>
  candidates: CandidateResult[]
}

const pct = (v: number) => `${Math.round(v * 100)}%`

export function writeReport(reportsDir: string, report: RunReport): { jsonPath: string; mdPath: string } {
  mkdirSync(reportsDir, { recursive: true })
  const stamp = report.runAt.replace(/[:.]/g, '-').slice(0, 19)
  const base = join(reportsDir, `${stamp}-seed${report.baseSeed}`)

  // JSON: 전체 데이터 (actionLog 포함 — 반려 재현·리플레이용). 다만 용량 관리를 위해
  // 각 봇의 대표 1런만 로그를 남기고 나머지는 지표만 유지한다.
  const slim = {
    ...report,
    candidates: report.candidates.map((c) => ({
      ...c,
      aggregates: c.aggregates?.map((a) => ({
        ...a,
        results: a.results.map((r, i) => (i === 0 ? r : { ...r, actionLog: [], finalState: undefined })),
      })),
    })),
  }
  const jsonPath = `${base}.json`
  writeFileSync(jsonPath, JSON.stringify(slim, null, 2))

  // MD: 사람이 읽는 요약표
  const lines: string[] = [
    `# 파이프라인 리포트 — ${report.runAt}`,
    '',
    report.baseSeed === -1
      ? `- **재검사 실행** (기출고 ${report.count}개, 현행 판정 기준)`
      : `- 기준 시드: ${report.baseSeed} / 후보 ${report.count}개 / 시뮬: 결정론 봇 ${String((report.criteria as { topBotRuns?: number }).topBotRuns ?? 1)}회 + Random ${String((report.criteria as { randomRuns?: number }).randomRuns ?? 5)}회`,
    `- 출고 ${report.accepted} / 반려 ${report.count - report.accepted} (${Object.entries(report.rejected).map(([k, v]) => `${k} ${v}`).join(', ') || '없음'})`,
    '',
    '| 후보 | 판정 | 티어/사유 | Planner | Greedy | Random | 상세 |',
    '|---|---|---|---|---|---|---|',
  ]
  for (const c of report.candidates) {
    const v = c.verdict
    const agg = (i: number) => {
      const a = c.aggregates?.[i]
      return a ? `${pct(a.clearRate)}/${pct(a.avgWallHpRatio)}` : '-'
    }
    lines.push(
      `| ${c.stage.id} | ${v.accepted ? '✅ 출고' : '❌ 반려'} | ${v.accepted ? v.tier : v.reason} | ${agg(0)} | ${agg(1)} | ${agg(2)} | ${v.accepted ? '' : v.detail} |`,
    )
  }
  lines.push('', '표기: 클리어율/평균 성벽 잔여율', '')
  const mdPath = `${base}.md`
  writeFileSync(mdPath, lines.join('\n'))
  return { jsonPath, mdPath }
}
