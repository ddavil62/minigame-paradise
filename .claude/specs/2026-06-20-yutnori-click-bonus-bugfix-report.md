# 구현 리포트 — 윷놀이 버그 B/C 수정 (빈 칸 클릭 오출발 + 윷·모 보너스 던지기 이중 리필)

- **날짜**: 2026-06-20
- **프로젝트**: minigames / yutnori
- **스펙**: `.claude/specs/2026-06-20-yutnori-click-bonus-bugfix-spec.md`
- **visual_change**: `none`
- **pipeline**: `full`

## 작업 요약

버그 B(결과 선택 후 빈 칸 클릭이 첫 HOME 말을 자동 출발시키던 폴백)를 `main.js`에서 제거하고, 버그 C(윷·모 보너스가 던지기+이동 이중 부여되어 소진 순서에 따라 던지기가 리필되던 비대칭 버그)를 `server.js`에서 `bonusFromConsumed` 이동 시점 모델을 폐기하고 `pendingThrows` 던지기 시점 적립/소비 모델로 교체하여 해소했다. 버그 D(보너스 던지기 소실)와 하나의 모델로 양립한다.

## 변경된 파일

| 파일 경로 | 작업 유형 | 변경 내용 |
|---|---|---|
| `yutnori/public/js/main.js` | 수정 | 보드 클릭 핸들러 3단계 폴백(빈 칸 → 첫 HOME 말 자동 선택) 제거. `pieceIdx < 0`이면 `이동할 말을 클릭하세요.` 토스트 후 `return`(약 277~283행) |
| `yutnori/server.js` | 수정 | `bonusFromConsumed` 이동 시점 보너스 부여 제거. `game.pendingThrows` 적립/소비 모델 도입(THROW_YUT 적립·소비, MOVE_PIECE/CHOOSE_PATH hasBonus 통일, passTurn/createGame/softReset/resetGame 초기화, STATE 노출, /test/inject 주입) |
| `yutnori/tests/rulebook-c8-bonus.spec.js` | 수정/추가 | YR-C8-009 기댓값 갱신(던지지 않은 yut 소비 → 리필 없음). 신규 YR-C8-011~014 추가 |
| `yutnori/tests/redesign-hittest-qa.spec.js` | 추가 | 신규 HT-BUGB(빈 칸 클릭 → HOME 말 미출발) |

## 구현 상세

### 버그 B — 폴백 제거 (`main.js`)

기존 3단계 해석 중 마지막 폴백을 삭제했다.

- 1단계 `pickMyPieceAt`(보드 위 내 말) → 2단계 `isClickOnHomeArea` + `pickFirstHomePiece`(HOME 박스 영역)에서 말이 특정될 때**만** `net.movePiece(pieceIdx, picked)` 호출.
- 둘 다 실패(`pieceIdx < 0`)하면 `ui.showToast('이동할 말을 클릭하세요.', 'error')` 후 `return`.
- 좌표 매핑(`BOARD_SIZE / rect.width|height`, dpr 무관)은 2026-06-18 재디자인 회귀 가드 그대로 유지(변경 없음).

### 버그 C — `pendingThrows` 던지기 시점 모델 (`server.js`)

- **상태 필드 신설**: `game.pendingThrows`(초기값 0). 윷·모 "한 번 더 던지기" 권리의 적립 카운트.
- **THROW_YUT**: ① 적립된 보너스 던지기 권리를 행사한 던지기면(`pendingThrows > 0`) `pendingThrows -= 1` 소비. ② 던진 결과가 `yut`/`mo`면 `pendingThrows += 1` 적립. 백도 자동 폐기 분기의 턴 종료 판정도 `hasBonusDiscard = capturedBonus || pendingThrows > 0`로 통일.
- **MOVE_PIECE / CHOOSE_PATH**: `bonusFromConsumed` 계산과 hasBonus 가산을 **완전 제거**. 큐 차감(`splice`) 후 `hasBonus = game.capturedBonus === true || game.pendingThrows > 0`로 판정 — 큐가 비고 `hasBonus`가 false면 `passTurn()`. `lastResult` 종류에 의존하지 않음.
- **capturedBonus / §13-12 가드 유지**: 잡기 보너스 라이프사이클(FIX-4 `enteredViaCapturedBonus` 소진 조건), 윷·모 잡기 중복 보너스 차단(§13-12)은 무손상.
- **초기화**: `passTurn()` / `createGame()` / `softResetRoom()` / `resetGame()`에서 `pendingThrows = 0`.
- **관찰성**: `broadcastState` 스냅샷에 `pendingThrows` 노출(후방 호환 추가 필드, 클라이언트 동작 무영향), `/test/inject`에 `pendingThrows` 주입 지원.

