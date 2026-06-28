---
status: COMPLETED
completed: 2026-06-28
spec: .claude/specs/2026-06-28-codenames-classic-spec.md
scope: .claude/specs/2026-06-28-codenames-classic-scope.md
qa: .claude/specs/2026-06-28-codenames-classic-qa-report.md
result: QA PASS (blocker 0), AD3 APPROVED. smoke 65 + E2E 12 = 77 PASS, duet 회귀 27/27.
docs: codenames/docs/{RULEBOOK.md, PROJECT.md, CHANGELOG.md}
note: |
  실제 산출 테스트 파일명은 계획(game.unit.mjs/smoke.mjs/e2e.spec.js)과 달리
  codenames/tests/{smoke.test.js(로직+WS 65건), e2e.spec.js(12건)}로 통합됨.
  봇 슬롯은 createApp(getBotUrl) 훅 + Player.ws 자리 주석 예약(미구현, RULEBOOK §13-2).
  LOW non-blocker 2건(종료 후 silent break / isAllSlotsFilled의 joined 미검사) — 정상 흐름 무영향.
---

# Feature: 코드네임 클래식 (정통 4인 팀 대전)

## 개요

정통 Codenames 룰(단일 공유 키, 2팀 턴제 경쟁, 역할별 시야 분리)을 구현한 11번째 신규 게임.
기존 codenames-duet(2인 협력)과 독립 병존하며, 런처 포탈 `/codenames/` 경로로 추가한다.

## 배경 및 동기

codenames-duet이 2인 협력 게임인 반면, 정통 Codenames는 2팀(레드/블루) 4인 경쟁이다.
두 게임은 단어 보드·단서 UI 구조를 공유하지만 키 구조·역할 시야·턴 규칙·승패 로직이 완전히 다르므로
독립 디렉토리(`codenames/`)에 신규 구현한다.

---

## 요구사항

### 기능 요구사항

- [ ] 25칸 단어 보드, 단일 공유 키(레드 9|8 / 블루 8|9 / 중립 7 / 암살자 1)
- [ ] 선공팀 9장 랜덤 배정. 보드 상단에 "레드 N – 블루 M (선공: X팀)" 표시
- [ ] 4인 로비(role_select 단계): 팀(레드/블루) + 역할(스파이마스터/요원) 자유 선택, 중복 배정 서버 가드
- [ ] 호스트 시작 버튼: 4 슬롯(레드 마스터, 레드 요원, 블루 마스터, 블루 요원) 모두 채워져야 활성
- [ ] 역할별 시야 분리: 스파이마스터는 키 전체 공개, 요원은 공개된 카드 색상만 노출
- [ ] 턴 규칙: 단서 숫자 + 1 추측 한도, 자기 팀 적중 시 계속, 중립/상대팀/암살자 시 즉시 종료
- [ ] 요원 패스(END_TURN) 가능
- [ ] 상대 팀 카드 적중 시 상대 진척 +1 반영 후 즉시 턴 종료
- [ ] 암살자 클릭 → 선택 팀 즉시 패배(상대 승리), GAME_OVER 브로드캐스트
- [ ] 승리: 자기 팀 전체 카드 공개 시 즉시 GAME_OVER
- [ ] 리매치: 게임 종료 후 "한 판 더" 동의 시 재시작, 선공 팀 교체 + 보드 재생성 (omok REMATCH 패턴)
- [ ] 단서 검증: 공백·길이 최소 검증(LAN 환경 신뢰)
- [ ] 런처 포탈 11번째 게임 카드 추가 (`games.json`, `launcher/server.js` import)

### 비기능 요구사항

- [ ] 서버 권위(game.js 순수 함수) — 키 분배·턴·승패 모두 서버
- [ ] codenames-duet `createApp` factory + noServer 모드 WS 패턴 동일하게 적용
- [ ] 봇 확장 슬롯 보존: `getBotUrl` 훅 주석 예약, `ws` 자리에 봇 삽입 가능한 구조
- [ ] 단독 실행 포트 3014 (충돌 시 +1 폴백)
- [ ] codenames-duet 회귀 무영향 (review-smoke 27/27 유지)

