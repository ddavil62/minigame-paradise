# Omok — 프로젝트별 작업 컨벤션

> LAN 1:1 표준 오목(19×19). Node.js + 바닐라 JS + Canvas. **1차 코어 완료 (2026-06-15)** + **쌍삼·사사 금수 + 세션 유지 리매치 (2026-06-15)**. 미니게임 천국 10번째 종목.

## 정체성

- **목적**: LAN으로 즉시 즐기는 표준 오목. **쌍삼(33)·사사(44) 금수 적용**(흑·백 양쪽 동일), 5목 이상 연속 승리, **장목(6목 이상)도 승리**(반칙 아님).
- **레포 관리**: lazyslimestudio 하위 폴더(`omok/`)로 관리.
- **기술**: Node 18+ (ESM), 순수 `node:http` + `ws` 8 (Express 미사용), 바닐라 JS + HTML5 Canvas.
- **외부 에셋**: 0. 바둑판(나뭇결·격자·화점·좌표 라벨)은 Canvas 2D, UI는 CSS 우드 테마.

## 게임 룰 (표준 오목, 쌍삼·사사 금수)

| 항목 | 규칙 |
|---|---|
| 보드 | 19×19 (361 교차점) |
| 선공 | 흑(p1) |
| 승리 | 가로/세로/대각 4방향 중 **5목 이상 연속** |
| 장목 | 6목 이상도 **승리**(반칙 아님 — 장목 제한 없음) |
| 쌍삼(33) 금수 | 한 착수로 **열린3(`_XXX_`) 2개 이상** 동시 생성 시 **착수 거부**(board/moveCount 원복, ERROR 토스트, 게임 계속) |
| 사사(44) 금수 | 한 착수로 **4목(정확히 len===4) 2개 이상** 동시 생성 시 **착수 거부**(동일 원복) |
| 금수 적용 대상 | **흑·백 양쪽 동일** |
| 승리 우선순위 | **5목+ 완성 수는 33/44 동시여도 승리**(금수 검사보다 `checkWin`을 먼저 호출) |
| 무승부 | 361칸 전부 점령 시 draw |
| 기권 | RESIGN → 즉시 상대 승 |

> ⚠️ **쌍삼·사사만 금지**하는 룰이다(정통 렌주룰의 흑 전용 금수가 아님 — 흑/백 동일 적용). 핵심 불변식:
> - **장목은 허용**(승리). `checkWin`은 `count >= 5`로 판정하며 장목을 미결로 처리하지 않는다.
> - **승리가 금수보다 우선**. `placeStone`은 `checkWin` → 금수검사 순서를 지켜야 한다(5목+ 완성 수는 금수여도 승리).
> - **금수 검사는 "방금 착수한 칸이 기여한" 연속만 카운트**한다(`isOpenThree`/`isFour`가 (row,col) 포함 정/역방향 연속만 측정). 보드 전체의 무관한 3목/4목은 세지 않는다.

## 핵심 설계 원칙

1. **서버 권위 (Server Authoritative)**
   - 착수 검증 + 승리/금수/무승부 판정 모두 서버 `game.js` 순수 함수(`placeStone`/`checkWin`/`checkDoubleThree`/`checkDoubleFour`/`checkDraw`).
   - `placeStone` 검사 순서: **기존검증(차례·점령·범위) → 가상착수 → `checkWin` → `checkDoubleThree` → `checkDoubleFour`(거부 시 board/moveCount 원복) → `checkDraw` → 턴교대**.
   - 클라는 교차점 클릭 좌표만 전송(`PLACE { row, col }`). 좌표 유효성·차례·점령·금수 여부는 서버가 최종 권위. 금수 거부 시 `ERROR` 송신(게임 계속).
2. **정보 비대칭 없음** — 양쪽이 동일한 STATE를 받는다(snapshot 마스킹 불필요).
3. **게임 로직 분리** — `game.js`는 서버 불필요 순수 함수(단위 테스트 가능), `server.js`는 `createApp()` factory가 `{ handleHttp, handleUpgrade, setHostUrl }` 반환(WS noServer 모드).
4. **입력 가드** — `placeStone`은 `Number.isInteger` + 범위 검사로 NaN/소수/문자열/범위 밖 좌표를 전부 차단.
5. **포트 충돌 자동 폴백** — 단독 실행 기본 포트 **3012**, `MAX_PORT_FALLBACK=10`.

## 디렉토리

