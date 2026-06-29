# Feature: 버그 헌트 P1 — 게임별 HIGH 결함 수정 (6종)

## 개요
버그 헌트(워크플로우 wwsgdr15r) 확정 결함 중 HIGH 등급 6건을 게임별로 수정한다. 다빈치 코드 조커 마스킹 누락, 코드네임 듀엣 그린 더블 크레딧, 루미큐브 첫 등판 레이오프, 윷놀이 백도 데드락, 코드네임 봇 스파이마스터 데드락(잔여 엣지), 오목 봇 금수 거절 행(hang) 6건을 수정한다.

## 배경 및 동기
격리 포트 기반 적대적 재현으로 확정된 결함들로, 게임 핵심 메커닉 붕괴(조커 추리, 승패 판정, 완주 상태, 봇 영구 정지) 및 룰 위반에 해당한다. HIGH 결함은 정상 플레이 흐름에서 도달 가능하며 복구 불가 상태를 유발한다.

---

## 결함 1: 다빈치 코드 — 조커 마스킹 누락 (HIGH)

### 근본 원인
- **파일**: `davinci-code/game.js`
- **위치 A**: `snapshotForPlayer` 함수의 `oppHand` 생성부 (line ~493)
  ```javascript
  isJoker: c.isJoker  // 미공개(revealed=false) 카드에도 무조건 전송
  ```
  `revealed: false` 카드에도 `isJoker: c.isJoker`를 그대로 전송해 상대가 와이어 레벨에서 조커 위치를 식별한다.
- **위치 B**: `pendingDrawn` 상대 분기 (line ~507-511)
  ```javascript
  isJoker: state.pendingDrawn.isJoker  // 상대가 뽑은 카드의 조커 여부 노출
  ```
  `value`는 `null`로 마스킹하면서 `isJoker`는 노출한다.
- **연쇄 렌더**: `public/client.js:444` `renderOppHand`가 `if (card.isJoker) el.classList.add('joker')`를 `revealed` 무관하게 적용 → `public/style.css:224` `.card.joker::after{content:'★'}`가 미공개 카드에 별 아이콘 렌더. **단, CSS/client.js 자체는 수정 불필요** — game.js에서 마스킹하면 클라가 isJoker를 false로 수신해 joker 클래스가 자동 미부여된다.

### 수정 방식
`game.js` `snapshotForPlayer` 내:
1. `oppHand` 생성: `isJoker: c.revealed ? c.isJoker : false` — 미공개 카드의 isJoker를 false로 마스킹
2. `pendingDrawn` 상대 분기 else: `isJoker: false` — 상대가 뽑은 카드의 isJoker도 마스킹 (value와 동일 원칙)

### 테스트 수정 필요
`tests/game-unit-qa.spec.js` **G-40** (line ~408):
```javascript
// 현재: oppHand.some(c => c.isJoker) === true 단언 — 미공개 카드에 isJoker 포함을 '기능'으로 단언
// 수정 후: 미공개 oppHand의 isJoker는 false여야 한다
test('G-40: 미공개 상대 카드의 isJoker는 마스킹되어 false', () => {
  // revealed=false인 oppHand 카드 전체의 isJoker === false 검증
});
```
**G-45** (공개된 조커 카드, `revealed=true, isJoker=true`): 이미 정상 — 수정 불필요.

`tests/davinci-plus-qa.spec.js` E-17도 조커 노출을 단언하는지 확인하고 동일하게 수정한다.

### 영향 파일
| 파일 | 작업 유형 | 설명 |
|---|---|---|
| `davinci-code/game.js` | 수정 | oppHand.isJoker 마스킹 + pendingDrawn 상대 분기 isJoker: false |
| `davinci-code/tests/game-unit-qa.spec.js` | 수정 | G-40 단언 반전 (누설 → 마스킹) |
| `davinci-code/tests/davinci-plus-qa.spec.js` | 확인·수정 | E-17 조커 노출 단언 시 동일하게 수정 |

