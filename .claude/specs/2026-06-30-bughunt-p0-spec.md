# Feature: 버그 헌트 P0 — 시스템 결함 수정 (null WS 크래시 · playerId 중복 · 분수 좌표)

- visual_change: none
- pipeline: full

## 개요

버그 헌트에서 발굴된 시스템 결함 3종(P0-A/B/C)을 수정한다. 단일 WS 프레임으로 런처 전체(11게임)가 다운되는 DoS 경로, 재접속 시 playerId 중복으로 발생하는 영구 데드락, 장기의 분수 좌표 입력으로 발생하는 프로세스 크래시를 대상으로 한다.

## 배경 및 동기

모든 게임 server.js는 `JSON.parse(data)` → `switch(msg.type)` 패턴을 공유한다. `JSON.parse('null')`은 예외 없이 `null`을 반환하므로 catch를 통과한 뒤 `null.type` 접근에서 동기 TypeError가 throw된다. 이 throw는 ws 이벤트 리스너 내부에서 발생해 `uncaughtException`으로 전파되고, `launcher/server.js`에 핸들러가 없어 통합 프로세스(포트 3000, 11게임 공유)가 즉시 종료된다. 격리 포트에서 tetris-battle, yutnori, hanabi 3종에서 결정적으로 재현됐으며 동일 코드 패턴이 matgo, davinci-code, codenames-duet, janggi, yahtzee, omok, codenames에도 동일하게 존재한다. rummikub만 이미 수정돼 있다.

playerId 중복(P0-B)은 yutnori FIX-1에서 동일 클래스 버그가 이미 수정됐으나, davinci-code/codenames-duet/omok(확정 재현) + tetris-battle/hanabi/janggi(코드 감사 확인)에 미이식 상태다.

janggi 분수 좌표 크래시(P0-C)는 `lib/board.js inBounds()`가 정수 여부를 검사하지 않아 `board[2.5]`가 undefined를 반환하고 `undefined[1.5]`에서 throw된다. P0-A와 다른 경로(MOVE 핸들러)이지만 동일한 uncaughtException → 프로세스 종료 경로를 따른다.

---

## 요구사항

### 기능 요구사항

- [ ] P0-A: 10개 게임 server.js의 WS 메시지 핸들러에 null/비-객체 가드를 추가하여 `null` 프레임 1건이 서버 프로세스를 종료시키지 않게 한다.
- [ ] P0-A: `launcher/server.js`에 `process.on('uncaughtException')` 안전망을 추가하여 게임 서버에서 빠져나온 예외가 런처 프로세스를 종료시키지 않게 한다. 단, 과도한 예외 억제로 디버깅을 가리지 않도록 범위를 제한한다.
- [ ] P0-B: 6개 게임 server.js의 playerId 배정 로직을 yutnori FIX-1 패턴(usedIds 탐색)으로 교체하여 재접속 시 ID 중복이 발생하지 않게 한다.
- [ ] P0-C: `janggi/server.js` MOVE 핸들러에 정수 타입 검증을 추가하여 분수 좌표가 `applyMove`에 도달하지 않게 한다.

### 비기능 요구사항

- [ ] 기존 테스트 슈트가 모두 PASS를 유지해야 한다 (게임별 회귀 게이트 참조).
- [ ] 수정은 최소 침습 원칙을 따른다. 핸들러 로직·프로토콜·게임 룰은 변경하지 않는다.
- [ ] null guard의 클라이언트 가시 동작: 악성 프레임 수신 시 해당 WS 연결에만 ERROR 메시지를 보내고 연결을 유지한다(서버 다운 없음). 상대방 게임에는 영향 없음.

---

## 구현 상세

### P0-A: null/악성 WS 프레임 null guard

#### 공통 수정 패턴

각 game/server.js의 `ws.on('message', ...)` 핸들러에서 `JSON.parse` try/catch 직후, `switch(msg.type)` 이전에 아래 가드를 삽입한다.

```js
// JSON.parse('null')은 null, 'true'/'0' 등은 원시값으로 정상 파싱된다.
// 그 후 msg.type 접근 시 TypeError로 서버 프로세스가 죽으므로 객체+type 검증을 거친다.
if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') {
  try {
    sendTo(player, { type: 'ERROR', message: '잘못된 메시지 형식입니다.' });
  } catch (e) { /* 송신 실패는 무시 */ }
  return;
}
```

