# Changelog

## [2026-07-27] — 리포트 9건 규칙·연출 통합 수정

사용자 리포트 `2, 3, 4, 16, 17, 18, 19, 20, 24`를 조커·강탈·폭탄·선공·멍박·UI 연출 흐름으로 통합 수정했다.

### 규칙

- 일반 피가 부족하면 쌍피와 조커도 카드 한 장 단위의 합법 강탈 대상으로 사용한다.
- 덱에서 뒤집힌 조커는 손이 아니라 captured로 이동하고 상대 피 강탈 뒤 한 장을 추가로 뒤집는다.
- 손에서 조커를 사용한 것만으로 턴을 끝내거나 중간 점수·고/스톱·9월 선택을 판정하지 않고 같은 플레이어 입력을 유지한다.
- 폭탄은 통상 뒤집기 뒤 추가 두 장을 같은 턴에 해결한다. 중간에 바닥 선택이 발생해도 진행 주체와 남은 횟수를 보존한다.
- 직전 라운드 승자가 다음 라운드와 새 게임의 선공·딜러를 유지한다. 무승부는 P1을 사용한다.
- 승자 끗이 7장 이상이면 패자 끗 수와 무관하게 멍박 ×2를 적용한다.

### UI

- 강탈 fly는 중앙 덱이 아니라 렌더 교체 전 상대 captured 카드의 실제 DOM 좌표에서 시작한다.
- 액션 효과는 카드 포획·부착 완료 뒤 카드 fly보다 전면에 표시한다.
- 9월 규칙 선택, 바닥 선택, 사통, 고/스톱, 라운드 결과처럼 즉시 선택이 필요한 UI가 열리면 남아 있는 액션 효과를 종료한다.
- 규칙 선택 및 고/스톱 버튼 네 개의 가시성과 중앙 hit-test를 Chromium에서 확인했다.

### 검증

- 제품 수용기준 관련 자동 검증 `151/151 PASS`
  - 규칙·점수·리포트 회귀 `108/108`
  - 조커·폭탄·쓸 ad-hoc `42/42`
  - 안정화 Chromium UI `1/1`
- 카드 총량 50장과 카드 ID 중복 없음 불변식 PASS.
- AD 모드 3 재검수 APPROVED, QA PASS.

### 알려진 테스트 하네스 경고

- `tests/e2e-scenarios.spec.js`의 공통 입장 헬퍼는 현재 닉네임·자동 READY 게이트 이전 흐름을 사용하여 E-02에서 대기한다.
- `tests/entry-ui-qa.spec.js` 일부 케이스는 자동 READY를 수동 READY로 기대한다.
- `tests/floor-joker-smoke.mjs`는 현재 입장 게이트를 완료하지 않아 상태 메시지 대기에서 timeout된다.
- `tests/report-ui-regression.spec.js`는 테스트 상태 주입 직후 초기 fly 안정화 대기가 없어 간헐적으로 타이밍 assertion이 흔들릴 수 있다. 제품 입력은 애니메이션 중 차단되며 안정화 Chromium 경로는 통과했다.

### 참고

- 구현: `.Codex/specs/2026-07-27-minigames-phase-d-report.md`
- UI 검수: `.Codex/specs/2026-07-27-minigames-phase-d-ui-review.md`
- QA: `.Codex/specs/2026-07-27-minigames-phase-d-qa.md`
- 에셋 변경 없음

---

## [2026-06-20] — 조커 손패 fly 2~3회 중복 재생 수정 (케이스 A)

손에서 조커를 냈을 때(케이스 A, `joker_play`) captured로 날아가는 fly가 2~3회 재생되던 버그를 `public/client.js` 조커 fly 등록부에 이중 가드를 추가해 라운드당 정확히 1회만 등록되도록 수정. 서버(`game.js`/`server.js`) 무수정. 수정 2파일: `public/client.js`, `tests/e2e-scenarios.spec.js`.

### 수정 (`public/client.js`)
- 증상: 손 조커를 내면 captured로 카드가 2~3회 날아감.
- 근본 원인: 서버가 같은 `joker_play` STATE를 2~3회 송신하는데, 클릭 핸들러 `sendPlay`(client.js:1815)가 모든 카드 클릭 시 `startFlyFromHand`로 **fly #1을 선등록**한다. 따라서 첫 STATE 렌더에서 이미 `alreadyFlying=true`인데, 기존 코드는 skip만 하고 **액션 키를 안 남겨** 후속 렌더(pendingFlies가 빈 시점)에서 두 번째 fly가 재등록됐다. 단순 중복 가드만으론 부족했고 **키 가드가 실질 해결책**.
- 수정: 조커 fly 등록부(client.js 644~671)에 **이중 가드** — ① `alreadyFlying = pendingFlies.some(f => f.cardId === la.card.id)`(choice srcCard 패턴), ② `jokerActionKey = la.kind + '|' + la.card.id + '|' + la.player`(기존 토스트 `prevActionKey` 패턴). 액션 키가 미처리일 때만 진입하되, `alreadyFlying`이 false일 때만 `_jokerFlyId` 설정(STATE가 fly 등록)하고 **항상 `lastJokerFlyActionKey`에 키 기록**(처리됨 표시). `newCardIds.delete(la.card.id)`는 fly 등록 여부와 무관하게 항상 수행(조커가 drewIds→더미 fly로 오분류 방지).
- 모듈 변수 `lastJokerFlyActionKey` 신설(약 137) + `GAME_START`(약 343)·`ROUND_START`(약 354)에서 리셋(`floorSlotMap.clear` 등과 동일 위치).
- 케이스 B(`joker_flip`)는 가드 조건(`la.kind==='joker_play'`) 밖이라 무영향.

