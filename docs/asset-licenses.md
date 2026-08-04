# 에셋 출처·라이선스 (제출 요건)

원칙: 외부 에셋(이미지·사운드·폰트) 사용 시 **그 자리에서** 이 문서에 기록한다 (CLAUDE.md).

## 현황 (2026-07-25 갱신 — v5 3D 전환으로 CC0 에셋 도입)

### 외부 에셋 (전부 CC0 — 저작자 표기 불요, 상업 이용 가능. 출처는 성실 기록)
| 에셋 | 용도 | 출처 | 라이선스 |
|---|---|---|---|
| Kloppenheim 02 (Puresky) HDRI 1K | 하늘·환경광 | Poly Haven (polyhaven.com/a/kloppenheim_02_puresky) | CC0 |
| Bricks075A 1K | 성벽 석재 PBR | ambientCG (ambientcg.com/view?id=Bricks075A) | CC0 |
| Grass004 1K | 들판 PBR | ambientCG (ambientcg.com/view?id=Grass004) | CC0 |
| Ground048 1K | 흙길 PBR | ambientCG (ambientcg.com/view?id=Ground048) | CC0 |
| PavingStones128 1K | 안뜰 포석 PBR | ambientCG (ambientcg.com/view?id=PavingStones128) | CC0 |
| Rock Moss Set 01 (GLTF 1K) | 들판 바위 (포토스캔) | Poly Haven (polyhaven.com/a/rock_moss_set_01) | CC0 |
| Dead Tree Trunk (GLTF 1K) | 고사목 (포토스캔) | Poly Haven (polyhaven.com/a/dead_tree_trunk) | CC0 |
| Wooden Crate 01 (GLTF 1K) | 안뜰 궤짝 | Poly Haven (polyhaven.com/a/wooden_crate_01) | CC0 |

### 코드 생성 (v5 3D)
- 성채·소품 지오메트리: three.js 절차 조합 (client/src3d/environment.ts)
- 캐릭터·괴수·보스 모델 전량: 절차 지오메트리 (client/src3d/models.ts)
- **사운드 전량: WebAudio 실시간 합성** (client/src3d/audio.ts) — **오디오 파일 0개**.
  오실레이터 + 필터드 노이즈로 13종을 합성한다(대포·발리스타·화살·검격·접전·성벽 피격·
  적 사망·아군 전사·업화·부활·뿔피리·승리·패배). 거리 감쇠와 스테레오 패닝은 카메라 기준.
  → 외부 에셋·라이선스·번들 크기·다운로드가 전부 0. 시각 요소와 같은 원칙을 유지한다.
  (2026-08-05 추가. 검증: OfflineAudioContext로 13종을 렌더해 무음·클리핑 0건 확인)

### 레거시 2D (legacy-2d 브랜치)
모든 시각 요소는 코드 생성이었다:
- 픽셀 스프라이트(유닛 6종·괴수 4종·타일 4종): `client/src/pixel.ts`의 픽셀 맵을
  부트 시 CanvasTexture로 생성. 본 리포에서 직접 제작.
- 전투 이펙트(트레이서·버스트·플래시): Phaser Graphics 절차 렌더링.
- 폰트: 시스템 monospace (번들 폰트 없음).
- 사운드: WebAudio 실시간 합성 (`client/src/audio.ts` — 오실레이터+노이즈).
  오디오 파일 없음.

| 에셋 | 출처 | 라이선스 |
|---|---|---|
| (없음) | — | — |
