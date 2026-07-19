# 변경 이력

달빛 주방열차의 사용자 영향이 있는 기능과 에셋 변경을 기록한다.

## 2026-07-19

### 4페이지 플레이 가이드

- 첫 로비 스냅샷 뒤 한 번 자동 노출되고, 확인 상태를 `moonlightKitchenGuideSeen:v1`에 저장해 새로고침 시 반복 노출하지 않는 플레이 가이드를 추가했다.
- 로비 전용 버튼과 운행 HUD의 `? 플레이 방법` 버튼으로 언제든 다시 열 수 있게 했다. 연결·결과·종료 확인 오버레이가 보일 때는 가이드가 열리지 않도록 우선순위를 유지했다.
- 1페이지는 주문 확인부터 정차 중 배식까지의 5단계, 2페이지는 달버섯 꼬치·등불잎 만두·혜성무 국수의 실제 설비 조합, 3페이지는 열도 85 이상 P1/P2 동시 냉각, 4페이지는 WASD/방향키·`E`/`Enter`·`Space`·`Q` 조작을 안내한다.
- 제목·본문·버튼·접근성 레이블을 한국어와 영어로 제공하고, 언어를 바꿔도 현재 페이지 의미가 유지되도록 했다.
- 가이드가 열릴 때 눌린 입력을 즉시 중립화하고 이동·상호작용·작업·버리기를 차단했다. 닫힌 뒤에는 새 키 입력부터 정상 처리해 닫기에 사용한 키가 게임 행동으로 이어지지 않게 했다.
- dialog 의미 구조, Tab/Shift+Tab 포커스 트랩, Escape 닫기, 로비 opener·운행 Canvas 초점 복원, `aria-live` 페이지 알림, reduced-motion, 44px 조작 대상을 적용했다.
- 1280×720, 1024×768, 390×844의 한국어·영어 화면에서 dialog 경계, 내부 스크롤, 도움말·런처·연결 상태·HUD 간 교차 면적 0을 검증했다.
- 최종 검증 결과: Node/WebSocket 31/31 PASS, Playwright 15/15 PASS.
- 참고: 스펙 `.Codex/specs/2026-07-19-moonlight-kitchen-guide.md`, 구현 리포트 `.Codex/specs/2026-07-19-moonlight-kitchen-guide-report.md`, QA `.Codex/specs/2026-07-19-moonlight-kitchen-guide-qa.md`.

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
