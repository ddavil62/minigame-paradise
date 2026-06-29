---
status: COMPLETED
completed: 2026-06-28
spec: .claude/specs/2026-06-28-codenames-bot-spec.md
scope: .claude/specs/2026-06-28-codenames-bot-scope.md
qa: .claude/specs/2026-06-28-codenames-bot-qa-report.md
note: QA가 발견한 DEFECT-1(스파이마스터 데드락)·GAP-1(런처 진입) 수정 후 최종 PASS. 봇 smoke 23×3 데드락 0 + bot-knowledge 22(590 커버리지 100%) + AI채우기 1+3/2+2/3+1 + 휴먼 회귀 무영향. AD3 APPROVED.
---

# Feature: 코드네임 클래식 AI 봇 (오프라인 태그맵 기반)

## 개요

코드네임 클래식(2:2 4인)에 완전 오프라인 AI 봇을 추가한다. 런타임 외부 의존성(LLM·임베딩·네트워크) 없이 빌드타임 생성 590단어 태그 정적맵(`bot-knowledge.js`)만으로 스파이마스터(단서 생성)·요원(추측) 양역할을 수행한다.

## 배경 및 동기

코드네임 클래식은 4인(2:2팀)을 요구해 LAN 친구가 부족할 때 진입 장벽이 높다. 봇으로 빈 슬롯을 채워 1~3인도 즉시 플레이할 수 있도록 한다. `botAvailable: false → true` 전환으로 런처 AI채우기도 활성화된다.

---

## 사전 확인 결과 (1단계 코드 분석)

### codenames/server.js

- **getBotUrl 훅**: `createApp(options)` 시그니처에 예약됨. 72행 `// const getBotUrl = options.getBotUrl || (() => null);` 주석 상태 — 이번 작업에서 언주석 + 구현 필요.
- **SLOTS 정의**: 53~58행 `[red/spymaster, red/operative, blue/spymaster, blue/operative]` 4개 고정.
- **role_select / PICK_ROLE 흐름**: `JOIN` → `PICK_ROLE(team, role)` → 중복 가드 후 `broadcastRoleState()` → 호스트 `START_GAME` → `playing` 진입. 봇은 이 표준 흐름 그대로 사용 가능.
- **좀비 정리**: 269~277행에서 `readyState <= 1` 필터로 기본 좀비 청소가 이미 적용됨. **그러나** 사람 disconnect 시 봇 슬롯을 동기적으로 `ws.terminate()`하는 #13 패턴은 미적용 → 이번 작업에서 close 핸들러에 추가 필요.
- **snapshotForPlayer 시그니처**: `snapshotForPlayer(state, role, playerId)` — `game.js`에서 import, 167~176행에서 role별 개별 전송.
- **FILL_WITH_AI 핸들러**: 없음 — 이번 작업에서 추가 필요(mode=ai 경유도 동시 지원).

### codenames/game.js

- **currentClue 이미 STATE에 포함**: `snapshotForPlayer` 335행 `currentClue: state.currentClue` — 스파이마스터·요원 양쪽 스냅샷에 이미 노출. **game.js·서버 STATE 구조 추가 변경 불필요**. 요원 봇이 단서 단어+숫자를 STATE에서 직접 읽을 수 있다.
- **keyCard 마스킹**: 스파이마스터는 `myKey = state.keyCard.slice()` (전체), 요원은 미공개 칸을 null로 마스킹. 요원 봇은 myKey로 자기 팀 카드를 직접 알 수 없음 — 태그 역조회로만 추측해야 함.
- **giveClue**: `giveClue(state, team, word, number)` — 단어 길이·정수 1~9 검증.
- **guessCard**: `guessCard(state, team, cardIndex)` — 정확히 미공개 카드 인덱스 전달. 결과가 correct면 guessesLeft 차감, 0이면 turnPhase→'clue'.
- **endTurnByPass**: 요원이 명시적 패스 시 호출.

### codenames/words.js

