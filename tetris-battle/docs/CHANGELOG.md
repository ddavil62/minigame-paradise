# Tetris Battle Changelog

이 프로젝트의 모든 주요 변경 사항을 기록한다. Phase 단위로 묶이며 파이프라인 산출물(scope/plan/coder/AD/QA)과 연결된다.

---

## [2026-06-28] 봇 버그 2건 수정 — start desync(#12) · 좀비 봇 "Room is full"(#13)

### 수정
- **#12 봇 start desync (`bot.js`)** — START 핸들러가 `msg.countdown` 값을 무시하고 즉시 `scheduleNextPiece()`를 호출해 봇이 사람보다 ~4초 먼저 게임을 시작하던 버그. `resetBot()`(보드/봉투/콤보 초기화)은 즉시 실행하고, `isRunning=true`+`scheduleNextPiece()`는 `(countdown+1)*1000`ms(countdown 3 → 4000ms) 지연으로 변경. 사람 `main.js`의 `runCountdown(3)`이 t=4000ms에 `game.start()`하는 시점과 동기화. `countdown` 값이 바뀌어도 공식으로 자동 추종. 라이브: 봇 첫 액션 START 후 +5168ms(4000ms 대기 + ~1168ms 첫 피스 간격).
- **#13 AI채우기 재진입 "Room is full" (`server.js`)** — 사람 disconnect 시 `killBotChild()`의 SIGTERM이 비동기라 봇 WS 슬롯이 `players` 배열에 좀비로 잔존 → 사람 재연결 시 정원 판정에 좀비가 포함되어 봇 미생성(대기 고착) 또는 "Room is full" 발생. 두 가지로 수정:
  - (1) 사람 ws close 시(`!isBot`): 짝 봇 슬롯을 `players`에서 동기 제거 + `botSlot.ws.terminate()`로 즉시 TCP 종료(`killBotChild()` 병행). `terminate()`로 발화되는 봇 close 핸들러의 `players.filter`는 이미 제거된 상태라 no-op.
  - (2) 사람 connection 진입부: 정원 판정 직전 `ws.readyState !== OPEN`인 죽은(좀비) 슬롯만 선제 `terminate()`+제거(안전망). **살아있는 봇은 보존** — AI채우기는 봇이 먼저 접속하므로 전체 sweep 금지.
  - `import { WebSocket }` 추가(`readyState` 상수 비교용).
  - 라이브: 로비 → 테트리스 → AI채우기 → 준비 → 시작 시 "Room is full" 없이 P2 정상 입장, 상대(봇) 입장 완료.

### 회귀
- bot-smoke **11/11 PASS**, phase4-launcher PASS, phase1-ws PASS.
- phase3-4-qa-edge: **Q7b 1건만 FAIL** — 기존 baseline 결함(printBanner 정규식 비탐욕 취약성, 본 수정과 무관, 회귀 게이트 비차단).