## 테스트 결과 (검증됨)

| 스위트 | 결과 |
|---|---|
| 서버리스 회귀 (Playwright) | **342 passed / 0 failed** |
| redesign-hittest + e2e (서버 가동) | **30 passed** |
| 버그 C 관련(c8-bonus / c18 / c19 / qa-defect2) | **27 passed** |
| bot-smoke (YBOT-001~005) | **10 / 10** |
| 레거시 smoke (시나리오 1~8) | **36 PASS** |

### 신규 회귀 4건 (전부 PASS)

- **HT-BUGB** (버그 B): 결과 선택 + 전원 HOME 상태에서 빈 칸 클릭 → 이동 0, `이동할 말을 클릭하세요.` 토스트.
- **YR-C8-011** (버그 C, 개 먼저): 큐 `['mo','gae']`·`pendingThrows=0`에서 개→모 소진 → `pendingThrows=0`, 턴 교대, 리필 없음.
- **YR-C8-012** (버그 C, 모 먼저): 동일 상태에서 모→개 소진 → 동일 결과(소진 순서 무관 입증).
- **YR-C8-013** (버그 C, 이중 적립 0): 실게임 흐름(THROW mo → 보너스 THROW non-bonus) 후 `pendingThrows=0` 입증.
- **YR-C8-014** (버그 D 양립): 큐 `['mo']`·`pendingThrows=1`에서 모 먼저 이동 → `pendingThrows=1` 보존, 턴 유지, 후속 THROW 허용.

### 핵심 입증

- **YR-C8-011 · YR-C8-012**가 양쪽 소진 순서에서 동일 결과(`pendingThrows=0`, 턴 교대, 리필 없음)를 단언 → 이전 `bonusFromConsumed` 모델의 **비대칭 리필 버그(버그 C) 해소**.
- **YR-C8-014**가 버그 C와 버그 D를 **하나의 `pendingThrows` 모델로 양립**함을 입증(권리가 던진 횟수에만 의존, 이동 시점 큐 상태 비의존).

## 스펙 대비 구현 상태

- [x] AC-B1/B2/B3 — 빈 칸 클릭 미출발 + 내 말/HOME 박스 클릭 회귀 유지 (HT-BUGB + 기존 hittest 회귀)
- [x] AC-C1 — 소진 순서 무관 (YR-C8-011/012)
- [x] AC-C2 — 이중 적립 0 (YR-C8-013)
- [x] AC-C3 — 버그 D 양립 (YR-C8-014)
- [x] AC-C4 — 기존 §6/§13-11/§13-12 회귀 무손상 (서버리스 342 + 버그 C 관련 27)

## 회귀 게이트

- 서버리스 회귀 **342 PASS** 유지 필수(직전 338 + 버그 C 신규 4 YR-C8-011~014, 단 HT-BUGB는 서버 필요 스위트). YR-C8-009는 기댓값 갱신(던지지 않은 yut 소비 → 리필 없음, 갱신 사유 파일 주석에 명기).
- bot-smoke 10/10, 레거시 smoke 36 유지.
- 향후 보너스/턴 종료 로직 변경 시 `hasBonus = capturedBonus || pendingThrows > 0` 통일 규칙과 "이동 시점 보너스 부여 금지"를 깨지 않도록 주의.

## Art Director 후속 조치

- visual_change: `none`
- AD 모드 2 필요 여부: **아니오** — 외부 이미지 에셋 생성/교체 없음(yutnori는 외부 에셋 0).
- AD 모드 3 필요 여부: **아니오** — UI 레이아웃/Canvas/CSS 변경 없음(버그 B는 클릭 핸들러 로직, 버그 C는 순수 서버 로직).
- **이 작업은 `visual_change: none`이므로 AD 단계를 생략하고 바로 QA/문서로 진행 가능.**

## 알려진 이슈

- 없음.

## QA 참고사항

- 버그 B 시각 확인: 내 차례 + 결과 칩 선택 + 전원 HOME 상태에서 보드 빈 칸 클릭 시 말이 나가지 않고 토스트만 떠야 한다(HT-BUGB 시나리오).
- 버그 C 핵심 회귀: 모 던짐 → 보너스로 한 번 더 던져 non-bonus → **어느 결과를 먼저 이동하든** 추가 던지기 리필이 없어야 한다(YR-C8-011/012가 양쪽 순서 가드).
- `pendingThrows`는 STATE에 노출되므로 QA가 던지기 권리 잔량을 직접 단언 가능(`state.pendingThrows`).
- 버그 D 양립(YR-C8-014): 보너스 던지기 전에 윷·모를 먼저 이동해도 던지기 권리가 보존되어야 한다(데드락/소실 0).
