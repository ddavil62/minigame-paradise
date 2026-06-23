# Feature: 미니게임 천국 접속/로비/입장 플로우 재설계

## 개요

런처 로비에 닉네임 게이트·presence 목록·입퇴장 토스트를 추가하고,
오목(omok) 게임 방에 양방향 READY 단계·상대이름 표시·이탈 UX를 신설한다.
**로비 카드 클릭은 항상 게임방(대기 상태)으로 입장하며, AI는 게임방의 명시적 버튼으로만 호출한다(presence 기반 자동 모드 결정 완전 제거).**
로비 공통부(페이즈1)와 오목 게임방 + launcher 카드클릭 라우팅 변경(페이즈2)을 독립 검증 가능한 두 페이즈로 분리 구현한다.

---

## 배경 및 동기

현재 흐름의 문제점:
- 닉네임 없이 자동 접속 → 상대가 누구인지 알 수 없음.
- 로비 presence가 count/role/votes뿐 → 새 사람이 들어와도 새로고침 없이 모름.
- 게임 방에 READY 단계 없음 → 양쪽이 준비됐는지 확인 불가, 불시에 게임 시작.
- 상대 이탈 시 1.2~1.5초 자동 redirect → 사용자 제어 없이 강제 이동.
- **로비에서 혼자(1/2) 게임 카드를 누르면 presence 기반으로 자동으로 AI 모드가 시작되어 당황스러운 UX** — 명시적 AI 호출 없이 암묵적 동작으로 불만.

---

## 확정 맥락 (grill-me 결론)

1. **범위**: 접속~게임시작 전체 (로비 + 게임 방). 이번 스코프 = 로비 공통부 + 오목(omok) 파일럿. 나머지 9종은 범위 밖(후속).
2. **입장 게이트**: 맨 앞 닉네임 입력 + "입장하기" 버튼. 닉네임 localStorage 기억(다음부터 자동). LAN이라 인증 없음.
3. **로비 presence**: 입장 후 로비 상단 접속자 목록(이름+🟢) 상시 + 입장/퇴장 토스트. WS 실시간(새로고침 불필요가 핵심 AC).
4. **게임 방 입장**: **카드 클릭 = 항상 게임방 입장(대기 상태).** presence(1/2 vs 2/2)에 따라 AI/human을 자동 결정하던 기존 로직 완전 제거. REDIRECT는 mode 미지정(또는 'human')으로 게임방으로 보낸다(`?name=`은 유지, mode=ai는 강제하지 않음). 방 상단 "○○님과 대전 · 상대 입장/이탈 · 준비 상태" 실시간 표시 + 상대 입장/이탈 토스트.
5. **양방향 ready**: 호스트·게스트 둘 다 준비 버튼 + 서로 준비 상태 ✅/⌛ 실시간. 둘 다 준비 시 시작.
6. **이탈 처리**: 자동 1.2~1.5초 redirect 제거 → "○○님이 나갔어요" 사라지지 않는 배너 + "로비로 돌아가기" 버튼(사용자 직접 이동).
7. **모델**: 2인 단일 방 + 호스트(먼저 입장=방장)/게스트 유지.

---

## 잔여 포크 확정 (Planner 직접 결정)

### 포크 A — 닉네임 로비→게임방 전달 방식

**확정: 옵션 A** — REDIRECT URL에 `?name=` 쿼리(encodeURIComponent) 추가 → 게임 방 WS 연결 시 첫 `JOIN { name }` 메시지로 송신.

근거:
- `app.js`의 `handleRedirect`는 이미 `basePath + ?mode=...`를 조립해 `location.href`에 할당한다. `name` 파라미터를 같은 방식으로 append하면 기존 패턴에 정확히 맞는다.
- `network.js`의 `connect()`는 이미 `location.search`를 파싱해 `mode`를 sessionStorage에 저장한다. 동일 패턴으로 `name`도 sessionStorage(`omok:name`)에 저장하면 새로고침 후에도 보존된다.
- 토큰 기반(옵션 B)은 LAN 환경에서 서버 세션 관리 오버엔지니어링이다.

### 포크 B — 게임 방 직접 진입(로비 미경유) 닉네임 폴백

**확정: 3단계 폴백** (이번 파일럿에서 전부 처리)

1. URL 쿼리 `?name=` 있으면 우선 사용 → sessionStorage `omok:name`에 저장.
2. 쿼리 없으면 sessionStorage `omok:name` 확인 → 있으면 사용.
3. 둘 다 없으면 게임 방 대기 화면에서 인라인 닉네임 입력(input + "입장" 버튼) → 서버에 JOIN 전에 이름 확정.

"Player" 기본값은 제공하지 않는다. 닉네임 없이 JOIN을 허용하면 presence가 무의미해지기 때문이다.

### 포크 C — mode=ai 상호작용

**확정**:
- 사람이 닉네임 게이트를 통과 → 게임방 대기 화면에서 **"🤖 AI랑 시작" 버튼 클릭** → `?mode=ai`로 게임 방 재접속 → 게임 방 JOIN 시 사람 이름 전달. (**카드 클릭 단독으로는 절대 mode=ai가 되지 않는다.**)
- 봇은 `mode=bot`으로 접속 → 서버가 `JOIN { name: 'AI' }` 자동 발행(봇은 JOIN 메시지 송신 불필요 — 서버가 isBot 여부로 자동 처리).
- 로비 presence는 사람 1명만 표시(봇은 로비를 통과하지 않음). AI 단독 진입 시 로비를 거치지 않고 직접 `/omok/?mode=ai&name=...`로 이동하는 경우에도 게임 방 폴백 B가 처리.
- 봇은 JOINED 수신 즉시(0.2~0.5초 지연) READY 자동 송신.

### 결정 B — presence 기반 자동 모드 결정 제거 + 명시적 AI 버튼 (파일럿 피드백 반영)

**확정 동작**:

1. **로비 카드 클릭 = 항상 게임방 입장(대기 상태).** `app.js`의 `handleRedirect`에서 `mode=ai`를 강제하는 분기(`count===1 ? 'ai' : 'human'` 등)를 완전 제거. `server.js` PICK_GAME의 `isAiMode = clients.size === 1` 자동 판정도 제거. REDIRECT 메시지의 `mode`는 항상 `'human'`(또는 미지정).

2. **게임방(오목)은 대기 상태로 진입**: "친구를 기다리는 중" 표시 + **"🤖 AI랑 시작" 버튼**을 명시적으로 노출. `botAvailable` 게임(AI 봇 지원 게임)일 때만 버튼 표시.

3. **AI는 오직 그 버튼으로만 호출**: 버튼 클릭 → `?mode=ai&name=...`로 현재 게임방 URL 재구성 → `location.href` 교체 → 봇 spawn. 카드 클릭만으로는 절대 AI가 시작되지 않는다.

4. **봇/친구 합류 충돌 규칙 (단순·명확 우선)**:
   - "🤖 AI랑 시작" 버튼은 **게임방이 1인(혼자 대기) 상태일 때만 표시**한다. 친구가 먼저 합류해 2인이 된 순간 버튼이 자동 소멸(사람 대전 흐름으로 전환).
   - 봇이 이미 입장한 뒤(mode=ai로 재접속 후) 별도 창에서 친구가 같은 방 URL로 진입하는 경우: **봇 우선 — 방이 이미 찼으므로(2인) FULL 응답으로 거절**. 봇 입장 후에는 인간 3번째 진입 불가.
   - 결론: **"AI랑 시작" 버튼 클릭 전(혼자 대기 상태)에서만 친구 합류가 가능**하다. 버튼을 누른 순간 봇이 방을 채우며, 이후 친구는 들어올 수 없다.

