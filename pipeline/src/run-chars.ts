// 소프트 파이프라인 오케스트레이터: 캐릭터 생성 → 밸런스 판정 → 풀 출고 + 리포트.
// 사용: pnpm pipeline:chars [--count 30] [--seed 123] [--dry]
// 출고 구조는 스테이지와 동일: pipeline/characters/*.json(진실 원천) →
// core/src/content/characters-generated.ts 코드젠 → CHARACTER_POOL.
// 사람 승인 게이트: 출고분은 docs/06 원장 규칙에 따라 리포트로 검토 가능 —
// 최종 반입 커밋이 곧 사람 승인이다.

import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { CHARACTERS } from '@core'
import type { CharacterDef } from '@core'
import { generateCharacter } from './char-generate'
import { CHAR_CRITERIA_V0, comboKey, computeBaseline, judgeCharacter } from './char-judge'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const acceptedDir = join(root, 'pipeline', 'characters')
const generatedTs = join(root, 'core', 'src', 'content', 'characters-generated.ts')
const reportsDir = join(root, 'pipeline', 'reports')

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const count = Number(arg('count') ?? 30)
const baseSeed = Number(arg('seed') ?? Date.now() % 100_000)
const dry = process.argv.includes('--dry')

console.log(`[chars] 후보 ${count}명 생성 (시드 ${baseSeed}부터), 판정 레벨 Lv${CHAR_CRITERIA_V0.judgeLevel}`)
const baseline = computeBaseline()
console.log(
  `[chars] 기준선(도하/세아/단비 Lv5): ${CHAR_CRITERIA_V0.stages
    .map((s, i) => `${s.id} planner=${baseline[i]!.plannerCleared ? '클리어' : '실패'} greedy벽=${Math.round(baseline[i]!.greedyWall * 100)}%`)
    .join(' / ')}`,
)

// 중복 조합·이름 서명: 기존 출고분 + 수제 로스터도 포함
const seen = new Set<string>()
const seenNames = new Set<string>(CHARACTERS.map((c) => c.name))
for (const c of CHARACTERS) if (c.skillSet) seen.add(comboKey(c))
if (existsSync(acceptedDir)) {
  for (const f of readdirSync(acceptedDir).filter((f) => f.endsWith('.json'))) {
    const prev = JSON.parse(readFileSync(join(acceptedDir, f), 'utf8')) as CharacterDef
    seen.add(comboKey(prev))
    seenNames.add(prev.name)
  }
}

const results: { c: CharacterDef; verdict: ReturnType<typeof judgeCharacter> }[] = []
const accepted: CharacterDef[] = []
const rejected: Record<string, number> = {}

for (let i = 0; i < count; i++) {
  const c = generateCharacter(baseSeed + i)
  const verdict = seenNames.has(c.name)
    ? ({ accepted: false, reason: 'NO_IDENTITY', detail: `중복 이름 ${c.name}` } as const)
    : judgeCharacter(c, baseline, seen)
  results.push({ c, verdict })
  if (verdict.accepted) {
    accepted.push(c)
    seen.add(comboKey(c))
    seenNames.add(c.name)
    console.log(`  ${c.id} ${c.epithet} ${c.name} (${c.role}): ✅ 영입 풀 (${verdict.detail})`)
  } else {
    rejected[verdict.reason] = (rejected[verdict.reason] ?? 0) + 1
    console.log(`  ${c.id} ${c.epithet} ${c.name} (${c.role}): ❌ ${verdict.reason} — ${verdict.detail}`)
  }
}

// 리포트
mkdirSync(reportsDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const md = [
  `# 캐릭터 파이프라인 리포트 — ${new Date().toISOString()}`,
  '',
  `- 시드 ${baseSeed} / 후보 ${count} / 출고 ${accepted.length} / 반려 ${count - accepted.length} (${Object.entries(rejected).map(([k, v]) => `${k} ${v}`).join(', ') || '없음'})`,
  `- 기준선: ${CHAR_CRITERIA_V0.stages.map((s, i) => `${s.id} greedy벽 ${Math.round(baseline[i]!.greedyWall * 100)}%`).join(', ')}`,
  '',
  '| id | 이름 | 역할 | 기술 조합 | 판정 | 상세 |',
  '|---|---|---|---|---|---|',
  ...results.map(({ c, verdict }) => {
    const s = c.skillSet!
    return `| ${c.id} | ${c.epithet} ${c.name} | ${c.role} | ${s.passive.name}/${s.auto.name}/${s.active.name} | ${verdict.accepted ? '✅' : `❌ ${verdict.reason}`} | ${verdict.detail} |`
  }),
  '',
].join('\n')
writeFileSync(join(reportsDir, `${stamp}-chars-seed${baseSeed}.md`), md)
writeFileSync(
  join(reportsDir, `${stamp}-chars-seed${baseSeed}.json`),
  JSON.stringify({ baseSeed, count, criteria: CHAR_CRITERIA_V0.opWallDelta, baseline, results }, null, 2),
)

// 출고 (코드젠)
if (!dry && accepted.length > 0) {
  mkdirSync(acceptedDir, { recursive: true })
  for (const c of accepted) writeFileSync(join(acceptedDir, `${c.id}.json`), JSON.stringify(c, null, 2))
  const all = readdirSync(acceptedDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(acceptedDir, f), 'utf8')) as CharacterDef)
  writeFileSync(
    generatedTs,
    [
      '// ⚠️ 자동 생성 파일 — 직접 편집 금지.',
      '// pipeline(`pnpm pipeline:chars`)이 pipeline/characters/*.json(밸런스 검증 통과)에서 재생성.',
      '// 영입 풀 — 시작 가신 3인(도하/세아/단비) 외의 캐릭터는 여기서 영입된다.',
      '',
      "import type { CharacterDef } from '../types'",
      '',
      `export const CHARACTER_POOL: CharacterDef[] = ${JSON.stringify(all, null, 2)}`,
      '',
    ].join('\n'),
  )
  console.log(`[chars] 출고 ${accepted.length}명 → 영입 풀 누적 ${all.length}명`)
} else if (dry) {
  console.log('[chars] --dry: 출고 생략')
}
console.log(`[chars] 완료`)
