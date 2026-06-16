# Yutnori — 변경 이력

## [2026-06-16] — 버그A 중앙 통과 자동 라우팅 + 버그B centerExitA 28/29

### 변경
- **버그A 해소 — 중앙(23) 통과 시 자동 라우팅**: 말이 중앙(23)을 잔여 steps로 **정확히 안 멈추고 통과**하면 `BRANCH_REQUEST`를 발송하지 않고 **진입 지름길 기준으로 자동 출구 라우팅**한다.
  - 지름길A 통과 → centerExitA(28/29 경유), 지름길B 통과 → centerExitB(24/25 경유). 출구 선택은 `piece.lastPath`(`shortcutA`/`shortcutB`) 기준.
  - **분기 결정(BRANCH_REQUEST/분기 모달)은 모서리(5/10)·중앙(23) 정확 착지 시에만** 무장.
  - 중앙 **정확 착지**는 기존 동작 유지: 지름길A 경유 → 다음 이동 `BRANCH center` 자유 선택 / 지름길B 경유 → 자동 centerExitB(bottom)(§13-6, 2026-06-15).
  - 중첩 분기(모서리 5/10 정확 착지 후 shortcut→중앙 통과)는 `shortcut-top`/`shortcut-bottom` 합성 경로로 piece.cell이 5/10이라 통과 자동 라우팅과 겹치지 않음(YR-C16 무영향).
  - `server.js` 수정. STATE 스키마/클라 프로토콜 무변경.
- **버그B 해소 — centerExitA 28/29 대칭 신설**: centerExitA가 centerExitB(24/25)와 거울 대칭이 되도록 중간 칸 28/29를 신설했다(이전 `23→15` 직행).
  - `server.js advanceOneCell` centerExitA: `23→28→29→15→16→17→18→19→GOAL` 잔여 steps 소진. 백도 복귀 `29→28`/`28→23`. 시작 칸 28/29 이동은 `pathContext='centerExitA'`로 잔여 소진. 28/29 칸에서 잡기/업기/백도 정상 동작.
  - `public/js/board.js`: `buildCenterExitA()`/`CENTER_EXIT_A` 좌표 신설(28=(356.67,356.67), 29=(433.33,433.33) — 중앙(23)→우하(15) 대각선 1/3·2/3 지점), 28/29 칸 렌더링·hit-test·경로선 추가. centerExitB와 x=280 수직 거울 대칭.

### 추가 (테스트)
- **신규 케이스 11건**: 중앙 통과 자동 라우팅(지름길A→centerExitA / 지름길B→centerExitB) + centerExitA 28/29 경유/잡기/업기/백도. `rulebook-c7`(중앙 분기)·`yut.unit`(computeNextCell) 등에 추가.
- **bot-smoke YBOT-004 결정적 inject 프로브 보강**: 자연 발생 카운트 대신 결정적 inject로 중앙 통과 자동 라우팅을 검증. bot-smoke 7/7 → 10/10.

### 수정 (테스트 기댓값 갱신)
- 정책 변경으로 기댓값이 바뀐 9파일 갱신(갱신 사유 파일 주석 명기): `yut.unit`, `rulebook-c2/c7/c11/c12/c13/c14/c16`, `ws.scenarios`, `qa-rulefix-edge`, `bot-smoke`.

### 회귀 결과
- **서버리스 회귀 338 passed**(이전 327 + 신규 11). **bot-smoke 10/10**(YBOT-004 결정적 프로브). **E2E 25 passed**. 중첩 분기(YR-C16) 무영향 확인.
- **QA PASS(결함 0)**, **AD3 APPROVED** — 28=(356.67,356.67)/29=(433.33,433.33), 기존 칸과 겹침 0.

### 룰북 §13
- §13-2(centerExitA 28/29 대칭 신설)·§13-6(중앙 통과 자동 라우팅) 보강. 구현 vs 표준 차이 12건: 미해소 4 + 해소 8 유지.

## [2026-06-15] — §13-6 지름길B 중앙 자동 라우팅 + §13-5 첫칸 빽도 워프

### 변경
- **§13-6 해소 — 지름길B 경유 중앙 정착 시 자동 centerExitB(bottom)**: 지름길B(우상 10→26→27→23) 경유로 중앙(23)에 정확히 정착한 말은 다음 이동 시 `BRANCH_REQUEST` 없이 자동으로 좌하 출구(centerExitB, bottom)로 라우팅한다.
  - `server.js computeNextCell` 반환에 `finalPath` 필드 추가, `movePiece`가 이를 `piece.lastPath`에 저장(서버 내부 필드).
  - MOVE_PIECE 자동 조건: **`piece.cell === 23 && piece.lastPath === 'shortcutB'`**. 이 조건에서만 자동 bottom 발동.
  - 지름길A 경유 중앙 정착은 기존 자유 선택(`BRANCH_REQUEST center` + `CHOOSE_PATH top/bottom`) 유지.
  - 중첩 분기(cell 5/10에서 shortcut 후 중앙 통과)는 `awaitingBranch=true`로 center 재무장 경로로 빠지며 piece.cell이 5/10이라 자동 조건과 겹치지 않음(YR-C16 무영향).
  - **STATE 스키마 무변경**: `piece.lastPath`는 broadcastState 직렬화 목록에 추가하지 않음 → 클라이언트/봇 무영향.
