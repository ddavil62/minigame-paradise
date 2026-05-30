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
├── game.js         — 게임 상태 머신 (턴 진행, 특수 이벤트)
├── score.js        — 점수 계산 + 배수/박 처리
├── cards.js        — 화투 48장 정의 (buildDeck)
├── bot.js          — AI 봇 로직
├── public/
│   ├── index.html  — 게임 UI
│   ├── client.js   — 클라이언트 로직 (WebSocket + 렌더링)
│   └── style.css
└── tests/
    ├── v8-qa.spec.js   — Playwright QA (11개 테스트)
    └── screenshots/    — 테스트 스크린샷
```

## 서버 실행 (테스트용)

```bash
# 포트 3013으로 단독 실행 (playwright.config.js 기준)
node matgo/server.js --port 3013

# playwright.config.js baseURL: http://localhost:3013
```

## 테스트 실행

```bash
# 서버 먼저 실행 후:
cd C:/antigravity/minigame-paradise/matgo
npx playwright test tests/v8-qa.spec.js --reporter=list
```

### 테스트 목록 및 상태

| ID | 테스트명 | 상태 | 비고 |
|----|---------|------|------|
| A | 기본 진행: 손패 10장씩 분배 | ✅ PASS | |
| B | DOM 참조 회귀: v8 신 ID 존재 | ✅ PASS | `shake-modal` ID 사용 (shake-panel 아님) |
| C | 카드 클릭 → 손패 감소 + 턴 교대 | ✅ PASS | |
| D | perPoint 변경 → 양측 동기화 | ✅ PASS | |
| E | 새 게임 confirm 다이얼로그 | ✅ PASS | |
| F | 카드 5장 진행 + 콘솔 에러 없음 | ❌ FAIL | fly 애니메이션 중 클릭 타이밍 문제 (미수정) |
| G | 빠른 연속 클릭 방어 | ✅ PASS | |
| H | 페이지 새로고침 후 재연결 | ✅ PASS | |
| I | UI 시각 검증 스크린샷 | ✅ PASS | |
| J | 흔들기 패널 표시 | ⏭ SKIP | 랜덤성 의존, 흔들기 미발생 라운드 시 skip |
| K | 새 라운드 버튼 안전 처리 | ✅ PASS | |

### 알려진 이슈

- **F 테스트 타임아웃**: 카드 fly 애니메이션 중(`visibility:hidden`) `firstClickableId` 카드를 Playwright가 클릭 시도 → 30초 대기 누적. **게임 버그 아님**, 테스트 타이밍 처리 부족.
- **J 테스트 랜덤**: 흔들기 발동 조건(같은 월 3장)이 확률적. 발동 시 PASS, 미발동 시 SKIP.

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