- **실제 단어 수**: `@fileoverview` 주석은 "약 380개"로 잘못 기재, **실제 배열은 590단어**. 직접 카운트 결과: 동물 70 + 음식 60 + 과일/채소 40 + 직업 40 + 사물 50 + 장소 40 + 자연/지형 40 + 신체 30 + 감정 20 + 운동/취미 30 + 색깔/모양 20 + 악기/예술 20 + 한국문화/역사 30 + 교통 20 + 미디어/판타지 30 + 추상/일반 30 + 도구/무기 20 = **590**.
- **카테고리 구조**: 17개 대분류. 태그맵 설계의 기준이 된다.

### omok/bot.js (참조 패턴)

- `spawn` → `--url ws://...?mode=bot` → `JOIN` → `JOINED(myId)` → `READY` → `GAME_START` → `STATE(handleState)` → act.
- 중복 행동 방지 키: `${currentTurn}|${moveCount}`.
- `scheduleRematch()`: GAME_OVER / REMATCH_WAITING 수신 시 0.5초 후 REMATCH 송신 + 10초 타임아웃 재송신.
- `process.exit(0)`: OPPONENT_LEFT 시에만.

### tetris-battle/server.js (#13 좀비 정리 패턴)

- connection 진입부: `!isBot`면 `readyState !== OPEN`인 죽은 슬롯만 선제 제거 (`ws.terminate()` + filter).
- close 핸들러: `!isBot`면 짝 봇 슬롯을 동기적으로 `players.filter(mode!=='bot')` + `botSlot.ws.terminate()` 후 `killBotChild()`.

### launcher/public/games.json

- codenames 항목: `"botAvailable": false` → `true` 전환 필요. `maxPlayers: 4, minPlayers: 4`.

---

## 요구사항

### 기능 요구사항

- [ ] (F1) `bot-knowledge.js`: 590단어 전체 태그맵 + 역조회 헬퍼, 커버리지 100% (미매핑 0)
- [ ] (F2) `bot.js`: URL `?mode=bot&team=X&role=Y` 파싱 → JOIN → PICK_ROLE 자동 수행
- [ ] (F3) 스파이마스터 봇: 자기팀 ≥2단어 공통 태그 단서, 암살자·상대팀 커버 태그 제외, 폴백 1:1
- [ ] (F4) 요원 봇: currentClue.word 태그 역조회 → 보드 미공개 단어 매칭 순위 → GUESS, 위험 감지 시 END_TURN
- [ ] (F5) `server.js`: getBotUrl 훅 활성화 + 다중 봇 spawn (Map<slotKey, ChildProcess>)
- [ ] (F6) `server.js`: mode=ai JOIN 또는 FILL_WITH_AI 수신 → 빈 슬롯 N개 → 봇 N개 spawn (중복 방지)
- [ ] (F7) `server.js`: 봇 disconnect 처리 + #13 좀비 정리 (사람 disconnect 시 봇 슬롯 동기 terminate)
- [ ] (F8) `public/` 클라이언트: 봇 슬롯 "AI" 뱃지 표시, "AI랑 시작" 진입점
- [ ] (F9) `launcher/public/games.json`: botAvailable false → true

### 비기능 요구사항

- [ ] 런타임 외부 의존성 0 (LLM·임베딩·HTTP 호출 금지)
- [ ] 봇 행동 딜레이 1~2초 기본, `CODENAMES_BOT_DELAY_MIN/RAND` 환경변수로 단축 가능 (테스트용)
- [ ] 미정의 메시지 수신 시 봇 프로세스 종료 없음 (default: console.warn + continue)
- [ ] 휴먼 4인 기존 동작 완전 보존 (mode=ai 없으면 봇 spawn 0)

---

## 구현 상세

### 수정/생성할 파일

