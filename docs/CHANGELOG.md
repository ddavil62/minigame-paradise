# Changelog

## [2026-06-24] - 입장 UI 통일 Phase 1+2 (Entry UI Unify)

### 추가

**Phase 1 — yahtzee, rummikub (대기 화면 거의 완성형)**
- **`yahtzee/public/index.html`**: `#name-gate-inline` 닉네임 게이트 추가, `#invite-panel` 제거, `#opponent-info` + `#opponent-left-banner` 추가, READY 마크 ID 오목 패턴으로 통일 (`#my-ready-mark`/`#opp-ready-mark`)
- **`yahtzee/public/css/style.css`**: `name-gate-inline`, `opponent-left-banner`, `btn-start-ai` 클래스 추가
- **`yahtzee/public/js/main.js`**: 닉네임 게이트 로직(sessionStorage `yahtzee:name`), `READY_STATE` → `myReady`/`oppReady` 매핑, 이탈 배너 처리, `submitInlineName()` 함수
- **`yahtzee/public/js/network.js`**: `sessionStorage.getItem('yahtzee:name')` 3단계 폴백(URL `?name=` → sessionStorage → 게이트), `onOpen({ hasName })` 콜백
- **`yahtzee/server.js`**: `broadcastReadyState()` 함수 신설(각 플레이어에 `READY_STATE { myReady, opponentReady }` 개별 전송)
- **`rummikub/public/index.html`**: `#name-gate-inline` 추가, `#opponent-info` + `#opponent-left-banner` 추가
- **`rummikub/public/css/style.css`**: `name-gate-inline`, `opponent-left-banner` 클래스 추가
- **`rummikub/public/js/main.js`**: DOM 참조 ID 전면 수정(`ready-btn`→`btn-ready`, `p1-ready-mark`→`my-ready-mark`, `p2-ready-mark`→`opp-ready-mark`, `ai-panel`→`waitingSolo` 구조), `onOpen({ hasName })` 핸들러, `submitInlineName()` + 클릭/Enter 이벤트, `onReadyState`/`showOpponentLeftBanner()` 핸들러, 8개 헬퍼 함수 추가
- **`rummikub/public/js/network.js`**: 닉네임 3단계 폴백(URL `?name=` → sessionStorage `rummikub:name` → 게이트), `READY_STATE`/`OPPONENT_LEFT` 라우팅 추가, `sendJoin()` API 추가

**Phase 2 — yutnori, tetris-battle (대기 화면 분리 + 신설)**
- **`yutnori/public/index.html`**: `#screen-waiting` 신설(`.game-main` 위), `waiting-card` > `waiting-logo`(주사위) + `#name-gate-inline` + `#waiting-solo`(AI 버튼) + `#opponent-info` + `#ready-panel` + 룰 요약. `.game-main`에 초기 hidden 처리(`#screen-game` 패턴)
- **`yutnori/public/css/style.css`**: `.screen-waiting`, `name-gate-inline`, `opponent-left-banner` 스타일 추가 (우드/한지 테마 유지)
- **`yutnori/public/js/main.js`**: `showScreen('waiting'/'game')` 화면 전환, 닉네임 게이트, 이탈 배너, `onOpen({ hasName })` 콜백
- **`yutnori/public/js/network.js`**: sessionStorage `yutnori:name` 3단계 폴백, `onOpen({ hasName })`
- **`yutnori/server.js`**: `broadcastReadyState()` 신설, JOIN 시 `player.name` 폴백 `'(알 수 없음)'` 확인
- **`tetris-battle/public/index.html`**: `#screen-waiting` 신설, `waiting-card` > `waiting-logo`(게임패드) + `#name-gate-inline` + `#waiting-solo`(AI 버튼) + `#ready-panel` + 룰 요약. `.center-area`에 `VS` 라벨만 유지(게임 중). `.game-main` 초기 hidden
- **`tetris-battle/public/css/style.css`**: `.screen-waiting`, `name-gate-inline`, `opponent-left-banner` 스타일 추가 (다크 테마 유지)
- **`tetris-battle/public/js/main.js`**: `showScreen('waiting'/'game')`, 닉네임 게이트, `onOpen({ hasName })` 콜백 추가, `onReadyState`/`onOpponentLeft` 핸들러 (초기 구현 시 dead code → coder fix에서 연결)
- **`tetris-battle/public/js/network.js`**: sessionStorage `tetris-battle:name` 3단계 폴백, `READY_STATE`/`OPPONENT_LEFT` 라우팅 추가
- **`tetris-battle/server.js`**: `broadcastReadyState()` 함수 신설, READY 핸들러에서 호출, disconnect 시 `OPPONENT_LEFT` 전송 추가

### 수정
- **rummikub QA FAIL 수정**: 초기 구현 시 HTML은 통일 패턴으로 갱신되었으나 JS(`main.js`, `network.js`)가 미갱신되어 페이지 로드 시 `Cannot read properties of null` 크래시 발생. DOM ID 전면 수정 + 닉네임 게이트 로직 추가 + `READY_STATE` 지원으로 해소
- **rummikub/tests/sort-buttons-qa.spec.js**: `#ready-btn` 셀렉터를 `#btn-ready`로 수정 (회귀 방지)
- **tetris-battle QA FAIL 수정 (HIGH-1 BLOCKER)**: `main.js`에 `onOpen` 콜백 누락으로 닉네임 게이트 미동작 + `network.js`에 `READY_STATE`/`OPPONENT_LEFT` 라우팅 없음 + `server.js`에 `broadcastReadyState()` 미구현. 3파일 수정으로 해소
- **yahtzee AD3 REVISE**: `#ready-panel`에 hidden 클래스가 있어 초기 비표시. hidden 클래스 제거로 오목 패턴(항상 visible)과 일치시킴