### 수용 기준
- `snapshotForPlayer(state, 'p2').oppHand`의 `revealed=false` 카드 모두 `isJoker === false`
- `snapshotForPlayer(state, 'p2').pendingDrawn`(상대 분기)이 `isJoker === false`
- 공개(revealed=true) 조커 카드는 `isJoker === true` 유지
- 기존 회귀 슈트 53/53 PASS (game-unit-qa), 25/25 PASS (davinci-plus-qa)

### 회귀 보호
- 기존 슈트: `game-unit-qa.spec.js`(53), `davinci-plus-qa.spec.js`(25) — G-40 수정 외 전체 유지
- smoke-test.js는 구 프로토콜 기준 stale → 대상 외

---

## 결함 2: 코드네임 듀엣 — 그린 더블 크레딧 (HIGH)

### 근본 원인
- **파일**: `codenames-duet/game.js`
- **위치**: `guessCard` 함수 내 녹색 진척 갱신부 (line ~196-197)
  ```javascript
  if(keyCard[index].left==='green') greenFound.p1=countSideGreen('left');
  if(keyCard[index].right==='green') greenFound.p2=countSideGreen('right');
  ```
  두 조건이 `result`(실제 공개 결과)와 무관하게 raw keyCard 값만으로 평가된다. card 17이 `{left:'neutral', right:'green'}`일 때 p2가 눌러 result='neutral'이 나와도 `keyCard[17].right==='green'` 조건이 true라 `greenFound.p2`가 증가한다 → **중립 클릭으로 승리** 발생.
- **추가 문제**: `countSideGreen`(line ~235-241)은 공개된 모든 카드를 `시점 무관 합산`하므로, 중립으로 공개된 카드의 반대면 green도 이후 재집계 시 포함될 수 있다.

정통 Codenames Duet 룰: **단서자의 키 카드가 green인 경우에만** 진척을 인정한다. 단서자 키가 bystander(중립)로 공개된 카드는 추측자 키의 agent여도 영구 소실이다.

### 수정 방식
`game.js` line ~196-197을 아래로 교체:
```javascript
// 정통 듀엣 룰: result='green'일 때만 해당 면의 green을 적립한다.
// 중립·암살자로 공개된 카드의 반대면 green은 영구 소실.
if (result === 'green') {
  if (keyCard[index].left === 'green') greenFound.p1++;
  if (keyCard[index].right === 'green') greenFound.p2++;
}
```
- `countSideGreen` 재집계 대신 증분 `++` 사용 — 중립으로 공개된 카드가 이후 집계에 포함되는 과잉 계산 방지
- `if (result === 'green')` 가드가 핵심: 단서자 키가 green인 결과일 때만 적립

더블 에이전트 카드(`left:'green', right:'green'`)는 result='green'일 때 양쪽 모두 `++` → 정통 룰 올바름.

### 영향 파일
| 파일 | 작업 유형 | 설명 |
|---|---|---|
| `codenames-duet/game.js` | 수정 | guessCard 녹색 적립 로직 교체 |
| `codenames-duet/tests/review-smoke.mjs` | 확인·수정 | 중립 클릭 시 greenFound 미증가 단언 추가 |

### 수용 기준
- `guessCard(state,'p2',17)`(card 17 = `{left:'neutral', right:'green'}`) 결과 `result==='neutral'`이고 `greenFound.p2`는 변화 없음
- 중립 클릭으로 `phase==='won'`이 되지 않음
- 더블 에이전트 카드 공개 시 양쪽 greenFound 모두 정상 증가
- 기존 슈트 review-smoke.mjs 27/27 PASS, review-visual.mjs 11/11 PASS 유지

### 회귀 보호
- 기존 슈트: `tests/review-smoke.mjs`(27), `tests/review-visual.mjs`(11)

---

## 결함 3: 루미큐브 — 첫 등판 레이오프 허용 (HIGH)

### 근본 원인
- **파일**: `rummikub/game.js`
- **위치**: `moveTile` 함수의 `from.kind === 'hand'` 경로 (line ~435-442)

