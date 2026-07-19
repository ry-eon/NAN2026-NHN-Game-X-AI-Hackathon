// [6] 출고 — 통과 스테이지를 pipeline/accepted/(진실 원천)에 저장하고,
// core/src/content/stages/generated.ts를 재생성한다 (빌드 타임 코드젠).
// core는 fs를 모르므로(순수성), 게임에 넣는 유일한 통로는 이 코드젠이다.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StageDef } from '@core'

export function shipStages(
  acceptedDir: string,
  generatedTsPath: string,
  newlyAccepted: StageDef[],
): { total: number } {
  mkdirSync(acceptedDir, { recursive: true })
  for (const stage of newlyAccepted) {
    writeFileSync(join(acceptedDir, `${stage.id}.json`), JSON.stringify(stage, null, 2))
  }

  const all = readdirSync(acceptedDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(acceptedDir, f), 'utf8')) as StageDef)

  const body = [
    '// ⚠️ 자동 생성 파일 — 직접 편집 금지.',
    '// pipeline(`pnpm pipeline`)이 pipeline/accepted/*.json (봇 검증 통과분)에서 재생성한다.',
    '// 진실 원천은 pipeline/accepted/ 이며, 이 파일은 빌드 타임 산출물이다.',
    '',
    "import type { StageDef } from '../../types'",
    '',
    `export const GENERATED_STAGES: StageDef[] = ${JSON.stringify(all, null, 2)}`,
    '',
  ].join('\n')
  writeFileSync(generatedTsPath, body)
  return { total: all.length }
}