이 패턴은 rummikub/server.js L290-297에 이미 적용돼 있으므로 해당 파일을 참조 구현으로 삼는다.

#### 수정/생성할 파일

| 파일 경로 | 작업 유형 | 적용 위치 | 현재 상태 |
|---|---|---|---|
| `matgo/server.js` | 수정 | L408 `switch (msg.type)` 직전 (L406 이후) | 가드 없음 — 감사 대상 |
| `tetris-battle/server.js` | 수정 | L291 `switch (msg.type)` 직전 (L289 이후) | 가드 없음 — 확정 크래시 |
| `davinci-code/server.js` | 수정 | L169 `switch (msg.type)` 직전 (L167 이후) | 가드 없음 |
| `yutnori/server.js` | 수정 | L956 `switch (msg.type)` 직전 (L954 이후) | 가드 없음 — 확정 크래시 |
| `codenames-duet/server.js` | 수정 | L197 `switch (msg.type)` 직전 (L195 이후) | 가드 없음 |
| `janggi/server.js` | 수정 | L427 `switch (msg.type)` 직전 (L425 이후) | 가드 없음 |
| `hanabi/server.js` | 수정 | L203 `switch (msg.type)` 직전 (L201 이후) | 가드 없음 — 확정 크래시 |
| `yahtzee/server.js` | 수정 | L317 `switch (msg.type)` 직전 (L315 이후) | 가드 없음 |
| `omok/server.js` | 수정 | L354 `switch (msg.type)` 직전 (L352 이후) | 가드 없음 |
| `codenames/server.js` | 수정 | L457 `switch (msg.type)` 직전 (L455 이후) | 가드 없음 |
| `rummikub/server.js` | **수정 없음** | L290-297 이미 적용 | 이미 수정됨 |
| `launcher/server.js` | 수정 | 파일 상단 (HTTP createServer 이전) | uncaughtException 핸들러 없음 |

#### matgo/server.js 추가 주의사항

matgo는 P0-B 관련으로 이미 find 기반 배정(`players.find(p => p.id === 'p1') ? 'p2' : 'p1'`)을 쓰고 있어 P0-B에서 안전하다. P0-A null guard는 L406 `console.log` 이후, L408 `switch` 이전에 삽입한다.

#### launcher/server.js uncaughtException 안전망

launcher/server.js 상단(import 이후, HTTP 서버 생성 이전)에 추가한다.

```js
// ── P0-A 안전망: WS 핸들러에서 빠져나온 예외가 런처 프로세스를 종료시키지 않게 한다.
// 각 게임 server.js의 null guard(1차 방어)로 정상 경로는 차단되며,
// 이 핸들러는 예상치 못한 예외만 최후 방어한다.
// 주의: 모든 예외를 삼키면 디버깅이 어려워지므로 에러 정보를 반드시 stderr에 출력한다.
process.on('uncaughtException', (err, origin) => {
  console.error(`[launcher] uncaughtException (origin=${origin}):`, err);
  // 프로세스를 종료하지 않고 계속 실행한다.
  // 게임 서버별 WS 핸들러 내부의 예외만 이 경로로 유입됨을 기대한다.
});
```

**범위 제한 근거**: game/server.js의 null guard가 1차 방어를 담당한다. launcher의 uncaughtException은 null guard로 차단되지 않은 예외를 잡아 프로세스를 살리는 최후 안전망 역할이다. 로직 버그(undefined 변수 참조 등)나 의도치 않은 예외를 조용히 삼키지 않도록 `console.error`로 반드시 로깅한다. 향후 디버깅 시 stderr 로그를 통해 예외 경로를 추적할 수 있다.

---

### P0-B: 재접속 playerId 중복 데드락

#### 근본 원인

6개 게임에서 공통적으로 `const playerId = players.length === 0 ? 'p1' : 'p2'` 패턴을 사용한다. p1이 이탈하면 `players` 배열에 p2만 남아 length === 1이 되고, 신규 접속자도 'p2'를 받아 p2가 2명이 된다. `readySet`이 문자열 키 Set이라 'p2' 2개가 1개로 dedup돼 게임 시작 조건(size === 2)이 영구히 미충족된다.