### 참고
- 스코프: `.claude/specs/2026-06-24-entry-ui-unify-scope.md`
- 플랜: `.claude/specs/2026-06-24-entry-ui-unify-plan.md`
- Phase 1 AD3: `.claude/specs/2026-06-24-entry-ui-unify-phase1-ad3-report.md` (yahtzee REVISE→재검수 APPROVED, rummikub APPROVED)
- Phase 1 QA: `.claude/specs/2026-06-24-entry-ui-unify-phase1-qa-report.md` (yahtzee PASS 13/13, rummikub FAIL→재검증 PASS 11/11, 전체 24/24 PASS)
- Phase 1 rummikub JS fix: `.claude/specs/2026-06-24-entry-ui-unify-phase1-rummikub-fix-report.md`
- Phase 2 AD3: `.claude/specs/2026-06-24-entry-ui-unify-phase2-ad3-report.md` (APPROVED, WARN 2건 비강제)
- Phase 2 QA: `.claude/specs/2026-06-24-entry-ui-unify-phase2-qa-report.md` (yutnori PASS 21/21, tetris-battle FAIL→재검증 PASS 44/44, 전체 65/65 PASS)
- Phase 2 tetris-battle fix: `.claude/specs/2026-06-24-entry-ui-unify-phase2-coder-fix-report.md`
- 통일 패턴: 오목(omok) 파일럿 — `#screen-waiting .waiting-card`, `#name-gate-inline`, `READY_STATE { myReady, opponentReady }`, `#opponent-left-banner`
- 남은 게임: Phase 3 (matgo, janggi), Phase 4 (hanabi, davinci-code, codenames-duet) 미착수

---

## [2026-06-24] - 로비 AI 슬롯 채우기 (Lobby AI Fill)

### 추가
- **`launcher/server.js`**: `aiSlotCount` 상태 변수 추가. `FILL_WITH_AI`/`CANCEL_AI_FILL` WS 메시지 핸들러. `PICK_GAME` 정원 체크에 `effectiveCount = clients.size + aiSlotCount` 적용. REDIRECT 시 `spawnBotForAiFill()` 함수로 AI 슬롯 수만큼 `?mode=bot` 쿼리 포함 bot.js spawn. `sendLobbyStateTo`에 `aiSlotCount`/`aiSlots` 필드 추가. connection 핸들러에서 AI 슬롯 양보 로직(실제 플레이어 입장 시 aiSlotCount 1 감소). 리셋 위치 4곳(전원 퇴장/호스트 disconnect/POST lobby-return/SET_TARGET)에 `aiSlotCount=0` 추가
- **`launcher/public/app.js`**: `currentAiSlotCount` 상태 변수. `updateLobbyUI`에 AI 채우기 컨트롤 표시/숨김 + 힌트 텍스트 AI 케이스. `renderPresence`에 `aiSlots` 파라미터 추가, AI 슬롯 "AI N" 이탤릭 표시. `cardClickEnabled` 수식에 `currentAiSlotCount` 포함. `setupAiFillButtons()` 함수 신규. `resetToLobby`에 `currentAiSlotCount` 리셋
- **`launcher/public/index.html`**: `#ai-fill-controls` 영역 추가 (`btn-fill-ai` "AI로 채우기" + `btn-cancel-ai` "AI 취소" + `ai-fill-hint`). player-count-selector 아래, lobby-hint 위에 배치
- **`launcher/public/style.css`**: `.ai-fill-controls`, `.ai-fill-btn`(녹색 반투명), `.ai-fill-cancel-btn`, `.ai-fill-hint`, `.presence-item.ai-slot`(이탤릭 녹색) 스타일 추가

### 수정
- **BUG-1** (`app.js` 라인 273): `updateCardPlayerDisabled(count)` -> `updateCardPlayerDisabled(count + currentAiSlotCount)`. AI 슬롯 채운 상태에서 minPlayers/maxPlayers 비교가 실제 인원만으로 계산되어 적격 게임 카드가 `player-disabled`로 비활성화되던 버그 수정

### 참고
- 스코프: `.claude/specs/2026-06-24-lobby-ai-fill-scope.md`
- 플랜: `.claude/specs/2026-06-24-lobby-ai-fill-plan.md`
- 구현 리포트: `.claude/specs/2026-06-24-lobby-ai-fill-coder-report.md`
- QA: `.claude/specs/2026-06-24-lobby-ai-fill-qa-report.md` (PASS, 15/15)
- WS 프로토콜 신규: `FILL_WITH_AI`(C->S), `CANCEL_AI_FILL`(C->S). `LOBBY_STATE`에 `aiSlotCount`/`aiSlots` 필드 확장
- AI 채우기 대상 게임: 윷놀이, 요트 다이스 (botAvailable=true + maxPlayers>=3). 루미큐브는 서버 2인 고정으로 실질 제외
- `targetPlayers=2` 기존 AI 흐름(1인 단독 -> mode=ai) 무변경

---

## [2026-06-23] - Phase 1-B: 윷놀이 N인 확장 (2~4인 가변 플레이)

### 추가
- **`yutnori/server.js`**: N인 가변 정원 (`roomMaxPlayers`). 첫 접속자의 `?players=N` 쿼리로 2~4인 설정(범위 외 기본 2). `ALL_IDS = ['p1','p2','p3','p4']` 배열에서 미사용 ID 탐색 배정(FIX-1 패턴 유지). `nextPlayer()` 헬퍼 도입(`(idx+1) % playerIds.length` 순환). 잡기 탐색 `opp.id !== mover.id` 가드로 N-1명 검사. 봇 spawn `roomMaxPlayers > 2` 시 차단 + 에러 로그. READY/REMATCH 게이트 `players.length >= roomMaxPlayers && players.every(...)`. 전원 퇴장 시 `roomMaxPlayers = 2` 리셋. `/test/inject` p1~p4 지원 + `roomMaxPlayers` injection. `REMATCH_STATUS`에 `playersReady` 배열 추가(p1Ready/p2Ready 후방 호환 병존)
- **`yutnori/public/js/ui.js`**: P3 초록(`#27ae60`)/P4 보라(`#8e44ad`) 색상. HOME 영역 Y 오프셋 `p1:-36, p2:-18, p3:0, p4:24`(겹침 회피). 보드 말 4방향 분산 오프셋 `{x:-6,y:-4},{x:6,y:-4},{x:-6,y:8},{x:6,y:8}`. GOAL 영역 N인 포지셔닝. `renderPieceStatus` 동적 상대 추적. `--p3`, `--p4` CSS 변수 추가
- **`yutnori/public/js/main.js`**: N인 레이블(P1~P4 + 색상). 동적 턴 표시. N인 rematch 상태 핸들러. N인 game-over 메시지. N인 yut 결과 레이블. `showReadyStatus` 배열 확장
- **`yutnori/public/js/piece.js`**: HOME 클릭 영역 bottom-left 통일(전 플레이어 동일, §13-9 기준)
- **`yutnori/public/index.html`**: `#ready-mark-p3`, `#ready-mark-p4` DOM 요소 추가
- **`yutnori/public/css/style.css`**: `--p3`, `--p4` CSS 변수 추가
- **`yutnori/tests/multiplayer-1b-qa.spec.js`** (신규, 22건): N인 정상 시나리오 17건(YM-001~005 + YM-001b/002b/004a~c) + 예외 시나리오 5건(YM-006~017 중 Playwright 자동화 12건)

