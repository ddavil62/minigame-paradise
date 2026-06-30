# QA Report: 버그 헌트 P1

## 판정: PASS

---

## 1. P1 수정 내역 요약 (HIGH 결함 6건)

| ID | 게임 | 결함 | 수정 파일 |
|----|------|------|----------|
| P1-FIX-1 | davinci-code | 조커 마스킹 — 상대 미공개 조커 isJoker 노출 | game.js |
| P1-FIX-2 | codenames-duet | 그린 더블크레딧 — 중립 클릭 시 반대면 green도 greenFound++ | game.js |
| P1-FIX-3 | rummikub | 첫 등판 전 레이오프 — 기존 보드 세트에 타일 추가 후 endTurn 검증 누락 | game.js, tests/smoke.test.js |
| P1-FIX-4 | yutnori | 백도 데드락 — autoDiscardUnusableBackdos에서 passTurn 2회 호출 | server.js |
| P1-FIX-5 | codenames | 봇 stateKey 충돌 — 0-공개 패스 반복 시 stateKey 중복 | game.js, bot.js |
| P1-FIX-6 | omok | 봇 렌주 무한행 — 렌주 거부 착수 재시도 없음 | bot.js |

### 추가 수정 사항 (QA 중 발견)

| 파일 | 내용 |
|------|------|
| rummikub/game.js | P1 코더가 삽입한 `moveTile` hand→기존세트 즉시 차단 가드 제거 — 기존 `computeInitialMeldScore` #2-2 방어선(endTurn)으로 충분 |
| rummikub/tests/smoke.test.js | RUMMI-038: moveTile ok:true + endTurn initial_meld_short으로 동작 수정 |
| yutnori/server.js | `autoDiscardUnusableBackdos` 내 `passTurn()` 직접 호출 제거 — 호출처(MOVE_PIECE/CHOOSE_PATH) 기존 체크에 위임 |
| codenames-duet/tests/review-smoke.mjs | REVIEW-005: `g.phase = 'guessing'` → `'playing'` 수정 (guessCard가 playing 상태만 처리) |

---

## 2. 회귀 테스트 결과

| 게임 | 슈트 | 결과 | 비고 |
|------|------|------|------|
| davinci-code | game-unit-qa.spec.js + davinci-plus-qa.spec.js | **53 PASS** | |
| codenames-duet | review-smoke.mjs 30 | **30/30 PASS** | REVIEW-005 추가 |
| codenames-duet | review-visual.mjs 11 | **11/11 PASS** | |
| rummikub | smoke 154 | **154/154 PASS** | RUMMI-038 4건 재작성 |
| rummikub | qa-pass3-attack 48 | **48/48 PASS** | (P1 코더 가드 오류 수정 후) |
| rummikub | qa-pass4-sort 34 | **34/34 PASS** | |
| rummikub | qa-pass3-parity 12 | **12/12 PASS** | |
| yutnori | bot-smoke 10 | **10/10 PASS** | |
| yutnori | rulebook-c1~c5 (yut.unit + backdo) 79 | **79/79 PASS** | YR-C5-014 포함 |
| yutnori | rulebook-c6~c10 51 | **51/51 PASS** | |
| yutnori | qa-rulefix-edge 26 | **25/26 PASS** | ⚠ QA-RF2-002: known-baseline (P0 때 동일) |
| codenames | smoke 65 | **65/65 PASS** | |
| codenames | bot-smoke 23 | **23/23 PASS** | |
| codenames | bot-knowledge 22 | **22/22 PASS** | |
| omok | smoke 106 | **106/106 PASS** | |
| omok | bot-smoke 14 | **14/14 PASS** | |
| omok | qa-edge 35 | **35/35 PASS** | |
| omok | qa-renju-attack 28 | **28/28 PASS** | |
| omok | qa-rematch-attack 14 | **14/14 PASS** | |
| omok | qa-draw-bot 9 | **9/9 PASS** | |

---

## 3. FAIL 예외 항목

| 게임 | 테스트 | 원인 | 분류 |
|------|--------|------|------|
| yutnori | QA-RF2-002 | 테스트 하네스 drain 누락 — P0 QA 때부터 동일 known-baseline. P2 대상 | known-baseline |

---

## 4. P1 수정 검증 요약

- **P1-FIX-1** (davinci-code 조커 마스킹): davinci-plus-qa E-17 포함 53건 PASS ✓
- **P1-FIX-2** (codenames-duet 더블크레딧): review-smoke REVIEW-005 포함 30건 PASS ✓
- **P1-FIX-3** (rummikub 레이오프): smoke RUMMI-038 + qa-pass3-attack #2 섹션 PASS ✓
- **P1-FIX-4** (yutnori 백도 데드락): YR-C5-014 PASS ✓
- **P1-FIX-5** (codenames 봇 stateKey): codenames smoke/bot-smoke/bot-knowledge 110건 PASS ✓
- **P1-FIX-6** (omok 봇 렌주 무한행): omok bot-smoke + qa-renju-attack 42건 PASS ✓

---

## 판정: PASS

P2 진행 승인.
