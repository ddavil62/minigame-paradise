# Changelog

## [2026-06-02] - 폭탄 룰 표준화: 보너스 뒤집기 권리(기회 보존의 법칙)

폭탄 메커니즘을 **표준 한국 맞고 룰에 맞게 정정·확정**. 이전 [2026-05-31] 'drawAndResolve 2회 연속(`bombExtraDraw`)' 모델을 **`bombDeckCredit` 보너스 뒤집기 권리 모델**로 대체. 룰북 §13(레포 측 기록: `CLAUDE.md`) 갱신 — 해당 행을 새 표준 룰로 개정.

### 변경 (`game.js`)
- `g.bombDeckCredit = { p1: 0, p2: 0 }` 상태 신규 — "기회 보존의 법칙"(손 + 권리 합이 매 턴 −1로 진행, 양쪽 동기).
- `bombSteps` 정정: 폭탄 발동 = 같은 월 4장(손 3 + 바닥 1) 가져가기 + 상대 피 1장 + 통상 덱 뒤집기 1회 + **보너스 뒤집기 권리 +2**. (손 −3 + 보너스 +2 = 순 −1, 정상 1턴과 동등)
- `bonusFlipSteps(g, playerId)` generator 신규 — 자기 차례에 손 0이어도 권리가 남아 있으면 덱 1장 뒤집기(단순 매칭만, 쪽/뻑/따닥 미형성) + 고/스톱 결정 가능. 사용 시 권리 −1.
- 라운드 종료 조건 = 양쪽 모두 `손패 + bombDeckCredit` 합이 0.
- `sangtongSteps` / `bonusFlipSteps` 단계 generator를 `server.js`에 통합, `client.js` 연출·`bot.js` 대응 (커밋 `50b3ed6`).

### 비고
- 권위 룰북 파일(`2026-05-30-matgo-rulebook.md` §13)은 별도 머신에 있어 본 레포에서 직접 수정 불가. 레포 측 룰북 기록(`matgo/CLAUDE.md` §13 보강 표)을 본 표준 룰로 개정함. 데스크톱 머신의 원본 §13에도 동일 반영 필요.
- 검증: 변경 4개 JS `node --check` 통과. Playwright 러너는 matgo↔minigames 루트 playwright 중복 설치 충돌로 미실행(코드 무관 환경 이슈).

## [2026-05-31] - 룰 보강 5건 (사통/흔들기·폭탄 시점/첫뻑/폭탄 2뒤집기/floor 위치 고정)

사용자 실플레이 피드백 5건을 표준 한국 맞고 룰에 맞게 구현. 룰 로직(`game.js`, `score.js`) 3건 + UI 흐름(`public/client.js`, `public/index.html`) 2건 + 서버 라우터(`server.js`) 1건.

### 추가

#### `game.js`
- `sangtongSteps(g, playerId, choice)` 신규 export 함수 — 사통 선언/포기 처리. `choice === 'declare'` 시 `endRoundWin` 호출 + `sangtongBonus: 7` flag 전달. `choice === 'continue'` 시 `g.pendingSangtong = null`, `g.phase = 'awaiting_play'` 복귀
- `startRound` 사통 검사: 양 플레이어 손 10장 중 같은 월 4장 포함 시 `g.pendingSangtong = { player, month }` + `g.phase = 'awaiting_sangtong'`
- `g.firstPpeokBy` 신규 상태(`'p1' | 'p2' | null`) — 라운드 첫 뻑 생성자 추적. `drawAndResolve` 내 `g.ppeokFlags[month] = playerId` 직후 `if (g.firstPpeokBy === null) g.firstPpeokBy = playerId`
- `g.bombExtraDraw` 플래그 — 폭탄 후 2회차 뒤집기 대기 표시. `bombSteps`가 `drawAndResolve` 2회 연속 실행. 2회차에서 `awaiting_floor_choice` 진입 시 `chooseFloorSteps`의 `wasFromHand` 분기를 `wasFromHand || g.bombExtraDraw`로 확장
- `g.shakeAsked = { p1: false, p2: false }` — 라운드당 흔들기 모달 1회 제한

