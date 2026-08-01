// 봇 검증 — 웨이브 구성(시드)을 봇 3등급으로 플레이시켜 **출고 가능한지 판정**한다.
//
// v5는 1라운드 고정이라 2D 시절처럼 스테이지를 생성하지 않는다. 대신 검증 대상이
// "이 시드의 웨이브 구성 + 기본 배치가 게임으로 성립하는가"가 된다.
// 통과한 시드만 출고 후보이고, 반려 사유는 리포트에 전량 남는다(제출물 4의 원재료).
//
//   pnpm verify            # 리포트 생성 + 출고 시드 판정 (실패 시 종료코드 1)
//   pnpm verify --seeds 1,2,3
//
// 판정 기준(CRITERIA_V0)은 게임 설계 주장 그 자체다:
//   - 무개입으로도 이겨야 한다        → 기본 배치가 성립한다는 뜻
//   - 무개입 여유가 과하면 안 된다    → 이기는 게 당연하면 조작할 이유가 없다
//   - 적극 플레이가 손해면 안 된다    → 플레이어의 개입이 보상돼야 한다
//   - 아무렇게나 만져도 지면 안 된다  → 심사자가 대충 조작해도 무너지지 않아야 한다
//   - 판이 45~150초에 끝나야 한다     → 30~60초 플레이 영상에 담긴다

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WALL_HP } from '../sim/world'
import { POLICIES, afk, greedy, random } from './policy'
import { playout, replay } from './runner'
import type { Playout } from './runner'

/** 게임에 출고 중인 시드 (client/src3d/main.ts의 SEED와 같아야 한다) */
export const SHIPPING_SEED = 20260725

export const CANDIDATE_SEEDS = [SHIPPING_SEED, 1, 7, 42, 777, 31337]

export const CRITERIA_V0 = {
  afkWallMin: 150, // 무개입 승리 최소 잔존 (아슬아슬해도 이기긴 해야)
  afkWallMax: 1400, // 무개입 여유 상한 (너무 쉬우면 조작할 이유가 없다)
  secondsMin: 45,
  secondsMax: 150,
}

export interface SeedVerdict {
  seed: number
  runs: Record<string, Playout>
  pass: boolean
  reasons: string[] // 반려 사유 (통과면 빈 배열)
}

export function verifySeed(seed: number): SeedVerdict {
  const runs: Record<string, Playout> = {}
  for (const p of POLICIES) runs[p.name] = playout(seed, p)
  const a = runs[afk.name]!
  const g = runs[greedy.name]!
  const r = runs[random.name]!
  const reasons: string[] = []

  if (a.status !== 'won') reasons.push(`무개입 패배 (성벽 ${a.wallHp}, ${a.seconds}초) — 기본 배치가 성립하지 않는다`)
  else if (a.wallHp < CRITERIA_V0.afkWallMin)
    reasons.push(`무개입 여유 부족 (${a.wallHp} < ${CRITERIA_V0.afkWallMin})`)
  else if (a.wallHp > CRITERIA_V0.afkWallMax)
    reasons.push(`무개입이 너무 쉽다 (${a.wallHp} > ${CRITERIA_V0.afkWallMax}) — 조작할 이유가 없다`)

  if (g.status !== 'won') reasons.push(`적극 플레이 패배 (성벽 ${g.wallHp})`)
  else if (g.wallHp < a.wallHp)
    reasons.push(`적극 플레이가 손해 (greedy ${g.wallHp} < afk ${a.wallHp}) — 개입이 보상되지 않는다`)

  if (r.status !== 'won')
    reasons.push(`무작위 조작에서 패배 (성벽 ${r.wallHp}, ${r.seconds}초) — 대충 만지면 무너진다`)

  if (a.seconds < CRITERIA_V0.secondsMin || a.seconds > CRITERIA_V0.secondsMax)
    reasons.push(`판 길이 이탈 (${a.seconds}초, 허용 ${CRITERIA_V0.secondsMin}~${CRITERIA_V0.secondsMax})`)

  // 리플레이 재현성 — 봇이 남긴 커맨드로 같은 판이 나오지 않으면 검증 자체가 무의미하다
  for (const p of POLICIES) {
    const run = runs[p.name]!
    const rep = replay(seed, run.commands)
    if (rep.status !== run.status || rep.ticks !== run.ticks || rep.wallHp !== run.wallHp) {
      reasons.push(`리플레이 불일치 (${p.name}) — 결정론이 깨졌다`)
    }
  }

  return { seed, runs, pass: reasons.length === 0, reasons }
}

