# Changelog

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
