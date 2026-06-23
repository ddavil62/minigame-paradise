# Implementation Report: 접속 플로우 페이즈2 마무리 (리매치 READY 버그 수정 + 회귀 그린 + 누락 산출물)

## 작업 요약

리매치 READY 게이트 버그(BOT-004 FAIL)를 수정했다. REMATCH 양쪽 동의 처리에서 직전 게임(`game`, phase='ended')을 폐기하지 않아, 양쪽 READY여도 `maybeStartGameIfReady`의 `!game` 조건이 거짓이 되어 createGame이 스킵되고 GAME_START가 발생하지 않던 문제다. `game = null` 1줄을 추가해 초기/리매치가 동일 start-트리거를 타도록 통합했다. 이어 omok 전 회귀를 그린으로 확인하고, 페이즈2 신규 E2E 4건과 리포트·CLAUDE.md 함정 항목을 작성했다.

## 변경된 파일

| 파일 경로 | 작업 유형 | 변경 내용 |
|---|---|---|
| `omok/server.js` | 수정 | REMATCH 핸들러(양쪽 동의 분기)에 `game = null;` 추가 (L433 부근). readySet 초기화 직후, "직전 ended 게임 폐기 → `!game` 통과 → createGame 실행" 주석 포함 (BOT-004 회귀 명시) |
| `omok/tests/qa-rematch-attack.test.js` | 수정 | T6(2회 연속 리매치)의 1차 리매치 후 누락된 READY 송신 추가 (`p1/p2.send({type:'READY'})`, L250 부근). READY 게이트 도입 전 작성된 stale 단언 — STATE를 기다리지만 READY 미송신으로 행(hang)하던 것을 새 흐름에 맞게 갱신 |
| `omok/tests/connection-flow-e2e.spec.js` | 신규 | 페이즈2 사람/봇 흐름 Playwright E2E 4건(CFE-01~04). beforeAll에서 격리 포트 3079 단독 server.js spawn, afterAll 종료 |
| `omok/CLAUDE.md` | 수정 | "변경 시 자주 깨지는 함정" 표에 **READY 게이트** 항목 1줄 추가 |

> 비고: 스펙(`2026-06-22-connection-flow-redesign-spec.md`)이 명세한 서버·클라이언트 READY 게이트 구현(`server.js` readySet/READY/maybeStartGameIfReady, `main.js`/`network.js`/`bot.js`/`index.html`)은 직전 코더 페이즈에서 이미 반영되어 있었다. 본 작업은 그중 **리매치 경로의 game 리셋 누락(BOT-004)** 1건과 stale 테스트 1건만 보정했다.

## 버그 원인·수정 (BOT-004)

- **증상**: 봇 대전 종료 후 리매치 → 양쪽 READY(`readySet.size=2` 로그 확인)인데 GAME_START 미발생 → 봇 타임아웃.
- **원인**: `REMATCH` 양쪽 동의 분기에서 `lastGameResult=null`/`rematchPending=new Set()`/`readySet=new Set()`은 초기화했으나 **`game`은 직전 종료 게임 객체(phase='ended')를 그대로 보유**. 양쪽 READY 시 호출되는 `maybeStartGameIfReady()`의 조건 `players.length===2 && readySet.size===2 && !game` 중 `!game`이 거짓 → createGame 스킵 → GAME_START 미전송.
- **수정**: REMATCH 동의 분기에서 `game = null;` 추가. 이로써 초기 입장과 리매치가 **동일한 start-트리거**(READY 케이스 → `maybeStartGameIfReady` → createGame → GAME_START)를 타게 됐다. 색 배정(`swapColorsForRematch`)은 game 리셋 이전에 호출되므로 순서 충돌 없음.

## WS 프로토콜 (페이즈2 확정 형태, 본 작업 시점)

오목 WS(`/omok/ws` 또는 단독 `/ws`):