- **§13-5 해소 — 첫칸 빽도 워프**: `computeNextCell` `steps === -1` 분기에서 cell 1 → 외곽 마지막 칸 cell 19(참먹이) 워프, cell 19 → cell 1 복귀. `toCell=19`는 GOAL이 아니므로 `done=false` 유지.
  - cell 1↔19 특례를 외곽 범용 후퇴(`fromCell-1`) **앞에** 배치하고, 범용 범위를 `1~19`에서 `2~18`로 좁혀 언더플로우/오후퇴 방지.
  - HOME 말 빽도 자동 폐기·cell 0 빽도→0 정책은 기존 유지.

### 추가 (테스트)
- **신규 케이스**: 지름길B 경유 중앙 자동 bottom / 지름길A 경유 선택 유지 / cell 1↔19 양방향 워프 / 워프 후 완주 흐름. `rulebook-c5`(빽도)·`rulebook-c7`(분기)·`yut.unit`(computeNextCell)에 추가.
- **정책 변경 갱신**: YR-C7-008(지름길B 자동) / YR-C5-001(cell 1→19 워프) / YR-C3 capture(cell 2→1 잡기로 우회) 기댓값을 권위 룰로 갱신(변경 사유 파일 주석 명기).

### 회귀 결과
- **서버리스 회귀 327 passed**(이전 321 + 신규 6). 봇 스모크 **7/7 PASS**(포트 3104). 중첩 분기(YR-C16) 무영향 확인.

### 권위 근거
- 권위 룰 가이드 `docs/2026-06-15-yutnori-rule-research.md` C3/B6/B7 항목(§13-5 워프, §13-6 진입 경로별 출구).

### 룰북 §13 카운트
- 구현 vs 표준 차이 12건: 미해소 4 + 해소 8 (§13-5/§13-6 해소 추가). 직전 미해소 6 / 해소 6.

### 참고
- 스펙: `.claude/specs/2026-06-15-yutnori-center-backdo-standard-spec.md`
- 연구 보고서: `docs/2026-06-15-yutnori-rule-research.md`

## [2026-06-15] — §13-12 윷·모 잡기 중복 보너스 차단

### 변경
- **`server.js` MOVE_PIECE(~972)·CHOOSE_PATH(~1066) capturedBonus 부여 가드 추가** (§13-12 [LOW] 해소): 잡기 보너스를 부여하기 직전 사용 결과(`useResult`)가 윷/모이면 `game.capturedBonus = true`를 건너뛴다. 가드식 `if (moveRes.captured && useResult !== 'yut' && useResult !== 'mo')`.
  - **MOVE_PIECE**: `useResult`는 큐 검증값(`msg.useResult` → `pendingResults.indexOf`로 존재 검증, L923/929-933).
  - **CHOOSE_PATH**: `useResult = game.awaitingBranchResult` (분기 대기 진입 시 MOVE_PIECE에서 세팅, L1011).
  - 윷·모로 잡아도 잡기 보너스 미부여(윷/모 자체 보너스와 중복 차단, 한 행위 최대 1회). **도/개/걸 잡기는 capturedBonus +1 유지**.
  - 한국어 주석(§6-1/§13-12) 추가. §13-11(FIX-4) THROW_YUT 소진 로직(`enteredViaCapturedBonus`)은 미수정 — 무충돌 확인.
- **권위 근거**: Gemini Deep Research 권위 룰 가이드(`docs/2026-06-15-yutnori-rule-research.md` E3 항목) + 한국어 위키. 윷·모 자체 보너스와 잡기 보너스는 한 번만 발생하는 것이 정통.

### 추가
- **`tests/rulebook-c19-capture-bonus-no-stack.spec.js` 신규** (YR-C19-001~006, 6건): (a) 윷 잡기 시 capturedBonus 미부여 (b) 모 잡기 시 미부여 (c) 도/개/걸 잡기 시 부여 유지 (d) 결과 사용 순서 무관성. corner 미경유 직선 잡기로 가드 자체를 격리 검증.
- **연구 보고서 보존**: `docs/2026-06-15-yutnori-rule-research.md` — Gemini Deep Research 권위 룰 가이드. 향후 룰 정합 판단의 표준 기준으로 보존.

### 수정 (테스트 기댓값 갱신)
- **`tests/rulebook-c8-bonus.spec.js` YR-C8-009**: 기존에는 구버그(윷/모 잡기 시 중복 보너스 발생)를 단언하고 있었다 → 해소 룰(중복 차단)에 맞춰 기댓값 갱신. 변경 사유 파일 주석 명기. (신규 케이스 아님 — 기존 케이스의 기댓값 정정)

### 회귀 결과
- **서버리스 회귀 321/321 PASS** (이전 315 + 신규 YR-C19 6건. YR-C8-009는 갱신이므로 순증가 6). 최초 실행 시 YR-C8-009 1건이 구버그 기댓값으로 FAIL → 해소 룰로 갱신 후 321/321.
- **신규 YR-C19 단독 6/6 PASS** (2.2s).
- **봇 스모크 7/7 PASS** (포트 3104). YBOT-005에서 capturedBonus=true STATE는 do/gae/geol 잡기로 정상 부여 — 가드 영향 없음 확인.
- §13-11 회귀(YR-C18-001~004 FIX-4 + qa-defect2 QA-D2 데드락 가드) 전부 PASS 유지 → capturedBonus 라이프사이클 정합 확인.
- 레거시 smoke(시나리오 1~8): capturedBonus 스태킹 미검증 스코프 + 8b WS 분포 샘플러 환경 의존 장기 실행으로 요약 라인 미회수(핵심 게이트가 capture/bonus/turn-pass를 전수 커버).