| 파일 경로 | 작업 유형 | 설명 |
|---|---|---|
| `codenames/bot-knowledge.js` | 신규 | 590단어 태그맵 + 역조회 헬퍼 |
| `codenames/bot.js` | 신규 | WS 클라이언트 봇 (스파이마스터 + 요원 양역할) |
| `codenames/server.js` | 수정 | getBotUrl 훅 활성화, 다중 spawn, FILL_WITH_AI 핸들러, #13 좀비 정리 |
| `codenames/public/index.html` | 수정 | "AI랑 시작" 버튼 추가 |
| `codenames/public/css/style.css` | 수정 | AI 뱃지 스타일, "AI랑 시작" 버튼 스타일 |
| `codenames/public/js/main.js` | 수정 (또는 신규) | ROLE_STATE isBot 뱃지 렌더링, mode=ai 연결 진입점 |
| `codenames/public/js/network.js` | 수정 (또는 신규) | WS 경로에 mode 쿼리 부착, sessionStorage 백업 |
| `launcher/public/games.json` | 수정 | botAvailable false → true |
| `codenames/tests/bot-knowledge.test.js` | 신규 | 태그맵 커버리지 100% + 암살자 회피 단위 테스트 |
| `codenames/tests/bot-smoke.test.js` | 신규 | 봇 vs 봇 1판 완주 smoke (포트 3115) |

### 각 파일별 변경사항

---

#### A. `codenames/bot-knowledge.js` (신규) — P-A 페이즈

**역할**: 590단어 전체의 태그 배열을 보유하는 정적 데이터 모듈. 런타임 외부 요청 0.

```
export const TAG_MAP = {
  '강아지': ['동물', '포유류', '반려동물', '가축', ...],
  '독수리': ['동물', '조류', '하늘', '맹금류', '속도', '야생'],
  ...
}
```

**데이터 생성 전략**: 590단어를 인라인으로 작성하면 Coder 프롬프트 한계 초과. P-A를 독립 서브에이전트로 분리해 words.js를 100단어씩 청크로 나눠 일관된 태그 체계로 태깅한다. 이 스펙의 태그 체계(taxonomy) 가이드라인을 코더 프롬프트에 포함한다.

**태그 체계 (taxonomy) 가이드라인**:

최상위 카테고리 (동물·음식 등 대분류를 단어에 항상 부여):
- `동물` — 모든 생물: 포유류·조류·어류·곤충·파충류
- `포유류`, `조류`, `어류`, `곤충`, `파충류`, `양서류` — 동물 세분류
- `음식` — 먹거리 전체
- `한식`, `양식`, `음료`, `디저트`, `고기`, `채소`, `과일`, `조미료` — 음식 세분류
- `직업` — 모든 직업/역할
- `전문직`, `예술직`, `서비스직`, `농업어업` — 직업 세분류
- `사물` — 물건
- `도구`, `문구`, `전자기기`, `의류`, `액세서리`, `무기`, `주방용품` — 사물 세분류
- `장소` — 공간/건물/지역
- `교육시설`, `의료시설`, `문화시설`, `상업시설`, `종교시설`, `생활공간`, `군사시설` — 장소 세분류
- `자연` — 자연환경
- `지형`, `날씨`, `우주`, `물관련`, `식물`, `지질` — 자연 세분류
- `신체` — 사람 몸 부위
- `내장기관`, `외부신체` — 신체 세분류
- `감정` — 느낌/심리 상태
- `긍정감정`, `부정감정` — 감정 세분류
- `스포츠`, `취미`, `예술활동`, `보드게임카드게임` — 활동
- `색깔`, `모양` — 시각 속성
- `악기`, `음악`, `공연` — 소리/음악
- `한국문화`, `역사`, `전통놀이`, `명절` — 문화
- `교통수단`, `육상교통`, `해상교통`, `항공교통` — 이동수단
- `미디어`, `판타지생물`, `마법판타지`, `보물귀중품` — 창작/상상
- `추상개념`, `시간`, `전쟁무력`, `가치관` — 추상
- `왕족귀족`, `계급` — 신분