| 방향 | 메시지 | 페이로드 | 비고 |
|---|---|---|---|
| C→S | `JOIN` | `{ name }` | 닉네임 전달. 누락 시 서버 `'(알 수 없음)'` 폴백(JOIN 미송신 smoke 하위호환). 봇은 서버가 isBot 기준 `name='AI'` 자동 부여 |
| C→S | `READY` | `{}` | 준비 선언. 양쪽 READY 시 createGame 트리거 |
| C→S | `PLACE`/`RESIGN`/`REMATCH` | 기존 동일 | |
| S→C | `JOINED` | `{ playerId, color, waiting, hostUrl, opponentName? }` | 상대 입장 시 `opponentName` 동봉(JOIN 수신 후 재전송) |
| S→C | `READY_STATE` | `{ myReady, opponentReady }` | 각 플레이어 관점으로 개별 전송 |
| S→C | `GAME_START`/`STATE`/`GAME_OVER`/`REMATCH_*` | 기존 동일 | 초기/리매치 모두 양쪽 READY 후 GAME_START |
| S→C | `OPPONENT_LEFT` | `{ name, message }` | `name` 추가(배너 표시용) |

## 테스트 결과 (전 회귀 + 신규, 실제 실행)

격리 포트 사용(3079/3105/3106/3121 등), 모든 서버 테스트 후 종료. 사용자 launcher(3000)·MCP node 무접촉. 잔여는 TIME_WAIT(자동 소멸)만 확인, LISTEN 좀비 0.

| 스위트 | 결과 | 비고 |
|---|---|---|
| `tests/bot-smoke.test.js` | **14/14 PASS** | **BOT-004 포함**(리매치 후 GAME_START 정상, 새 판 moveCount=0/빈 보드/착수 반영). 파일 단언 수가 14건이라 합계 14 — 스펙 지시 "12/12"는 BOT-004 포함 합격을 뜻하며, 본 스위트 실제 PASS 카운트는 14 |
| `tests/smoke.test.js` | **106/106 PASS** | READY 게이트 반영분 유지(connectPair 등 READY 송신). 최종 카운트 106 |
| `tests/qa-rematch-attack.test.js` | **14/14 PASS** | T6 READY 추가 후 그린(이전 T6 행 해소) |
| `tests/qa-edge.test.js` | **35/35 PASS** | READY 게이트 영향 없음 |
| `tests/qa-renju-attack.test.js` | **28/28 PASS** | 영향 없음 |
| `tests/qa-draw-bot.test.js` | **9/9 PASS** | 영향 없음 |
| `tests/connection-flow-e2e.spec.js` (신규) | **4/4 PASS** | CFE-01~04(아래) |

서버/노드 회귀 합계: 106 + 14 + 14 + 35 + 28 + 9 = **206/206 PASS**. + 신규 E2E 4 = **210 PASS**.

### 신규 E2E 시나리오(CFE)

- **CFE-01** `/omok/?name=철수` 진입 → "친구를 기다리는 중" + "🤖 AI랑 시작" 노출, **카드만으로 AI 미시작**(1.5초 후에도 게임 화면 미전환).
- **CFE-02** "🤖 AI랑 시작" 클릭 → `?mode=ai&name=...` 재접속 → 봇 자동 spawn + 봇 자동 READY + 내 READY → GAME_START → 보드 노출.
- **CFE-03** 2컨텍스트 사람 — A 혼자 대기 → B 합류 시 A의 AI 버튼 소멸 + "나나님과 대전" 표시, 양쪽 상대 이름 표시, A READY → 상호 ✅/⌛(A `my-ready-mark`=✅, B `opp-ready-mark`=✅) + B 준비 전 게임 미시작, B READY → 양쪽 GAME_START.
- **CFE-04** 상대 이탈 → **자동 튕김 0**(3초 후 URL 불변) + "게스트님이 나갔어요" 배너(사라지지 않음) + "로비로 돌아가기" 버튼 → 버튼 클릭 시 `/` 이동.

스크린샷: `omok/tests/screenshots/cfe-01-waiting-solo.png`, `cfe-02-ai-game-start.png`, `cfe-03-human-game-start.png`, `cfe-04-opponent-left-banner.png`.

## 회귀가 READY 게이트와 어떻게 정합되는지 (단언 변경분 사유)

- **smoke(106)**: 이전 코더 페이즈에서 이미 READY 게이트에 맞춰 PLACE 전 READY 송신을 반영해 그린 상태였음. 본 작업에서 추가 변경 없음, 카운트 106 유지.
- **qa-rematch-attack(14)**: connectPair·T4는 이미 READY를 송신하도록 갱신되어 있었으나, **T6의 1차 리매치 직후 READY 송신이 누락**되어 있었다(READY 게이트 도입 전 작성된 `waitState(0)` 단언). READY 게이트에서는 리매치 후에도 양쪽 READY가 있어야 새 판 STATE가 오므로, T6에 `p1/p2.send({type:'READY'})`를 추가했다. 단언 의미(색 swap·id 불변 검증)는 불변, READY 흐름 정합을 위한 시퀀스 보정이다.
- **qa-edge/qa-renju-attack/qa-draw-bot**: 이들은 game.js 순수 함수 단위 또는 placeStone 레벨 능동 공격이라 READY 게이트(서버 WS 흐름)와 무관 → 단언 변경 없이 그린.

