# 루미큐브 — 프로젝트 작업 가이드

서버 권위 루미큐브 게임이다. 106개 타일, 첫 등판 30점, 그룹·런 조합과 손 0장 승리를 구현한다. UI는 DOM/CSS이며 외부 이미지 에셋을 사용하지 않는다.

## 핵심 구조

- `game.js`: 타일 생성, 세트 검증, 턴 스냅샷, commit·롤백과 승리 판정
- `server.js`: WebSocket, 룸 상태, 봇 spawn·정리
- `bot.js`: 첫 등판 탐색, 보드 확장·재구성과 재대결
- `public/js/main.js`: 상호작용과 fresh 타일 추적
- `public/js/board.js`, `hand.js`, `tiles.js`: 타일 DOM과 이동
- `public/js/ui.js`, `sounds.js`: HUD와 Web Audio

## 게임 불변조건

- 타일은 `1~13 × 4색 × 2 + 조커 2`로 구성한다.
- 그룹은 같은 숫자·서로 다른 색 3~4장, 런은 같은 색·연속 숫자 3장 이상이며 wrap-around는 허용하지 않는다.
- 본인 손은 본인에게만 전달하고 상대에게는 개수만 보낸다.
- 턴 시작 시 `turnSnapshot`을 잡고, 턴 중 자유 배치 후 END_TURN에서 전체 보드를 검증한다.
- 유효하지 않은 보드, 첫 등판 30점 미달, 실질 변경 없음, 조커 미사용 등은 롤백 후 한 장을 뽑는다.
- 보드를 바꿨더라도 손 타일이 줄지 않은 순수 재배치는 commit할 수 없다.
- 첫 등판 전에는 기존 보드 타일을 이용해 점수를 만들 수 없다.
- 조커는 첫 등판 후 정확한 대체 타일로만 회수할 수 있고, 회수한 턴에 다시 사용해야 한다.
- 덱이 빈 뒤 유효한 commit 없이 양쪽이 연속 패스하면 손이 적은 플레이어가 승리한다.

## WebSocket 핵심 계약

| 방향 | 메시지 | 역할 |
|---|---|---|
| C→S | `JOIN`, `READY`, `NEW_SET`, `MOVE_TILE`, `SWAP_JOKER`, `END_TURN`, `REMATCH` | 모든 mutation은 서버가 검증한다. |
| S→C | `JOINED`, `READY_STATUS`, `START`, `STATE`, `TURN_RESULT`, `GAME_OVER`, `ERROR` | STATE는 `myHand`와 `oppHandCount`를 분리한다. |

위치 형식은 `{ kind:'hand', tileId }` 또는 `{ kind:'set', setId, tileId?, index? }`다. `TURN_RESULT.reason`은 클라이언트 UX와 테스트에서 계약으로 사용하므로 새 사유를 추가할 때 양쪽을 함께 갱신한다.

## AI 봇

- 첫 등판 전에는 그룹·런 후보를 만들고 30점 이상 조합을 제한된 백트래킹으로 찾는다.
- 첫 등판 뒤에는 손 타일로 보드를 확장하고, 안전한 한 단계 재구성을 시도한다.
- 조커 포함 후보는 만들 수 있지만 조커가 포함된 기존 보드 세트의 분해는 피한다.
- 재구성 탐색에는 시간 제한을 유지하고 실패 시 END_TURN 롤백을 안전망으로 사용한다.
- 비동기 행동 체인은 `actionEpoch`로 취소해 상대 턴으로 넘어가지 않게 한다.
- `bot.js`는 직접 실행할 때만 WS에 연결하고, 테스트 import 시 부작용이 없어야 한다.

## 테스트

```powershell
cd C:\antigravity\minigame-paradise\rummikub
node tests/smoke.test.js
node tests/qa-pass4-sort.test.js

# UI 정렬 버튼 변경 시
npx playwright test tests/sort-buttons-qa.spec.js --config=playwright.config.js
```

봇 시나리오는 사용자 런처와 격리된 포트를 사용한다. 테스트 개수와 과거 PASS 기록은 문서에 고정하지 않는다.

## 변경 시 주의할 점

- 롤백은 board, hands, `nextSetSeq`, `jokerReturnedThisTurn`을 함께 복원한다.
- 첫 등판 점수는 이번 턴 본인 손에서 나온 타일만 계산한다. 런 점수는 배열 순서가 아니라 유효한 슬롯 배치로 계산한다.
- `findRunStart`, `validateSet`, 서버 점수와 클라이언트 미리보기는 같은 조커 슬롯 규칙을 사용한다.
- 첫 등판 전 set→set 이동은 이번 턴 손에서 낸 타일에만 허용한다. 첫 등판 후에는 자유 재구성을 허용한다.
- `SWAP_JOKER`는 유효한 보드와 정확한 숫자·색 대체 타일에서만 성공한다.
- 같은 세트 내 이동의 `to.index`는 splice 전 좌표다. bounds 검사는 이전 길이, 삽입 보정은 splice 이후 기준으로 처리한다.
- MOVE_TILE은 목적지 kind와 set 존재를 먼저 검증한 뒤 원본에서 타일을 제거한다. 검증 전에 mutation하지 않는다.
- 빈 NEW_SET은 최대 4개이며 commit·롤백 종료 시 빈 세트를 제거한다.
- `boardsEqualIgnoringEmpty`로 빈 세트 추가·제거를 실질 보드 변경에서 제외한다.
- `freshTileIds`는 현재 보드와 턴 시작 손의 차집합으로 매 STATE마다 다시 계산한다.
- `tileDict`에는 본인 손과 보드 타일만 존재한다. 상대 손 타일을 lookup하려 하지 않는다.
- 덱이 빈 뒤 패스 카운터는 유효 commit에서만 초기화한다.
- `normalizeSetTiles`는 MOVE_TILE·SWAP_JOKER mutation 직후 유효한 세트에만 적용한다. 배치 중인 invalid 세트와 END_TURN에서는 정렬하지 않는다.
- 런은 슬롯 오름차순, 그룹은 `COLOR_ORDER` 뒤 조커 순서로 정규화한다.

## 시각·문서

- UI 변경은 실제 브라우저에서 손 정렬, 보드 스크롤, 드래그·클릭 상태와 작은 뷰포트를 확인한다.
- 현재 상태는 `docs/PROJECT.md`, 변경 이력은 `docs/CHANGELOG.md`, 사용자 실행법은 `README.md`가 담당한다.
- 날짜별 해결 과정은 이 파일에 추가하지 않는다.
