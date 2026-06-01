# 맞고 (Matgo) — 개발·QA 가이드

화투 1:1 대전 게임. 한국 표준 맞고 룰 기반.

## 룰북 (필수 참조)

**QA 및 기능 개발 시 반드시 룰북을 기준으로 삼는다.**

- 위치: `C:/antigravity/.claude/specs/2026-05-30-matgo-rulebook.md` (별도 머신, 본 레포에서 직접 수정 불가)
- 출처: 나무위키 맞고·고스톱 + 게임 코드 교차검증
- 포함 내용: 화투 48장 구성, 족보 점수표, 박 기준, 고배수 공식, QA 체크리스트, 구현 버그 목록

### 룰북 §13 보강 (2026-05-31 신규 5건 + 2026-06-02 폭탄 룰 정정·확정)

| 항목 | 내용 |
|---|---|
| 사통 (대통령) | 라운드 시작 시 손패 10장에 같은 월 4장이 포함되면 사통 모달 표시 → 선언 시 즉시 라운드 승 + **7점 보너스** (multiplier 없는 base 가산), 포기 시 정상 진행. phase: `awaiting_sangtong`, 메시지: `SELECT_SANGTONG { choice: 'declare' \| 'continue' }` |
| 흔들기 시점 변경 | **`shake_decision` phase 제거.** 라운드 시작 시 일괄 검사 → 같은 월 첫 카드를 낼 때 클라이언트 모달(`shake-modal`)로 이전. 흔들기 모달은 라운드당 1회 (`g.shakeAsked`) |
| 폭탄 확인 모달 | `window.confirm` → 전용 모달(`bomb-confirm-modal`)로 교체. 같은 월 두 번째 카드 낼 때 + 바닥 1장 조건에서 표시 |
| 첫뻑 보너스 | `g.firstPpeokBy` 신규 상태. 라운드 첫 뻑을 만든 플레이어가 승리 시 `applyFinalMultipliers`에서 `firstPpeokBonus` flag로 **+7점** 가산. reasons에 `첫뻑 +7` |
| 폭탄 보너스 뒤집기 권리 (기회 보존의 법칙) | **표준 룰 — 2026-06-02 정정·확정.** 폭탄 발동 = 같은 월 4장(손 3 + 바닥 1) 가져가기 + 상대 피 1장 + 통상 덱 뒤집기 1회. 추가로 **보너스 뒤집기 권리 +2** 누적(`g.bombDeckCredit`). 자기 차례에 **손이 0이어도** 권리가 남아 있으면 `bonusFlipSteps`로 덱 1장 뒤집기(단순 매칭만 — 쪽/뻑/따닥 미형성) + 고/스톱 결정 가능. 권리 사용 시 −1. **라운드 종료 조건** = 양쪽 모두 `손패 + bombDeckCredit` 합이 0 (기회 보존의 법칙으로 양쪽 잔여가 동기화되어 동시에 0 도달). 손 −3 + 보너스 +2 = 순 −1로 정상 1턴과 동등. **이전 'drawAndResolve 2회 연속(`bombExtraDraw`)' 모델은 본 모델로 대체됨.** 구현: `game.js` `bombSteps`/`bonusFlipSteps`, `bombDeckCredit` 상태 |
| floor 위치 고정 | 클라이언트 `floorSlotMap` (Map: 카드 ID → 슬롯 인덱스) 신규 캐시. 한 번 떨어진 위치 ID 기반 고정, 다른 카드 매칭으로 인덱스 당김 없음. `ROUND_START`/`GAME_START` 수신 시 `floorSlotMap.clear()` |

### QA 필수 준수 사항

1. 테스트 시작 전 룰북의 **§12 QA 체크리스트**를 확인한다.
2. 점수 계산 검증 시 룰북 **§5 족보** 기준을 따른다.
3. 박(패널티) 검증 기준:
   - 피박: 패자 피 카운트 **≤ 7장** (`score.js: loser.piCount <= 7`)
   - 멍박: 패자 끗 **= 0장** (`score.js: loser.kkeut === 0`)
   - 광박: 승자 광 ≥ 3 & 패자 광 = 0
   - 고박: 고 선언자 패배 시
4. 구현이 룰북과 다르면 **룰북 기준으로 버그 리포트**를 작성한다.
5. 랜덤성 의존 케이스(흔들기, 특정 월 패 분배)는 skip 처리하되 사유를 기록한다.

## 파일 구조

```
matgo/
├── server.js       — HTTP + WebSocket 서버 (createApp export + 단독 실행 지원)
│                     POST /test/inject 엔드포인트 포함 (Playwright E2E용)
├── game.js         — 게임 상태 머신 (턴 진행, 특수 이벤트)
├── score.js        — 점수 계산 + 배수/박 처리
├── cards.js        — 화투 48장 정의 (buildDeck)
├── bot.js          — AI 봇 로직
├── public/
│   ├── index.html  — 게임 UI
│   ├── client.js   — 클라이언트 로직 (WebSocket + 렌더링)
│   └── style.css
└── tests/
    ├── score.unit.spec.js   — score.js 단위 테스트 (52개, 서버 불필요)
    ├── game.unit.spec.js    — game.js 단위 테스트 (27개, 서버 불필요)
    ├── e2e-scenarios.spec.js — 브라우저 E2E 시나리오 (25개, 서버 필요)
    ├── v8-qa.spec.js        — 구버전 QA 테스트 (레거시)
    └── screenshots/         — E2E 스크린샷 출력
```

