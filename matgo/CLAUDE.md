# 맞고 (Matgo) — 개발·QA 가이드

화투 1:1 대전 게임. 한국 표준 맞고 룰 기반.

## 룰북 (필수 참조)

**QA 및 기능 개발 시 반드시 룰북을 기준으로 삼는다.**

- 위치: `C:/antigravity/.claude/specs/2026-05-30-matgo-rulebook.md` (별도 머신, 본 레포에서 직접 수정 불가)
- 출처: 나무위키 맞고·고스톱 + 게임 코드 교차검증
- 포함 내용: 화투 48장 구성, 족보 점수표, 박 기준, 고배수 공식, QA 체크리스트, 구현 버그 목록

### 룰북 §13 보강 (2026-05-31 신규 5건 + 2026-06-02 폭탄 룰 정정·확정 + 2026-06-03 쓸 룰 추가 + 2026-06-03 조커 2장 룰 + 2026-06-03 바닥 조커 선공 자동 획득 정정 + 2026-06-08 조커 라운드 종료 불가 수정)

| 항목 | 내용 |
|---|---|
| 사통 (대통령) | 라운드 시작 시 손패 10장에 같은 월 4장이 포함되면 사통 모달 표시 → 선언 시 즉시 라운드 승 + **7점 보너스** (multiplier 없는 base 가산), 포기 시 정상 진행. phase: `awaiting_sangtong`, 메시지: `SELECT_SANGTONG { choice: 'declare' \| 'continue' }` |
| 흔들기 시점 변경 | **`shake_decision` phase 제거.** 라운드 시작 시 일괄 검사 → 같은 월 첫 카드를 낼 때 클라이언트 모달(`shake-modal`)로 이전. 흔들기 모달은 라운드당 1회 (`g.shakeAsked`) |
| 폭탄 확인 모달 | `window.confirm` → 전용 모달(`bomb-confirm-modal`)로 교체. 같은 월 두 번째 카드 낼 때 + 바닥 1장 조건에서 표시 |
| 첫뻑 보너스 | `g.firstPpeokBy` 신규 상태. 라운드 첫 뻑을 만든 플레이어가 승리 시 `applyFinalMultipliers`에서 `firstPpeokBonus` flag로 **+7점** 가산. reasons에 `첫뻑 +7` |
| 폭탄 보너스 뒤집기 권리 (기회 보존의 법칙) | **표준 룰 — 2026-06-02 정정·확정.** 폭탄 발동 = 같은 월 4장(손 3 + 바닥 1) 가져가기 + 상대 피 1장 + 통상 덱 뒤집기 1회. 추가로 **보너스 뒤집기 권리 +2** 누적(`g.bombDeckCredit`). 자기 차례에 **손이 0이어도** 권리가 남아 있으면 `bonusFlipSteps`로 덱 1장 뒤집기(단순 매칭만 — 쪽/뻑/따닥 미형성) + 고/스톱 결정 가능. 권리 사용 시 −1. **라운드 종료 조건** = 양쪽 모두 `손패 + bombDeckCredit` 합이 0 (기회 보존의 법칙으로 양쪽 잔여가 동기화되어 동시에 0 도달). 손 −3 + 보너스 +2 = 순 −1로 정상 1턴과 동등. **이전 'drawAndResolve 2회 연속(`bombExtraDraw`)' 모델은 본 모델로 대체됨.** 구현: `game.js` `bombSteps`/`bonusFlipSteps`, `bombDeckCredit` 상태 |
| floor 위치 고정 | 클라이언트 `floorSlotMap` (Map: 카드 ID → 슬롯 인덱스) 신규 캐시. 한 번 떨어진 위치 ID 기반 고정, 다른 카드 매칭으로 인덱스 당김 없음. `ROUND_START`/`GAME_START` 수신 시 `floorSlotMap.clear()` |
| 쓸 (2026-06-03) | 바닥에 같은 월 카드 **2장**에서 손패 1장을 내어 `awaiting_floor_choice` → 1장 선택 → 더미 뒤집기에서 또 같은 월이 나와 남은 1장과 매치 → 그 월 4장 전부 본인 captured + **상대 피 1장**(쪽 메커니즘 재사용). lastAction.kind=`sseul` 신규. 효과는 따닥과 동일하나 식별 분리(따닥은 손패 1매칭+더미 1매칭의 같은 월 4장 케이스로, 실제 코드 경로상 chooseFloor 이후의 ttadak은 모두 sseul로 재라벨링됨). 토스트 `"${month}월 쓸!"`. 사실상 `drawAndResolve` 라인 441~449의 ttadak 분기는 chooseFloor 경로에서만 도달 가능 → 전부 쓸. 기존 `sweep_from_flip`(뻑 풀이) 토스트는 "쓸!" → "뻑 풀이!"로 정정 |
| 조커 2장 (2026-06-03) | 화투 48장 + **조커 2장**(`m00_joker_a/b`, `type='joker'`, `month=0`) → 덱 50장. **어떤 월과도 매치 안 됨**. captured 진입 시 피 더미에 추가되며 **1장당 피 2장 가치**(쌍피 동일). 셔플에 포함 → 손/바닥/더미 어디든. **케이스 A** (손 조커 내기): 상대 피 1장(없으면 스킵) + 조커 본인 captured + 매치/덱뒤집기 단계 완전 스킵 + 더미 위 1장 손 보충(뒤집기 아님, 더미 빈 경우 스킵) → 턴 종료. **케이스 B** (더미 뒤집은 게 조커): 상대 피 1장 + 조커 본인 손 + 더미 한 번 더 뒤집기(재귀). `flipDeckBonus` 보너스 뒤집기도 동일. `lastAction.kind`: `joker_play`/`joker_flip`. 토스트 "조커! (피 +2)" / "조커! (손으로)". 사통/폭탄 트리거 자연 차단(month=0, 2장뿐) + month=0 명시 안전망. `client.js` 시각화: 검은 배경 + 골드 ★ + JOKER 라벨(`.joker-card`). `score.js`: `piCount += joker.length * 2` |
| 바닥 조커 선공 자동 획득 (2026-06-03 정정) | **이전 "데드 슬롯" 해석 폐기.** 분배 직후 바닥(`floor`)에 깔린 조커 N장(0/1/2)을 **선공자(firstTurn) `captured.pi` 더미로 즉시 이동**. 점수는 score.js의 기존 계산 그대로(1장당 피 +2). **추가 보너스 없음**: 더미 뒤집기 X, 보너스 턴 X, 상대 피 뺏기 X. 첫 턴은 정상 진행. 구현: `applyFloorJokerToFirst(game, firstTurn)` export (`game.js`) → `startRound`에서 분배 직후·사통 검사 직전 1회 호출. `lastAction = { kind: 'floor_joker_to_first', player, count, jokers }` → 클라이언트 토스트 "선공 바닥 조커 N장 획득!". `createGame` 결과의 `floor.length`는 8 → **6~8 가변**(조커 N장만큼 감소), `captured` 총합 = `8 - floor.length`, 카드 총합 50 일관 유지. 단위 테스트 JOKER-010~013 (조커 0/1/2/보너스없음). |
| 조커 라운드 종료 불가 수정 (2026-06-08) | **사용자 신고: 케이스 B로 조커가 손에 추가되면 양쪽 손 수가 비대칭(+1 누적) → "기회 보존의 법칙"이 깨져 양쪽 0 동시 도달 불가능 → 라운드 영구 종료 불가.** `finishTurn` 종료 조건 변경: **한쪽의 `손+credit=0`이고 상대의 `credit=0`이면 자동 종료** (폭탄 권리 우선 — 한쪽 0이어도 상대 credit > 0이면 보너스 뒤집기 끝까지 진행). 종료 직전 `flushHandsToCaptured(g)` 헬퍼로 양쪽 잔여 손 카드를 각자 본인 `captured`로 자동 이동 (조커는 `type='joker'` 그대로 → `score.js`가 피 +2 자동 처리, 일반 카드는 type별 분류). 정산 후 점수 비교: 7+ 쪽이 있으면 승자, 둘 다 7 미만이면 무승부. `finishTurn`의 자동 스톱 조건(7점 도달)에도 `oppStuckAndSelfNoCredit` 분기 추가. **`score.js` 무수정**. 회귀 테스트 JOKER-014~017 (joker-adhoc 19/19 PASS). |

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
    ├── score.unit.spec.js   — score.js 단위 테스트 (52개, 서버 불필요)
    ├── game.unit.spec.js    — game.js 단위 테스트 (27개, 서버 불필요)
    ├── e2e-scenarios.spec.js — 브라우저 E2E 시나리오 (25개, 서버 필요)
    ├── v8-qa.spec.js        — 구버전 QA 테스트 (레거시)
    └── screenshots/         — E2E 스크린샷 출력