---

## 구현 상세

### 핵심 설계 결정: 4인 팀/역할 배정 위치

**결정: 게임 자체 대기실 (codenames/server.js 내 `role_select` 단계)에서 처리한다.**

**근거:**

1. 런처 대기실(`/lobby/ws`)의 `PlayerMeta`는 `{ id, name, ready, kickTimer }` 구조다.
   team/role은 codenames 전용 개념이므로 범용 구조에 추가하면 런처가 게임별 로직에 오염된다.

2. 런처 수정을 최소화할 수 있다. `games.json` 항목 추가 + `launcher/server.js` import 1줄이 전부.

3. 런처는 4명 취합 + REDIRECT만 담당한다. 4명이 `/codenames/`에 도착하면 게임 서버가
   `phase: 'role_select'` 상태에서 팀/역할 선택 UI를 자체 관리한다.

4. 미래 다른 팀 기반 게임 추가 시 런처 수정 불필요. 각 게임이 자체 pre-game 단계를 소유한다.

5. 듀엣의 `JOIN → READY → GAME_START` 패턴과 유사하게,
   클래식은 `JOIN → PICK_ROLE → HOST_START → GAME_START` 흐름을 게임 서버 내부에서 처리한다.

**흐름 요약:**
```
런처 대기실 4인 취합 → REDIRECT to /codenames/
   ↓
codenames /ws 접속 (4인 순차)
   ↓
phase='role_select': ROLE_STATE 브로드캐스트 (팀/역할 현황)
   ↓
각자 PICK_ROLE { team, role } 송신 → 서버 중복 검사 → ROLE_STATE 갱신
   ↓
4 슬롯 모두 채워짐 → 호스트가 START_GAME 송신
   ↓
phase='playing': GAME_START + STATE 브로드캐스트
```

---

### 수정/생성할 파일

| 파일 경로 | 작업 유형 | 설명 |
|---|---|---|
| `codenames/game.js` | 신규 | 순수 게임 로직: 키 생성·역할 선택 검증·턴·승패 |
| `codenames/server.js` | 신규 | createApp factory + WS (듀엣 패턴, noServer 모드) |
| `codenames/words.js` | 신규 | 단어팩 — codenames-duet/words.js에서 복사 (독립 파일) |
| `codenames/public/index.html` | 신규 | 게임 HTML (role_select 단계 + 게임 보드) |
| `codenames/public/client.js` | 신규 | 클라이언트 WS + UI 렌더링 |
| `codenames/public/style.css` | 신규 | 스타일 (레드/블루 팀 색상 테마) |
| `codenames/docs/RULEBOOK.md` | 신규 | 룰북 §1~§13 + 구현 노트 |
| `codenames/tests/game.unit.mjs` | 신규 | 게임 로직 단위 테스트 (노드 러너) |
| `codenames/tests/smoke.mjs` | 신규 | WS 스모크 테스트 (노드 러너, 포트 3114) |
| `codenames/tests/e2e.spec.js` | 신규 | Playwright E2E (4 브라우저 컨텍스트) |
| `codenames/package.json` | 신규 | `{ "type": "module" }` + ws 의존성 |
| `launcher/public/games.json` | 수정 | 11번째 항목 추가 (id: "codenames") |
| `launcher/server.js` | 수정 | createCodenamesClassicApp import + GAME_APPS 등록 |
| `docs/PROJECT.md` | 수정 | 게임 목록에 코드네임 추가 |

---

### 각 파일별 변경사항

#### `codenames/game.js`