### 추가 (테스트)
- `tests/e2e-scenarios.spec.js`: **E-32**에 origin='hand' 조커 fly가 **정확히 1개**(중복 재생 금지) 회귀 단언 추가. 기존 "조커 captured 안착(fade 없음)" 단언 유지.

### 검증
- 단위 `score.unit`+`game.unit` **100/100** + e2e `E-01~E-32` **32/32**(fly 게이트 E-26~E-32 7/7, E-32 강화) + adhoc joker **24/24**/sseul **11/11**/bombdup **7/7**/floor-joker **5/5**(포트 3098) = **179건 전부 PASS**, 회귀 0.
- QA PASS(결함 0). visual_change: ui(연출 횟수 교정 — 신규 시각 요소·레이아웃 변경 없음, 정적 captured 표시 E-32 안착 동일 유지).

### 비고
- 서버는 여전히 동일 `joker_play` STATE를 2~3회 송신하나(설계상 보류 대상 아님) 클라 가드가 멱등 처리하므로 증상 완전 해소. 서버 broadcast 횟수 자체 축소는 별도 발주(본 작업 범위 외 — 스펙이 클라 전용 수정 지시).
- 참고: 스펙 `.claude/specs/2026-06-20-matgo-joker-double-fly-spec.md`, 리포트 `.claude/specs/2026-06-20-matgo-joker-double-fly-report.md`.

---

## [2026-06-17] — 버그 A: 바닥 우측/스택 슬롯 fly 착지 좌표 어긋남 수정

직전 B2(2026-06-16) fly 직선화가 못 잡은 **바닥 우측·스택 슬롯**에서 fly 클론 도착 좌표가 좌상단으로 밀리던 버그. `cloneNode(true)`가 바닥 슬롯 카드의 인라인 `transform: translate(-50%,-50%) [rotate(Ndeg)]`까지 복사해 도착 좌표를 어긋나게 한 것이 근본 원인. 서버·룰·점수 무수정(연출만).

### 수정
- `public/client.js` fly 생성 5개 함수(6개 클론 지점)에서 `cloneNode` 직후 `clone.style.transform = ''` 초기화:
  - `startFlyFromHand` 통상 경로(`transition:'none'` **앞에** 배치 — 즉시 반영)·폴백 경로(R5/R8 통합 STATE)
  - `startFlyFromOppHand` / `startFlyFromOppCaptured` / `startFlyFromDeck` / `spawnCardClone`(pair 클론 헬퍼)
- `startFlyFromDeck`의 DECK_FLIP `rotateY(-180deg)` 별도 설정과 무충돌(이후 재설정 경로 확인).
- `flyTo`·CSS `.flying-card` 무수정.

### 추가 (테스트)
- `tests/fly-right-slot-visual.spec.js` 신규 — 우측(VIS-A1)·스택(VIS-A2)·좌측(VIS-A3) 슬롯 fly 착지 정합 시각 검증.

### 검증
- 정량: 미수정 시 좌 ~30px / 상 ~42.5px 어긋남 → 수정 후 fly clone rect와 style.left/top 오차 **0.02px**, `computed transform=none`(VIS-A1 우측 dx=150 / VIS-A3 좌측 dx=-150 실측).
- 단위 **100/100** + adhoc joker **24**/sseul **11**/bombdup **7**/floor-joker **5** + e2e **32/32**(E-26~E-32 fly 게이트 회귀) + VIS **3/3** = 전부 PASS.
- 서버 로직 무변경이라 단위/adhoc 회귀 0. QA PASS(결함 0), AD3 APPROVED.

## [2026-06-17] — 신규 버그 4건 수정 (R5/R6 choice 손패 fly + R7 자뻑 풀이 2피 룰 + R8 조커 captured 표시)

직전 B1(2026-06-16)이 손패 fly 누락을 남긴 R5/R6, 자뻑 풀이 룰 변경 R7, 조커 사용 후 사라짐 R8을 수정. R8은 1차 QA FAIL(조커 증발) → 재수정으로 해소. 수정 4파일: `game.js`, `public/client.js`, `tests/game.unit.spec.js`, `tests/e2e-scenarios.spec.js`.