```
omok/
├── game.js                  # 순수 게임 로직 (createGame/placeStone/applyResign/snapshot/checkWin/checkDoubleThree/checkDoubleFour/checkDraw + isOpenThree/isFour 내부 헬퍼)
├── server.js                # WS 서버 + createApp + 단독 실행 + 봇 spawn/kill + 좀비 슬롯 청소 + heartbeat 30초 + 리매치(rematchPending/lastGameResult/swapColorsForRematch)
├── bot.js                   # AI 봇 (mode=ai 시 server가 child_process로 spawn) + 자동 리매치 동의(scheduleRematch)
├── package.json             # { "type": "module" } + ws
├── playwright.config.js     # E2E 스켈레톤 (baseURL 3012)
├── CLAUDE.md                # 본 문서
├── public/
│   ├── index.html           # 대기·게임·종료 화면, 상태 바, 초대 URL, AI랑 시작, 룰 요약(장목 승리 + 쌍삼·사사 금수), "한 판 더" 버튼
│   ├── css/style.css        # 우드 테마 (색상 변수 :root) + .rematch-requested 맥동 강조
│   └── js/
│       ├── main.js          # 진입점. 화면 전환, lastMove diff 추정, 내 턴 클릭 가드, 종료 오버레이, 리매치 동의/색 swap 핸들러(location.reload 없음)
│       ├── network.js       # WS 클라이언트. seg 기반 wsPath, omok:mode sessionStorage, route/send + REMATCH/REMATCH_WAITING/REMATCH_START
│       └── board.js         # Canvas 보드(728px), 격자·화점·좌표 라벨·돌 그라디언트·승리선·canvasToCell
└── tests/
    ├── smoke.test.js         # OMOK-001~012 (106건, 포트 3105 — +OMOK-008~012 금수 거부/5목 우선/WS 리매치+색 swap)
    ├── bot-smoke.test.js     # OMOK-BOT-001~004 (14건, 실제 봇 spawn, 포트 3106 — +004 봇 자동 리매치 동의)
    ├── qa-edge.test.js       # 경계/입력/snapshot + 금수 능동 공격 (35건, QA 작성 — +QA-R1~R6)
    ├── qa-draw-bot.test.js   # draw 결정적 검증 + 봇 휴리스틱 (9건, QA 작성)
    ├── qa-renju-attack.test.js  # 금수 능동 공격 (28건, QA 작성 — 닫힌3 비금수/장목 승리/5목+33 승리/경계 래핑/흑백 양쪽)
    ├── qa-rematch-attack.test.js # 리매치 능동 공격 (14건, QA 작성 — 색 swap/WAITING/START/원복)
    ├── omok-e2e-qa.spec.js   # E2E 3건 (대기/AI진입·착수·봇응수/여백클릭무시, Playwright)
    └── omok-mobile-qa.spec.js # 모바일 360x640 1건 (Playwright)
```

## Canvas 레이아웃 상수 (`public/js/board.js`)

| 상수 | 값 | 의미 |
|---|---|---|
| `BOARD_SIZE` | 19 | 한 변 교차점 수 |
| `CELL` | 36 px | 교차점 간격 |
| `MARGIN` | 40 px | 좌우/상하 여백(좌표 라벨 영역) |
| `CANVAS_SIZE` | 728 px | `CELL*(19-1) + MARGIN*2` |
| `STONE_R` | 15 px | 돌 반지름(지름 30 < CELL 36, 겹침 없음) |
| `LAST_MOVE_COLOR` | `#C8102E` | 마지막 착수 빨간 점(CSS `--accent`와 통일 — AD F-01) |

- 교차점→화면: `x = MARGIN + col*CELL`, `y = MARGIN + row*CELL`.
- 화면→교차점: `Math.round((x-MARGIN)/CELL)` + 허용 반경 `±CELL/2`(여백 오클릭 방지).
- 모바일 축소: CSS `max-width/max-height: 90vmin` → `canvasToCell`이 표시 크기/내부 해상도(728) 스케일 보정.

## WebSocket 메시지 프로토콜

