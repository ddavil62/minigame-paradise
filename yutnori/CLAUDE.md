# 윷놀이 — 프로젝트 작업 가이드

서버 권위 윷놀이 게임이다. 기본 방은 2인이며 런처 설정에 따라 최대 4인까지 지원한다. AI 대전은 2인 방에서만 사용한다.

## 기준 문서

- 룰과 구현 차이: `docs/RULEBOOK.md` §13
- 현재 구조: `docs/PROJECT.md`
- 사용자 실행법: `README.md`
- 변경 이력: `docs/CHANGELOG.md`

게임 규칙을 바꾸면 관련 룰북 항목과 테스트를 같은 작업에서 갱신한다. 날짜별 수정 과정이나 PASS 개수는 이 파일에 누적하지 않는다.

## 구조와 권위

- `server.js`: 윷 결과, 이동, 잡기, 업기, 분기, 승리와 봇 수명주기의 최종 권위
- `bot.js`: STATE 기반 AI 플레이어
- `public/js/network.js`: WebSocket과 접속 모드 보존
- `public/js/game.js`: 클라이언트 상태 캐시와 입력 검증 헬퍼
- `public/js/board.js`: 경로와 칸 좌표
- `public/js/main.js`: 입력 라우팅
- `public/js/ui.js`, `yut.js`, `piece.js`: 보드·말·윷가락 렌더링과 hit-test

클라이언트는 입력을 보내고 STATE를 렌더링한다. 윷 결과와 모든 유효성 판단을 클라이언트로 옮기지 않는다.

## 현재 게임 규칙

- 모서리 5·10에 정확히 착지하면 외곽과 지름길 중 하나를 선택한다.
- 중앙 23에 정확히 착지한 경우에만 중앙 분기를 요청한다.
- 중앙을 통과하면 진입 경로에 따라 자동 라우팅한다: shortcutA는 centerExitA, shortcutB는 centerExitB.
- centerExitA는 `23→28→29→15→…→GOAL`, centerExitB는 `23→24→25→16→…→GOAL`이다.
- 첫 칸 빽도는 `1↔19` 워프를 사용한다. HOME에서 나온 도는 칸 1에 도착한다.
- 윷·모 추가 던지기 권리는 `pendingThrows`로 던지기 시점에 적립·소비한다.
- 잡기 보너스는 `capturedBonus`로 별도 관리한다. 윷·모로 잡았을 때 잡기 보너스를 중복 부여하지 않는다.
- 물리 윷가락의 편향과 첫 던지기 선공 결정은 구현하지 않는다. 현재 선공은 p1이다.

## WebSocket 핵심 계약

| 방향 | 메시지 | 핵심 필드 |
|---|---|---|
| C→S | `JOIN`, `READY`, `THROW_YUT`, `MOVE_PIECE`, `CHOOSE_PATH`, `REMATCH` | 이동은 `{ pieceIndex, useResult }`, 분기는 `{ pathChoice }` |
| S→C | `JOINED`, `START`, `YUT_RESULT`, `BRANCH_REQUEST`, `GAME_OVER`, `REMATCH_STATUS`, `ERROR` | 분기는 `branchType: center|corner` |
| S→C | `STATE` | `currentTurn`, `pendingResults`, `awaitingBranchAt`, `awaitingBranchType`, `capturedBonus`, `pendingThrows`, `players` |

- `mode=human`은 일반 게임, `mode=ai`는 사람 진입 후 봇 spawn, `mode=bot`은 자식 봇 전용이다.
- `network.js`는 접속 모드를 `sessionStorage('yutnori:mode')`에 보존한다.
- 내부 합성 분기값 `shortcut-top`과 `shortcut-bottom`은 서버 내부에서만 사용한다.

## 테스트

```powershell
cd C:\antigravity\minigame-paradise\yutnori

# 서버 없이 실행 가능한 로직·WS·룰북 회귀
npx playwright test tests/yut.unit.spec.js tests/ws.scenarios.spec.js tests/rulebook-c*.spec.js tests/qa-defect2-captured-bonus-stuck.spec.js tests/qa-rulefix-edge.spec.js --reporter=list

# 브라우저 E2E: 별도 터미널에서 서버 실행
node server.js --port 3088
npx playwright test tests/e2e-scenarios.spec.js tests/redesign-hittest-qa.spec.js --reporter=list

# 보조 smoke와 실제 봇 경로
node tests/smoke.test.js --port 3088
node tests/bot-smoke.test.js
```

새 로직은 관련 룰북 시나리오를 추가한다. 정통 룰 변경으로 기존 기대값이 바뀌면 테스트 주석에 이유를 남기고 갱신할 수 있다.

## 변경 시 주의할 점

- HTTP server와 `WebSocketServer` 양쪽에 오류 핸들러가 있어야 포트 충돌 시 안전하게 폴백한다.
- `board.js`와 `server.js`의 인덱스·경로는 함께 수정한다. 특히 중앙 23, centerExitB 24·25, centerExitA 28·29를 맞춘다.
- `MOVE_PIECE.useResult`는 `pendingResults`에 실제로 존재하는 결과만 소비한다.
- `pendingThrows`는 THROW 시 권리를 먼저 소비하고 결과가 yut/mo이면 다시 적립한다. MOVE와 CHOOSE_PATH에서 결과 종류를 보고 추가 적립하지 않는다.
- `hasBonus`는 `capturedBonus || pendingThrows > 0`으로 판단한다.
- `capturedBonus`는 권리로 진입한 THROW에서 한 번만 소비하고, 턴·게임·룸 초기화 경계에서 명시적으로 지운다.
- 보드 클릭은 내 말 또는 HOME 영역을 정확히 클릭했을 때만 이동한다. 빈 칸 클릭으로 첫 HOME 말을 자동 선택하지 않는다.
- Canvas hit-test는 `BOARD_SIZE / rect.width|height`로 표시 크기를 보정한다. 내부 canvas 크기를 표시 크기로 가정하지 않는다.
- 재입장 ID는 배열 길이가 아니라 미사용 p1/p2 ID를 찾아 할당한다.
- 중첩 분기는 corner 선택 뒤 중앙 분기를 다시 무장하되 결과 큐를 먼저 소비하지 않는다.
- `computeNextCell`의 모든 반환은 `finalPath`를 포함한다. `piece.lastPath`는 서버 내부 값이며 STATE에 노출하지 않는다.
- 첫 칸 빽도 특례를 일반 외곽 후퇴보다 먼저 처리한다.
- 중앙 자동 출구는 `cell === 23 && lastPath === 'shortcutB'`처럼 정확 착지 조건을 좁게 유지한다.
- 봇 중복 행동 키에 `awaitingBranchType`을 포함한다. corner에서 center로 바뀌는 중첩 분기를 구별해야 한다.
- `start.bat`은 ASCII만 사용하고, 종료는 다른 게임 서버를 죽이지 않도록 대상 창·PID·포트로 한정한다.
- 윷가락 앞면 수는 도 1, 개 2, 걸 3, 윷 4이며 모만 0에서 5칸이다.

## 시각 검증

- UI 변경은 실제 브라우저에서 보드 클릭 좌표, 말 가독성, 윷가락, 2단 레이아웃과 작은 뷰포트를 확인한다.
- 모든 시각은 Canvas/CSS로 구성하며 외부 이미지 에셋은 사용하지 않는다. 웹폰트는 예외다.