5. **`botAvailable` 의미 재정의**: 기존에는 `botAvailable=false` 게임 카드가 비활성(클릭 불가)였으나, 이제 카드 클릭은 모두 게임방 입장이므로 카드 자체는 활성. `botAvailable`은 **게임방 대기 화면에서 "🤖 AI랑 시작" 버튼 노출 여부**만 제어한다.

### 포크 D — READY와 기존 오목 흐름 정합

**확정**: READY 단계가 `createGame()`과 리매치(REMATCH) 흐름에 끼어드는 충돌 방지 설계.

- **신규 게임 시작 흐름**: JOINED(양쪽) → 각자 READY → 양쪽 READY 확인 시 `createGame()` → GAME_START + STATE. (`maybeStartGame`을 제거하고 `maybeStartGameIfReady`로 대체)
- **리매치 흐름**: REMATCH_START 이후 `readyState` 초기화 → 양쪽 다시 READY → `createGame()`. 리매치 READY는 신규 게임과 동일 메시지 흐름 재사용.
- **색 배정**: `swapColorsForRematch()`는 REMATCH 처리 시점(REMATCH_START 직전)에 호출되므로 READY와 순서 충돌 없음. JOINED에서 이미 color가 재배정된 뒤 READY 단계로 들어간다.
- **`readySet`**: server.js closure에 `let readySet = new Set()` 추가. 접속 종료 시 해당 playerId를 readySet에서 제거. rematch 시 `readySet = new Set()` 초기화.

---

## 요구사항

### 기능 요구사항

#### 로비 공통부 (페이즈1)
- [ ] 로비 진입 시 닉네임 게이트 화면 표시(WS 연결 전 차단)
- [ ] 닉네임 입력 후 "입장하기" 클릭 → localStorage `minigames:nickname` 저장 → WS 연결 → `JOIN { name }` 송신
- [ ] 재방문 시 localStorage에서 닉네임 자동 로드(게이트 화면에 pre-fill)
- [ ] 서버 `clients` Map에 `name` 필드 추가
- [ ] `LOBBY_STATE`에 `players: [{ id, name, role, online }]` 배열 추가(기존 count/role/votes 유지)
- [ ] 신규 S→C `PLAYER_JOINED { name, role }`, `PLAYER_LEFT { name }` 메시지 추가
- [ ] 로비 상단에 접속자 목록 DOM(`#presence-list`) — 이름 + 🟢 표시
- [ ] 입장/퇴장 토스트(2.5초 자동 소멸)
- [ ] 기존 `LOBBY_STATE` 수신 시 presence 목록 갱신(새로고침 없이)

#### 오목 게임 방 + launcher 카드클릭 라우팅 변경 (페이즈2)

**launcher 카드클릭 변경 (기존 자동 AI 분기 제거)**:
- [ ] `launcher/public/app.js` `handleRedirect`: `mode=ai` 자동 결정 분기 제거. count/presence 기반 mode 강제 로직 삭제. REDIRECT URL의 mode는 항상 `'human'`(또는 mode 파라미터 미전달). `?name=` 쿼리는 유지.
- [ ] `launcher/server.js` PICK_GAME 핸들러: `isAiMode = clients.size === 1` 자동 판정 제거. mode를 `'human'`으로 고정하여 REDIRECT 브로드캐스트. `botAvailable` 체크는 카드 활성화 용도가 아닌 → **게임방 AI버튼 표시 여부** 정보로만 REDIRECT에 `botAvailable` 필드를 유지 또는 제거(게임방 측이 botAvailable을 독자적으로 알고 있으면 제거 가능 — 오목은 `bot.js` 존재 여부로 판단).
- [ ] 카드 클릭 시 `botAvailable=false` 게임이어도 게임방 입장 가능(비활성 → 활성 전환). AI 버튼만 `botAvailable`에 따라 노출/비노출.

**오목 게임방 대기 화면 변경**:
- [ ] 대기 화면에 "친구를 기다리는 중..." 메시지 표시
- [ ] `botAvailable`(오목=true)일 때 **"🤖 AI랑 시작" 버튼** 표시 — 단, 게임방이 1인 상태일 때만 표시(2인이면 자동 소멸)
- [ ] "🤖 AI랑 시작" 클릭 → `?mode=ai&name=...`로 현재 URL 재구성 → `location.href` 교체(봇 spawn 트리거). 이 경로 외에는 mode=ai가 되는 경로 없음.
- [ ] 2인이 되면(친구 합류) "🤖 AI랑 시작" 버튼 숨김(사람 대전 흐름으로 전환)

**오목 게임방 코어 (기존 스펙 유지)**:
- [ ] `JOIN { name }` C→S 메시지 처리 — server.js의 `Player`에 `name` 필드 추가
- [ ] `JOINED` S→C에 `opponentName` 필드 추가(상대방 입장 시 전송)
- [ ] READY 단계 신설: 양쪽 입장 후 createGame 즉시 실행 제거, READY 대기 단계 삽입
- [ ] `READY {}` C→S 메시지 처리
- [ ] `READY_STATE { myReady, opponentReady }` S→C — 각자에게 개별 전송
- [ ] 양쪽 READY 시 `createGame()` → 기존 GAME_START + STATE 흐름
- [ ] 리매치 시 readySet 초기화 → 양쪽 다시 READY 대기
- [ ] 대기 화면 상단에 "○○님과 대전" 표시 + ✅/⌛ 준비 상태 UI
- [ ] 게임 화면 헤더에 상대 이름 + 준비 완료 후 "대전 중" 표시
- [ ] 상대 이탈 시 `OPPONENT_LEFT { name }` S→C — 사라지지 않는 배너(`.opponent-left-banner`) + "로비로 돌아가기" 버튼
- [ ] 자동 1.2~1.5초 redirect 제거 — `main.js`의 `onOpponentLeft`에서 `showScreen('waiting')` + setTimeout redirect 제거
- [ ] 봇 자동 READY(0.2~0.5초 지연): `bot.js`가 JOINED 수신 후 스케줄링
- [ ] 봇 닉네임 "AI" — 서버가 isBot 기준으로 자동 부여

### 비기능 요구사항
- [ ] WS 메시지 추가/변경은 기존 smoke/bot-smoke 회귀 무영향(JOIN 미수신 시 서버 name='(알 수 없음)' 폴백으로 하위 호환)
- [ ] localStorage 키 충돌 방지: `minigames:nickname`(로비), `omok:name`(오목 방)
- [ ] 닉네임 최대 12자 제한, 공백 trim, 빈 문자열 제출 차단

---

## WS 프로토콜 명세

### 로비 WS (`/ws`)

#### 신규/변경 메시지

| 방향 | 메시지 | 페이로드 | 설명 |
|------|--------|---------|------|
| C→S | `JOIN` | `{ name: string }` | WS 연결 직후 최초 송신(닉네임 게이트 통과 후). name 누락 시 서버가 '(알 수 없음)'으로 폴백 |
| S→C | `LOBBY_STATE` | `{ count, role, hostId, mode, votes, players: [{id, name, role, online}] }` | 기존 필드 유지 + `players` 배열 추가 |
| S→C | `PLAYER_JOINED` | `{ name: string, role: 'host'|'guest' }` | 새 플레이어 입장 시 기존 접속자에게 broadcast |
| S→C | `PLAYER_LEFT` | `{ name: string }` | 플레이어 퇴장 시 잔여 접속자에게 broadcast |