| 방향 | 메시지 | 페이로드 | 설명 |
|---|---|---|---|
| C→S | `JOIN` | `{ playerName? }` | 입장 |
| C→S | `PLACE` | `{ row, col }` | 착수(서버가 차례·점령·범위·금수 검증) |
| C→S | `RESIGN` | `{}` | 기권 |
| C→S | `REMATCH` | `{}` | 한 판 더 동의(종료 후 양쪽 동의 시 재시작) |
| S→C | `JOINED` | `{ playerId, waiting, hostUrl, color? }` | 입장 확인. 리매치 시 `waiting=false` + 갱신 `color`만 송신(화면 전환 생략, color/라벨만 갱신) |
| S→C | `GAME_START` | `{ phase: 'playing' }` | 게임 시작(양쪽 입장 시) |
| S→C | `STATE` | `{ board, currentTurn, moveCount, lastMove, phase }` | 보드 상태 |
| S→C | `GAME_OVER` | `{ winner, reason, winLine? }` | 종료. `reason`: `five`(5목 이상)/`resign`/`draw`. `winner`: `black`/`white`/`draw` |
| S→C | `REMATCH_WAITING` | `{ ready }` | 한쪽만 동의한 상태(상대 동의 대기). 버튼 비활성·맥동 강조 |
| S→C | `REMATCH_START` | `{ nextBlack }` | 양쪽 동의 → 새 판. `nextBlack`=다음 흑이 될 playerId. myColor/playerLabel 갱신 + 빈 보드 |
| S→C | `OPPONENT_LEFT` | `{}` | 상대 이탈(game=null 초기화) |
| S→C | `ERROR` | `{ message }` | 잘못된 착수/금수/정원 초과 등(게임 계속) |

- WS path: 통합 모드 `/omok/ws`, 단독 모드 `/ws`(network.js seg 분기). `mode` 쿼리는 `sessionStorage` `omok:mode`로 새로고침 보존.
- 리매치 브로드캐스트 순서: `REMATCH_START` → `JOINED`(갱신 color)×2 → `GAME_START` → `STATE`(빈 보드).

## 세션 유지 리매치 (`location.reload()` 제거)

종료 후 "한 판 더"는 **WS 연결을 유지한 채** 양쪽 동의 시 재시작한다(이전 `location.reload()` 방식 폐기 — 재연결 없음).

- 한쪽이 버튼 클릭 → `REMATCH` 송신. 서버는 `rematchPending` Set에 추가하고 상대에게 `REMATCH_WAITING` 브로드캐스트(버튼 비활성 + `.rematch-requested` 맥동 강조). `main.js`는 `rematchRequested` 가드로 중복 클릭 차단.
- 양쪽 모두 동의하면 서버가 `swapColorsForRematch()`(아래 규칙) + `createGame()` 재생성 → `REMATCH_START` 브로드캐스트 → 새 판 시작.
- **선공(다음 흑) 규칙** (`lastGameResult` 기반, p1/p2 **id 불변** — `color`만 재배정):
  - 승/패: **진 쪽이 다음 흑**
  - 기권: **기권자가 흑**
  - 무승부: **흑·백 교체**
- **봇 대전**: `GAME_OVER`/`REMATCH_WAITING` 수신 시 `scheduleRematch()`로 0.5초 후 `REMATCH` 자동 송신(타임아웃 보호 10초 재송신 1회). `REMATCH_START`에서 `myColor` 재설정. **종료(process.exit) 안 함** — `OPPONENT_LEFT` 시에만 ws.close → exit(0).

## AI 봇 (`bot.js`)

yahtzee/janggi/rummikub와 동일 `getBotUrl` 옵션 + `child_process.spawn` 패턴:
- launcher 통합: `createOmokApp({ getBotUrl: () => 'ws://localhost:${PORT}/omok/ws?mode=bot' })`
- 1/2 AI 모드 진입(`mode=ai`) → server.js가 `bot.js` 기동 → 봇이 `mode=bot`으로 재접속해 p2 점유 → GAME_START.
- 사람 disconnect 시 봇 child 즉시 kill(자원 누수 없음).
- 대기 화면 "🤖 AI랑 시작" 버튼 → `?mode=ai` 재접속(yahtzee 패턴).

### 봇 휴리스틱 (1수 평가, 캐주얼)

| 단계 | 정책 |
|---|---|
| 첫 수 | 빈 보드(`moveCount===0`)면 천원(중앙) 직행. 전수 평가 시 전부 동점이라 자연스러운 시작점 확보 |
| 전수 평가 | 빈 교차점 361칸 각각에 가상 착수 → **공격 점수(1.0) + 수비 점수(0.9)** 합산, 최고점 선택 |
| 가중치 | `CHAIN_WEIGHT = { 1:1, 2:10, 3:100, 4:1000, 5:100000 }`. 5목 완성 가능 시 무조건 선택, 상대 4목은 0.9×1000으로 차단 |
| 레이스 방어 | `${currentTurn}|${moveCount}` 중복 행동 방지 키 + STATE 도착 시 stale 타이머 취소 |