function toMarkdown(verdicts: SeedVerdict[]): string {
  const L: string[] = []
  L.push('# 봇 검증 리포트')
  L.push('')
  L.push('`pnpm verify` 산출물. 웨이브 구성(시드)마다 봇 3등급을 헤드리스로 플레이시켜 판정한다.')
  L.push('봇이 넣는 입력은 플레이어가 넣는 입력과 같은 타입이고, 남긴 커맨드 시퀀스는 그대로 리플레이된다.')
  L.push('')
  L.push('## 판정 기준')
  L.push('')
  L.push(`- 무개입(afk) 승리 + 잔존 성벽 ${CRITERIA_V0.afkWallMin}~${CRITERIA_V0.afkWallMax} / ${WALL_HP}`)
  L.push('- 적극 플레이(greedy) 승리 + 무개입보다 잔존이 많을 것 (개입이 보상될 것)')
  L.push('- 무작위 조작(random) 승리 (대충 만져도 무너지지 않을 것)')
  L.push(`- 판 길이 ${CRITERIA_V0.secondsMin}~${CRITERIA_V0.secondsMax}초 (플레이 영상 30~60초에 담길 것)`)
  L.push('- 봇 커맨드 리플레이가 원본과 일치할 것 (결정론)')
  L.push('')
  L.push('## 시드별 결과')
  L.push('')
  L.push('| 시드 | 봇 | 결과 | 성벽 | 초 | 처치 | 손실 | 커맨드 |')
  L.push('|---|---|---|---|---|---|---|---|')
  for (const v of verdicts) {
    for (const p of POLICIES) {
      const r = v.runs[p.name]!
      L.push(
        `| ${v.seed}${v.seed === SHIPPING_SEED ? ' (출고)' : ''} | ${p.name} | ${
          r.status === 'won' ? '승리' : r.status === 'lost' ? '패배' : r.status
        } | ${r.wallHp}/${WALL_HP} | ${r.seconds} | ${r.enemiesKilled} | ${r.unitsLost} | ${r.commands.length} |`,
      )
    }
  }
  L.push('')
  L.push('## 판정')
  L.push('')
  for (const v of verdicts) {
    L.push(`- **시드 ${v.seed}${v.seed === SHIPPING_SEED ? ' (출고 중)' : ''}** — ${v.pass ? '통과' : '반려'}`)
    for (const r of v.reasons) L.push(`  - ${r}`)
  }
  L.push('')
  const passed = verdicts.filter((v) => v.pass).map((v) => v.seed)
  L.push(`통과 ${passed.length}/${verdicts.length} — 통과 시드: ${passed.length ? passed.join(', ') : '없음'}`)
  L.push('')
  L.push('## 봇 등급')
  L.push('')
  for (const p of POLICIES) L.push(`- **${p.name}** — ${p.desc}`)
  L.push('')
  return L.join('\n')
}

export function runVerification(seeds: number[]): { verdicts: SeedVerdict[]; markdown: string } {
  const verdicts = seeds.map(verifySeed)
  return { verdicts, markdown: toMarkdown(verdicts) }
}

// ---------------------------------------------------------------- CLI
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isMain) {
  const arg = process.argv.indexOf('--seeds')
  const seeds =
    arg >= 0 && process.argv[arg + 1]
      ? process.argv[arg + 1]!.split(',').map((s) => Number(s.trim()))
      : CANDIDATE_SEEDS
  const { verdicts, markdown } = runVerification(seeds)

  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../reports')
  mkdirSync(outDir, { recursive: true })
  // 커맨드 시퀀스는 JSON에만 (리포트를 읽는 사람에겐 길이만 있으면 된다)
  writeFileSync(resolve(outDir, 'latest.json'), `${JSON.stringify(verdicts, null, 2)}\n`)
  writeFileSync(resolve(outDir, 'latest.md'), markdown)

  console.log(markdown)
  const ship = verdicts.find((v) => v.seed === SHIPPING_SEED)
  if (ship && !ship.pass) {
    console.error(`\n출고 시드 ${SHIPPING_SEED} 반려 — 위 사유 참조`)
    process.exit(1)
  }
}