### 수정 (R5 — 바닥 2장 먹기 손패 fly 누락)
- 증상: 바닥 2장 먹기(choice 흐름)에서 내가 낸 손패가 손에서 captured로 fly되지 않고 순간이동.
- 근본 원인: 직전 B1 수정이 `choiceFloorSrcCardId`로 손패 srcCard를 더미 fly(`drewIds`)에서 **제외만** 하고, 올바른 손 fly(HAND_THROW)를 등록하지 않음.
- 수정: `public/client.js` `renderState`에서 `s.choiceFloorSrcCardId`를 `_choiceSrcFlyId`로 수집 → **`renderMyHand` 이후** `startFlyFromHand` 등록(원본 DOM 존재 필요) + `flyTargetIds`에 추가. origin='hand'로 손에서 captured로 부딪힘 연출 정상화.

### 수정 (R6 — 선택 시 fly 순서)
- 손 fly(`startFlyFromHand`)를 덱 fly(`startFlyFromDeck`)보다 **먼저** 등록 → "내 낸 패 먼저 captured, 선택 바닥패 나중"이 어긋나던 것을 HAND_THROW→DECK 시퀀스 자연 정합으로 해소. R5 수정에 연동.

### 변경 (R7 — 자뻑 풀이 2피, 룰 변경)
- **룰 변경**: 내가 만든 뻑을 **내가** 풀 때만(`ppeokFlags[month]===playerId`) 상대 피 **2장**, **상대(타인) 뻑** 풀이는 1장 유지. 기존 "자뻑 동일 처리(보너스 없음)" 폐기.
- `game.js`에 `isPpeokOwner(g, playerId, month)` 헬퍼 신설 → 뻑 풀이 stealPi **3지점**(resolveCardOnFloor 3매칭 / drawAndResolve sweep_from_flip / bonusFlipSteps bonus_ppeok_sweep)에서 `const count = isPpeokOwner ? 2 : 1`을 계산해 `stealPi(..., count)` + `lastAction.stoleFromOpp = count`에 동일 변수 사용.
- **반드시 `delete g.ppeokFlags[month]` 이전에 판정**(delete 후 소유자 식별 불가). `game.js` line 17 "자뻑 동일 처리" 주석 갱신.
- `score.js` 무수정. 회귀: 단위 **G-43a**(자뻑 2피, `stoleFromOpp===2`) / **G-43b**(타인 뻑 1피, `stoleFromOpp===1`).

### 수정 (R8 — 조커 사용 후 조커 사라짐, 2단계)
- 증상: 조커를 내면 손에서 날아간 뒤 captured에 안 보이고 fade(사라짐).
- (1) fly 등록: `public/client.js` `joker_play` STATE에서 조커를 손→captured `startFlyFromHand`(HAND_THROW) 등록(`_jokerFlyId`, `drewIds` 제외 + `flyTargetIds` 추가, origin='hand').
- (2) **핵심(선존 결함, 1차 QA FAIL 지점)**: `renderCaptured`가 captured 그룹을 `{gwang,kkeut,tti,pi}`로 분류하는데 **joker 키가 없어** `if (groups[effectiveType])` 가드가 조커(`type='joker'`)를 드롭 → 도착지 DOM 미생성 → `resolvePendingFlies`의 `locateCard`가 못 찾아 `fadeEntries`로 분류 → fly clone fade. → 조커를 `effectiveType='pi'`로 **pi 그룹에 합류**(카드는 `.joker-card` 스타일 유지, 피로 변환 X) + pi count reduce에 `if (c.type==='joker') return sum + 2`(score.js `piCount += joker.length*2`와 일치).
- 단일 `renderCaptured` 수정으로 **케이스 A(`joker_play`)·케이스 B(`joker_flip`)·바닥 조커 자동획득(`floor_joker_to_first`)** captured 표시 일괄 정상화(셋 다 captured에 `type='joker'` 카드를 넣는 동일 경로). `score.js` 무수정(클라 표시만 정합).

### 변경 (테스트)
- 단위: **G-43a/G-43b** 신규(R7) → game.unit 42→44, 합계 98→100.
- e2e: **E-31**(R5 — 손패 srcCard fly가 myCards 출발, startFlyFromDeck 미호출) / **E-32**(R8 — 조커 fly가 myCards 출발 + `#my-captured-zone` 안착, fade 없음) 신규 → 30→32.

### 검증
- 단위 **100/100**(G-43a/b 포함) + adhoc joker **24/24**/sseul **11/11**/bombdup **7/7**/floor-joker **5/5** + e2e **32/32**(E-31/E-32 + 회귀 게이트 E-26~E-30) + TDZ **1/1** + QA 능동 probe **3/3**(임시, 후 삭제) = **183건 전부 PASS**.
- R8은 1차 QA FAIL(조커 증발) → `renderCaptured` 재수정으로 해소. QA 능동 probe: 조커 케이스 A 실플레이(captured DOM 안착·"피 3"·턴 유지·콘솔에러 0), 직접 주입(조커+피2 → "피 4"), 쌍피 회귀(조커 분기 오염 0) 전부 PASS.
- QA PASS(결함 0), AD3 APPROVED(2회 — fly 순서 + pi 그룹 fan 안 joker-card 혼재 레이아웃, WARN 2건 비강제: fan 겹침 28px·조커1장→"피 2" 인지 불일치는 쌍피 기존 패턴과 동일).

