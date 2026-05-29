# Changelog

## [2026-05-28] - v8 UI 시안 이식

studio-mockup의 `matgo/redesign-mockup-v8.html` 시안을 실제 게임 클라이언트에 그대로 이식. 게임 로직(server.js, game.js, cards.js, score.js, bot.js)은 일절 수정하지 않고 클라이언트 3개 파일만 전면 재작성.

### 변경

#### `public/index.html` (전면 재작성)
- 기존 `<header class="topbar">` 완전 제거
- `<main class="play-area">`를 3×3 CSS Grid로 재구성 (`6.5fr 3.5fr 270px` × `1fr 2fr 1fr`)
- 9개 섹션 배치: `opp/my × captured/hand/profile` + `floor-zone` + `meta-panel`
- 메타 패널(우측 중앙): 타이틀 "맞고", `#you-tag`, 점당 input, 새 라운드/새 게임 버튼
- `#go-stop-overlay`를 `floor-cards` 내부 절대중앙으로 이전 (REVISE1에서 신설). 기존 action-panel 내 `#go-stop-panel` 블록은 삭제
- 모달(`#round-modal`, `#kkeut-modal`), 토스트(`#toast`) 구조 ID는 그대로 보존하고 클래스만 v8 톤으로 변경

#### `public/style.css` (전면 재작성)
- `:root` CSS 변수 시스템을 카지노 다크 톤 → 한국 고스톱 담요 톤(녹색 펠트 + 골드 액센트)으로 교체
  - 신설: `--bg-deep/base/panel/card`, `--felt-mid/edge`, `--gold/gold-soft/gold-hi/gold-deep`, `--red-hot/red-deep`, `--green-go`, `--grey-soft/grey-mid`
- `.play-area` 3×3 grid 정의 + 9개 자식 섹션 위치 지정
- `.captured-zone` 내부 2×3 grid (`grid-template-columns: 4fr 6fr 10fr`)로 captured-summary + 4그룹 card-stack 배치
- `.hand-zone .hand-cards`: 5×2 슬롯 grid (`repeat(5, 1fr) × repeat(2, 1fr)`, `max-width: 320px`)
- `.floor-zone` 펠트 배경: `#1f5238` + 직조 노이즈 + vignette
- 카드 기본 크기 72×104 → **60×85**, `border-radius: 6px`, **회전 제거**
- `.card .month-tag { display: none }`, `.card .dual-badge { display: none }` — 카드 이미지에 이미 포함된 정보 중복 표시 제거
- `.card.hybrid-9` (9월 술잔): `outline: 1.5px dashed var(--gold-hi)` 점선만 유지
- `.go-stop-overlay` / `.big-go` (132×68, 26px, 적색 그라데이션) / `.big-stop` (갈색 그라데이션) / `@keyframes gostop-pulse` 1.6s 신설
- `.action-btn` 배경 하드코딩 HEX(`#4078c8`, `#22b58a`) 제거 → v8 골드 그라데이션(`linear-gradient(180deg, #b08040, #804020)` + `var(--gold)` border) 통일
- `.action-btn.bomb-btn` 적색 그라데이션(`var(--red-hot)` → `var(--red-deep)`)으로 차별화
- 기존 카지노 톤 클래스 일괄 제거: `.topbar*`, `.opp-area`, `.my-area`, `.center-area`, `.hand`, `.cards`, `.zone-label`, `.captured-grid`, `.breakdown`, `.deck-zone`, 카드 배경 컬러 클래스(`.card.gwang`, `.card.tti.hong` 등)
- `@media` 쿼리 전체 제거 (1280×800 단일 해상도 정책)
- 애니메이션 보존: `card-appear`, `card-fly-in-captured`, `flying-card`, `card-match-glow`, `action-toast`

#### `public/client.js` (부분 재작성)
- DOM 참조 교체:
  - 제거: `turnEl`, `moneyP1El`, `moneyP2El`, `oppCapturedEl`(구), `myCapturedEl`(구), `oppBreakdownEl`, `myBreakdownEl`, `lastActionEl`
  - 신설: `myMoneyEl`, `oppMoneyEl`, `myExtraEl`, `oppExtraEl`, `myBadgesEl`, `oppBadgesEl`, `bannerStatusEl`, `bannerMultiEl`, `goStopOverlay`
  - ID 변경: `perPointEl` (`per-point-input` → `per-point`), `oppCardsEl` (→ `#opp-hand-cards`), `myCardsEl` (→ `#my-hand-cards`)
