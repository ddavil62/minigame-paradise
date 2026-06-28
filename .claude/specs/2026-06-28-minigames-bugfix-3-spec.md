# Feature: 재현 확정 버그 3건 수정 — tetris-battle #12/#13 · codenames-duet #10

## 개요

라이브 재현으로 확정된 3건의 버그를 근본 원인 수준에서 제거한다.
처리 권장 순서: #10(codenames-duet, 단순) → #12(tetris-battle bot 타이밍) → #13(tetris-battle 좀비 봇, 복잡).

---

## 배경 및 동기

| # | 게임 | 증상 | 근본 원인 |
|---|------|------|---------|
| #10 | codenames-duet | 암살자 종료 → 복기 → "새 게임" 시 이전 복기 점(`.review-dot` 50개)·배경(`.review-cell` 25개)이 잔존 | `GAME_START` 핸들러가 복기 DOM을 정리하지 않음 |
| #12 | tetris-battle | AI봇이 카운트다운 중에 이미 게임 루프 시작 → 사람보다 ~4초 먼저 플레이 | `bot.js` START 핸들러에서 `countdown` 값을 무시하고 즉시 `scheduleNextPiece()` 호출 |
| #13 | tetris-battle | AI채우기 → 종료 → 재진입 시 "Room is full" 또는 봇 미생성으로 대기 고착 | SIGTERM 비동기 지연으로 봇 WS 슬롯이 `players` 배열에 좀비 잔존 |

---

## 요구사항

### 기능 요구사항

**#10 codenames-duet**
- [ ] GAME_START 수신 시 25개 카드에서 `.review-cell`, `.was-revealed` 클래스 제거
- [ ] GAME_START 수신 시 25개 카드에서 `.review-grid` 서브요소 DOM 제거
- [ ] GAME_START 수신 시 `.my-indicator`의 인라인 `display` 스타일 복원
- [ ] 정리 로직을 헬퍼 함수 `clearReviewArtifacts()`로 추출하여 `GAME_START`와 `closeReviewBackToModal()` 양쪽에서 호출

**#12 tetris-battle bot**
- [ ] START 핸들러에서 `resetBot()`은 즉시 실행(상태 초기화)
- [ ] `isRunning = true` 및 `scheduleNextPiece()` 호출을 `(msg.countdown + 1) * 1000` ms 지연
- [ ] 기존 테스트(bot-smoke 8/8)는 타임아웃 범위(30000ms) 내에서 그대로 통과

**#13 tetris-battle server**
- [ ] 사람 WS close 시 `players`에서 봇 슬롯을 즉시 동기적으로 제거 + `ws.terminate()` 강제 종료
- [ ] `killBotChild()` 는 기존대로 호출 유지(프로세스 정리 병행)
- [ ] 새 사람(비봇) WS 연결 시 `players.length >= 2` 판정 전에 잔존 봇 슬롯을 선제 sweep(안전망)
- [ ] AI채우기 → 시작 → 종료 → 재진입 반복 시 "Room is full" 미발생 + 새 봇 정상 spawn

### 비기능 요구사항
- [ ] #10: `renderState(lastState)` 호출 없이 cleanup만 수행 (새 게임 STATE가 서버에서 즉시 도착하므로 old state 재렌더 불필요)
- [ ] #12: `countdown` 값이 변경되어도 공식 `(countdown + 1) * 1000` ms로 자동 추종
- [ ] #13: 새 연결 시 zombie sweep은 `isBot === false` (사람 연결)인 경우에만 실행

---

## 구현 상세

### 수정/생성할 파일

| 파일 경로 | 작업 유형 | 버그 # |
|---|---|---|
| `codenames-duet/public/client.js` | 수정 | #10 |
| `tetris-battle/bot.js` | 수정 | #12 |
| `tetris-battle/server.js` | 수정 | #13 |

### 각 파일별 변경사항

---

#### `codenames-duet/public/client.js` (버그 #10)

**변경 위치 1: 헬퍼 함수 신설**

`closeReviewBackToModal()` 직전(또는 함께 어울리는 섹션)에 `clearReviewArtifacts()` 함수를 추가한다.

추출할 로직은 `closeReviewBackToModal()` L570-577의 루프와 동일:
```
for (let i = 0; i < 25; i++) {
    card.classList.remove('review-cell', 'was-revealed');
    card.querySelector('.review-grid')?.remove();
    const myInd = card.querySelector('.my-indicator');
    if (myInd) myInd.style.display = '';
}
```

주의: `closeReviewBackToModal()`에 남아 있는 `if (lastState) renderState(lastState)` 호출은 제거하지 않는다. 해당 줄은 "이전 게임 화면으로 되돌아가기" 전용이므로 GAME_START 경로에서는 호출하지 않는 것이 맞다.