### 룰북 §13 카운트
- 구현 vs 표준 차이 12건: 미해소 6 + 해소 6 (§13-1/§13-2/§13-9/§13-10/§13-11/§13-12 해소). 직전 해소 5 → 6.

### 참고
- 목적 정의서: `.claude/specs/2026-06-15-yutnori-bonus-stack-fix-scope.md`
- 구현 리포트: `.claude/specs/2026-06-15-yutnori-bonus-stack-fix-report.md`
- 연구 보고서: `docs/2026-06-15-yutnori-rule-research.md`

## AI Bot — AI 봇 추가 (2026-06-12)

### 추가
- **`bot.js` 신규** — STATE 기반 상태 머신 봇. matgo/janggi/yahtzee/rummikub와 동일한 `getBotUrl` + `child_process.spawn` 패턴. 강한 AI가 아니라 던지기 → 말 이동 → 분기 선택 → 잡기 보너스 → 완주 → 재대결 전 흐름을 데드락 없이 완주하는 테스트용 봇.
  - **STATE만 입력으로 받는 순수 상태 머신** (YUT_RESULT/BRANCH_REQUEST는 정보성으로 무시, 결정은 STATE 기반).
  - `__isMain` 가드(테스트 import 시 WS 연결 생략) + `choosePiece` 테스트 export + `actionEpoch` 액션 체인 취소(rummikub 패턴).
  - 행동 지연 환경변수 `YUTNORI_BOT_DELAY_MIN/RAND`(기본 300~800ms, 테스트는 단축).
  - `actTurn` 상태 머신(우선순위 순): ① `awaitingBranchAt!==null` → CHOOSE_PATH **최우선**(턴 잠금 방지, corner=30% shortcut/70% outer, center=50:50 top/bottom) ② `pendingResults.length>0` → `choosePiece` 그리디 말 선택 후 MOVE_PIECE ③ 큐 빈 상태 → THROW_YUT(첫 던지기 또는 capturedBonus 진입).
  - `choosePiece` 그리디: `done` 제외 + 백도는 HOME(-1) 말 제외, cell 내림차순(GOAL=99 최근접 우선, HOME=-1은 -2 취급), 동률이면 인덱스 오름차순.
  - 에러 처리: ERROR(방 가득) → `ws.close()`, 그 외 ERROR → `lastActedFor=null` + `actionEpoch+=1` + 타이머 클리어 후 다음 STATE 재시도. GAME_OVER → 500ms 후 REMATCH 자동 송신. 서버 로직(`computeNextCell` 등) 재구현 안 함(스펙 Out of Scope).
- **`tests/bot-smoke.test.js` 신규** (ad-hoc 노드 러너, 포트 3104) — YBOT-001(봇 vs 봇 1판 완주) / YBOT-002(3판 연속 REMATCH 완주, 잠금 0) / YBOT-003(corner 분기 응답) / YBOT-004(center 분기 응답) / YBOT-005(capturedBonus THROW). **인라인 봇(테스트가 직접 운전 + 분기/보너스 카운트 집계) vs 서버 spawn한 실제 `bot.js` 자식 프로세스** 혼합 방식으로 `mode=ai → spawnBotChild → mode=bot` 실제 spawn 경로까지 검증. YBOT-003/004/005는 3판 누적(YBOT-002) 동안의 자연 발생 카운트(≥1)로 판정.
- **클라 진입점**: `public/index.html` `#ai-panel`(`또는` 구분선 + `#btn-start-ai` "🤖 AI랑 시작" + ai-hint, ready-btn 아래) / `public/css/style.css` `.ai-panel` 절대 배치(`top: calc(50% + 44px)`) + `.ai-divider`/`.btn-start-ai`/`.ai-hint`(CSS 변수 `--accent`/`--text`/`--panel-border`) / `public/js/main.js` `aiPanelEl`·`btnStartAiEl` 등록 + onJoined 노출 조건(p1+waiting+mode≠ai) + onStart/onRematchStatus 숨김 + btnStartAi 클릭 시 `?mode=ai` 재진입.

### 변경
- **`server.js`** — `createApp` opts에 `getBotUrl` 옵션 추가 + `spawnBotChild`/`killBotChild` 봇 자식 프로세스 관리. `wss.on('connection', (ws, req))`에서 URL 쿼리 `mode` 파싱(ai/bot/human): `mode=ai`로 혼자 입장 시 `spawnBotChild`(URL `?mode=bot`), 사람(`mode=ai`) close 시 `killBotChild`. standalone 진입점 `listeningPort` 연동(`getBotUrl: () => ws://localhost:${listeningPort}/ws?mode=bot`). `child_process`/`fs` import 추가.
- **`server.js` STATE에 `capturedBonus` 필드 추가 (후방 호환)** — 봇이 자체 추적 없이 던지기 가능 여부를 STATE에서 직접 판단하도록 broadcast 페이로드에 노출. 기존 클라이언트는 무시하므로 후방 호환.
- **`public/js/network.js`** — WS URL에 `?mode=` 쿼리 부착 + 새로고침 유실 대비 `sessionStorage('yutnori:mode')` 백업(matgo/rummikub 동일 패턴).
- **`launcher/server.js`** — `createYutnoriApp({ getBotUrl: () => ws://localhost:${PORT}/yutnori/ws?mode=bot })` 주입.
- **`launcher/public/games.json`** — yutnori `botAvailable: false → true`(런처 1/2 AI 모드에서 윷놀이 카드 활성).

