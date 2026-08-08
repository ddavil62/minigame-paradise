# 맞고 — 프로젝트 작업 가이드

한국 표준 맞고 룰을 기반으로 한 서버 권위 1:1 화투 게임이다. 현재 동작은 코드와 테스트가 기준이며, 룰 해석은 `C:/antigravity/.claude/specs/2026-05-30-matgo-rulebook.md`를 우선 확인한다.

## 구조

- `game.js`: 턴, 특수 이벤트, 조커, 폭탄과 라운드 상태
- `score.js`: 족보, 고 배수와 박 계산
- `cards.js`: 기본 화투 덱 정의
- `server.js`: HTTP·WebSocket, 봇 수명주기, 테스트 주입
- `bot.js`: AI 플레이어
- `public/client.js`: 상태 렌더링과 카드 이동 연출
- `tests/`: 단위, 룰, 브라우저, 연출 회귀 테스트

## 현재 룰과 상태 불변조건

| 영역 | 현재 규칙 |
|---|---|
| 덱 | 화투 48장 + 조커 2장. 카드 총합 50은 항상 보존한다. |
| 사통 | 같은 월 4장을 받은 플레이어가 `awaiting_sangtong`에서 선언하면 기본 점수에 7점을 더한다. 사통 입력 대기 중 봇 턴을 진행하지 않는다. |
| 흔들기 | `shake_decision` 서버 phase는 사용하지 않는다. 같은 월 첫 카드를 낼 때 클라이언트 모달로 한 번만 묻는다. |
| 폭탄 | 손 3장과 바닥 1장을 획득하고 `bombDeckCredit`에 추가 뒤집기 권리를 적립한다. 손이 없어도 권리가 남으면 보너스 뒤집기를 계속한다. |
| 바닥 슬롯 | `floorSlotMap`은 클라이언트 전용이며 카드 ID의 시각 위치를 고정한다. 새 게임과 새 라운드에서 비운다. |
| 쓸 | 바닥 2장 선택 흐름 뒤 같은 월을 뒤집어 바닥을 비우면 `lastAction.kind='sseul'`로 정규화하고 상대 피 1장을 가져온다. |
| 자뻑 | 자신이 만든 뻑을 자신이 풀면 피 2장, 상대가 만든 뻑을 풀면 피 1장이다. 소유자 판정은 `ppeokFlags` 삭제 전에 한다. |
| 조커 | `month=0`, 피 2장 가치다. 월 매칭·사통·폭탄 대상에서 제외한다. |
| 손 조커 | 상대 피 1장 → 본인 captured → 덱 1장 손 보충 후 턴을 유지한다. `finishTurnKeepTurn`은 일반 종료·점수 로직과 동기화한다. |
| 덱 조커 | 상대 피 1장 → 본인 손으로 이동 → 한 번 더 뒤집는다. |
| 바닥 조커 | 선공자가 자동 획득하고 덱이 남아 있으면 바닥을 8장으로 보충한다. 덱 길이는 보충 수만큼 달라질 수 있다. |
| 라운드 종료 | 한쪽의 `손 + bombDeckCredit`이 0이고 상대 credit도 0이면 종료 가능하다. 종료 전에 잔여 손패를 각자 captured로 정산한다. |

박 판정은 `score.js`를 기준으로 한다: 피박은 패자 피 `<= 7`, 멍박은 패자 끗 `0`, 광박은 승자 광 3장 이상이면서 패자 광 0장, 고박은 고 선언자가 패배한 경우다.

## 테스트

```powershell
cd C:\antigravity\minigame-paradise\matgo

# 빠른 로직 회귀
npx playwright test tests/score.unit.spec.js tests/game.unit.spec.js --reporter=list

# 브라우저 E2E: 별도 터미널에서 서버 실행
node server.js --port 3013
npx playwright test tests/e2e-scenarios.spec.js --reporter=list

# 작업과 관련된 추가 회귀
npx playwright test tests/reports-54-59-browser.spec.js tests/reports-63-64-browser.spec.js tests/qa-63-64-edge.spec.js tests/reports-65-browser.spec.js tests/reports-65-qa.spec.js --reporter=list
```