교차 속성 태그 (의미론적 연결을 위한 cross-cutting):
- `하늘` — 하늘에 있거나 나는 것 (독수리, 비행기, 구름, 바람, 태양, 혜성 등)
- `바다` — 바다와 관련 (고래, 상어, 요트, 갈매기, 항구 등)
- `야생` — 야생 동물/자연 (호랑이, 사자, 늑대 등)
- `반려동물`, `가축` — 인간과 함께 사는 동물
- `맹금류` — 독수리, 매 등 사냥하는 새
- `속도` — 빠른 것 (독수리, 치타류, 자동차, 기차, 로켓 등)
- `날카로움`, `위험` — 위험/공격적 의미 (뱀, 악어, 검, 총, 폭탄 등)
- `왕국` — 왕, 왕비, 공주, 왕자, 성, 기사, 왕관 등
- `불` — 불/열/에너지 (화산, 온천, 폭탄, 불꽃 등)

**다중 태그 원칙**: 단어 하나에 보통 3~7개 태그. 상위 분류 → 하위 분류 → 교차 속성 순으로 부여. 예:
- `독수리` → `['동물', '조류', '야생', '하늘', '맹금류', '속도']`
- `갈비탕` → `['음식', '한식', '고기', '국물요리']`
- `공항` → `['장소', '교통시설', '항공교통']`
- `왕` → `['직업', '왕족귀족', '왕국', '역사']`

**역조회 헬퍼 함수**:
```javascript
export function tagsForWord(word)    // TAG_MAP[word] || []
export function wordsForTag(tag)     // Object.keys(TAG_MAP).filter(w => TAG_MAP[w].includes(tag))
export function commonTags(words)    // 교집합: words의 모든 단어가 공유하는 태그 배열
export function allTags()            // Set<string> — 전체 태그 목록
```

**커버리지 검증 방법**: 테스트(`bot-knowledge.test.js`)에서 `words.js`의 `WORDS` 배열을 import, 각 단어가 `TAG_MAP`에 존재하는지 + 태그 배열이 비어있지 않은지 단언. 미매핑 단어 0 = AC-7.

---

#### B. `codenames/bot.js` (신규) — P-B 페이즈

**WS 연결 및 역할 파싱**:
```
argv: --url ws://localhost:3014/codenames/ws?mode=bot&team=red&role=spymaster
```
- URL에서 `team`(red|blue), `role`(spymaster|operative) 파싱 → 행동 분기 결정.
- 이름: `'AI 빨강 스파이마스터'` / `'AI 빨강 요원'` / `'AI 파랑 스파이마스터'` / `'AI 파랑 요원'` (한글 팀명).

**연결 흐름**:
1. `open` 이벤트: `JOIN { name: 'AI 빨강 스파이마스터' }` 송신.
2. `JOINED` 수신: `playerId` 저장, `PICK_ROLE { team, role }` 즉시(200ms 지연) 송신.
3. `ROLE_STATE` 수신: 무시(역할 선택 UI용 — 봇은 이미 role 고정).
4. `GAME_START` 수신: `lastActedFor` 초기화.
5. `STATE` 수신: `handleState(msg)` 호출.
6. `GAME_OVER` 수신: `scheduleRematch()` (0.5s 후 REMATCH 송신, 10s 타임아웃 재송신 1회).
7. `OPPONENT_LEFT` 수신: `ws.close()` → `process.exit(0)`.
8. `ERROR` 수신: 방 가득 / 역할 중복이면 `ws.close()`, 아니면 `lastActedFor = null` + 계속.
9. `default`: `console.warn` + 계속 (process.exit 금지).

**중복 행동 방지 키**:
- 스파이마스터: `${currentTeam}|${turnPhase}|${redFound}|${blueFound}`
- 요원: `${currentTeam}|${turnPhase}|${guessesLeft}|${revealedCount}` (revealedCount = revealed.filter(x=>x!==null).length)

**행동 딜레이**: 기본 1000~2000ms. 환경변수 `CODENAMES_BOT_DELAY_MIN`(기본 1000ms), `CODENAMES_BOT_DELAY_RAND`(기본 1000ms)로 테스트 단축 가능.