### 비고
- R8 재수정은 `renderCaptured` 단일 함수(2개 인접 블록)만 변경. R5/R6/R7 코드는 회귀 방지를 위해 무변경.
- 참고: 스펙 `.claude/specs/2026-06-16-matgo-bugfix-r5r8-spec.md`, 리포트 `.claude/specs/2026-06-16-matgo-bugfix-r5r8-report.md`, QA(2차) `.claude/specs/2026-06-16-matgo-bugfix-r5r8-qa-report-2.md`, AD(2차) `.claude/specs/2026-06-16-matgo-bugfix-r5r8-ad-review-2.md`.

---

## [2026-06-16] — 버그 4건 수정 (B1/B2/B3 fly 연출 + B4 조커 케이스 A 턴 룰)

fly 연출 오류 3건(B1/B2/B3)과 조커 케이스 A 룰 오류(B4)를 수정. 수정 3파일: `game.js`, `public/client.js`, `tests/joker-adhoc.mjs`.

### 수정 (B1 — 바닥 2장 먹기 fly 출처)
- 증상: `awaiting_floor_choice` 통합 STATE(쓸/pair_from_flip 등)에서 **내가 손으로 낸 srcCard가 더미서 나온 것처럼** 보이던 버그.
- 근본 원인: `client.js`의 `la.kind==='choice_made'` 가드가 같은 STATE의 sseul/pair_from_flip lastAction으로 덮여 무효화됨.
- 수정: `game.js`에 `pendingChoiceSrcCardId` 필드 신설 — `startRound` 초기화(`game.js:138`) / `chooseFloorSteps` 단계1에서 `wasFromHand ? srcCard.id : null` 설정(`game.js:392`) / `finishTurn`(`game.js:856`)·`finishTurnKeepTurn`(`game.js:767`) 리셋. `snapshotForPlayer`가 `choiceFloorSrcCardId`로 노출(`game.js:1332`) → `client.js`(567~569)가 이 필드로 srcCard를 `drewIds`에서 제외(손패 출처=HAND_THROW, 덱만 DECK_THROW). `la.kind==='choice_made'` 폴백 유지(client.js 571~573).

### 수정 (B2 — fly 경로 어긋남 + 텔레포트)
- `client.js` `flyTo`(1499~1505)가 **left/top만 transition**(width/height 동시 transition 제거). 덱·바닥·손패 카드가 모두 60×85로 동일해 크기를 즉시 적용해도 점프 0.
- DECK_THROW(client.js 1577~1581)를 **더블 rAF**로 처리해 snap 제거.

### 수정 (B3 — 쓸 연출 미적용)
- 서버 쓸 룰(`stealPi`)은 정상(G-40 입증). 증상은 B1과 동일한 통합 STATE 연출 누락이었음.
- **B1 수정으로 강탈 피 fly(origin='opp-captured') + "N월 쓸!" 토스트가 정상화됨. 서버 무수정.**

### 변경 (B4 — 조커 케이스 A: 턴 유지 룰)
- **룰 변경**: 기존 "조커 손에서 내면 턴 교대"(`finishTurn`)를 **턴 유지**로 변경.
- 케이스 A 처리 끝에 신규 `finishTurnKeepTurn`(`game.js:710~768`) 호출 — 점수/고스톱/술잔/라운드종료 평가는 `finishTurn`(`game.js:775~858`)과 동일하되 마지막 `g.turn = ...`(턴 교대) 한 줄만 제거 → **turn=본인 유지, phase=awaiting_play**.
- 조커 captured + 상대 피 1 + 더미 1장 손 보충은 유지. 케이스 B(더미 뒤집은 게 조커)는 현행 유지(범위 외).
- `finishTurnKeepTurn`은 `finishTurn` 복사본이라 향후 `finishTurn` 로직 변경 시 양쪽 동기화 필요(JSDoc 명시, 향후 `finishTurn(g,pid,{keepTurn})` 옵션 파라미터 리팩토링 권장 — QA LOW).

### 변경 (테스트)
- **joker-adhoc**: JOKER-002/003/009 턴 단언을 턴 유지로 수정 + 신규 **JOKER-002a**(phase=awaiting_play 단언). JOKER-001/REG-G-01의 stale 단언(`deck===22`, 2026-06-15 리필 룰로 폐기)을 현행 룰(`floor===8`, `deck===22-N`)로 정정. joker-adhoc **24/24**.

