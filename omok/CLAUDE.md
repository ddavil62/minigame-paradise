# 오목 — 프로젝트 작업 가이드

서버 권위 19×19 오목 게임이다. 흑·백 모두 쌍삼과 사사를 금지하고, 5목 이상과 장목은 승리로 처리한다. UI는 Canvas/CSS이며 외부 이미지 에셋을 사용하지 않는다.

## 현재 룰

| 항목 | 규칙 |
|---|---|
| 선공 | 흑 |
| 승리 | 방금 착수한 칸을 포함하는 4방향 중 5목 이상 |
| 장목 | 허용하며 승리 |
| 쌍삼 | 한 착수로 열린3 `_XXX_`를 2개 이상 만들면 거부 |
| 사사 | 한 착수로 정확히 4목을 2개 이상 만들면 거부 |
| 금수 대상 | 흑·백 동일 |
| 우선순위 | 5목 이상 완성 여부를 금수보다 먼저 판정 |
| 무승부 | 361칸이 모두 찼을 때 |
| 기권 | 상대 즉시 승리 |

정통 렌주룰과 다르다. 장목이나 흑 전용 금수 규칙을 추가하지 않는다.

## 핵심 구조

- `game.js`: `placeStone`, 승리·금수·무승부와 snapshot 순수 함수
- `server.js`: HTTP·WS, 룸·heartbeat, 리매치와 봇 수명주기
- `bot.js`: 1수 휴리스틱 AI와 자동 리매치
- `public/js/board.js`: Canvas 보드와 좌표 변환
- `public/js/main.js`: 화면 상태, 클릭 가드와 리매치
- `public/js/network.js`: WS 경로와 접속 모드 보존

`placeStone`의 순서는 입력·차례·점령 검사 → 가상 착수 → 승리 → 쌍삼 → 사사 → 무승부 → 턴 교대다. 금수면 board와 moveCount를 원복하고 게임을 계속한다.

## Canvas 계약

| 상수 | 값 |
|---|---|
| `BOARD_SIZE` | 19 |
| `CELL` | 36 |
| `MARGIN` | 40 |
| `CANVAS_SIZE` | 728 |
| `STONE_R` | 15 |
| `LAST_MOVE_COLOR` | `#C8102E` |

- 교차점은 `MARGIN + index*CELL`로 계산한다.
- 클릭은 표시 크기와 내부 해상도의 비율을 보정하고 교차점 반경 밖 입력을 무시한다.
- `LAST_MOVE_COLOR`는 CSS `--accent`와 일치시킨다.

## WebSocket과 리매치

- C→S: `JOIN`, `PLACE`, `RESIGN`, `REMATCH`
- S→C: `JOINED`, `GAME_START`, `STATE`, `GAME_OVER`, `REMATCH_WAITING`, `REMATCH_START`, `OPPONENT_LEFT`, `ERROR`
- 통합 WS 경로는 `/omok/ws`, 단독 경로는 `/ws`다.
- `network.js`는 `mode`를 `sessionStorage('omok:mode')`에 보존한다.
- 리매치는 WS 연결을 유지하며 양쪽 동의 뒤 새 game을 만든다. `location.reload()`를 사용하지 않는다.
- 다음 흑은 패자, 기권자 또는 무승부 시 반대 색이다. player ID는 유지하고 color만 바꾼다.
- 봇은 GAME_OVER와 REMATCH_WAITING에서 자동 동의하고 REMATCH_START에서 색을 갱신한다.

## AI 봇

- 빈 보드 첫 수는 중앙을 선택한다.
- 빈 칸을 전수 평가해 공격 1.0과 수비 0.9 점수를 합산한다.
- 5목 완성과 상대 4목 차단을 우선하되 1수 휴리스틱의 한계를 유지한다.
- `${currentTurn}|${moveCount}` 키로 중복 행동을 막고 새 STATE에서 stale 타이머를 취소한다.
- 금수 ERROR를 받으면 멈추지 않고 다른 수를 시도한다.

## 테스트

```powershell
cd C:\antigravity\minigame-paradise\omok
node tests/smoke.test.js
node tests/bot-smoke.test.js
node tests/qa-edge.test.js
node tests/qa-draw-bot.test.js
node tests/qa-renju-attack.test.js
node tests/qa-rematch-attack.test.js

# 브라우저 테스트: 별도 터미널에서 격리 서버 실행
node server.js --port 3077
npx playwright test tests/omok-e2e-qa.spec.js tests/omok-mobile-qa.spec.js --config=playwright.config.js
```

봇 smoke는 실제 자식 프로세스를 사용하므로 일반 로직 테스트보다 오래 걸릴 수 있다. 고정 PASS 개수는 문서에 기록하지 않는다.

## 변경 시 주의할 점

- `checkWin`은 방금 착수한 칸을 중심으로만 검사하고 `count >= 5`를 사용한다.
- 금수 검사는 돌을 임시 배치한 상태에서 수행하고, 거부 시 board·moveCount를 모두 원복한다.
- 승리 검사를 금수보다 먼저 수행한다.
- `isFour`는 정확히 길이 4만 인정해 5목 이상을 사사 재료로 세지 않는다.
- `isOpenThree`는 양 끝이 모두 빈 연속만 인정한다. 닫힌3을 열린3으로 세지 않는다.
- 모든 방향 탐색은 `inBounds`를 사용해 행·열 경계 래핑을 막는다.
- 좌표는 정수와 0~18 범위를 모두 검증한다.
- snapshot의 board는 `slice()`로 복사해 원본 상태를 노출하지 않는다.
- 세 번째 연결을 거부하기 전에 닫힌 좀비 슬롯을 청소하고 정원을 다시 확인한다.
- 초기 시작과 리매치는 동일한 READY 게이트를 사용한다. 리매치 전 `game`, ready 상태와 rematch 상태를 초기화한다.
- 봇 child는 사람 이탈과 서버 종료 시 정리한다.

## 시각·문서

- UI 변경은 실제 브라우저에서 보드 비율, 돌 대비, 좌표 라벨, 마지막 수 표시와 360×640 레이아웃을 확인한다.
- 실행 정보는 `package.json`과 런처 카탈로그, 변경 이력은 Git과 상위 프로젝트 문서가 담당한다.
- 날짜별 스펙·QA·검수 링크는 이 파일에 누적하지 않는다.
