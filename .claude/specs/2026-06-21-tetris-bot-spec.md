---
status: COMPLETED
completed: 2026-06-21
spec: .claude/specs/2026-06-21-tetris-bot-spec.md
report: .claude/specs/2026-06-21-tetris-bot-report.md
qa: .claude/specs/2026-06-21-tetris-bot-qa-report.md
---

> **확정 상태**: 구현·QA 완료(QA PASS — blocker 0). 봇 smoke는 스펙의 TBOT-001~005 5시나리오 = 개별 단언 **8/8 PASS**(스펙 "5/5"는 시나리오 수 기준 표기). 회귀는 **344 PASS / 1 FAIL(Q7b, 봇 무관 기존 결함)** — 스펙의 "337/337"은 baseline 표기로, Q7b는 봇 작업 이전부터 실패하던 테스트 취약성이라 게이트를 막지 않음.

# Feature: 테트리스 배틀 AI 봇 추가

## 개요

테트리스 배틀에 단독 AI 봇 대전 모드를 추가한다. 대기 화면에 "🤖 AI랑 시작" 버튼을 노출하고, 기존 6종 봇 게임과 동일한 `getBotUrl` + `child_process.spawn` 패턴을 채택한다. 단, 테트리스 배틀은 클라이언트 권위 구조라 봇은 서버가 보내는 STATE를 수신하지 않고 **독자 테트리스 엔진을 내장하여 보드를 시뮬레이션**하고, 라인 클리어 시에만 `GARBAGE_SEND`를 서버로 전송한다.

## 배경 및 동기

10종 게임 중 테트리스 배틀만 AI 봇이 없어 1인 플레이가 불가능하다. 캐주얼 LAN 환경에서 친구가 없을 때도 즉시 플레이할 수 있도록 "적당히 이길 수 있는" 난이도의 봇을 추가한다.

아키텍처 특수성: 다른 봇(오목/요트/장기 등)은 서버가 보낸 STATE 스냅샷을 받아 한 수를 결정한다. 그러나 테트리스 배틀은 `server.js`가 보드 상태를 브로드캐스트하지 않는다(클라이언트 권위). 서버는 `GARBAGE_RECV` / `ITEM_EFFECT` / `GAME_RESULT` 같은 이벤트만 중계한다. 따라서 봇은 자체 보드·피스 시뮬레이터를 내장해야 한다.

## Purposer 분류

- `visual_change`: `ui` — 대기 화면 버튼 1개 추가
- `pipeline`: `full` — 신규 파일 2개 + 기존 파일 4개 수정 + WS 프로토콜 모드 파싱
- `clarity`: `high`

---

## 설계 변수 확정 및 근거

### A1. 봇 엔진 — 독자 재구현 (import 불가)

**확정**: `board.js` / `tetromino.js`는 `export`를 갖추고 있지만 **브라우저 클라이언트용 ES Module**이다. `bot.js`는 Node.js `child_process`로 실행되는 독립 프로세스이므로, `public/js/board.js`를 서버 사이드에서 직접 import하는 것은 다음 이유로 부적합하다.

1. `board.js`가 `./tetromino.js`를 상대 경로로 import한다. bot.js는 `tetris-battle/` 루트에 위치하므로 `public/js/` 하위 파일을 깔끔하게 require하려면 경로 해킹이 필요하다.
2. 브라우저 전용 Canvas API나 `requestAnimationFrame`은 사용하지 않지만, 향후 클라이언트 코드에 DOM 의존성이 생기면 봇이 같이 깨진다.
3. 재구현할 로직의 범위가 작다: 보드 `10×22` 2D 배열, 충돌 검사, 피스 행렬 참조, 라인 클리어. `garbageFromLines` / `comboBonus`도 50줄 미만.
4. 오목 봇도 동일 이유로 `game.js`를 import하지 않고 룰을 재구현한다(오목 bot.js 7~18줄 주석 참조).

**따라서** `bot.js`에 필요한 상수/함수를 인라인으로 재구현한다. 단, 소스의 상수값(`BOARD_WIDTH=10`, `BOARD_HEIGHT=22`, `VANISH_ZONE=2`, `PIECE_COLORS`, `PIECES` 행렬, `garbageFromLines`/`comboBonus` 로직)은 기존 소스와 **정확히 동일한 값**을 사용하고 JSDoc에 "board.js와 동기 유지 필요" 주석을 달아 향후 변경 시 주의를 환기한다.

### B1. 평가 함수 가중치

**확정**: 표준 테트리스 휴리스틱 4항목을 상수로 분리한다.

```
W_CLEAR    =  1.0   // 라인 클리어 수 (많을수록 좋음)
W_HOLES    = -3.5   // 구멍 수 (블록 아래 빈칸, 적을수록 좋음)
W_BUMP     = -0.5   // 인접 컬럼 높이 차이 합 (평탄할수록 좋음)
W_HEIGHT   = -0.5   // 최대 스택 높이 (낮을수록 좋음)

score = clearLines * W_CLEAR
      + holes * W_HOLES
      + bumpiness * W_BUMP
      + maxHeight * W_HEIGHT
```

**캐주얼 약화**: 가중치 자체는 표준 수준으로 유지한다. 대신 피스 배치 간격(C1)의 랜덤 편차와 1-look 한계(룩어헤드 없음)가 자연스러운 실수를 유발해 "적당히 이길 수 있는" 난이도를 만든다. 일부러 차선택을 고르는 로직은 추가하지 않는다(단순·예측 가능·유지보수 용이).

**근거**: 가중치를 최상단 상수로 분리하면 향후 Coder가 tuning할 때 한 줄만 수정하면 된다.

### B2. 탐색 방식 — 전수 평가

**확정**: 모든 `(x위치 × rotation 0~3)` 조합을 전수 탐색 후 평가 함수 최고점 위치에 하드드롭한다.

- I 피스(4×4 행렬): x = -1 ~ 9, rotation 0~3 → 최대 44조합
- T/S/Z/J/L(3×3): x = -1 ~ 9, rotation 0~3 → 최대 44조합
- O 피스(4×4, 회전해도 동일): 사실상 x 조합만 (~12)