현재 `moveTile`에는 첫 등판(`!state.played[by]`) 시:
- `from=set → to=hand`: 기존 보드 타일 회수 차단 ✓ (line 453-458)
- `from=set → to=set`: 기존 보드 타일의 세트 간 이동 차단 ✓ (line 462-470)
- **`from=hand → to=set`**: **기존 보드 세트에 손 타일 추가하는 레이오프(lay-off) 차단 없음** ✗

이 결과, 첫 등판 전 플레이어가:
1. 손에서 새 세트(≥30점)를 보드에 내어 첫 등판 조건 충족
2. 나머지 손 타일 전부를 상대 기존 세트에 레이오프 (`from=hand → to=existing_set`)
3. 손 0장 → 즉시 승리

`computeInitialMeldScore`의 "방어선 2중화"(line ~1011-1016)는 기존 타일이 섞인 세트의 점수를 0으로 방어하지만, 레이오프 타일의 commit 자체는 막지 못한다. 손이 0장이 되면 게임 오버 판정이 먼저 적용된다.

### 수정 방식
`moveTile` 함수의 `from.kind === 'hand'` 검증부 (tile이 손에 있음을 확인한 직후)에 가드 추가:
```javascript
// [신규 가드] 첫 등판 전: 기존 보드 세트에 손 타일 추가(레이오프) 차단
if (to.kind === 'set' && !state.played[by]) {
  const snapSet = state.turnSnapshot
    && state.turnSnapshot.board.find(s => s.id === to.setId);
  if (snapSet && snapSet.tiles.length > 0) {
    return { ok: false, error: '첫 등판 전에는 기존 보드의 세트에 타일을 추가할 수 없습니다.' };
  }
}
```
- `state.turnSnapshot.board`는 턴 시작 시 캡처된 보드 스냅샷 → `snapSet.tiles.length > 0`이면 기존 세트
- 이번 턴에 자신이 새로 만든 세트(NEW_SET, 턴 스냅샷에 없음)에 추가하는 것은 허용

### 영향 파일
| 파일 | 작업 유형 | 설명 |
|---|---|---|
| `rummikub/game.js` | 수정 | moveTile hand→set 경로에 첫 등판 레이오프 차단 가드 추가 |
| `rummikub/tests/smoke.test.js` | 수정 | RUMMI-038: 첫 등판 전 기존 세트 레이오프 거부 확인 |

### 수용 기준
- 첫 등판 전 `MOVE_TILE { from:{kind:'hand',...}, to:{kind:'set', setId:'기존세트ID',...} }` → `{ok:false, error:'첫 등판 전에는 기존 보드의 세트에 타일을 추가할 수 없습니다.'}`
- 첫 등판 전 NEW_SET(새로 만든 세트)에 추가하는 것은 계속 허용됨
- 첫 등판 후(state.played[by]=true) 기존 세트 레이오프 정상 허용
- 기존 smoke 150/150 PASS, qa-pass4-sort 34/34 PASS 유지

### 회귀 보호
- 기존 슈트: `tests/smoke.test.js`(150), `tests/qa-pass4-sort.test.js`(34)
- qa-edge, qa-pass2, qa-pass3 슈트 전체 유지

---

## 결함 4: 윷놀이 — 백도 큐 잔류 영구 데드락 (HIGH)

### 근본 원인
- **파일**: `yutnori/server.js`

데드락 시나리오:
1. 말 1개만 출전(cell≠HOME, done=false), 나머지 3개 HOME
2. 윷/모 던지기 → pendingResults=[yut/mo], pendingThrows=1
3. 보너스 THROW → 백도 → 이때 출전 말이 있어(`canUseBackdo=true`) 큐에 보존 → pendingResults=[yut/mo, backdo]
4. MOVE_PIECE(yut/mo)로 출전 말을 완주(GOAL) → pendingResults=['backdo'], piece0.done=true, 나머지 HOME
5. **영구 데드락**:
   - THROW_YUT: 큐가 비지 않고 마지막이 'backdo'(≠yut/mo) → 거부
   - MOVE_PIECE(backdo): done 말 → "완주한 말은 옮길 수 없습니다" / HOME 말 → "백도는 출발한 말에만 사용할 수 있습니다" → 거부, 큐 미차감
   - passTurn: `pendingResults.length === 0`일 때만 (line ~1159) → 영원히 미충족
   - 서버에 "합법수 없을 때 자동 폐기/패스" 로직 부재