### 검증
- joker-adhoc **24/24** + sseul-adhoc **11/11** + bombdup-adhoc **7/7** + floor-joker-smoke **5/5** + game.unit+score.unit **98/98** + e2e-scenarios **30/30**(회귀 게이트 E-26~E-30 포함) + QA 능동 probe **10/10**(임시, 후 삭제) + QA 시각 e2e **2/2**(임시, 후 삭제) = **191건 전부 PASS**.
- QA 능동 탐색: 보충 조커 무한루프 없음(P1), 조커 7점 도달 시 고/스톱 정상(P2), 술잔 분기(P3), 라운드 종료(P4), 더미 빈 케이스(P5), 연속 조커 2장(P6), 쓸 통합 STATE 3필드 공존(S1), srcCard 제외 교집합 독립성(S2) 전부 PASS.
- QA PASS(결함 0), AD3 APPROVED(DECK_THROW stateTimer rAF2 외부 = WARN 1건, 비강제).

### 비고
- B3는 서버 무수정으로 B1 수정에 연동 해소(STATE-레벨 시뮬레이션 재입증).
- QA LOW 2건(비강제 후속 권장): DECK_THROW `stateTimer`를 rAF2 내부로 이동, `finishTurnKeepTurn`을 옵션 파라미터로 리팩토링.
- 참고: 스펙 `.claude/specs/2026-06-16-matgo-bugfix-4-spec.md`, QA `.claude/specs/2026-06-16-matgo-bugfix-4-qa-report.md`.

---

## [2026-06-15] — 선공 바닥 조커 연출 수정 + 바닥 리필 룰

선공 바닥 조커 처리의 연출 버그(사안 A)를 수정하고, 조커 제거 후 바닥을 항상 8장으로 채우는 리필 룰(사안 B)을 신설. `score.js` 무수정.

### 수정 (사안 A — 연출)

#### 선공 바닥 조커 fly 출처 (`public/client.js`)
- 증상: 선공 바닥 조커가 더미에서 captured로 fly되며 손패 근처로 보이던 연출 버그(라운드 오프닝인데 일반 획득처럼 날아옴).
- 수정: `client.js:599` `isRoundStart` 판정 조건에 `floor_joker_to_first`를 추가 → 조커·리필 카드 모두 **fly 없이 appear**(round_start 오프닝과 동일 처리).

### 변경 (사안 B — 바닥 리필 룰)

#### `applyFloorJokerToFirst` (`game.js`)
- 바닥 조커 N장을 선공자(`firstTurn`) `captured`로 이동한 뒤, `deck.pop()`(drawAndResolve와 동일 방향)으로 한 장씩 꺼내 floor에 push해 **floor 길이를 8로 리필**한다 (이전: floor가 6~8로 줄어듦).
- **연쇄 정책**: 리필 카드가 또 조커면 그것도 선공자 captured로 이동 + 재보충(비조커가 안착할 때까지). 조커 2장뿐이라 **최대 2회** — 무한루프 불가. *(2026-06-15 사용자 확정 — 룰북 미명시 설계 결정이나 제품 오너 승인 완료.)*
- **deck 소진 방어**: `deck.length > 0` 가드로 deck이 비면 루프 종료(작은 픽스처에서 floor < 8 허용).
- `lastAction.count`/반환값은 선공자가 가져간 조커 **총수(연쇄 포함)**로 일관. 토스트 "선공 바닥 조커 N장 획득!".
- 불변식: `floor.length === 8`(deck 충분 시), `deck.length === 22 - N`(보충 횟수 N, 최대 2), 카드 총합 50 불변. **`deck.length === 22`는 더 이상 불변이 아니며 `22 - N` 가변**(직전 22 고정 → 가변).

### 추가/변경 (테스트)
- **joker-adhoc**: JOKER-010~013 갱신(리필 반영) + 신규 **JOKER-018~021**(리필/연쇄/deck 소진 방어). joker-adhoc **23/0**.
- **floor-joker-smoke**: `floor === 8` 단언으로 갱신. smoke **5/5**(floor 8 / total 50).
- **e2e**: **E-03**(`deck 20~22` = `22 - N`) / **E-04**(`floor === 8` 고정) / **E-08**(`/test/inject` 상태 고정으로 결정화 → flaky 해소).
- **단위**: G-01 등 갱신, game.unit + score.unit **98/0**.

### 검증
- joker-adhoc **23/0**, 단위 **98/0**, floor-joker-smoke **5/5**(floor 8 / total 50), e2e **3회 연속 30/0/0**.
- 불변식 확인: `floor === 8`, `deck === 22 - N`, 카드 총합 50.

### 비고
- `score.js` 무수정(조커 피 +2 계산 그대로).
- 함정 11(`matgo/CLAUDE.md`) 현행화: floor는 리필로 항상 8, deck는 `22 - N` 가변, 불변식은 카드 총합 50.

---

## [2026-06-13] — 레거시 shake_decision/pendingShake 데드코드 정리

2026-05-31 흔들기 모달 이전 이후로 남아 있던 레거시 잔재(죽은 `shake_decision` 분기 + `pendingShake` 필드)를 제거. **동작 변화 없음(프로덕션 no-op)** — 제거 대상은 모두 도달 불가 분기/미사용 필드였다. 커밋 `513a603`.