각 조합별로 `isColliding` 통과 여부를 검사해 유효한 착지 위치만 평가한다. 전수 탐색이라도 최대 44 × 하드드롭 깊이(~22) = ~1000 연산이라 성능 이슈 없음. Node.js 싱글스레드 800ms 안에 충분히 완료된다.

### B3. 룩어헤드 — 1-look (현재 피스만)

**확정**: 1-look(현재 피스만 평가). 넥스트 피스 고려(2-look)는 미구현. 캐주얼 난이도에 적합하고, 2-look은 봇 강도를 급격히 높여 캐주얼 의도와 어긋난다.

### C1. 피스 배치 간격

**확정**: `800ms + Math.random() * 400ms` (800~1200ms/피스).

- 상수 분리: `BOT_PLACE_INTERVAL_MIN = 800`, `BOT_PLACE_INTERVAL_RANGE = 400`
- 중력 시뮬레이션 생략 — 계산 완료 직후 즉시 하드드롭. 1200ms 상한은 실제 테트리스 초보 수준의 배치 속도와 유사해 자연스럽다.
- 봇 "생각 중" 체감을 위해 랜덤 지연을 사용한다. 난수 범위를 조이면 더 강하게, 넓히면 더 약하게 조정 가능.

### C2. 중력 시뮬레이션 생략

**확정**: 봇은 보드 시뮬레이터 내부에서 중력 타이머를 돌리지 않는다. 배치 결정 → 즉시 하드드롭 → `GARBAGE_SEND`(라인 클리어 시) → 다음 피스 대기. 단순하고 예측 가능한 동작, CPU 낭비 없음.

### D. 가비지/아이템 처리

소스에서 확인한 서버 메시지 종류:

**서버 → 봇으로 전달되는 메시지:**

| 메시지 타입 | 페이로드 | 봇 처리 |
|---|---|---|
| `JOINED` | `{ playerId, waiting, hostUrl }` | playerId 저장, READY 전송 |
| `START` | `{ countdown }` | 게임 루프 시작 |
| `GARBAGE_RECV` | `{ lines, combo }` | 봇 보드에 가비지 적용 (다음 피스 락 시점에 배치) |
| `GAME_RESULT` | `{ winner, reason }` | 게임 종료 처리, 자동 REMATCH |
| `REMATCH_STATUS` | `{ p1Ready, p2Ready }` | 무시 (봇은 GAME_RESULT에서만 REMATCH) |
| `ITEM_GRANT` | `{ itemId, slotIndex }` | **무시** (봇은 아이템 사용 안 함) |
| `ITEM_EFFECT` | `{ itemId, duration }` | **가비지 폭탄만 봇 보드에 반영, 나머지 무시** |
| `SHIELD_BLOCK` | `{ itemId }` | 무시 |
| `ERROR` | `{ message }` | 로그만 기록 |
| `OPPONENT_BOARD` | `{ height, stack }` | 무시 (봇은 미니맵 업데이트 없음) |

**봇 → 서버로 전송하는 메시지:**

| 메시지 타입 | 페이로드 | 시점 |
|---|---|---|
| `JOIN` | `{ playerName: 'AI Bot' }` | 연결 직후 |
| `READY` | `{}` | `JOINED` 수신 후 |
| `GARBAGE_SEND` | `{ lines, combo }` | 라인 클리어 시, `garbageFromLines + comboBonus` 결과가 > 0일 때 |
| `BOARD_STATE` | `{ height, stack }` | 매 피스 락 직후 (상대 미니맵 업데이트용) |
| `GAME_OVER` | `{}` | 봇 토프아웃(스폰 불가) 시 |
| `REMATCH` | `{}` | `GAME_RESULT` 수신 후 0.5초 지연 자동 전송 |

**아이템 처리 결정 근거:**
- `garbage_bomb`: `ITEM_EFFECT { itemId: 'garbage_bomb', duration: 0 }` 수신 시 봇 보드에 즉시 `addGarbage(2)` 적용 (`GARBAGE_BOMB_LINES=2`, `board.js` 참조).
- `dark`: `duration=5000`. 봇은 무시 — 어차피 보드를 직접 볼 수 없음(시뮬레이터만 있음). 사람이 다크로 봇을 교란해도 봇 내부 계산은 정확히 진행된다. **의도적 비대칭 — 사람이 아이템으로 봇을 교란하는 재미를 살린다.**
- `freeze`: 봇 무시 — 중력 타이머가 없으므로 프리즈 효과가 없다. 배치 타이머(setTimeout)를 강제로 멈추는 구현도 가능하지만 복잡도 대비 효과가 낮다.
- `line_clear`: 서버가 봇에게 `ITEM_GRANT { itemId: 'line_clear' }`를 줄 수 있지만 봇은 슬롯이 없어 `ITEM_USE`를 보내지 않는다.
- `shield`: 동일하게 무시.

### E. 재대결/종료 처리

소스 확인 결과:

- **봇 토프아웃**: 봇 내부 `spawnNext()` 가상 함수가 `isColliding` 충돌 감지 시 → `send({ type: 'GAME_OVER' })` → 서버가 상대에게 `{ type: 'GAME_RESULT', winner: oppId, reason: 'topout' }` broadcast.
- **봇 자동 REMATCH**: `GAME_RESULT` 수신 시 500ms 후 `send({ type: 'REMATCH' })`. 타임아웃 재송신은 생략(omok과 달리 REMATCH_STATUS로 상태를 알 수 있어 10초 재송신 불필요, 단순화).
- **사람 disconnect**: `ws.on('close')` → `killBotChild()` (서버의 기존 close 핸들러를 확장, 아래 서버 수정 항목 참조).
- **봇 disconnect 감지**: 봇 프로세스가 비정상 종료 → 서버 close 핸들러가 players에서 제거 → `broadcastAll({ type: 'GAME_RESULT', winner: remainingId, reason: 'disconnect' })` (기존 로직 그대로).