### 변경
- **`yutnori/server.js`**: 기존 `players.length >= 2` 하드코딩을 전부 `players.length >= roomMaxPlayers`로 교체. `passTurn()`이 `opponentOf()` 대신 `nextPlayer()` 사용(N인 턴 순환). 잡기 판정이 2인 상대 고정에서 N-1인 동적 검사로 확장. `broadcastState()`는 기존 `for...of` 패턴이라 자동 확장. `opponentOf()` 함수 보존(삭제 안 함). `createApp()` 함수 보존

### 검증
- 신규 N인 QA: **22/22 PASS** (2회 연속 안정)
- 서버리스 회귀: **342/342 PASS** (yut.unit 84 + ws.scenarios 20 + rulebook-c1~c19 212 + qa-defect2 2 + qa-rulefix-edge 26)
- bot-smoke: **10/10 PASS** (YBOT-001~005)
- 전체: **374건 PASS, 0 FAIL**

### 알려진 이슈 (LOW, 비차단)
- 상대 말 패널(`#opp-pieces`)이 현재 턴 상대 1명만 표시. 4인 시 전원 표시 미지원(향후 UI 폴리시 대상)
- P3/P4 ready 마크 DOM 미존재(`#ready-mark-p3/p4` 추가됨으로 부분 해소). 기능적으로 전원 READY 대기 정상 동작
- 3~4인 disconnect 메시지 "상대방 연결이 끊겼습니다" 단수 표현(N인에서 어색)
- `/test/inject`에서 `lastPath` 필드 미복원(테스트 전용, 실 서비스 영향 없음)

### 참고
- 스펙: `.claude/specs/2026-06-23-multiplayer-plan.md` (Phase 1-B 섹션)
- 구현 리포트: `.claude/specs/2026-06-23-multiplayer-plan-1b-report.md`
- QA: `.claude/specs/2026-06-23-multiplayer-1b-qa-report.md` (PASS)

---

## [2026-05-31] - 장기 AI 봇 추가 (mode=ai 자동 spawn)

### 추가
- **`janggi/bot.js`** (신규, 215 LOC): matgo 봇 패턴을 그대로 이식한 WS 봇 클라이언트. `node bot.js --url ws://...` 단독 실행 가능
  - 메시지 라우터: `JOINED`(mySide 저장) / `STATE`(handleState) / `SETUP_PROMPT`(보조 트리거) / `GAME_OVER`/`OPPONENT_LEFT`/`ERROR`(ws.close)
  - 자기 차례 감지: `state.turn === mySide` + 중복 행동 방지 키 `phase|turn|moveCount`
  - 응답 지연 400~900ms (`400 + random*500`)
  - 마/상 배치: `'MSMS'` 고정 송신
  - DRAW_OFFERED 수신 시 무시 (묵시적 거절)
- **`chooseMove(board, side)` 1수 휴리스틱 평가 함수**:
  - `getAllLegalMoves(board, side)`로 합법 수 열거 (`wouldBeSelfCheck` 내장 필터 → 자살수 원천 차단)
  - 잡는 수: `PIECE_SCORE[target.type]` 가산 (차13/포7/마5/상3/사3/졸2)
  - 장군 보너스: `cloneBoard` + `movePiece` 후 `isInCheck(sim, opponent)`이면 +1
  - 기본 가중치 0.1 (동률 다양성 확보)
  - 최댓값 동률은 random 선택 → 동형반복 3회 자초 가능성 완화
  - 합법 수 0이면 `RESIGN` 송신 (외통수 직전 자동 기권)

### 변경
- **`janggi/server.js`**:
  - `import { spawn } from 'child_process'` 추가
  - `createApp()` → `createApp(opts = {})` 시그니처 + `opts.getBotUrl` 옵션 (기본값 `() => null`)
  - `spawnBotChild()` / `killBotChild()` 블록 이식 (matgo 패턴, prefix `[janggi]`): `fs.existsSync(botPath)` 사전 체크 + `botChild.exitCode === null` 중복 spawn 방지 + `getBotUrl()` null 가드 + `botChild.on('exit')`에서 슬롯 해제
  - connection 핸들러: `wsMode`/`ws._isBot` 추출 → `wsMode === 'ai' && !isBot` 분기에서 200ms 후 `spawnBotChild()`
  - close 핸들러: `if (!ws._isBot) killBotChild()` (봇 disconnect 시 cascade 차단)
  - 단독 실행 분기: `getBotUrl: () => 'ws://localhost:${PORT}/ws?mode=bot'` 자동 구성
- **`launcher/server.js`**: `createJanggiApp({ getBotUrl: () => 'ws://localhost:${PORT}/janggi/ws?mode=bot' })` 주입 (matgo와 동일 시그니처)
- **`launcher/public/games.json`**: janggi `botAvailable: false → true` → 1/2 AI 모드 카드 활성화 (현재 botAvailable=true: matgo + janggi 2개)

### 회귀 검증
- `npx playwright test tests/rulebook-c*.spec.js`: **111/111 PASS** (2.5s, JR-C1~C12 전부)
- `node --check`: bot.js / server.js / launcher/server.js 모두 PASS
- 통합 동작 검증 (coder 리포트 §A/B): 단독(3066) + launcher(3077) 모두 사람 입장 → 200ms 후 봇 spawn → MSMS 배치 → playing → 졸 응수 → disconnect 시 봇 자동 정리 정상