### 수정 (Bugfix)
- **간헐 데드락 (HIGH)** — 구현 직후 bot-smoke가 간헐적으로 `gameOvers=0`(전 항목 데드락)으로 실패. 원인: 봇 중복 행동 방지 키가 `${currentTurn}|${pendingResults}|${awaitingBranchAt}|${capturedBonus}` 형태였는데, **중첩 분기**(모서리 5/10에서 shortcut 선택 후 잔여 steps가 중앙 23을 통과)가 발생하면 서버가 1차 CHOOSE_PATH를 큐 차감 없이 처리하고 `awaitingBranchAt`(pieceIndex)·큐·`capturedBonus`를 전부 그대로 둔 채 `awaitingBranchType`만 `corner→center`로 바꿔 STATE를 재발송(center 재무장). 키 구성 요소가 전부 동일해 키가 변하지 않으니 봇이 2차 center 분기를 "이미 처리한 상태"로 무시 → **영구 턴 잠금**. 봇이 corner에서 shortcut을 고르고 잔여 steps가 정확히 중앙을 통과할 때만 발생하는 확률적·간헐적 재현.
  - 수정: 중복 방지 키에 `awaitingBranchType` 추가. `bot.js`(:169)와 `bot-smoke.test.js` 인라인 봇(:120) 양쪽에 동일 적용, 두 곳 모두 주석으로 원인 명기. 키 추가 전 간헐 실패 → 추가 후 4회 연속 7/7 PASS로 재현 불가 확인.

### 회귀 결과
- **bot-smoke (YBOT-001~005, 포트 3104): 키 수정 후 4회 연속 7/7 PASS** (3판 연속 REMATCH 완주 + corner/center 분기 응답 + capturedBonus 던지기, 데드락 0).
- **서버리스 회귀 289 + QA 엣지 26 = 315/315 PASS** 유지 — server.js `capturedBonus` 필드 추가(후방 호환) + connection 핸들러 `(ws, req)` 변경 후에도 회귀 유지.
- **E2E 25/25 PASS** 유지(포트 3088).
- legacy smoke 기능 구간 36 assert PASS(0 FAIL).
- AD 모드3 APPROVED (`2026-06-12-yutnori-bot-ad3-review.md`). QA PASS(결함 0).

### 스펙 대비 차이 (합당한 사유)
- bot-smoke 구현 방식: 스펙 의사코드는 두 인라인 봇 또는 bot.js spawn 중 택일을 제시했으나, **인라인 봇(테스트 운전, 분기/보너스 카운트 집계) vs 서버 spawn한 실제 bot.js 자식 프로세스** 혼합 방식으로 구현 — `mode=ai → spawnBotChild → mode=bot` 실제 spawn 경로를 함께 검증하기 위함.
- YBOT-003/004/005는 별도 `/test/inject` 강제 주입 대신 3판 누적(YBOT-002) 동안의 자연 발생 카운트(≥1)로 판정 — 스펙에 명시된 허용 방식.

### 알려진 이슈 (Out of Scope)
- 고급 전략 AI / 난이도 선택 / 관전 모드 / §13-12 윷·모 잡기 중복 보너스 차단(별도 발주) — 본 작업 범위 아님.

### 참고
- 스펙: `.claude/specs/2026-06-12-yutnori-bot-spec.md`
- 구현 리포트: `.claude/specs/2026-06-12-yutnori-bot-impl-report.md`
- AD3 검수: `.claude/specs/2026-06-12-yutnori-bot-ad3-review.md` (APPROVED)

## Rule Fixes — 룰 정합 수정 FIX-1~4 + 중첩 분기 수정 (2026-06-11)

### 추가
- **FIX-2 모서리(5/10) 외곽/지름길 선택 분기** (§13-1 [HIGH] 해소): 모서리에 정확히 멈춘 다음 이동 시 자동 지름길 진입을 폐기하고 외곽 계속/지름길 진입 선택 모달을 표시.
  - `server.js`: `computeNextCell`이 `branchChoice=null`이면 `awaitingBranch=true` 반환(강제 지름길 제거), `'shortcut'`→지름길 / `'outer'`→외곽. `movePiece`가 모서리 출발 시도 awaitingBranch 반환. MOVE_PIECE 핸들러가 piece.cell 5/10 → `awaitingBranchType='corner'` 판별 후 `BRANCH_REQUEST { branchType }` broadcast.
- **FIX-3 centerExitB 24/25 경유 완주** (§13-2 [HIGH] 해소): 중앙→좌하 출구를 즉시 GOAL에서 `23→24→25→GOAL` 잔여 steps 소진으로 변경.
  - `server.js`: `advanceOneCell` centerExitB 잔여 소진, 백도 복귀 `25→24`/`24→23` 추가, `computeNextCell`이 cell 24/25 출발 시 centerExitB 컨텍스트 잔여 소진.
  - `board.js`: `buildCenterExitB()`/`CENTER_EXIT_B` 좌표 신설, 24/25 칸 렌더링·hit-test·경로선 추가(이전 미사용 인덱스 활성화).