#### 서버 상태 전이 (launcher/server.js)

```
WS 연결 open
  ↓ (정원 초과 시 FULL → close)
  role/id 부여 (clients.set)
  name은 null로 초기화 — JOIN 대기
  LOBBY_STATE broadcast (players에 name=null 포함)
  ↓
JOIN { name } 수신
  ├─ clients.get(ws).name = name
  ├─ PLAYER_JOINED broadcast (자신 제외 → 기존 접속자에게 토스트용)
  └─ LOBBY_STATE broadcast (전체 갱신)
  ↓
WS close
  ├─ PLAYER_LEFT broadcast (잔여 접속자)
  └─ LOBBY_STATE broadcast
```

### 오목 WS (`/omok/ws`)

#### 신규/변경 메시지

| 방향 | 메시지 | 페이로드 | 설명 |
|------|--------|---------|------|
| C→S | `JOIN` | `{ name: string }` | WS 연결 직후 최초 송신(닉네임 전달). 봇은 서버가 자동 발행, 클라이언트 송신 불필요 |
| C→S | `READY` | `{}` | 준비 완료 선언. 양쪽 READY 시 서버가 createGame 트리거 |
| S→C | `JOINED` | `{ playerId, color, waiting, hostUrl, opponentName?: string }` | 기존 필드 유지. 상대방이 이미 입장한 경우 `opponentName` 포함 |
| S→C | `READY_STATE` | `{ myReady: bool, opponentReady: bool }` | READY 수신 시 양쪽 각자에게 개별 전송. 내 관점 기준 |
| S→C | `OPPONENT_LEFT` | `{ name: string, message: string }` | 기존 `message` 유지 + `name` 추가 |

#### 서버 상태 전이 (omok/server.js)

```
WS 연결 open (mode=ai|human|bot)
  ↓
  JOINED 즉시 전송 (기존과 동일, opponentName 없음)
  ↓
JOIN { name } 수신 (또는 isBot=true 시 name='AI' 자동)
  ├─ player.name = name
  ├─ 상대가 이미 있으면 상대에게 JOINED(opponentName=name) 재전송
  └─ 양쪽 모두 name 확정 시 readyPhase 진입(READY_STATE 초기 전송)
  ↓
READY {} 수신
  ├─ readySet.add(player.id)
  ├─ READY_STATE 양쪽에 각자 관점으로 전송
  └─ readySet.size === 2 → maybeStartGameIfReady() → createGame() → GAME_START + STATE
  ↓
WS close
  ├─ readySet.delete(player.id)
  └─ OPPONENT_LEFT { name, message } broadcast
```

**READY_STATE 개별 전송 방식**:
```
// p1에게
{ type: 'READY_STATE', myReady: readySet.has('p1'), opponentReady: readySet.has('p2') }
// p2에게
{ type: 'READY_STATE', myReady: readySet.has('p2'), opponentReady: readySet.has('p1') }
```

---

## 구현 상세

### 수정/생성할 파일

| 파일 경로 | 작업 유형 | 설명 |
|---|---|---|
| `launcher/server.js` | 수정 | JOIN 처리, clients Map에 name 추가, LOBBY_STATE 확장, PLAYER_JOINED/PLAYER_LEFT 추가, **PICK_GAME의 isAiMode 자동판정 제거(항상 human mode로 REDIRECT)** |
| `launcher/public/index.html` | 수정 | 닉네임 게이트 화면 추가, presence 목록 DOM 추가 |
| `launcher/public/app.js` | 수정 | 닉네임 게이트 UI, JOIN 송신, PLAYER_JOINED/PLAYER_LEFT 핸들러, presence 렌더, **handleRedirect에서 mode=ai 자동결정 분기 제거** |
| `omok/server.js` | 수정 | Player에 name 추가, JOIN 처리, readySet, READY 처리, maybeStartGameIfReady, JOINED 확장, OPPONENT_LEFT 확장 |
| `omok/public/index.html` | 수정 | **대기 화면에 "친구 기다리는 중" + "🤖 AI랑 시작" 버튼 추가**, 준비 버튼, 상대이름 표시 DOM, 이탈 배너 DOM 추가 |
| `omok/public/js/main.js` | 수정 | READY_STATE 핸들러, **"🤖 AI랑 시작" 버튼 클릭 핸들러(mode=ai 재접속)**, 준비 버튼 클릭, 이탈 배너 표시, 자동 redirect 제거, 상대이름 갱신, **2인 합류 시 AI 버튼 자동 소멸** |
| `omok/public/js/network.js` | 수정 | JOIN 송신, READY 송신, READY_STATE/OPPONENT_LEFT 라우팅, name 파라미터 파싱 |
| `omok/bot.js` | 수정 | JOINED 수신 후 자동 READY 예약(0.2~0.5초) |

### 각 파일별 변경사항

#### `launcher/server.js`

**PICK_GAME 핸들러 — presence 기반 mode 자동결정 제거**:

기존: `const isAiMode = clients.size === 1;` → `mode: isAiMode ? 'ai' : 'human'` 형태로 REDIRECT 전송.

변경 후:
```javascript
case 'PICK_GAME': {
  // isAiMode 자동판정 완전 제거 — 항상 human mode로 게임방 입장
  const path = getGamePath(msg.gameId);  // 기존 경로 조합 로직 유지
  broadcast({ type: 'REDIRECT', gameId: msg.gameId, path, mode: 'human' });
  // botAvailable 필드는 제거(게임방이 자체적으로 bot.js 존재 여부로 판단)
  break;
}
```
- `clients.size === 1` 분기 삭제.
- `mode: 'ai'` 분기 삭제.
- `botAvailable` 조건으로 카드 비활성화하던 로직 삭제(카드 클릭은 무조건 게임방 입장).

**`clients` Map value 타입 확장**:
```
clients: Map<ws, { id: string, role: 'host'|'guest', name: string|null }>
```
초기값 `name: null`. JOIN 수신 전까지 null.

**`handleMessage` — `JOIN` 케이스 추가**:
```javascript
case 'JOIN': {
  const name = typeof msg.name === 'string' ? msg.name.trim().slice(0, 12) : '(알 수 없음)';
  meta.name = name || '(알 수 없음)';
  // 자신을 제외한 기존 접속자에게 PLAYER_JOINED broadcast
  for (const [otherWs, otherMeta] of clients) {
    if (otherWs !== ws) {
      sendJson(otherWs, { type: 'PLAYER_JOINED', name: meta.name, role: meta.role });
    }
  }
  broadcastLobbyState(); // 전체 갱신(players 배열 포함)
  break;
}
```

**`sendLobbyStateTo` 확장** — `players` 배열 추가:
```javascript
const players = [...clients.values()].map(m => ({
  id: m.id, name: m.name, role: m.role, online: true,
}));
sendJson(ws, { type: 'LOBBY_STATE', count, role, hostId, mode, votes: votesSnapshot, players });
```

**`ws.on('close')` 수정** — 퇴장 시 `PLAYER_LEFT` broadcast:
기존 퇴장 로직(호스트 RESET, broadcastLobbyState) 앞에 삽입:
```javascript
broadcast({ type: 'PLAYER_LEFT', name: departed.name || '(알 수 없음)' });
```

#### `launcher/public/index.html`

**닉네임 게이트 화면 추가** (`#nickname-gate`) — `#lobby-view` 앞에 삽입:
```html
<div id="nickname-gate" class="view nickname-gate-view">
  <div class="nickname-card">
    <h2>미니게임 천국</h2>
    <p>닉네임을 입력하고 입장하세요</p>
    <input id="nickname-input" type="text" maxlength="12"
           placeholder="닉네임 (최대 12자)" autocomplete="off" />
    <button id="btn-enter-lobby" type="button">입장하기</button>
  </div>
</div>
```