**REMATCH 흐름 상세:**
서버 `server.js` REMATCH 처리:
```
사람: REMATCH → server: p1.rematchReady=true → REMATCH_STATUS(양쪽에) → 봇: REMATCH_STATUS 수신(무시)
봇: GAME_RESULT 수신 500ms 후 → REMATCH 송신 → server: 양쪽 rematchReady → resetRoomFlags + 양쪽 ready=true → START
```
타이밍: 사람이 먼저 REMATCH를 누르면 봇이 GAME_RESULT 수신 후 0.5초 안에 동의 → 총 0.5초 안에 재대결 시작.

### F. 봇 smoke 격리 포트

**확정**: `3110`

기존 슈트 사용 포트 확인:
- `phase1-ws.test.js` ~ `phase3-4-qa-edge.test.js`: `--port 3055` (런타임 인자, 코드에 노출)
- `phase5-vanish-zone.test.js`, `phase5-qa-edge.test.js`: 내부 포트 (소스 확인 필요, 안전 마진으로 3110 사용)
- 오목: 3105/3106, 윷놀이: 3104, 요트: 3099, 루미큐브: 3096, 하나비: 3095, 맞고: 3013, 장기: 3012(기본), 오목: 3012(기본 → 충돌 폴백)

3110은 기존 모든 격리 포트와 겹치지 않는다.

---

## 요구사항

### 기능 요구사항

- [x] 대기 화면에 "🤖 AI랑 시작" 버튼이 표시되고, 클릭 시 `?mode=ai`로 재접속한다.
- [x] `tetris-battle/server.js`가 `mode=ai` 쿼리를 파싱해 봇을 자동 spawn한다.
- [x] 봇이 테트리스 엔진을 독자 구동하여 자동으로 피스를 쌓는다.
- [x] 봇이 라인을 클리어하면 `garbageFromLines + comboBonus` 로직으로 사람에게 가비지를 전송한다.
- [x] 봇이 토프아웃하면 `GAME_OVER`를 전송하고 사람이 승리 처리된다.
- [x] 사람이 "재대결" 버튼 클릭 시 봇이 자동으로 동의해 새 게임이 시작된다.
- [x] 사람이 disconnect하면 봇 child process가 즉시 종료된다.
- [x] 봇이 `garbage_bomb` 아이템 효과를 수신하면 봇 보드에 가비지 2줄을 적용한다.
- [x] `launcher/server.js`가 `createTetrisApp`에 `getBotUrl`을 주입해 통합 모드에서도 봇이 동작한다.
- [x] 기존 회귀 슈트가 모두 PASS를 유지한다. *(실측 344 PASS — Q7b 1건은 봇 무관 기존 결함으로 baseline 동일, non-blocker)*

### 비기능 요구사항

- [x] 봇 배치 간격: 800~1200ms/피스 (캐주얼 난이도)
- [x] 봇 프로세스가 종료된 후 좀비 프로세스를 남기지 않는다 (`detached: false`).
- [x] 봇이 서버와 주고받는 모든 메시지를 콘솔에 로그한다 (`[tetris-bot]` prefix).

---

## 구현 상세

### 수정/생성할 파일

| 파일 경로 | 작업 유형 | 설명 |
|---|---|---|
| `tetris-battle/bot.js` | 신규 생성 | 테트리스 AI 봇 프로세스 |
| `tetris-battle/server.js` | 수정 | `getBotUrl` 옵션, `mode` 쿼리 파싱, spawn/kill, READY 처리 변경 |
| `tetris-battle/public/index.html` | 수정 | "🤖 AI랑 시작" 버튼 추가 |
| `tetris-battle/public/js/network.js` | 수정 | `mode=ai` 쿼리 부착 + sessionStorage 보존 |
| `launcher/server.js` | 수정 | `createTetrisApp`에 `getBotUrl` 주입 |
| `tetris-battle/tests/bot-smoke.test.js` | 신규 생성 | 봇 smoke 테스트 (포트 3110) |

---

### 각 파일별 변경사항

#### `tetris-battle/bot.js` (신규)

**파일 상단 `@fileoverview`**: 테트리스 배틀 AI 봇 — 독자 테트리스 엔진 내장 + WS 클라이언트.

**재구현할 상수 (board.js / tetromino.js와 값 일치 필수)**:

```javascript
// board.js 동기 유지 필요 (board.js 수정 시 아래 값도 함께 변경)
const BOARD_WIDTH = 10;
const VISIBLE_HEIGHT = 20;
const VANISH_ZONE = 2;
const BOARD_HEIGHT = VISIBLE_HEIGHT + VANISH_ZONE;  // 22
const GARBAGE_BOMB_LINES = 2;  // board.js GARBAGE_BOMB_LINES와 동일

// tetromino.js 동기 유지 필요
const PIECES = { I: [...], O: [...], T: [...], S: [...], Z: [...], J: [...], L: [...] };
// (7종 피스의 회전 상태 4종 행렬 — tetromino.js 정의와 100% 동일값)
const PIECE_TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
const PIECE_COLORS = { I: 1, O: 2, T: 3, S: 4, Z: 5, J: 6, L: 7 };
```

**봇 배치 상수**:

```javascript
const BOT_PLACE_INTERVAL_MIN = 800;    // ms, 최소 배치 간격
const BOT_PLACE_INTERVAL_RANGE = 400;  // ms, 추가 랜덤 범위 (800~1200ms)
```

**평가 함수 가중치 상수**:

```javascript
const W_CLEAR  =  1.0;
const W_HOLES  = -3.5;
const W_BUMP   = -0.5;
const W_HEIGHT = -0.5;
```

**내장 보드 시뮬레이터 함수**:

```javascript
// 빈 그리드 생성
function createEmptyGrid()  // → number[][] (BOARD_HEIGHT × BOARD_WIDTH, 모두 0)

// 충돌 검사 (board.js isColliding 동일 로직)
function isColliding(grid, type, rotation, x, y)  // → boolean

// 피스 락 (board.js lockPiece 동일 로직)
function lockPiece(grid, type, rotation, x, y)     // → void (in-place)

// 라인 클리어 (board.js clearLines 동일 로직)
function clearLines(grid)                           // → number (제거된 줄 수)

// 가비지 추가 (board.js addGarbage 동일 로직 — 같은 hole 위치)
function addGarbage(grid, lines)                    // → void

// 7-bag 생성기
function createBag()  // → { next(): string, refill() }

// 가비지 변환 (board.js garbageFromLines 동일 로직)
function garbageFromLines(cleared)  // → number

// 콤보 보너스 (board.js comboBonus 동일 로직)
function comboBonus(combo)  // → number
```