**GameState 구조:**
```
{
  words: string[25]              // 단어 카드 (인덱스 = 보드 위치)
  keyCard: ('red'|'blue'|'neutral'|'assassin')[25]  // 단일 공유 키
  revealed: (string|null)[25]   // 공개된 카드 색상 (null=미공개)
  firstTeam: 'red'|'blue'       // 선공팀 (9장 팀)
  redTotal: 9|8                 // 레드 총 카드 수
  blueTotal: 8|9                // 블루 총 카드 수
  redFound: number              // 레드 공개 카드 수
  blueFound: number             // 블루 공개 카드 수
  currentTeam: 'red'|'blue'     // 현재 턴 팀
  turnPhase: 'clue'|'guess'     // 현재 단계
  currentClue: {word, number, team} | null
  guessesLeft: number           // 남은 추측 횟수
  gamePhase: 'playing'|'over'
  winner: 'red'|'blue' | null
  winReason: 'completed'|'assassin'|''
}
```

**주요 함수:**
- `createGame()`: 단일 공유 키 생성. 선공팀(9장 팀)을 랜덤 결정. firstTeam이 9장, 상대가 8장.
- `buildKeyCard()`: 25칸 배열을 shuffleInPlace로 셔플 후 red(9 or 8), blue(8 or 9), neutral(7), assassin(1) 분배.
  선공팀은 랜덤(`Math.random() < 0.5 ? 'red' : 'blue'`). 선공팀 9장, 후공팀 8장.
- `submitClue(state, team, word, number)`: 스파이마스터만 호출. 현재 턴·단계 검증.
- `guessCard(state, team, cardIndex)`: 요원만 호출. 결과: `'correct'|'neutral'|'opponent'|'assassin'`. 각 결과에 따른 상태 변이.
- `endTurn(state)`: 명시적 패스 또는 서버 내부 호출. 다음 팀으로 turnPhase='clue' 초기화.
- `snapshotForPlayer(state, role)`: 역할별 마스킹. 아래 별도 섹션 참조.
- `checkWin(state)`: 레드 전체 공개 or 블루 전체 공개 시 gamePhase='over'.

**guessCard 턴 종료 조건:**
- `'correct'` (자기 팀): `guessesLeft -= 1`. guessesLeft === 0이면 `endTurn()`.
- `'neutral'`: 즉시 `endTurn()`.
- `'opponent'`: 상대 found +1 → 상대 승리 체크 → `endTurn()`.
- `'assassin'`: 현재 팀 패배, 상대 승리. gamePhase='over'.

#### `codenames/game.js` — snapshotForPlayer 마스킹

```javascript
/**
 * @param {GameState} state
 * @param {'spymaster'|'operative'} role - 수신자 역할
 * @param {string} playerId              - 수신자 ID
 * @returns {object} STATE 페이로드
 */
export function snapshotForPlayer(state, role, playerId) { ... }
```

- **스파이마스터**: `keyCard` 전체 노출. `myKey: state.keyCard`.
- **요원**: 미공개 카드는 색상 숨김. `myKey: state.keyCard.map((c, i) => state.revealed[i] !== null ? c : null)`.
- 공통: `words`, `revealed`, `currentTeam`, `turnPhase`, `currentClue`, `guessesLeft`, `redTotal`, `blueTotal`, `redFound`, `blueFound`, `firstTeam`, `gamePhase`, `winner`, `winReason`, `you: playerId`.

---

#### `codenames/server.js`

**플레이어 슬롯 구조:**
```javascript
// @typedef {Object} Player
// @property {string} id         - 'p1'|'p2'|'p3'|'p4'
// @property {string} name
// @property {'red'|'blue'|null} team
// @property {'spymaster'|'operative'|null} role
// @property {import('ws').WebSocket} ws
// @property {boolean} joined
// NOTE: ws 자리에 봇 삽입 가능하도록 구조 설계 (getBotUrl 훅 주석 예약)
// TODO: getBotUrl 옵션으로 봇 슬롯 자동 채우기 확장 가능 (이번 작업 외)
```