### 수정 방식
**새 헬퍼 함수** `autoDiscardUnusableBackdos(pieces)` 추가:
```javascript
/**
 * 현재 플레이어 말 배열을 검사해, 백도를 사용할 수 있는 출전 말이
 * 존재하지 않으면 pendingResults에서 backdo를 모두 제거한다.
 * 제거 후 큐가 비고 보너스도 없으면 passTurn()을 호출한다.
 * @param {Array} pieces — 현재 플레이어의 말 배열
 */
function autoDiscardUnusableBackdos(pieces) {
  const hasValidTarget = pieces.some(p => !p.done && p.cell !== HOME);
  if (hasValidTarget) return;  // 출전 말 있음 — 폐기 불필요
  const before = game.pendingResults.length;
  game.pendingResults = game.pendingResults.filter(r => r !== 'backdo');
  if (game.pendingResults.length < before) {
    console.log('[server] 백도 자동 폐기 (출전 말 없음 — 사용 불가)');
  }
  // 큐 소진 후 보너스도 없으면 턴 종료
  const hasBonus = game.capturedBonus === true || game.pendingThrows > 0;
  if (game.pendingResults.length === 0 && !hasBonus) {
    passTurn();
    game.capturedBonus = false;
  }
}
```

**호출 위치 2곳** (둘 다 `game.pendingResults.splice(...)` 직후, `if (moveRes.finished)` 체크 이전):

1. **MOVE_PIECE 핸들러** (line ~1127 splice 직후):
   ```javascript
   game.pendingResults.splice(queueIdx, 1);
   // [신규] 백도 자동 폐기 체크
   autoDiscardUnusableBackdos(player.pieces);
   if (moveRes.finished) { ... }
   ```

2. **CHOOSE_PATH 핸들러** (line ~1236 splice 직후):
   ```javascript
   if (queueIdx >= 0) game.pendingResults.splice(queueIdx, 1);
   // [신규] 백도 자동 폐기 체크
   autoDiscardUnusableBackdos(player.pieces);
   if (moveRes.finished) { ... }
   ```

**주의**: 기존 THROW_YUT 핸들러의 "첫 던지기 시점 백도 자동 폐기"(line ~1033-1059, canUseBackdo)는 그대로 유지한다. 신규 로직은 말 이동 후 잔류 백도 처리다.

### 영향 파일
| 파일 | 작업 유형 | 설명 |
|---|---|---|
| `yutnori/server.js` | 수정 | `autoDiscardUnusableBackdos` 헬퍼 추가 + MOVE_PIECE/CHOOSE_PATH 호출 |
| `yutnori/tests/rulebook-c8-*.spec.js` 또는 신규 | 수정·추가 | 백도 큐 잔류 + 전말 완주 → passTurn 확인 (YR-C8-015 또는 신규 inject 시나리오) |

### 수용 기준
- inject: pendingResults=['backdo'] + 모든 말 done=true(또는 HOME) → 서버가 자동 폐기 후 passTurn() → currentTurn 상대로 전환
- 정상 플레이: 윷/모 → 보너스 백도 → 잡기(출전 말 유지) → 백도로 1칸 후퇴는 정상 동작 유지
- 기존 서버리스 342/342 PASS 유지, bot-smoke 10/10 PASS 유지

### 회귀 보호
- 서버리스 회귀: `tests/rulebook-c*.spec.js`(342), `tests/qa-rulefix-edge.spec.js`(26), `tests/qa-defect2-captured-bonus-stuck.spec.js`
- bot-smoke: `tests/bot-smoke.test.js`(10)
- THROW_YUT 첫 던지기 시점 백도 자동 폐기(canUseBackdo)는 수정하지 않으므로 해당 테스트 무영향

---

## 결함 5: 코드네임 클래식 — 봇 스파이마스터 0회-공개 데드락 (HIGH/잔여 엣지)