- **중첩 분기 (shortcut-top/bottom 합성)**: 모서리 지름길 진입 이동이 중앙(23)을 잔여 steps 있이 통과할 때 윷/모 결과가 증발하고 말이 제자리에 남던 HIGH 버그 수정.
  - `server.js`: `isShortcutChoice`/`isBottomExit` 헬퍼 신규. `computeNextCell`이 복합값 `shortcut-top`/`shortcut-bottom` 지원(모서리 지름길 판정 + 중앙 출구 결정, 복합값은 중앙 재대기 없이 출구까지 즉시 진행). CHOOSE_PATH 핸들러가 `moveRes.awaitingBranch===true` 시 큐 미차감 + `awaitingBranchType='center'` 재무장(BRANCH_REQUEST center 재발송) 후 break → 2차 CHOOSE_PATH에서 piece.cell이 5/10이고 choice가 top/bottom이면 `shortcut-` 접두 합성(서버 내부 전용). 신규 상태 필드 없이 cell 기반 판별.
  - `main.js`: `onState`가 매 STATE의 `awaitingBranchType`로 `ui.showBranchModal(true, type)` 재호출 → corner→center 모달 연속 전환 자동 갱신(기존 코드, 수정 불필요 — 동작 확인만).
  - 검증값: `(5,4,'shortcut')`→awaiting / `(5,4,'shortcut-top')`→15 / `(5,5,'shortcut-top')`→16 / `(5,4,'shortcut-bottom')`→24 / `(10,4,'shortcut-bottom')`→24 / `(10,5,'shortcut-bottom')`→25 / `(5,3,'shortcut')`→23 정착.
- **§13-12 [LOW] 신규 등록 (미해소)**: §6-1 윷·모로 잡았을 때 잡기 보너스와 윷/모 보너스가 둘 다 발생 가능(정통은 한 번만). 의도적 미구현, 별도 발주 예정.
- **신규 테스트 파일**:
  - `tests/qa-rulefix-edge.spec.js`: FIX-1~4 + 중첩 분기 QA 엣지 26건(QA-RF1/2/3/4/X). 분기 대기 중 disconnect, 24/25 잡기/업기/완주, capturedBonus 보존/소진 경계, 중첩 분기 비정상 입력 방어 등 능동 도출.
  - 룰북 신규 spec: `rulebook-c15` 재입장 / `c16` 모서리 분기(YR-C16-010/011 중첩 분기 2건 포함) / `c17` centerExitB / `c18` 보너스 정밀화.
  - `tests/yut.unit.spec.js` §9 섹션 U-66~U-72 7건 추가(복합 분기 단위 검증).

### 변경
- **FIX-1 재입장 ID 중복 데드락 수정** (`server.js` connection 핸들러): ID 배정을 `players.length` 기반에서 미사용 ID 탐색(`usedIds = new Set(players.map(p=>p.id))` → `!usedIds.has('p1') ? 'p1' : 'p2'`)으로 변경. p1 disconnect 후 재접속 시 p2 중복 배정으로 게임이 잠기던 데드락 해소.
- **FIX-4 capturedBonus 소진 조건 정밀화** (`server.js` THROW_YUT 핸들러): 잡기 보너스 권리를 무조건 소진하던 것을 **큐가 비어 capturedBonus로 진입한 던지기에서만 1회 소진**(`enteredViaCapturedBonus = pendingResults.length === 0 && capturedBonus === true`)으로 한정. 큐에 yut/mo 잔여 시 보존. 잡기 후 보너스 결과가 yut/mo가 아닐 때 윷·모 보너스 진입 던지기에서 잡기 보너스 권리를 부당하게 잃던 문제 방지.
- **WS 프로토콜 확장**: `BRANCH_REQUEST`에 `branchType: 'center'|'corner'` 추가, `CHOOSE_PATH`의 `pathChoice` 값 확장(중앙 `top/bottom` + 모서리 `outer/shortcut`, 합성값 `shortcut-top/shortcut-bottom`은 서버 내부 전용), `STATE`에 `awaitingBranchType` 필드 추가(broadcast + inject).
- **기존 테스트 기댓값 갱신** (정통 룰로 기댓값이 바뀐 경우만, 갱신 사유 파일 주석 명기):
  - `rulebook-c12-unresolved.spec.js`: §13-1/§13-2를 RESOLVED로 갱신(YR-C12-001 분기 대기, YR-C12-002 24/25 경유, YR-C12-006 shortcut 명시 + bottom 첫 칸 24).
  - `rulebook-c6-corner.spec.js`(YR-C6): 강제 지름길 기댓값 → 분기 대기/명시 shortcut.
  - `rulebook-c7-center.spec.js`(YR-C7): centerExitB 즉시 GOAL → 24/25 경유.
  - `rulebook-c2-movement.spec.js`: 모서리 통과/진입 동선.
  - `yut.unit.spec.js`(U-33~U-52 등): shortcut 명시 + centerExitB 24 기댓값.
  - `qa-defect2-captured-bonus-stuck.spec.js`: piece 배치 5→1 이동(모서리 분기로 흐름 변질 방지) + 기댓값 갱신(QA-D2-001 turn 보존 p1, QA-D2-002 큐 빈 진입 THROW 소진).
  - `smoke.test.js`: 모서리 분기 대기 + shortcut 진입 보조 assert 추가(풀 실행 시 40 assert).

### 회귀 결과
- **서버리스 회귀 289 + QA 엣지 26 = 315/315 PASS** (0 FAIL). 기준 280 → 신규 9건(유닛 7 + WS 2) 추가로 289, QA 엣지 26 추가로 315.
  - 내역: yut.unit 72 + ws.scenarios 20 + rulebook-c* 194 + qa-defect2 3 + qa-rulefix-edge 26.