```

## 서버 실행 (테스트용)

```bash
# 포트 3013으로 단독 실행 (playwright.config.js 기준)
node matgo/server.js --port 3013

# playwright.config.js baseURL: http://localhost:3013
```

## 테스트 실행

```bash
cd C:/antigravity/minigame-paradise/matgo

# 단위 테스트 (서버 불필요, 빠름)
npx playwright test tests/score.unit.spec.js tests/game.unit.spec.js --reporter=list

# E2E 시나리오 테스트 (서버 3013 포트 사전 실행 필요)
node server.js --port 3013 &
npx playwright test tests/e2e-scenarios.spec.js --reporter=list

# 전체 실행 (단위 + E2E, 총 104개)
npx playwright test tests/score.unit.spec.js tests/game.unit.spec.js tests/e2e-scenarios.spec.js --reporter=list
```

### 테스트 현황 (2026-05-30 기준)

| 파일 | 테스트 수 | 상태 | 서버 필요 |
|------|----------|------|----------|
| `score.unit.spec.js` | 52개 | ✅ 전부 PASS | ❌ |
| `game.unit.spec.js` | 27개 | ✅ 전부 PASS | ❌ |
| `e2e-scenarios.spec.js` | 25개 | ✅ 전부 PASS | ✅ (3013) |
| **합계** | **104개** | **✅ 전부 PASS** | |

#### E2E 시나리오 요약 (e2e-scenarios.spec.js)

| 구간 | ID | 내용 |
|------|-----|------|
| §1 기본 연결 | E-01~E-06 | P1/P2 입장, 초기 상태, DOM ID 확인 |
| §2 기본 플레이 | E-07~E-11 | 카드 클릭, 턴 교대, perPoint 동기화, 재연결 |
| §3 inject 모달 | E-12~E-18 | go-stop, shake, floor-choice, kkeut 모달 주입 테스트 |
| §4 박 시나리오 | E-19~E-22 | 피박·멍박·광박·고박 round-modal 텍스트 검증 |
| §5 안정성 | E-23~E-25 | 콘솔 에러, AI봇 연결, 레이아웃 스크린샷 |
| §6 연출-STATE 순서 | E-26~E-27 | (2026-06-13) E-26: chooseFloor 통합 STATE 1회 송신(획득 순간이동 방지) / E-27: 뻑 토스트 DECK_LAND 이후 표시 타이밍 |
| §7 fly-출처 정합 | E-28~E-29 | (2026-06-13) E-28: 강탈 피 fly가 oppCapturedZone에서 출발(더미 아님, startFlyFromDeck 미호출) / E-29: 흔들기로 낸 카드 fly가 myCards에서 출발(startFlyFromDeck 미호출) |

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

1. **`shake_decision` phase는 더 이상 존재하지 않는다.** (2026-05-31 제거) 흔들기는 클라이언트 모달로만 처리. 서버 phase·메시지에서 참조하지 말 것. 기존 e2e `E-13/E-15/E-16` inject 시나리오가 의존했으므로 후속 정리 필요.
2. **사통 phase `awaiting_sangtong`은 `isPauseForUserInput()`이 true를 반환해야 한다.** (`server.js`) 누락 시 사통 모달 표시 중에도 서버가 봇 턴을 진행해 상태 깨짐.
3. **첫뻑 보너스(`firstPpeokBonus`)는 base 가산 7점이지 multiplier가 아니다.** `applyFinalMultipliers`에서 base에 +7 후 박/고 multiplier가 곱해진다. 순서 바뀌면 점수 폭주.
4. **폭탄 후 `g.bombExtraDraw` 플래그는 두 번째 `drawAndResolve` 직후 반드시 false로 리셋.** 미리셋 시 `chooseFloorSteps`에서 무한 3회차 진입 가능.
5. **`floorSlotMap`은 클라이언트 클로저 변수.** 서버 STATE에 슬롯 정보를 싣지 말 것. `ROUND_START`/`GAME_START` 수신 시 반드시 `clear()`.
6. **`g.firstPpeokBy`/`g.pendingSangtong`/`g.shakeAsked`/`g.bombExtraDraw`는 `startRound`에서 초기화.** 누락 시 라운드 간 상태 누수.
7. **사통과 흔들기는 같은 라운드에 동시 충족 가능** (같은 월 4장 ⊃ 같은 월 3장). 사통 우선, `continue` 선택 시에만 흔들기 검사가 카드 클릭 시점에 작동.
8. **조커(`type='joker'`)는 month=0이라 화투 매치 로직에 자연 차단되지만, 새 기능 추가 시 month 기반 카운트(`monthCount[c.month]`)에 들어가면 의도치 않은 결과 가능**. 사통 검사(`checkSangtongOpportunity`)와 폭탄 검사(`bombableMonths`)는 month=0 제외 안전망 적용 또는 자연 차단(조커 2장뿐) 검증됨. 신규 month 기반 검사는 명시적으로 `c.type !== 'joker'`로 거르거나 `c.month > 0` 가드 추가.
9. **덱은 50장**(화투 48 + 조커 2). 기존 테스트의 `g.deck.length === 20` 같은 상수는 모두 22로 갱신됨. 새 단위 테스트 작성 시 50/22 기준.
10. **조커는 폭탄 대상이 아니다.** 폭탄 매치 카운트(`handMonthCount[m] === 3 && floorMonthCount[m] === 1`)에서 m='0' 제외. 또한 4장 도달 자체가 불가능(조커 2장뿐) — 이중 안전망.
11. **`createGame()`/`startRound()` 후 `floor.length`는 더 이상 항상 8이 아니다** (2026-06-03 룰 정정). 바닥에 조커가 떨어졌으면 `applyFloorJokerToFirst`가 선공자 `captured`로 옮겨 floor가 6~8 가변, captured 총합 = `8 - floor.length`. 새 테스트는 `total === 50` 일관성 기준으로 검증할 것. `deck.length === 22`는 불변(분배 후 잔여).
12. **라운드 종료 조건은 양쪽 모두 0이 아니어도 트리거된다** (2026-06-08 조커 라운드 종료 불가 수정). `finishTurn`은 "한쪽의 `손+credit=0`이고 상대의 `credit=0`"이면 자동 종료한다. 조커 케이스 B로 한쪽 손이 +1 누적되어도 영구히 막히지 않도록 보장. 종료 직전 `flushHandsToCaptured(g)`가 양쪽 잔여 손을 각자 captured로 이동(조커는 `type='joker'` 그대로 → `score.js`가 피 +2 자동 처리, 일반 카드는 type별 분류). **양쪽 모두 0+0+0+0 케이스에서도 동일하게 endRoundDraw 호출되어 기존 동작 회귀 보장** (JOKER-017). 폭탄 권리(credit > 0) 우선이므로 한쪽 손+credit=0이어도 상대 credit > 0이면 종료 X. `score.js` 무수정.
13. **chooseFloor 단계 broadcast는 choice_made까지 보류한다** (2026-06-13 연출-STATE 순서 수정). `server.js` `shouldDeferBroadcast`는 `k === 'choice_made'`를 **반드시 보류 대상에 포함**해야 한다. `chooseFloorSteps` 단계1(srcCard + chosen captured 이동) STATE를 단계2(덱 뒤집기)까지 묶어 **통합 STATE 1회만 송신**해야 클라가 fly 연출을 온전히 수행한다. 단계1을 즉시 broadcast하면 낸 카드가 fly 없이 순간이동한다. (과거 JSDoc엔 의도가 적혀 있었으나 return 조건에서 누락된 드리프트였음.) 회귀 게이트: e2e **E-26**.
14. **ppeok(뻑) 토스트는 즉시 띄우지 않고 DECK_LAND까지 보류한다** (2026-06-13 연출-STATE 순서 수정). `client.js`는 ppeok 종류 lastAction의 토스트를 `pendingPpeokToast`로 보관 → 덱 뒤집기 fly의 **DECK_LAND 전환 시점에 flush**(덱이 바닥에 쌓인 뒤 표시). 안전망으로 CLEANUP 시 flush, 라운드 시작(`NEW_ROUND`/`ROUND_START`) 시 폐기한다. ppeok 외 토스트는 기존 타이밍 유지. 즉시 표시로 되돌리면 "뻑!"이 카드 내자마자 떠서 연출 순서가 어긋난다. 회귀 게이트: e2e **E-27**.
15. **강탈 피 fly는 oppCapturedZone에서 출발한다** (2026-06-13 fly-출처 정합 수정). `client.js`는 `la.stoleFromOpp > 0`일 때 `stolenPiIds = prevCapIds[opp] ∩ newCapIds[me]`로 빼앗긴 피 카드 ID를 식별 → 신규 `startFlyFromOppCaptured`로 **상대 획득 영역에서 출발**시킨다. 이때 `drewIds`(이번 턴 더미에서 뽑은 카드)는 **반드시 제외**(자연 덱 fly와 분리)하고, `resolvePendingFlies`의 handLike 분기에 `origin: 'opp-captured'`를 포함해야 보류 해소 시에도 출발점이 유지된다. 누락 시 빼앗은 피가 더미에서 날아온다. 회귀 게이트: e2e **E-28**.
16. **흔들기/모달 경유로 낸 카드는 renderMyHand가 DOM 재생성 시 pendingFlies 카드에 visibility:hidden을 재적용해야 한다** (2026-06-13 fly-출처 정합 수정). SHAKE STATE 도착이 `renderMyHand`(`innerHTML = ''`)로 fly clone의 원본 DOM을 무효화하므로, `renderMyHand` 말미에 `pendingFlies` 보유 카드의 재생성 DOM에 `visibility:hidden`을 다시 걸어 클론 원본을 손 위치에 보존해야 **내 손(myCards)에서 출발**한다(옵션 A). 누락 시 낸 카드가 더미에서 날아온다. 회귀 게이트: e2e **E-29**.
