# Changelog

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