- E2E `e2e-scenarios.spec.js` 25/25는 서버(`node server.js --port 3088`) 가동 시 별도 회귀.
- smoke: 시나리오 1~8 36 assert PASS(+모서리 분기 보조 assert, 풀 실행 40). 8b "참고용" WS 샘플러는 환경 의존 장기 실행으로 기능 무관.
- QA 발견 결함 0건. LOW 등급 정책/방어 관찰 3건 비차단 기록.
- AD 모드3 APPROVED (FAIL 0).

### 알려진 이슈 (Out of Scope)
- §13-12 [LOW] §6-1 윷·모 잡기 중복 보너스 차단 미구현 — 별도 발주 예정.
- `ws.scenarios.spec.js` W-10(백도 폐기)는 백도가 나올 때까지 THROW 반복 구조라 환경 타이밍에 따라 드물게 flake. FIX-1~4와 무관, 재실행 시 안정 PASS.
- smoke 8b "참고용" WS 분포 샘플러는 환경 의존 장기 실행/행. 의미 assert는 전부 시나리오 1~8에 있고 PASS.

### 참고
- 스펙: `.claude/specs/2026-06-11-yutnori-rule-fixes-spec.md`, `-scope.md`
- 구현 리포트: `.claude/specs/2026-06-11-yutnori-rule-fixes-impl-report.md`
- QA 리포트: `.claude/specs/2026-06-11-yutnori-rule-fixes-qa-report.md`

## Rulebook Tests — 룰북 기반 168 시나리오 + 결함 5건 수정 (2026-05-31)

### 추가
- **룰북 기반 Playwright 시나리오 168개 신규 작성** (`tests/rulebook-c1~c14-*.spec.js`, 14개 spec 파일).
  - ID 체계: `YR-C{1~14}-{NNN}`. 기존 `U-/W-/E-`와 충돌 없음.
  - 각 `test()`에 룰북 §번호 인용 + Given/When/Then 한국어 주석.
  - 카테고리: C1 윷가락 30 / C2 이동 15 / C3 잡기 10 / C4 업기 10 / C5 백도 10 / C6 모서리 분기 10 / C7 중앙 분기 10 / C8 보너스 10 / C9 턴 전환 10 / C10 승리 5 / C11 WS 프로토콜 15 / C12 §13 미해소 정책 PASS 8 / C13 §13 해소 회귀 가드 10 / C14 엣지케이스 15.
- **공용 헬퍼 `tests/rulebook-helpers.js`** 신규: `WsClient`, `withRandom`, `startServer`, `stopServer`, `connectWs`, `setupGame`, `inject`, `injectAndDrain`, `placePieces`, `forceResults` 9개 export.
- 룰북 §13 11건 100% 커버: §13-1/2 정책 PASS (C6/C7/C12), §13-3/4/5/6/7/8 정책 PASS (C1/C2/C5/C7/C9/C12), §13-9/10/11 회귀 가드 (C2/C13).

### 변경
- `tests/yut.unit.spec.js` U-18~U-22 5건 기댓값 갱신: §13-10 해소(HOME → 칸 N 정통 매핑) 이전 단순화 기댓값(HOME + do → cell 0 등)이 잔존하여 사전 FAIL 상태였음. YR-C2-001~005 / YR-C13-001~004와 동일 매핑으로 통일. `yut.unit` 65/65 PASS 회복.

### 수정 (Bugfix)
- **`server.js` THROW_YUT 핸들러 capturedBonus 잔류 [HIGH 결함]**: 잡기 직후 보너스 THROW로 do/gae/geol/backdo가 나오면 `capturedBonus=true`가 잔류하여 MOVE 후에도 `hasBonus`가 계속 true → `passTurn`이 진입되지 않아 턴이 영원히 안 넘어가던 결정적 잠금 버그. 발생 확률: 잡기 후 87.5%. 결과 큐 push 직후 `capturedBonus = false`로 1회 소진 리셋 추가. (QA-D2-001/002 회귀 가드)
- **`server.js` MOVE_PIECE 핸들러 capturedBonus 리셋 시점 보강**: 잡기 발생 분기에서 `passTurn` 진입 전 `capturedBonus` 일관성 보장.
- **`server.js` `resetGame()` / `softResetRoom()` capturedBonus 명시 초기화**: 기존에 미초기화되어 첫 액세스 시 undefined. REMATCH 경계에서 잔류 가능성 차단. `game = { ..., capturedBonus: false }` 추가.
- **YR-C5-008 (HOME 백도 자동 폐기) flaky 안정화**: backdo 시도 한도 50회 → 100회 상향으로 이론적 fail 확률 4.07% → 0.16%로 감소.
- **YR-C8-008 (백도 보너스 없음) flaky 안정화**: WS race condition 완화 (drain 순서 보강).

### 회귀 결과
- **253/253 PASS** (5.2초): 신규 168 + 기존 yut.unit 65 + ws.scenarios 20. 5회 반복 안정성 0 flaky.
- E2E 25개는 서버 가동 시 별도 회귀.

### 알려진 이슈 (Out of Scope)
- §13-1 / §13-2 (HIGH 미해소) 정통 룰 정합 발주는 본 작업 범위 밖. C6/C7/C12에서 정책 PASS로 검증만 유지.
- Windows libuv `UV_HANDLE_CLOSING` 콘솔 경고. 테스트 결과 자체에는 영향 없음. Node 22.x 업그레이드 시 자연 해결 가능성.

