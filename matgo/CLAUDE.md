# 맞고 (Matgo) — 개발·QA 가이드

화투 1:1 대전 게임. 한국 표준 맞고 룰 기반.

## 룰북 (필수 참조)

**QA 및 기능 개발 시 반드시 룰북을 기준으로 삼는다.**

- 위치: `C:/antigravity/.claude/specs/2026-05-30-matgo-rulebook.md` (별도 머신, 본 레포에서 직접 수정 불가)
- 출처: 나무위키 맞고·고스톱 + 게임 코드 교차검증
- 포함 내용: 화투 48장 구성, 족보 점수표, 박 기준, 고배수 공식, QA 체크리스트, 구현 버그 목록

### 룰북 §13 보강 (2026-05-31 신규 5건 + 2026-06-02 폭탄 룰 정정·확정 + 2026-06-03 쓸 룰 추가 + 2026-06-03 조커 2장 룰 + 2026-06-03 바닥 조커 선공 자동 획득 정정 + 2026-06-08 조커 라운드 종료 불가 수정 + 2026-06-16 조커 케이스 A 턴 유지 룰 변경 + B1/B2/B3 fly 연출 수정 + 2026-06-17 R5~R8: choice 손패 fly·순서 + 자뻑 풀이 2피 룰 + 조커 captured pi 그룹 표시)