### 변경
- **`game.js`**: `shakeDecision` 내 죽은 `shake_decision` 분기 제거 + `pendingShake` 필드 전체 제거(`@property` 주석 / `createGame` / `startRound` / `snapshotForPlayer`).
- **`server.js`**: `inject`의 `pendingShake` 대입 제거(`shake_decision` 제거 설명 주석은 유지).
- **`smoke-test.js`**: `shake_decision` 조건 제거.
- **adhoc (bombdup / joker / sseul)**: `makeGame` 헬퍼의 `pendingShake` 제거.

### 수정 (테스트)
- **`game.unit.spec.js`**: 죽은 분기 검증용 레거시 테스트 **G-22 / G-23 제거** + G-02 단언을 `awaiting_play` 단일화 + `makeGame`의 `pendingShake` 제거. game.unit **42개**(직전 44에서 -2). 현행 흔들기 동작은 **G-38**이 커버.

### 유지
- `shakeDecision` 함수(현행 SHAKE 핸들러), `client.js`의 `pendingShakeCardId`(로컬 변수) — 현행 코드라 보존.

### 검증
- grep live(소스) `shake_decision`/`pendingShake` **0건**.
- 단위 game.unit(42) + score.unit(56) = **98 passed**.
- adhoc **42/42** PASS.
- e2e **30 passed / 0 skipped / 0 failed** (E-15 / E-16 PASS).

---

## [2026-06-13] — E-15/E-16 흔들기 E2E 현행 모달 흐름 재작성(skip 해제)

직전 flakiness 안정화 때 `test.skip` 처리했던 E-15·E-16을 현행 흔들기 모달 흐름 기준으로 재작성해 복원. 게임 로직·서버 무변경, e2e 테스트 코드만 수정.

### 변경 (`tests/e2e-scenarios.spec.js`)
- **E-15 / E-16**: 제거된 `shake_decision` phase 의존을 걷어내고 현행 흐름으로 재작성.
  - `/test/inject`로 P1 손에 **1월 3장(+5월 1장)**, 바닥 **1월 0장**(폭탄 회피) 주입.
  - `waitForFlyIdle` 대기 → **1월 카드 클릭**.
  - **E-15**: `#shake-modal` 표시 검증.
  - **E-16**: `#btn-shake` 클릭 → 모달 닫힘 + `shaking.p1` 반영(배지 '흔들기 ×2') 검증.
- `test.skip` 해제. `shake_decision` phase 미참조(참조 금지 유지).

### 검증
- 전체 e2e-scenarios **3회 연속 30 passed / 0 skipped / 0 failed** (이전 28 passed / 2 skipped → 30 passed / 0 skipped).
- 회귀 게이트 **E-03 / E-04 / E-26~E-30 PASS**.

### 비고
- `game.js` / `score.js` / `cards.js` / `server.js` 무변경. e2e 테스트 코드만 수정.

---

## [2026-06-13] — e2e 스위트 flakiness 안정화

e2e-scenarios 스위트의 비결정적 fail↔pass 스왑(flakiness)을 근본 원인 2계층으로 분리해 해소. 게임 로직(룰·점수)은 무변경, 테스트 인프라(서버 테스트 엔드포인트 + e2e 헬퍼/단언)만 수정.

### 근본원인 및 수정

#### 계층1 — 공유 룸 teardown 레이스 (`server.js` + `tests/e2e-scenarios.spec.js`)
- 원인: 전체 스위트가 단일 공유 룸 + `workers:1` 순차 실행이라, 직전 테스트의 룸 잔여 상태가 다음 테스트로 새어 실행 순서에 따라 결과가 바뀜.
- 수정: `server.js`에 **`POST /test/reset`** 신설(룸 강제 초기화, 테스트 격리 전용·프로덕션 무영향). e2e에 **`beforeEach`(reset)** + **`afterEach`(reset 안전망)** 추가.

#### 계층2 — 오프닝 fly + 무가드 click 레이스 (`tests/e2e-scenarios.spec.js`)
- 원인: 랜덤 분배로 바닥에 조커가 깔리면 오프닝에 fly 연출(`floor_joker_to_first`)이 발생하는데, 이를 기다리지 않고 카드를 클릭하면 fly race 발생. 또한 무가드 `click`이 조커/흔들기·폭탄/바닥선택 분기에 걸려 비결정적.
- 수정: **`waitForFlyIdle`** 헬퍼 신설 + `joinAndStartGame` 말미에서 호출(오프닝 fly 대기). 카드 클릭은 **`pickSafePlayCard`** 헬퍼로 교체(조커/흔들기·폭탄/바닥선택 분기 회피).

### 변경 (stale 단언 정정)
- **E-03**: 덱 카운트 단언 20 → **22** (조커 2장 포함 50장 덱 기준).
- **E-04**: 바닥 카운트 단언 8 → **6~8 범위** (바닥 조커 선공 자동 획득으로 floor 가변). *(2026-06-15 바닥 리필 룰로 `floor === 8` 고정으로 재정정됨 — 아래 2026-06-15 섹션 참조.)*