**서버 Phase:**
1. `role_select`: 4명 미만 또는 슬롯 미채움 → `ROLE_STATE` 브로드캐스트
2. `playing`: 게임 진행 중 → `STATE` 브로드캐스트 (역할별 마스킹)
3. `over`: 게임 종료 → `GAME_OVER` 브로드캐스트 + 리매치 대기

**리매치 (omok REMATCH 패턴 참조):**
- `rematchPending: Set<string>`: 양쪽 REMATCH 수신 시 재시작
- 재시작 시: 선공 팀 교체 (`firstTeam` 반전), `createGame()` 재생성, 역할 유지
- `REMATCH_WAITING { readyIds }` → `REMATCH_START { firstTeam }` 시퀀스

**heartbeat:** 듀엣 패턴과 동일 (30초 ping, 응답 없는 좀비 강제 종료)

**createApp(options) 시그니처:**
```javascript
// options: { getBotUrl?: () => string }  — 향후 봇 확장용 훅 (이번 미구현)
export function createApp(options = {}) { ... }
```

---

#### `codenames/words.js`

- `codenames-duet/words.js`에서 복사. 독립 파일로 관리.
- 재활용 전략: **복사** 채택. 런처 통합 시 상대경로 `import ../codenames-duet/words.js`도 기술적으로 가능하나, 향후 클래식 전용 단어 추가 용이성 + 완전한 독립성을 위해 복사본 유지.
- 정적 경로 충돌 없음: 클라이언트는 `/codenames/client.js`를 받고, `words.js`는 서버 전용 모듈 (public/ 미노출).

---

### WS 프로토콜 — codenames `/codenames/ws`

**Phase: role_select**

| 방향 | 메시지 | 페이로드 | 설명 |
|------|--------|---------|------|
| C→S | `JOIN` | `{ name }` | 닉네임 송신, 4명 취합 시 role_select 시작 |
| S→C | `ROLE_STATE` | `{ players: [{id, name, team, role, isHost}], canStart }` | 역할 현황 브로드캐스트 |
| C→S | `PICK_ROLE` | `{ team: 'red'|'blue', role: 'spymaster'|'operative' }` | 팀·역할 선택 (중복 시 ERROR) |
| C→S | `START_GAME` | (없음) | 호스트 전용. canStart=true일 때만 유효 |
| S→C | `GAME_START` | `{ firstTeam }` | 게임 시작 신호 |

**Phase: playing**

| 방향 | 메시지 | 페이로드 | 설명 |
|------|--------|---------|------|
| S→C | `STATE` | (역할별 마스킹 스냅샷) | 매 상태 변경마다 개별 전송 |
| C→S | `CLUE` | `{ word, number }` | 스파이마스터 전용. 자기 팀 턴·단계 검증 |
| C→S | `GUESS` | `{ cardIndex }` | 요원 전용. 자기 팀 턴·단계·한도 검증 |
| C→S | `END_TURN` | (없음) | 요원 조기 패스. 자기 팀 요원 + guess 단계 검증 |
| S→C | `GAME_OVER` | `{ winner, reason, review }` | 게임 종료. review = 키 전체 공개 복기 데이터 |
| C→S | `REMATCH` | (없음) | 재도전 의사 표시 |
| S→C | `REMATCH_WAITING` | `{ readyIds: string[] }` | 재도전 대기 현황 |
| S→C | `REMATCH_START` | `{ firstTeam }` | 재도전 시작. 선공 팀 교체 포함 |

**공통**

| 방향 | 메시지 | 페이로드 | 설명 |
|------|--------|---------|------|
| S→C | `ERROR` | `{ message }` | 규칙 위반 알림 (해당 플레이어에게만) |
| S→C | `OPPONENT_LEFT` | `{ message }` | 접속자 퇴장 알림 |

**주의:** 런처 `/lobby/ws` 프로토콜은 무변경. 팀/역할 배정은 게임 서버에서만 처리.

---

### 런처 통합

#### `launcher/public/games.json` 변경