> 봇은 **1수 휴리스틱(미니맥스 금지)**으로 의도적으로 약하다. open-three(양끝 열린 3목 동시 위협) 대응은 1수 평가 한계상 완벽하지 않음 — 스펙 범위 내.
>
> 룰 일관성을 위해 `bot.js`는 `game.js`를 import하지 않고 동일 룰을 재구현한다. 금수 거부(`ERROR`) 수신 시에도 봇이 멎지 않도록(다른 칸 재시도) 동작해야 한다.
>
> **리매치**: 봇은 `GAME_OVER`/`REMATCH_WAITING` 수신 시 자동으로 `REMATCH`에 동의하고 종료하지 않는다(`scheduleRematch`). 상세는 「세션 유지 리매치」 참조.

## 테스트 실행법

```powershell
cd C:\LazySlimeStudio\minigames\omok
node tests/smoke.test.js              # 106건 (OMOK-001~012, 포트 3105 — +008~012 금수/5목우선/WS 리매치+색swap)
node tests/bot-smoke.test.js          # 14건  (OMOK-BOT-001~004, 실제 봇 spawn, 포트 3106 — +004 봇 자동 리매치)
node tests/qa-edge.test.js            # 35건  (경계 래핑/세로/양대각/코너/오프바이원/잘못된색/비정수좌표/snapshot + QA-R1~R6 금수)
node tests/qa-draw-bot.test.js        # 9건   (361칸 draw 결정적 검증 + 봇 4목차단/5목완성우선/빈칸선택/천원)
node tests/qa-renju-attack.test.js    # 28건  (금수 능동 공격 — 닫힌3 비금수/장목 승리/5목+33 승리/경계 래핑/흑백 양쪽)
node tests/qa-rematch-attack.test.js  # 14건  (리매치 능동 공격 — 색 swap/WAITING/START/원복)
# E2E (Playwright) — 격리 포트 3077에 단독 서버 사전 구동 권장
node server.js --port 3077
npx playwright test tests/omok-e2e-qa.spec.js --config=playwright.config.js   # 3건
npx playwright test tests/omok-mobile-qa.spec.js --config=playwright.config.js # 1건 (360x640)
```

기대: 각 스위트 `PASS=N, FAIL=0`. 합계 **210 / 210 PASS** (smoke 106 + bot-smoke 14 + QA엣지 35 + QA draw/bot 9 + QA 금수공격 28 + QA 리매치공격 14 + E2E 3 + 모바일 1).

> `qa-renju-attack`/`qa-rematch-attack`은 직전 QA 세션이 작성한 능동 공격 스위트로 QA 자산이다(스펙 명시 OMOK-008~012/QA-R1~R6/OMOK-BOT-004 보완). 보존한다.

> ⚠️ WS 시나리오는 포트 3012/3077/3105/3106을 일시적으로 사용한다. 사용자 launcher(3000)와 다른 게임 서버는 영향받지 않는다. bot-smoke는 실제 `child_process`로 봇을 spawn하므로 봇 사고 지연(0.5~0.9초)에 따라 수십 초 소요될 수 있다(timeout 15초/케이스로 충분).

## 변경 시 자주 깨지는 함정