**변경 위치 2: `GAME_START` 핸들러 (L199-210)**

기존:
```javascript
case 'GAME_START':
    if (screenWaiting) screenWaiting.classList.add('hidden');
    if (boardWrap) boardWrap.classList.remove('hidden');
    if (cluePanel) cluePanel.classList.remove('hidden');
    reviewData = null;
    lastGameEndContext = null;
    hideReviewBanner();
    hideModal();
    turnEl.textContent = '게임 시작!';
    break;
```

변경: `hideReviewBanner()` 호출 직후(또는 `hideModal()` 직전)에 `clearReviewArtifacts()` 한 줄 추가.

**변경 위치 3: `closeReviewBackToModal()` (L563-588)**

루프 본체를 `clearReviewArtifacts()` 호출 1줄로 교체한다.
루프 이후의 `if (lastState) renderState(lastState)` 및 모달 재오픈 코드는 그대로 유지.

---

#### `tetris-battle/bot.js` (버그 #12)

**변경 위치: START 핸들러 (L502-507)**

기존:
```javascript
case 'START':
    console.log(`[tetris-bot] START (countdown=${msg.countdown}) → 게임 루프 시작`);
    resetBot();
    isRunning = true;
    scheduleNextPiece();
    break;
```

변경 후:
```javascript
case 'START': {
    const cd = typeof msg.countdown === 'number' ? msg.countdown : 3;
    console.log(`[tetris-bot] START (countdown=${cd}) → ${(cd + 1) * 1000}ms 후 게임 루프 시작`);
    resetBot();  // 보드/봉투/콤보 즉시 초기화
    setTimeout(() => {
        isRunning = true;
        scheduleNextPiece();
    }, (cd + 1) * 1000);
    break;
}
```

**근거:**
- 사람 클라이언트 `runCountdown(seconds, onComplete)`은 `setInterval 1000ms`마다 진행:
  - t=0ms: "3" 표시
  - t=1000ms: "2"
  - t=2000ms: "1"
  - t=3000ms: "GO!"
  - t=4000ms: `onComplete()` → `game.start()`
- countdown=3이면 `(3+1)*1000 = 4000ms` 후 실제 게임 시작
- 봇도 동일 딜레이 적용 시 ±오차 내 동시 출발 가능

**회귀 영향:**
- TBOT-001/002: OPPONENT_BOARD를 30000ms 이내 기다림 → 4800~5200ms에 도착(문제없음)
- TBOT-005: 재대결 START에도 countdown=3 적용됨. 봇도 4000ms 후 시작(의도한 동작)
- 기존 bot-smoke 8/8 PASS 유지 예상

---

#### `tetris-battle/server.js` (버그 #13)

**핵심 원인 분석:**

1. Human disconnect → `players.filter(...)` 로 사람 제거 → `killBotChild()` (SIGTERM 전송, `botChild = null` 즉시)
2. Bot WS는 bot process가 실제 종료될 때까지 열려 있음 → `players` 에 zombie bot 슬롯 잔존
3. 사람이 빠르게 재연결:
   - zombie가 있으면: 새 사람이 p2 슬롯에 들어감 → `players.length === 2` → JOIN 조건 `players.length === 1` 불충족 → 봇 미spawn → 대기 고착
   - zombie + 이전 사람 WS 미처리 동시 잔존 시: `players.length >= 2` → "Room is full"

**수정 위치 1: `ws.on('close')` 핸들러 (L436-456)**

인간이 끊겼을 때(`!isBot`) 봇 슬롯을 동기적으로 제거하고 ws.terminate()로 즉시 강제 종료한다.

기존 close 핸들러 내:
```javascript
players = players.filter((p) => p.id !== player.id);
if (!isBot) {
    killBotChild();
}
```

변경 후:
```javascript
players = players.filter((p) => p.id !== player.id);
if (!isBot) {
    // 봇 슬롯을 players에서 즉시 제거하고 WS를 강제 종료한다.
    // killBotChild()의 SIGTERM은 비동기라 좀비 슬롯이 잔존할 수 있으므로
    // ws.terminate()로 TCP 연결을 즉시 끊어 close 이벤트를 유도한다.
    const botSlot = players.find((p) => p.mode === 'bot');
    if (botSlot) {
        players = players.filter((p) => p.mode !== 'bot');
        botSlot.ws.terminate();  // 즉시 TCP 종료 → bot close 핸들러 발화
    }
    killBotChild();
}
```

주의: `botSlot.ws.terminate()` 호출 후 bot의 `ws.on('close')` 핸들러도 발화된다. 이미 `players`에서 제거된 상태이므로 `players.filter(...)` 재실행은 no-op(무해).

**수정 위치 2: `wss.on('connection')` 핸들러 (L237 주변)**