11번째 항목 추가:
```json
{
  "id": "codenames",
  "name": "코드네임",
  "description": "스파이마스터의 힌트로 팀원을 이끌어라! 2:2 팀 대전 워드 게임",
  "port": 3014,
  "httpPath": "/codenames/",
  "wsPath": "/codenames/ws",
  "color": "#B22222",
  "emoji": "🕵️",
  "botAvailable": false,
  "minPlayers": 4,
  "maxPlayers": 4
}
```

색상은 레드/블루 경쟁 느낌 → `#B22222` (딥 레드) 또는 AD 검토 후 조정.

#### `launcher/server.js` 변경

```javascript
// import 추가
import { createApp as createCodenamesClassicApp } from '../codenames/server.js';

// GAME_APPS 추가
'codenames': createCodenamesClassicApp(),
```

봇 미지원이므로 `getBotUrl` 옵션 불필요.

#### 런처 대기실 UI 변경 범위

**런처 대기실 자체(`app.js`, `waiting-room-view`)는 무수정.** minPlayers=maxPlayers=4이므로 4명이 모두 READY하면 REDIRECT 발생. 현행 범용 대기실 UI(4명 슬롯 표시)가 그대로 동작한다.

팀/역할 선택 UI는 게임 서버(`codenames/public/`) 내 `role_select` 단계에서 제공한다.

---

### 키 카드 구조

**단일 공유 키 (클래식의 핵심 차이점):**
- 듀엣: `{ left: '...', right: '...' }` 쌍 (플레이어별 시점)
- 클래식: `'red'|'blue'|'neutral'|'assassin'` 단일 색상 배열

**분배:**
- 선공팀 배정: `firstTeam = Math.random() < 0.5 ? 'red' : 'blue'`
- 선공팀 카드 수: 9장, 후공팀: 8장, 중립: 7장, 암살자: 1장. 합계 25.
- 셔플: `shuffleInPlace(cells)` (Fisher-Yates, 듀엣과 동일)

---

### 룰북

`codenames/docs/RULEBOOK.md` 신규 작성 (matgo/janggi/yutnori/hanabi 패턴 참조).

**구성:**
- §1 게임 목적
- §2 구성품 및 보드
- §3 역할 배정 (스파이마스터 / 요원)
- §4 키 카드 및 선공 결정
- §5 게임 진행 — 스파이마스터 단서 규칙
- §6 추측 규칙 및 한도 (숫자+1)
- §7 카드 클릭 결과별 처리
- §8 턴 종료 조건
- §9 암살자 패배
- §10 승리 조건
- §11 리매치
- §12 구현 제약 (LAN 환경, 단서 검증 최소화)
- §13 구현 노트 (표준 룰 vs 본 구현 차이 목록)

---

### 테스트 계획

#### P1 — 게임 로직 단위 (`codenames/tests/game.unit.mjs`, 노드 러너)

| 테스트 ID | 내용 |
|---|---|
| CN-U-001 | 키 분배 검증: 선공팀 9 / 후공팀 8 / 중립 7 / 암살자 1, 합계 25 |
| CN-U-002 | firstTeam 랜덤성: 1000회 생성 시 red 비율 0.35~0.65 |
| CN-U-003 | 자기 팀 카드 적중 → guessesLeft 감소, 턴 유지 |
| CN-U-004 | guessesLeft === 0 소진 → endTurn 자동 호출 |
| CN-U-005 | 중립 카드 → 즉시 endTurn |
| CN-U-006 | 상대 팀 카드 → 상대 found +1 + endTurn |
| CN-U-007 | 암살자 → 현재 팀 패배, 상대 승리 |
| CN-U-008 | 자기 팀 전체 공개 → 해당 팀 승리 |
| CN-U-009 | 상대 팀 카드 적중으로 상대 전체 공개 완료 → 상대 즉시 승리 |
| CN-U-010 | submitClue: 자기 팀 아닌 경우 ERROR |
| CN-U-011 | guessCard: 요원 아닌 경우(스파이마스터 본인 팀) ERROR |
| CN-U-012 | 이미 공개된 카드 재클릭 → ERROR |
| CN-U-013 | 리매치 시 firstTeam 교체 |

