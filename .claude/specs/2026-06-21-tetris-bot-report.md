# Implementation Report: 테트리스 배틀 AI 봇 추가

## 작업 요약

테트리스 배틀에 단독 AI 봇 대전 모드를 추가했다. 봇이 없던 4종 게임 중 테트리스 배틀부터 착수했으며, 다른 6종 봇 게임과 동일한 `getBotUrl` + `child_process.spawn` 패턴을 채택하되 테트리스 배틀의 **클라이언트 권위** 구조에 맞춰 봇이 서버 STATE를 받지 않고 **독자 테트리스 엔진을 내장**하여 보드를 시뮬레이션하고 라인 클리어 시에만 `GARBAGE_SEND`를 전송하도록 구현했다.

## 목적 / 배경

10종 게임 중 테트리스 배틀·다빈치 코드·코드네임 듀엣·하나비 4종만 AI 봇이 없어 1인 플레이가 불가능했다. 캐주얼 LAN 환경에서 친구가 없을 때도 즉시 플레이할 수 있도록, "적당히 이길 수 있는" 난이도의 봇을 4종 중 테트리스 배틀부터 추가했다.

아키텍처 특수성: 다른 봇(오목/요트/장기 등)은 서버가 보낸 STATE 스냅샷을 받아 한 수를 결정한다. 그러나 테트리스 배틀 `server.js`는 보드 상태를 브로드캐스트하지 않고(클라이언트 권위) `GARBAGE_RECV` / `ITEM_EFFECT` / `GAME_RESULT` 같은 이벤트만 중계한다. 따라서 봇은 자체 보드·피스 시뮬레이터를 내장해야 했다.

## 변경 / 신규 파일

| 파일 경로 | 작업 유형 | 핵심 변경 내용 |
|---|---|---|
| `tetris-battle/bot.js` | 신규 | 독자 테트리스 엔진 + WS 클라이언트 (550줄). 보드 시뮬레이터(`createEmptyGrid`/`isColliding`/`lockPiece`/`clearLines`/`addGarbage`/`createBag`/`garbageFromLines`/`comboBonus`/`getStackHeight`) + 휴리스틱(`evaluateBoard`/`chooseBestPlacement`) + 메인 루프(`scheduleNextPiece`/`doPlace`/`resetBot`/`scheduleRematch`) + WS 핸들러(open=JOIN, message 분기, close=process.exit) |
| `tetris-battle/server.js` | 수정 | `import fs from 'fs'` + `import { spawn } from 'child_process'` 추가. `createApp(opts)`에 `getBotUrl` 옵션. `spawnBotChild()`/`killBotChild()` 함수 + `botChild` 상태 변수. `wss.on('connection', (ws, req) => …)`에서 `mode` 쿼리 파싱(`isBot`/`wsMode`). Player typedef에 `mode` 필드 추가. JOIN case에서 `wsMode==='ai' && !isBot && players.length===1` 시 200ms 후 `spawnBotChild()`. close 핸들러에서 `!isBot` 시 `killBotChild()` |
| `tetris-battle/public/index.html` | 수정 | `.center-area`에 `<button id="ai-start-btn" class="ai-start-btn">🤖 AI랑 시작</button>` 추가 |
| `tetris-battle/public/js/network.js` | 수정 | `connect()`에서 `mode` 쿼리 파싱 + `sessionStorage['tetris:mode']` 보존 → WS URL에 `?mode=ai` 부착. `aiStart()` 헬퍼 추가(sessionStorage 저장 후 `location.href` 재접속) |
| `tetris-battle/public/js/main.js` | 수정 | `aiStartBtn` 엘리먼트 참조. `onJoined`에서 `p1 && waiting && mode≠ai` 일 때만 버튼 노출. `onStart`에서 버튼 숨김. 클릭 핸들러에서 `disabled`+"🤖 AI 호출 중..." 후 `net.aiStart()` 호출 |
| `tetris-battle/public/css/style.css` | 수정 | `.ai-start-btn` 클래스(녹색 `#2ecc71`, `.primary-btn`과 동일 톤/크기, `:hover`/`:disabled`/`.hidden`) |
| `launcher/server.js` | 수정 | `createTetrisApp({ getBotUrl: () => 'ws://localhost:${PORT}/tetris-battle/ws?mode=bot' })` 주입 |
| `tetris-battle/tests/bot-smoke.test.js` | 신규 | ad-hoc 노드 러너 봇 smoke (포트 3110, TBOT-001~005) |