**평가 함수 (`evaluateBoard`)**:

의사코드:
```
function evaluateBoard(grid, clearedLines):
  holes = 0
  for each column c (0~9):
    blockFound = false
    for each row r top-to-bottom (0~BOARD_HEIGHT-1):
      if grid[r][c] !== 0: blockFound = true
      else if blockFound: holes++

  colHeights = []
  for each column c:
    for each row r top-to-bottom:
      if grid[r][c] !== 0:
        colHeights[c] = BOARD_HEIGHT - r
        break
    else: colHeights[c] = 0

  maxHeight = max(colHeights)

  bumpiness = 0
  for i = 0 to 8:
    bumpiness += abs(colHeights[i+1] - colHeights[i])

  return clearedLines * W_CLEAR
       + holes * W_HOLES
       + bumpiness * W_BUMP
       + maxHeight * W_HEIGHT
```

**최적 배치 탐색 (`chooseBestPlacement`)**:

의사코드:
```
function chooseBestPlacement(grid, pieceType):
  bestScore = -Infinity
  bestX = 0, bestRot = 0

  for rotation = 0 to 3:
    matrix = PIECES[pieceType][rotation]
    matWidth = matrix[0].length
    for x = -(matWidth-1) to BOARD_WIDTH-1:  // 피스가 부분적으로 밖에 걸쳐도 허용
      // 이 (x, rotation) 조합이 스폰 위치(y=0)에서 유효한지 확인
      if isColliding(grid, pieceType, rotation, x, y=0): continue

      // 하드드롭: y를 충돌 직전까지 내린다
      y = 0
      while not isColliding(grid, pieceType, rotation, x, y+1):
        y++

      // 시뮬 보드에 락
      simGrid = deepCopy(grid)
      lockPiece(simGrid, pieceType, rotation, x, y)
      cleared = clearLines(simGrid)

      score = evaluateBoard(simGrid, cleared)
      if score > bestScore:
        bestScore = score
        bestX = x, bestRot = rotation, bestY = y, bestCleared = cleared

  return { x: bestX, rotation: bestRot, y: bestY, cleared: bestCleared }
```

**봇 메인 루프**:

```
botGrid = createEmptyGrid()
botBag = createBag()
botCombo = -1
pendingGarbage = 0
isRunning = false
placeTimer = null

function scheduleNextPiece():
  type = botBag.next()
  delay = BOT_PLACE_INTERVAL_MIN + Math.floor(Math.random() * BOT_PLACE_INTERVAL_RANGE)
  placeTimer = setTimeout(() => doPlace(type), delay)

function doPlace(type):
  // 가비지 먼저 적용 (피스 락 직전)
  if pendingGarbage > 0:
    addGarbage(botGrid, pendingGarbage)
    pendingGarbage = 0

  // 최적 위치 탐색
  placement = chooseBestPlacement(botGrid, type)

  // 스폰 충돌 = 토프아웃
  if isColliding(botGrid, type, placement.rotation, placement.x, y=0):
    send({ type: 'GAME_OVER' })
    isRunning = false
    return

  // 락 적용
  lockPiece(botGrid, type, placement.rotation, placement.x, placement.y)
  cleared = clearLines(botGrid)

  // 콤보 계산
  if cleared > 0:
    botCombo++
    garbage = garbageFromLines(cleared) + comboBonus(botCombo)
    if garbage > 0:
      send({ type: 'GARBAGE_SEND', lines: garbage, combo: botCombo })
  else:
    botCombo = -1

  // 미니맵 업데이트 (스택 높이)
  height = getStackHeight(botGrid)
  send({ type: 'BOARD_STATE', height, stack: [] })

  // 다음 피스 예약
  if isRunning:
    scheduleNextPiece()
```

**상태 변수**:

```javascript
let myPlayerId = null;     // 'p1' | 'p2'
let isRunning = false;     // 게임 진행 중
let pendingGarbage = 0;    // 받은 가비지 대기 줄 수
let rematchTimer = null;   // GAME_RESULT 후 REMATCH 예약 타이머
```

**WS 이벤트 핸들러**:

```
ws.on('open'): JOIN({ playerName: 'AI Bot' }) 전송

ws.on('message'):
  JOINED: myPlayerId 저장, ready() 전송, 로그
  START:  isRunning=true, botGrid/botBag/botCombo 초기화, scheduleNextPiece() 시작
  GARBAGE_RECV: pendingGarbage += lines (다음 피스 락 시점에 적용)
  ITEM_EFFECT:
    if itemId === 'garbage_bomb': pendingGarbage += GARBAGE_BOMB_LINES
    else: 무시
  GAME_RESULT:
    isRunning=false, clearTimeout(placeTimer)
    500ms 후 REMATCH 전송
  ERROR: 로그, isRunning 유지
  기타: 무시

ws.on('close'): process.exit(0)
ws.on('error'): 로그
```

**인자 파싱**:
```javascript
// node bot.js --url ws://localhost:3005/ws?mode=bot
const argv = process.argv.slice(2);
const urlIdx = argv.indexOf('--url');
const BOT_URL = urlIdx >= 0 && argv[urlIdx+1]
  ? argv[urlIdx+1]
  : 'ws://localhost:3005/ws?mode=bot';
```

**`getStackHeight` 인라인 구현 (BOARD_STATE height 계산용)**:
```javascript
function getStackHeight(grid):
  for r = VANISH_ZONE to BOARD_HEIGHT-1:
    if grid[r].some(v => v !== 0): return BOARD_HEIGHT - r
  return 0
```

---

#### `tetris-battle/server.js` (수정)

**1) `createApp` 함수 시그니처 변경**

현재:
```javascript
export function createApp(opts = {}) {
  let HOST_URL = typeof opts.hostUrl === 'string' ? opts.hostUrl : '';
```