#### P1 — WS 스모크 (`codenames/tests/smoke.mjs`, 노드 러너, 포트 3114)

| 테스트 ID | 내용 |
|---|---|
| CN-S-001 | 4인 JOIN → ROLE_STATE 정상 수신 |
| CN-S-002 | PICK_ROLE 중복 시도 → ERROR 반환 |
| CN-S-003 | 4 슬롯 채움 → canStart=true |
| CN-S-004 | 호스트 START_GAME → GAME_START + STATE 브로드캐스트 |
| CN-S-005 | 스파이마스터 STATE: myKey 전체 비 null |
| CN-S-006 | 요원 STATE: myKey 미공개 카드 null (마스킹 검증 핵심) |
| CN-S-007 | CLUE 송신 → guessesLeft = number+1 |
| CN-S-008 | GUESS → STATE 업데이트 |
| CN-S-009 | 암살자 GUESS → GAME_OVER reason='assassin' |
| CN-S-010 | 선공 팀 전체 공개 → GAME_OVER reason='completed' |
| CN-S-011 | END_TURN → 상대 팀 turnPhase='clue' |
| CN-S-012 | REMATCH 양쪽 동의 → REMATCH_START firstTeam 교체 |

#### P2 — Playwright E2E (`codenames/tests/e2e.spec.js`)

4개 브라우저 컨텍스트 시뮬 (레드 마스터, 레드 요원, 블루 마스터, 블루 요원).

| 시나리오 ID | 내용 |
|---|---|
| CN-E-001 | 4인 입장 → role_select UI 렌더 확인 |
| CN-E-002 | 팀/역할 배정 완료 → START_GAME → 보드 렌더 |
| CN-E-003 | 요원 화면에서 미공개 카드 색상 표시 없음 확인 (마스킹 검증) |
| CN-E-004 | 스파이마스터 화면에서 모든 카드 색상 표시 확인 |
| CN-E-005 | 단서 → 추측 → 자기 팀 카드 적중 → 계속 → 한도 소진 → 턴 종료 |
| CN-E-006 | 암살자 클릭 → GAME_OVER 모달 표시 |
| CN-E-007 | 승리 → GAME_OVER 모달 → 리매치 → REMATCH_START |

**codenames-duet 회귀 검증:** Playwright로 review-smoke 27/27 PASS 확인 (별도 포트 3098 구동 필요).

---

### 페이즈 분할

| 페이즈 | 내용 | visual_change | AD 계획 |
|--------|------|---------------|---------|
| P1 | `game.js` (키 생성·턴·승패) + `server.js` (WS, role_select, createApp) + `words.js` (복사) + `package.json` | none | AD 해당 없음 |
| P2 | `public/{index.html, client.js, style.css}` — role_select UI + 게임 보드 + 단서/추측 패널 + 결과 모달 | ui | AD 모드3 실행 (보드·역할 패널·팀 색상 레이아웃 검수) |
| P3 | `launcher/public/games.json` + `launcher/server.js` import (게임 카드 포탈 추가) | ui | AD 모드3 실행 (런처 포탈 11번째 카드 레이아웃 확인) |
| P4 | 룰북(`codenames/docs/RULEBOOK.md`) + 최종 QA (E2E 포함) | none | AD 해당 없음 |

---

## 수용 기준 (Acceptance Criteria)