### 참고
- 목적 정의서: `.claude/specs/2026-05-31-yutnori-rulebook-tests-scope.md`
- 스펙: `.claude/specs/2026-05-31-yutnori-rulebook-tests-plan.md`
- Coder 리포트: `.claude/specs/2026-05-31-yutnori-rulebook-tests-coder-report.md`
- Coder Revise 리포트: `.claude/specs/2026-05-31-yutnori-rulebook-tests-coder-revise-report.md`
- QA 리포트: `.claude/specs/2026-05-31-yutnori-rulebook-tests-qa-report.md`
- Doc Writer 리포트: `.claude/specs/2026-05-31-yutnori-rulebook-tests-doc-writer-report.md`

## Rulebook — 한국 표준 룰북 작성 (2026-05-31)

### 추가
- **`docs/RULEBOOK.md` 신규 작성** (635줄, §1~§13 + 부록).
  - matgo/janggi와 동일한 13섹션 패턴 채택.
  - 출처 29회 인용: 한국어 위키백과 「윷놀이」, 영문 Wikipedia 「Yunnori」, 한국민속대백과사전, 나무위키.
  - 섹션 구성:
    - §1 게임 개요 / §2 말판 + ASCII 다이어그램 / §3 윷가락 결과 표 (실측 5,000회 분포 포함)
    - §4 말 / §5 이동 규칙 + 칸 수 표 / §6 보너스 / §7 잡기 / §8 업기
    - §9 백도 / §10 분기점(모서리/중앙) / §11 승리 / §12 QA 체크리스트 (8 카테고리)
    - §13 구현 노트 (구현 vs 표준 차이) + 부록 WebSocket 프로토콜
- **§13 구현 vs 표준 차이 8건** (영향도 라벨):
  - **§13-1 [HIGH]** 모서리(5/10) 강제 지름길 진입 — 정통은 외곽/지름길 선택. 사용자 의심 후보 **1순위**.
  - **§13-2 [HIGH]** centerExitB 즉시 완주 — 중앙→좌하 진행 시 남은 steps 무관 즉시 GOAL. 사용자 의심 후보 **2순위**.
  - §13-3 [LOW] 윷가락 확률 균등 50% (의도된 디지털 단순화).
  - §13-4 [MED] 윷가락 매핑 회귀 위험 (Phase 2→2.1 이력, 현재 해소).
  - §13-5 [LOW] HOME 백도 자동 폐기 (의도된 단순화).
  - §13-6 [LOW] 중앙 분기 양방향 자유 선택 (표준에 모호).
  - §13-7 [LOW] 선후공 결정 절차 생략 (p1 고정).
  - §13-8 [LOW] 외곽 인덱스 20/24/25/28 미사용 (단순화).
- 사용자가 보고한 "뭔가 많이 이상해"의 원인 후보 3건 (§13-1 / §13-2 / §13-4) 명시.

### 변경
- `README.md`: "룰 기준 문서" 섹션 추가. 룰북 링크 + §13 HIGH 2건 강조.
- `CLAUDE.md`: "룰북 (필수 숙지)" 섹션 추가. "변경 시 자주 깨지는 함정"에 §13 매핑 8건 요약표 추가.

### 참고
- 목적 정의서: `.claude/specs/2026-05-31-yutnori-rulebook-scope.md`
- 스펙: `.claude/specs/2026-05-31-yutnori-rulebook-plan.md`
- Doc Writer 리포트: `.claude/specs/2026-05-31-yutnori-rulebook-doc-writer-report.md`

## Phase 2.1 — 윷가락 매핑 재정정 (2026-05-25, 긴급 핫픽스)

### 정정 (Bugfix)
- Phase 2가 "정정"이라고 적용한 매핑(`fronts=0→윷, 1→걸, 2→개, 3→도/백도, 4→모`)이 **사실은 정통 룰의 반대 방향**이었음. 사용자 플레이 중 "개가 나왔는데 1칸만 간다"는 직관 불일치로 발견.
- 한국 표준 윷놀이 정통 룰로 재정정: **평평면 개수(fronts) = 이동 칸 수** (도=1, 개=2, 걸=3, 윷=4). 모만 예외(fronts=0 → 5칸).
  - 새 매핑: `fronts=0→모, 1→도/백도, 2→개, 3→걸, 4→윷`.
  - 백도 조건도 함께 이동: `fronts=3 + sticks[MARKED]=0` → `fronts=1 + sticks[MARKED]=1` (도가 나왔는데 그 1개 평평면이 마크 가락이면 백도). 전체 확률은 1/16로 동일.
- README의 윷가락 표(앞/뒤) 재정정.

### 테스트
- `tests/smoke.test.js` 시나리오 8/8b의 백도·도 sticks 일관성 검증을 새 매핑(`fronts==1`, `sticks[markedIndex]==1=백도 / ==0=도`)으로 갱신.
- 5000회 분포 실측: backdo 6.16%, do 18.68%, gae 37.40%, geol 24.62%, yut 6.86%, mo 6.28% (이론값 6.25/18.75/37.5/25/6.25/6.25%와 일치).
- 전체: **40/40 PASS** 유지.

## Phase 2 — 백도 + 룰 매핑 정정 (2026-05-25)