**스파이마스터 알고리즘** (`role==='spymaster'` && `currentTeam===myTeam` && `turnPhase==='clue'`):
1. 입력: `STATE.words[25]`, `STATE.myKey[25]` (전체 키카드 색상), `STATE.revealed[25]`.
2. 자기팀 미공개 단어 목록: `myUnrevealed = words.filter((w,i) => myKey[i]===myTeam && revealed[i]===null)`.
3. 위험 단어 목록: `dangerWords = words.filter((w,i) => (myKey[i]==='assassin' || myKey[i]===oppTeam) && revealed[i]===null)`.
4. 후보 태그 탐색:
   - 전체 태그 목록(`allTags()`) 순회.
   - 각 태그 T에 대해 `covered = myUnrevealed.filter(w => tagsForWord(w).includes(T))`.
   - `covered.length < 2`이면 스킵.
   - `dangerWords.some(w => tagsForWord(w).includes(T))`이면 스킵 (위험 오염).
   - 유효 태그: `(score=covered.length, tag=T)` 기록. 동점 시 더 일반적인 태그(wordsForTag 크기 작은 것) 우선.
5. 최다 커버 유효 태그 선택 → `CLUE { word: bestTag, number: bestScore }`.
6. **폴백** (유효 태그 0개): 자기팀 단어 중 암살자와 교집합 태그가 없는 태그를 찾아 `number=1`로 CLUE. 그마저 없으면 임의 자기팀 단어의 첫 번째 태그 사용.
7. 단서 단어가 보드에 있는 단어와 동일한 경우 giveClue가 ERROR 반환 시 `lastActedFor` 리셋 + 다음 후보 선택 (재시도).

**요원 알고리즘** (`role==='operative'` && `currentTeam===myTeam` && `turnPhase==='guess'`):
1. 입력: `STATE.currentClue.word`(단서), `STATE.guessesLeft`, `STATE.words[25]`, `STATE.revealed[25]`, `STATE.myKey[25]`(공개 카드만 색상, 미공개=null).
2. 단서 태그: `clueTags = tagsForWord(currentClue.word)` — 단서 단어가 TAG_MAP에 없으면 빈 배열(폴백: 랜덤 미공개 카드 1개 추측).
3. 미공개 카드 중 매칭 점수 계산: `score(i) = intersection(tagsForWord(words[i]), clueTags).length`.
4. 위험 가중치 패널티: `myKey[i]`가 null이 아닌(이미 공개) 카드는 제외. 이전 guess에서 공개된 결과가 'assassin'/'opponent'/'neutral'이면 해당 카드와 같은 태그를 가진 미공개 카드 점수를 하향 조정(-0.5×score).
5. 후보 정렬(점수 내림차순). `score === 0`인 카드는 추측 안 함.
6. 최상위 후보 → `GUESS { cardIndex }`.
7. 다음 STATE 대기:
   - `turnPhase`가 `'clue'`로 바뀌거나 `currentTeam !== myTeam`이면 턴 종료 → 행동 중단.
   - 여전히 내 턴(`turnPhase === 'guess'`): 다음 후보 추측(dedup 키가 바뀌어 handleState 재진입).
8. **END_TURN 트리거**: 남은 후보가 없거나 `guessesLeft === 1`이고 최상위 후보 점수가 1 이하면 `END_TURN` 송신.

---

#### C. `codenames/server.js` 수정 — P-B 페이즈

**getBotUrl 훅 활성화 + 다중 봇 spawn**:

```javascript
// 기존 (주석):
// const getBotUrl = options.getBotUrl || (() => null);

// 변경 후:
const getBotUrl = typeof options.getBotUrl === 'function'
  ? options.getBotUrl : (() => null);

// 봇 자식 프로세스 Map: key = 'red-spymaster' | 'red-operative' | 'blue-spymaster' | 'blue-operative'
const botChildren = new Map();
// 중복 spawn 방지 Set (spawn 예약 중인 슬롯)
const botSpawnPending = new Set();
```