- [ ] 런처 포탈에서 "코드네임" 카드가 11번째로 표시된다.
- [ ] 4인이 대기실 READY → `/codenames/`로 REDIRECT 된다.
- [ ] role_select 단계에서 팀/역할 선택 UI가 표시되고, 중복 배정이 서버에서 거부된다.
- [ ] 4 슬롯 채워진 후 호스트만 시작 버튼이 활성화된다.
- [ ] 게임 시작 후 요원 화면에서 미공개 카드의 색상이 보이지 않는다.
- [ ] 게임 시작 후 스파이마스터 화면에서 모든 카드 색상이 표시된다.
- [ ] 선공팀(9장 팀)이 보드 상단에 표시된다.
- [ ] 자기 팀 카드 적중 시 guessesLeft가 감소하고 턴이 유지된다.
- [ ] 중립 카드 적중 시 즉시 상대 팀 턴으로 전환된다.
- [ ] 암살자 클릭 시 해당 팀 즉시 패배 모달이 뜬다.
- [ ] 요원이 END_TURN으로 조기 종료할 수 있다.
- [ ] 게임 종료 후 "한 판 더" 양쪽 동의 시 선공 팀이 교체되고 새 게임이 시작된다.
- [ ] codenames-duet review-smoke 27/27 PASS (회귀 무영향).
- [ ] CN-U-001~013, CN-S-001~012, CN-E-001~007 전부 PASS.

---

## 범위 경계 (Out of Scope)

- AI 봇 구현 (`bot.js`) — 아키텍처 슬롯만 예약, 실구현 제외
- 강한 단서 자연어 검증 (보드 단어 포함 여부 등) — LAN 신뢰 환경 최소 검증만
- 관전 모드 (4명 이외 추가 접속자)
- 모바일 최적화 (기본 반응형 이상의 세밀한 터치 UX)
- 4인 이상 확장 (3:3 등)
- 타이머 / 제한 시간 기능
- 채팅 기능
- 단어팩 커스터마이징 UI

---

## Art Director 실행 계획

- visual_change: ui
- AD 모드 1 (에셋 컨셉): 해당 없음 — 신규 이미지 에셋 없음. 보드/카드 UI는 CSS로 처리.
- AD 모드 2 (에셋 검증): 해당 없음 — 에셋 생성 없음.
- AD 모드 3 (UI 레이아웃): 실행 예정
  - P2 완료 후: role_select UI + 게임 보드 레이아웃 + 역할 패널 + 레드/블루 팀 색상 테마 + 결과 모달 검수
  - P3 완료 후: 런처 포탈 11번째 카드 추가 후 그리드 레이아웃 + 카드 색상 검수
- 멀티 페이즈 AD 반복 계획:
  - P1: visual_change none → AD 생략
  - P2: visual_change ui → AD 모드3 필수 실행
  - P3: visual_change ui → AD 모드3 필수 실행 (P2에서 실행했다는 이유로 생략 불가)
  - P4: visual_change none → AD 생략

---

## 제약사항

- `codenames/` 디렉토리는 `codenames-duet/`과 완전 독립. 교차 import 금지(words.js 포함).
- `createApp` factory 패턴 및 noServer WS 모드는 듀엣과 동일하게 유지 (런처 라우팅 일관성).
- 플레이어 슬롯 구조에 `ws` 자리를 노출하되, 봇 삽입 코드는 주석으로만 예약.
- `package.json`에 `"type": "module"` 필수 (듀엣과 동일).
- 테스트 포트는 단독 실행 포트(3014)와 분리: smoke는 3114, E2E는 3014.
- CLAUDE.md 기준: 한국어 UI, 한국어 주석, JSDoc 블록 필수.

---

## 참고사항

- 듀엣 서버: `codenames-duet/server.js` — createApp factory, noServer WS, broadcastState 패턴 참조
- 듀엣 게임 로직: `codenames-duet/game.js` — shuffleInPlace, pickWords, snapshotForPlayer 패턴 참조
- 오목 리매치: `omok/server.js` — REMATCH/REMATCH_WAITING/REMATCH_START, swapColorsForRematch 패턴 참조
- 런처 대기실: `launcher/server.js` — GAME_APPS 등록, handleHttp/handleUpgrade 라우팅 참조
- 기존 게임 목록: `launcher/public/games.json` — 11번째 항목 추가 위치
- 단어팩 원본: `codenames-duet/words.js` — 380개 한국어 단어 (복사 대상)