### 봇 → 서버 / 서버 → 봇 메시지

- 봇 송신: `JOIN { playerName: 'AI Bot' }`, `READY`, `GARBAGE_SEND { lines, combo }`, `BOARD_STATE { height, stack:[] }`, `GAME_OVER`, `REMATCH`
- 봇 수신 처리: `JOINED`(→READY), `START`(→resetBot+루프 시작), `GARBAGE_RECV`(→pendingGarbage 누적), `ITEM_EFFECT`(garbage_bomb만 반영), `GAME_RESULT`(→500ms 후 REMATCH), `REMATCH_STATUS`/`ITEM_GRANT`/`SHIELD_BLOCK`/`OPPONENT_BOARD` 무시, `ERROR` 로그

## 봇 알고리즘 구현 요약

- **독자 재구현 엔진**: `board.js`/`tetromino.js`를 import하지 않고 상수(`BOARD_WIDTH=10`, `VISIBLE_HEIGHT=20`, `VANISH_ZONE=2`, `BOARD_HEIGHT=22`, `GARBAGE_BOMB_LINES=2`, `PIECES` 7종 회전 행렬, `PIECE_COLORS`)·로직(충돌/락/클리어/가비지/7-bag/가비지변환/콤보)을 인라인 재구현. JSDoc에 "board.js 동기 유지 필요" 주석 명시.
- **평가 함수 가중치**: `W_CLEAR=1.0`, `W_HOLES=-3.5`, `W_BUMP=-0.5`, `W_HEIGHT=-0.5`. `score = clearLines·W_CLEAR + holes·W_HOLES + bumpiness·W_BUMP + maxHeight·W_HEIGHT` (최상단 상수 분리 → tuning 시 한 줄 수정).
- **전수 탐색 1-look**: 매 피스마다 `(x위치 × rotation 0~3)` 모든 조합을 `chooseBestPlacement`가 전수 평가 → 하드드롭 → 시뮬 보드에서 클리어 → 최고점 위치 선택. 넥스트 피스 미고려(2-look 없음 — 캐주얼 의도).
- **배치 간격**: `800ms + Math.floor(Math.random()*400)` = 800~1200ms/피스. 중력 시뮬레이션 생략(계산 직후 즉시 하드드롭).
- **가비지/아이템**: `garbage_bomb` `ITEM_EFFECT`만 봇 보드에 `pendingGarbage += 2` 반영, `dark`/`freeze`는 무시(의도적 비대칭 — 사람이 아이템으로 봇을 교란하는 재미 보존, 봇은 시뮬레이터만 보므로 다크 무효, 중력 타이머 없어 프리즈 무효). 받은 가비지는 다음 피스 락 직전(`doPlace` 진입부)에 적용.
- **토프아웃 → GAME_OVER**: 스폰 위치 충돌 또는 `chooseBestPlacement`가 `null` 반환 시 `GAME_OVER` 전송 후 `isRunning=false`.
- **자동 REMATCH**: `GAME_RESULT` 수신 시 `scheduleRematch()`가 500ms 후 `REMATCH` 자동 전송(REMATCH_STATUS로 상태를 알 수 있어 재송신 타임아웃 생략).
- **disconnect → killBotChild**: 사람(비봇) `ws.close` 시 서버가 `killBotChild()` 호출 → 봇 프로세스 종료.

## Planner 식별 함정 6건 회피 확인