**bot spawn 함수 (새로 추가)**:
```javascript
function spawnBotsForEmptySlots() {
  const url = getBotUrl();
  if (!url) return;
  for (const slot of SLOTS) {
    const slotKey = `${slot.team}-${slot.role}`;
    // 이미 플레이어가 점유하거나 spawn pending/완료 슬롯은 건너뜀
    const occupied = players.some(p => p.team === slot.team && p.role === slot.role);
    if (occupied || botChildren.has(slotKey) || botSpawnPending.has(slotKey)) continue;
    botSpawnPending.add(slotKey);
    // 슬롯 간 100~200ms 간격으로 spawn (playerId 충돌 방지)
    const delay = [...botSpawnPending].indexOf(slotKey) * 150;
    setTimeout(() => {
      const botUrl = `${url}&team=${slot.team}&role=${slot.role}`;
      const child = spawn(process.execPath, [botPath, '--url', botUrl], { detached: false, stdio: 'ignore' });
      child.on('exit', () => { botChildren.delete(slotKey); botSpawnPending.delete(slotKey); });
      botChildren.set(slotKey, child);
      botSpawnPending.delete(slotKey);
    }, delay);
  }
}
```

**killAllBots 함수**:
```javascript
function killAllBots() {
  for (const [key, child] of botChildren) {
    if (child && child.exitCode === null) child.kill();
  }
  botChildren.clear();
  botSpawnPending.clear();
}
```

**JOIN 핸들러 확장**:
- `mode=ai` 파라미터 감지 (`req.url`의 쿼리 파싱, connection 시 추출 후 player 객체에 저장).
- `JOIN` 수신 시 `wsMode === 'ai'`이면 200ms 후 `spawnBotsForEmptySlots()` 호출.

**FILL_WITH_AI 메시지 핸들러 추가** (role_select 단계):
```
case 'FILL_WITH_AI': {
  if (phase !== 'role_select') break;
  if (!isAllSlotsFilledByHumans()) spawnBotsForEmptySlots();
  break;
}
```

