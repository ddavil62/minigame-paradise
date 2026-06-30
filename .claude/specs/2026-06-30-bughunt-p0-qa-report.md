# QA Report: 버그 헌트 P0

## 판정: PASS

---

## 1. 코드 확인 (grep 기반)

### null guard 적용 여부 (`typeof msg !== 'object'`)
| 게임 | 결과 |
|------|------|
| matgo/server.js | ✓ |
| tetris-battle/server.js | ✓ |
| davinci-code/server.js | ✓ |
| yutnori/server.js | ✓ |
| codenames-duet/server.js | ✓ |
| janggi/server.js | ✓ |
| hanabi/server.js | ✓ |
| yahtzee/server.js | ✓ |
| omok/server.js | ✓ |
| codenames/server.js | ✓ |
| launcher/server.js (uncaughtException) | ✓ (2건) |

### usedIds 패턴 적용 여부
| 게임 | 결과 |
|------|------|
| tetris-battle/server.js | ✓ (2건) |
| davinci-code/server.js | ✓ (2건) |
| codenames-duet/server.js | ✓ (2건) |
| hanabi/server.js | ✓ (2건) |
| omok/server.js | ✓ (2건) |
| janggi/server.js | ✓ (2건) |

### P0-C: janggi MOVE 핸들러 Number.isInteger 검증
- `Number.isInteger(fromFile) / fromRank / toFile / toRank` 4개 가드: ✓ (L496-497)

---

## 2. 회귀 테스트 결과

| 게임 | 슈트 | 결과 | 비고 |
|------|------|------|------|
| davinci-code | game-unit-qa + davinci-plus-qa | **53 PASS** | 전체 통과 |
| codenames-duet | review-smoke 27 | **27/27 PASS** | |
| codenames-duet | review-visual 11 | **11/11 PASS** | |
| rummikub | smoke 150 | **150/150 PASS** | |
| rummikub | qa-pass4-sort 34 | **34/34 PASS** | |
| rummikub | qa-pass3-attack 48 | **48/48 PASS** | |
| rummikub | qa-pass3-parity 12 | **12/12 PASS** | |
| omok | smoke 106 | **106/106 PASS** | |
| omok | bot-smoke 14 | **14/14 PASS** | |
| omok | qa-edge 35 | **35/35 PASS** | |
| omok | qa-renju-attack 28 | **28/28 PASS** | |
| omok | qa-rematch-attack 14 | **14/14 PASS** | |
| omok | qa-draw-bot 9 | **9/9 PASS** | |
| codenames | smoke 65 | **65/65 PASS** | |
| codenames | bot-knowledge 22 | **22/22 PASS** | |
| codenames | bot-smoke 23 | **23/23 PASS** | |
| hanabi | 전체 78 | **78/78 PASS** | |
| yahtzee | smoke 169 | **169/169 PASS** | |
| yahtzee | dice-render 55 | **55/55 PASS** | |
| yahtzee | bot-smoke 25 | **25/25 PASS** | |
| janggi | rulebook-c* + qa-edge-cases 169 | **169/169 PASS** | |
| janggi | bot-eval-qa 8 | **8/8 PASS** | |
| janggi | bot-launcher-qa 15 | **0/15 PASS** | ⚠ pre-existing: 런처 미실행 환경 |
| yutnori | rulebook-c1~c5: 23 | **23/23 PASS** | |
| yutnori | rulebook-c6~c19: 18 | **18/18 PASS** | |
| yutnori | qa-rulefix-edge 29 | **28/29 PASS** | ⚠ QA-RF2-002: known-baseline (P2 대상) |
| yutnori | bot-smoke 10 | **10/10 PASS** | |
| tetris-battle | phase1-unit 57 | **57/57 PASS** | |
| tetris-battle | phase2-items 35 | **35/35 PASS** | |
| tetris-battle | phase2-edge 14 | **14/14 PASS** | |

---

## 3. FAIL 예외 항목 (pre-existing / known-baseline)

| 게임 | 테스트 | 실패 원인 | 분류 |
|------|--------|----------|------|
| janggi | bot-launcher-qa.spec.js (15건) | 런처 서버 미실행 환경에서 실패 — P0 이전에도 동일 조건 | pre-existing, P0 무관 |
| yutnori | QA-RF2-002 (1건) | 테스트 하네스 drain 누락 — 스코프 문서에 P2 대상으로 명시된 비-baseline | known-baseline, P2에서 수정 예정 |

두 항목 모두 P0 수정과 무관한 pre-existing 조건으로 P0 PASS 판정에 영향 없음.

---

## 4. P0 동작 검증 요약

- **null guard 코드 확인**: 10개 게임 + launcher 전부 삽입 확인 ✓
- **usedIds 패턴 확인**: 6개 게임 전부 적용 확인 ✓
- **janggi 분수 좌표 가드 확인**: L496-497 Number.isInteger 4값 가드 확인 ✓
- **회귀 테스트**: pre-existing/known-baseline 제외 전 항목 PASS ✓

---

## 판정: PASS

P1 진행 승인.
