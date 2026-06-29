# 버그 헌트 전체 스코프 — 미니게임 천국 (2026-06-30)

## 개요

버그 헌트 워크플로우(wwsgdr15r) 산출물. 10종 게임(맞고 미커버) 대상으로 적대적 검증을 수행한 결과 **확정 버그 27건 + 비-baseline 회귀FAIL 4건**을 식별했다. 이 문서는 전체 트리아지 표와 4개 페이즈 배정 근거를 정리한다.

---

## 워크플로우 개요

- **커버된 게임**: tetris-battle · davinci-code · yutnori · codenames-duet · janggi · hanabi · yahtzee · rummikub · omok · codenames (10종)
- **미커버**: matgo (별도 P3 재헌트 대상)
- **확정 버그**: 27건 (HIGH 13 / MED 5 / LOW 9)
- **비-baseline 회귀FAIL**: 4건 (stale 테스트 파일)
- **known-baseline 회귀FAIL**: 1건 (tetris-battle Q7b, 별도 처리 불필요)
- **검증 방법**: 격리 포트(3312~3421 범위) + raw WS 클라이언트 스니펫 + 게임 로직 직접 import

---

## 전체 트리아지 표

| # | 게임 | 버그 ID | 제목 요약 | Severity | 카테고리 | 페이즈 |
|---|------|---------|----------|----------|---------|-------|
| 1 | tetris-battle | #1 | null WS 프레임 1건 → 서버 프로세스 크래시 (DoS) | HIGH | 입력검증/예외 | **P0-A** |
| 2 | tetris-battle | #2 | 동시 토프아웃 → 먼저 죽은 쪽이 승자 + 무승부 미처리 | MED | 승패판정/동시성 | P2 |
| 3 | tetris-battle | #3 | 진행 중 READY 중복 전송 → 게임 재시작 | LOW | 턴페이즈/상태손상 | P2 |
| — | tetris-battle | [회귀] | Q7b printBanner 정규식 오탐 (known-baseline) | known-baseline | — | 제외 |
| 4 | davinci-code | #1 | 상대 미공개 조커 ★ 시각·와이어 노출 (마스킹 붕괴) | HIGH | 상태손상/마스킹누설 | **P1** |
| 5 | davinci-code | #2 | 뽑은 카드 isJoker 상대에게 노출 (스펙 위반) | HIGH | 마스킹누설/룰위반 | **P1** |
| 6 | davinci-code | #3 | p1 이탈·재접속 시 playerId p2 중복 → 게임 데드락 | HIGH | 동시성/상태손상 | **P0-B** |
| — | davinci-code | [회귀] | smoke-test.js stale (구 auto-JOIN 프로토콜) | 비-baseline | 테스트 정리 | P2 |
| 7 | yutnori | #1 | null WS 프레임 1건 → 서버 프로세스 크래시 (DoS) | MED† | 입력검증/예외 | **P0-A** |
| 8 | yutnori | #2 | 백도 큐 잔류 + 모든 말 완주 → 영구 턴 데드락 | HIGH | 턴페이즈/상태손상 | **P1** |
| 9 | yutnori | #3 | 3~4인 READY_STATE opponentReady 1명만 반영 | LOW | 상태표시 | P2 |
| — | yutnori | [회귀] | QA-RF2-002 테스트 하네스 미배수(drain 누락) | 비-baseline | 테스트 정리 | P2 |
| 10 | codenames-duet | #1 | 비대칭 카드 그린 더블크레딧 → 중립 클릭으로 승리 | HIGH | 룰위반/승패판정 | **P1** |
| 11 | codenames-duet | #2 | p1 이탈·재접속 시 playerId p2 중복 → 단서 데드락 | HIGH | 동시성/상태손상 | **P0-B** |
| 12 | codenames-duet | #3 | 동시 승리+토큰소진 → 패배로 오판정 (순서 결함) | MED | 승패판정/턴페이즈 | P2 |
| 13 | codenames-duet | #4 | 공백-only 단서가 서버 검증을 통과 (표시 결함) | LOW | 입력검증 | P2 |
| 14 | janggi | #1 | 분수 좌표 MOVE 1건 → 서버 프로세스 크래시 | HIGH | 입력검증/상태손상 | **P0-C** |
| 15 | janggi | #2 | 재접속 복구 분기가 dead code → 진행 중 게임 소실 | MED | 동시성/상태손상 | P2 |
| 16 | janggi | #3 | 상대 차례에 무승부 제안 허용 (§8-7 룰 위반) | LOW | 룰위반/턴페이즈 | P2 |
| 17 | janggi | #4 | 스테일메이트 미감지 → 시간패로만 해소 (최대 ~11.5분 대기) | LOW | 엣지/승패판정 | P2 |
| — | janggi | [회귀] | _smoke_server.js stale (READY 게이트 변경 이후 갱신 안 됨) | 비-baseline | 테스트 정리 | P2 |
| 18 | hanabi | #1 | null WS 프레임 1건 → 서버 프로세스 크래시 (DoS) | HIGH | 입력검증/예외 | **P0-A** |
| 19 | hanabi | #2 | 잔존 rematchReady → 핸드셰이크 우회 게임 시작 | LOW | 동시성/상태손상 | P2 |
| 20 | yahtzee | #1 | REMATCH phase 가드 없음 → 진행 중 게임 강제 리셋 | LOW | 턴페이즈/상태손상 | P2 |
| 21 | yahtzee | #2 | opponent leave 시 rematchReady 미초기화 → 1회 REMATCH로 신규 게임 시작 | LOW | 상태손상/동시성 | P2 |
| 22 | rummikub | #1 | 첫 등판 턴 레이오프 허용 → 즉시 승리 가능 (룰 위반) | HIGH | 룰위반/승패판정 | **P1** |
| — | rummikub | [회귀] | qa-edge STATIC-019 stale (normalizeSetTiles 도입 후 기대값 변경) | 비-baseline | 테스트 정리 | P2 |
| 23 | omok | #1 | p1 이탈 후 신규 접속 → playerId p2 중복 → 게임 시작 데드락 | HIGH | 동시성/상태손상 | **P0-B** |
| 24 | omok | #2 | lastGameResult 미초기화 → 새 페어링에서 REMATCH 오작동 | LOW | 상태손상/룰위반 | P2 |
| 25 | omok | #3 | 봇이 금수(쌍삼) 거절 후 STATE 미수신 → 봇 영구 정지 | MED | 봇/동시성 | **P1** |
| 26 | codenames | #1 | 봇 스파이마스터 0장 공개 사이클 → 무재단서 영구 데드락 | HIGH | 봇/동시성 | **P1** |
| 27 | codenames | #2 | JOIN 미수신 연결이 슬롯 점유+호스트 가능 (§13-8 non-blocker) | LOW | 입력검증/상태손상 | P2 |