#### `score.js`
- `applyFinalMultipliers`의 `flags`에 두 신규 필드:
  - `firstPpeokBonus: boolean` — true 시 `base += 7`, reasons에 `첫뻑 +7`
  - `sangtongBonus: 7` — base 가산 7점, reasons에 `사통 +7`
- `endRoundWin`에서 `applyFinalMultipliers` 호출 시 `firstPpeokBonus: g.firstPpeokBy === winnerId` 전달

#### `server.js`
- `sangtongSteps` import 추가
- `isPauseForUserInput`에 `'awaiting_sangtong'` 추가 (사통 대기 중 봇 턴 진행 차단)
- 메시지 라우터 `SELECT_SANGTONG` 케이스 신설 — `runSteps(sangtongSteps(game, player.id, msg.choice), player)`

#### `public/index.html`
- `#sangtong-modal` 신규 모달 — 타이틀 "사통!", 선언/포기 버튼 (`#btn-sangtong-declare`, `#btn-sangtong-continue`)
- `#bomb-confirm-modal` 신규 모달 — `window.confirm` 대체 (`#btn-bomb-confirm`, `#btn-bomb-cancel`)
- 캐시 버스터: `client.js?v=13` → `v=14`

#### `public/client.js`
- 사통 모달 핸들러 — phase `awaiting_sangtong` && `pendingSangtong.player === me` 시 모달 show, 선언/포기 버튼에서 `SELECT_SANGTONG` 송신
- 흔들기 카드 클릭 시점 모달 — `sendPlay(cardId)` 진입 시 같은 월 3장 보유 + 그 월 첫 카드 + `!shakeAskedThisRound` 검사 → 모달 후 `SHAKE` → `PLAY_CARD` 송신 순서 보장
- 폭탄 카드 클릭 시점 모달 — `window.confirm` 제거, `bomb-confirm-modal` 호출
- `floorSlotMap = new Map()` — 카드 ID → 슬롯 인덱스 캐시. `renderFloor` 재구현: 신규 카드 ID에만 빈 슬롯 배정, 사라진 카드 ID 캐시 제거. `groupSlotIdx`를 그 월 첫 카드의 슬롯으로 대체
- `ROUND_START`/`GAME_START` 수신 시 `floorSlotMap.clear()` + `shakeAskedThisRound = false`
- `snapshotForPlayer`에 `pendingSangtong` 필드 추가 (본인 플레이어 차례인 경우만)

### 변경

- **`shake_decision` phase 제거** — 흔들기 결정을 서버 phase에서 클라이언트 모달로 완전 이전. `SHAKE` 메시지 타입은 유지 (페이로드 동일)
- **첫뻑 보너스 점수 모델** — 기존 `뻑 multiplier ×2^N`은 그대로(룰북 §13 해소 항목), 추가로 첫뻑한 사람이 승리하면 base에 +7. multiplier가 아닌 base 가산이라 박/고와 곱셈 누적
- **사통 점수 모델** — multiplier 없이 base 7점 가산 후 즉시 라운드 종료

### 알려진 후속 작업

- 기존 e2e `E-13/E-15/E-16` 시나리오가 `shake_decision` phase의 `/test/inject` 케이스에 의존 → 별도 수정 필요
- Playwright nested `node_modules` 충돌로 자동 회귀 미실행 (별도 인프라 이슈)
- 추가 단위 케이스(사통/첫뻑/폭탄 2턴/floor 캐시) 작성 권고

### 참고

- 목적 정의서: `.claude/specs/2026-05-31-matgo-rule-boost-scope.md`
- 스펙: `.claude/specs/2026-05-31-matgo-rule-boost-plan.md`
- Coder 리포트: `.claude/specs/2026-05-31-matgo-rule-boost-coder-report.md`
- 룰북: `C:/antigravity/.claude/specs/2026-05-30-matgo-rulebook.md` §13 (별도 머신)

---

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