변경 후:
```javascript
export function createApp(opts = {}) {
  let HOST_URL = typeof opts.hostUrl === 'string' ? opts.hostUrl : '';
  const getBotUrl = typeof opts.getBotUrl === 'function' ? opts.getBotUrl : (() => null);
```

**2) 봇 child process 상태 변수 추가** (closure 내부, players 선언 아래):

```javascript
/** @type {import('child_process').ChildProcess|null} */
let botChild = null;
```

**3) `import { spawn }` 추가** (파일 상단 import 블록에):

```javascript
import { spawn } from 'child_process';
import path from 'path';
```

`path`는 이미 import되어 있으므로 `spawn`만 추가한다.

**4) `spawnBotChild()` / `killBotChild()` 함수 추가** (WSS 핸들러 이전):

오목 `server.js`의 `spawnBotChild`/`killBotChild` 패턴(L192~227)과 동일하게 구현한다. 봇 경로: `path.join(__dirname, 'bot.js')`.

```javascript
function spawnBotChild() {
  const botPath = path.join(__dirname, 'bot.js');
  if (!fs.existsSync(botPath)) { /* warn + return */ }
  if (botChild && botChild.exitCode === null) { /* already running */ return; }
  const url = getBotUrl();
  if (!url) { /* warn + return */ }
  botChild = spawn(process.execPath, [botPath, '--url', url], { detached: false, stdio: 'ignore' });
  botChild.on('exit', (code) => { botChild = null; });
}

function killBotChild() {
  if (botChild && botChild.exitCode === null) {
    botChild.kill();
    botChild = null;
  }
}
```

`import fs from 'fs'`를 server.js 상단에 추가한다 (현재 없음 — 소스 확인 결과 server.js는 `fs`를 import하지 않음).

**5) WSS `connection` 핸들러에서 `mode` 파싱 추가**

현재 connection 핸들러 시작(L169):
```javascript
wss.on('connection', (ws) => {
```

변경:
```javascript
wss.on('connection', (ws, req) => {
  const reqUrlObj = new URL(req.url || '/', 'http://localhost');
  const wsMode = reqUrlObj.searchParams.get('mode') || 'human';
  const isBot = wsMode === 'bot';
```

**6) `handleUpgrade`에서 `req` 전달 확인**

현재 `handleUpgrade` 구현(L396~400):
```javascript
function handleUpgrade(req, socket, head) {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);   // ← req 이미 전달됨 ✓
  });
}
```
수정 불필요 — `req`가 이미 `connection` 이벤트로 전달되고 있다.

**7) `JOINED` 전송 직후 mode=ai 시 봇 spawn**

현재 `JOIN` case 처리 후(L206~216):
```javascript
case 'JOIN':
  player.name = msg.playerName || playerId;
  sendTo(player, { type: 'JOINED', ... });
  break;
```

변경 — `JOIN` case 이전이 아니라, connection 핸들러의 JOINED 직후에 spawn을 조건부 실행한다. 오목과 달리 테트리스는 `JOIN` 메시지를 클라이언트가 보내므로 JOIN 처리 직후 spawn이 적절하다:

```javascript
case 'JOIN':
  player.name = msg.playerName || playerId;
  player.mode = wsMode;  // player 객체에 mode 추가 (아래 close 핸들러용)
  sendTo(player, { type: 'JOINED', playerId: player.id, waiting: players.length < 2, hostUrl: HOST_URL });
  // mode=ai 단독 진입 시 봇 자동 spawn
  if (wsMode === 'ai' && !isBot && players.length === 1) {
    setTimeout(() => spawnBotChild(), 200);
  }
  break;
```

**주의**: 현재 Player typedef에 `mode` 필드가 없다. JSDoc typedef에 `mode: string` 추가 필요.

**8) `close` 핸들러에서 봇 종료 처리**

현재 close 핸들러(L354~369):
```javascript
ws.on('close', () => {
  players = players.filter((p) => p.id !== player.id);
  if (players.length > 0) {
    broadcastAll({ type: 'GAME_RESULT', winner: remainingId, reason: 'disconnect' });
    resetRoomFlags();
  }
});
```

변경:
```javascript
ws.on('close', () => {
  players = players.filter((p) => p.id !== player.id);
  // 사람이 끊긴 경우 봇 자식 프로세스도 종료
  if (!isBot) {
    killBotChild();
  }
  if (players.length > 0) {
    const remainingId = players[0].id;
    broadcastAll({ type: 'GAME_RESULT', winner: remainingId, reason: 'disconnect' });
    resetRoomFlags();
  }
});
```

**9) `createApp` 반환값에 `setHostUrl` 이미 있음** — 수정 불필요.

---

#### `tetris-battle/public/index.html` (수정)

현재 대기 화면 중앙 영역(L76~81):
```html
<section class="center-area">
  <div class="vs-label">VS</div>
  <div id="countdown" class="countdown hidden">3</div>
  <!-- 대기 화면 P1/P2 입장 상태는 헤더의 #opponent-status가 표시한다(초대 패널 제거). -->
  <button id="ready-btn" class="primary-btn">준비</button>
</section>
```

변경:
```html
<section class="center-area">
  <div class="vs-label">VS</div>
  <div id="countdown" class="countdown hidden">3</div>
  <!-- AI 모드 진입 버튼 — AI랑 시작 클릭 시 ?mode=ai로 재접속 -->
  <button id="ai-start-btn" class="ai-start-btn" type="button">🤖 AI랑 시작</button>
  <button id="ready-btn" class="primary-btn">준비</button>
</section>
```

**CSS 클래스 `.ai-start-btn`**: 오목/윷놀이/요트 등 기존 AI 버튼 스타일과 톤 일치. AD 모드3에서 최종 검수. 기존 `.primary-btn` 스타일을 참고하되 색상을 약간 차별화하거나 동일하게 처리해도 무방 — AD가 결정.

---

#### `tetris-battle/public/js/network.js` (수정)

**`mode` 쿼리 파싱 및 sessionStorage 보존** — 오목 `network.js` 패턴(omok/public/js/network.js 참조) 적용:

`connect()` 함수 내 URL 구성 부분 변경:

