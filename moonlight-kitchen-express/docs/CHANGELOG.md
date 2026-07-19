# 변경 이력

달빛 주방열차의 사용자 영향이 있는 기능과 에셋 변경을 기록한다.

## 2026-07-19

### GPT Image 에셋 통합

- GPT Image로 생성한 재료, 설비·요리, P1/P2 캐릭터 원본 시트 3장을 `public/assets/gpt-image-sources/`에 추가했다.
- 6재료 4상태 24개, 접시·완성 요리 4개, 설비 13개, 두 캐릭터 4방향 8개로 총 49개 프레임을 구성했다.
- `scripts/build_sprite_atlas.py`와 `npm run atlas:build` 명령을 추가해 원본 시트에서 WebP atlas 3장과 JSON manifest를 재현할 수 있게 했다.
- 모든 프레임을 승인된 15색 팔레트로 정규화하고 128px 셀마다 8% 이상의 투명 안전 여백을 보장했다. 최종 최소 여백은 13px, 팔레트 평균 거리는 0.00, 거리 15 이내 비율은 100%다.
- atlas를 Canvas 렌더러에 연결해 재료 종류와 RAW/PREPPED/COOKED/BURNT 상태, 접시와 완성 요리, 13개 설비, P1/P2 및 이동 방향을 시각적으로 구분할 수 있게 했다.
- `Promise.allSettled` 기반 비차단 preload를 적용했다. atlas 일부가 로드되지 않으면 해당 프레임만 기존 Canvas glyph·도형·벡터로 대체하며, `PREPPING → RAW`, `COOKING → PREPPED` 상태 매핑을 유지한다.
- 모바일에서는 중복 Canvas HUD를 숨겨 주문 카드·타임라인·경고의 겹침을 제거했고, 냉각 패널이 캐릭터와 footer를 가리지 않도록 배치를 조정했다.
- atlas 계약과 품질, 이미지 디코딩, 부분 404 fallback, 실제 게임 렌더, 1280×720·1024×768·390×844 뷰포트, 한국어·영어 UI 회귀 테스트를 추가했다.
- 최종 검증 결과: Node/WebSocket 31/31 PASS, Playwright 6/6 PASS. WebP atlas 합계는 146,266바이트다.