**presence 목록 추가** — `.lobby-meta` 내부에 삽입:
```html
<div id="presence-list" class="presence-list"></div>
```

**토스트 엘리먼트 추가**:
```html
<div id="lobby-toast" class="lobby-toast" role="status" aria-live="polite"></div>
```

#### `launcher/public/app.js`

**닉네임 게이트 로직**:
- `init()` 시작 시 `#nickname-gate` 표시, `#lobby-view` hidden.
- localStorage `minigames:nickname` 값이 있으면 `#nickname-input`에 pre-fill.
- `#btn-enter-lobby` 클릭 → 닉네임 trim + 길이 검사(1~12자) → localStorage 저장 → `showLobby(nickname)` 호출.
- `showLobby(name)`: `#nickname-gate` hidden, `#lobby-view` 표시 → `connectWS()` 호출.
- `connectWS()` 내 `ws.addEventListener('open')` 콜백에서 즉시 `ws.send(JSON.stringify({ type: 'JOIN', name }))` 송신. `name`은 `showLobby` 호출 시 모듈 변수 `myName`에 저장.

**신규 메시지 핸들러** (`onMessage` switch 추가):
```javascript
case 'PLAYER_JOINED':
  renderPresence(msg.players);  // LOBBY_STATE가 오기 전까지 즉시 토스트만
  showLobbyToast(`${msg.name}님이 입장했습니다.`);
  break;
case 'PLAYER_LEFT':
  showLobbyToast(`${msg.name}님이 나갔습니다.`);
  break;
```

**`updateLobbyUI` 수정** — `LOBBY_STATE.players` 수신 시 `renderPresence(players)` 호출.

**`renderPresence(players)` 신규 함수**:
- `#presence-list` 초기화 후 `players` 배열 순회.
- 각 항목: `<span class="presence-item">🟢 [name]</span>`.
- name이 null인 항목은 '(입장 중...)' 표시.

**`showLobbyToast(text)` 신규 함수**:
- `#lobby-toast`에 텍스트 설정 → `show` 클래스 추가 → 2500ms 후 제거.

**`handleRedirect` 수정** — `name` 파라미터 추가 + mode=ai 자동결정 분기 제거:

기존에 `msg.mode`가 `'ai'`일 때 또는 presence count 기반으로 ai/human을 선택하던 분기를 완전 제거.
REDIRECT 메시지의 mode는 서버가 항상 `'human'`으로 보내므로, 클라이언트는 그대로 사용(mode 오버라이드 로직 없음).

```javascript
// 변경 전 (제거 대상):
// const effectiveMode = count === 1 ? 'ai' : (msg.mode || 'human');
// const targetPath = `${basePath}${sep}mode=${encodeURIComponent(effectiveMode)}&name=...`;

// 변경 후:
const sep = basePath.includes('?') ? '&' : '?';
const targetPath = `${basePath}${sep}mode=${encodeURIComponent(msg.mode || 'human')}&name=${encodeURIComponent(myName || '')}`;
// msg.mode는 서버가 항상 'human'으로 전송 → targetPath에 mode=human&name=... 포함
```

주의: mode=ai 강제 분기 외에 존재하는 **카드 비활성화 로직**(`botAvailable=false`인 게임 카드를 disabled 처리하던 로직)도 제거. 클릭 이벤트는 모든 게임 카드에서 PICK_GAME을 보낼 수 있어야 한다. AI 버튼 표시 여부는 각 게임방이 자체적으로 결정하므로 로비에서 비활성화할 필요 없음.

#### `omok/server.js`

**`Player` 타입 확장**:
```
Player: { id, color, ws, name: string }
```

**`handleUpgrade` 콜백(`wss.on('connection')`) 수정**:
- `playerId`, `color` 배정 직후 `name: ''` 으로 초기화한 player 생성.
- `const isBot = wsMode === 'bot'` — isBot이면 즉시 `player.name = 'AI'`.
- `sendTo(player, { type: 'JOINED', playerId, color, waiting: players.length < 2, hostUrl: HOST_URL })` (기존 유지, opponentName은 JOIN 수신 후 별도 전송).

**`readySet` 추가** (closure 변수):
```javascript
let readySet = new Set(); // 'p1' | 'p2'
```

**`JOIN` 케이스 추가** (`ws.on('message')` switch):
```javascript
case 'JOIN': {
  const name = (typeof msg.name === 'string' ? msg.name.trim().slice(0, 12) : '') || '(알 수 없음)';
  player.name = name;
  // 상대가 이미 있으면 상대에게 opponentName 포함 JOINED 재전송
  const other = players.find(p => p.id !== player.id);
  if (other) {
    sendTo(other, {
      type: 'JOINED', playerId: other.id, color: other.color,
      waiting: false, hostUrl: HOST_URL, opponentName: name,
    });
  }
  // READY_STATE 초기 전송(양쪽 아직 not ready)
  sendTo(player, { type: 'READY_STATE', myReady: false, opponentReady: false });
  break;
}
```
isBot=true 시 JOIN 수신 없이 위 로직을 connection 즉시 실행(아래 봇 진입 분기 참조):
```javascript
if (isBot) {
  player.name = 'AI';
  // 상대에게 opponentName 알림 (사람이 이미 있을 때)
  const human = players.find(p => !p.ws._isBot);
  if (human) {
    sendTo(human, {
      type: 'JOINED', playerId: human.id, color: human.color,
      waiting: false, hostUrl: HOST_URL, opponentName: 'AI',
    });
  }
  sendTo(player, { type: 'READY_STATE', myReady: false, opponentReady: false });
}
```

**`READY` 케이스 추가**:
```javascript
case 'READY': {
  readySet.add(player.id);
  // 양쪽 각자에게 READY_STATE 개별 전송
  for (const p of players) {
    sendTo(p, {
      type: 'READY_STATE',
      myReady: readySet.has(p.id),
      opponentReady: readySet.has(players.find(x => x.id !== p.id)?.id),
    });
  }
  // 양쪽 모두 준비 완료 → 게임 시작
  if (readySet.size === 2) {
    maybeStartGameIfReady();
  }
  break;
}
```

**`maybeStartGame` → `maybeStartGameIfReady`로 대체**:
- 기존 `if (players.length === 2 && !game)` 조건에서 `&& readySet.size === 2` 추가.
- 함수명을 `maybeStartGameIfReady`로 변경하여 의미 명확화.
- 기존 players.length === 2 도달 즉시 호출하던 코드 제거 → READY 수신 시에만 호출.

**리매치 처리 수정** — `REMATCH` 케이스:
```javascript
// 양쪽 동의 직전:
const nextBlack = swapColorsForRematch();
game = createGame();
lastGameResult = null;
rematchPending = new Set();
readySet = new Set(); // ← READY 리셋
broadcastAll({ type: 'REMATCH_START', nextBlack });
// JOINED 재전송(색 swap 고지) + READY_STATE 초기 전송
for (const p of players) {
  sendTo(p, { type: 'JOINED', playerId: p.id, color: p.color, waiting: false, hostUrl: HOST_URL });
  sendTo(p, { type: 'READY_STATE', myReady: false, opponentReady: false });
}
// GAME_START/STATE는 양쪽 READY 후 전송 (즉시 전송 제거)
```
참고: 리매치 시 createGame() 즉시 호출을 제거하고 readySet 초기화 → 양쪽 다시 READY 후 게임 시작.