**connection 핸들러 좀비 정리 강화** (#13 패턴):
- 봇이 아닌(mode!=='bot') 플레이어 연결 시, 기존 `readyState <= 1` 필터 이전에 `readyState !== OPEN` 슬롯을 선제 terminate.

**close 핸들러 봇 정리 추가**:
```javascript
ws.on('close', () => {
  players = players.filter(p => p.id !== player.id);
  // 사람(비봇)이 끊기면 봇 슬롯 동기 정리 (#13)
  if (wsMode !== 'bot') {
    for (const p of players.filter(q => q.mode === 'bot')) {
      p.ws.terminate();
    }
    players = players.filter(p => p.mode !== 'bot');
    killAllBots();
  }
  // ... 기존 로직 유지
});
```

**wsMode 저장**: connection 핸들러 진입 시 URL에서 `mode` 쿼리 파싱 → `player.mode = wsMode` 로 Player 객체에 추가.

**Player typedef 확장**:
```
@property {'human'|'ai'|'bot'} mode - WS 접속 모드
```

**ROLE_STATE 봇 표시**: `broadcastRoleState`에서 player 목록에 `isBot: player.mode === 'bot'` 필드 추가. 클라이언트가 이 값으로 AI 뱃지 표시.

**resetRoom 확장**: `killAllBots()` 호출 추가.

**참고**: `currentClue`는 `snapshotForPlayer` 335행에 이미 포함 — 변경 불필요.

---

#### D. `codenames/public/` 클라이언트 수정 — P-C 페이즈

**`public/index.html`**:
- 대기 화면에 "🤖 AI랑 시작" 버튼 추가 (다른 게임과 동일 패턴).
- 버튼 클릭 → `sessionStorage('codenames:mode', 'ai')` 저장 + `?mode=ai` 쿼리로 재접속(또는 WS 재연결).

**`public/js/network.js`** (또는 기존 WS 연결 코드):
- WS 연결 시 `sessionStorage('codenames:mode')` 읽어 `?mode=ai` 쿼리 부착.
- 새로고침 시 mode 유실 방지.

**`public/js/main.js`** (또는 관련 클라이언트 파일):
- `ROLE_STATE` 수신 시 `isBot: true`인 플레이어 슬롯에 "AI" 뱃지(아이콘 또는 텍스트) 표시.
- 봇 이름 "AI 빨강 스파이마스터" 등이 이미 표시되므로 최소 변경으로 처리 가능.
- `currentClue` 표시: 이미 구현되어 있으면 무변경. 없으면 STATE.currentClue.word + number를 요원 화면에 표시.

**`public/css/style.css`**:
- `.ai-badge` 스타일 (예: "🤖" 아이콘 또는 "AI" 레이블, role_select 슬롯 내 우상단 위치).
- "AI랑 시작" 버튼 스타일 (다른 게임과 일관성).

---

#### E. `launcher/public/games.json` 수정 — P-C 페이즈

```json
{
  "id": "codenames",
  ...
  "botAvailable": true,   // false → true
  "minPlayers": 4,
  "maxPlayers": 4
}
```

**4인 AI채우기 런처 동작 확인**: 런처 FILL_WITH_AI는 `minPlayers(4)` 충족 시 trigger → REDIRECT with `mode=ai`. 빈 슬롯 N개는 게임 서버가 `spawnBotsForEmptySlots()`로 처리. 런처 측 추가 변경 불필요.

---

### launcher/server.js 연동 확인 (이미 적용된 패턴)

launcher가 codenames 게임 앱을 `createApp({ getBotUrl: () => ... })` 형식으로 import해야 한다. 기존 launcher에서 codenames를 어떻게 import하는지 확인 후, getBotUrl을 전달하는 코드 추가 필요. (다른 봇 게임이 같은 방식으로 등록되어 있음 — launcher/server.js에서 omok/yutnori 등록 패턴 참조.)

---

## 페이즈 분할

### P-A: bot-knowledge.js 데이터 생성 (전용 서브에이전트)

- 목표: 590단어 × 3~7태그 매핑, 태그 체계 일관성.
- 방법: words.js를 100단어씩 6청크로 나눠 각 청크를 별도 서브에이전트가 태깅. 마지막에 커버리지 검증 스크립트 실행(미매핑 0 확인).
- 산출물: `codenames/bot-knowledge.js`, `codenames/tests/bot-knowledge.test.js`.
- visual_change: none — AD 불필요.

### P-B: bot.js + server.js 확장

- 목표: 봇 WS 클라이언트 + 서버 다중 spawn + 좀비 정리.
- 산출물: `codenames/bot.js`, `codenames/server.js` 수정.
- visual_change: none — AD 불필요.

### P-C: public/ UI + games.json

- 목표: AI 뱃지, "AI랑 시작" 버튼, botAvailable 활성화.
- 산출물: `codenames/public/` 수정, `launcher/public/games.json` 수정.
- visual_change: ui — AD 모드3 필수.

### P-D: QA

- 봇 smoke(포트 3115), 휴먼 회귀(codenames smoke 65 + E2E 12), AI채우기 시나리오.
- visual_change: none — AD 불필요.

---

## 수용 기준 (Acceptance Criteria)

- [ ] (AC-1) `node codenames/tests/bot-knowledge.test.js` → 미매핑 단어 0건, 빈 태그 배열 0건
- [ ] (AC-2) 스파이마스터 봇이 내놓는 단서 태그가 암살자 단어의 태그와 교집합 없음 (단위 테스트)
- [ ] (AC-3) 스파이마스터 봇이 내놓는 단서 숫자가 실제 커버 단어 수(≥2)와 일치
- [ ] (AC-4) 요원 봇이 단서 태그를 역조회해 보드 단어를 추측함 (GUESS cardIndex 가 태그 매칭 상위 단어)
- [ ] (AC-5) bot smoke(CBOT-001~005, 포트 3115): 봇 vs 봇 1판 완주, 암살자 즉사 없이 정상 승패
- [ ] (AC-6) AI채우기 4인 슬롯 배정: 1인+3봇 / 2인+2봇 / 3인+1봇 모두 정상 시작
- [ ] (AC-7) `codenames smoke 65` 전체 PASS (휴먼 회귀 무영향)
- [ ] (AC-8) `codenames E2E 12` 전체 PASS (4 브라우저 컨텍스트 회귀)
- [ ] (AC-9) `games.json botAvailable === true` 확인
- [ ] (AC-10) 봇 없는 4인 휴먼 게임 진행 시 봇 프로세스 spawn 0
- [ ] (AC-11) 사람 disconnect 시 봇 슬롯 정리 + 재접속 시 "방이 가득 찼다" ERROR 없음 (#13 검증)

---

## 범위 경계 (Out of Scope)

- LLM API·임베딩·외부 네트워크 의존성
- 명시적 난이도 단계(쉬움/어려움) UI
- 봇 자기 학습 또는 전략 강화
- codenames-duet AI 봇
- 5인 이상 확장
- 봇 채팅/메시지 기능
- 태그맵 편집 UI
- 봇이 START_GAME을 직접 발송 (항상 인간 호스트가 담당)
- words.js `@fileoverview` 주석 "약 380개" 오류 정정 (별도 문서 이슈)

---

## Art Director 실행 계획

- visual_change: ui
- AD 모드 1 (에셋 컨셉): 해당 없음 — 신규 이미지 에셋 없음 (CSS/DOM으로만 처리)
- AD 모드 2 (에셋 검증): 해당 없음 — 위와 동일
- AD 모드 3 (UI 레이아웃): P-C 완료 후 실행 예정 — AI 뱃지 위치/크기, "AI랑 시작" 버튼 디자인, role_select 화면 일관성 검수
- 멀티 페이즈 시 AD 반복 계획:
  - P-A (bot-knowledge): none — AD 생략
  - P-B (bot.js + server.js): none — AD 생략
  - P-C (public/ + games.json): ui — AD 모드3 실행
  - P-D (QA): none — AD 생략

---

## 제약사항

- `bot.js`는 `bot-knowledge.js`만 import. `game.js`·`server.js`·기타 서버 모듈 import 금지 (외부 의존성 0 원칙).
- `bot-knowledge.js`는 Node 내장 모듈·외부 npm 패키지 import 금지. 순수 `export const TAG_MAP = {...}` 정적 데이터만.
- 봇 spawn은 `mode=ai` 또는 `FILL_WITH_AI` 트리거 없이는 절대 발생하지 않음 (휴먼 4인 보호).
- 테스트 포트: bot-knowledge 3114, bot-smoke 3115. 기존 codenames 3014와 충돌 금지.
- CODENAMES_BOT_DELAY_MIN/RAND 환경변수가 없으면 기본값 1000ms/1000ms 사용.
- 봇은 OPPONENT_LEFT 이외의 이유로 `process.exit()` 호출 금지. 미정의 메시지에 죽지 않음.
- launcher/server.js의 codenames import 구문에 `getBotUrl` 옵션 전달 필수. 미전달 시 봇 spawn 불가.

---

## 참고사항

- **currentClue 이미 노출**: `codenames/game.js` `snapshotForPlayer` 335행. game.js 수정 불필요.
- **words.js 실제 단어 수**: 590. `@fileoverview` "약 380개"는 오기재.
- **참조 봇 구현**: `omok/bot.js`(중복행동 방지·scheduleRematch·process.exit 패턴), `yutnori/bot.js`(actionEpoch·__isMain·delayMin/Rand 환경변수).
- **참조 좀비 정리**: `tetris-battle/server.js` 443~464행 (#13 동기 terminate 패턴).
- **참조 다중 spawn**: 기존 게임은 단일 botChild. 코드네임은 최대 3 봇 → Map 구조 신규 설계.
- **회귀 게이트**: codenames smoke 65 + E2E 12 현행 유지. codenames-duet smoke 27 무영향 확인.
- **scope 문서**: `.claude/specs/2026-06-28-codenames-bot-scope.md`