`players.length >= 2` 판정 전에 잔존 zombie 봇을 sweep하는 안전망을 추가한다.
사람(비봇) 연결 시에만 실행한다.

기존:
```javascript
wss.on('connection', (ws, req) => {
    const reqUrlObj = new URL(req.url || '/', 'http://localhost');
    const wsMode = reqUrlObj.searchParams.get('mode') || 'human';
    const isBot = wsMode === 'bot';

    if (players.length >= 2) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Room is full' }));
        ws.close();
        return;
    }
    ...
```

변경 후:
```javascript
wss.on('connection', (ws, req) => {
    const reqUrlObj = new URL(req.url || '/', 'http://localhost');
    const wsMode = reqUrlObj.searchParams.get('mode') || 'human';
    const isBot = wsMode === 'bot';

    // 사람(비봇)이 새로 연결될 때, SIGTERM 지연으로 잔존한 좀비 봇 슬롯을 선제 제거한다.
    // 이 sweep은 수정 위치 1의 즉시 제거가 실패하는 엣지 케이스를 위한 안전망이다.
    if (!isBot) {
        const zombies = players.filter((p) => p.mode === 'bot');
        if (zombies.length > 0) {
            console.log(`[tetris] 좀비 봇 슬롯 ${zombies.length}개 선제 제거`);
            for (const z of zombies) z.ws.terminate();
            players = players.filter((p) => p.mode !== 'bot');
        }
    }

    if (players.length >= 2) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Room is full' }));
        ws.close();
        return;
    }
    ...
```

**launcher/server.js 확인 사항 (수정 불필요):**

`launcher/server.js` L83-85는 각 게임당 `createApp()` 인스턴스를 단일 생성해 재사용하는 구조다. 이 구조는 의도된 것이며, 게임 인스턴스 간 `players` 배열이 closure 내부에서 격리되어 있다. 따라서 launcher/server.js 수정은 불필요하다.

---

### 의존성

신규 npm 패키지 없음. 기존 `ws` 패키지의 `ws.terminate()` API를 사용한다(이미 설치됨).

---

## 수용 기준 (Acceptance Criteria)

### #10 codenames-duet

- [ ] AC-10-1: 암살자 카드 클릭 → GAME_END(패배) 수신 → 복기 보기 버튼 클릭 → 복기 모드 진입 → "새 게임" 전송 후 GAME_START 수신 시, 25개 카드에서 `.review-cell` 클래스가 0개
- [ ] AC-10-2: 동일 시나리오에서 `.review-dot` 요소가 0개
- [ ] AC-10-3: 동일 시나리오에서 `.was-revealed` 클래스가 0개
- [ ] AC-10-4: 동일 시나리오에서 `.review-grid` 요소가 0개
- [ ] AC-10-5: 복기 모드 없이(게임 종료 후 바로 "새 게임") GAME_START 수신 시에도 동일 정리 통과(이미 없으면 no-op으로 안전)
- [ ] AC-10-6: `closeReviewBackToModal()` 호출 후에도 동일 정리 효과 유지(리그레션 없음)
- [ ] AC-10-7: review-smoke 27/27 PASS + review-visual 11/11 PASS 유지

### #12 tetris-battle bot

- [ ] AC-12-1: START(countdown=3) 수신 후 봇의 첫 BOARD_STATE 전송 시각이 `4000ms` ± `PLACE_INTERVAL`(800~1200ms) 범위(즉, 4800~5200ms) 내
- [ ] AC-12-2: countdown 값이 다른 경우(예: 2)에도 `(countdown+1)*1000` ms 공식으로 정확히 추종
- [ ] AC-12-3: REMATCH → START(countdown=3) 시에도 동일 딜레이 적용
- [ ] AC-12-4: bot-smoke 8/8 PASS 유지(TBOT-001~006)
- [ ] AC-12-5: 회귀 344 PASS 유지

### #13 tetris-battle server

- [ ] AC-13-1: mode=ai 진입 → 게임 종료(사람 GAME_OVER) → 사람 WS close → 1000ms 이내에 `players.length === 0`(zombie bot 제거 확인)
- [ ] AC-13-2: mode=ai 진입 → 게임 종료 → 사람 즉시 재연결(200ms 이내) → "Room is full" ERROR 미수신
- [ ] AC-13-3: 재연결 후 새 봇이 정상 spawn되어 JOINED(p1) → START 수신 가능
- [ ] AC-13-4: AI채우기 → 시작 → 종료 → 재진입 3회 연속 반복 시 "Room is full" 미발생
- [ ] AC-13-5: TBOT-004 시나리오(1500ms 대기 후 fresh 연결 → p1, waiting=true) PASS 유지
- [ ] AC-13-6: bot-smoke 8/8 PASS 유지
- [ ] AC-13-7: 회귀 344 PASS 유지

