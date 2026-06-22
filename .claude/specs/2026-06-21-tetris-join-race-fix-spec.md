# Spec: 테트리스 배틀 JOIN 레이스 컨디션 수정 + 회귀 게이트

- 날짜: 2026-06-21
- 프로젝트: `minigames/tetris-battle`
- 분류: 버그 수정 (클라이언트 네트워크 타이밍)
- visual_change: none (순수 클라 로직 + 테스트/문서)
- pipeline: full (다중 파일 + 회귀 슈트 신설)

## 1. 증상

- `?mode=ai`로 진입하거나 일반 대전 진입 시, 클라이언트가 헤더 상태 "서버 연결 중"에서 멈춘다.
- "준비" 버튼을 눌러도 게임이 시작되지 않고(준비 중 상태 고착), **AI 모드에서는 봇도 뜨지 않는다**.
- 콘솔에 `[net] 연결되지 않은 상태에서 전송 시도: JOIN` 경고가 찍힌다.
- 매번이 아니라 **간헐적**으로 발생(브라우저/머신 속도에 의존하는 레이스).

## 2. 근본 원인

`public/js/main.js`가 WS 연결을 연 직후 **`setTimeout(..., 300)` 기반**으로 `net.join()`을 호출했다.

- WS open 이벤트가 그 300ms 안에 발생하지 않으면(느린 머신/네트워크) `net.join()` 시점에 `ws.readyState !== OPEN`.
- 기존 `join()`은 곧장 `send()`를 호출했고, `send()`는 `readyState !== OPEN`이면 메시지를 **드롭**하고 경고만 남긴다 → JOIN이 서버에 도달하지 못함.
- 서버는 JOIN을 받아야 `JOINED`를 응답하므로, JOIN 드롭 시 클라는 영원히 "서버 연결 중"에 머문다.
- 추가로 `server.js`의 봇 자동 spawn은 **JOIN 핸들러 안에서** 트리거된다(`wsMode==='ai' && !isBot && players.length===1`). 따라서 JOIN이 드롭되면 봇도 spawn되지 않는다.

## 3. 수정 (이미 적용·검증 완료)

`public/js/network.js`:
- `pendingJoinName` closure 변수 신설(입장 이름 보관).
- `join(playerName)`은 이름을 `pendingJoinName`에 보관하고, 연결돼 있으면(`readyState===OPEN`) 즉시 전송, 아니면 보관만 한다.
- WS `open` 핸들러에서 `pendingJoinName !== null`이면 JOIN을 확실히 전송한다.
- 부수 효과로 **재연결(close→connect) 시 재JOIN도 자동 해결**(보관된 이름으로 open에서 재전송).

> 함정 메모: 클라이언트 JOIN은 **WS `open` 핸들러에서 보낸다**. `setTimeout` 기반 전송은 open 전 드롭 위험이 있어 금지.

## 4. 회귀 게이트 (이번 작업 신설)

이 버그는 브라우저 타이밍 의존이라 node WS 슈트(`phase*-ws`)로는 잡히지 않는다. **Playwright E2E**로 박제한다.

- 신규 파일: `tetris-battle/tests/ai-mode-e2e.spec.js`
- 자체 격리 포트 **3111**에 `createApp({ getBotUrl })`로 봇 spawn을 켠 standalone 서버를 띄운다(사용자 launcher 3000, phase 슈트 3055, bot-smoke 3110과 격리). 테스트마다 fresh 서버로 재기동해 사람이 항상 p1을 점유하도록 보장.
- 단언:
  1. `/?mode=ai` 진입 → `#player-label`이 "접속 중..."에서 **"나 (P1)"로 갱신**(JOINED 처리 증거). JOIN 드롭 시 미수신으로 타임아웃 실패.
  2. `#status-msg`가 더 이상 "서버 연결 중"이 아님.
  3. **콘솔에 "연결되지 않은 상태에서 전송 시도: JOIN" 경고 부재**(레이스 재발 시 즉시 검출 — 핵심 게이트).
  4. 봇 입장 → 사람 READY → 양쪽 READY → **카운트다운 `#countdown` GO!** 도달.

- 기존 회귀 슈트(`phase*.test.js`, `bot-smoke.test.js`)는 무수정.

## 5. 검증 기준

- 신규 `ai-mode-e2e.spec.js` 2/2 PASS.
- 버그 재도입(임시) 시 신규 E2E가 FAIL함을 확인(게이트 유효성 증명) 후 원복.
- `bot-smoke.test.js` 8/8 PASS.
- `phase1-ws.test.js` 37/37 PASS.

## 6. 범위 밖

- main.js의 `setTimeout` 호출 자체는 그대로 둔다(이제 안전 — `join()`이 보관 후 open에서 전송하므로 setTimeout 시점 무관). 별도 정리 불요.
- 서버 측 변경 없음.