| 항목 | 함정 |
|---|---|
| **checkWin 검사 범위** | `checkWin`은 **방금 착수한 칸 기준 4방향**만 검사한다(전체 보드 스캔 아님). 이 특성 때문에 마지막 칸 인접만 통제하면 5목 없이 draw를 만들 수 있다(QA-D1). 승리 판정 로직 변경 시 "방금 착수 칸 중심" 가정을 유지할 것 |
| **장목 = 승리** | 6목 이상도 승리다(장목 제한 없음). `count >= 5`로 판정해야 하며 `count === 5`로 좁히면 장목이 미결 처리되는 버그 발생(OMOK-004 회귀) |
| **금수 검사는 가상 착수 후** | `checkDoubleThree`/`checkDoubleFour`는 board에 돌이 **놓인 상태**로 호출된다. 거부 시 `board[idx]=null` + `moveCount-=1` **원복 필수**(phase/currentTurn 불변·게임 계속). 원복 누락 시 거부된 칸이 점령된 채로 남거나 턴 카운트가 어긋난다(QA-R 원복 검증) |
| **승리 우선** | `placeStone`은 **`checkWin`을 금수 검사보다 먼저** 호출해야 한다. 5목+ 완성 수는 33/44 동시여도 승리(거부 아님). 순서를 뒤집으면 결정타가 "금수입니다"로 거부되는 치명적 버그(OMOK-010/QA-R5/R6 회귀) |
| **5목+는 isFour 제외** | `isFour`는 `len===4`만 true. 5목/6목 방향을 4목으로 집계하면 결정타가 사사로 오탐된다(`가로5+세로4 → fours=1 → 사사 아님`) |
| **닫힌3 오탐 금지** | `isOpenThree`는 **양 끝이 모두 빈칸(`_XXX_`)**일 때만 열린3. front/back open을 한쪽만 검사하면 닫힌3(`OXXX_`)이 금수로 오탐되어 정상 수가 거부된다(QA "닫힌3 1+열린3 1=쌍삼 아님") |
| **경계 래핑 오판(금수)** | 금수 탐색의 정/역방향 while + front/back open 검사 4지점 전부 `inBounds(r,c)` 가드 필수. 18열↔다음행 0열, 코너 보드밖 래핑을 막지 않으면 존재하지 않는 3목/4목을 센다(QA "18열 끝 보드밖=열린3 아님") |
| **가로 래핑 오판** | 가로 연속 카운트 시 행 경계(18열↔다음 행 0열)를 넘지 않도록 같은 row 내에서만 누적해야 한다(QA-E3). col 인덱스가 0~18을 벗어나면 중단 |
| **좌표 입력 가드** | `placeStone`의 `Number.isInteger(row) && Number.isInteger(col)` + 범위 검사를 제거하면 NaN/소수/문자열 좌표가 board 인덱스를 오염시킨다(QA-E10). 가드 유지 필수 |
| **마지막 착수 점 색상** | `board.js`의 `LAST_MOVE_COLOR`는 CSS `--accent`(`#C8102E`)와 동일해야 한다(AD F-01). 하드코딩 `#FF3333`으로 되돌리지 말 것 |
| **snapshot 독립성** | `snapshot`은 `board.slice()`로 복사본을 반환한다. 얕은 참조 반환 시 클라가 board를 변조하면 원본 오염(QA-E12) |
| **정원 초과 + 좀비 슬롯** | 3번째 연결 거절 전에 readyState>1 좀비 슬롯을 청소 후 재검사한다(server.js). 청소 누락 시 정상 재접속이 "가득 찼다"로 거절될 수 있음 |
| **mode 쿼리 보존** | `network.js`는 `omok:mode`를 sessionStorage에 저장한다. 새로고침 시 mode 유실되면 AI 게임이 LAN 모드로 바뀜 |
| **READY 게이트** | 초기/리매치 모두 양쪽 READY 시 동일 start-트리거(`maybeStartGameIfReady`)로 createGame→GAME_START. 리매치 후 `game` 상태 리셋(`game=null`)/readySet 초기화 누락 시 `!game` 조건이 거짓이 되어 GAME_START 미발생(BOT-004 회귀) |

## 파이프라인 적용 규칙

- **`visual_change: ui`**가 기본. UI 변경 시 AD3 검수(Canvas 바둑판 레이아웃·돌 대비·좌표 라벨·모바일 축소 중점).
- **`visual_change: art`는 발생하지 않음**(외부 이미지 에셋 없음, Canvas/CSS 코드 합성만). AD1/2 생략.
- 순수 서버/로직 변경(`game.js`/`server.js`/`bot.js`)은 `visual_change: none` 가능.

## Mockup Sync

- 게임플레이 시각이 전부 Canvas/CSS/HTML이므로 `studio-mockup` 동기화 **불필요**.

## 참조

### 1차 코어 (신규 등록)
- 스펙: `.claude/specs/2026-06-15-omok-add-spec.md`
- 리포트: `.claude/specs/2026-06-15-omok-add-report.md`
- QA: `.claude/specs/2026-06-15-omok-qa-report.md`
- AD 검수: `.claude/specs/2026-06-15-omok-ad-review.md`

### 쌍삼·사사 금수 + 세션 유지 리매치 (2026-06-15)
- 스펙: `.claude/specs/2026-06-15-omok-rematch-renju-spec.md`
- 리포트: `.claude/specs/2026-06-15-omok-rematch-renju-report.md`
- QA: `.claude/specs/2026-06-15-omok-rematch-renju-qa-report.md`
- AD 검수: `.claude/specs/2026-06-15-omok-rematch-renju-ad-review.md`