### 알려진 한계 (의도된 범위)
- 봇 강도는 1수 휴리스틱 수준 (다음 턴 상대의 잡힘 위험 평가 없음). 스펙 §봇 강도 명시 범위
- 장군 보너스(+1)가 졸 잡기(+2)보다 작아 무의미 장군보다 졸 잡기 우선 (보수적 동작, 의도)
- launcher upgrade 라우터 회귀 (직전 QA agent 발견)는 본 작업과 독립 → 별도 스펙 분리 권고

### 변경된 파일 목록
- `janggi/bot.js` (신규)
- `janggi/server.js` (수정)
- `launcher/server.js` (수정 1줄)
- `launcher/public/games.json` (수정 1플래그)

### 참고
- 목적 정의서: `.claude/specs/2026-05-31-janggi-ai-bot-scope.md`
- 스펙: `.claude/specs/2026-05-31-janggi-ai-bot-plan.md`
- 구현 리포트: `.claude/specs/2026-05-31-janggi-ai-bot-coder-report.md`
- QA: `.claude/specs/2026-05-31-janggi-ai-bot-qa-report.md` (PASS, 룰북 111/111 회귀 + 정적 + 평가 함수 리뷰 모두 PASS)

---

## [2026-05-31] - 장기 룰북 LOW 권고 5건 보강 (105 → 111 시나리오, §11 100% 커버리지)

### 추가
- **`tests/rulebook-c12-procedure.spec.js`** (신규, JR-C12-001~005, 5건): 룰북 §11-11 절차 위반 5종 회귀 가드
  - JR-C12-001: 상대 차례에 둔 수 거절 (`'당신의 차례가 아니다'`)
  - JR-C12-002: 자기 차례에 상대 기물 이동 거절 (`'자기 기물만 이동할 수 있다'`)
  - JR-C12-003: 한 제안 후 한 자기 수락 거절 (`drawOfferedBy === side` 체크)
  - JR-C12-004: 기권 후 `ended` 상태에서 MOVE 거절
  - JR-C12-005: `setup_han` 단계에서 MOVE 시도 거절
- **JR-C8-006** (신규, `rulebook-c8-draw.spec.js`): 무승부 제안 양방향 자동 취소 — 한 제안 → 초가 수를 두면 `drawOfferedBy=null`

### 변경
- **JR-C5-006/010 강화** (`rulebook-c5-repetition.spec.js`): 종료 시 덤 1.5 정확 검증 추가
  - `endScores.cho === rawScores.cho + DEOM`, `endScores.cho - rawScores.cho === 1.5`
  - 포획 없는 사이클 가드: `han === 72`, `cho === 73.5`
  - `calculateScore`, `DEOM` import 추가
- **JR-C10-004 재구성** (`rulebook-c10-bigcheck.spec.js`): 빅장 응수 컨텍스트 재구성
  - "초 차(0,1)가 한 궁(4,1)에 가로 장군 직후" setup → 한이 무관계 차로 응수 시도 → `wouldBeSelfCheck=true`로 자살수 거절
  - 룰북 §8-6(빅장) + §8-3(자살수) 동시 인용으로 의도 명확화
- **JR-C1 5개 케이스 정밀도 강화** (`rulebook-c1-pieces.spec.js`): `arrayContaining` → length + set 비교
  - JR-C1-001(궁 중앙 8), JR-C1-002(대각 4), JR-C1-010(포 가로 5), JR-C1-016(한 졸 3), JR-C1-018(초 병 3)
  - 의도 외 후보 추가/누락 시 즉시 spec 깨짐 → 회귀 안전망

### 카테고리 분포 (105 → 111)
| 카테고리 | 파일 | 이전 | 현재 |
|---------|------|------|------|
| C8 무승부/기권 | rulebook-c8-draw.spec.js | 5 | 6 (+006) |
| C12 절차 위반 | rulebook-c12-procedure.spec.js (신규) | 0 | 5 |
| **합계** | | **105** | **111** |

### §11 금지 수 커버리지
- 이전 10/11 (절차 위반 항목만 MISS, probe로만 확인)
- 현재 **11/11 (100%)** — 절차 위반이 JR-C12 5건으로 spec 가드됨

### QA 판정
- **PASS** (이전 CONDITIONAL_PASS → 격상)
- 5회 연속 111/111 PASS (평균 2.0초, flaky 0건)
- 회귀: 비-rulebook spec 135/135 PASS (1.9초)
- lib/룰북 코드 변경 없음 — 테스트 보강만으로 안전망 강화

### 알려진 트레이드오프 (수용)
- JR-C10-004 사전 `inCheck` assert는 주석으로만 명시 (helpers `isInCheck` re-export 없음)
- JR-C8-006의 `state.turn = 'cho'` 직접 조작 — `drawOfferedBy` side-무관 동작 검증 핵심에 영향 없음
- JR-C5-006/010의 `han=72/cho=73.5` 가정 — `PIECE_SCORE`/`DEOM` 변경 시 알람 (의도된 동작)

### 변경된 파일 목록
- `janggi/tests/rulebook-c12-procedure.spec.js` (신규)
- `janggi/tests/rulebook-c1-pieces.spec.js` (5개 케이스 강화)
- `janggi/tests/rulebook-c5-repetition.spec.js` (006/010 보강)
- `janggi/tests/rulebook-c8-draw.spec.js` (+006)
- `janggi/tests/rulebook-c10-bigcheck.spec.js` (004 재구성)

### 참고
- 스펙: `.claude/specs/2026-05-31-janggi-rulebook-low-fix-plan.md`
- 구현 리포트: `.claude/specs/2026-05-31-janggi-rulebook-low-fix-coder-report.md`
- QA: `.claude/specs/2026-05-31-janggi-rulebook-low-fix-qa-report.md` (PASS, 격상)

---

## [2026-05-31] - 장기(Janggi) 신규 게임 추가

