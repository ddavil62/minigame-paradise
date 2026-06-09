# Changelog

## [2026-06-08] - 조커 라운드 종료 불가 수정 — 손+credit 비대칭 시 한쪽 종료 + 잔여 자동 정산

사용자 신고: 본인 시작 손에 조커 1장 + 게임 중 더미 뒤집기로 조커 1장 더 받음(케이스 B). 막판에 본인 손 3장 / 상대 손 0장 상태로 **라운드 종료가 트리거되지 않아 게임 진행 불가**(상대가 카드 낼 수 없어 멈춤).

### 진짜 원인
`game.js` `finishTurn` 라운드 종료 조건이 양쪽 모두 `손+credit=0`이어야만 발동. 폭탄 보너스 권리(`bombDeckCredit`)의 "기회 보존의 법칙"이 양쪽 잔여 동기화를 전제로 설계됐는데, **조커 케이스 B로 한쪽 손이 +1 누적되면 동기화가 영구히 깨져 라운드 종료가 영구 불가능**.

### 수정 (`game.js`)
- `finishTurn` 종료 조건 변경 — **한쪽의 `손+credit=0`이고 상대의 `credit=0`이면 자동 종료**. 폭탄 권리 우선이라 한쪽 0이어도 상대 credit > 0이면 보너스 뒤집기 끝까지 진행.
- 라운드 종료 시 잔여 손 카드를 본인 captured로 자동 이동하는 `flushHandsToCaptured(g)` 신규 헬퍼. 조커(`type='joker'`)는 그대로 push되어 `score.js`가 `piCount += joker.length * 2`로 자동 처리, 일반 카드는 type별로 자동 분류. **`score.js` 무수정**.
- 종료 분기에서 정산 후 점수 비교: 7점 이상인 쪽이 있으면 승자, 둘 다 7점 미만이면 무승부.
- `finishTurn` 자동 스톱 조건(7점 도달 시) 보정: 상대 손+credit=0 + 본인 credit=0 케이스도 자동 스톱 후보(`oppStuckAndSelfNoCredit`).

### 변경 (`public/index.html`)
- 캐시 버스터 `client.js?v=37` → `v=38` (라운드 종료 트리거 변경에 따른 클라이언트 강제 새로고침 신호).

### 추가 (`tests/joker-adhoc.mjs`)
- **JOKER-014**: p1 손 0 + p2 손 3장(조커 2 + 일반 1) + credit 0 → 라운드 자동 종료, 잔여 captured 이동, 무승부.
- **JOKER-015**: 케이스 B 조커 잔여 → 라운드 종료 시 captured 이동 후 `piCount` +2 반영.
- **JOKER-016**: p1 손 0 + credit 2 + p2 손 0 + credit 0 → 종료 X (폭탄 권리 우선), turn=p2로 이동.
- **JOKER-017**: 양쪽 손+credit 모두 0 → 정상 무승부 종료 (기존 동작 회귀).