### 코드 확인 결과
`codenames/bot.js`의 `stateKey` 함수(line ~252):
```javascript
function stateKey(s) {
  const revealedCount = (s.revealed || []).filter((x) => x !== null).length;
  if (MY_ROLE === 'spymaster') {
    // DEFECT-1 수정됨: revealedCount 포함
    return `sm|${s.currentTeam}|${s.turnPhase}|${s.redFound}|${s.blueFound}|${revealedCount}`;
  }
  return `op|${s.currentTeam}|${s.turnPhase}|${s.guessesLeft}|${revealedCount}`;
}
```
**DEFECT-1(스파이마스터 중립 카드 데드락)은 이미 수정된 상태**다.

### 잔여 엣지: 0-공개 패스 턴 후 stateKey 충돌
**요원(operative) 봇이 단서 태그 미매칭으로 즉시 END_TURN** (0장 공개)하면 `revealedCount`가 변하지 않는다. 이후:
1. 상대 팀도 0장 공개 패스 → `revealedCount` 여전히 불변
2. 내 팀 스파이마스터 차례 재도래: `stateKey = sm|MY_TEAM|clue|{same}|{same}|{same revealedCount}`
3. 이전 `lastActedFor === key` → 봇이 재행동을 건너뜀 → **영구 정지**

`currentTeam`이 사이클로 돌아왔을 때 stateKey가 이전 차례와 완전히 동일해지는 케이스다 (DEFECT-1은 중립 카드 공개로 revealedCount가 변하는 케이스만 해결). 실제로는 상대 팀도 0장 패스해야 발생하므로 일반 게임에서 드물지만, 봇 v.s. 봇 연장전에서 재현 가능.

### 수정 방식

**게임 상태에 턴 카운터 추가** (3파일 변경):

1. **`codenames/game.js`** — `createGame` 초기 상태에 `turnCount: 0` 추가, `endTurn` 함수에 `state.turnCount = (state.turnCount || 0) + 1` 추가:
   ```javascript
   function endTurn(state, team) {
     if (state.gamePhase !== 'playing') return;
     state.currentTeam = opponentTeam(team);
     state.turnPhase = 'clue';
     state.currentClue = null;
     state.guessesLeft = 0;
     state.turnCount = (state.turnCount || 0) + 1;  // [신규]
   }
   ```

2. **`codenames/server.js`** — STATE 스냅샷 브로드캐스트 시 `turnCount: state.turnCount` 포함

3. **`codenames/bot.js`** — `stateKey` 스파이마스터 키에 `turnCount` 추가:
   ```javascript
   return `sm|${s.currentTeam}|${s.turnPhase}|${s.redFound}|${s.blueFound}|${revealedCount}|${s.turnCount ?? 0}`;
   ```
   `turnCount`가 없는 구버전 STATE(후방 호환) 대비 `?? 0`.

### 영향 파일
| 파일 | 작업 유형 | 설명 |
|---|---|---|
| `codenames/game.js` | 수정 | createGame에 turnCount:0 + endTurn에 turnCount++ |
| `codenames/server.js` | 수정 | STATE 브로드캐스트에 turnCount 포함 |
| `codenames/bot.js` | 수정 | stateKey SM 키에 `|${s.turnCount ?? 0}` 추가 |
| `codenames/tests/bot-smoke.test.js` | 수정 | 0-공개 패스 후 SM 재행동 확인 시나리오 추가 |

### 수용 기준
- 요원 봇이 END_TURN (0장 공개) 후 스파이마스터 봇이 다음 차례에 새 단서를 정상 제공
- 양 팀 봇이 교번하여 게임이 영구 정지 없이 완료
- 기존 smoke 65/65 PASS, E2E 12/12 PASS, bot-smoke 23/23 PASS 유지

### 회귀 보호
- 기존 슈트: `tests/smoke.test.js`(65), `tests/e2e.spec.js`(12), `tests/bot-smoke.test.js`(23), `tests/bot-knowledge.test.js`(22)
- codenames-duet 회귀 27/27 무영향 (독립 게임)

---