### 파이프라인
- `visual_change: none`(#12/#13 모두 백엔드/봇 로직) → AD3 생략. QA PASS.

### 참고
- 스펙: `C:\LazySlimeStudio\minigames\.claude\specs\2026-06-28-minigames-bugfix-3-spec.md`
- 리포트: `C:\LazySlimeStudio\minigames\.claude\specs\2026-06-28-minigames-bugfix-3-report.md`

---

## [2026-06-21] AI 봇 추가 — 독자 엔진 1인 대전

### 배경
- 10종 게임 중 테트리스 배틀만 AI 봇이 없어 1인 플레이가 불가능했다. 캐주얼 LAN 환경에서 친구가 없을 때도 즉시 즐길 수 있도록 "적당히 이길 수 있는" 난이도의 봇을 추가.
- 아키텍처 특수성: 테트리스 배틀은 **클라이언트 권위** 구조라 서버가 보드 STATE를 브로드캐스트하지 않는다. 다른 봇(오목/요트 등)처럼 서버 STATE를 받아 한 수를 두는 방식이 불가능하므로, 봇이 **자체 보드·피스 시뮬레이터를 내장**하고 라인 클리어 시에만 `GARBAGE_SEND`를 서버에 전송하도록 설계.

### 추가
- **`bot.js`** (신규, ~550줄) — AI 봇 프로세스 (독자 테트리스 엔진 + WS 클라이언트)
  - **독자 엔진**: `board.js`/`tetromino.js`를 import하지 않고 상수·로직을 인라인 재구현(`BOARD_WIDTH=10`, `VISIBLE_HEIGHT=20`, `VANISH_ZONE=2`, `BOARD_HEIGHT=22`, `GARBAGE_BOMB_LINES=2`, `PIECES` 7종 회전 행렬, `PIECE_COLORS`). 시뮬레이터: `createEmptyGrid`/`isColliding`/`lockPiece`/`clearLines`/`addGarbage`/`createBag`(7-bag)/`garbageFromLines`/`comboBonus`/`getStackHeight`. JSDoc에 "board.js 동기 유지 필요" 주석 명시.
  - **평가 함수 가중치**(최상단 상수 분리): `W_CLEAR=1.0`, `W_HOLES=-3.5`, `W_BUMP=-0.5`, `W_HEIGHT=-0.5`. `score = clearLines·W_CLEAR + holes·W_HOLES + bumpiness·W_BUMP + maxHeight·W_HEIGHT`.
  - **탐색**: 매 피스 `(x위치 × rotation 0~3)` 전수 탐색(`chooseBestPlacement`) → 하드드롭 → 시뮬 클리어 → 최고점 선택. **1-look**(넥스트 미고려, 2-look 미구현 — 캐주얼 의도).
  - **배치 간격**: `BOT_PLACE_INTERVAL_MIN=800` + `Math.random()*BOT_PLACE_INTERVAL_RANGE(400)` = 800~1200ms/피스. 중력 시뮬레이션 생략(계산 직후 즉시 하드드롭).
  - **메인 루프**: `scheduleNextPiece`/`doPlace`(가비지 먼저 적용 → 탐색 → 락 → 콤보 → GARBAGE_SEND/BOARD_STATE)/`resetBot`/`scheduleRematch`.
  - **봇 송신**: `JOIN{playerName:'AI Bot'}`/`READY`/`GARBAGE_SEND{lines,combo}`/`BOARD_STATE{height,stack:[]}`/`GAME_OVER`/`REMATCH`. **봇 수신**: `JOINED`(→READY)/`START`(→resetBot+루프)/`GARBAGE_RECV`(→pendingGarbage 누적)/`ITEM_EFFECT`(garbage_bomb만 +2)/`GAME_RESULT`(→500ms 후 REMATCH 자동 동의), 나머지(`REMATCH_STATUS`/`ITEM_GRANT`/`SHIELD_BLOCK`/`OPPONENT_BOARD`) 무시.
  - **아이템 의도적 비대칭**: `garbage_bomb`만 봇 보드에 반영, `dark`/`freeze`는 무시(봇은 시뮬레이터만 보고 중력 타이머 없음 → 사람이 아이템으로 봇을 교란하는 재미 보존). 미정의 메시지에도 프로세스 안 죽음.
- **`tests/bot-smoke.test.js`** (신규, ad-hoc 노드 러너, 포트 3110) — TBOT-001~005, **8/8 PASS**
  - TBOT-001 mode=ai 진입→봇 자동 spawn→JOINED(p1)→START countdown=3 / TBOT-002 봇 배치→BOARD_STATE→OPPONENT_BOARD 중계 / TBOT-003 사람 GAME_OVER→봇(p2) 승리 GAME_RESULT(topout) / TBOT-004 사람 disconnect→방 초기화(봇 연결 해제) / TBOT-005 사람 REMATCH→봇 0.5초 자동 동의→START 재수신.

### 변경
- **`server.js`**
  - `import fs from 'fs'` + `import { spawn } from 'child_process'` 추가(`spawnBotChild`의 `fs.existsSync` 사용).
  - `createApp(opts)`에 `getBotUrl` 옵션 추가(`typeof opts.getBotUrl === 'function' ? … : (() => null)`).
  - `botChild` 상태 변수 + `spawnBotChild()`(`path.join(__dirname,'bot.js')` spawn, `detached:false`/`stdio:'ignore'`) / `killBotChild()` 함수 추가.
  - `wss.on('connection', (ws, req) => …)`에서 `mode` 쿼리 파싱(`wsMode`/`isBot`). `handleUpgrade`는 이미 `req` 전달 중이라 무수정.
  - Player typedef에 `mode: string` 필드 추가.
  - JOIN case에서 `wsMode==='ai' && !isBot && players.length===1` 시 200ms 후 `spawnBotChild()`(사람 단독 대기 보장).
  - close 핸들러에서 `!isBot`이면 `killBotChild()`(사람 disconnect 시 봇 프로세스 종료).
- **`public/index.html`**: `.center-area`에 `<button id="ai-start-btn" class="ai-start-btn">🤖 AI랑 시작</button>` 추가.
- **`public/js/network.js`**: `connect()`에서 `mode` 쿼리 파싱 + `sessionStorage['tetris:mode']` 보존 → WS URL에 `?mode=ai` 부착. `aiStart()` 헬퍼 추가(sessionStorage 저장 후 `location.href` 재접속).
- **`public/js/main.js`**: `aiStartBtn` 참조. `onJoined`에서 `p1 && waiting && mode≠ai`일 때만 버튼 노출, `onStart`에서 숨김. 클릭 시 `disabled`+"🤖 AI 호출 중..." 후 `net.aiStart()`.
- **`public/css/style.css`**: `.ai-start-btn` 클래스(녹색 `#2ecc71`, `.primary-btn`과 동일 톤/크기, `:hover`/`:disabled`/`.hidden`).
- **`launcher/server.js`**: `createTetrisApp({ getBotUrl: () => 'ws://localhost:${PORT}/tetris-battle/ws?mode=bot' })` 주입(통합 모드에서도 봇 spawn).

### 함정 회피 (Planner 식별 6건, QA 확인)
- `server.js` `fs` 미import → 추가 / `BOARD_HEIGHT(22)` vs `VISIBLE_HEIGHT(20)` 혼동 → `getStackHeight` VANISH_ZONE부터 스캔·`evaluateBoard` `BOARD_HEIGHT-r` 보정 / `botCombo` 초기값 **-1**(첫 클리어 `comboBonus(0)=0`, resetBot도 -1) / `connection (ws, req)` 시그니처로 mode 파싱 / spawn 타이밍은 JOIN 직후 200ms 지연 / `network.aiStart` 반환 객체 노출.

### 검증
- **회귀 9 슈트 (포트 3055 격리)**: phase1-unit 57 / phase1-ws 37 / phase2-items 51 / phase2-edge 14 / phase3-polish 14 / phase4-launcher 20 / phase5-vanish-zone 52 / phase5-qa-edge 71 = 전부 PASS. phase3-4-qa-edge는 20 PASS / 1 FAIL(Q7b).
- **신규 봇 smoke (포트 3110)**: bot-smoke 8/8 PASS.
- **합계: 344 PASS / 1 FAIL(Q7b)**. blocker 0건, 봇 작업으로 새로 유발된 결함 0건.

### 알려진 이슈 (봇 무관 기존 결함)
- **phase3-4-qa-edge Q7b** — `printBanner` 검증 정규식 `/function printBanner[\s\S]+?\n\}/`이 **비탐욕**이라 함수 경계를 넘어 뒤따르는 기존 주석 `// ── 서버 시작 ──`(유니코드 `─`)까지 매칭 → 박스 문자 오검출. **baseline(봇 작업 이전 git HEAD)에서도 동일 실패**하며 실제 배너 출력은 ASCII라 기능 무해. 코더 봇 섹션(server.js 상단 import/spawnBotChild)은 정규식 매칭 범위(printBanner 본문) 밖. 회귀 게이트 슈트 임의 수정 금지 원칙상 미수정 — 정규식을 printBanner 함수 경계로 한정하는 별도 보정 이슈로 분리 권장.

### 참고
- 스펙: `.claude/specs/2026-06-21-tetris-bot-spec.md`
- 구현 리포트: `.claude/specs/2026-06-21-tetris-bot-report.md`
- QA: `.claude/specs/2026-06-21-tetris-bot-qa-report.md` (QA PASS — blocker 0)

---

## [2026-06-17] C — 초대 패널 제거 후속(회귀 테스트 단언 전환)

### 배경
- 공통 작업 C(미니게임 전반 초대 주소 패널 제거 → P1/P2 ready 패턴 통일)로 tetris-battle의 초대 패널(`#invite-panel`/copy 버튼)·관련 ui.js 함수가 이미 제거된 상태. 그로 인해 "제거된 DOM/함수의 **존재**"를 단언하던 회귀 슈트가 깨짐.
- C 작업 본체(`public/index.html`·`css/style.css`·`js/{main,ui}.js`의 invite 제거, `#toast`/`showToast`/서버 hostUrl은 유지)는 이미 구현 완료분 — 본 후속은 테스트/문서만 갱신.

### 변경
- `tests/phase4-launcher.test.js`: L4/L4b/L5/L7a/L7b/L7c/L7e를 invite-panel/copy-url-btn/showInvitePanel 등의 "존재" 단언 → **"제거됨을 검증하는 positive 단언"으로 전환**(다시 추가되면 FAIL). L6(`#toast`)·L7d(`showToast`)·L8(hostUrl)·L9(bat)·L1~L3(서버 JOINED)는 여전히 유효해 보존.
- `tests/phase3-4-qa-edge.test.js`: Q6a~Q6d(ui.js 클립보드 fallback 존재 단언)를 copyToClipboard/navigator.clipboard/execCommand "제거됨" 단언으로 전환.
- `CLAUDE.md`: 회귀 게이트에 "사용자 승인 기능 제거 시 단언 전환 허용" 예외 1줄 추가.

### 검증
- tetris 9 슈트 격리 포트 3055 실행: **336 PASS / 1 FAIL**. 전환분(L4/L4b/L5/L7a~c/L7e + Q6a~d 11건) 전부 PASS.
- 유일 FAIL(Q7b)은 invite 무관 **사전 결함** — server.js `printBanner` 함수 본문 주석의 박스문자(U+2500 `─`)를 Q7b 정규식이 매칭. 실제 배너 출력은 ASCII(`+ - |`)라 기능상 무해(false-positive). C 작업 이전 커밋부터 존재(기존 "337/337" 표기는 stale). server.js 무수정 정책 + 범위 밖이라 미수정(별도 트래킹 권장).
- omok smoke 106/106, WS upgrade, POST /lobby/return 204 무영향. QA PASS, AD 미해당(테스트/문서만).

## [2026-05-25] Phase 5 — Vanish Zone 게임오버 판정 버그 수정

### 배경
- **사용자 신고 버그**: 친구와 플레이 중, 보드 상단에 2~3줄 비어있는 상태인데도 매판 즉시 게임오버 판정. 한게임 테트리스에서는 발생하지 않는 비표준 거동.
- **원인**: `BOARD_HEIGHT = 20` 단일 영역만 사용 → 새 피스가 visible top(`grid[0]`)에서 스폰되므로, visible top까지만 차오른 상태에서도 피스 매트릭스 row 0/1이 기존 블록과 겹쳐 즉시 토프아웃 트리거.

### 수정
- **표준 SRS / 한게임 스타일 Vanish Zone 도입** (`public/js/board.js`)
  - `BOARD_HEIGHT = 22` (데이터 영역, 기존 20에서 +2)
  - `VISIBLE_HEIGHT = 20` (시각 영역, 신규 export)
  - `VANISH_ZONE = 2` (상단 hidden zone, 신규 export)
  - 피스는 hidden zone(`grid[0]`, `grid[1]`)에서 스폰 → visible top까지 차도 즉시 게임오버되지 않음
  - 게임오버는 hidden zone까지 가득 차서 스폰 충돌 시에만 트리거 (옵션 1)
- **`getStackHeight` / `getColumnHeights` 변경** (`public/js/board.js`)
  - visible 영역(`r >= VANISH_ZONE`)만 측정. 미니맵에 hidden zone 잔존 블록 노출 방지
- **렌더링 분리** (`public/js/ui.js`)
  - `boardCanvas.height = VISIBLE_HEIGHT * CELL_SIZE` → **600px 유지** (캔버스 픽셀 크기 변화 없음)
  - `renderBoard` 셀 루프 `r >= VANISH_ZONE`부터, 좌표는 `(gridRow - VANISH_ZONE) * CELL_SIZE`로 보정
  - 활성 피스/고스트 피스의 hidden zone 부분(`gy < 0`)은 렌더링 스킵
  - 미니맵 그리드/스택 막대도 `VISIBLE_HEIGHT` 기준
- **`createPiece` 미변경** (`public/js/tetromino.js`): `y: 0` 그대로 → 자동으로 hidden zone 상단에서 스폰
- **`game.js` / `items.js` / `server.js` 미변경**: 보드 데이터 영역(`BOARD_HEIGHT`) 기준 알고리즘 자동 호환

### 추가
- **`tests/phase5-vanish-zone.test.js`** 신규 (52 PASS)
  - V1~V9: 상수 무결성, 차원, 7종 스폰, visible 가득+hidden 빈 상태 스폰 가능, 보드 전체 가득 시 게임오버, `getStackHeight`/`getColumnHeights` visible 기준, `addGarbage` hole 일관성, `lockPiece` hidden zone 기록, `clearLines` hidden zone 처리
- **`tests/phase5-qa-edge.test.js`** 신규 (71 PASS, QA 작성)
  - QE1~QE17: 사용자 신고 버그 재현 시나리오(QE3) 포함 7종 능동 엣지케이스 → 영구 회귀 차단

### 변경
- **`tests/phase1-unit.test.js`** (57 PASS, +5 시나리오)
  - `BOARD_HEIGHT=20` 가정의 하드코딩(`grid[19]`, `r=16..19`, `ghostY===18`, `p.y=17/18`)을 `BOARD_HEIGHT-N` 동적 인덱스로 갱신
  - "Vanish Zone — hidden zone 블록은 미니맵 높이에서 제외", "Vanish Zone 상수 무결성" 섹션 추가

### 검증
- **사용자 신고 버그 재현 안 됨** (QE3에서 7종 피스 모두 visible top 가득 + hidden zone 빈 상태에서 정상 스폰 확인)
- 보드 전체 가득(hidden + visible)에서만 게임오버 정상 트리거 (V5, QE5)
- 캔버스 픽셀 크기(600x600) / 미니맵 크기(120x240) 동일 유지 → board-wrap / 콤보 인디케이터 / freeze badge / dark overlay 자식 요소 회귀 없음

### 테스트
- **전체 337/337 PASS** (회귀 7 슈트 + Phase5 vanish-zone 52 + QA edge 71)
- 기존 7 슈트는 207 → 자동 호환 + phase1-unit 5건 추가 = 214
- 신규 phase5-vanish-zone 52 + phase5-qa-edge 71 = 123
- 214 + 123 = 337

### 알려진 이슈
- **MEDIUM (1건, WONTFIX)**: `game.js` `receiveGarbageImmediate`에서 piece.y가 음수로 밀려나도 isColliding 통과 시 매우 큰 lines 값(>= BOARD_HEIGHT)에서 피스가 보드 밖으로 사라질 수 있음. 현재 `GARBAGE_BOMB_LINES=2` 제약으로 실사용 영향 없음. 옵션 2(표준 SRS lock-out) 도입 시 자연 해소.

### 참고
- Coder: `.claude/specs/2026-05-25-tetris-battle-phase5-coder-report.md`
- QA: `.claude/specs/2026-05-25-tetris-battle-phase5-qa-report.md`

---

## [2026-05-25] Phase 4 revise1 — 포트 폴백 HIGH-1 수정

### 수정
- **HIGH-1: 포트 충돌 자동 폴백 미동작 해결** (`server.js`)
  - `wss = new WebSocketServer({ server })`가 HTTP server를 공유하여 EADDRINUSE 시 server와 wss 양 채널에서 별도 error를 emit. 기존 코드는 server 채널만 핸들링하여 wss의 unhandled error로 프로세스가 즉시 종료됨 → 폴백 `setTimeout(startListening, +1)` 미실행.
  - 수정: `startListening` 함수에 `wss.once('error', onError)` 추가 + `handled` 가드 플래그로 폴백 단일 실행 보장. 첫 onError 진입 시 양 채널 리스너 동시 제거.
- **QA 슈트 보강** (`tests/phase3-4-qa-edge.test.js`)
  - Q1 blocker host bind를 `0.0.0.0`(ipv4-only)에서 dual-stack 기본(`::`)으로 변경 → 실 EADDRINUSE 재현 가능.
  - 평가 분기 순서를 `fallbackPortOk` 우선으로 재배치하여 SIGKILL 잔류 시 false-negative 회귀 차단.

### 테스트
- **전체 207/207 PASS** (회귀 6 슈트 186 + qa-edge 21)
- Q1a/Q1b가 FAIL → PASS로 전환

### 참고
- QA(1차): `.claude/specs/2026-05-25-tetris-battle-phase3-4-qa-report.md` (HIGH-1 발견)
- Coder 재수정: `.claude/specs/2026-05-25-tetris-battle-phase4-coder-revise1-report.md`

---

## [2026-05-25] Phase 4 — 런처 / 호스트 안내 UX

### 추가
- **`start.bat`** (Windows 더블클릭 런처)
  - `chcp 65001`로 UTF-8 콘솔 설정
  - 새 콘솔 창에서 `node server.js` 기동 + 2초 대기 후 `start "" http://localhost:3000`으로 기본 브라우저 자동 오픈
  - Node.js 미설치 감지 시 안내 후 종료
  - ASCII-only (cmd.exe 인코딩 안전성)
- **`stop.bat`** (포트 기반 정확한 종료)
  - `netstat -ano | findstr ":port "` + LISTENING 상태 필터로 3000~3010 PID만 종료
  - 다른 프로젝트 node.exe 프로세스 보호 (TIME_WAIT 무시)
  - MAX_PORT_FALLBACK=10과 범위 일치
- **`server.js` LAN 안내 시스템**
  - `os.networkInterfaces()` 기반 LAN IP 자동 감지 + Wi-Fi/이더넷 우선 + 가상 어댑터(vEthernet, VirtualBox, VMware, Hyper-V, WSL) 후순위 정렬
  - ANSI 컬러 박스 출력(`printBanner`): 호스트/친구 접속 URL 분리 표시, 가상 어댑터에 "(가상)" 태그
  - `supportsAnsi()` TTY 감지 (NO_COLOR, TERM=dumb, !isTTY 시 컬러 OFF)
  - 박스 너비 56, ASCII `+/-/|` 사용 (cmd 949 코드페이지 호환)
- **`JOINED` 메시지 `hostUrl` 필드** (`server.js` / `network.js`)
  - 서버 부팅 시 우선순위 1위 LAN IP로 `HOST_URL` 결정 (없으면 `http://localhost:{port}` 폴백)
  - 클라이언트 `network.js`가 `onJoined` 콜백에 그대로 전달
- **초대 패널 UI** (`index.html` / `ui.js` / `css/style.css`)
  - 대기 화면 중앙에 `#invite-panel` (라벨 + 큰 URL + 복사 버튼 + 힌트)
  - `showInvitePanel(hostUrl)` / `hideInvitePanel()` (게임 시작 시 자동 숨김)
  - `bindCopyUrlButton()` + `copyToClipboard()` (navigator.clipboard 우선 + textarea/execCommand 폴백)
  - `showToast(text, kind)`: bottom 48px 중앙, z-index 200, success/error 색상 변형
- **포트 충돌 자동 폴백** (`server.js`)
  - 3000 사용 중이면 3001 → 3002 → ... 최대 3010까지 100ms 간격 재시도
  - 박스에 `* 요청 포트 3000 사용 중 → 3001로 폴백` 명시
  - ⚠️ Phase 4 1차 구현은 wss 채널 error 미처리로 실 동작 실패 → revise1에서 수정
- **`tests/phase4-launcher.test.js`** (20/20 PASS)
  - L1~L9: WS hostUrl, invite 마크업, ui.js 함수, start/stop.bat 존재 + 핵심 명령 포함

### 변경
- **README.md** "빠른 시작 (Phase 4 — 더블클릭 한 방)" 섹션 추가, 박스 ASCII 예시, 포트 충돌 안내

### 참고
- Scope: `.claude/specs/2026-05-25-tetris-battle-scope.md`
- Plan: `.claude/specs/2026-05-25-tetris-battle-plan.md` (Phase 4)
- Coder: `.claude/specs/2026-05-25-tetris-battle-phase4-coder-report.md`
- AD3: `.claude/specs/2026-05-25-tetris-battle-phase4-ad-mode3-report.md`

---

## [2026-05-25] Phase 3 — 폴리시 + 결함 수정

### 추가
- **카운트다운 펄스 애니메이션** (`main.js` / `style.css`)
  - 3-2-1-GO 단계, `countdown-pulse 0.45s ease-out`
  - GO 시 font-size 80px + win 컬러 + letter-spacing 6px
- **다크 오버레이 페이드** (`style.css`)
  - 즉시 토글 → `opacity 0→0.78 350ms ease-in-out`
- **방어막 시각 피드백** (`ui.js` / `items.js` / `style.css`)
  - `flashShield(on, message)`로 텍스트 동적 전달 ("방어막 발동!" / "방어막 차단!")
  - `showBoardNotice(text, kind, durationMs)` 동적 DOM 생성, 1000ms 자동 제거
  - `shield-flash 1s` keyframes (보드 외곽 셰도우 펄스)
- **가비지 폭탄 보드 흔들림** (`ui.js` / `style.css`)
  - `shakeBoard()`: classList 제거 → reflow → 추가 → animationend 1회 핸들러 cleanup
  - `board-shake 0.2s` ±4px
- **HUD 안정성 보강** (`style.css`)
  - `.stat-value`에 `font-variant-numeric: tabular-nums` (점수 들썩임 제거)
  - 라벨 `font-weight: 600`
- **결과 화면 슬롯 비활성화** (`ui.js` / `style.css`)
  - `setItemSlotsInteractive(false)` → `pointer-events: none` + opacity 0.4
- **입력 지연 / FPS 측정 도구** (`main.js`)
  - `window.__perf.report()` 콘솔 노출
  - capture 단계 keydown 시각 기록 + rAF 다음 tick까지 ms 측정
  - rAF dt 샘플링 (탭 비활성 시 500ms 초과 샘플 제외)
- **`tests/phase3-polish.test.js`** (14/14 PASS)

### 수정
- **MED-1: Single 라인 클리어 시 ITEM_GRANT 트리거** (`game.js` / `server.js`)
  - 기존: `garbage == 0`이면 `onAttack` 미호출 → 서버가 ITEM_GRANT 추첨 못 함
  - 수정: `cleared > 0`이면 `onAttack(0, combo)` 호출. 서버는 `safeLines > 0`일 때만 GARBAGE_RECV 중계, `tryGrantItem(player)`는 lines와 무관하게 매번 시도
- **LOW-1: 서버 GARBAGE_SEND 입력 클램프** (`server.js`)
  - `safeLines = clamp(0, 20)`, `safeCombo = clamp(0, 99)` (NaN/음수/거대값 방어)
- **LOW-2: GAME_OVER 후 메시지 차단** (`server.js`)
  - `player.gameOver` 플래그 + `isRoomPlaying()` 가드
  - ITEM_USE / GARBAGE_SEND / 중복 GAME_OVER 모두 차단
  - `resetRoomFlags()`에서 `gameOver=false`로 복원, 재대결 후 `ready=true` 복원
- **LOW-3: 결과 화면 시 items.reset 호출** (`main.js`)
  - `onResult` 핸들러에서 `items.reset()` → 다크/프리즈/방어막 잔존 방지
- **LOW-4: 프리즈 중 슬롯 클릭 차단** (`items.js` / `input.js`)
  - `useItem()` 진입 시 `deps.input.isFrozen()` 검사 후 차단
  - `isFrozen()` 헬퍼 export

### 변경 (AD3 4차 검수 결과 반영)
- **다크 아이콘 색상**: `--item-dark` `#cfcfff` → `#9090cc` (HUD 텍스트와 명도 차이 확보)
- **아이템 5종 색상 CSS 변수화**: `--item-garbage`, `--item-dark`, `--item-freeze`, `--item-lineclear`, `--item-shield`

### 테스트
- 166/166 PASS (회귀 5 슈트)

### 참고
- Coder: `.claude/specs/2026-05-25-tetris-battle-phase3-coder-report.md`
- AD3: `.claude/specs/2026-05-25-tetris-battle-phase3-ad-mode3-report.md`
- QA: `.claude/specs/2026-05-25-tetris-battle-phase3-4-qa-report.md`

---

## [2026-05-25] Phase 2 — 아이템 시스템 5종

### 추가
- **`public/js/items.js`** (신규 생성)
  - 5종 ITEMS 정의 + 슬롯 배열(3)
  - `useItem` / `grantItem` / `applyEffect` / `triggerShield` / `tryBlockWithShield` / `onShieldBlocked` / `reset`
  - 다크 5000ms + 프리즈 3000ms setTimeout 자동 해제
  - `findEmptySlot()` 폴백 (서버-클라 슬롯 상태 불일치 보호)
- **서버 아이템 권위 처리** (`server.js`)
  - 상수: `ITEM_IDS`, `ITEM_DURATIONS`, `MAX_ITEM_SLOTS = 3`, `ITEM_GRANT_PROB = 0.5`
  - `pickRandomItem()` / `tryGrantItem(player)` (슬롯 가득 시 미지급)
  - GARBAGE_SEND 핸들러에서 송신자에게 50% 확률 ITEM_GRANT 발송
  - ITEM_USE 분기: 공격형(garbage_bomb/dark/freeze) → 상대 ITEM_EFFECT 또는 양쪽 SHIELD_BLOCK / `shield` → 자기 shieldActive 설정 / `line_clear` → 송신자 슬롯 차감만
  - `Player` typedef에 `shieldActive`, `slotCount` 필드 추가
- **클라이언트 아이템 시스템**
  - `network.js`: `onItemGrant` / `onItemEffect` / `onShieldBlock` 콜백 (placeholder console.log 제거)
  - `input.js`: `ITEMS_ENABLED = true` 토글, ArrowUp만 시계 회전 (X 분리), Z=슬롯0/X=슬롯1/C=슬롯2
  - `main.js`: `createItems()` 인스턴스, START 시 `items.reset()`, ui에 슬롯 클릭 바인딩
  - `game.js`: `receiveGarbageImmediate(lines)` (가비지 폭탄, 활성 피스 위로 보정 + 토프아웃 검사), `clearBottomLines(lines)` (라인 클리어 방어)
  - `board.js`: `GARBAGE_BOMB_LINES = 2`, `LINE_CLEAR_LINES = 2`, `clearBottomLines(grid, lines)` 입력 sanitize
  - `ui.js`: `renderItemSlots` / `bindItemSlotClick` / `setDarkOverlay` / `setFreezeFeedback` / `flashShield`
- **UI 시각** (`index.html` / `style.css`)
  - `#dark-overlay` (z-index 50, opacity 0.82), `#freeze-badge` (pulse 애니메이션)
  - 5종 아이콘 색상: garbage 회색 / dark 어두운 백 / freeze 시안 / lineclear 녹색 / shield 노랑
  - `shield-flash` 키프레임
- **`tests/phase2-items.test.js`** (51/51 PASS)
  - 단위 35 + WS 동적 9 시나리오 16 assertion
- **`tests/phase2-edge.test.js`** (14/14 PASS)
  - 동시 공격, 슬롯 가득, GAME_OVER 후 ITEM_USE 등

### 변경
- **README.md**: Phase 2 표시, 키 매핑(Z/X/C 슬롯 분리), 아이템 5종 표 + 방어막 권위 설명, items.js 구조 추가

### 참고
- Coder: `.claude/specs/2026-05-25-tetris-battle-phase2-coder-report.md`
- Coder revise1: `.claude/specs/2026-05-25-tetris-battle-phase2-coder-revise1-report.md`
- AD3: `.claude/specs/2026-05-25-tetris-battle-phase2-ad-mode3-report.md` (+ recheck)
- QA: `.claude/specs/2026-05-25-tetris-battle-phase2-qa-report.md`

---

## [2026-05-25] Phase 1 — 코어 게임 + LAN 연결

### 추가
- **프로젝트 초기화**
  - `package.json` (ESM, ws ^8.18.0 + express ^4.21.0, Node 18+)
  - `npm install` (69 packages, 0 vulnerabilities)
- **`server.js`** (WebSocket + Express 정적 서빙, 단일 포트)
  - 2인 1룸 고정, JOIN/READY/START/GARBAGE/GAME_OVER/REMATCH 라우팅
  - `--port` 옵션 (기본 3000)
  - LAN IP 자동 감지 + 콘솔 안내
  - 3번째 접속 시 "Room is full" 후 close
  - 연결 해제 시 상대에게 `GAME_RESULT { reason: "disconnect" }` 전송
- **클라이언트 7개 모듈** (`public/js/`)
  - `main.js` (193행): 진입점, UI/Game/Input/Network 와이어업, 카운트다운 3초
  - `game.js` (391행): rAF 루프, 상태 머신, 중력/Lock Delay/소프트드롭/하드드롭/홀드, 점수/콤보
  - `tetromino.js` (304행): 7종 4회전 행렬, Fisher-Yates 7-bag, 색상 인덱스
  - `board.js` (197행): grid[20][10], 충돌/락/라인 제거/가비지(동일 hole)/고스트/변환표/콤보 보너스
  - `input.js` (218행): DAS 167ms + ARR 33ms (setTimeout/setInterval), 소프트드롭 폴링
  - `network.js` (146행): WS 클라이언트, 3초 후 1회 재연결
  - `ui.js` (289행): Canvas 보드/NEXT/HOLD, 고스트 알파 25%, HUD/콤보/결과 오버레이/미니맵
- **UI** (`index.html` 101행 + `css/style.css` 342행)
  - HUD: HOLD/SCORE/LEVEL/LINES/ITEMS
  - 메인 보드 Canvas + NEXT 3개 + 중앙 VS/카운트다운/버튼
  - 상대 미니맵 (컬럼별 높이 막대)
  - 결과 오버레이 (win/lose 색상)
- **README.md** (173행): 설치, 실행, IP 확인, 방화벽 안내, 키 매핑, 규칙, 트러블슈팅, 프로젝트 구조
- **`tests/phase1-unit.test.js`** (50/50 PASS): 7-bag, 충돌, 라인 클리어, 가비지, 콤보, 회전, 색상 매핑
- **`tests/phase1-ws.test.js`** (37/37 PASS): JOIN/READY/START, 가비지 중계, REMATCH, room full, JSON 안전성

### 게임 규칙
- 보드 10×20, 7-bag 랜덤
- Lv1 중력 1000ms/줄 → 레벨업당 100ms 감소 (최소 100ms)
- 점수: Single 100 / Double 300 / Triple 500 / Tetris 800 (× 레벨)
- 가비지 변환표: Single=0, Double=1, Triple=2, Tetris=4 + 콤보 +0.5/콤보 반올림
- DAS 167ms / ARR 33ms / Lock Delay 500ms / 고스트 알파 25%
- 게임 오버: 스폰 위치 충돌(토프아웃)

### Phase 2 사전 준비
- `network.js`에 ITEM_GRANT/ITEM_USE/ITEM_EFFECT/SHIELD_BLOCK 수신 핸들러 placeholder
- `input.js`에 Z/X/C 자리 + `ITEMS_ENABLED` 플래그
- `index.html`/`style.css`에 아이템 슬롯 영역(`.item-slots`, `.item-slot[data-slot]`)

### 알려진 제약 (Phase 1 명시)
- SRS 벽킥 미구현 (단순 회전)
- T-spin / Perfect Clear 미감지
- 콤보 시작값 `-1` (첫 클리어 보너스 0, 표준 방식)

### 참고
- Scope: `.claude/specs/2026-05-25-tetris-battle-scope.md`
- Plan: `.claude/specs/2026-05-25-tetris-battle-plan.md`
- Coder: `.claude/specs/2026-05-25-tetris-battle-phase1-coder-report.md`
- Coder revise1: `.claude/specs/2026-05-25-tetris-battle-phase1-coder-revise1-report.md`
- AD3: `.claude/specs/2026-05-25-tetris-battle-phase1-ad-mode3-report.md` (+ recheck)
- QA: `.claude/specs/2026-05-25-tetris-battle-phase1-qa-report.md`