---

## 신규 테스트 계획

### #10 — codenames-duet

기존 `tests/review-smoke.mjs` 또는 `tests/review-visual.mjs`에 아래 시나리오를 추가하거나 별도 파일로 작성:

- **REVIEW-NEW-001**: 복기 중 → GAME_START → `.review-cell` 0개 단언
- **REVIEW-NEW-002**: 복기 중 → GAME_START → `.review-dot` 0개 단언
- **REVIEW-NEW-003**: 복기 없이 GAME_START → 정리 no-op 안전 확인
- 작업 포트: 3098 (기존 격리 포트 그대로)

### #12 — tetris-battle bot

기존 `tests/bot-smoke.test.js`에 추가:

- **TBOT-007**: START(countdown=3) 수신 후 첫 OPPONENT_BOARD 도착 시각이 4000ms 이상(카운트다운 준수 확인). 타임아웃은 8000ms로 설정.

### #13 — tetris-battle server

기존 `tests/bot-smoke.test.js`에 추가:

- **TBOT-008**: mode=ai 게임 진행 → 사람 WS 강제 close → 즉시(200ms 이내) 새 mode=ai 재연결 → JOINED(p1) 수신 확인 (Room is full 미수신)
- 작업 포트: 3110 (기존 bot-smoke 격리 포트 그대로)

---

## 범위 경계 (Out of Scope)

- #9 tetris-battle 조기 패배(VANISH_ZONE 탑아웃 재현 불가, 별도 조사 필요)
- #8 yutnori 클릭 버그(이미 수정 반영됨)
- 봇 AI 로직 또는 휴리스틱 개선
- 코드네임 듀엣 AI 봇 추가
- 테트리스 배틀 멀티룸 지원(현재 단일 룸 고정 구조 유지)
- SIGTERM → SIGKILL 폴백 타이머 추가(ws.terminate() 즉시 종료로 충분)
- `players.length` 상한을 2→3 이상으로 확장

---

## Art Director 실행 계획

- visual_change: ui (codenames-duet #10만 해당; tetris-battle #12/#13은 none)
- AD 모드 1 (에셋 컨셉): 해당 없음 — 새 이미지/스프라이트 에셋 생성 없음
- AD 모드 2 (에셋 검증): 해당 없음 — 에셋 변경 없음
- AD 모드 3 (UI 레이아웃): **#10 완료 후 실행 예정** — codenames-duet 새 게임 보드 화면에서 복기 아티팩트 0개 시각 확인. tetris-battle #12/#13은 visual_change:none이므로 AD3 생략.
- 멀티 페이즈 시 AD 반복 계획: 단일 스펙, 단일 코딩 페이즈. #10 Coder 완료 후 AD 모드3 1회. #12/#13은 AD 불필요.

---

## 제약사항

- `phase3-4-qa-edge.test.js`의 Q7b(기존 결함) 외 기존 슈트를 수정/삭제하지 않는다.
- 봇 WS `terminate()` 호출 시 bot의 `ws.on('close')` 핸들러가 연달아 발화됨. 이미 `players`에서 제거된 상태이므로 `players.filter(...)` 재실행은 no-op — 별도 가드 불필요.
- `clearReviewArtifacts()`에서 `renderState(lastState)`를 호출하지 않는다. 해당 호출은 `closeReviewBackToModal()` 고유 기능(이전 게임 화면 복원)이며 GAME_START 경로에는 부적합.
- 테스트 격리 포트: tetris-battle bot-smoke = 3110, codenames-duet review = 3098. 두 포트 모두 `launcher(3000)` 및 사용자 동시 플레이와 충돌하지 않는다.

---

## 참고사항

- codenames-duet `closeReviewBackToModal()` 위치: `C:/LazySlimeStudio/minigames/codenames-duet/public/client.js` L563-588
- codenames-duet `GAME_START` 핸들러 위치: 동 파일 L199-210
- tetris-battle `runCountdown()` 위치: `C:/LazySlimeStudio/minigames/tetris-battle/public/js/main.js` L353-376
- tetris-battle bot START 핸들러 위치: `C:/LazySlimeStudio/minigames/tetris-battle/bot.js` L502-507
- tetris-battle `killBotChild()` 위치: `C:/LazySlimeStudio/minigames/tetris-battle/server.js` L103-109
- tetris-battle `ws.on('close')` 핸들러 위치: 동 파일 L436-456
- tetris-battle `wss.on('connection')` 핸들러 위치: 동 파일 L237 주변
- 관련 회귀 슈트: `tests/review-smoke.mjs`, `tests/review-visual.mjs` (codenames), `tests/bot-smoke.test.js` 9 슈트 344건 (tetris)