† yutnori #1은 동일 메커니즘이나 정상 LAN 클라이언트의 우발 발생 가능성 낮아 MED 하향(tetris-battle·hanabi는 HIGH 유지). P0-A 수정 대상은 severity에 무관하게 동일.

---

## 비-baseline 회귀FAIL 4건

| 게임 | 파일 | 원인 | 처리 |
|------|------|------|------|
| davinci-code | `tests/smoke-test.js` | 구 auto-JOIN 프로토콜 기준, READY 게이트 도입 후 갱신 안 됨 | P2: 파일 삭제 또는 READY 게이트 맞게 재작성 |
| yutnori | `tests/qa-rulefix-edge.spec.js` QA-RF2-002 | 테스트 하네스가 READY_STATE를 drain하지 않아 stale 메시지를 leaked=true로 오검출 | P2: drain 로직 보강 |
| janggi | `lib/_smoke_server.js` (P2) 19건 | READY 게이트 도입 후 JOIN 즉시 배치흐름 가정 테스트 갱신 안 됨 | P2: READY 게이트 반영 재작성 |
| rummikub | `tests/qa-edge.test.js` STATIC-019 | normalizeSetTiles 도입 후 기대 타일 순서 변경, 테스트 기대값 갱신 안 됨 | P2: 기대값 수정 |

---

## 페이즈 정의 및 배정 근거

### P0 — 시스템 결함 (본 스펙 담당)

**범위**: 여러 게임 공통으로 발동하는 서버 프로세스 크래시 / 데드락 패턴. 단일 악성 메시지 1건으로 런처 전체(11개 게임)가 다운되는 DoS 경로가 포함된다.

**배정 건수**: 3개 결함 패턴, 영향 게임 합계 최대 18 게임·게임 인스턴스

| 결함 | 확정 게임 | 감사로 추가 발견 | 합계 |
|------|---------|--------------|------|
| P0-A: null WS 프레임 크래시 | tetris-battle, yutnori, hanabi | matgo, davinci-code, codenames-duet, janggi, yahtzee, omok, codenames (+ 런처 안전망) | 10개 게임 수정 + 런처 |
| P0-B: playerId 중복 데드락 | davinci-code, codenames-duet, omok | tetris-battle, hanabi, janggi | 6개 게임 수정 |
| P0-C: 분수 좌표 크래시 | janggi | — | 1개 게임 수정 |

**P0 먼저 처리하는 근거**:
1. **영향 최대**: P0-A는 인증 불필요 단일 4바이트 메시지로 런처 프로세스 전체(11게임)가 다운됨. LAN에 접근 가능한 누구나 트리거 가능.
2. **수정 단순**: 각 game/server.js의 `JSON.parse` try/catch 직후 1줄 null guard(`if (!msg || typeof msg !== 'object' || ...) return;`) 추가. P0-B는 yutnori FIX-1 패턴(usedIds) 이식. P0-C는 janggi MOVE 핸들러에 `Number.isInteger` 2줄 추가.
3. **P1/P2 수정의 전제**: P0-A가 열려있으면 P1/P2 검증 중 누군가 null 프레임을 보내 서버가 죽는다.

### P1 — 게임별 HIGH 결함

**범위**: 게임의 핵심 룰·마스킹·AI 동작을 결정적으로 붕괴시키는 HIGH/MED 버그. 별도 Planner 담당.