**`ws.on('close')` 수정**:
```javascript
readySet.delete(player.id);
// OPPONENT_LEFT에 name 추가
broadcastAll({ type: 'OPPONENT_LEFT', name: player.name || '(알 수 없음)', message: '...' });
```

#### `omok/public/index.html`

**대기 화면 (`#screen-waiting`) 수정**:

`.waiting-card` 내부 최상단에 대기 안내 + AI 버튼 + 상대 이름 및 READY 상태 패널 추가:
```html
<!-- 혼자 대기 중일 때 표시 (상대 합류 시 숨김) -->
<div id="waiting-solo" class="waiting-solo">
  <p class="waiting-message">친구를 기다리는 중...</p>
  <!-- botAvailable(오목=true)이고 1인 상태일 때만 표시, 2인이 되면 hidden -->
  <button id="btn-start-ai" class="btn-start-ai" type="button">🤖 AI랑 시작</button>
</div>

<!-- 상대 이름 + READY 상태 (JOIN/READY 수신 후 갱신) -->
<div id="opponent-info" class="opponent-info hidden">
  <span id="opponent-name-label"></span>님과 대전
</div>
<div id="ready-panel" class="ready-panel">
  <div class="ready-status">
    <span>나</span>
    <span id="my-ready-mark" class="ready-mark not-ready">⌛</span>
    <span>상대</span>
    <span id="opp-ready-mark" class="ready-mark not-ready">⌛</span>
  </div>
  <button id="btn-ready" class="btn-ready" type="button" hidden>준비 완료</button>
</div>
```

**이탈 배너 추가** (게임 화면 내부 또는 오버레이로):
```html
<div id="opponent-left-banner" class="opponent-left-banner hidden">
  <span id="opponent-left-msg"></span>
  <button id="btn-banner-return-lobby" type="button">로비로 돌아가기</button>
</div>
```

**직접 진입 닉네임 인라인 입력** (대기 화면 `.waiting-card` 하단 — 폴백 B 처리):
```html
<div id="name-gate-inline" class="name-gate-inline hidden">
  <input id="inline-name-input" type="text" maxlength="12" placeholder="닉네임 입력" />
  <button id="btn-inline-enter" type="button">입장</button>
</div>
```

#### `omok/public/js/network.js`

**`connect()` 수정** — name 파라미터 파싱 및 저장:
```javascript
// mode 파싱 기존 로직 하단에 추가
const urlName = urlParams.get('name');
if (urlName) {
  sessionStorage.setItem('omok:name', decodeURIComponent(urlName));
}
// name은 JOIN 송신 시 꺼내 사용(여기서는 저장만)
```

**`ws.addEventListener('open')` 수정** — 이름 있으면 즉시 JOIN 송신:
```javascript
ws.addEventListener('open', () => {
  const storedName = sessionStorage.getItem('omok:name');
  if (storedName) {
    ws.send(JSON.stringify({ type: 'JOIN', name: storedName }));
  }
  // 이름 없으면 인라인 게이트가 JOIN 시점 결정
  reconnectAttempted = false;
  if (typeof handlers.onOpen === 'function') handlers.onOpen({ hasName: !!storedName });
});
```

**`route(msg)` 수정** — 신규 메시지 추가:
```javascript
case 'READY_STATE':
  handlers.onReadyState && handlers.onReadyState({
    myReady: !!msg.myReady, opponentReady: !!msg.opponentReady,
  });
  break;
case 'OPPONENT_LEFT':
  handlers.onOpponentLeft && handlers.onOpponentLeft({
    name: msg.name || '',
    message: msg.message || '상대방이 나갔습니다.',
  });
  break;
```
기존 `OPPONENT_LEFT` case는 string message만 넘기므로 객체로 변경(하위 호환: main.js onOpponentLeft 시그니처 수정).

**`sendJoin(name)` 신규 메서드** export 추가:
```javascript
sendJoin(name) { send({ type: 'JOIN', name }); },
sendReady() { send({ type: 'READY' }); },
```

#### `omok/public/js/main.js`

**상태 변수 추가**:
```javascript
let opponentName = null;
let myReady = false;
let opponentReady = false;
```

**DOM 참조 추가**:
```javascript
opponentInfo: document.getElementById('opponent-info'),
opponentNameLabel: document.getElementById('opponent-name-label'),
myReadyMark: document.getElementById('my-ready-mark'),
oppReadyMark: document.getElementById('opp-ready-mark'),
btnReady: document.getElementById('btn-ready'),
opponentLeftBanner: document.getElementById('opponent-left-banner'),
opponentLeftMsg: document.getElementById('opponent-left-msg'),
btnBannerReturnLobby: document.getElementById('btn-banner-return-lobby'),
nameGateInline: document.getElementById('name-gate-inline'),
inlineNameInput: document.getElementById('inline-name-input'),
btnInlineEnter: document.getElementById('btn-inline-enter'),
waitingSolo: document.getElementById('waiting-solo'),
btnStartAi: document.getElementById('btn-start-ai'),
```

**`createNetwork` handlers 추가**:

`onOpen: ({ hasName })` — 이름 없으면 `#name-gate-inline` 표시.

`onJoined` 수정 — `opponentName` 수신 시 갱신 + AI 버튼 소멸:
```javascript
onJoined: ({ playerId, color, waiting, opponentName: oppName }) => {
  // 기존 로직 유지
  if (oppName) {
    opponentName = oppName;
    updateOpponentInfo();
    // 상대가 합류했으므로 AI 버튼 숨김 (사람 대전 흐름으로 전환)
    hideAiButton();
  }
  // waiting=false: 양쪽 모두 입장 → waiting-solo 패널 숨김
  if (!waiting) {
    els.waitingSolo?.classList.add('hidden');
  }
  // ...
}
```

`onReadyState: ({ myReady: mr, opponentReady: or })` 신규:
```javascript
onReadyState: ({ myReady: mr, opponentReady: or }) => {
  myReady = mr;
  opponentReady = or;
  updateReadyUI();
}
```

`onOpponentLeft` 시그니처 수정:
```javascript
onOpponentLeft: ({ name, message }) => {
  // 자동 redirect 제거 — showScreen('waiting') 및 setTimeout(→'/') 제거
  // 대신 배너 표시
  showOpponentLeftBanner(name || '상대방');
  // 기존: showToast(message, 'error'); showScreen('waiting'); 제거
}
```

**`#btn-start-ai` 클릭 핸들러** — 유일한 AI 진입 경로:
```javascript
els.btnStartAi?.addEventListener('click', () => {
  // 현재 name을 sessionStorage에서 꺼내 mode=ai로 재접속
  const name = sessionStorage.getItem('omok:name') || '';
  const base = location.pathname; // '/omok/'
  location.href = `${base}?mode=ai&name=${encodeURIComponent(name)}`;
  // 이 경로 외에는 mode=ai가 되는 경우 없음
});
```

`hideAiButton()`:
```javascript
function hideAiButton() {
  if (els.waitingSolo) els.waitingSolo.classList.add('hidden');
  if (els.btnStartAi) els.btnStartAi.classList.add('hidden');
}
```

**신규 함수들**:

`updateOpponentInfo()`:
```javascript
function updateOpponentInfo() {
  if (opponentName) {
    els.opponentInfo.classList.remove('hidden');
    els.opponentNameLabel.textContent = opponentName;
  }
}
```

