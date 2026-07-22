// 회복률 스윕 — 봇이 캠페인 전체(5연전, 성벽 이월)를 돌려 데스 스파이럴 경계를 실측.
// 사용: pnpm campaign-sim
// RECOVERY_RATE [초안] 확정의 근거 자료 (docs/02 성벽 지속 구조).
// Planner/Greedy는 결정론이라 시드 1개, Random 급 하한은 측정 대상이 아니다
// (Random은 단판도 잘 못 깨므로 캠페인 회복률과 무관하게 전패한다).

import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createGreedyPolicy, createPlannerPolicy, simulateCampaign } from '../../bots/src/index'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const reportsDir = join(root, 'pipeline', 'reports')

const RATES = [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0]
const SEED = 20260722

const bots = [
  { name: 'planner', create: () => createPlannerPolicy() },
  { name: 'greedy', create: () => createGreedyPolicy() },
]

const pct = (v: number) => `${Math.round(v * 100)}%`

console.log('[campaign-sim] 회복률 스윕 — 5연전, 성벽 이월, 첫 후보 자동 영입')
const lines: string[] = [
  '# 캠페인 회복률 스윕 리포트',
  '',
  `실행: ${new Date().toISOString()} / 시드 ${SEED} / 연전 5판`,
  '',
  '| 회복률 | 봇 | 결과 | 클리어 판수 | 판별 성벽 궤적 (시작→종료) |',
  '|---|---|---|---|---|',
]

for (const bot of bots) {
  for (const rate of RATES) {
    const r = simulateCampaign(bot.create, SEED, rate)
    const traj = r.startRatios
      .map((s, i) => `${pct(s)}→${pct(r.endRatios[i] ?? 0)}`)
      .join(' / ')
    const line = `| ${pct(rate)} | ${bot.name} | ${r.status === 'won' ? '✅ 완주' : `❌ ${r.stagesCleared + 1}판째 함락`} | ${r.stagesCleared}/5 | ${traj} |`
    lines.push(line)
    console.log(
      `  회복 ${pct(rate).padStart(4)} ${bot.name.padEnd(7)}: ${r.status === 'won' ? '✅ 완주' : `❌ ${r.stagesCleared + 1}판째 함락`}  궤적 ${traj}`,
    )
  }
}

lines.push('', '해석: 데스 스파이럴 = 시작 성벽 비율이 판을 거듭할수록 단조 하락해 함락으로 이어지는 패턴.', '')
mkdirSync(reportsDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const path = join(reportsDir, `${stamp}-campaign-recovery-sweep.md`)
writeFileSync(path, lines.join('\n'))
console.log(`[campaign-sim] 리포트: ${path}`)