### 변경 (skip 처리)
- **E-15 / E-16**: 제거된 `shake_decision` phase의 `/test/inject`에 의존 → **`test.skip`** 처리. 현행 흔들기 모달 기준 E2E 재작성은 별도 발주.

### 검증
- 전체 e2e-scenarios **3회 연속 28 passed / 2 skipped(E-15·E-16) / 0 failed** — 완전 결정성 확인.
- `game.unit` + `score.unit` **100/100 PASS**.
- 회귀 게이트 **E-26~E-30 PASS**.

### 비고
- `game.js` / `score.js` / `cards.js` 무변경. `server.js`는 `POST /test/reset` 테스트 엔드포인트만 추가(프로덕션 경로 무영향).

---

## [2026-06-13] — 폭탄 손 3장 fly 출처 수정 (버그6)

사용자 실플레이 피드백. 게임 로직(점수·룰)은 무변경, 클라이언트 fly 애니메이션 출발 지점만 교정.

### 수정

#### 버그6 — 폭탄 손 3장 fly 출처 (`public/client.js`)
- 증상: 폭탄 발동 시 가져가는 손 3장이 내 손(myCards)이 아니라 **더미(덱)에서 날아옴**.
- 원인: 내 폭탄 경로(`la.player === me`)가 상대 폭탄용 `oppHandOrigin` 분기(`la.player === oppId`)에 잡히지 않아 손 3장 fly 출발점 등록이 누락됨.
- 수정: `btnBombConfirm`(~1765) + `btnBomb` 폴백(~1790)에서 `sendBomb` 호출 직전에 해당 월 손 3장에 `startFlyFromHand`를 호출 → **내 손(myCards)에서 출발**.

### 추가 (`tests/e2e-scenarios.spec.js`)
- **E-30**: 버그6 — 폭탄 손 3장 fly가 `myCards`에서 출발하고 `startFlyFromDeck`이 호출되지 않음을 검증.

### 검증
- 신규 E2E **E-30 PASS** + 회귀 게이트 **E-26~E-29 PASS** (E-26~E-30 5/5).
- `game.unit` + `score.unit` **100 passed / 0 failed**.

### 선재/flaky 실패 (이번 변경과 무관)
> ⚠️ 아래는 본 변경의 회귀가 아님 — baseline 동일.
- E-03/E-04/E-07/E-08/E-15/E-16/E-23 잔여 실패는 기존 stale/flaky로 baseline 동일. 폭탄 핸들러와 코드 경로 무관.

### 비고
- `game.js` / `score.js` / `cards.js` / `server.js` 무변경. 룰·점수·프로토콜 영향 없음. 클라이언트 fly 출발점만 교정.

## [2026-06-13] — fly-출처 정합 2건 (강탈 피 / 흔들기 낸 카드)

사용자 실플레이 피드백 2건. 게임 로직(점수·룰)은 무변경, 클라이언트 fly 애니메이션 출발 지점만 교정.

### 수정

#### 버그4 — 강탈 피 fly 출처 (`public/client.js`)
- 증상: 조커/쪽/뻑풀이/따닥/쓸/폭탄 등 상대 피를 빼앗는 연출에서, 빼앗은 피가 상대 획득 영역이 아니라 **더미(덱)에서 날아옴**.
- 수정: `la.stoleFromOpp > 0`일 때 `stolenPiIds = prevCapIds[opp] ∩ newCapIds[me]`로 빼앗긴 피 카드 ID를 식별 → 신규 `startFlyFromOppCaptured`로 **상대 획득 영역(oppCapturedZone)에서 출발**. `drewIds`(이번 턴 더미에서 뽑은 카드)는 제외해 자연 덱 fly와 분리. `resolvePendingFlies`의 handLike 분기에 `origin: 'opp-captured'`를 포함해 보류 fly 해소 시에도 출발점 유지.

#### 버그5 — 흔들기 낸 카드 fly 출처 (`public/client.js`)
- 증상: 같은 월 3장 흔들기 모달을 경유해 카드를 낼 때, 낸 카드가 내 손이 아니라 **더미에서 날아옴**.
- 원인: SHAKE STATE 도착이 `renderMyHand`(`innerHTML = ''`)로 fly clone의 원본 DOM을 무효화 → 출발점 좌표가 손 카드 위치를 못 잡음.
- 수정(옵션 A): `renderMyHand` 말미에 `pendingFlies` 보유 카드의 재생성된 DOM에 `visibility:hidden`을 재적용 → 클론 원본이 손 위치에 보존되어 **내 손(myCards)에서 출발**.

### 추가 (`tests/e2e-scenarios.spec.js`)
- **E-28**: 버그4 — 강탈 피 fly가 `opp-captured-zone`에서 출발하고 `startFlyFromDeck`이 호출되지 않음을 검증.
- **E-29**: 버그5 — 흔들기로 낸 카드 fly가 `myCards` 카드 위치에서 출발하고 `startFlyFromDeck`이 호출되지 않음을 검증.

