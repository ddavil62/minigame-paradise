# 테트리스 배틀 — 프로젝트 작업 가이드

입력 지연을 최소화한 공개 HTTPS 2~6인 테트리스 대전이다. 사람 대전과 AI 대전을 지원하며 모든 시각은 Canvas/CSS로 구성한다. 친구는 같은 공유기에서도 `https://112.155.2.238`로 접속하며 포트 3000과 개별 포트는 내부·개발 전용이다.

## 핵심 구조

- 게임 시뮬레이션과 입력 반영은 각 클라이언트가 로컬에서 수행한다.
- 서버는 가비지, 아이템, 방어막, 게임오버와 룸 수명주기를 중계한다. 보드 전체를 매 tick 전송하지 않는다.
- 방어막 차단 결정은 서버 권위이며 `SHIELD_BLOCK`을 양쪽에 알린다.
- LAN 신뢰 환경이므로 강한 안티치트는 범위 밖이다. 서버 입력 클램프는 유지한다.
- AI 봇은 STATE 보드를 받지 않고 `bot.js`의 독자 엔진으로 시뮬레이션한다.

## 주요 파일

- `server.js`: HTTP·WS, 룸·하트비트, 아이템 중계, 봇 spawn·정리
- `bot.js`: 독자 테트리스 엔진과 WS 클라이언트
- `public/js/game.js`, `board.js`, `tetromino.js`: 로컬 게임 상태와 규칙
- `public/js/input.js`, `items.js`: 입력과 아이템 상태
- `public/js/network.js`: JOIN과 재연결
- `public/js/ui.js`: 상대 미니맵과 HUD
- `docs/KNOWN-ISSUES.md`: 현재 알려진 테스트·환경 문제

## 테스트

```powershell
cd C:\antigravity\minigame-paradise\tetris-battle

node --test tests/phase1-unit.test.js
node --test tests/phase1-ws.test.js -- --port 3055
node --test tests/phase2-items.test.js -- --port 3055
node --test tests/phase2-edge.test.js -- --port 3055
node --test tests/phase3-polish.test.js -- --port 3055
node --test tests/phase4-launcher.test.js -- --port 3055
node --test tests/phase3-4-qa-edge.test.js -- --port 3055
node --test tests/phase5-vanish-zone.test.js
node --test tests/phase5-qa-edge.test.js
node tests/input-freeze-rematch.test.js
node tests/input-freeze-rematch-independent-qa.test.js
npx playwright test tests/input-freeze-rematch.browser.spec.js --config=playwright.config.js
node tests/bot-smoke.test.js
npx playwright test tests/ai-mode-e2e.spec.js --config=playwright.config.js
node --test tests/roomfull-heartbeat.test.js
```

- WS 테스트는 사용자 런처와 다른 포트를 사용하고 종료 시 소켓을 닫는다.
- 변경 영역과 관련된 최소 슈트부터 실행한 뒤 영향 범위에 따라 확대한다.
- 기존 테스트를 영구 불변으로 취급하지 않는다. 기능 계약이 의도적으로 바뀌면 새 계약을 검증하도록 갱신한다.
- 알려진 baseline 문제는 `docs/KNOWN-ISSUES.md`에서 확인하고 새 실패와 구분한다.

## 변경 시 주의할 점

- HTTP server와 `WebSocketServer` 양쪽에 오류 핸들러를 둔다.
- 콤보는 `-1`에서 시작한다. 첫 라인 클리어의 콤보 보너스는 0이다. 봇도 같은 초기값을 사용한다.
- 한 번에 추가되는 가비지 줄은 모두 같은 hole 위치를 공유한다.
- `items.reset()`은 dark/freeze 타이머, UI, 입력 frozen 상태와 게임 frozen 상태를 멱등 해제한다.
- freeze는 블록 조작만 막고 아이템 단축키와 슬롯 클릭은 허용한다.
- `input.disable()`은 listener 부착 여부와 관계없이 held, DAS/ARR, soft-drop과 frozen 상태를 정리한다.
- `BOARD_HEIGHT=22`, `VISIBLE_HEIGHT=20`, `VANISH_ZONE=2`를 구분한다. 렌더링은 visible 영역만, 충돌·잠금·라인 제거·가비지는 전체 데이터 영역을 사용한다.
- 좌표 변환은 `(gridRow - VANISH_ZONE) * CELL_SIZE`이며 hidden row는 렌더링하지 않는다.
- `board.js`·`tetromino.js`의 보드 상수, 피스, 가비지·콤보 규칙을 바꾸면 `bot.js`의 복제 구현도 함께 갱신한다.
- 봇 높이 평가는 VANISH_ZONE부터 스캔하며 BOARD_STATE의 `stack`은 visible 높이 배열이어야 한다.
- 봇은 `garbage_bomb`만 보드에 반영한다. dark와 freeze를 무시하는 것은 의도된 정책이다.
- 봇은 사람의 JOIN을 받은 뒤 지연 spawn한다. WS connection 직후 spawn하지 않는다.
- 클라이언트 JOIN은 WS `open` 이벤트에서 보낸다. open 전 `send()`나 임의 타이머를 사용하지 않는다.
- 하트비트 interval에는 `.unref()`를 적용하고 테스트에서는 `heartbeatIntervalMs: 0`으로 비활성화할 수 있게 유지한다.
- 하트비트는 정상 close 정리와 `readyState !== OPEN` 좀비 슬롯 청소를 대체하지 않고 보완한다.
- `start.bat`은 ASCII를 유지하고 `stop.bat`의 포트 범위는 서버 폴백 범위와 맞춘다.

## 검증과 문서

- CSS/Canvas 변경은 대기실, 게임 화면, 상대 미니맵과 모바일 뷰포트를 실제 브라우저에서 확인한다.
- 현재 구조는 `docs/PROJECT.md`, 사용자 실행법은 `README.md`, 변경 이력은 `docs/CHANGELOG.md`가 담당한다.
- 날짜별 수정 과정과 테스트 통과 개수는 이 파일에 추가하지 않는다.