## 스펙 대비 구현 상태 (본 작업 범위)

- [x] BOT-004 리매치 READY 버그 수정 — 초기/리매치 동일 start-트리거로 createGame→GAME_START
- [x] bot-smoke BOT-004 포함 전 그린(14/14)
- [x] smoke 106 유지
- [x] qa-rematch-attack 그린(T6 stale 단언 보정)
- [x] qa-edge/qa-renju-attack/qa-draw-bot 그린(영향 없음 확인)
- [x] 신규 페이즈2 E2E(connection-flow-e2e.spec.js) 4건 PASS
- [x] 리포트 작성(본 문서)
- [x] omok/CLAUDE.md 함정 항목 1줄 추가

## AC 충족 (페이즈2 관련 — 본 작업이 입증한 항목)

- [x] AC-02: 양쪽 READY 시 상대 마크 ✅ 실시간 갱신 + 둘 다 ✅ → 게임 시작 (CFE-03)
- [x] AC-03: 상대 이탈 시 자동 튕김 없음 + 배너 + "로비로 돌아가기" (CFE-04)
- [x] AC-05: mode=ai 진입 시 봇 자동 READY → 사람 READY → 게임 시작 (CFE-02, BOT-004)
- [x] AC-06: `?name=` 쿼리로 오목 방에서 상대 이름 표시 (CFE-03)
- [x] AC-08: 리매치 후 READY → 양쪽 준비 시 새 판 시작 (BOT-004, qa-rematch T6)
- [x] AC-09: 기존 회귀 무영향 (smoke 106 + bot-smoke 14 + qa-edge 35 + qa-renju 28 + qa-rematch 14)
- [x] AC-13: 혼자 카드 클릭 시 대기 상태 진입("친구를 기다리는 중" + AI 버튼) (CFE-01)
- [x] AC-14: 2인 합류 시 AI 버튼 자동 소멸 (CFE-03)

## Art Director 후속 조치

- visual_change: `ui` (스펙 §Art Director 실행 계획)
- AD 모드 2 필요 여부: **아니오** — 외부 이미지 에셋 0(Canvas/CSS/HTML 전용), 본 작업은 서버 1줄 버그픽스 + 테스트
- AD 모드 3 필요 여부: **예** — 게임방 대기→게임 흐름 UI(READY 패널 ✅/⌛, AI 버튼, 상대 이름, 이탈 배너) 레이아웃 검수가 페이즈2 완료 후로 예정됨. 단, 본 작업은 UI 코드를 새로 추가하지 않았고(기존 코더 구현분), 버그픽스·테스트만 수행했다. UI 레이아웃 변경은 없으나 스펙상 페이즈2 AD3가 이어지므로 **QA 진행 전 AD3 게임방 UI 검수 권장**.
- **이 섹션이 "예"인 항목(AD3)은 QA 진행 전에 거치는 것이 스펙 파이프라인 기준이다.**

## 알려진 이슈

- 없음. 좀비 포트 0(LISTEN), MCP node·launcher(3000) 무접촉.

## QA 참고사항

- 회귀 실행: `node tests/{smoke,bot-smoke,qa-rematch-attack,qa-edge,qa-renju-attack,qa-draw-bot}.test.js`. bot-smoke는 실제 child_process 봇 spawn으로 수십 초 소요 가능(timeout 15초/케이스 충분).
- 신규 E2E: `npx playwright test tests/connection-flow-e2e.spec.js --config=playwright.config.js`. **사전 서버 구동 불필요** — spec이 beforeAll에서 포트 3079 단독 server.js를 spawn하고 afterAll에서 종료한다(기존 omok-e2e-qa.spec.js와 달리 자급식).
- BOT-004 회귀 감시 포인트: 리매치 후 `game` 리셋 누락 재발 시 양쪽 READY여도 GAME_START 미발생. server.js REMATCH 분기의 `game = null;`이 핵심 가드(CLAUDE.md 함정 항목 등재).