| 결함 | 게임 | Severity |
|------|------|---------|
| 상대 미공개 조커 ★ 노출 (#1) | davinci-code | HIGH |
| 뽑은 카드 isJoker 노출 (#2) | davinci-code | HIGH |
| 그린 더블크레딧 (중립 클릭 승리) (#1) | codenames-duet | HIGH |
| 백도 큐 잔류 영구 데드락 (#2) | yutnori | HIGH |
| 첫 등판 레이오프 허용 즉시 승리 (#1) | rummikub | HIGH |
| 봇 금수 거절 후 영구 정지 (#3) | omok | MED |
| 봇 스파이마스터 무재단서 데드락 (#1) | codenames | HIGH |

### P2 — MED/LOW + 회귀/Stale

**범위**: 게임별 MED/LOW 결함 + 비-baseline 회귀FAIL(stale 테스트). 별도 Planner 담당.

포함 건: tetris-battle #2·#3 / yutnori #3·[회귀] / codenames-duet #3·#4·[회귀] / janggi #2·#3·#4·[회귀] / hanabi #2 / yahtzee #1·#2 / rummikub [회귀] / omok #2 / codenames #2 / davinci-code [회귀]

### P3 — 맞고 재헌트 + 잔여

**범위**: 이번 버그 헌트에서 미커버된 맞고(matgo)를 별도 적대적 검증 세션에서 헌트. 잔여 LOW 항목 재검토.

---

## 공통 회귀 게이트 원칙

P0 수정 완료 후 모든 기존 테스트 슈트를 **격리 포트**에서 재실행하여 PASS 확인 후 QA 전환.

| 게임 | 기존 슈트 | 기준 |
|------|---------|------|
| matgo | game.unit+score.unit 98 · e2e-scenarios 30 · joker-adhoc 24 · sseul 11 · bombdup 7 · floor-joker-smoke 5 | 합계 ≥175 PASS |
| tetris-battle | phase1-unit·phase1-ws·phase2-items·phase2-edge·phase3-polish·phase4-launcher·phase5-vanish·phase5-qa-edge (~315) + bot-smoke 11 | Q7b known-baseline 제외 전부 PASS |
| davinci-code | game-unit-qa 53 · davinci-plus-qa 25 | 78 PASS |
| yutnori | 서버리스 338 · E2E 25 · bot-smoke 10 | 373 PASS |
| codenames-duet | review-smoke 27 · review-visual 11 | 38 PASS |
| janggi | 룰북/단위 246 · bot-eval 8 · P1 lib 73 | 327 PASS |
| hanabi | 유닛31+WS7+QA엣지8+E2E23+가이드9 | 78 PASS |
| yahtzee | smoke 169 · dice-render 55 · bot-smoke 25 | 249 PASS |
| rummikub | smoke 150 · qa-pass4-sort 34 · qa-pass3-attack 48 · qa-pass3-parity 12 | 244+ PASS |
| omok | smoke 106 · qa-edge 35 · qa-renju-attack 28 · qa-rematch-attack 14 · qa-draw-bot 9 · bot-smoke 14 · E2E+모바일 4 | 210 PASS |
| codenames | smoke 65 · bot-knowledge 22 · bot-smoke 23 · E2E 12 | 122 PASS |

---

## Art Director 실행 계획

- visual_change: none
- AD 모드 1 (에셋 컨셉): 해당 없음 — 전 페이즈 순수 백엔드 서버 코드 수정
- AD 모드 2 (에셋 검증): 해당 없음
- AD 모드 3 (UI 레이아웃): 해당 없음
- 멀티 페이즈 시 AD 반복 계획: P0/P1/P2/P3 모두 visual_change: none, AD 전 페이즈 불필요

---

## 제약사항

- P0 수정은 기존 테스트 슈트를 깨지 않아야 한다 (게임별 회귀 게이트 참조).
- rummikub/server.js L290-297은 이미 null guard가 적용돼 있으므로 P0-A 수정에서 제외한다.
- matgo는 P0-A·P0-B 각각 이미 방어 패턴이 적용돼 있음을 코드에서 확인했다 (P0-A: rummikub처럼 아직 미적용 — 별도 확인 필요 / P0-B: `players.find(p => p.id === 'p1') ? 'p2' : 'p1'` 패턴으로 SAFE). Coder는 matgo/server.js WS 핸들러를 감사해 P0-A 가드 필요 여부를 확인한다.
- P0-B에서 janggi는 `?side=han/cho` 쿼리 기반 재접속 경로(L327-328)가 별도로 있으나, 쿼리 없는 신규 접속은 여전히 L358 length-based 배정이라 취약하다. usedIds 패턴으로 통일한다.
- `launcher/server.js`에 `process.on('uncaughtException')` 추가 시, 실제 예외를 모두 삼켜 디버깅을 가리지 않도록 **WS 메시지 핸들러 내부 예외에 한정**한 범위로 제한한다 (게임별 server.js null guard가 1차 방어, launcher의 uncaughtException은 최후 안전망).