| 항목 | 내용 |
|---|---|
| 사통 (대통령) | 라운드 시작 시 손패 10장에 같은 월 4장이 포함되면 사통 모달 표시 → 선언 시 즉시 라운드 승 + **7점 보너스** (multiplier 없는 base 가산), 포기 시 정상 진행. phase: `awaiting_sangtong`, 메시지: `SELECT_SANGTONG { choice: 'declare' \| 'continue' }` |
| 흔들기 시점 변경 | **`shake_decision` phase 제거.** 라운드 시작 시 일괄 검사 → 같은 월 첫 카드를 낼 때 클라이언트 모달(`shake-modal`)로 이전. 흔들기 모달은 라운드당 1회 (`g.shakeAsked`) |
| 폭탄 확인 모달 | `window.confirm` → 전용 모달(`bomb-confirm-modal`)로 교체. 같은 월 두 번째 카드 낼 때 + 바닥 1장 조건에서 표시 |
| 첫뻑 보너스 | `g.firstPpeokBy` 신규 상태. 라운드 첫 뻑을 만든 플레이어가 승리 시 `applyFinalMultipliers`에서 `firstPpeokBonus` flag로 **+7점** 가산. reasons에 `첫뻑 +7` |
| 폭탄 보너스 뒤집기 권리 (기회 보존의 법칙) | **표준 룰 — 2026-06-02 정정·확정.** 폭탄 발동 = 같은 월 4장(손 3 + 바닥 1) 가져가기 + 상대 피 1장 + 통상 덱 뒤집기 1회. 추가로 **보너스 뒤집기 권리 +2** 누적(`g.bombDeckCredit`). 자기 차례에 **손이 0이어도** 권리가 남아 있으면 `bonusFlipSteps`로 덱 1장 뒤집기(단순 매칭만 — 쪽/뻑/따닥 미형성) + 고/스톱 결정 가능. 권리 사용 시 −1. **라운드 종료 조건** = 양쪽 모두 `손패 + bombDeckCredit` 합이 0 (기회 보존의 법칙으로 양쪽 잔여가 동기화되어 동시에 0 도달). 손 −3 + 보너스 +2 = 순 −1로 정상 1턴과 동등. **이전 'drawAndResolve 2회 연속(`bombExtraDraw`)' 모델은 본 모델로 대체됨.** 구현: `game.js` `bombSteps`/`bonusFlipSteps`, `bombDeckCredit` 상태 |
| floor 위치 고정 | 클라이언트 `floorSlotMap` (Map: 카드 ID → 슬롯 인덱스) 신규 캐시. 한 번 떨어진 위치 ID 기반 고정, 다른 카드 매칭으로 인덱스 당김 없음. `ROUND_START`/`GAME_START` 수신 시 `floorSlotMap.clear()` |
| 쓸 (2026-06-03) | 바닥에 같은 월 카드 **2장**에서 손패 1장을 내어 `awaiting_floor_choice` → 1장 선택 → 더미 뒤집기에서 또 같은 월이 나와 남은 1장과 매치 → 그 월 4장 전부 본인 captured + **상대 피 1장**(쪽 메커니즘 재사용). lastAction.kind=`sseul` 신규. 효과는 따닥과 동일하나 식별 분리(따닥은 손패 1매칭+더미 1매칭의 같은 월 4장 케이스로, 실제 코드 경로상 chooseFloor 이후의 ttadak은 모두 sseul로 재라벨링됨). 토스트 `"${month}월 쓸!"`. 사실상 `drawAndResolve` 라인 441~449의 ttadak 분기는 chooseFloor 경로에서만 도달 가능 → 전부 쓸. 기존 `sweep_from_flip`(뻑 풀이) 토스트는 "쓸!" → "뻑 풀이!"로 정정 |
| 조커 2장 (2026-06-03) | 화투 48장 + **조커 2장**(`m00_joker_a/b`, `type='joker'`, `month=0`) → 덱 50장. **어떤 월과도 매치 안 됨**. captured 진입 시 피 더미에 추가되며 **1장당 피 2장 가치**(쌍피 동일). 셔플에 포함 → 손/바닥/더미 어디든. **케이스 A** (손 조커 내기): 상대 피 1장(없으면 스킵) + 조커 본인 captured + 매치/덱뒤집기 단계 완전 스킵 + 더미 위 1장 손 보충(뒤집기 아님, 더미 빈 경우 스킵) → **턴 유지(연속 플레이)** (2026-06-16 룰 변경, 이전 "턴 종료/교대" 폐기. `finishTurnKeepTurn` — 점수/고스톱/술잔/라운드종료 평가는 finishTurn과 동일, turn=본인 유지, phase=awaiting_play). **케이스 B** (더미 뒤집은 게 조커): 상대 피 1장 + 조커 본인 손 + 더미 한 번 더 뒤집기(재귀). `flipDeckBonus` 보너스 뒤집기도 동일. `lastAction.kind`: `joker_play`/`joker_flip`. 토스트 "조커! (피 +2)" / "조커! (손으로)". 사통/폭탄 트리거 자연 차단(month=0, 2장뿐) + month=0 명시 안전망. `client.js` 시각화: 검은 배경 + 골드 ★ + JOKER 라벨(`.joker-card`). `score.js`: `piCount += joker.length * 2` |
| 바닥 조커 선공 자동 획득 (2026-06-03 정정) | **이전 "데드 슬롯" 해석 폐기.** 분배 직후 바닥(`floor`)에 깔린 조커 N장(0/1/2)을 **선공자(firstTurn) `captured.pi` 더미로 즉시 이동**. 점수는 score.js의 기존 계산 그대로(1장당 피 +2). **추가 보너스 없음**: 보너스 턴 X, 상대 피 뺏기 X. 첫 턴은 정상 진행. 구현: `applyFloorJokerToFirst(game, firstTurn)` export (`game.js`) → `startRound`에서 분배 직후·사통 검사 직전 1회 호출. `lastAction = { kind: 'floor_joker_to_first', player, count, jokers }` → 클라이언트 토스트 "선공 바닥 조커 N장 획득!". 단위 테스트 JOKER-010~013. |
| 바닥 리필 룰 (2026-06-15 신규) | **조커 제거 후 바닥이 항상 8장이 되도록 deck에서 보충.** `applyFloorJokerToFirst`가 조커 N장을 captured로 옮긴 뒤, `deck.pop()`(drawAndResolve와 동일 방향)으로 한 장씩 꺼내 floor에 push해 원래 길이(8)를 복원한다. **연쇄 정책**: 보충 카드가 또 조커면 그것도 선공자 captured로 이동 + 재보충(비조커가 floor에 안착할 때까지). 조커 2장뿐이라 최대 2회 — 무한루프 불가. **deck 소진 방어**: `deck.length > 0` 가드로 deck이 비면 루프 종료(floor가 8 미만일 수 있음 — 작은 픽스처 케이스). `lastAction.count`/반환값은 선공자가 가져간 조커 **총수**(연쇄 포함)로 일관 → 토스트 "선공 바닥 조커 N장 획득!". 결과 `floor.length === 8`(deck 충분 시), `deck.length === 22 - 보충횟수`(최대 2), 카드 총합 50 불변. **client.js 연출**: `isRoundStart` 조건에 `floor_joker_to_first` 추가 → 조커/리필 카드 모두 fly 없이 appear(round_start 오프닝과 동일). 단위 JOKER-018~021 + JOKER-010~013 갱신, smoke `floor===8`, e2e E-04 `=== 8` 고정. |
| 조커 라운드 종료 불가 수정 (2026-06-08) | **사용자 신고: 케이스 B로 조커가 손에 추가되면 양쪽 손 수가 비대칭(+1 누적) → "기회 보존의 법칙"이 깨져 양쪽 0 동시 도달 불가능 → 라운드 영구 종료 불가.** `finishTurn` 종료 조건 변경: **한쪽의 `손+credit=0`이고 상대의 `credit=0`이면 자동 종료** (폭탄 권리 우선 — 한쪽 0이어도 상대 credit > 0이면 보너스 뒤집기 끝까지 진행). 종료 직전 `flushHandsToCaptured(g)` 헬퍼로 양쪽 잔여 손 카드를 각자 본인 `captured`로 자동 이동 (조커는 `type='joker'` 그대로 → `score.js`가 피 +2 자동 처리, 일반 카드는 type별 분류). 정산 후 점수 비교: 7+ 쪽이 있으면 승자, 둘 다 7 미만이면 무승부. `finishTurn`의 자동 스톱 조건(7점 도달)에도 `oppStuckAndSelfNoCredit` 분기 추가. **`score.js` 무수정**. 회귀 테스트 JOKER-014~017 (joker-adhoc 19/19 PASS). |
| 조커 케이스 A 턴 유지 (2026-06-16 룰 변경) | **이전 "조커 손에서 내면 턴 교대"(finishTurn) 폐기 → 턴 유지.** 케이스 A(손 조커) 처리 끝에 `finishTurn` 대신 신규 `finishTurnKeepTurn`(`game.js`) 호출 — 점수/고스톱/술잔/라운드종료 평가는 `finishTurn`과 동일하되 마지막 `g.turn = ...`(턴 교대) 한 줄만 제거 → **턴=본인 유지, phase=awaiting_play**. 조커 captured + 상대 피 1 + 더미 1장 손 보충은 유지. 케이스 B(더미 뒤집은 게 조커)는 현행 유지(범위 외). `finishTurnKeepTurn`은 `finishTurn` 복사본이라 향후 `finishTurn` 로직 변경 시 양쪽 동기화 필요(JSDoc 명시, 향후 옵션 파라미터 리팩토링 권장). 테스트: JOKER-002/003/009 턴 단언을 턴 유지로 수정 + JOKER-002a 신규(phase 단언). joker-adhoc **24/24**. |
| B1 바닥 2장 먹기 fly 출처 (2026-06-16) | awaiting_floor_choice 통합 STATE에서 손으로 낸 srcCard가 더미서 나온 것처럼 보이던 버그(`la.kind==='choice_made'` 가드가 sseul/pair_from_flip로 덮여 무효화). `game.js`에 `pendingChoiceSrcCardId` 필드 신설(startRound 초기화 / chooseFloorSteps 단계1에서 `wasFromHand ? srcCard.id : null` 설정 / finishTurn·finishTurnKeepTurn 리셋) + `snapshotForPlayer`에 `choiceFloorSrcCardId` 노출 → `client.js`가 이 필드로 srcCard를 drewIds에서 제외(손패 출처=HAND_THROW, 덱만 DECK_THROW), `la.kind` 폴백 유지. |
| B2 fly 경로 직선화 + snap 제거 (2026-06-16) | `client.js flyTo`가 **left/top만 transition**(width/height 동시 transition 제거 — 덱·바닥·손패 카드 60×85 동일이라 크기 즉시 적용 시 점프 0) + DECK_THROW를 **더블 rAF**로 처리해 snap 제거. |
| B3 쓸 연출 정상화 (2026-06-16) | 서버 쓸 룰(stealPi)은 정상(G-40 입증). 증상은 B1과 동일 통합 STATE 연출 누락 → **B1 수정으로 강탈 피 fly(origin='opp-captured') + "N월 쓸!" 토스트 정상화. 서버 무수정.** |
| R5/R6 choice 손패 fly + 순서 (2026-06-17) | B1이 `choiceFloorSrcCardId`로 손패 srcCard를 더미 fly에서 **제외만** 하고 손 fly를 미등록 → 순간이동(R5) + fly 순서 어긋남(R6) 잔존. `client.js renderState`에서 `s.choiceFloorSrcCardId`를 `_choiceSrcFlyId`로 수집 → **renderMyHand 이후** `startFlyFromHand` 등록(원본 DOM 존재 필요) + `flyTargetIds` 추가. `startFlyFromHand`를 `startFlyFromDeck`보다 **먼저** 등록해 HAND_THROW→DECK 시퀀스 순서 자연 정합(R6). 결과: 내가 낸 손패가 손에서 captured로 정상 fly(부딪힘 연출). 회귀 게이트 e2e **E-31**. |
| R7 자뻑 풀이 2피 (2026-06-17 룰 변경) | **이전 "자뻑 동일 처리(보너스 없음)" 폐기.** 내가 만든 뻑을 **내가** 풀 때만(`ppeokFlags[month]===playerId`) 상대 피 **2장**, **상대(타인) 뻑** 풀이는 1장 유지. `game.js`에 `isPpeokOwner(g, playerId, month)` 헬퍼 신설 → 뻑 풀이 stealPi **3지점**(resolveCardOnFloor 3매칭 / drawAndResolve sweep_from_flip / bonusFlipSteps bonus_ppeok_sweep)에서 `stealPi(..., isPpeokOwner ? 2 : 1)` + `stoleFromOpp` 동일 변수 사용. **반드시 `delete g.ppeokFlags[month]` 이전에 판정**(delete 후 소유자 식별 불가). `game.js` line 17 주석 갱신. `score.js` 무수정. 회귀 게이트 단위 **G-43a**(자뻑 2피)/**G-43b**(타인 뻑 1피). |
| R8 조커 captured 표시 + 손패 fly (2026-06-17) | 2단계. (1) `client.js` `joker_play` STATE에서 조커를 손→captured `startFlyFromHand`(HAND_THROW) 등록(`_jokerFlyId`, `drewIds` 제외 + `flyTargetIds` 추가, origin='hand'). (2) **핵심(선존 결함)**: `renderCaptured`가 captured 그룹을 `{gwang,kkeut,tti,pi}`로 분류하는데 **joker 키가 없어** 조커(`type='joker'`)가 드롭 → 도착지 DOM 미생성 → `locateCard`가 못 찾아 `fadeEntries`로 분류 → fly clone이 fade(사라짐)되던 버그. → 조커를 **pi 그룹에 합류**(effectiveType='pi', `.joker-card` 스타일 유지) + pi count reduce에 **조커 1장당 +2**(score.js `piCount += joker.length*2`와 일치, `score.js` 무수정). 단일 `renderCaptured` 수정으로 **케이스 A·케이스 B·바닥 조커 자동획득** captured 표시 일괄 정상화. 회귀 게이트 e2e **E-32**. |

### QA 필수 준수 사항

1. 테스트 시작 전 룰북의 **§12 QA 체크리스트**를 확인한다.
2. 점수 계산 검증 시 룰북 **§5 족보** 기준을 따른다.
3. 박(패널티) 검증 기준:
   - 피박: 패자 피 카운트 **≤ 7장** (`score.js: loser.piCount <= 7`)
   - 멍박: 패자 끗 **= 0장** (`score.js: loser.kkeut === 0`)
   - 광박: 승자 광 ≥ 3 & 패자 광 = 0
   - 고박: 고 선언자 패배 시
4. 구현이 룰북과 다르면 **룰북 기준으로 버그 리포트**를 작성한다.
5. 랜덤성 의존 케이스(흔들기, 특정 월 패 분배)는 skip 처리하되 사유를 기록한다.

## 파일 구조

```
matgo/
├── server.js       — HTTP + WebSocket 서버 (createApp export + 단독 실행 지원)
│                     POST /test/inject 엔드포인트 포함 (Playwright E2E용)
├── game.js         — 게임 상태 머신 (턴 진행, 특수 이벤트)
├── score.js        — 점수 계산 + 배수/박 처리
├── cards.js        — 화투 48장 정의 (buildDeck)
├── bot.js          — AI 봇 로직
├── public/
│   ├── index.html  — 게임 UI
│   ├── client.js   — 클라이언트 로직 (WebSocket + 렌더링)
│   └── style.css
└── tests/
    ├── score.unit.spec.js   — score.js 단위 테스트 (서버 불필요)
    ├── game.unit.spec.js    — game.js 단위 테스트 (서버 불필요)
    ├── e2e-scenarios.spec.js — 브라우저 E2E 시나리오 (E-32까지 32개, 서버 필요)
    ├── v8-qa.spec.js        — 구버전 QA 테스트 (레거시)
    └── screenshots/         — E2E 스크린샷 출력
```

> 단위 game.unit(44) + score.unit(56) 합계 100/100 PASS (2026-06-17 기준 — R7 G-43a/G-43b 추가. 2026-06-13 레거시 G-22/G-23 제거 반영).

## 서버 실행 (테스트용)

```bash
# 포트 3013으로 단독 실행 (playwright.config.js 기준)
node matgo/server.js --port 3013

# playwright.config.js baseURL: http://localhost:3013
```

### 테스트 전용 엔드포인트

- `POST /test/inject` — 모달/상태 강제 주입 (Playwright E2E용).
- `POST /test/reset` — 공유 룸 강제 초기화 (테스트 격리용). e2e `beforeEach`에서 호출해 직전 테스트의 룸 잔여 상태로 인한 레이스를 차단한다. **프로덕션 무영향(테스트 엔드포인트)**.

## 테스트 실행

```bash
cd C:/antigravity/minigame-paradise/matgo

# 단위 테스트 (서버 불필요, 빠름)
npx playwright test tests/score.unit.spec.js tests/game.unit.spec.js --reporter=list

# E2E 시나리오 테스트 (서버 3013 포트 사전 실행 필요)
node server.js --port 3013 &
npx playwright test tests/e2e-scenarios.spec.js --reporter=list

# 전체 실행 (단위 100 + E2E 32 = 총 132개)
npx playwright test tests/score.unit.spec.js tests/game.unit.spec.js tests/e2e-scenarios.spec.js --reporter=list
```

### 테스트 현황 (2026-06-17 기준)

| 파일 | 테스트 수 | 상태 | 서버 필요 |
|------|----------|------|----------|
| `score.unit.spec.js` (56) + `game.unit.spec.js` (44) | 합계 100개 | ✅ 100/100 PASS | ❌ |
| `e2e-scenarios.spec.js` | E-32까지 32개 | ✅ 32 PASS / 0 skip / 0 fail | ✅ (3013) |

> **2026-06-17 R5~R8 반영**: 단위 98→100(R7 자뻑 풀이 2피 검증 G-43a/G-43b), e2e 30→32(E-31 R5 손패 fly 출처·E-32 R8 조커 captured 안착). adhoc node 러너 joker 24(케이스 A 턴 유지 반영)/sseul 11/bombdup 7/floor-joker 5 + TDZ 1 + QA 능동 probe 3 = 합계 183건 PASS, QA PASS(R8 1차 FAIL→재수정 해소), AD3 APPROVED(2회 — fly 순서 + 조커 pi 그룹 혼재 레이아웃).

> **2026-06-13 flakiness 안정화**: 공유 룸 teardown 레이스(→ `POST /test/reset` + `beforeEach`/`afterEach`)와 랜덤 분배 바닥 조커 오프닝 fly 레이스(→ `waitForFlyIdle` + `pickSafePlayCard` 헬퍼)를 해소해 전체 e2e가 결정적이 됨.
> **2026-06-13 E-15·E-16 복원**: 위 안정화 때 `test.skip` 처리했던 E-15·E-16을 현행 흔들기 모달 흐름으로 재작성해 복원. `/test/inject`로 P1 손에 1월 3장(+5월1)·바닥 1월 0장(폭탄 회피) 주입 → `waitForFlyIdle` → 1월 카드 클릭 → `#shake-modal` 표시(E-15) / `#btn-shake` 클릭 → 모달 닫힘 + `shaking.p1` 반영(배지 '흔들기 ×2')(E-16). 제거된 `shake_decision` phase 의존을 제거함. 결과: 전체 e2e가 **3회 연속 30 passed / 0 skipped / 0 failed**(28 passed/2 skipped → 30 passed/0 skipped).

#### E2E 시나리오 요약 (e2e-scenarios.spec.js)

| 구간 | ID | 내용 |
|------|-----|------|
| §1 기본 연결 | E-01~E-06 | P1/P2 입장, 초기 상태, DOM ID 확인 |
| §2 기본 플레이 | E-07~E-11 | 카드 클릭, 턴 교대, perPoint 동기화, 재연결 |
| §3 inject 모달 | E-12~E-18 | go-stop, shake, floor-choice, kkeut 모달 주입 테스트 |
| §4 박 시나리오 | E-19~E-22 | 피박·멍박·광박·고박 round-modal 텍스트 검증 |
| §5 안정성 | E-23~E-25 | 콘솔 에러, AI봇 연결, 레이아웃 스크린샷 |
| §6 연출-STATE 순서 | E-26~E-27 | (2026-06-13) E-26: chooseFloor 통합 STATE 1회 송신(획득 순간이동 방지) / E-27: 뻑 토스트 DECK_LAND 이후 표시 타이밍 |
| §7 fly-출처 정합 | E-28~E-30 | (2026-06-13) E-28: 강탈 피 fly가 oppCapturedZone에서 출발(더미 아님, startFlyFromDeck 미호출) / E-29: 흔들기로 낸 카드 fly가 myCards에서 출발(startFlyFromDeck 미호출) / E-30: 폭탄 손 3장 fly가 myCards에서 출발(startFlyFromDeck 미호출) |
| §8 R5/R8 fly·표시 | E-31~E-32 | (2026-06-17) E-31: 바닥 2장 선택 흐름에서 내 손패 srcCard fly가 myCards에서 출발(origin='hand', startFlyFromDeck 미호출, R5) / E-32: 조커를 내면 fly가 myCards에서 출발하고 조커가 `#my-captured-zone`에 안착(fade 없음, R8) |

> **E-15·E-16 복원됨 (2026-06-13)** — 현행 흔들기 모달 흐름으로 재작성. E-15: inject(1월 손 3장+바닥 0장) → 카드 클릭 → `#shake-modal` 표시 검증. E-16: `#btn-shake` 클릭 → 모달 닫힘 + `shaking.p1` 반영(배지 '흔들기 ×2'). 제거된 `shake_decision` phase 의존 없음. 30 passed / 0 skipped.
> **E-08 결정화 (2026-06-15)** — 랜덤 분배 의존으로 간헐 flaky하던 E-08을 `/test/inject`로 상태 고정해 결정화. 바닥 리필 룰 검증과 묶여 `deck 20~22`(`22 - N`) + `floor 8` 단언으로 안정화.
> **stale 단언 정정**: E-03(덱 20→22; 2026-06-15 바닥 리필 룰 이후 22~20 가변 — `deck === 22 - N`), E-04(바닥 8 고정 — 2026-06-15 리필 룰로 조커 제거 후 `floor === 8` 복원, 이전 "6~8 범위" 표기는 폐기). E-08은 inject 결정화로 flaky 해소.

#### 알려진 주의사항

- **go-stop 버튼 클릭**: `go-stop-overlay`의 CSS `gostop-pulse` 애니메이션(infinite scale)으로 Playwright 안정성 검사가 무한 대기됨 → `{ force: true }` 옵션으로 우회 (E-13, E-14).
- **AI 봇 모드**: 단독 실행(`node server.js`)에서 `getBotUrl` 옵션이 필요. v8에서 자동 설정되도록 수정됨.

## 주요 ID 매핑 (DOM)

| 요소 | ID |
|------|-----|
| 흔들기 모달 | `shake-modal` (⚠️ shake-panel 아님) |
| 폭탄 패널 | `bomb-panel` |
| 폭탄 확인 모달 | `bomb-confirm-modal` (2026-05-31 신설, 카드 클릭 시점 모달) |
| 사통 모달 | `sangtong-modal` (2026-05-31 신설, 라운드 시작 시 같은 월 4장) |
| 고/스톱 오버레이 | `go-stop-overlay` |
| 9월 술잔 모달 | `kkeut-modal` |
| 라운드 결과 모달 | `round-modal` |
| 배너 상태 | `banner-status` |
| 배너 배수 | `banner-multiplier` |

## 변경 시 자주 깨지는 함정

1. **`shake_decision` phase는 더 이상 존재하지 않는다.** (2026-05-31 제거) 흔들기는 클라이언트 모달로만 처리. 서버 phase·메시지에서 참조하지 말 것. e2e `E-15/E-16`은 한때 이 제거된 phase의 inject에 의존해 `test.skip`이었으나, **현행 모달 흐름으로 재작성됨**(2026-06-13): inject(1월 손 3장 + 바닥 1월 0장) → 카드 클릭 → `shake-modal` 표시 → `#btn-shake` 클릭 → `shaking.p1` 반영. **`shake_decision` phase 참조 금지는 그대로 유지**(재작성 테스트도 phase 미참조). 레거시 잔재(`game.js`의 죽은 `shake_decision` 분기·`pendingShake` 필드, 단위 테스트 G-22/G-23)는 2026-06-13 데드코드로 제거됨(동작 무변경, 현행 흔들기는 G-38이 커버).
2. **사통 phase `awaiting_sangtong`은 `isPauseForUserInput()`이 true를 반환해야 한다.** (`server.js`) 누락 시 사통 모달 표시 중에도 서버가 봇 턴을 진행해 상태 깨짐.
3. **첫뻑 보너스(`firstPpeokBonus`)는 base 가산 7점이지 multiplier가 아니다.** `applyFinalMultipliers`에서 base에 +7 후 박/고 multiplier가 곱해진다. 순서 바뀌면 점수 폭주.
4. **폭탄 후 `g.bombExtraDraw` 플래그는 두 번째 `drawAndResolve` 직후 반드시 false로 리셋.** 미리셋 시 `chooseFloorSteps`에서 무한 3회차 진입 가능.
5. **`floorSlotMap`은 클라이언트 클로저 변수.** 서버 STATE에 슬롯 정보를 싣지 말 것. `ROUND_START`/`GAME_START` 수신 시 반드시 `clear()`.
6. **`g.firstPpeokBy`/`g.pendingSangtong`/`g.shakeAsked`/`g.bombExtraDraw`는 `startRound`에서 초기화.** 누락 시 라운드 간 상태 누수.
7. **사통과 흔들기는 같은 라운드에 동시 충족 가능** (같은 월 4장 ⊃ 같은 월 3장). 사통 우선, `continue` 선택 시에만 흔들기 검사가 카드 클릭 시점에 작동.
8. **조커(`type='joker'`)는 month=0이라 화투 매치 로직에 자연 차단되지만, 새 기능 추가 시 month 기반 카운트(`monthCount[c.month]`)에 들어가면 의도치 않은 결과 가능**. 사통 검사(`checkSangtongOpportunity`)와 폭탄 검사(`bombableMonths`)는 month=0 제외 안전망 적용 또는 자연 차단(조커 2장뿐) 검증됨. 신규 month 기반 검사는 명시적으로 `c.type !== 'joker'`로 거르거나 `c.month > 0` 가드 추가.
9. **덱은 50장**(화투 48 + 조커 2). 기존 테스트의 `g.deck.length === 20` 같은 상수는 모두 22로 갱신됨. 새 단위 테스트 작성 시 50/22 기준.
10. **조커는 폭탄 대상이 아니다.** 폭탄 매치 카운트(`handMonthCount[m] === 3 && floorMonthCount[m] === 1`)에서 m='0' 제외. 또한 4장 도달 자체가 불가능(조커 2장뿐) — 이중 안전망.
11. **`createGame()`/`startRound()` 후 `floor.length`는 다시 항상 8이다** (2026-06-15 바닥 리필 룰). 바닥에 조커가 떨어지면 `applyFloorJokerToFirst`가 선공자 `captured`로 옮긴 뒤 `deck.pop()`으로 N장 보충해 floor=8 복원. 따라서 **`deck.length === 22`는 더 이상 불변이 아니다** — 보충 횟수 N(연쇄 포함, 최대 2)만큼 줄어 `deck.length === 22 - N`이 된다. floor=8(deck 충분 시), 카드 총합 50은 불변. 새 테스트는 `total === 50` + `floor === 8`로 검증할 것. (작은 픽스처에서 deck이 소진되면 floor < 8 허용 — deck 소진 방어.)
12. **라운드 종료 조건은 양쪽 모두 0이 아니어도 트리거된다** (2026-06-08 조커 라운드 종료 불가 수정). `finishTurn`은 "한쪽의 `손+credit=0`이고 상대의 `credit=0`"이면 자동 종료한다. 조커 케이스 B로 한쪽 손이 +1 누적되어도 영구히 막히지 않도록 보장. 종료 직전 `flushHandsToCaptured(g)`가 양쪽 잔여 손을 각자 captured로 이동(조커는 `type='joker'` 그대로 → `score.js`가 피 +2 자동 처리, 일반 카드는 type별 분류). **양쪽 모두 0+0+0+0 케이스에서도 동일하게 endRoundDraw 호출되어 기존 동작 회귀 보장** (JOKER-017). 폭탄 권리(credit > 0) 우선이므로 한쪽 손+credit=0이어도 상대 credit > 0이면 종료 X. `score.js` 무수정.
13. **chooseFloor 단계 broadcast는 choice_made까지 보류한다** (2026-06-13 연출-STATE 순서 수정). `server.js` `shouldDeferBroadcast`는 `k === 'choice_made'`를 **반드시 보류 대상에 포함**해야 한다. `chooseFloorSteps` 단계1(srcCard + chosen captured 이동) STATE를 단계2(덱 뒤집기)까지 묶어 **통합 STATE 1회만 송신**해야 클라가 fly 연출을 온전히 수행한다. 단계1을 즉시 broadcast하면 낸 카드가 fly 없이 순간이동한다. (과거 JSDoc엔 의도가 적혀 있었으나 return 조건에서 누락된 드리프트였음.) 회귀 게이트: e2e **E-26**.
14. **ppeok(뻑) 토스트는 즉시 띄우지 않고 DECK_LAND까지 보류한다** (2026-06-13 연출-STATE 순서 수정). `client.js`는 ppeok 종류 lastAction의 토스트를 `pendingPpeokToast`로 보관 → 덱 뒤집기 fly의 **DECK_LAND 전환 시점에 flush**(덱이 바닥에 쌓인 뒤 표시). 안전망으로 CLEANUP 시 flush, 라운드 시작(`NEW_ROUND`/`ROUND_START`) 시 폐기한다. ppeok 외 토스트는 기존 타이밍 유지. 즉시 표시로 되돌리면 "뻑!"이 카드 내자마자 떠서 연출 순서가 어긋난다. 회귀 게이트: e2e **E-27**.
15. **강탈 피 fly는 oppCapturedZone에서 출발한다** (2026-06-13 fly-출처 정합 수정). `client.js`는 `la.stoleFromOpp > 0`일 때 `stolenPiIds = prevCapIds[opp] ∩ newCapIds[me]`로 빼앗긴 피 카드 ID를 식별 → 신규 `startFlyFromOppCaptured`로 **상대 획득 영역에서 출발**시킨다. 이때 `drewIds`(이번 턴 더미에서 뽑은 카드)는 **반드시 제외**(자연 덱 fly와 분리)하고, `resolvePendingFlies`의 handLike 분기에 `origin: 'opp-captured'`를 포함해야 보류 해소 시에도 출발점이 유지된다. 누락 시 빼앗은 피가 더미에서 날아온다. 회귀 게이트: e2e **E-28**.
16. **흔들기/모달 경유로 낸 카드는 renderMyHand가 DOM 재생성 시 pendingFlies 카드에 visibility:hidden을 재적용해야 한다** (2026-06-13 fly-출처 정합 수정). SHAKE STATE 도착이 `renderMyHand`(`innerHTML = ''`)로 fly clone의 원본 DOM을 무효화하므로, `renderMyHand` 말미에 `pendingFlies` 보유 카드의 재생성 DOM에 `visibility:hidden`을 다시 걸어 클론 원본을 손 위치에 보존해야 **내 손(myCards)에서 출발**한다(옵션 A). 누락 시 낸 카드가 더미에서 날아온다. 회귀 게이트: e2e **E-29**.
17. **폭탄 발동 시 `btnBombConfirm`/`btnBomb`에서 손 3장에 `startFlyFromHand`를 직접 등록해야 한다** (2026-06-13 fly-출처 수정). 폭탄으로 가져가는 같은 월 손 3장의 fly 출발점을, `sendBomb` 호출 직전에 `btnBombConfirm`(~1765) + `btnBomb` 폴백(~1790)에서 명시 등록한다. 내 폭탄 경로(`la.player === me`)는 상대 폭탄용 `oppHandOrigin` 분기(`la.player === oppId`)에 잡히지 않아 누락된다 → 누락 시 손 3장이 더미에서 날아온다. 회귀 게이트: e2e **E-30**.
18. **조커 케이스 A는 `finishTurnKeepTurn`으로 턴을 유지한다** (2026-06-16 룰 변경). 손 조커를 낸 뒤 `game.js`는 `finishTurn`(턴 교대)이 아니라 `finishTurnKeepTurn`(턴 유지)을 호출해야 한다. `finishTurnKeepTurn`은 `finishTurn` 복사본에서 마지막 `g.turn = ...` 한 줄만 제거한 것이라 — **향후 `finishTurn` 로직(점수/고스톱/술잔/라운드종료 평가)을 변경하면 `finishTurnKeepTurn`도 함께 동기화해야 한다**(JSDoc 명시). 누락 시 조커 후 턴이 상대로 넘어가거나 점수 평가가 어긋난다. 케이스 B(더미 뒤집은 게 조커)는 현행 유지(범위 외). 회귀: joker-adhoc JOKER-002/003/009(턴 유지) + JOKER-002a(phase=awaiting_play).
19. **`pendingChoiceSrcCardId`는 손으로 낸 srcCard fly 출처 식별의 단일 출처다** (2026-06-16 B1 수정). `awaiting_floor_choice` 통합 STATE(쓸/pair_from_flip 등)에서 손으로 낸 카드(srcCard)가 더미서 나온 것처럼 보이던 버그를 막기 위해, `game.js`는 `chooseFloorSteps` 단계1에서 `pendingChoiceSrcCardId = wasFromHand ? srcCard.id : null`로 세팅하고 `startRound`/`finishTurn`/`finishTurnKeepTurn`에서 **반드시 리셋**한다. `snapshotForPlayer`가 이를 `choiceFloorSrcCardId`로 노출 → `client.js`가 이 ID를 `drewIds`에서 제외(손패=HAND_THROW, 덱만 DECK_THROW). `la.kind==='choice_made'` 폴백은 유지(필드 누락 시 안전망). 리셋 누락 시 다음 턴까지 잘못된 출처 식별이 샌다.
20. **e2e 테스트는 격리가 필수다** (2026-06-13 flakiness 안정화). 전체 스위트는 단일 공유 룸 + `workers:1` 순차 실행이라 직전 테스트의 룸 잔여 상태가 다음 테스트로 새는 teardown 레이스가 있었다. (1) `beforeEach`에서 **`POST /test/reset`을 반드시 호출**(룸 강제 초기화)하고 `afterEach`에도 안전망으로 호출한다. (2) `joinAndStartGame` 헬퍼 말미에서 **`waitForFlyIdle`로 오프닝 fly를 대기**한다 — 랜덤 분배로 바닥 조커가 깔리면 오프닝에 fly 연출이 발생하는데 이를 기다리지 않고 카드를 클릭하면 fly race로 flaky해진다. (3) 카드 클릭은 무가드 `click` 대신 **`pickSafePlayCard` 헬퍼**를 쓴다(조커/흔들기·폭탄 트리거/바닥 선택 분기를 회피해 결정성 확보). 미준수 시 공유룸 레이스 또는 오프닝 fly race로 flaky해진다.
21. **자뻑 풀이 2피 판정(`isPpeokOwner`)은 반드시 `delete g.ppeokFlags[month]` 이전에 호출한다** (2026-06-17 R7 룰 변경). 뻑 풀이 stealPi 3지점(resolveCardOnFloor 3매칭 / drawAndResolve sweep_from_flip / bonusFlipSteps bonus_ppeok_sweep)에서 `const count = isPpeokOwner(g, playerId, month) ? 2 : 1`을 계산해 `stealPi`와 `lastAction.stoleFromOpp`에 동일 변수를 쓴다. **`delete` 후에는 소유자 판정 불가** → delete 한 줄 위로 count 계산을 올려야 한다(특히 bonus_ppeok_sweep은 `flipped.month` 기준). 자뻑(내가 만든 뻑을 내가 풀이)만 2장, 타인 뻑 풀이는 1장 유지. `score.js` 무수정. 회귀 게이트: 단위 G-43a/G-43b.
22. **`renderCaptured`의 captured 그룹 분류에 joker 키가 없다 — 조커는 pi 그룹에 합류시켜야 한다** (2026-06-17 R8 수정). `groups = {gwang,kkeut,tti,pi}`에 joker 키가 없어 `if (groups[effectiveType])` 가드가 `type==='joker'`를 **드롭**하던 선존 결함 → 조커 도착지 DOM이 안 생겨 `resolvePendingFlies`의 `locateCard`가 못 찾고 fly clone이 fade(사라짐)된다. 조커는 `effectiveType = (c.type==='joker') ? 'pi' : ...`로 **pi 그룹에 합류**(카드는 `.joker-card` 스타일 유지, 피로 변환 X)시키고, pi count reduce에 `if (c.type==='joker') return sum + 2`(score.js `piCount += joker.length*2`와 일치)를 추가한다. 단일 `renderCaptured` 수정이 케이스 A·케이스 B·바닥 조커 자동획득 표시를 일괄 정상화한다. 조커 분기는 쌍피/m09_kkeut 분기와 독립(month=0 전용)이라 회귀 0. 회귀 게이트: e2e E-32.
23. **choice 흐름 srcCard·조커 손패 fly는 `renderMyHand` 이후 `startFlyFromHand`로 등록하고 `flyTargetIds`에 추가한다** (2026-06-17 R5/R8 수정). `startFlyFromHand`는 `myCardsEl`에서 `data-card-id`로 원본 DOM을 찾으므로 **반드시 `renderMyHand`(innerHTML 재생성) 이후** 호출해야 한다(`renderState`에서 `_choiceSrcFlyId`/`_jokerFlyId`로 ID만 수집 → 렌더 후 일괄 호출). 두 카드 ID를 `flyTargetIds`에 추가해야 `renderCaptured`가 도착지를 visibility:hidden으로 보존(이중 표시 방지). **`startFlyFromHand`를 `startFlyFromDeck`보다 먼저** 호출해야 HAND_THROW→DECK 시퀀스 순서가 정합된다(R6). 함정 16(renderMyHand 말미 pendingFlies hidden 재적용)은 startFlyFromHand 내 `visibility='hidden'`으로 자동 정합 — 기존 코드 수정 금지. 회귀 게이트: e2e E-31(R5)/E-32(R8).