### 검증
- `node tests/joker-adhoc.mjs`: **19/19 PASS** (JOKER-001~017 + REG-DIST + REG-BOMB-SANGTONG).
- `node tests/sseul-adhoc.mjs`: **11/11 PASS** (회귀 게이트).
- `node tests/bombdup-adhoc.mjs`: **7/7 PASS** (회귀 게이트).
- `node tests/floor-joker-smoke.mjs 3098`: **5/5 PASS** (attempt#3,#4에서 실제 조커 자동 획득 케이스 관찰).
- 합계: **42/42 PASS** (조커 19 + 쓸 11 + 폭탄복제 7 + 통합 smoke 5).
- 사용자 실서버(포트 3000, PID 61956)는 본 작업 중 건드리지 않음. 작업용 서버는 3098에서 별도 기동·종료. 사용자가 다음 라운드 사이에 launcher 재시작 + 친구 Ctrl+F5.

### 비고
- 신규 종료 조건은 폭탄 권리(credit)를 명시적으로 우선시 — 한쪽이 손+credit=0이어도 상대가 보너스 뒤집기 권리를 갖고 있으면 그 권리 소모를 끝까지 보장.
- 양쪽 모두 0+0+0+0 케이스에서도 이전과 동일하게 `endRoundDraw` 호출 (JOKER-017 회귀 보장).
- `flushHandsToCaptured`는 손 0이면 no-op이라 양쪽 모두 0 정상 종료 케이스에서 부작용 없음.

---

## [2026-06-03] - 조커 룰 정정 — 바닥 조커는 선공자 자동 획득 (데드 슬롯 → 선공 몫)

직전 조커 2장 룰 추가 시 "바닥 깔린 조커 = 데드 슬롯" 보수적 해석을 사용했으나, 사용자가 정확한 룰을 확정: **바닥에 깔린 조커는 선공자 몫**. 게임 시작 직후 분배 단계에서 즉시 선공(currentTurn 첫 플레이어) captured로 이동.

### 룰 (사용자 확정)
- 분배 직후 바닥(`floor`)에 깔린 조커 N장(0/1/2)을 **선공자(firstTurn) `captured.pi` 더미로 자동 이동**.
- 점수는 score.js의 기존 계산 그대로 — 1장당 피 2장 가치.
- **추가 보너스 없음**: 더미 뒤집기 X, 보너스 턴 X, 상대 피 뺏기 X. 첫 턴은 정상 진행.
- 케이스: 0장(변동 없음) / 1장(선공 +1) / 2장(선공 +2).

### 변경 (`game.js`)
- `applyFloorJokerToFirst(game, firstTurn)` 신규 export — `startRound`에서 분배 직후, 사통 검사 직전 호출.
- 0장이면 무동작(lastAction 미변경). 1장 이상이면 floor에서 제거 + `captured[firstTurn]`에 push + `lastAction = { kind: 'floor_joker_to_first', player, count, jokers }`.

### 변경 (`public/client.js`, `public/index.html`)
- `maybeShowActionToast`에 `floor_joker_to_first` 분기 추가 → 토스트 "선공 바닥 조커 N장 획득!".
- 캐시 버스터 `client.js?v=36` → `v=37`.

### 추가 (`tests/`)
- `tests/joker-adhoc.mjs`에 JOKER-010~013 4건 추가 (조커 0/1/2장 + 보너스 없음 검증). 11 → **15건 전부 PASS**.
- `tests/sseul-adhoc.mjs` REG-G-01 갱신 — `floor.length === 8` → `6 ≤ floor ≤ 8` + 카드 총 50장 일관성 + captured 일치 검증.
- `tests/game.unit.spec.js` G-01 동일 갱신 (Playwright spec).
- `tests/floor-joker-smoke.mjs` 신규 — WebSocket 5회 시도, 1회 이상 실제 조커 자동 획득 케이스 관찰(STATE 검증).

### 검증
- `node tests/joker-adhoc.mjs`: **15/15 PASS** (JOKER-001~013 + REG-DIST + REG-BOMB-SANGTONG).
- `node tests/sseul-adhoc.mjs`: **11/11 PASS** (회귀 게이트).
- `node tests/bombdup-adhoc.mjs`: **7/7 PASS** (회귀 게이트).
- `node tests/floor-joker-smoke.mjs 3098`: **5/5 PASS** (attempt#5에서 실제 `cap.p1=1(m00_joker_b)` 관찰).
- 합계: **38/38 PASS** (조커 15 + 쓸 11 + 폭탄복제 7 + 통합 smoke 5).
- 사용자 실서버(포트 3000, PID 73716)는 본 작업 중 건드리지 않음. 사용자가 다음 라운드 사이에 재시작하면 적용. 친구는 Ctrl+F5.

### 비고
- `applyFloorJokerToFirst`는 export로 분리해 단위 테스트의 결정성을 확보(셔플 mock 불필요). 운영 로직은 `startRound`에서 1회만 호출.
- `lastAction.kind = 'floor_joker_to_first'`는 사통 검사로 phase가 `awaiting_sangtong`으로 바뀌어도 보존됨. 클라이언트가 STATE 수신 즉시 토스트 1회 표시.
- 양쪽이 바닥 조커를 받지 않으므로(선공만) 공정성은 선공 선택 알고리즘(직전 라운드 패자 선공)이 보장.

---

## [2026-06-03] - 조커 2장 룰 추가 (덱 50장 + 케이스 A/B + 피 +2)

표준 화투 48장에 **조커 2장**을 추가하여 덱 50장 룰을 신설. 룰북 §13 보강 7건째.

### 정의
- **조커 2장** (`m00_joker_a`, `m00_joker_b`, `type='joker'`, `month=0`): 어떤 월과도 매치되지 않음. captured 진입 시 **피 더미에 추가되며 1장당 피 2장 가치**(쌍피와 동일). 광/끗/띠 묶음에는 영향 없음.
- **셔플 분배**: 조커도 셔플에 포함 → 손/바닥/더미 어디든 갈 수 있음.
- **케이스 A (손에서 조커 내기)**: ① 상대 피 1장 → 본인 captured(없으면 스킵) ② 조커 → 본인 captured ③ 더미 매치 단계 완전 스킵 ④ 더미 위 1장을 본인 손에 보충(뒤집기 아님 — 손 갯수 유지, 더미 빈 경우 스킵) ⑤ 턴 종료, 보너스 턴 없음.
- **케이스 B (더미 뒤집은 게 조커)**: ① 상대 피 1장 → 본인 captured ② 조커 → 본인 손 ③ 더미 한 번 더 뒤집기(재귀 — 또 조커면 또 케이스 B). 보너스 뒤집기(`flipDeckBonus`) 경로도 동일.
- **바닥 깔린 조커**: 매치 대상 아니므로 게임 끝까지 바닥에 잔존(데드 슬롯). 사용자 명세 시 후속 수정.

### 변경 (`cards.js`)
- `buildDeck`: 화투 48장 빌드 후 `m00_joker_a`, `m00_joker_b` 2장 push.
- `deckStats.byType`에 `joker` 키 추가.
- `typeLabel`에 `joker → '조커'` 매핑.

### 변경 (`game.js`)
- `playCardSteps`: 손에서 낸 카드가 `type === 'joker'`이면 케이스 A 분기로 단축 처리(매치/덱뒤집기 스킵).
- `drawAndResolve`: 더미에서 뽑은 카드가 조커이면 케이스 B 처리(피 빼앗기 + 손에 추가 + 재귀 뒤집기).
- `flipDeckBonus`: 보너스 뒤집기 경로에서도 동일 케이스 B 처리.
- `snapshotForPlayer.bombableMonths`: month=0(조커) 제외 안전망.
- 신규 `lastAction.kind`: `joker_play`(케이스 A), `joker_flip`(케이스 B).

### 변경 (`score.js`)
- `calculateScore`: `joker = pool.filter(c => c.type === 'joker')` 추출 후 `piCount += joker.length * 2`. 광/끗/띠 점수에는 영향 없음.

### 변경 (`public/client.js`, `public/style.css`, `public/index.html`)
- `makeCardEl`: `card.type === 'joker'` 시 검은 배경 + 골드 별(★) + JOKER 라벨 전용 시각화(`.joker-card`, `.joker-star`, `.joker-label`).
- `typeLabel(card)`: joker → '조커' 매핑 추가.
- `maybeShowActionToast`: `joker_play` → "조커! (피 +2)", `joker_flip` → "조커! (손으로)" 토스트 추가.
- `style.css`: `.joker-card` 다크 배경 + 골드 펄스 애니메이션(손에 있을 때 약한 펄스로 시선 유도).
- 캐시 버스터 `client.js?v=35` → `v=36`, `style.css?v=18` → `v=19`.

### 추가 (`tests/`)
- `tests/joker-adhoc.mjs` 신규 — JOKER-001~009 + REG-DIST + REG-BOMB-SANGTONG 11건. Playwright nested `node_modules` 충돌 회피용 ad-hoc Node 직접 실행 스크립트.
- `tests/sseul-adhoc.mjs` REG-G-01 갱신: 더미 20 → 22장 (50-10-10-8).
- `tests/game.unit.spec.js` G-01 갱신: 더미 20 → 22장.
- `smoke-test.js` 갱신: 카드 총합 검증 48 → 50, 포트 3003 → 3099.

### 검증
- `node tests/joker-adhoc.mjs`: **11/11 PASS** (덱분포/케이스A/케이스A피0/케이스B/케이스B재귀/매치차단/점수/보너스경로/더미빈경우/회귀분포/회귀안전망).
- `node tests/sseul-adhoc.mjs`: **11/11 PASS** (회귀 게이트).
- `node tests/bombdup-adhoc.mjs`: **7/7 PASS** (회귀 게이트).
- 서버 통합(작업용 3099 포트 smoke): **STATE 카드 총합 50/50 정상**, 손 10+10/바닥 8/덱 22.
- 시각 확인: 조커 카드 검은 배경 + ★ + JOKER 라벨로 화투와 명확히 구별 (스크린샷 `tests/screenshots/joker-p1-hand.png`).
- 사용자 실서버(포트 3000, PID 73716)는 본 작업 중 건드리지 않음. 사용자가 다음 라운드 사이에 재시작 시 적용. 친구는 Ctrl+F5.

### 비고
- 조커는 2장뿐이라 사통(같은 월 4장 손) 트리거 자연 차단.
- 폭탄 검사도 month=0 제외 안전망 추가(자연 차단 + 명시).
- **바닥에 떨어진 조커는 게임 끝까지 잔존(데드 슬롯)** — 가장 보수적 해석. 사용자 다른 처리 원하면 후속.
- 9월 술잔 끗/쌍피 선택과 별개로 동작(서로 영향 없음).

### 참고
- 룰북 §13 7건째 항목: `minigames/matgo/CLAUDE.md` 갱신 동반.

---

## [2026-06-03] - 쓸(쓸어버리기) 룰 추가 (한국 표준 한 가지 보강)

기존에 누락되었던 한국 표준 맞고의 "쓸" 룰을 추가. 효과는 따닥과 동일(상대 피 1장)이나 식별·표시를 분리. 룰북 §13 보강 6건째.

### 정의
- **쓸**: 바닥에 같은 월 카드 2장이 있는 상태에서 손패로 1장을 내어 `awaiting_floor_choice` → 1장 선택(2장 점수판으로) → 더미 뒤집기에서 또 같은 월이 나와 남은 1장과 매치 → 그 월 4장 전부 본인 captured + 상대 피 1장.
- **vs 따닥**: 따닥은 손패 1매칭 + 더미 1매칭이 한 턴에 발생하는 케이스. 쓸과 효과(피 1장)는 같으나 시작 조건(바닥 같은 월 카드 개수)이 다름.
- **vs 뻑 풀이(sweep_from_flip)**: 뻑 풀이는 더미 뒤집기에서 바닥 같은 월 3장이 있을 때 4장 한꺼번에 가져가는 케이스. 토스트 텍스트 "쓸!" → "뻑 풀이!"로 분리.

### 변경 (`game.js`)
- `chooseFloorSteps`의 단계 2(`drawAndResolve`) 직후 분기: `lastAction.kind === 'ttadak' && player === playerId`이면 `kind = 'sseul'`로 재라벨 + `month = pending.month` 부가. 사실상 chooseFloor 경로에서 발생하는 따닥은 모두 쓸로 분류된다(같은 월 ttadak이 도달 가능한 코드 경로는 chooseFloor뿐).
- 파일 상단 `@fileoverview` 특수 이벤트 목록에 "쓸" 항목 추가, "따닥" 정의 정확성 보강(같은 월 4장 명시).

### 변경 (`public/client.js`, `public/index.html`)
- `maybeShowActionToast`: 신규 `case 'sseul'` 추가 — 토스트 텍스트 `"${month}월 쓸!"` (month 없으면 "쓸!"). 기존 `sweep_from_flip`은 "뻑 풀이!"로 변경(의미 정확성).
- 캐시 버스터 `client.js?v=33` → `v=34`.

### 추가 (`tests/`)
- `tests/game.unit.spec.js` G-40~G-44 5건 신규 — 쓸 발동/피 0장/따닥 구분/다른 월 더미/바닥 3장 시작 시 sseul 아님 등 경계 케이스.
- `tests/sseul-adhoc.mjs` 신규 — Playwright nested `node_modules` 충돌 회피용 ad-hoc 단위 검증 스크립트. Node 직접 실행 (`node tests/sseul-adhoc.mjs`). 11/11 PASS(신규 5 + 회귀 6: 쪽/1매칭/2매칭+choose/뻑/폭탄/createGame). 회귀 인프라 안정화 시 정식 spec으로 흡수.

### 검증
- 단위(ad-hoc Node 직접 실행): 11/11 PASS
- 서버 통합(작업용 3099 포트 라운드트립, WS PLAY_CARD + CHOOSE_FLOOR + STATE 검사): 7/7 PASS
- 사용자 실서버(포트 3000, PID 73716)는 본 작업 중 건드리지 않음. 사용자가 다음 라운드 사이에 재시작 시 적용.

### 비고
- 사용자 명세("바닥 같은 월 2장 + 손패 1 + 더미 1 = 4장 + 피 1장, 쪽 메커니즘 재사용")에 부합. 보너스 턴 없음(기존 ttadak과 동일).
- score.js, server.js는 변경 없음(피 빼앗기는 game.js `stealPi`가 이미 처리).
- 사용자 정의에 따른 "쪽" 검증: 기존 `jjok` 분기(`drawAndResolve` 라인 403~409)가 명세와 일치 — 변경 불필요.

### 참고
- 룰북 §13 6건째 항목: `minigames/matgo/CLAUDE.md` 갱신 동반.

---

## [2026-06-02] - 폭탄 룰 표준화: 보너스 뒤집기 권리(기회 보존의 법칙)

폭탄 메커니즘을 **표준 한국 맞고 룰에 맞게 정정·확정**. 이전 [2026-05-31] 'drawAndResolve 2회 연속(`bombExtraDraw`)' 모델을 **`bombDeckCredit` 보너스 뒤집기 권리 모델**로 대체. 룰북 §13(레포 측 기록: `CLAUDE.md`) 갱신 — 해당 행을 새 표준 룰로 개정.

### 변경 (`game.js`)
- `g.bombDeckCredit = { p1: 0, p2: 0 }` 상태 신규 — "기회 보존의 법칙"(손 + 권리 합이 매 턴 −1로 진행, 양쪽 동기).
- `bombSteps` 정정: 폭탄 발동 = 같은 월 4장(손 3 + 바닥 1) 가져가기 + 상대 피 1장 + 통상 덱 뒤집기 1회 + **보너스 뒤집기 권리 +2**. (손 −3 + 보너스 +2 = 순 −1, 정상 1턴과 동등)
- `bonusFlipSteps(g, playerId)` generator 신규 — 자기 차례에 손 0이어도 권리가 남아 있으면 덱 1장 뒤집기(단순 매칭만, 쪽/뻑/따닥 미형성) + 고/스톱 결정 가능. 사용 시 권리 −1.
- 라운드 종료 조건 = 양쪽 모두 `손패 + bombDeckCredit` 합이 0.
- `sangtongSteps` / `bonusFlipSteps` 단계 generator를 `server.js`에 통합, `client.js` 연출·`bot.js` 대응 (커밋 `50b3ed6`).

### 비고
- 권위 룰북 파일(`2026-05-30-matgo-rulebook.md` §13)은 별도 머신에 있어 본 레포에서 직접 수정 불가. 레포 측 룰북 기록(`matgo/CLAUDE.md` §13 보강 표)을 본 표준 룰로 개정함. 데스크톱 머신의 원본 §13에도 동일 반영 필요.
- 검증: 변경 4개 JS `node --check` 통과. Playwright 러너는 matgo↔minigames 루트 playwright 중복 설치 충돌로 미실행(코드 무관 환경 이슈).

## [2026-05-31] - 룰 보강 5건 (사통/흔들기·폭탄 시점/첫뻑/폭탄 2뒤집기/floor 위치 고정)

사용자 실플레이 피드백 5건을 표준 한국 맞고 룰에 맞게 구현. 룰 로직(`game.js`, `score.js`) 3건 + UI 흐름(`public/client.js`, `public/index.html`) 2건 + 서버 라우터(`server.js`) 1건.

### 추가

#### `game.js`
- `sangtongSteps(g, playerId, choice)` 신규 export 함수 — 사통 선언/포기 처리. `choice === 'declare'` 시 `endRoundWin` 호출 + `sangtongBonus: 7` flag 전달. `choice === 'continue'` 시 `g.pendingSangtong = null`, `g.phase = 'awaiting_play'` 복귀
- `startRound` 사통 검사: 양 플레이어 손 10장 중 같은 월 4장 포함 시 `g.pendingSangtong = { player, month }` + `g.phase = 'awaiting_sangtong'`
- `g.firstPpeokBy` 신규 상태(`'p1' | 'p2' | null`) — 라운드 첫 뻑 생성자 추적. `drawAndResolve` 내 `g.ppeokFlags[month] = playerId` 직후 `if (g.firstPpeokBy === null) g.firstPpeokBy = playerId`
- `g.bombExtraDraw` 플래그 — 폭탄 후 2회차 뒤집기 대기 표시. `bombSteps`가 `drawAndResolve` 2회 연속 실행. 2회차에서 `awaiting_floor_choice` 진입 시 `chooseFloorSteps`의 `wasFromHand` 분기를 `wasFromHand || g.bombExtraDraw`로 확장
- `g.shakeAsked = { p1: false, p2: false }` — 라운드당 흔들기 모달 1회 제한

#### `score.js`
- `applyFinalMultipliers`의 `flags`에 두 신규 필드:
  - `firstPpeokBonus: boolean` — true 시 `base += 7`, reasons에 `첫뻑 +7`
  - `sangtongBonus: 7` — base 가산 7점, reasons에 `사통 +7`
- `endRoundWin`에서 `applyFinalMultipliers` 호출 시 `firstPpeokBonus: g.firstPpeokBy === winnerId` 전달

#### `server.js`
- `sangtongSteps` import 추가
- `isPauseForUserInput`에 `'awaiting_sangtong'` 추가 (사통 대기 중 봇 턴 진행 차단)
- 메시지 라우터 `SELECT_SANGTONG` 케이스 신설 — `runSteps(sangtongSteps(game, player.id, msg.choice), player)`

#### `public/index.html`
- `#sangtong-modal` 신규 모달 — 타이틀 "사통!", 선언/포기 버튼 (`#btn-sangtong-declare`, `#btn-sangtong-continue`)
- `#bomb-confirm-modal` 신규 모달 — `window.confirm` 대체 (`#btn-bomb-confirm`, `#btn-bomb-cancel`)
- 캐시 버스터: `client.js?v=13` → `v=14`

#### `public/client.js`
- 사통 모달 핸들러 — phase `awaiting_sangtong` && `pendingSangtong.player === me` 시 모달 show, 선언/포기 버튼에서 `SELECT_SANGTONG` 송신
- 흔들기 카드 클릭 시점 모달 — `sendPlay(cardId)` 진입 시 같은 월 3장 보유 + 그 월 첫 카드 + `!shakeAskedThisRound` 검사 → 모달 후 `SHAKE` → `PLAY_CARD` 송신 순서 보장
- 폭탄 카드 클릭 시점 모달 — `window.confirm` 제거, `bomb-confirm-modal` 호출
- `floorSlotMap = new Map()` — 카드 ID → 슬롯 인덱스 캐시. `renderFloor` 재구현: 신규 카드 ID에만 빈 슬롯 배정, 사라진 카드 ID 캐시 제거. `groupSlotIdx`를 그 월 첫 카드의 슬롯으로 대체
- `ROUND_START`/`GAME_START` 수신 시 `floorSlotMap.clear()` + `shakeAskedThisRound = false`
- `snapshotForPlayer`에 `pendingSangtong` 필드 추가 (본인 플레이어 차례인 경우만)

### 변경

- **`shake_decision` phase 제거** — 흔들기 결정을 서버 phase에서 클라이언트 모달로 완전 이전. `SHAKE` 메시지 타입은 유지 (페이로드 동일)
- **첫뻑 보너스 점수 모델** — 기존 `뻑 multiplier ×2^N`은 그대로(룰북 §13 해소 항목), 추가로 첫뻑한 사람이 승리하면 base에 +7. multiplier가 아닌 base 가산이라 박/고와 곱셈 누적
- **사통 점수 모델** — multiplier 없이 base 7점 가산 후 즉시 라운드 종료

### 알려진 후속 작업

- 기존 e2e `E-13/E-15/E-16` 시나리오가 `shake_decision` phase의 `/test/inject` 케이스에 의존 → 별도 수정 필요
- Playwright nested `node_modules` 충돌로 자동 회귀 미실행 (별도 인프라 이슈)
- 추가 단위 케이스(사통/첫뻑/폭탄 2턴/floor 캐시) 작성 권고

### 참고

- 목적 정의서: `.claude/specs/2026-05-31-matgo-rule-boost-scope.md`
- 스펙: `.claude/specs/2026-05-31-matgo-rule-boost-plan.md`
- Coder 리포트: `.claude/specs/2026-05-31-matgo-rule-boost-coder-report.md`
- 룰북: `C:/antigravity/.claude/specs/2026-05-30-matgo-rulebook.md` §13 (별도 머신)

---

## [2026-05-28] - v8 UI 시안 이식

studio-mockup의 `matgo/redesign-mockup-v8.html` 시안을 실제 게임 클라이언트에 그대로 이식. 게임 로직(server.js, game.js, cards.js, score.js, bot.js)은 일절 수정하지 않고 클라이언트 3개 파일만 전면 재작성.

### 변경

#### `public/index.html` (전면 재작성)
- 기존 `<header class="topbar">` 완전 제거
- `<main class="play-area">`를 3×3 CSS Grid로 재구성 (`6.5fr 3.5fr 270px` × `1fr 2fr 1fr`)
- 9개 섹션 배치: `opp/my × captured/hand/profile` + `floor-zone` + `meta-panel`
- 메타 패널(우측 중앙): 타이틀 "맞고", `#you-tag`, 점당 input, 새 라운드/새 게임 버튼
- `#go-stop-overlay`를 `floor-cards` 내부 절대중앙으로 이전 (REVISE1에서 신설). 기존 action-panel 내 `#go-stop-panel` 블록은 삭제
- 모달(`#round-modal`, `#kkeut-modal`), 토스트(`#toast`) 구조 ID는 그대로 보존하고 클래스만 v8 톤으로 변경

#### `public/style.css` (전면 재작성)
- `:root` CSS 변수 시스템을 카지노 다크 톤 → 한국 고스톱 담요 톤(녹색 펠트 + 골드 액센트)으로 교체
  - 신설: `--bg-deep/base/panel/card`, `--felt-mid/edge`, `--gold/gold-soft/gold-hi/gold-deep`, `--red-hot/red-deep`, `--green-go`, `--grey-soft/grey-mid`
- `.play-area` 3×3 grid 정의 + 9개 자식 섹션 위치 지정
- `.captured-zone` 내부 2×3 grid (`grid-template-columns: 4fr 6fr 10fr`)로 captured-summary + 4그룹 card-stack 배치
- `.hand-zone .hand-cards`: 5×2 슬롯 grid (`repeat(5, 1fr) × repeat(2, 1fr)`, `max-width: 320px`)
- `.floor-zone` 펠트 배경: `#1f5238` + 직조 노이즈 + vignette
- 카드 기본 크기 72×104 → **60×85**, `border-radius: 6px`, **회전 제거**
- `.card .month-tag { display: none }`, `.card .dual-badge { display: none }` — 카드 이미지에 이미 포함된 정보 중복 표시 제거
- `.card.hybrid-9` (9월 술잔): `outline: 1.5px dashed var(--gold-hi)` 점선만 유지
- `.go-stop-overlay` / `.big-go` (132×68, 26px, 적색 그라데이션) / `.big-stop` (갈색 그라데이션) / `@keyframes gostop-pulse` 1.6s 신설
- `.action-btn` 배경 하드코딩 HEX(`#4078c8`, `#22b58a`) 제거 → v8 골드 그라데이션(`linear-gradient(180deg, #b08040, #804020)` + `var(--gold)` border) 통일
- `.action-btn.bomb-btn` 적색 그라데이션(`var(--red-hot)` → `var(--red-deep)`)으로 차별화
- 기존 카지노 톤 클래스 일괄 제거: `.topbar*`, `.opp-area`, `.my-area`, `.center-area`, `.hand`, `.cards`, `.zone-label`, `.captured-grid`, `.breakdown`, `.deck-zone`, 카드 배경 컬러 클래스(`.card.gwang`, `.card.tti.hong` 등)
- `@media` 쿼리 전체 제거 (1280×800 단일 해상도 정책)
- 애니메이션 보존: `card-appear`, `card-fly-in-captured`, `flying-card`, `card-match-glow`, `action-toast`

#### `public/client.js` (부분 재작성)
- DOM 참조 교체:
  - 제거: `turnEl`, `moneyP1El`, `moneyP2El`, `oppCapturedEl`(구), `myCapturedEl`(구), `oppBreakdownEl`, `myBreakdownEl`, `lastActionEl`
  - 신설: `myMoneyEl`, `oppMoneyEl`, `myExtraEl`, `oppExtraEl`, `myBadgesEl`, `oppBadgesEl`, `bannerStatusEl`, `bannerMultiEl`, `goStopOverlay`
  - ID 변경: `perPointEl` (`per-point-input` → `per-point`), `oppCardsEl` (→ `#opp-hand-cards`), `myCardsEl` (→ `#my-hand-cards`)
- `FLOOR_SLOTS` 상수 신설: 덱 중앙 기준 R=150px / 2R=300px 허니콤 12슬롯 좌표 (내층 6 + 외층 6)
- `applyFloorSlot(el, idx)` 신설: `idx % FLOOR_SLOTS.length` 모듈러로 인덱싱, `el.style.left/top`을 `calc(50% + dx) / calc(50% + dy)` + `transform: translate(-50%, -50%)`로 설정
- `renderFloor(s)`: 기존 flex 휘저음(`margin: 8px -18px` + tilt) 방식 → `applyFloorSlot` 절대좌표 방식으로 교체. `deck-card`, `floor-mission`, `go-stop-overlay`는 보존(자식 순회 시 가드)
- `renderCaptured(pid, s)`: 단일 fan → `captured-summary` 4줄 카운트 + `captured-group × 4` (`gwang/kkeut/tti/pi`) 각각의 `.card-stack` 채우기로 교체. 임계 도달 시(`gwang ≥ 3, kkeut/tti ≥ 5, pi ≥ 10`) `.scored` 클래스 토글
- `renderOppHand/renderMyHand`: 컨테이너만 신 ID로 교체, 정렬·클릭 핸들러 동일 유지
- 신설 헬퍼: `updateProfileBadges(el, pid, s)` (흔들기/N고 뱃지), `deriveTurnText(s)`, `deriveBannerMultiplier(s)`
- `renderLastAction` 함수 호출 제거 (`#last-action` 요소 삭제됨, `action-display` + action-toast로 통합)
- `updateActionPanel`: `goStopPanel` → `goStopOverlay`로 토글 대상 일관 변경. `#btn-go`/`#btn-stop` 이벤트 리스너는 그대로 유지
- `resolvePendingFlies` 내 captured 탐색 셀렉터를 `#my-captured-zone` / `#opp-captured-zone`로 갱신

### 보존 (변경 없음)
- 서버 모듈 일체: `server.js`, `game.js`, `cards.js`, `score.js`, `bot.js`
- WebSocket 메시지 스키마: `JOINED` / `GAME_START` / `ROUND_START` / `STATE` / `ROUND_END` / `OPPONENT_LEFT` / `ERROR`
- 송신 함수 9종: `sendPlay`, `sendChooseFloor`, `sendGoStop`, `sendShake`, `sendBomb`, `sendNewRound`, `sendNewGame`, `sendPerPoint`, `sendKkeutChoice`
- 자동 재접속 (1→2→4→8초 backoff) + `pagehide` 즉시 close
- 카드 SVG/PNG 에셋 (`public/assets/cards-svg/`, `public/assets/cards/`)

### DOM ID 매핑표

| 카테고리 | 기존 | 신규 |
|---|---|---|
| 점당 input | `#per-point-input` | `#per-point` |
| 상대 손패 | `#opp-cards` | `#opp-hand-cards` |
| 내 손패 | `#my-cards` | `#my-hand-cards` |
| 잔고 | `#money-p1` / `#money-p2` | `#my-money` / `#opp-money` |
| 먹은 패 | `#opp-captured` / `#my-captured` (flat grid) | `#opp-captured-zone` / `#my-captured-zone` (2×3 grid) |
| 손장수 추가 | (없음) | `#opp-extra` / `#my-extra` |
| 뱃지 | (없음) | `#opp-badges` / `#my-badges` |
| 배너 상태/배수 | `#turn-status` / (없음) | `#banner-status` / `#banner-multiplier` |
| 고/스톱 패널 | `#go-stop-panel` (action-panel 내 소형 버튼) | `#go-stop-overlay` (floor 중앙 132×68 대형 버튼) |
| 라스트 액션 | `#last-action` | (제거, `#action-display` + action-toast로 통합) |

### 검증
- AD 모드3: 34/34 PASS (REVISE1에서 FAIL 3건 해소: floor overlay 누락 / 132×68 대형 버튼 / action-btn 하드코딩 HEX)
- QA: CONDITIONAL_PASS (수용 기준 17건 중 PASS 13 + 코드 정적 검증 N/A 4. 진입점 보존·회귀 위험 없음 확인)
- 시각 검증: 1280×800 Chromium 스크린샷 10장 (대기 / 초기 / settled / 진행 / 5수 후 / go-stop overlay / shake panel / bomb panel)

### 참고
- 시안 원본: `studio-mockup/matgo/redesign-mockup-v8.html`
- Scope: `.claude/specs/2026-05-28-matgo-v8-ui-apply-scope.md`
- Plan: `.claude/specs/2026-05-28-matgo-v8-ui-apply-plan.md`
- Coder: `.claude/specs/2026-05-28-matgo-v8-ui-apply-coder-report.md`
- Coder REVISE1: `.claude/specs/2026-05-28-matgo-v8-ui-apply-coder-revise1-report.md`
- AD 모드3: `.claude/specs/2026-05-28-matgo-v8-ui-apply-ad-mode3-report.md`
- QA: `.claude/specs/2026-05-28-matgo-v8-ui-apply-qa-report.md`
