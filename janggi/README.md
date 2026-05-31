# 장기 (Janggi)

LAN 1:1 한국 전통 장기. KJA 2009 개정 룰(빅장 폐지, 점수제, 동형반복 3회) 기준.

## 룰 요약

- 9x10 격자, 양 진영 각 16개 기물 (궁/사/차/포/마/상/졸)
- 마/상 배치 4종(MSMS/SMSM/MSSM/SMMS) 선택 가능. 초가 먼저, 한이 응수
- 한(漢, 적색)이 선수, 초(楚, 청색)가 후수
- 포다리 규칙, 마/상 멱 차단, 궁성 대각선 이동 포함
- 종료 조건: 외통수, 기권, 시간패, 동형반복 3회(점수제), 50수 룰(점수제)
- 점수제 시 후수(초) +1.5 덤
- 빅장은 합법 수 (무승부 아님)
- 시간제: 본 시간 10분 + 초읽기 30초 x 3회

## 실행

### 통합 런처 (권장)

```bash
cd minigame-paradise
node launcher/server.js
# http://localhost:3000 접속 -> 장기 카드 클릭
```

### 단독 실행 (개발/테스트)

```bash
cd minigame-paradise
node janggi/server.js
# http://localhost:3006 접속
```

## 테스트

```bash
cd minigame-paradise

# Playwright 단위 테스트 (서버 불필요, 77개)
npx playwright test --config janggi/playwright.config.js janggi/tests/janggi.spec.js --reporter=list

# QA 엣지케이스 테스트 (58개)
npx playwright test --config janggi/playwright.config.js janggi/tests/qa-edge-cases.spec.js --reporter=list

# E2E 브라우저 테스트 (서버 필요, 5개)
npx playwright test --config janggi/playwright.config.js janggi/tests/qa-e2e.spec.js --reporter=list

# 스모크 테스트
node janggi/lib/_smoke.js            # P1 게임 로직 (73개)
node janggi/lib/_smoke_server.js     # P2 서버 WS (34개)
node janggi/lib/_smoke_launcher.js   # P3 런처 통합 (19개)
```

## 파일 구조

```
janggi/
  server.js                  # createApp() + WS 핸들러 + 정적 파일 서빙 (포트 3006)
  lib/
    board.js                 # 9x10 보드 CRUD, 4종 배치, 직렬화, 해시
    pieces.js                # 7종 기물 합법 이동 산출 (멱/포다리/궁성 대각선)
    rules.js                 # 장군/외통수/자살수/양수겸장/동형반복 판정
    score.js                 # 기물 점수 집계 + 덤 1.5
    game.js                  # GameSession 상태 (배치/이동/기권/무승부/시간)
  public/
    index.html               # 게임 UI 진입점
    css/style.css            # 보드/기물/모달/하이라이트 스타일 (CSS 변수 18개)
    js/main.js               # WS 클라이언트, 이벤트 라우팅
    js/board.js              # Canvas 보드 렌더링 (592x672px)
    js/pieces.js             # 기물 DOM 렌더링 (한자, 팔각형 clip-path)
    js/ui.js                 # 모달/시간/토스트/잡힌 기물 UI
  tests/
    janggi.spec.js           # QA-001~QA-020 (77개)
    qa-edge-cases.spec.js    # 엣지케이스 (58개)
    qa-e2e.spec.js           # E2E 브라우저 (5개)
    helpers.js               # 테스트 유틸
  playwright.config.js       # Playwright 설정
```

## WS 프로토콜

| 방향 | 타입 | 설명 |
|------|------|------|
| C->S | `SELECT_SETUP` | 마/상 배치 선택 |
| C->S | `MOVE` | 기물 이동 |
| C->S | `RESIGN` | 기권 |
| C->S | `DRAW_OFFER` / `DRAW_ACCEPT` | 무승부 제안/수락 |
| C->S | `REQUEST_MOVES` | 합법 수 요청 |
| S->C | `JOINED` | 접속 확인 (side 배정) |
| S->C | `STATE` | 보드 전체 스냅샷 |
| S->C | `GAME_OVER` | 종료 (winner, reason, scores) |
| S->C | `CHECK` / `ERROR` | 장군 알림 / 에러 |

## 제약사항

- AI 봇 미지원 (`botAvailable: false`). LAN 2인 PvP 전용.
- 관전 모드, 기보 저장/내보내기 미구현.
- 모바일 레이아웃 미최적화 (데스크톱 우선).
- 외부 에셋 없음 (CSS/Canvas only).

## 룰 기준 문서

- `.claude/specs/2026-05-31-janggi-rulebook.md`