## 결함 6: 오목 — 봇 금수 거절 후 영구 행(hang) (HIGH/MED)

### 근본 원인
- **파일**: `omok/bot.js`
- **위치**: `ERROR` 케이스 핸들러 (line ~120-132)

현재 ERROR 핸들러:
```javascript
case 'ERROR':
  // ...
  lastActedFor = null;  // 키 리셋
  if (pendingActTimer) { clearTimeout(pendingActTimer); pendingActTimer = null; }
  break;
```

금수(쌍삼·사사) 착수 거절 시 서버는 `ERROR { message: '...' }`를 보내고 **새 STATE를 보내지 않는다** (board/moveCount가 변하지 않으므로). 봇은 `lastActedFor = null`로 키를 리셋하지만, `handleState`를 통한 재트리거가 없어 **무한 대기**에 빠진다.

추가 문제: 재시도 시 `chooseMove(lastState)`는 동일 STATE를 기반으로 동일 셀을 다시 선택한다 (금수 거절 후 board는 원복되어 해당 셀이 여전히 empty) → **무한 재거절 루프**. 따라서 거절된 셀을 제외 목록에 추가해야 한다.

### 수정 방식
`bot.js`에 세 가지 변경:

**1. 금수 제외 목록 추적 변수 추가** (모듈 상단):
```javascript
/** 금수로 거절된 칸 집합 (`${row},${col}` 형식). 새 STATE 도착 시 초기화. */
const bannedCells = new Set();
/** 직전 시도한 착수. ERROR 수신 시 banned에 추가하는 데 사용. */
let lastAttemptedMove = null;
```

**2. `act` 함수 수정** — `chooseMove` 대신 제외 목록 반영하는 `chooseMoveExcluding` 사용:
```javascript
function act(s) {
  const move = chooseMoveExcluding(s, bannedCells);
  if (!move) {
    console.log('[omok-bot] 둘 곳 없음 (금수 제외 후) — 패스');
    return;
  }
  lastAttemptedMove = { row: move.row, col: move.col };
  console.log(`[omok-bot] PLACE (${move.row},${move.col})`);
  send({ type: 'PLACE', row: move.row, col: move.col });
}

function chooseMoveExcluding(s, banned) {
  const board = s.board;
  const opColor = myColor === 'black' ? 'white' : 'black';
  if (s.moveCount === 0) {
    const center = Math.floor(BOARD_SIZE / 2);
    if (!banned.has(`${center},${center}`)) return { row: center, col: center };
  }
  let bestScore = -Infinity, bestMove = null;
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row * BOARD_SIZE + col] !== null) continue;
      if (banned.has(`${row},${col}`)) continue;
      const score = evaluate(board, row, col, myColor, opColor);
      if (score > bestScore) { bestScore = score; bestMove = { row, col }; }
    }
  }
  return bestMove;
}
```
기존 `chooseMove` 함수는 유지(단독 참조가 없으면 제거 가능, Coder 판단).

**3. `handleState` 수정** — 새 STATE 도착 시 banned 초기화:
```javascript
function handleState(s) {
  lastState = s;
  bannedCells.clear();   // [신규] 보드 상태 변경 → 금수 제외 목록 초기화
  // ...기존 로직...
}
```

**4. `ERROR` 핸들러 수정** — 금수 거절 셀을 banned에 추가 후 재시도 예약:
```javascript
case 'ERROR':
  if (msg.message && msg.message.includes('가득')) {
    console.error('[omok-bot] 방이 가득 찼다. 봇은 빠진다.');
    ws.close();
  } else {
    console.warn('[omok-bot] 착수 거절 (금수 등):', msg.message);
    // 거절된 셀 기록
    if (lastAttemptedMove) {
      bannedCells.add(`${lastAttemptedMove.row},${lastAttemptedMove.col}`);
    }
    lastActedFor = null;
    if (pendingActTimer) { clearTimeout(pendingActTimer); pendingActTimer = null; }
    // 새 STATE 없이 즉시 재시도 — 금수가 아닌 다른 칸 선택
    if (lastState) {
      const delay = 200 + Math.floor(Math.random() * 200);
      pendingActTimer = setTimeout(() => {
        pendingActTimer = null;
        const cur = lastState;
        if (!cur || cur.phase !== 'playing' || cur.currentTurn !== myColor) return;
        act(cur);
      }, delay);
    }
  }
  break;
```