### 검증
- 신규 E2E **E-28 / E-29 둘 다 PASS** + 회귀 게이트 **E-26 / E-27 PASS**.
- `game.unit` + `score.unit` **100 passed / 0 failed**.
- QA 판정: **PASS** (신규 결정적 회귀 0건, baseline 대조 입증).

### 선재/flaky 실패 (이번 변경과 무관)
> ⚠️ 아래는 본 변경의 회귀가 아님 — baseline(git stash) 대조로 확인.
- **선재 실패**: E-03(덱수 20 stale 단언), E-15·E-16(제거된 `shake_decision` inject 의존). baseline 동일 실패.
- **전체 스위트 flakiness**: E-07·E-23 — 공유 룸 + workers:1 순차 실행 순서 의존으로 fail↔pass 스왑. 단독·baseline 모두 PASS.

### 비고
- `game.js` / `score.js` / `cards.js` / `server.js` 무변경. 룰·점수·프로토콜 영향 없음. 클라이언트 fly 출발점만 교정.

### 참고
- 스펙: `.claude/specs/2026-06-13-matgo-fly-origin-steal-shake-spec.md`
- QA: `.claude/specs/2026-06-13-matgo-fly-origin-steal-shake-qa.md`

## [2026-06-13] - 연출-STATE 순서 정합 수정 2건 (chooseFloor 획득 순간이동 / 뻑 토스트 선행)

사용자 실플레이 피드백 2건. 게임 로직(점수·룰)은 무변경, 서버 broadcast 타이밍과 클라이언트 토스트 타이밍만 교정.

### 수정

#### 버그1 — chooseFloor 획득 카드 순간이동 (`server.js`)
- 증상: `awaiting_floor_choice`에서 1장 선택 시, 낸 카드(srcCard)와 선택한 바닥 카드가 fly 연출 없이 순간이동.
- 원인: `shouldDeferBroadcast`의 보류 키 목록에서 `k === 'choice_made'`가 **누락된 드리프트**. JSDoc에는 choice_made 보류 의도가 이미 적혀 있었으나 실제 return 조건에서 빠져 있어, `chooseFloorSteps` 단계1(srcCard + chosen captured 이동) 직후 즉시 broadcast → 클라가 단계1 STATE와 단계2(덱 뒤집기) STATE를 따로 받아 fly가 깨짐.
- 수정: `shouldDeferBroadcast`에 `k === 'choice_made'` 보류 추가. 단계1을 단계2(덱 뒤집기)까지 보류해 **통합 STATE 1회만 송신** → 클라가 fly 연출을 온전히 수행.

#### 버그2 — "뻑!" 토스트 선행 (`public/client.js`)
- 증상: 뻑 발생 시 "뻑!" 토스트가 카드를 내자마자(덱이 바닥에 쌓이기 전에) 떠서 연출 순서가 어긋남.
- 수정: ppeok 종류 lastAction의 토스트를 즉시 표시하지 않고 `pendingPpeokToast`로 보관 → 덱 뒤집기 fly의 **DECK_LAND 전환 시점에 flush**(덱이 바닥에 쌓인 뒤 표시). 안전망으로 CLEANUP 시 flush, 라운드 시작(`NEW_ROUND`/`ROUND_START`) 시 폐기.
- ppeok 외 토스트는 기존 타이밍 그대로 유지.

### 추가 (`tests/e2e-scenarios.spec.js`)
- **E-26**: 버그1 — chooseFloor 선택 시 단계1+단계2 통합 STATE 1회 송신 검증 (획득 카드 순간이동 방지).
- **E-27**: 버그2 — "뻑!" 토스트가 카드 낸 직후가 아니라 덱 바닥 안착(DECK_LAND) 이후 표시되는 타이밍 검증.

### 검증
- 신규 E2E **E-26 / E-27 둘 다 PASS**.
- `score.unit` **52 PASS**, `game.unit` **96 PASS**.
- QA 판정: **PASS**.

### 선재 실패 (이번 변경과 무관 — 기존 이슈, 별도 추적)
> ⚠️ 아래 8건은 본 작업 이전부터 존재하던 baseline 실패로, 이번 연출-STATE 순서 수정의 회귀가 아님을 baseline 대조로 확인함.
- 폭탄 유닛 4건: **G-24 / G-35 / G-36 / G-37** — `g.bombDeckCredit` undefined 참조.
- E2E 4건: **E-03 / E-15 / E-16 / E-23**.

### 비고
- 버그1은 신규 동작 추가가 아니라 JSDoc 의도와 실제 코드의 드리프트를 메우는 수정 — choice_made는 원래 보류 대상으로 설계되어 있었음.
- `game.js` / `score.js` / `cards.js` 무변경. 룰·점수 로직 영향 없음.

### 참고
- 목적 정의서: `.claude/specs/2026-06-13-matgo-anim-state-order-scope.md`
- 스펙: `.claude/specs/2026-06-13-matgo-anim-state-order-spec.md`
- QA: `.claude/specs/2026-06-13-matgo-anim-state-order-qa.md`

---

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
