# NAN 2026 — 생성이 아니라 보증

서브컬처 캐릭터 수집형 디펜스/오펜스 하이브리드 게임.
AI 파이프라인이 스테이지와 캐릭터를 생성하고, **봇 시뮬레이션이 검증하여 통과분만 출고**한다.

> AI가 만들었다는 사실이 아니라, 만든 것이 게임으로 성립함을 시스템이 증명한다.

## 구조

```
core/      순수 TS 시뮬레이션 (단일 진실 원천, 결정론적, 렌더링 의존 0)
client/    Phaser 3 렌더러 — core의 상태를 그리기만 한다
bots/      core를 헤드리스로 구동하는 봇 플레이테스터
pipeline/  생성 → 봇 검증 → 출고 스크립트 (빌드 타임 전용)
docs/      기획·설계·디렉팅 로그
```

봇과 클라이언트가 문자 그대로 같은 core를 실행하므로,
"봇이 검증한 스테이지 = 플레이어가 플레이하는 스테이지"라는 보증이 성립한다.

## 실행

```bash
pnpm install
pnpm dev        # 개발 서버
pnpm build      # 타입체크 + 프로덕션 빌드 (dist/)
pnpm test       # core/bots/pipeline 테스트 (결정론·등급 변별력·판정 규칙)
pnpm pipeline   # 스테이지 생성 → 봇 검증 → 통과분만 출고 (리포트: pipeline/reports/)
```

배포: `main` 푸시 시 GitHub Actions가 GitHub Pages로 자동 배포.

## 문서

- [프로젝트 브리프](docs/01-project-brief.md)
- [게임 디자인](docs/02-game-design.md)
- [아키텍처](docs/03-architecture.md)
- [마일스톤](docs/04-milestones.md)
- [AI 파이프라인](docs/05-pipeline.md)