- `POST /test/reset`으로 공유 룸을 테스트 전후에 초기화한다.
- 상태가 필요한 시나리오는 `POST /test/inject`로 결정적으로 구성한다.
- 오프닝 카드 이동이 끝난 뒤 조작하고, 일반 카드 선택은 `pickSafePlayCard` 같은 결정적 헬퍼를 사용한다.
- 테스트 개수는 문서에 고정하지 않고 현재 러너 결과로 확인한다.

## 변경 시 주의할 점

- `pendingChoiceSrcCardId`는 바닥 선택 흐름에서 손 카드 출처를 식별하는 서버 기준값이다. 턴·라운드 경계에서 반드시 초기화한다.
- `choiceFloorSrcCardId` 카드 이동은 행위자가 본인이면 `startFlyFromHand`, 상대면 `startFlyFromOppHand`를 사용한다.
- 선택 카드가 전용 경로에서 처리됐으면 일반 상대 손 경로에서 제외해 이동 연출을 중복 등록하지 않는다.
- 손 카드 이동은 `renderMyHand` 이후 등록하고 captured 도착지를 `flyTargetIds`에 포함한다. 손 이동을 덱 이동보다 먼저 등록한다.
- `joker_play`는 같은 STATE가 반복되어도 한 번만 연출한다. 이미 이동 중이어도 `lastJokerFlyActionKey`는 기록하고 라운드 경계에서 초기화한다.
- 조커는 captured 렌더링에서 pi 그룹에 표시하되 카드 스타일은 유지하고 피 개수에는 2로 계산한다.
- 강탈 피 이동은 상대 captured 영역에서 시작하며, 이번 턴 덱에서 나온 카드는 해당 집합에서 제외한다.
- 흔들기나 모달 처리로 손 DOM이 재생성될 때 이동 중인 원본 카드는 다시 숨긴다.
- 폭탄 손 3장은 전송 직전에 손 출발 이동을 등록한다.
- 카드 이동 clone의 기존 `transform`을 제거하지 않으면 우측·스택 슬롯 도착 좌표가 어긋난다.
- `chooseFloorSteps`는 덱 처리 뒤 `ttadak`과 `pair_from_flip` 경로 모두 쓸 조건을 확인한다. 이미 피를 가져온 경로에서 `stealPi`를 중복 호출하지 않는다.
- `choice_made`까지 중간 STATE broadcast를 보류해 손 카드와 덱 카드가 하나의 정산 흐름으로 보이게 한다.
- 뻑 토스트는 덱 카드가 바닥에 도착한 뒤 표시한다.
- `go-stop-overlay`의 반복 애니메이션 때문에 Playwright 클릭 안정성 대기가 끝나지 않을 수 있으므로 해당 테스트는 필요 시 강제 클릭을 사용한다.

## 주요 DOM ID

| 요소 | ID |
|---|---|
| 흔들기 | `shake-modal` |
| 폭탄 | `bomb-panel`, `bomb-confirm-modal` |
| 사통 | `sangtong-modal` |
| 고/스톱 | `go-stop-overlay` |
| 술잔 | `kkeut-modal` |
| 결과 | `round-modal` |
| 배너 | `banner-status`, `banner-multiplier` |

## 시각·문서

- UI 변경은 카드 이동 순서, 출발·도착 위치, 중복 연출, 모바일 레이아웃을 실제 브라우저에서 확인한다.
- 현재 상태는 `docs/PROJECT.md`, 변경 이력은 `docs/CHANGELOG.md`에 기록한다.
- 날짜별 수정 과정과 PASS 집계는 이 파일에 추가하지 않는다.
