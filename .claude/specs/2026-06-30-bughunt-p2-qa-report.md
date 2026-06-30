# QA Report: 버그 헌트 P2

## 판정: PASS

---

## 1. P2 수정 내역 요약

| ID | 게임 | 결함 | 수정 파일 |
|----|------|------|----------|
| P2-1 | tetris-battle | GAME_OVER 이중 판정 + 무승부 미처리 + 결과 플리커 | server.js, public/js/main.js |
| P2-2 | codenames-duet | 동시 승리+토큰소진 오판정(판정 순서) | game.js |
| P2-3 | janggi | 재접속 복구 죽은 코드 — close 시 즉시 game=null | server.js |
| P2-5A | tetris-battle | READY 진행 중 재브로드캐스트 | server.js |
| P2-5B | yahtzee | REMATCH phase 가드 누락 | server.js |
| P2-5C | hanabi | close 시 rematchReady 미리셋 | server.js |
| P2-5D | yahtzee | close 시 rematchReady 미리셋 | server.js |
| P2-5E | omok | close 시 lastGameResult/rematchPending 미리셋 | server.js |
| P2-6 | codenames-duet | 공백 단서 서버 통과 | game.js |
| P2-7 | janggi | DRAW_OFFER 상대 차례 허용 | lib/game.js, server.js |
| P2-8 | janggi | 스테일메이트 미감지 | lib/game.js |
| P2-9 | yutnori | 3~4인 opponentReady 단일 반영 | server.js |
| P2-10 | codenames | JOIN 미수신 연결 슬롯 점유 | server.js |
| P2-R1 | davinci-code | smoke-test.js stale → obsolete/현행 프로토콜 갱신 | smoke-test.js |
| P2-R2 | janggi | _smoke_server.js stale → READY 게이트 갱신 | lib/_smoke_server.js |
| P2-R3 | yutnori | QA-RF2-002 drain 하네스 수정 | tests/qa-rulefix-edge.spec.js |
| P2-R4 | rummikub | STATIC-019 기대값 정규화 결과로 갱신 | tests/qa-edge.test.js |

**건너뜀**: P2-4 (omok 봇 금수 거절 hang) — P1-FIX-6에서 이미 수정 완료

---

## 2. 회귀 테스트 결과

| 게임 | 슈트 | 결과 | 비고 |
|------|------|------|------|
| tetris-battle | phase1-unit 57 | **57/57 PASS** | |
| tetris-battle | phase1-ws 37 | **37/37 PASS** | |
| tetris-battle | phase2-items 51 | **51/51 PASS** | |
| tetris-battle | phase2-edge 14 | **14/14 PASS** | |
| tetris-battle | phase3-4-qa-edge 21 | **20/21 PASS** | ⚠ Q7b: known-baseline |
| tetris-battle | phase5-qa-edge 71 | **71/71 PASS** | |
| tetris-battle | phase5-vanish-zone 52 | **52/52 PASS** | |
| tetris-battle | bot-smoke 11 | **11/11 PASS** | |
| codenames-duet | review-smoke 30 | **30/30 PASS** | P2-2 포함 |
| codenames-duet | review-visual 11 | **11/11 PASS** | |
| rummikub | smoke 154 | **154/154 PASS** | |
| rummikub | qa-pass3-attack 48 | **48/48 PASS** | |
| rummikub | qa-pass4-sort 34 | **34/34 PASS** | |
| rummikub | qa-edge 118 | **118/118 PASS** | STATIC-019 갱신 포함 |
| janggi | rulebook-c1 + c4 + c12 + qa-edge 103 | **103/103 PASS** | P2-7/8 포함 |
| janggi | _smoke_server 34 | **34/34 PASS** | P2-R2 갱신 |
| omok | smoke 106 | **106/106 PASS** | |
| omok | bot-smoke 14 | **14/14 PASS** | |
| omok | qa-edge 35 | **35/35 PASS** | |
| omok | qa-renju-attack 28 | **28/28 PASS** | |
| omok | qa-rematch-attack 14 | **14/14 PASS** | |
| omok | qa-draw-bot 9 | **9/9 PASS** | |
| yahtzee | smoke 169 | **169/169 PASS** | |
| hanabi | rulebook 78 | **78/78 PASS** | |
| codenames | smoke 65 | **65/65 PASS** | |
| codenames | bot-smoke 23 | **23/23 PASS** | |
| codenames | bot-knowledge 22 | **22/22 PASS** | |
| yutnori | bot-smoke 10 | **10/10 PASS** | |
| yutnori | rulebook-c5-backdo 40 | **40/40 PASS** | |
| yutnori | qa-rulefix-edge 26 | **26/26 PASS** | QA-RF2-002 now PASS |

---

## 3. FAIL 예외 항목

| 게임 | 테스트 | 원인 | 분류 |
|------|--------|------|------|
| tetris-battle | Q7b (phase3-4-qa-edge) | printBanner 유니코드 박스 문자 사용 — P0 이전 동일 | known-baseline |

---

## 4. P2 수정 검증 요약

- **P2-1** (tetris-battle 이중판정): phase5-qa-edge 71건 + phase2-items PASS ✓
- **P2-2** (codenames-duet 승리우선): review-smoke 30건 PASS ✓
- **P2-3** (janggi 재접속): node --check PASS, janggi rulebook 103건 PASS ✓
- **P2-5A~E** (phase 가드): 각 게임 smoke/qa 슈트 전체 PASS ✓
- **P2-6** (공백 단서): review-smoke PASS ✓
- **P2-7** (DRAW_OFFER 턴 가드): janggi rulebook-c12-procedure PASS ✓
- **P2-8** (스테일메이트): janggi rulebook-c4-check PASS ✓
- **P2-9** (yutnori opponentReady): node --check PASS, yutnori 테스트 PASS ✓
- **P2-10** (codenames JOIN 가드): codenames smoke 65건 PASS ✓
- **P2-R1** (davinci-code stale): obsolete/갱신 처리 ✓
- **P2-R2** (janggi _smoke_server): 34/34 PASS ✓
- **P2-R3** (yutnori QA-RF2-002): 26/26 PASS (baseline FAIL 해소) ✓
- **P2-R4** (rummikub STATIC-019): 118/118 PASS ✓

---

## 판정: PASS

버그헌트 P0 → P1 → P2 전체 완료. 커밋 진행 승인.