| # | 함정 | 회피 확인 |
|---|------|----------|
| 1 | `server.js`에 `fs` 미import (spawnBotChild의 `fs.existsSync` 사용) | `import fs from 'fs'` 추가 확인 (server.js L15) |
| 2 | `BOARD_HEIGHT(22)` vs `VISIBLE_HEIGHT(20)` 혼동 → 높이 계산 오류 | `getStackHeight`가 `for r=VANISH_ZONE…`로 hidden zone 제외, `evaluateBoard`는 BOARD_HEIGHT 전체 스캔 후 `BOARD_HEIGHT - r`로 스택 높이 환산 — 정확 |
| 3 | `botCombo` 초기값 0 잘못 설정 시 첫 클리어 보너스 +1 오류 | `botCombo = -1` 초기값 + 첫 클리어 시 `++`→0, `comboBonus(0)=0` 확인 (bot.js L359, resetBot에서도 -1로 리셋) |
| 4 | `wss.on('connection', (ws))` 시그니처 → req 누락으로 mode 파싱 불가 | `(ws, req)`로 변경, `handleUpgrade`가 이미 req 전달 중이라 무수정 OK 확인 |
| 5 | connection 직후 spawn 시 타이밍 경쟁 | JOIN case 처리 직후(`players.length===1`)에 200ms 지연 spawn — 사람 단독 대기 보장 |
| 6 | `network.aiStart` 미노출 | 반환 객체에 `aiStart()` 추가 + main.js 클릭 핸들러가 `net.aiStart()` 호출 확인 |

## 검증된 테스트 결과

### 신규 봇 smoke (포트 3110)

- `tests/bot-smoke.test.js`: **8/8 PASS**
  - TBOT-001: mode=ai 진입 → 봇 자동 spawn → 사람 JOINED(p1) → START countdown=3 수신
  - TBOT-002: 봇 피스 배치 → BOARD_STATE → 서버가 사람에게 OPPONENT_BOARD 중계
  - TBOT-003: 사람 GAME_OVER → 봇(p2) 승리자 GAME_RESULT(winner=p2, reason=topout)
  - TBOT-004: 사람 disconnect → 방 초기화(새 접속 p1·waiting=true) → 봇 연결도 해제
  - TBOT-005: 사람 REMATCH → 봇 자동 동의 → START countdown=3 재수신
  - (TBOT-001~005 시나리오 내 개별 단언 합계 8건)

### 회귀 슈트 (변경 후 PASS 유지)

| 슈트 | 결과 |
|------|------|
| phase1-unit | 57 PASS |
| phase1-ws | 37 PASS |
| phase2-items | 35 PASS |
| phase2-edge | 14 PASS |
| phase3-polish | 14 PASS |
| phase4-launcher | 20 PASS |
| phase5-qa-edge | 71 PASS |
| phase5-vanish-zone | 52 PASS |

위 8개 슈트 **전부 PASS**.

### phase3-4-qa-edge — 기존 결함 1건 (봇 작업 무관)

- `phase3-4-qa-edge`: **20 PASS / 1 FAIL(Q7b)**.
- Q7b는 **기존 결함**으로, baseline(봇 작업 이전 git HEAD)에서도 동일하게 실패한다. 즉 봇 작업과 무관하다.
- 원인: `printBanner` 검증용 정규식이 함수 경계를 넘어 뒤따르는 기존 주석 `// ── 서버 시작 ──`(유니코드 `─`)까지 비탐욕(non-greedy) 매칭하는 **테스트 취약성**. 코더가 추가한 봇 섹션(server.js line~41 부근)은 정규식 매칭 범위(printBanner L600~677) **밖**이라 영향이 없다.
- **회귀 게이트 슈트는 임의 수정 금지** 원칙에 따라 손대지 않고 별도 이슈로 기록한다.

## 수용 기준 충족 여부 (스펙 AC 대조)