`updateReadyUI()`:
```javascript
function updateReadyUI() {
  // 마크 갱신
  els.myReadyMark.textContent = myReady ? '✅' : '⌛';
  els.myReadyMark.classList.toggle('ready', myReady);
  els.oppReadyMark.textContent = opponentReady ? '✅' : '⌛';
  els.oppReadyMark.classList.toggle('ready', opponentReady);
  // 내가 아직 준비 안 했으면 버튼 표시
  els.btnReady.hidden = myReady;
}
```

`showOpponentLeftBanner(name)`:
```javascript
function showOpponentLeftBanner(name) {
  els.opponentLeftMsg.textContent = `${name}님이 나갔어요.`;
  els.opponentLeftBanner.classList.remove('hidden');
}
```

**`#btn-ready` 클릭 핸들러**:
```javascript
els.btnReady.addEventListener('click', () => {
  els.btnReady.hidden = true;
  net.sendReady();
});
```

**`#btn-banner-return-lobby` 클릭 핸들러**:
```javascript
els.btnBannerReturnLobby.addEventListener('click', returnToLobby);
```

**인라인 닉네임 게이트 핸들러**:
```javascript
els.btnInlineEnter.addEventListener('click', () => {
  const name = els.inlineNameInput.value.trim().slice(0, 12);
  if (!name) return;
  sessionStorage.setItem('omok:name', name);
  els.nameGateInline.classList.add('hidden');
  net.sendJoin(name);
});
```

**`returnToLobby` 함수** — 자동 setTimeout redirect 제거 확인:
현재 구현:
```javascript
function returnToLobby() {
  fetch('/lobby/return', { method: 'POST' }).catch(() => {}).finally(() => {
    if (!seg) { location.href = '/'; }
    setTimeout(() => { if (seg) location.href = '/'; }, 1500); // ← 제거 대상
  });
}
```
변경 후: `finally` 블록에서 `setTimeout` 제거, 사용자가 버튼 누를 때만 이동. 단, `#btn-return-lobby`(다른 종목 버튼)과 `#btn-back-to-lobby`(게임 선택 버튼)의 `returnToLobby` 호출은 유지(사용자 직접 클릭이므로 즉시 이동 허용).

#### `omok/bot.js`

**자동 READY 예약** — JOINED 수신 후:
```javascript
case 'JOINED':
  myId = msg.playerId;
  myColor = msg.color;
  console.log(`[omok-bot] ${myId}(${myColor}) 자리 점유(갱신)`);
  // 신규: 입장 즉시 자동 READY 예약(0.2~0.5초 지연)
  scheduleReady();
  break;
```

**`scheduleReady()` 신규 함수**:
```javascript
let readyTimer = null;
function scheduleReady() {
  if (readyTimer) clearTimeout(readyTimer);
  readyTimer = setTimeout(() => {
    readyTimer = null;
    send({ type: 'READY' });
    console.log('[omok-bot] READY 송신');
  }, 200 + Math.floor(Math.random() * 300)); // 0.2~0.5초
}
```

**`READY_STATE` 케이스 추가** (무시 — 봇은 수신만):
```javascript
case 'READY_STATE':
  // 봇은 READY 상태 표시 불필요 — 무시
  break;
```

---

## 단계적 구현 계획

### 페이즈1 — 로비 공통부 (닉네임 게이트 + presence + 토스트)

**대상 파일**: `launcher/server.js`(JOIN/PLAYER_JOINED/PLAYER_LEFT/LOBBY_STATE 확장만), `launcher/public/index.html`, `launcher/public/app.js`(닉네임 게이트 + presence + handleRedirect name 파라미터 추가)

**주의**: PICK_GAME의 isAiMode 제거·handleRedirect mode=ai 분기 제거는 **페이즈2**에서 처리. 페이즈1은 닉네임·presence 기능만.

**완료 조건**:
- 닉네임 게이트 화면 표시 → 입력 → WS 연결 → JOIN 송신 순서 동작
- 로비 상단 presence 목록이 새로고침 없이 실시간 갱신
- 입장/퇴장 토스트 표시
- 기존 PICK_GAME/VOTE_GAME/REDIRECT/FULL/RESET/RETURN_LOBBY 동작 무변화(mode=ai 자동결정은 아직 유지 — 페이즈2에서 제거)

**독립 검증**: 오목 등 게임 서버와 무관하게 로비만 띄워 2개 탭으로 검증 가능.

**AD 모드3 실행**: 페이즈1 Coder 완료 후 AD 모드3 실행(닉네임 게이트·presence 목록·토스트 레이아웃/가독성/일관성 검수).

### 페이즈2 — 오목 게임방 + launcher 카드클릭 라우팅 변경

**대상 파일**: `launcher/server.js`(PICK_GAME isAiMode 제거), `launcher/public/app.js`(handleRedirect mode=ai 분기 제거 + botAvailable 비활성화 제거), `omok/server.js`, `omok/public/index.html`, `omok/public/js/main.js`, `omok/public/js/network.js`, `omok/bot.js`

**완료 조건**:
- **카드를 혼자 클릭해도 AI가 시작되지 않고 게임방 대기 상태로 진입**
- 대기 화면에 "친구를 기다리는 중" + "🤖 AI랑 시작" 버튼 표시
- "🤖 AI랑 시작" 버튼 클릭만이 mode=ai 재접속을 트리거
- 친구 합류(2인 상태) 시 "🤖 AI랑 시작" 버튼 자동 소멸
- 로비 → 오목 진입 시 `?name=` 쿼리 전달 → JOIN 송신 → 대기 화면에 상대 이름 표시
- 준비 버튼 클릭 → READY_STATE 실시간 갱신 → 양쪽 완료 시 게임 시작
- 상대 이탈 시 자동 redirect 없이 배너+버튼 표시
- AI 모드: 봇이 자동 READY → 사람 READY 후 즉시 게임 시작
- 리매치 후 READY 단계 재진입 정상 동작
- 기존 smoke(106) + bot-smoke(14) + qa-edge(35) + qa-renju-attack(28) + qa-rematch-attack(14) 회귀 무영향

**독립 검증**: `node omok/server.js --port 3105`로 단독 기동 후 2개 탭으로 검증 가능.

**AD 모드3 실행**: 페이즈2 Coder 완료 후 AD 모드3 실행(준비 상태 UI·AI버튼·이탈 배너·상대이름 표시·전체 흐름 레이아웃 검수). 페이즈1 AD와 별도 독립 실행.

---

## 테스트 계획

### Playwright E2E 시나리오 (신규, 2개 브라우저 컨텍스트 사용)

파일 위치: `tests/connection-flow-e2e.spec.js`