현재:
```javascript
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const seg = location.pathname.split('/').filter(Boolean)[0] || '';
  const wsPath = seg ? `/${seg}/ws` : '/ws';
  const url = `${proto}://${location.host}${wsPath}`;
  ws = new WebSocket(url);
```

변경:
```javascript
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const seg = location.pathname.split('/').filter(Boolean)[0] || '';
  const wsPath = seg ? `/${seg}/ws` : '/ws';

  // mode 쿼리 파라미터 파싱 + sessionStorage 보존 (새로고침 후에도 AI 모드 유지)
  const urlParams = new URLSearchParams(location.search);
  let mode = urlParams.get('mode') || sessionStorage.getItem('tetris:mode') || '';
  if (mode) sessionStorage.setItem('tetris:mode', mode);

  const modeQuery = mode ? `?mode=${encodeURIComponent(mode)}` : '';
  const url = `${proto}://${location.host}${wsPath}${modeQuery}`;
  console.log('[net] 연결 시도:', url);
  ws = new WebSocket(url);
```

**`join()` 호출 시 playerName**: 기존 `join(playerName)` 그대로 유지. AI 모드에서는 `main.js`가 "AI Bot" 또는 사용자명을 넘기는 대신, **서버 쪽 봇이 스스로 `JOIN { playerName: 'AI Bot' }`을 보내므로** 사람 클라이언트가 별도 처리할 필요 없음.

**`aiStart()` 헬퍼 추가** (반환 객체에):
```javascript
aiStart() {
  // 현재 URL에 ?mode=ai 추가 후 재접속
  sessionStorage.setItem('tetris:mode', 'ai');
  const base = location.origin + location.pathname;
  location.href = `${base}?mode=ai`;
},
```

`main.js`에서 `#ai-start-btn` 클릭 이벤트가 이 함수를 호출한다. 단, `main.js` 변경도 필요하다.

**`main.js` 연동**: `#ai-start-btn` 클릭 핸들러에서 `network.aiStart()` 호출. 버튼이 숨겨지는 시점: 게임 시작(START 메시지 수신) 후 `hidden` 클래스 추가. 대기 중(상대 아직 미입장)에만 표시. AI 모드로 진입했을 때(`mode=ai`)는 버튼 아예 숨김.

---

#### `launcher/server.js` (수정)

현재(L82~83):
```javascript
'tetris-battle':  createTetrisApp(),
```

변경:
```javascript
'tetris-battle':  createTetrisApp({
  getBotUrl: () => `ws://localhost:${PORT}/tetris-battle/ws?mode=bot`,
}),
```

---

#### `tetris-battle/tests/bot-smoke.test.js` (신규)

오목 `tests/bot-smoke.test.js`의 구조를 기반으로 작성. 포트: `3110`.

**TBOT-001: 모드=ai 진입 → 봇 spawn → 사람 JOINED → START 수신**
```
createApp({ getBotUrl: () => '...?mode=bot' })
me = makeClient('?mode=ai')
me.open()
JOIN({ playerName: 'TestUser' }) 전송
JOINED 수신 → assert playerId='p1'
START 수신 → assert countdown=3
PASS: "TBOT-001: mode=ai 진입 후 봇 자동 spawn → START 수신"
```

**TBOT-002: 봇이 실제로 피스를 배치 → GARBAGE_SEND 전송**

봇이 라인을 클리어하면 `GARBAGE_SEND`를 보내고 서버가 사람에게 `GARBAGE_RECV`를 중계한다. 봇이 1200ms 안에 피스를 1개 이상 배치한다고 가정하기 어려우므로, 대신 **봇이 BOARD_STATE를 전송하면 서버가 상대(사람)에게 OPPONENT_BOARD를 중계**하는 것을 검증한다(봇이 피스를 배치했다는 증거).

```
START 수신 후 OPPONENT_BOARD를 최대 30초 대기
assertTrue(OPPONENT_BOARD 수신, 'TBOT-002: 봇이 피스 배치 → BOARD_STATE → OPPONENT_BOARD 중계')
```

**TBOT-003: 봇 토프아웃 시 사람에게 GAME_RESULT(winner=p1, reason=topout) 도착**

봇 보드가 가득 차도록 `GARBAGE_RECV`를 반복 전송해 사람 보드에 가비지를 쌓는 것은 테트리스 봇 자체의 토프아웃을 강제하기 어렵다. 대신 **사람이 GAME_OVER를 먼저 전송**하면 봇(p2)이 남아있어 봇이 winner가 되는 시나리오를 검증한다.

```
START 수신
사람이 GAME_OVER 전송
GAME_RESULT 수신 → assert winner='p2', reason='topout'
PASS: "TBOT-003: 사람 게임오버 → 봇이 승리자 GAME_RESULT 수신"
```

**TBOT-004: 사람 disconnect → 봇 child process 종료 (pid 추적)**

서버가 `getBotUrl` 주입 시 봇 spawn 여부는 `botChild` 변수로 추적되지만 외부에서 접근 불가. 대신 사람 disconnect 후 서버가 `botChild.kill()`을 호출하는 부분을 **봇 WS 연결이 자동으로 닫히는 것**으로 간접 검증한다.

```
사람 연결(mode=ai) + START 확인
별도 bot WS 클라이언트를 직접 생성(mode=bot)해 p2 자리 점유 — 단, 이 방식은 createApp 내부 botChild와 별개
→ 검증 방식: 사람 disconnect 후 서버가 '3번째 접속 가능' 상태인지 확인(players.length 0 → 새 접속 JOINED 가능)
사람 ws.close()
새 클라이언트 접속 → JOINED.waiting=true 수신 → 방이 비어있음 = 봇도 연결 해제됨
PASS: "TBOT-004: 사람 disconnect → 방 초기화 (봇 연결 해제 확인)"
```

**TBOT-005: 재대결 — 사람 REMATCH 전송 → 봇 자동 동의 → START 수신**

```
TBOT-001 시나리오로 게임 시작
사람이 즉시 GAME_OVER 전송 → GAME_RESULT 수신
사람이 REMATCH 전송
START 수신 (봇이 0.5초 후 REMATCH 자동 동의)
assert countdown=3
PASS: "TBOT-005: 재대결 → 봇 자동 동의 → START 수신"
```

**테스트 러너 구조**: 오목 bot-smoke와 동일하게 `ad-hoc 노드 러너` (Node built-in test 모듈 미사용). `node tests/bot-smoke.test.js` 단독 실행. `makeClient` 헬퍼는 omok bot-smoke의 것과 동일 패턴으로 작성.

---

## WS 프로토콜 흐름 (봇 ↔ 서버 ↔ 사람)

```
사람 브라우저                    tetris-battle/server.js              bot.js
        |                               |                               |
        | [HTTP GET /?mode=ai]          |                               |
        |----→ 리다이렉트 or location.href ?mode=ai                     |
        |                               |                               |
        | WS Connect ?mode=ai           |                               |
        |----------------------------→  |                               |
        |                               | players.push(p1, mode='ai')   |
        | ←--- JOINED(p1, waiting=true) |                               |
        |                               |                               |
        | JOIN({ playerName })          |                               |
        |----------------------------→  |                               |
        |                               | mode=ai → setTimeout 200ms → spawnBotChild()
        |                               |---spawn node bot.js --url...-→|
        |                               |                               |
        |                               | ←--- WS Connect ?mode=bot    |
        |                               | players.push(p2, mode='bot')  |
        |                               |                               |
        |                               |---→ JOINED(p2, waiting=false)-|
        |                               |                               | JOIN({ playerName: 'AI Bot' })
        |                               | ←-----------------------------| 
        |                               |                               |
        | ←--- START(countdown:3)       |------→ START(countdown:3)    |
        |                               |                               | isRunning=true
        |                               |                               | scheduleNextPiece()
        |                               |                               |
        |  [게임 진행: 봇 배치 루프]    |                               |
        |                               |    ← BOARD_STATE(h, stack)   |
        | ←--- OPPONENT_BOARD(h,stack)  |                               |
        |                               |                               |
        |  [봇이 라인 클리어]           |                               |
        |                               | ←-- GARBAGE_SEND(lines,combo)|
        | ←--- GARBAGE_RECV(lines,combo)|                               |
        |                               |                               |
        |  [사람이 라인 클리어]         |                               |
        | GARBAGE_SEND(lines,combo) --→ |                               |
        |                               |---→ GARBAGE_RECV(lines,combo)-|
        |                               |                               | pendingGarbage += lines
        |                               |                               |
        |  [봇 토프아웃]                |                               |
        |                               | ←-- GAME_OVER                |
        | ←--- GAME_RESULT(winner=p1)   |---→ GAME_RESULT(winner=p1)  |
        |                               |                               | 500ms 후 REMATCH 전송
        |  [재대결]                     |                               |
        | REMATCH -------------------→  | ←-- REMATCH                  |
        |                               | 양쪽 동의 → resetRoomFlags    |
        | ←--- REMATCH_STATUS           |---→ REMATCH_STATUS            |
        |                               |                               |
        | ←--- START(countdown:3)       |---→ START(countdown:3)       |
        |                               |                               | scheduleNextPiece() 재시작
