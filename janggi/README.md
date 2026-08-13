# 장기 (Janggi)

1:1 한국 전통 장기. KJA 2009 개정 룰(빅장 폐지, 점수제, 동형반복 3회) 기준.

> 친구는 같은 공유기에서도 `https://112.155.2.238`로 접속한다. 포트 3000과 개별 게임 포트는 내부·개발 전용이다.

## 룰 요약

- 9x10 격자, 양 진영 각 16개 기물 (궁/사/차/포/마/상/졸)
- 마/상 배치 4종(MSMS/SMSM/MSSM/SMMS) 선택 가능. 초가 먼저, 한이 응수
- 한(漢, 적색)이 선수, 초(楚, 청색)가 후수
- 포다리 규칙, 마/상 멱 차단, 궁성 대각선 이동 포함
- 종료 조건: 외통수, 기권, 시간패, 동형반복 3회(점수제), 50수 룰(점수제)
- 점수제 시 후수(초) +1.5 덤
- 빅장은 합법 수 (무승부 아님)
- 시간제: 본 시간 10분 + 초읽기 30초 x 3회

> KJA 2009 표준과 본 구현의 미세 차이 8건(졸 궁성 대각, 차/포 궁성 임의 거리, 50수 트리거, 동형반복 초기 해시, 빅장 합법 처리, 양수겸장 응수 부재, 무승부 자동 취소 방향 등)은 룰북 §13 "구현 노트" 참조.

## 실행

### 통합 런처 (권장)

```bash
cd minigame-paradise
node launcher/server.js
# 공개 운영은 start-public.ps1 실행 후 https://112.155.2.238 접속 -> 장기 카드 클릭
```

### 단독 실행 (개발/테스트)

```bash
cd minigame-paradise
node janggi/server.js
# http://localhost:3006 접속
```

## 테스트

총 292개 테스트 — 단위 77 + 엣지 58 + E2E 5 + 룰북 111 + 스모크 126 (lib 73 / server 34 / launcher 19).

```bash
cd minigame-paradise

# Playwright 단위 테스트 (서버 불필요, 77개)
npx playwright test --config janggi/playwright.config.js janggi/tests/janggi.spec.js --reporter=list

# QA 엣지케이스 테스트 (58개)
npx playwright test --config janggi/playwright.config.js janggi/tests/qa-edge-cases.spec.js --reporter=list

# E2E 브라우저 테스트 (서버 필요, 5개)
npx playwright test --config janggi/playwright.config.js janggi/tests/qa-e2e.spec.js --reporter=list

# 룰북 기반 시나리오 (단위, 서버 불필요, 111개 — JR-C1~C12)
npx playwright test --config janggi/playwright.config.js janggi/tests/rulebook-c*.spec.js --reporter=list

# 스모크 테스트
node janggi/lib/_smoke.js            # P1 게임 로직 (73개)
node janggi/lib/_smoke_server.js     # P2 서버 WS (34개)
node janggi/lib/_smoke_launcher.js   # P3 런처 통합 (19개)
```

## AI 봇

- `bot.js` 단독 WS 클라이언트. matgo 봇 패턴과 동일 (`node bot.js --url ws://...` 실행).
- 1수 휴리스틱 평가: 잡는 수 우선(차13/포7/마5/상3/사3/졸2) + 장군 보너스(+1) + 기본 가중치(0.1) + 동률 random.
- 자살수는 `getAllLegalMoves`의 `wouldBeSelfCheck` 필터로 원천 차단. 합법 수 0이면 자동 RESIGN.
- 마/상 배치는 `MSMS` 고정 송신. 무승부 제안은 무시(묵시적 거절, 다음 수 송신 시 서버가 자동 리셋).
- 응답 지연 400~900ms.
- launcher 1/2 AI 모드에서 장기 카드 클릭 → janggi 서버가 child_process로 봇 자동 spawn → 사람 disconnect 시 자동 종료.

## 파일 구조

```
janggi/
  server.js                  # createApp(opts) + WS 핸들러 + bot spawn/kill + 정적 파일 서빙 (포트 3006)
  bot.js                     # WS 봇 클라이언트 (mode=ai 진입 시 server가 spawn)
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
    rulebook-c1-pieces.spec.js     # JR-C1 기물 이동 25개 (§5)
    rulebook-c2-block.spec.js      # JR-C2 멱/포다리 10개 (§8-1, §8-2)
    rulebook-c3-palace.spec.js     # JR-C3 궁성 대각/제한 10개 (§2, §5)
    rulebook-c4-check.spec.js      # JR-C4 장군/외통수/자살수 15개 (§7-1, §8-3, §8-4)
    rulebook-c5-repetition.spec.js # JR-C5 동형반복/50수 10개 (§7-4, §10)
    rulebook-c6-score.spec.js      # JR-C6 점수제/덤 10개 (§3, §7-2)
    rulebook-c7-time.spec.js       # JR-C7 시간/초읽기 5개 (§9)
    rulebook-c8-draw.spec.js       # JR-C8 무승부/기권 6개 (§7-3, §8-7, §10)
    rulebook-c9-doublechk.spec.js  # JR-C9 양수겸장 5개 (§8-5, §13-7)
    rulebook-c10-bigcheck.spec.js  # JR-C10 빅장 합법 처리 5개 (§8-6, §11, §13-6)
    rulebook-c11-setup.spec.js     # JR-C11 마/상 배치 4종 5개 (§4)
    rulebook-c12-procedure.spec.js # JR-C12 절차 위반 5개 (§11-11)
    helpers.js               # 테스트 유틸
  docs/
    RULEBOOK.md              # KJA 2009 기반 권위 룰북 (632줄, §1~§13 + 부록)
  playwright.config.js       # Playwright 설정 (workers:1, fullyParallel:false)
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

- AI 봇은 1수 휴리스틱 수준 (강한 AI/MCTS/정석 DB 없음).
- 관전 모드, 기보 저장/내보내기 미구현.
- 모바일 레이아웃 미최적화 (데스크톱 우선).
- 외부 에셋 없음 (CSS/Canvas only).

## 룰 기준 문서

- `docs/RULEBOOK.md` — KJA 2009 기반 권위 룰북 (§1 게임 개요 ~ §13 구현 노트, 부록 A/B)
- 모든 `tests/rulebook-c*.spec.js` 시나리오는 룰북 §번호를 인용한다. QA 회귀 발생 시 시나리오 ID(`JR-C{cat}-{seq}`) + 룰북 §번호로 추적한다.