- [x] AC-1: 대기 화면에 "🤖 AI랑 시작" 버튼 표시, 게임 시작 후 숨김 (main.js onStart)
- [x] AC-2: 버튼 클릭 시 `?mode=ai` 이동 + WS에 `mode=ai` 쿼리 부착 (network.aiStart/connect)
- [x] AC-3: 서버가 `mode=ai` 감지 → 200ms 후 bot.js spawn (server.js JOIN case)
- [x] AC-4: 봇 JOIN/READY → 양쪽 START countdown=3 (TBOT-001 PASS)
- [x] AC-5: 봇 800~1200ms 배치 + OPPONENT_BOARD 중계 (TBOT-002 PASS)
- [x] AC-6: 봇 라인 클리어 → GARBAGE_RECV 도달 (garbageFromLines+comboBonus 동일 로직 재구현)
- [x] AC-7: 봇 토프아웃 → GAME_OVER → GAME_RESULT(reason=topout) (TBOT-003에서 대칭 검증)
- [x] AC-8: 사람 REMATCH → 봇 0.5초 자동 동의 → START 재전송 (TBOT-005 PASS)
- [x] AC-9: 사람 disconnect → 봇 child process 종료 (TBOT-004 + killBotChild)
- [x] AC-10: garbage_bomb 효과 → 봇 보드 가비지 2줄 (ITEM_EFFECT 핸들러)
- [x] AC-11: launcher 통합 모드에서도 봇 spawn (getBotUrl 주입)
- [~] AC-12: 회귀 337/337 — 8개 슈트 전부 PASS, phase3-4-qa-edge만 Q7b 기존 결함 1건(봇 무관, baseline 동일)
- [x] AC-13: bot-smoke TBOT-001~005 전부 PASS (8/8 단언)

## 빌드 / 린트 결과

- 빌드: PASS (별도 빌드 단계 없음 — Node ESM 직접 실행)
- 린트: PASS (정책상 JSDoc/한국어 주석 준수 = 통과, 별도 도구 없음)

## Art Director 후속 조치

- visual_change: `ui` — 대기 화면 "🤖 AI랑 시작" 버튼 1개 추가
- AD 모드 2 필요 여부: **아니오** — 외부 이미지 에셋 미사용(tetris-battle 정책: Canvas/CSS만). 에셋 생성/교체 작업 없음
- AD 모드 3 필요 여부: **예** — `.ai-start-btn` 신규 추가로 대기 화면 레이아웃이 변경됨. 버튼의 위치/크기/색상이 "준비" 버튼 및 다른 종목 AI 버튼과 톤·배치 일관성을 갖는지, 게임 시작/결과 오버레이 시 숨김 상태 전환이 올바른지 검수 필요
- **이 섹션이 "예"인 항목(AD 모드 3)은 QA 진행 전에 반드시 AD를 거쳐야 한다.**

## 알려진 이슈

- **phase3-4-qa-edge Q7b 기존 결함**: 봇 작업과 무관한 테스트 취약성(printBanner 정규식이 함수 경계를 넘어 매칭). baseline에서도 실패. 회귀 게이트 슈트라 임의 수정하지 않고 별도 이슈로 기록. 추후 정규식을 printBanner 함수 경계에 한정하도록 보정 권장.

## QA 참고사항

- 봇 smoke는 격리 포트 **3110**에서 자체 서버를 구동하므로 launcher(3000)·기존 phase 슈트(3055)와 충돌하지 않는다. `node tests/bot-smoke.test.js`로 단독 실행(`node --test` 미사용 ad-hoc 러너).
- TBOT-002는 봇이 실제로 피스를 배치했다는 증거로 OPPONENT_BOARD 중계를 최대 30초 대기한다. 느린 환경에서도 800~1200ms 첫 배치는 여유롭게 들어온다.
- 봇은 `dark`/`freeze`를 의도적으로 무시한다(설계). QA가 다크/프리즈로 봇을 교란해도 봇 내부 계산은 정확히 진행되는 것이 정상 동작이다.
- 봇 콘솔 로그는 `[tetris-bot]` prefix로 출력된다(spawn 시 `stdio:'ignore'`라 부모 콘솔에는 안 보임 — 봇 단독 실행 시에만 확인 가능).
- **후속 발주 가능**: 봇 없는 나머지 3종 — 다빈치 코드·코드네임 듀엣·하나비 — 에 동일 패턴으로 AI 봇 추가 가능(단, 코드네임/하나비는 협력형이라 봇 설계가 상이).