- `FLOOR_SLOTS` 상수 신설: 덱 중앙 기준 R=150px / 2R=300px 허니콤 12슬롯 좌표 (내층 6 + 외층 6)
- `applyFloorSlot(el, idx)` 신설: `idx % FLOOR_SLOTS.length` 모듈러로 인덱싱, `el.style.left/top`을 `calc(50% + dx) / calc(50% + dy)` + `transform: translate(-50%, -50%)`로 설정
- `renderFloor(s)`: 기존 flex 휘저음(`margin: 8px -18px` + tilt) 방식 → `applyFloorSlot` 절대좌표 방식으로 교체. `deck-card`, `floor-mission`, `go-stop-overlay`는 보존(자식 순회 시 가드)
- `renderCaptured(pid, s)`: 단일 fan → `captured-summary` 4줄 카운트 + `captured-group × 4` (`gwang/kkeut/tti/pi`) 각각의 `.card-stack` 채우기로 교체. 임계 도달 시(`gwang ≥ 3, kkeut/tti ≥ 5, pi ≥ 10`) `.scored` 클래스 토글
- `renderOppHand/renderMyHand`: 컨테이너만 신 ID로 교체, 정렬·클릭 핸들러 동일 유지
- 신설 헬퍼: `updateProfileBadges(el, pid, s)` (흔들기/N고 뱃지), `deriveTurnText(s)`, `deriveBannerMultiplier(s)`
- `renderLastAction` 함수 호출 제거 (`#last-action` 요소 삭제됨, `action-display` + action-toast로 통합)
- `updateActionPanel`: `goStopPanel` → `goStopOverlay`로 토글 대상 일관 변경. `#btn-go`/`#btn-stop` 이벤트 리스너는 그대로 유지
- `resolvePendingFlies` 내 captured 탐색 셀렉터를 `#my-captured-zone` / `#opp-captured-zone`로 갱신

### 보존 (변경 없음)
- 서버 모듈 일체: `server.js`, `game.js`, `cards.js`, `score.js`, `bot.js`
- WebSocket 메시지 스키마: `JOINED` / `GAME_START` / `ROUND_START` / `STATE` / `ROUND_END` / `OPPONENT_LEFT` / `ERROR`
- 송신 함수 9종: `sendPlay`, `sendChooseFloor`, `sendGoStop`, `sendShake`, `sendBomb`, `sendNewRound`, `sendNewGame`, `sendPerPoint`, `sendKkeutChoice`
- 자동 재접속 (1→2→4→8초 backoff) + `pagehide` 즉시 close
- 카드 SVG/PNG 에셋 (`public/assets/cards-svg/`, `public/assets/cards/`)

### DOM ID 매핑표

| 카테고리 | 기존 | 신규 |
|---|---|---|
| 점당 input | `#per-point-input` | `#per-point` |
| 상대 손패 | `#opp-cards` | `#opp-hand-cards` |
| 내 손패 | `#my-cards` | `#my-hand-cards` |
| 잔고 | `#money-p1` / `#money-p2` | `#my-money` / `#opp-money` |
| 먹은 패 | `#opp-captured` / `#my-captured` (flat grid) | `#opp-captured-zone` / `#my-captured-zone` (2×3 grid) |
| 손장수 추가 | (없음) | `#opp-extra` / `#my-extra` |
| 뱃지 | (없음) | `#opp-badges` / `#my-badges` |
| 배너 상태/배수 | `#turn-status` / (없음) | `#banner-status` / `#banner-multiplier` |
| 고/스톱 패널 | `#go-stop-panel` (action-panel 내 소형 버튼) | `#go-stop-overlay` (floor 중앙 132×68 대형 버튼) |
| 라스트 액션 | `#last-action` | (제거, `#action-display` + action-toast로 통합) |

### 검증
- AD 모드3: 34/34 PASS (REVISE1에서 FAIL 3건 해소: floor overlay 누락 / 132×68 대형 버튼 / action-btn 하드코딩 HEX)
- QA: CONDITIONAL_PASS (수용 기준 17건 중 PASS 13 + 코드 정적 검증 N/A 4. 진입점 보존·회귀 위험 없음 확인)
- 시각 검증: 1280×800 Chromium 스크린샷 10장 (대기 / 초기 / settled / 진행 / 5수 후 / go-stop overlay / shake panel / bomb panel)

### 참고
- 시안 원본: `studio-mockup/matgo/redesign-mockup-v8.html`
- Scope: `.claude/specs/2026-05-28-matgo-v8-ui-apply-scope.md`
- Plan: `.claude/specs/2026-05-28-matgo-v8-ui-apply-plan.md`
- Coder: `.claude/specs/2026-05-28-matgo-v8-ui-apply-coder-report.md`
- Coder REVISE1: `.claude/specs/2026-05-28-matgo-v8-ui-apply-coder-revise1-report.md`
- AD 모드3: `.claude/specs/2026-05-28-matgo-v8-ui-apply-ad-mode3-report.md`
- QA: `.claude/specs/2026-05-28-matgo-v8-ui-apply-qa-report.md`
