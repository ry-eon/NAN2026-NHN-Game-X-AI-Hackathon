# pipeline/

스테이지 생성 → 봇 검증 → 출고 스크립트 (Node, 빌드 타임 전용).

```bash
pnpm pipeline                         # 8후보 생성→검증→출고 (시드는 시각 기반, 리포트에 기록)
pnpm pipeline --count 12 --seed 100   # 재현 가능한 실행
pnpm pipeline --tier HARD             # 목표 티어 외 반려(OFF_CURVE)
pnpm pipeline --dry                   # 출고 없이 리포트만
```

- 단계: 생성(`src/generate.ts`) → 정적검증·판정(`src/judge.ts`) → 봇 시뮬
  (`bots/evaluateBots`, Planner/Greedy/Random×5) → 리포트(`src/report.ts`) → 출고(`src/ship.ts`)
- **출고 구조**: 통과분은 `accepted/*.json`(진실 원천)에 쌓이고,
  `core/src/content/stages/generated.ts`가 코드젠되어 게임 STAGES에 자동 포함된다.
- **리포트**: 실행마다 `reports/<시각>-seed<N>.{json,md}` — 반려 사유 포함 전량 기록.
  AI 활용 기술 문서(제출물 4)의 반려율 통계·대표 사례 원자료.
- 판정 기준(CRITERIA_V0)은 [초안] — `docs/05-pipeline.md` 구현 현황 참조.
- 유료 API 호출은 여기(빌드 타임)에서만. 런타임에는 생성된 데이터만 포함.