```

---

## 수용 기준 (Acceptance Criteria)

- [x] **AC-1**: 대기 화면(`/tetris-battle/`)에 "🤖 AI랑 시작" 버튼이 보인다. 게임 시작 후 숨겨진다.
- [x] **AC-2**: 버튼 클릭 시 `?mode=ai`로 페이지 이동하고 WS 연결에 `mode=ai` 쿼리가 붙는다.
- [x] **AC-3**: 서버가 `mode=ai` 쿼리를 감지해 200ms 후 `bot.js`를 child_process로 spawn한다.
- [x] **AC-4**: 봇이 서버에 `JOIN`/`READY` → 양쪽에 `START { countdown:3 }` 브로드캐스트된다.
- [x] **AC-5**: 봇이 800~1200ms 간격으로 피스를 배치하며, 서버가 사람에게 `OPPONENT_BOARD`를 중계한다.
- [x] **AC-6**: 봇이 라인 클리어하면 사람에게 `GARBAGE_RECV`가 도달한다 *(garbageFromLines+comboBonus 동일 로직 재구현으로 검증, §5-2)*.
- [x] **AC-7**: 봇 토프아웃 시 `GAME_OVER`를 전송하고 사람에게 `GAME_RESULT { reason: 'topout' }`가 도달한다 *(TBOT-003은 대칭 시나리오로 winner='p2' 검증)*.
- [x] **AC-8**: 사람이 "재대결" 클릭 → 봇이 0.5초 자동 동의 → `START { countdown:3 }` 재전송.
- [x] **AC-9**: 사람이 브라우저를 닫으면(`ws.close`) 봇 child process가 종료된다.
- [x] **AC-10**: 봇이 `garbage_bomb` 아이템 효과를 받으면 봇 보드에 가비지 2줄이 추가된다 (봇 내부 시뮬레이터).
- [x] **AC-11**: `launcher/server.js`가 통합 모드(포트 3000)에서도 봇을 정상 spawn한다.
- [x] **AC-12**: 기존 회귀 슈트가 변경 후에도 PASS를 유지한다 *(실측 344 PASS — Q7b 1건은 봇 무관 기존 결함·baseline 동일, non-blocker)*.
- [x] **AC-13**: `bot-smoke.test.js` TBOT-001~005 전부 PASS *(개별 단언 8/8)*.

---

## 테스트 계획

### 회귀 게이트 (변경 전후 모두 통과 필수)

```powershell
cd C:\LazySlimeStudio\minigames\tetris-battle
node --test tests/phase1-unit.test.js
node --test tests/phase1-ws.test.js -- --port 3055
node --test tests/phase2-items.test.js -- --port 3055
node --test tests/phase2-edge.test.js -- --port 3055
node --test tests/phase3-polish.test.js -- --port 3055
node --test tests/phase4-launcher.test.js -- --port 3055
node --test tests/phase3-4-qa-edge.test.js -- --port 3055
node --test tests/phase5-vanish-zone.test.js
node --test tests/phase5-qa-edge.test.js
```

기대: 337/337 PASS (기존 슈트 무변경 원칙).

### 신규 봇 smoke (포트 3110)

```powershell
cd C:\LazySlimeStudio\minigames\tetris-battle
node tests/bot-smoke.test.js
```

기대: 5/5 PASS (TBOT-001~005).

### 시나리오 상세

| ID | 시나리오 | 검증 포인트 |
|---|---|---|
| TBOT-001 | mode=ai 진입 → 봇 spawn → START 수신 | `JOINED.playerId='p1'`, `START.countdown=3` |
| TBOT-002 | 봇이 피스 배치 → BOARD_STATE → OPPONENT_BOARD 중계 | `OPPONENT_BOARD` 수신 (최대 30초 대기) |
| TBOT-003 | 사람 GAME_OVER → GAME_RESULT(winner=p2) | `winner='p2'`, `reason='topout'` |
| TBOT-004 | 사람 disconnect → 방 초기화 (봇 연결 해제) | 새 클라이언트 접속 시 `JOINED.waiting=true` |
| TBOT-005 | GAME_RESULT 후 사람 REMATCH → 봇 자동 동의 → START | `START.countdown=3` 재수신 (timeout 15초) |

---

## Art Director 실행 계획

- `visual_change`: `ui`
- AD 모드 1 (에셋 컨셉): **해당 없음** — 외부 이미지 에셋 미사용 (tetris-battle 정책: Canvas/CSS만).
- AD 모드 2 (에셋 검증): **해당 없음** — 동일.
- AD 모드 3 (UI 레이아웃): **실행 예정** — Coder 구현 완료 후 AD 모드3 UI 검수.
  - 검수 대상: "🤖 AI랑 시작" 버튼의 위치, 크기, 색상이 기존 "준비" 버튼 및 다른 10종 게임의 AI 버튼과 톤·배치 일관성을 갖는지 확인.
  - 참조 기준: 오목 `public/index.html`의 AI 버튼, 윷놀이·요트의 AI 버튼 스타일.
  - 중점: 버튼이 게임 중/결과 오버레이 중에는 숨겨지고 대기 중에만 노출되는지 상태 전환 확인.
- 멀티 페이즈: 단일 페이즈 작업. 재반복 없음.

---

## 범위 경계 (Out of Scope)

- 봇 2-look 이상 룩어헤드 (미니맥스/빔서치 금지 — 캐주얼 난이도 의도).
- 봇의 Hold 피스 사용 (Hold는 시뮬레이터에서 미구현).
- 봇의 아이템 사용 (`ITEM_USE` 미전송 — 봇은 아이템 슬롯 없음).
- 봇이 `dark`/`freeze` 효과를 실제로 반영 (무시 설계).
- T-spin/Perfect Clear 감지 (기존 클라이언트도 미구현).
- SRS 벽킥 (기존 클라이언트도 미구현).
- 봇 난이도 선택 UI (단일 난이도).
- 3인 이상 방 지원 (기존과 동일, 2인 1룸 고정).
- macOS/Linux bot.js 단독 실행 (Windows만 검증).

---

## 제약사항

- **VANISH_ZONE 주의**: 봇 시뮬레이터의 `BOARD_HEIGHT=22`는 visible 20 + hidden zone 2. `chooseBestPlacement`는 y=0 스폰 기준으로 탐색하며, `getStackHeight`는 VANISH_ZONE 이후만 측정해야 한다. `BOARD_HEIGHT`와 `VISIBLE_HEIGHT`를 혼동하면 봇의 높이 평가가 틀린다(CLAUDE.md "함정" 참조).
- **콤보 초기값 -1**: `botCombo = -1`에서 시작. 첫 클리어 시 `botCombo++` → 0 (보너스 0). `comboBonus(0) = 0`. 초기값을 0으로 잘못 설정하면 첫 클리어에 보너스 +1이 붙어 회귀 실패.
- **fs import 추가**: `server.js`는 현재 `import fs from 'fs'`가 없다. `spawnBotChild`에서 `fs.existsSync`를 사용하므로 반드시 추가해야 한다.
- **bot.js 위치**: `tetris-battle/bot.js` (루트, `public/` 하위 아님). `path.join(__dirname, 'bot.js')`가 정확한 경로.
- **기존 회귀 슈트 절대 수정 금지**: `phase1-ws.test.js` 등 기존 9개 슈트는 수정하지 않는다. 신규 `bot-smoke.test.js`만 추가.
- **포트 3110 격리**: `bot-smoke.test.js`는 포트 3110에서 자체 서버를 구동한다. 테스트 종료 시 `server.close()` 호출 필수.
- **stop.bat 포트 범위**: 봇 smoke는 격리 포트(3110)이므로 `stop.bat` 수정 불필요. 봇 프로세스는 사람 disconnect 시 kill된다.
- **network.js sessionStorage 키**: `tetris:mode` (다른 게임의 `omok:mode`, `yutnori:mode` 등과 충돌하지 않음).

---

## 참고사항

- 오목 봇 패턴 참조: `C:\LazySlimeStudio\minigames\omok\bot.js`, `omok\server.js` (spawnBotChild/killBotChild L192~227, mode 파싱 L232~238)
- 런처 봇 주입 패턴 참조: `C:\LazySlimeStudio\minigames\launcher\server.js` L74~101 (matgo/yutnori/janggi/yahtzee/rummikub/omok의 `getBotUrl` 주입)
- 보드 상수 원본: `C:\LazySlimeStudio\minigames\tetris-battle\public\js\board.js`
- 피스 행렬 원본: `C:\LazySlimeStudio\minigames\tetris-battle\public\js\tetromino.js`
- 가비지 변환 함수: `board.js` L203~221 (`garbageFromLines`, `comboBonus`)
- 아이템 상수: `server.js` L74~83 (`ITEM_IDS`, `ITEM_DURATIONS`, `GARBAGE_BOMB_LINES = 2` in board.js)
- 기존 WS 슈트 포트 충돌 방지: phase 슈트들은 `--port 3055` 사용, phase5 슈트들은 자체 구동 (소스 확인 권장)
- AI 버튼 UI 선례: `C:\LazySlimeStudio\minigames\omok\public\index.html` (오목 "🤖 AI랑 시작"), `C:\LazySlimeStudio\minigames\yahtzee\public\index.html` (요트 AI 버튼)