#### 수정 패턴 (yutnori FIX-1 기반)

```js
// 미사용 ID를 배정 — players.length 기반은 재접속 시 ID 충돌 발생 (P0-B fix)
const usedIds = new Set(players.map((p) => p.id));
const playerId = ['p1', 'p2'].find((id) => !usedIds.has(id)) || 'p1';
```

yutnori는 2~4인 지원이라 ALL_IDS = ['p1','p2','p3','p4']를 쓰지만, 2인 전용 게임(davinci-code, codenames-duet, tetris-battle, hanabi, omok)은 `['p1', 'p2']`로 충분하다.

janggi는 2인 전용이므로 `['p1', 'p2']`를 사용하되, 기존 `?side=han/cho` 쿼리 기반 reconnect 경로(L327-328)는 별도로 `missingSide` 기반 배정을 유지한다. 단, 정상(non-reconnect) 접속 경로 L358의 `players.length === 0 ? 'p1' : 'p2'`를 usedIds 패턴으로 교체한다.

#### 수정/생성할 파일

| 파일 경로 | 현재 라인/코드 | 교체 내용 | 확정 상태 |
|---|---|---|---|
| `tetris-battle/server.js` | L265: `players.length === 0 ? 'p1' : 'p2'` | usedIds 패턴 | 감사로 발견 |
| `davinci-code/server.js` | L151: `players.length === 0 ? 'p1' : 'p2'` | usedIds 패턴 | 확정 재현(#3) |
| `codenames-duet/server.js` | L179: `players.length === 0 ? 'p1' : 'p2'` | usedIds 패턴 | 확정 재현(#2) |
| `hanabi/server.js` | L187: `players.length === 0 ? 'p1' : 'p2'` | usedIds 패턴 | 감사로 발견 |
| `omok/server.js` | L301: `players.length === 0 ? 'p1' : 'p2'` | usedIds 패턴 | 확정 재현(#1) |
| `janggi/server.js` | L358: `players.length === 0 ? 'p1' : 'p2'` | usedIds 패턴 (reconnect 경로 L327-328은 보존) | 감사로 발견 |

**SAFE (수정 불필요):**

| 파일 | 현재 패턴 | 이유 |
|---|---|---|
| `matgo/server.js` L358 | `players.find(p => p.id === 'p1') ? 'p2' : 'p1'` | 빈 슬롯 탐색 패턴, 안전 |
| `yutnori/server.js` L918-920 | `usedIds` + `ALL_IDS.find(...)` | FIX-1 이미 적용 |
| `yahtzee/server.js` L281-282 | `usedIds` + `ALL_IDS.find(...)` | 이미 안전 |
| `rummikub/server.js` L263 | `players.find(p => p.id === 'p1') ? 'p2' : 'p1'` | 빈 슬롯 탐색, 안전 |
| `codenames/server.js` L425-428 | `usedIds` + 슬롯 탐색 | 이미 안전 |

#### 각 파일별 변경 상세

**tetris-battle/server.js** (L264 주석 유지, L265 교체):
```js
// 비어있는 슬롯 ID에 할당 — players.length 기반은 재접속 시 ID 충돌 발생 (P0-B fix)
const usedIds = new Set(players.map((p) => p.id));
const playerId = ['p1', 'p2'].find((id) => !usedIds.has(id)) || 'p1';
```

**davinci-code/server.js** (L150 이후 교체):
```js
// 비어있는 슬롯 ID에 할당 — players.length 기반은 재접속 시 ID 충돌 발생 (P0-B fix)
const usedIds = new Set(players.map((p) => p.id));
const playerId = ['p1', 'p2'].find((id) => !usedIds.has(id)) || 'p1';
```

**codenames-duet/server.js** (L178 이후 교체):
```js
// 비어있는 슬롯 ID에 할당 — players.length 기반은 재접속 시 ID 충돌 발생 (P0-B fix)
const usedIds = new Set(players.map((p) => p.id));
const playerId = ['p1', 'p2'].find((id) => !usedIds.has(id)) || 'p1';
```

**hanabi/server.js** (L186 이후 교체):
```js
// 비어있는 슬롯 ID에 할당 — players.length 기반은 재접속 시 ID 충돌 발생 (P0-B fix)
const usedIds = new Set(players.map((p) => p.id));
const playerId = ['p1', 'p2'].find((id) => !usedIds.has(id)) || 'p1';
```

**omok/server.js** (L300 이후 교체, color 배정은 L302 이후 그대로 유지):
```js
// 비어있는 슬롯 ID에 할당 — players.length 기반은 재접속 시 ID 충돌 발생 (P0-B fix)
const usedIds = new Set(players.map((p) => p.id));
const playerId = ['p1', 'p2'].find((id) => !usedIds.has(id)) || 'p1';
const color = playerId === 'p1' ? 'black' : 'white';  // L302: color 배정 기존 유지
```

**janggi/server.js** (L357 주석 유지, L358 교체. L327-328 reconnect 경로는 보존):
```js
// 진영 배정: p1=한, p2=초 (기본). 쿼리로 명시 가능
// 비어있는 슬롯 ID에 할당 — players.length 기반은 재접속 시 ID 충돌 발생 (P0-B fix)
const usedIds = new Set(players.map((p) => p.id));
const playerId = ['p1', 'p2'].find((id) => !usedIds.has(id)) || 'p1';
```

---

### P0-C: 장기 분수 좌표 크래시

#### 근본 원인

- `janggi/lib/board.js:283-285` — `inBounds(file, rank)` 는 범위 검사만 하고 `Number.isInteger()` 검사가 없어 `inBounds(1.5, 2.5) === true` 반환.
- `janggi/lib/board.js:181` — `getPiece`의 `board[rank][file]`에서 `board[2.5]`가 `undefined`, 이어 `undefined[1.5]` 접근에서 `TypeError` throw.
- `janggi/server.js:480-483` — MOVE 핸들러가 `msg.fromFile`, `msg.fromRank`, `msg.toFile`, `msg.toRank`를 타입 검증 없이 `applyMove`에 직접 전달.
- `janggi/server.js:418-427` — WS `ws.on('message')` 내 switch는 try/catch 밖이라 위 TypeError가 `uncaughtException`으로 전파 → 프로세스 exit 1.

P0-A null guard를 추가하면 null 프레임 크래시는 막히지만, 분수 좌표 MOVE는 msg 자체는 유효한 객체라 null guard를 통과한다. 따라서 별도 검증이 필요하다.

#### 수정 방향

`janggi/server.js` MOVE 핸들러(L480-483)에서 `applyMove` 호출 이전에 좌표 4값이 정수임을 검증한다.

```js
case 'MOVE': {
  if (!game) break;
  const { fromFile, fromRank, toFile, toRank } = msg;
  // 좌표가 정수인지 검증 — 분수/문자열/undefined 시 서버 크래시 방어 (P0-C fix)
  if (
    !Number.isInteger(fromFile) || !Number.isInteger(fromRank) ||
    !Number.isInteger(toFile)   || !Number.isInteger(toRank)
  ) {
    sendTo(player, { type: 'ERROR', message: '잘못된 좌표 형식입니다.' });
    break;
  }
  const result = applyMove(game, player.side, fromFile, fromRank, toFile, toRank);
  // ... 이하 기존 코드 유지
```

#### 추가 검토 — 타 게임의 액션 페이로드 취약점

P0-A null guard로 null 프레임은 전 게임에서 차단된다. 그러나 유효한 JSON 객체이지만 좌표/인덱스가 분수·문자열인 경우는 null guard를 통과한다. 아래 게임의 핸들러를 Coder가 추가 감사해야 한다.

| 게임 | 취약 가능 액션 | 검증 포인트 | 위험도 |
|------|-------------|-----------|-------|
| `janggi/server.js` | MOVE: fromFile/fromRank/toFile/toRank | **P0-C에서 수정** | HIGH → 수정 |
| `janggi/server.js` | REQUEST_MOVES: file/rank | board.js:181 옵셔널체이닝(`board[rank]?.[file]`)으로 이미 방어 | 안전 |
| `omok/server.js` | PLACE: x/y | `game.js placeStone`이 범위 검사 포함, 분수 → 배열 인덱스 float 접근 위험 확인 필요 | 감사 |
| `yahtzee/server.js` | SCORE_CATEGORY: category | 문자열 인덱스라 float 크래시 없음 | 안전 |
| `rummikub/server.js` | MOVE_TILE: setId, tileId | string 기반 탐색, float 크래시 없음 | 안전 |
| `davinci-code/server.js` | GUESS: slot(정수 인덱스) | handIndex 분수 시 배열 float 접근 가능성 감사 | 감사 |
| `yutnori/server.js` | MOVE_PIECE: pieceIndex | 범위 검사 코드 확인 필요 | 감사 |

**감사 우선순위**: omok PLACE(x/y 분수), davinci GUESS(slot 분수), yutnori MOVE_PIECE(pieceIndex 분수). 크래시가 확인되면 해당 핸들러에도 `Number.isInteger` 가드를 추가한다. 크래시가 없으면 현상 유지.

#### 수정/생성할 파일

| 파일 경로 | 작업 유형 | 설명 |
|---|---|---|
| `janggi/server.js` | 수정 | L480-483 MOVE 핸들러에 fromFile/fromRank/toFile/toRank 정수 검증 추가 |
| `omok/server.js` | 감사 후 조건부 수정 | PLACE x/y float 접근 위험 확인 → 필요 시 Number.isInteger 가드 추가 |
| `davinci-code/server.js` | 감사 후 조건부 수정 | GUESS slot float 접근 위험 확인 → 필요 시 Number.isInteger 가드 추가 |
| `yutnori/server.js` | 감사 후 조건부 수정 | MOVE_PIECE pieceIndex float 접근 위험 확인 → 필요 시 Number.isInteger 가드 추가 |

---

## 수용 기준 (Acceptance Criteria)

### P0-A

- [ ] `ws.send('null')` 1회로 격리 포트에서 tetris-battle, yutnori, hanabi 서버를 실행했을 때 프로세스가 종료되지 않는다.
- [ ] 동일 재현 절차(findings tetris-battle #1·yutnori #1·hanabi #1)를 정확히 따랐을 때 `aliveAfterNullMsg === true` (직후 신규 WS 접속 가능).
- [ ] null 프레임 수신 클라이언트에 `{ type: 'ERROR', message: '잘못된 메시지 형식입니다.' }`가 전달되고 WS 연결이 유지된다.
- [ ] 10개 게임 + 런처 모두에 가드 적용됐음을 코드 감사로 확인한다.
- [ ] JSON.parse가 throw하는 비-JSON 프레임(예: `'hello'`(invalid JSON))은 기존 try/catch catch로 잡혀 return되므로, 해당 경로는 기존 동작을 그대로 유지한다.
- [ ] 배열/숫자/boolean JSON 프레임(예: `'[1,2]'`, `'42'`, `'true'`)은 새 null guard에서 차단되어 switch에 도달하지 않는다.
- [ ] `launcher/server.js`에 `uncaughtException` 핸들러가 존재하고, 발화 시 stderr에 에러를 출력하되 프로세스를 종료하지 않는다.

### P0-B

- [ ] davinci-code, codenames-duet, omok 각각에 대해 findings #3/#2/#1 확정재현 절차를 실행했을 때 `dupId === false`, `gameStarted === true` (새 플레이어가 올바른 ID를 받아 게임이 시작된다).
- [ ] tetris-battle, hanabi, janggi에 대해 동일 패턴(A connect → B connect → A close → C connect → B·C READY → 게임 시작 여부)을 실행했을 때 C가 올바른 빈 슬롯 ID를 받는다.
- [ ] SAFE 게임(matgo, yutnori, yahtzee, rummikub, codenames)의 playerId 배정 코드는 변경되지 않는다.

### P0-C

- [ ] findings janggi #1 확정재현 절차(READY 2회 → playing 진입 → 분수 좌표 MOVE 1건)를 실행했을 때 서버 프로세스가 exit code 1로 종료되지 않는다.
- [ ] 분수 좌표 MOVE 수신 클라이언트에 `{ type: 'ERROR', message: '잘못된 좌표 형식입니다.' }`가 전달되고 게임이 계속 진행 가능하다.
- [ ] 합법 정수 좌표 MOVE는 기존과 동일하게 처리된다.
- [ ] P0-C 감사 대상(omok PLACE, davinci GUESS, yutnori MOVE_PIECE)에 대해 감사 결과를 리포트에 명시한다.

### 공통 회귀 게이트

- [ ] tetris-battle 기존 슈트 (~315건, Q7b known-baseline 제외) PASS
- [ ] davinci-code game-unit-qa 53 + davinci-plus-qa 25 = 78 PASS
- [ ] yutnori 서버리스 338 + E2E 25 + bot-smoke 10 = 373 PASS
- [ ] codenames-duet review-smoke 27 + review-visual 11 = 38 PASS
- [ ] janggi 룰북/단위 246 + bot-eval 8 + P1 lib 73 = 327 PASS
- [ ] hanabi 78 PASS
- [ ] yahtzee 249 PASS
- [ ] rummikub smoke 150 + qa-pass4-sort 34 + qa-pass3-attack 48 + qa-pass3-parity 12 = 244+ PASS
- [ ] omok smoke 106 + qa-edge 35 + qa-renju-attack 28 + qa-rematch-attack 14 + qa-draw-bot 9 + bot-smoke 14 + E2E+모바일 4 = 210 PASS
- [ ] codenames smoke 65 + bot-knowledge 22 + bot-smoke 23 + E2E 12 = 122 PASS

---

## 범위 경계 (Out of Scope)

- P0-A: 가드 추가 이외의 게임 로직·룰·프로토콜 변경 없음
- P0-B: 재접속 후 게임 상태를 복원하는 재접속 복구 기능 구현 없음 (janggi #2는 P2 대상)
- P0-C: `janggi/lib/board.js inBounds()`에 `Number.isInteger` 추가는 범위 외 — 서버 핸들러에서 차단하는 방식만 허용. board.js는 pure function이라 서버 외에도 호출될 수 있으므로 독립 감사 필요
- 안티치트 구현, WS 인증 강화, 연결 제한 등 보안 고도화는 Out of Scope (LAN 설계 원칙)
- matgo의 P0-A 가드 상태는 Coder가 실제 코드를 감사 후 수정 여부를 결정. 이 스펙은 matgo가 취약한 것으로 가정하고 수정 대상에 포함했으나 이미 안전하다면 무수정
- 비-baseline 회귀FAIL(stale 테스트) 처리는 P2 스펙 담당

---

## Art Director 실행 계획

- visual_change: none
- AD 모드 1 (에셋 컨셉): 해당 없음 — 순수 백엔드 서버 코드 수정, 시각적 변경 없음
- AD 모드 2 (에셋 검증): 해당 없음
- AD 모드 3 (UI 레이아웃): 해당 없음
- 멀티 페이즈 시 AD 반복 계획: P0는 단일 페이즈, visual_change: none으로 AD 불필요

---

## 제약사항

- 기존 테스트 슈트를 깨는 수정은 금지. 회귀 게이트 전부 PASS 후 QA 전환.
- P0-A null guard의 `sendTo` 호출은 try/catch로 감싸야 한다. WS가 이미 닫혀있을 때 sendTo가 throw할 수 있다.
- launcher의 `process.on('uncaughtException')`은 **결코 `process.exit()`를 호출하지 않는다**. 에러를 stderr에 출력하고 프로세스를 유지하는 것이 목표.
- janggi `?side=han/cho` 쿼리 기반 reconnect 경로(L327-328)는 P0-B 수정에서 보존한다. 이 경로는 `missingSide`를 기반으로 한 올바른 ID 배정이다.

## 참고사항

- bughunt-findings.md: 각 버그의 확정재현 절차 및 스택 증거
- rummikub/server.js L290-297: P0-A 가드 참조 구현 (comment 포함)
- yutnori/server.js L916-920: P0-B usedIds 패턴 참조 구현 (FIX-1 주석 포함)
- 2026-06-30-bughunt-scope.md: 전체 트리아지 표 및 페이즈 배정 근거