| 시나리오 ID | 설명 | 검증 포인트 |
|---|---|---|
| CF-01 | 닉네임 게이트 → 로비 입장 | 게이트 화면 표시, 빈 입력 차단, 입력 후 로비 전환 |
| CF-02 | 친구 입장 → presence 갱신 | 브라우저 A 로비 접속 후 브라우저 B 접속 → A 화면 목록·토스트가 **새로고침 없이** 갱신 |
| CF-03 | localStorage 닉네임 자동 pre-fill | 재방문 시 게이트에 이전 닉네임 자동 표시 |
| CF-04 | 퇴장 토스트 | 브라우저 B 닫으면 A에 퇴장 토스트 표시 |
| CF-05 | 양쪽 READY 상호 표시 → 게임 시작 | 오목 방에서 A/B 각자 준비 버튼 클릭 → 상대 마크 ✅로 갱신 → 양쪽 GAME_START |
| CF-06 | 상대 이탈 → 배너+버튼, 자동 redirect 없음 | 브라우저 B 닫으면 A에 이탈 배너 표시, 3초 대기 후 자동 이동 없음, 버튼 클릭 시 로비 이동 |
| CF-07 | mode=ai 봇 자동 READY → 게임 시작 | AI 모드 진입 후 봇이 자동 READY → 사람 준비 버튼 클릭 → GAME_START |
| CF-08 | 리매치 후 READY 재진입 | 게임 종료 → 양쪽 "한 판 더" → READY 버튼 재표시 → 양쪽 준비 → 새 게임 시작 |
| CF-09 | 직접 진입 닉네임 인라인 게이트 | `/omok/` 직접 접속(name 쿼리 없음) → 인라인 입력 표시 → 입력 후 JOIN |
| CF-10 | **1인 카드 클릭 → 게임방 대기(AI 미자동)** | 로비 1인 상태에서 오목 카드 클릭 → REDIRECT mode='human' → 오목 방 대기 화면("친구를 기다리는 중" + "🤖 AI랑 시작" 버튼 표시, 게임 미시작) |
| CF-11 | **"🤖 AI랑 시작" 버튼만이 AI 진입** | 대기 화면에서 "🤖 AI랑 시작" 클릭 → URL이 `?mode=ai&name=...`으로 재구성 → 봇 spawn → 봇 자동 READY → 사람 준비 버튼 클릭 → GAME_START |
| CF-12 | **친구 합류 시 AI 버튼 소멸** | 브라우저 A 오목 방 대기 중(AI 버튼 보임) → 브라우저 B 같은 방 진입 → A 화면에서 AI 버튼 사라지고 "○○님과 대전" 표시 |

### 기존 회귀 확인

| 테스트 파일 | 케이스 수 | 주의점 |
|---|---|---|
| `omok/tests/smoke.test.js` | 106 | JOIN 미송신 시 서버 `player.name` 폴백 '(알 수 없음)' → PLACE 가드 무영향 확인 |
| `omok/tests/bot-smoke.test.js` | 14 | 봇 READY 추가로 GAME_START 타이밍 지연(READY 2번 필요) → timeout 여유 확인 |
| `omok/tests/qa-edge.test.js` | 35 | readySet 초기화 상태에서 PLACE 전송 시 "게임이 시작되지 않았습니다" 응답 확인 |
| `omok/tests/qa-renju-attack.test.js` | 28 | READY 후 게임 시작 플로우 통과 후 기존 금수 공격 동일 |
| `omok/tests/qa-rematch-attack.test.js` | 14 | 리매치 후 READY 단계 추가됨 → readySet 초기화 + 재준비 시나리오 포함 확인 |

**주의**: 기존 smoke.test.js가 GAME_START를 기다리는 시나리오는 READY 단계가 추가된 이후 동작이 바뀐다. smoke 내 PLACE 전송 전에 명시적 `READY` 메시지 송신을 추가해야 할 수 있다 — 기존 테스트가 JOIN 없이 동작하도록 **서버에서 JOIN 미수신 시에도 READY를 받아 처리하도록 가드** 유지. `player.name`이 null이어도 READY는 동작해야 한다.

---

## 수용 기준 (Acceptance Criteria)

- [ ] AC-01: 친구 입장 시 내 로비 화면 presence 목록과 입장 토스트가 새로고침 없이 갱신된다
- [ ] AC-02: 양쪽 준비 버튼 클릭 시 상대 마크가 ✅로 실시간 갱신되고, 둘 다 ✅이면 게임이 시작된다
- [ ] AC-03: 상대 이탈 시 자동 튕김(setTimeout redirect)이 없고, "○○님이 나갔어요" 배너와 "로비로 돌아가기" 버튼이 사라지지 않고 표시된다
- [ ] AC-04: 닉네임 입력 후 재방문 시 로비 게이트에 이전 닉네임이 자동 pre-fill된다
- [ ] AC-05: mode=ai 진입 시 봇이 자동으로 READY를 송신하여 사람이 준비 버튼을 누르면 게임이 정상 시작된다
- [ ] AC-06: 로비 → 오목 REDIRECT URL에 `?name=` 쿼리가 포함되어 오목 방에서 상대 이름이 표시된다
- [ ] AC-07: `/omok/` 직접 진입(name 쿼리 없음) 시 인라인 닉네임 입력이 표시되고, 입력 후 JOIN이 전송된다
- [ ] AC-08: 리매치 후 READY 버튼이 다시 표시되고, 양쪽 준비 시 새 판이 시작된다
- [ ] AC-09: 기존 smoke(106) + bot-smoke(14) + qa-edge(35) + qa-renju(28) + qa-rematch(14) = 197건 회귀 무영향
- [ ] AC-10: 닉네임 12자 초과 입력 시 게이트 차단(trim 후 12자 이하만 허용)
- [ ] **AC-11: 로비에서 카드만 눌러서는 AI가 시작되지 않는다** — REDIRECT의 mode가 'human'으로 오목 방 진입
- [ ] **AC-12: 게임방에서 "🤖 AI랑 시작" 버튼을 눌러야만 봇이 호출된다** — mode=ai URL은 이 버튼 클릭에서만 생성
- [ ] **AC-13: 혼자(1인) 카드 클릭 시 오목 게임방 대기 상태로 진입** — "친구를 기다리는 중" + "🤖 AI랑 시작" 버튼이 표시됨
- [ ] **AC-14: 2인(친구 합류) 상태에서 "🤖 AI랑 시작" 버튼이 자동으로 사라진다** — 사람 대전 흐름으로 전환
- [ ] **AC-15: 봇이 입장한 뒤(mode=ai 진입 후) 세 번째 접속자는 FULL로 거절된다** — 봇 우선, 방 정원(2) 초과 불가

---

## 범위 경계 (Out of Scope)

- 오목 이외 9종 게임(맞고·윷놀이·테트리스 배틀 등)의 READY/닉네임 통합 — 이번 파일럿 이후 별도 발주
- 오목 이외 9종 게임의 카드클릭→게임방 대기 + "🤖 AI랑 시작" 버튼 통합 — 후속 발주(이번은 launcher 라우팅만 변경, 오목 게임방만 버튼 추가)
- 서버 인증 / 세션 토큰 — LAN 환경이므로 불필요
- 닉네임 중복 검증 / 서버 측 유니크 강제 — 스코프 외
- 로비 presence를 2인 초과로 확장하는 관전 모드
- READY 타임아웃(상대가 무한 대기) — 후속 작업
- 오목 이외 게임 방의 `returnToLobby` 자동 redirect 제거 — 각 게임 후속 발주
- 봇 입장 후 방 치환(봇을 쫓아내고 친구를 받는) 기능 — 스코프 외(봇 입장 후에는 FULL 거절이 단순·명확 규칙)

---

## Art Director 실행 계획

- **visual_change**: `ui`
- **AD 모드1 (에셋 컨셉)**: 해당 없음 — 외부 이미지 에셋 0, CSS/HTML/Canvas 전용 변경
- **AD 모드2 (에셋 검증)**: 해당 없음 — 에셋 생성 없음
- **AD 모드3 (UI 레이아웃 검수)**:
  - **페이즈1 완료 후 AD 모드3 실행**: 닉네임 게이트 화면, presence 목록(이름+🟢), 로비 토스트의 레이아웃·가독성·기존 로비 UI와의 일관성 검수
  - **페이즈2 완료 후 AD 모드3 실행**: 준비 버튼 위치, ✅/⌛ 마크 대비, 상대이름 표시 위치, 이탈 배너 스타일·가독성, 전체 대기→게임 흐름 레이아웃 검수. 페이즈1 AD 결과와 스타일 일관성도 확인
