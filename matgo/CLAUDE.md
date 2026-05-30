# 맞고 (Matgo) — 개발·QA 가이드

화투 1:1 대전 게임. 한국 표준 맞고 룰 기반.

## 룰북 (필수 참조)

**QA 및 기능 개발 시 반드시 룰북을 기준으로 삼는다.**

- 위치: `C:/antigravity/.claude/specs/2026-05-30-matgo-rulebook.md`
- 출처: 나무위키 맞고·고스톱 + 게임 코드 교차검증
- 포함 내용: 화투 48장 구성, 족보 점수표, 박 기준, 고배수 공식, QA 체크리스트, 구현 버그 목록

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
| 고/스톱 오버레이 | `go-stop-overlay` |
| 9월 술잔 모달 | `kkeut-modal` |
| 라운드 결과 모달 | `round-modal` |
| 배너 상태 | `banner-status` |
| 배너 배수 | `banner-multiplier` |