## 서버 실행 (테스트용)

```bash
# 포트 3013으로 단독 실행 (playwright.config.js 기준)
node matgo/server.js --port 3013

# playwright.config.js baseURL: http://localhost:3013
```

## 테스트 실행

```bash
cd C:/antigravity/minigame-paradise/matgo

# 단위 테스트 (서버 불필요, 빠름)
npx playwright test tests/score.unit.spec.js tests/game.unit.spec.js --reporter=list

# E2E 시나리오 테스트 (서버 3013 포트 사전 실행 필요)
node server.js --port 3013 &
npx playwright test tests/e2e-scenarios.spec.js --reporter=list

# 전체 실행 (단위 + E2E, 총 104개)
npx playwright test tests/score.unit.spec.js tests/game.unit.spec.js tests/e2e-scenarios.spec.js --reporter=list
```

### 테스트 현황 (2026-05-30 기준)

| 파일 | 테스트 수 | 상태 | 서버 필요 |
|------|----------|------|----------|
| `score.unit.spec.js` | 52개 | ✅ 전부 PASS | ❌ |
| `game.unit.spec.js` | 27개 | ✅ 전부 PASS | ❌ |
| `e2e-scenarios.spec.js` | 25개 | ✅ 전부 PASS | ✅ (3013) |
| **합계** | **104개** | **✅ 전부 PASS** | |

#### E2E 시나리오 요약 (e2e-scenarios.spec.js)

| 구간 | ID | 내용 |
|------|-----|------|
| §1 기본 연결 | E-01~E-06 | P1/P2 입장, 초기 상태, DOM ID 확인 |
| §2 기본 플레이 | E-07~E-11 | 카드 클릭, 턴 교대, perPoint 동기화, 재연결 |
| §3 inject 모달 | E-12~E-18 | go-stop, shake, floor-choice, kkeut 모달 주입 테스트 |
| §4 박 시나리오 | E-19~E-22 | 피박·멍박·광박·고박 round-modal 텍스트 검증 |
| §5 안정성 | E-23~E-25 | 콘솔 에러, AI봇 연결, 레이아웃 스크린샷 |

#### 알려진 주의사항

- **go-stop 버튼 클릭**: `go-stop-overlay`의 CSS `gostop-pulse` 애니메이션(infinite scale)으로 Playwright 안정성 검사가 무한 대기됨 → `{ force: true }` 옵션으로 우회 (E-13, E-14).
- **AI 봇 모드**: 단독 실행(`node server.js`)에서 `getBotUrl` 옵션이 필요. v8에서 자동 설정되도록 수정됨.

## 주요 ID 매핑 (DOM)

| 요소 | ID |
|------|-----|
| 흔들기 모달 | `shake-modal` (⚠️ shake-panel 아님) |
| 폭탄 패널 | `bomb-panel` |
| 폭탄 확인 모달 | `bomb-confirm-modal` (2026-05-31 신설, 카드 클릭 시점 모달) |
| 사통 모달 | `sangtong-modal` (2026-05-31 신설, 라운드 시작 시 같은 월 4장) |
| 고/스톱 오버레이 | `go-stop-overlay` |
| 9월 술잔 모달 | `kkeut-modal` |
| 라운드 결과 모달 | `round-modal` |
| 배너 상태 | `banner-status` |
| 배너 배수 | `banner-multiplier` |

## 변경 시 자주 깨지는 함정

1. **`shake_decision` phase는 더 이상 존재하지 않는다.** (2026-05-31 제거) 흔들기는 클라이언트 모달로만 처리. 서버 phase·메시지에서 참조하지 말 것. 기존 e2e `E-13/E-15/E-16` inject 시나리오가 의존했으므로 후속 정리 필요.
2. **사통 phase `awaiting_sangtong`은 `isPauseForUserInput()`이 true를 반환해야 한다.** (`server.js`) 누락 시 사통 모달 표시 중에도 서버가 봇 턴을 진행해 상태 깨짐.
3. **첫뻑 보너스(`firstPpeokBonus`)는 base 가산 7점이지 multiplier가 아니다.** `applyFinalMultipliers`에서 base에 +7 후 박/고 multiplier가 곱해진다. 순서 바뀌면 점수 폭주.
4. **폭탄 후 `g.bombExtraDraw` 플래그는 두 번째 `drawAndResolve` 직후 반드시 false로 리셋.** 미리셋 시 `chooseFloorSteps`에서 무한 3회차 진입 가능.
5. **`floorSlotMap`은 클라이언트 클로저 변수.** 서버 STATE에 슬롯 정보를 싣지 말 것. `ROUND_START`/`GAME_START` 수신 시 반드시 `clear()`.
6. **`g.firstPpeokBy`/`g.pendingSangtong`/`g.shakeAsked`/`g.bombExtraDraw`는 `startRound`에서 초기화.** 누락 시 라운드 간 상태 누수.
7. **사통과 흔들기는 같은 라운드에 동시 충족 가능** (같은 월 4장 ⊃ 같은 월 3장). 사통 우선, `continue` 선택 시에만 흔들기 검사가 카드 클릭 시점에 작동.