- **멀티 페이즈 AD 반복**: 페이즈1 Coder → AD 모드3(P1) → 페이즈2 Coder → AD 모드3(P2). 페이즈1 AD 결과로 페이즈2를 생략하지 않는다.

---

## 제약사항

- **기존 WS 메시지 타입 삭제 금지**: LOBBY_STATE, REDIRECT, FULL, RESET, RETURN_LOBBY, JOINED, GAME_START, STATE, GAME_OVER, OPPONENT_LEFT, REMATCH, REMATCH_WAITING, REMATCH_START, ERROR — 모두 유지
- **JOIN 없이 동작 가능 유지**: 기존 smoke/bot-smoke 테스트가 JOIN을 송신하지 않으므로, 서버에서 JOIN 미수신 시 `player.name='(알 수 없음)'`으로 폴백하고 READY/PLACE 등 기존 메시지는 정상 처리해야 한다
- **`location.reload()` 패턴 불사용**: 리매치에서 이미 제거된 패턴. READY도 동일하게 WS 연결 유지
- **오목 단독 실행 호환**: `node omok/server.js --port 3012` 단독 실행 시에도 READY 흐름이 동작해야 함
- **봇 `scheduleRematch`와 `scheduleReady` 타이머 충돌 방지**: 각각 별도 타이머 변수(`readyTimer`, `rematchTimer`) 사용

---

## 참고사항

### 핵심 함정 (Coder 주의)

0. **자동 모드결정 제거 지점 전수 체크 (B안 핵심)**:

   제거 대상이 되는 코드 패턴을 모두 삭제해야 한다. 하나라도 남으면 카드 클릭 시 AI가 시작될 수 있다.

   | 파일 | 제거 대상 패턴 | 비고 |
   |------|----------------|------|
   | `launcher/server.js` | `isAiMode = clients.size === 1` | PICK_GAME 핸들러 내부 |
   | `launcher/server.js` | `mode: isAiMode ? 'ai' : 'human'` | REDIRECT broadcast |
   | `launcher/server.js` | `botAvailable && clients.size === 1` 등 1인=AI 분기 | 있을 경우 전부 |
   | `launcher/public/app.js` | `effectiveMode = count === 1 ? 'ai' : 'human'` 등 | handleRedirect 및 LOBBY_STATE 수신부 |
   | `launcher/public/app.js` | `botAvailable` 조건으로 카드 `disabled` 처리 | 비활성 → 활성 전환 |
   | `omok/public/js/main.js` | mode=ai로 가는 경로가 `#btn-start-ai` 클릭 외에 존재하면 제거 | |

   **AI 모드 진입 경로는 단 하나**: `#btn-start-ai` 클릭 → `location.href = '/omok/?mode=ai&name=...'`. 다른 경로는 없어야 한다.

1. **JOIN 타이밍 레이스**: `network.js`의 `ws.addEventListener('open')` 콜백에서 sessionStorage에 name이 있으면 즉시 JOIN 송신. 그러나 `open` 이벤트 직후 서버 `wss.on('connection')`이 처리되기 전에 메시지가 올 수 있다. 서버는 `players.push(player)` 완료 후에야 JOIN을 처리하므로 실제로는 순서가 보장된다(동일 TCP 스트림). 그러나 bot.js의 경우 `ws.on('open')`에서 READY를 즉시 보내면 서버가 아직 connection 이벤트를 처리 중일 수 있으므로 반드시 0.2초 이상 지연 필수.

2. **READY 이후 리매치의 game=null 문제**: 리매치 처리 시 `createGame()` 즉시 호출을 제거하고 readySet 초기화 후 대기. 이 상태에서 players.length===2이지만 game===null이다. 기존 `maybeStartGame` 조건(`players.length === 2 && !game`)이 connection 이벤트에서 호출되지 않도록 제거하고 `maybeStartGameIfReady`만 READY 케이스에서 호출해야 한다. 호출 경로 혼선이 가장 큰 함정.

3. **이탈 자동 redirect 제거 지점**: `main.js`의 `onOpponentLeft` 핸들러와 `returnToLobby` 함수 모두 확인 필요.
   - `onOpponentLeft` 기존: `showToast` + `showScreen('waiting')`. 여기에 `setTimeout(→'/')` 패턴은 없지만, `showScreen('waiting')`이 대기 화면으로 돌아가므로 배너가 보이지 않는다. → `showScreen('waiting')` 호출 제거하고 배너만 표시.
   - `returnToLobby` 기존: `finally`에서 `setTimeout(() => { if (seg) location.href = '/'; }, 1500)` — 이것이 자동 redirect의 실제 출처. 제거 대상.
   - `#btn-return-lobby`·`#btn-back-to-lobby`의 `returnToLobby` 호출은 사용자 직접 클릭이므로 즉시 redirect 유지(단, setTimeout 제거 후 `.finally(() => { location.href = '/'; })` 로 단순화).

4. **봇 자동 READY**: bot.js는 `JOINED` 케이스에서 `scheduleReady()` 호출. 리매치 시에도 JOINED가 재전송되므로 `scheduleReady()` 재호출 → 자동 READY 재예약. 단, 리매치 JOINED가 오기 전에 이미 readyTimer가 남아있을 수 있으므로 `scheduleReady()` 시작 시 `if (readyTimer) clearTimeout(readyTimer)` 필수.

5. **LOBBY_STATE의 `players` 배열 하위 호환**: 기존 클라이언트(`app.js`)가 `players` 필드를 무시해도 동작해야 한다. `players` 필드는 추가일 뿐 기존 `count`, `role`, `votes` 는 그대로 유지.

6. **닉네임 전달 경로 전체**: 로비(localStorage `minigames:nickname`) → REDIRECT URL(`?name=`) → 오목 방 `network.js`(`sessionStorage omok:name` 저장) → `ws.open`에서 JOIN 송신. 이 체인의 각 단계에서 name이 null/empty가 되는 경우(로비 우회 직접 진입 등)를 인라인 게이트가 catch하도록 설계.

### 공통 모듈화 메모 (9종 확장 대비)

이번 오목 파일럿에서 다음 패턴을 깔끔하게 정의해 두면 후속 9종 통합 시 추출 용이:
- 서버 측: `JOIN { name }` 처리 + isBot 자동 처리 패턴 → `handleJoin(player, msg)` 헬퍼로 추출 가능
- 서버 측: `readySet` 관리 + `maybeStartGameIfReady()` 패턴 → 각 게임 createApp에 동일 구조 적용
- 클라 측: `network.js`의 name 파싱(URL→sessionStorage→인라인 게이트) 패턴 → 공통 모듈로 추출 가능
- 클라 측: `onOpponentLeft`에서 배너 표시 패턴 → 각 게임 공통 UX로 통일

### 관련 코드 레퍼런스

- `launcher/server.js`: `sendLobbyStateTo(ws)` L462, `handleMessage` L538, `lobbyWss.on('connection')` L597, `ws.on('close')` L630
- `launcher/public/app.js`: `handleRedirect(msg)` L268, `connectWS()` L354, `onMessage(event)` L314
- `omok/server.js`: `wss.on('connection')` L232, `maybeStartGame()` L120, `REMATCH` 케이스 L330
- `omok/public/js/network.js`: `connect()` L22, `route(msg)` L65
- `omok/public/js/main.js`: `onOpponentLeft` L223, `returnToLobby()` L302
- `omok/bot.js`: `scheduleRematch()` L136, `handleState()` L154