### 추가
- **백도(빽도)** 추가: 4개 윷가락 중 0번 가락에 빨간 X 마크. 마크 가락만 단독으로 뒷면(=뒤집힘)일 때 발동.
  - 이동: -1칸 (출발한 말만 1칸 뒤로). HOME 말엔 사용 불가 → 서버 자동 폐기.
  - 보너스 턴 없음 (윷/모만 보너스).
  - 백도 후 출발선(0)에서는 더 못 감 → 그대로 유지.
  - 지름길 안에서 백도 → 진입 모서리로 복귀 (21→5, 22→21, 26→10, 27→26, 23→22).
  - 확률: 1/16 = 약 6.25% (단위 5000회 검증, 실측 5~7% 범위).
- 백도 결과 시각: 결과 큐 칩 + 결과 라벨 빨간색 강조 + 윷가락 마크 가락에 빨간 X 표식 (`yut-backdo` CSS 변수).
- `YUT_RESULT` 메시지에 `markedIndex` (마크 가락 인덱스), `discarded` (자동 폐기 여부) 필드 추가.

### 정정 (Bugfix)
- `throwYutSticks` 결과 매핑이 정통 룰과 어긋남(`fronts=1 → 도`)이라 백도가 영원히 발동하지 않던 버그 수정.
  - 정통 룰 매핑으로 일관성 통일: fronts=0→윷, 1→걸, 2→개, 3→도/백도, 4→모.
  - (`sticks[i]=1`이 앞면이라는 시각화 컨벤션은 그대로 유지.)
- README의 윷가락 표(앞/뒤) 정정.

### 테스트
- `tests/smoke.test.js` 시나리오 7~9 추가:
  - 7: `YUT_RESULT.markedIndex` 존재/범위 검증
  - 8: `throwYutSticks` 5000회 단위 분포 + `computeNextCell` 백도/지름길 진입 6+3 케이스
  - 8b: WS 통합 분포 sanity (마크 일관성)
  - 9: HOME 말에 백도 시도 시 ERROR 반환
- 기존 시나리오 3, 4: 첫 던지기에 백도가 나오면 자동 폐기되어 STATE에 안 들어가는 케이스 대응 — `throwUntilNonBackdo()` 헬퍼로 일반 결과 확보. (시나리오 의미는 유지)
- 결과: **40/40 PASS** (기존 18개 → 40개 확장).

## Phase 1 — MVP (2026-05-25)

신규 프로젝트. 사용자가 친구와 즉시 플레이 가능하도록 30~60분 안에 완성.

### 추가
- `server.js`: 서버 권위 게임 로직 + WebSocket 라우터 + ANSI 콘솔 박스 + LAN IP 자동 감지 + 포트 폴백.
- `public/index.html`, `public/css/style.css`: 한국 전통 보드 톤 (한지/먹/주황) UI.
- `public/js/main.js`: 진입점 (UI ↔ Network ↔ Game 와이어업).
- `public/js/network.js`: WebSocket 클라이언트 (JOIN/READY/THROW_YUT/MOVE_PIECE/CHOOSE_PATH/REMATCH 송수신).
- `public/js/game.js`: STATE 캐시 + `canThrow()`, `isMyTurn()` 등 검증 헬퍼.
- `public/js/board.js`: 칸 인덱스(0~19 외곽, 21/22/26/27 지름길, 23 중앙) → 캔버스 좌표 매핑. `hitTestCell()` 클릭 판정.
- `public/js/yut.js`: 윷 결과명/한글 매핑 + Canvas로 가락 4개 렌더링 (앞면=베이지, 뒷면=어두운 갈색).
- `public/js/piece.js`: 클릭 위치 → 내 piece 인덱스 추정. HOME 영역 폴백.
- `public/js/ui.js`: 보드(사각형 + 두 대각 지름길) + 말(빨강/파랑 + 업힘 카운트) + 윷가락 + HUD 렌더링. 초대 패널/토스트/카운트다운 포함.
- `start.bat`/`stop.bat`: Windows 런처. stop은 윈도우 타이틀 기반(다른 프로젝트 서버 영향 없음).
- `tests/smoke.test.js`: 6 시나리오/18 assert. 18/18 PASS.

### 게임 규칙 (Phase 1)
- 외곽 사각형 20칸 + 두 지름길 + 중앙(방).
- 도(1)/개(2)/걸(3)/윷(4, +턴)/모(5, +턴).
- 잡기(상대 말 출발점으로 + 보너스 턴), 업기(같은 칸 자기 말 묶음 함께 이동).
- 모서리(좌상 5, 우상 10) 정확히 멈춤 → 다음 이동 시 자동 지름길 진입.
- 중앙(23) 도달 시 출구 분기 (모달 선택).
- 자기 말 4개 모두 완주 시 승.

### 단순화 (정통 룰 대비)
- 모서리에서 외곽 계속 vs 지름길 선택지 없음 (정확히 멈추면 자동 지름길).
- 중앙→좌하 출구는 직접 완주 처리.
- 백도(빽도) 변형 룰 미적용.

### 검증
- `node server.js --port 3088` 정상 기동, ANSI 박스 + LAN IP 출력.
- `curl http://localhost:3088/` HTML 200 응답 (4361 bytes).
- `node tests/smoke.test.js --port 3088`: **18/18 PASS**.
- Playwright 스크린샷 6개 (`tests/screenshots/`): 보드 렌더링 + 던지기 + 결과 칩 선택 + 말 이동 정상 확인.