### 영향 파일
| 파일 | 작업 유형 | 설명 |
|---|---|---|
| `omok/bot.js` | 수정 | bannedCells/lastAttemptedMove 추가 + chooseMoveExcluding 신설 + act 수정 + handleState banned 초기화 + ERROR 핸들러 재시도 예약 |
| `omok/tests/bot-smoke.test.js` | 수정 | 금수 거절 후 봇이 다른 칸에 착수하고 행하지 않는 시나리오 추가 (OMOK-BOT-005) |

### 수용 기준
- 봇이 금수 셀에 착수 시도 → ERROR 수신 → 200~400ms 내 다른 칸에 재착수 → 게임 진행 계속
- 봇이 동일 금수 셀을 연속 재시도하지 않음 (bannedCells 확인)
- 새 STATE 도착 시 bannedCells 초기화 → 다음 턴에 금수가 아닌 셀은 다시 후보로 포함
- 기존 bot-smoke 14/14 PASS (OMOK-BOT-001~004) 유지, smoke 106/106 PASS 유지

### 회귀 보호
- 기존 슈트: `tests/smoke.test.js`(106), `tests/bot-smoke.test.js`(14), `tests/qa-edge.test.js`(35), `tests/qa-renju-attack.test.js`(28), `tests/qa-rematch-attack.test.js`(14)

---

## 전체 요구사항

### 기능 요구사항
- [ ] 다빈치 코드: 미공개 상대 카드의 `isJoker`가 와이어·화면에서 마스킹됨
- [ ] 다빈치 코드: 상대가 뽑은 `pendingDrawn`의 `isJoker`가 마스킹됨
- [ ] 코드네임 듀엣: 중립 클릭이 어느 쪽의 greenFound도 증가시키지 않음
- [ ] 코드네임 듀엣: 더블 에이전트(양면 green) 클릭 시 양쪽 greenFound 정상 증가
- [ ] 루미큐브: 첫 등판 전 기존 보드 세트에 손 타일 추가가 오류로 거부됨
- [ ] 윷놀이: 백도가 큐에 남고 출전 말이 모두 완주/HOME이면 백도 자동 폐기 후 passTurn
- [ ] 코드네임 봇: 요원이 0장 공개 후 스파이마스터 봇이 다음 차례에 정상 단서 제공
- [ ] 오목 봇: 금수 거절 ERROR 수신 후 새 STATE 없이도 다른 칸에 재착수

### 비기능 요구사항
- [ ] 각 게임의 기존 테스트 슈트를 100% PASS 유지
- [ ] 수정 범위는 해당 게임 파일로 한정 (크로스-게임 파급 없음)
- [ ] 봇 수정(오목, 코드네임)은 사람 대 사람 게임에 영향 없음

---

## 수용 기준 (Acceptance Criteria)
- [ ] 다빈치: `snapshotForPlayer(g,'p2').oppHand`의 미공개 카드 전체 `isJoker === false`
- [ ] 다빈치: `snapshotForPlayer(g,'p2').pendingDrawn`(상대 분기) `isJoker === false`
- [ ] 다빈치: game-unit-qa 53/53 PASS (G-40 수정 포함), davinci-plus-qa 25/25 PASS
- [ ] 코드네임 듀엣: 중립 클릭 후 `greenFound` 불변, `phase !== 'won'`
- [ ] 코드네임 듀엣: review-smoke 27/27 PASS, review-visual 11/11 PASS
- [ ] 루미큐브: `from=hand, to=기존세트` 첫 등판 전 거부 응답 `ok:false`
- [ ] 루미큐브: smoke 150/150 PASS, qa-pass4-sort 34/34 PASS
- [ ] 윷놀이: inject `pendingResults=['backdo']` + 전 말 완주 → 자동 passTurn → currentTurn 상대
- [ ] 윷놀이: 서버리스 342/342 PASS, bot-smoke 10/10 PASS
- [ ] 코드네임: 봇 0-공개 패스 턴 후 SM 봇 재행동 확인
- [ ] 코드네임: smoke 65/65, E2E 12/12, bot-smoke 23/23 PASS
- [ ] 오목: 봇 금수 거절 후 200~400ms 내 다른 칸 착수, 게임 정상 완료
- [ ] 오목: smoke 106/106, bot-smoke 14/14 PASS