### 추가
- **6번째 게임 "장기"**: `janggi/` 디렉토리 신설. KJA 2009 개정 룰(빅장 폐지, 점수제, 동형반복 3회) 준수 LAN 1:1 한국 전통 장기
- **서버 게임 로직 5개 모듈** (`janggi/lib/`):
  - `board.js`: 9x10 보드 CRUD, 4종 마/상 배치(MSMS/SMSM/MSSM/SMMS), 직렬화, 동형반복용 해시
  - `pieces.js`: 7종 기물 합법 이동 산출 (궁/사/차/포/마/상/졸). 포다리 규칙, 마/상 멱 차단, 궁성 대각선 포함
  - `rules.js`: 장군/외통수/자살수/양수겸장/동형반복 판정
  - `score.js`: 기물 점수표(K=0, A=3, R=13, C=7, H=5, E=3, P=2) + 후수 덤 1.5
  - `game.js`: GameSession 상태 관리 (배치 선택 -> 플레이 -> 종료). 종료 조건 5가지(외통수, 기권, 시간패, 동형반복 3회, 50수 룰). 시간제 본 시간 10분 + 초읽기 30초x3회
- **WebSocket 서버** (`janggi/server.js`): createApp() 팩토리 패턴. WS 메시지 C->S 6종 + S->C 10종. 1초 tick 타이머, 배치 30초 타이머, heartbeat 30초, 재접속 복구. 단독 포트 3006
- **클라이언트 UI** (`janggi/public/`):
  - Canvas 보드 렌더링 592x672px (격자선, 강 띠 楚河漢界, 궁성 대각선 X)
  - 기물 DOM 렌더링 (한자 표기, 팔각형 clip-path, 한 적색 #C8102E / 초 청색 #2E5BBA)
  - CSS 변수 18개, check-pulse 애니메이션, 런처 일관 radial-gradient 배경
  - 배치 선택 모달 (4종 카드 + 30초 카운트다운)
  - 합법 수 하이라이트 (이동/잡기 구분, 서버 권위 REQUEST_MOVES)
  - 시간 패널 (MM:SS + 초읽기), 잡힌 기물 패널, 장군 토스트, 종료 모달 (승/패 + 점수)
  - 헤더에 `#btn-back-to-lobby` (기존 5개 게임과 동일 ID/confirm 패턴)
- **런처 통합** (`launcher/server.js`, `launcher/public/games.json`):
  - `createJanggiApp()` import + `GAME_APPS` 등록
  - games.json에 janggi 항목 추가 (color: #C8102E, botAvailable: false)
  - 콘솔 배너 게임 목록에 `/janggi/` 추가
- **Playwright 테스트** (`janggi/tests/`):
  - `janggi.spec.js`: QA-001~QA-020 커버 77개 (서버 lib 직접 호출형 단위 테스트)
  - `qa-edge-cases.spec.js`: QA 도출 엣지케이스 58개 (상 경계값, 포 궁성 대각선, 배치 코드 16종 전수 검증 등)
  - `qa-e2e.spec.js`: 브라우저 E2E 5개 (초기 로딩, 배치 모달, 보드 렌더링, 모바일 뷰포트, 3인 거절)
- **스모크 테스트**: `_smoke.js` 73개 + `_smoke_server.js` 34개 + `_smoke_launcher.js` 19개

### 수정
- **PATCH-P2-1 (AD 모드3 REVISE)**: `public/js/main.js`에서 기물 클릭 시 piecesLayer와 boardContainer 핸들러가 동시 발화되어 합법 수 하이라이트가 표시되지 않는 버그. piecesLayer/highlightsLayer 핸들러에 `e.stopPropagation()` 추가로 해결
- **PATCH-P4-1 (상 이동 패턴)**: `lib/pieces.js`의 `getElephantMoves`에서 상(elephant) 최종 변위가 (+-3,+-3)으로 잘못 계산되던 버그. endDf/endDr 값을 (+-1,+-1)로 교정하여 룰북 SS5-6 기준 (+-2,+-3)/(+-3,+-2) 변위로 정상화

### 스펙 대비 구현 차이
- 스펙의 `GameSession` 클래스 대신 순수 함수 + 상태 객체 패턴 채택 (직렬화 단순화, davinci-code 패턴 일관성)
- 기물 타입 내부 표현: 스펙 약어(K/A/R/C/H/E/P) 대신 풀네임(`king`/`advisor` 등) 사용 (가독성). 해시에서만 약어
- games.json color: 스펙 `#8B1A1A` -> AD 컨셉 확정 `#C8102E` (한국 적색)
- 궁성 대각선 인접 관계: 런타임 계산 대신 정적 매핑(PALACE_DIAG_ADJ) 사전 빌드

### QA 판정
- **PASS** (140개 테스트 전체 통과)
- AC-1 ~ AC-8 수용 기준 전부 충족
- 24개 엣지케이스 시나리오 전부 PASS
- 6개 게임 런처 회귀 PASS

### 알려진 이슈 (MEDIUM/LOW, 기능 영향 없음)
- `public/js/ui.js`: `showCheckToast()`/`showToast()` 함수에서 `replaceChild` 후 stale DOM 참조. 연속 호출 시 두 번째 알림 미표시
- 무승부 거절 시 서버에 `DRAW_REJECT` 미전송. 제안측에 "거절됨" 피드백 없음 (수 두면 자동 초기화)

### 변경된 파일 목록
- `janggi/server.js`, `janggi/lib/{board,pieces,rules,score,game}.js` (신규 6개)
- `janggi/public/index.html`, `janggi/public/css/style.css`, `janggi/public/js/{main,board,pieces,ui}.js` (신규 6개)
- `janggi/tests/{janggi.spec,qa-edge-cases.spec,qa-e2e.spec,helpers}.js`, `janggi/playwright.config.js` (신규 5개)
- `janggi/lib/{_smoke,_smoke_server,_smoke_launcher}.js` (신규 3개)
- `launcher/server.js` (수정 3개소: import, GAME_APPS, 배너)
- `launcher/public/games.json` (수정: janggi 항목 추가)

### 참고
- 목적 정의서: `.claude/specs/2026-05-31-janggi-add-scope.md`
- 스펙: `.claude/specs/2026-05-31-janggi-add-plan.md`
- 룰북: `.claude/specs/2026-05-31-janggi-rulebook.md`
- Coder P1: `.claude/specs/2026-05-31-janggi-coder-p1-report.md`
- Coder P2: `.claude/specs/2026-05-31-janggi-coder-p2-report.md`
- AD2/AD3: `.claude/specs/2026-05-31-janggi-ad2-ad3-report.md` (APPROVED, PATCH-P2-1 적용)
- Coder P3: `.claude/specs/2026-05-31-janggi-coder-p3-report.md`
- Coder P4: `.claude/specs/2026-05-31-janggi-coder-p4-report.md` (PATCH-P4-1 상 이동 수정)
- QA: `.claude/specs/2026-05-31-janggi-qa-report.md` (PASS, 140개)

---

## [2026-05-31] - 5개 게임 게임 중 상시 뒤로가기 버튼 추가

### 추가
- **`#btn-back-to-lobby` 버튼**: 5개 게임(matgo, tetris-battle, davinci-code, yutnori, codenames-duet)의 헤더/메타패널에 "← 게임 선택" 상시 표시 버튼 추가. 게임 진행 중 언제든 로비(`/`)로 복귀 가능
- **confirm 다이얼로그**: 버튼 클릭 시 `confirm('게임을 중단하고 게임 선택 화면으로 돌아가시겠어요? 상대방도 함께 로비로 이동합니다.')` 표시. 취소 시 동작 없음
- **양쪽 동시 로비 복귀**: P1이 confirm 수락 -> `fetch('/lobby/return')` + `location.href = '/'`. P1 WS 연결 종료 -> 게임 서버가 P2에 disconnect 메시지 전송 -> P2 클라이언트가 path 기반 런처 모드 판정 후 1.2초 딜레이로 자동 redirect
  - matgo/davinci-code/codenames-duet: `OPPONENT_LEFT` 핸들러에 런처 모드 감지 + redirect 추가
  - tetris-battle: `GAME_RESULT` (reason=disconnect) 핸들러에 런처 모드 감지 + redirect 추가
  - yutnori: `GAME_OVER` (reason=disconnect) 핸들러에 런처 모드 감지 + redirect 추가
- **게임별 고스트 버튼 CSS**: 각 게임 팔레트에 맞춘 투명 고스트 스타일 적용
  - matgo: gold-soft 60% 투명 (`.meta-panel .btn-back-to-lobby`, 특이도 0,2,0)
  - tetris-battle: accent 민트 50% 투명 + flex-shrink:0
  - davinci-code: wheat 55% 투명 + `.back-stat` 래퍼 + `.topbar-stats { flex-wrap: wrap }`
  - yutnori: text-dim 60% 투명 + flex-shrink:0
  - codenames-duet: wheat 55% 투명 + `.back-stat` 래퍼 + `.topbar-stats { flex-wrap: wrap }`
- **QA 테스트**: `tests/back-button-qa.spec.js` (BB-01~BB-10, 14개), `tests/back-button-extended-qa.spec.js` (EQ-1~EQ-7, 24개)

### 수정
- **matgo CSS 특이도 버그 (QA v1 FAIL-1)**: `.btn-back-to-lobby` (0,1,0)이 `.meta-panel button` (0,1,1)에 패배하여 gold gradient가 표시됨 -> `.meta-panel .btn-back-to-lobby` (0,2,0)으로 셀렉터 변경하여 투명 고스트 정상 적용
- **양쪽 동시 로비 복귀 미동작 (QA v1 FAIL-2)**: `POST /lobby/return`의 `RETURN_LOBBY` broadcast가 런처 WS에만 도달하여 게임 페이지 P2에 전달 안됨 -> 서버 코드 변경 없이 기존 disconnect 감지 메커니즘 활용 + 클라이언트 측 path 기반 런처 모드 판정 + 1.2초 딜레이 redirect로 해결

### 변경된 파일 목록
- `matgo/public/index.html`, `matgo/public/style.css`, `matgo/public/client.js`
- `tetris-battle/public/index.html`, `tetris-battle/public/css/style.css`, `tetris-battle/public/js/main.js`
- `davinci-code/public/index.html`, `davinci-code/public/style.css`, `davinci-code/public/client.js`
- `yutnori/public/index.html`, `yutnori/public/css/style.css`, `yutnori/public/js/main.js`
- `codenames-duet/public/index.html`, `codenames-duet/public/style.css`, `codenames-duet/public/client.js`
- `tests/back-button-qa.spec.js` (신규), `tests/back-button-extended-qa.spec.js` (QA 자체 작성)

### 참고
- 스펙: `.claude/specs/2026-05-31-minigame-back-button-plan.md`
- 목적 정의서: `.claude/specs/2026-05-31-minigame-back-button-scope.md`
- 구현 리포트 v1: `.claude/specs/2026-05-31-minigame-back-button-coder-report.md`
- 구현 리포트 v2: `.claude/specs/2026-05-31-minigame-back-button-coder-report-v2.md` (QA FAIL 수정)
- AD3: `.claude/specs/2026-05-31-minigame-back-button-ad3-report.md` (APPROVED)
- QA v1: `.claude/specs/2026-05-31-minigame-back-button-qa-report.md` (FAIL -- FAIL-1 CSS 특이도, FAIL-2 양쪽 복귀)
- QA v2: `.claude/specs/2026-05-31-minigame-back-button-qa-report-v2.md` (PASS -- 59개 전체 통과, BB-10 테스트 타이밍 이슈는 기능 정상)
- 서버 코드(launcher/server.js, 5개 게임 server.js) 변경 없음
- 기존 `#btn-return-lobby`(결과 화면) 유지, 새 `#btn-back-to-lobby`(상시)와 ID 분리
- 기존 회귀: lobby-ux-reqa 21/21 PASS, T-10~T-14 PASS
- BB-10 테스트 잔존 이슈: WS 연결 대기 타이밍 부족으로 CI에서 간헐 FAIL 가능. `await p2.waitForTimeout(500)` 추가 권장

---

## [2026-05-30] - 다빈치 코드 플러스 (3색 룰업)

### 추가
- **3색 타일 구성**: 기존 흑/백 2색(24장)을 빨강/노랑/파랑 3색(39장)으로 전면 교체. 각 색상별 0~11 숫자 12장 + 조커 1장 = 13장 x 3색 = 39장
- **조커 배치 페이즈**: 게임 시작 직후 `awaiting_joker_placement` 페이즈 진입. 양쪽 모두 조커를 손패 원하는 위치에 배치 완료 후 게임 시작 (`drawForCurrentTurn` -> `awaiting_guess`)
- **`placeJoker(state, playerId, insertAfter)` 함수**: 조커를 손패 `insertAfter+1` 위치에 splice 삽입. 양쪽 배치 완료 시 자동 전환
- **조커 추측 UI**: 추측 패널에 "조커?" 버튼(`#btn-guess-joker`, `.btn-joker-guess` 보라색 #7d3c98) 추가. `{ type: 'GUESS', slot: N, value: null }` 전송
- **조커 배치 UI**: `#joker-place-panel`에 손패 수+1개 배치 버튼(`.btn-slot-place`) 렌더링, 조커 뱃지에 색상 표시
- **3색 메모판**: 빨강/노랑/파랑 각 12칸 + 조커 3칸 = 39칸. `.memo-tile.red-tile/.yellow-tile/.blue-tile/.joker-tile` CSS 클래스
- **PLACE_JOKER 서버 핸들러**: `server.js`에 PLACE_JOKER 메시지 케이스 추가, `placeJoker` import

### 변경
- `game.js` (541줄): `COLORS = ['red', 'yellow', 'blue']`, `buildFullDeck()` 39장, `sortHand()` 조커 위치 보존, `createGame()` 조커 분리(`unplacedJokers`) + `awaiting_joker_placement` 시작, `guess()` value=null 허용 (조커 추측), `snapshotForPlayer()` 조커 관련 필드 포함
- `server.js` (416줄): PLACE_JOKER 핸들러, GUESS 로그 가독성 개선 (`val=JOKER`)
- `public/client.js` (628줄): `initMemoBoard()` 3색 39칸, `renderJokerPlacement()`, `updateActionPanel()` 조커 배치 페이즈, `renderOppHand()`/`renderMyHand()` 3색+조커 표시, `btnGuessJoker` 핸들러, `addGuessHistory()` 조커 중복 방지 키
- `public/style.css` (672줄): 흑/백 CSS 전부 삭제 (`.card.black/.white`, `.pending-card.black/.white`, `.memo-tile.black-tile/.white-tile`), red/yellow/blue 카드 색상 추가, `.card.joker::after` 별표 오버레이, 조커 배치/추측 UI 스타일
- `public/index.html` (118줄): 타이틀 "DA VINCI CODE+", `#joker-place-panel` 추가, `#btn-guess-joker` 추가

### 수정
- **CSS 유니코드 이스케이프 (LOW)**: `style.css`의 `.card.joker::after` content에서 `\u2605` (JS 방식) -> `\2605` (CSS 방식)으로 수정. 수정 전에는 "u2605" 텍스트가 표시되었으나, font-size 0.65rem + opacity 0.7로 사용성 영향 미미

### 참고
- 스펙: `.claude/specs/2026-05-30-davinci-plus-plan.md`
- 목적 정의서: `.claude/specs/2026-05-30-davinci-plus-scope.md`
- 구현 리포트: `.claude/specs/2026-05-30-davinci-plus-coder-report.md`
- AD3: `.claude/specs/2026-05-30-davinci-plus-ad3-report.md` (APPROVED, 23항목 전 PASS)
- QA: `.claude/specs/2026-05-30-davinci-plus-qa-report.md` (PASS, 단위 53개 + E2E 25개 = 78개 전체 통과)
- QA 테스트: `davinci-code/tests/game-unit-qa.spec.js` (53개), `davinci-code/tests/davinci-plus-qa.spec.js` (25개)
- 정렬 규칙: value 오름차순, 동점 시 red < yellow < blue. 조커는 배치 위치 고정
- 색상 값: red=#c0392b, yellow=#f1c40f, blue=#2980b9

---

## [2026-05-30] - 다빈치 코드 UI 전면 개편 (2-column 레이아웃)

### 추가
- **2-column Grid 레이아웃**: `.play-area`를 `display: grid; grid-template-columns: 1fr 300px`으로 전환. 좌 컬럼(`.game-board`)에 게임보드, 우 컬럼(`.info-panel`)에 정보 패널 배치
- **숫자 메모판**: 우 패널 상단에 흑 0~11(12칸) + 백 0~11(12칸) = 24칸 타일. 공개된 카드에 대응하는 타일에 `.used` 클래스 적용 (opacity 0.25, line-through)
- **추측 기록 누적 표시**: 우 패널 하단에 추측 기록을 클라이언트 메모리에 누적하여 스크롤 가능한 목록으로 표시. 최신 항목이 맨 위. `lastHistoryKey`(from+slot+value 3-tuple)로 중복 추가 방지
- **`initMemoBoard()`**: 모듈 로드 시 호출하여 게임 시작 전에도 24타일 표시
- **`addGuessHistory()`**: `lastGuess` 신규 항목을 prepend 방식으로 추가
- **`resetGuessHistory()`**: `GAME_START` 수신 시 추측 기록 + 메모판 초기화

### 변경
- `davinci-code/public/index.html`: `.game-board` 좌 컬럼 래퍼 추가, `action-panel`을 `<main>` 내부로 이동, `#last-guess` 엘리먼트 제거, `<aside class="info-panel">` 추가 (메모판 + 추측 기록 DOM)
- `davinci-code/public/style.css`: `.play-area` flex -> CSS Grid 전환, 카드 크기 `.card`/`.pending-card` 80x110px, `.deck-card` 86x118px으로 확대, `.hand` max-width 1000px -> 100%, `.info-panel`/`.memo-board`/`.memo-tile`/`.guess-history-panel`/`.history-item` 신규 스타일 추가, `.last-guess` 관련 규칙 제거
- `davinci-code/public/client.js`: `lastGuessEl`/`renderLastGuess()` 제거, `memoBoardEl`/`guessHistoryEl` DOM 참조 추가, `renderState()` 내에서 `renderMemoBoard()` + `addGuessHistory()` 호출로 교체

### 스펙 대비 구현 차이
- `.play-area` gap: 스펙 16px -> 구현 0 (border-left로 시각적 구분 대체, QA 허용)
- `.memo-tile.used` opacity: 스펙 0.3 -> 구현 0.25 (시각적 차이 미미, QA 허용)
- 추측 기록 렌더링: 스펙의 전체 재렌더 방식 대신 prepend + `lastHistoryKey` 중복 방지 방식으로 구현 (동일 결과, 성능 개선)

### 변경된 파일 목록
- `davinci-code/public/index.html`, `davinci-code/public/style.css`, `davinci-code/public/client.js`

### 참고
- 스펙: `.claude/specs/2026-05-30-davinci-ui-overhaul-plan.md`
- 구현 리포트: `.claude/specs/2026-05-30-davinci-ui-overhaul-coder-report.md`
- QA: `.claude/specs/2026-05-30-davinci-ui-overhaul-qa-report.md` (26개 테스트 전체 PASS)
- QA 테스트: `tests/davinci-ui-overhaul-qa.spec.js`
- server.js, game.js 미수정. WebSocket 프로토콜 변경 없음.

---

## [2026-05-30] - 로비 UX 개선

### 추가
- **단일 화면 로비**: `lobby-view`와 `game-select-view`를 하나의 `lobby-view`로 통합. 접속 즉시 게임 카드 5개 표시
- **투표 시스템**: 게임 카드에 투표 버튼 추가. `VOTE_GAME` WS 메시지로 toggle 방식 투표, `LOBBY_STATE`에 `votes` 필드 포함하여 실시간 갱신
- **로비 복귀 버튼**: 5개 게임 완료 화면에 "다른 종목" 버튼 추가. `POST /lobby/return` HTTP 엔드포인트 호출 -> 서버가 `RETURN_LOBBY` broadcast -> 양쪽 동시 복귀
- **봇 미지원 게임 차단 (3중 가드)**: 1/2 AI 모드에서 봇 없는 게임 선택 차단
  - CSS: `.game-grid.ai-mode .game-card.no-bot` (opacity 0.5, grayscale, pointer-events:none, "AI 봇 미지원" 배지)
  - JS: `pick()` 핸들러에서 `currentCount` 기반 `effectiveMode` 판단, `showStatus()` 안내 메시지
  - 서버: `PICK_GAME` 핸들러에서 `isAiMode && !game.botAvailable` 검증, ERROR 메시지 반환
- **`lobby-meta` UI 영역**: 인원 카운트(72px), 역할 표시, 힌트 텍스트를 카드 그리드 상단에 배치

### 변경
- `launcher/server.js`: `lobbyPhase` 변수 제거, `votes` Map 추가, `PICK_GAME`에서 lobbyPhase 가드 제거 (카드 클릭 시점에 mode 결정), `sendLobbyStateTo`에 votes 직렬화 포함, disconnect 핸들러에 `votes.clear()` 추가
- `launcher/public/index.html`: `start-btn` 제거, `game-select-view` 블록 제거, 단일 `lobby-view`로 재구성
- `launcher/public/app.js`: `transitionTo`/`currentPhase`/`cardsRendered`/`SELECT_VIEW_ID` 제거, `currentVotes`/`cardClickEnabled`/`currentCount` 상태 추가, `updateLobbyUI` 재작성, `RETURN_LOBBY`/`PHASE`(무시) 핸들러 추가
- `launcher/public/style.css`: `.start-btn`/`.game-select-view` 관련 스타일 제거, `.lobby-meta`/`.game-card-vote`/`.game-grid.guest-mode`/`.game-grid.ai-mode` 스타일 추가
- WS 프로토콜: `START`(C->S), `PHASE`(S->C) 제거. `VOTE_GAME`(C->S), `RETURN_LOBBY`(S->C) 추가. `LOBBY_STATE`에 `votes` 필드 추가

### 수정
- **EX-07 (HIGH)**: 1/2 AI 모드에서 botAvailable=false 게임(yutnori, tetris-battle, davinci-code, codenames-duet) 선택이 차단되지 않던 버그 -> 3중 가드로 수정
- **힌트 텍스트 중복 (LOW)**: 게스트 2/2 화면에서 `#lobby-hint`와 `#guest-waiting`에 동일 텍스트가 중복 표시되던 문제 -> 게스트일 때 `#lobby-hint`를 비워서 해소
- **ai-mode CSS 미적용 (LOW)**: `updateLobbyUI()`에서 `grid.classList.toggle('ai-mode', count === 1)` 누락 -> 추가하여 봇 미지원 카드 시각적 비활성화 정상 동작

### 변경된 파일 목록
- `launcher/server.js`, `launcher/public/index.html`, `launcher/public/app.js`, `launcher/public/style.css`
- `matgo/public/index.html`, `matgo/public/client.js`, `matgo/public/style.css`
- `yutnori/public/index.html`, `yutnori/public/js/main.js`, `yutnori/public/css/style.css`
- `tetris-battle/public/index.html`, `tetris-battle/public/js/main.js`, `tetris-battle/public/css/style.css`
- `davinci-code/public/index.html`, `davinci-code/public/client.js`, `davinci-code/public/style.css`
- `codenames-duet/public/index.html`, `codenames-duet/public/client.js`, `codenames-duet/public/style.css`

### 참고
- 스펙: `.claude/specs/2026-05-30-lobby-ux-scope.md`
- 플랜: `.claude/specs/2026-05-30-lobby-ux-plan.md`
- 구현 리포트: `.claude/specs/2026-05-30-lobby-ux-coder-report.md`
- QA: `.claude/specs/2026-05-30-lobby-ux-qa-report.md`
- QA 테스트: `tests/lobby-ux-qa.spec.js` (26개), `tests/lobby-ux-reqa.spec.js` (21개)