---

## 범위 경계 (Out of Scope)

- 다빈치 코드 `#3` (재접속 ID 중복 데드락) — 별도 발주
- 코드네임 듀엣 `#2` (재접속 ID 중복) / `#3` (win-on-neutral 판정 순서 MED) / `#4` (공백 단서 LOW) — 별도 발주
- 루미큐브 회귀FAIL qa-edge 1건 — 기존 known-baseline 결함 별도 발주
- 윷놀이 `#3` (N인 대기실 opponentReady 표시 LOW) — 별도 발주
- 오목 `#1` (재접속 ID 중복 HIGH) / `#2` (lastGameResult 미초기화 LOW) — 별도 발주 (#1은 우선 검토 권고)
- 테트리스 배틀 3건 / 장기 3건 / 하나비 2건 / 야후치 2건 / 코드네임 `#2` — P2 발주 대상
- `봇 스파이마스터 유효 단서 없음(최후 폴백 실패)` — 태그맵 보강 범위로 별도 발주

---

## Art Director 실행 계획
- visual_change: **none** — 6건 모두 서버·게임 로직·봇 로직 수정만 포함. CSS/HTML/클라이언트 UI 파일 변경 없음.
  - 다빈치 조커 ★ 아이콘 소멸은 game.js isJoker 마스킹의 결과로 발생하며 CSS/client.js 수정이 없으므로 `visual_change: none`.
- AD 모드 1 (에셋 컨셉): **해당 없음** — visual_change: none
- AD 모드 2 (에셋 검증): **해당 없음** — visual_change: none
- AD 모드 3 (UI 레이아웃): **해당 없음** — visual_change: none

---

## 제약사항
- 다빈치 코드 `#3` (ID 중복)은 이번 P1 범위 외지만 같은 코드베이스 오목 `#1`과 유사 패턴 → P1 이후 우선 패치 권고
- 코드네임 `turnCount` 필드는 STATE 스키마에 추가(후방 호환 `?? 0` 처리)되므로 클라이언트 코드는 무수정
- 루미큐브 레이오프 가드는 `state.turnSnapshot` 의존 → `moveTile` 호출 시점에 `state.turnSnapshot`이 항상 초기화되어 있음을 확인할 것 (createGame 및 finishTurn에서 초기화 확인)
- 윷놀이 `autoDiscardUnusableBackdos` 는 MOVE_PIECE / CHOOSE_PATH 에서만 호출. THROW_YUT 핸들러의 기존 "첫 던지기 시점 백도 폐기"(canUseBackdo 로직)는 건드리지 않음

---

## 참고사항
- 버그 헌트 확정 결함 전문: `C:/Users/홍선표/AppData/Local/Temp/claude/C--LazySlimeStudio/2fd77b60-9444-4f73-8070-fcf778a2c4c7/tasks/bughunt-findings.md`
- 코드네임 봇 초기 QA 산출물(DEFECT-1 수정 포함): `.claude/specs/2026-06-28-codenames-bot-spec.md`, `.claude/specs/2026-06-28-codenames-bot-qa-report.md`
- 루미큐브 룰 정합 수정 이력: `rummikub/CLAUDE.md` "변경 시 자주 깨지는 함정" 섹션 (특히 '첫 등판 전 보드 격리' 항목)
- 윷놀이 백도 관련 기존 처리(canUseBackdo): `yutnori/server.js` line ~1033-1059
- 오목 봇 설계 원칙: `omok/CLAUDE.md` "금수 거부 ERROR 수신 시에도 봇이 멎지 않도록" 명시됨 (미구현 상태)
