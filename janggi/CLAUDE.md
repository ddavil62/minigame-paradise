# 장기 (Janggi) — 개발·QA 가이드

LAN 1:1 한국 전통 장기. KJA 2009 개정 룰(빅장 폐지, 점수제, 동형반복 3회) 기반.

## 룰북 (필수 참조)

**QA 및 기능 개발 시 반드시 룰북을 기준으로 삼는다.**

- 위치: `minigames/janggi/docs/RULEBOOK.md`
- 출처: 대한장기연맹(KJA) 2009 개정 룰 + 나무위키/Wikipedia/한국기원 교차 검증
- 구성: §1 게임 개요 / §2 판 구조 / §3 기물 점수 / §4 마·상 배치 4종 / §5 기물 이동 / §6 턴 / §7 승패 / §8 특수 규칙 / §9 시간 / §10 종료 / §11 금지 수 / §12 QA 체크리스트 / §13 구현 노트(룰 vs 구현 불일치 8건) + 부록 A/B

### QA 필수 준수 사항

1. 테스트 시작 전 룰북의 **§12 QA 체크리스트**를 확인한다.
2. 기물 이동 검증 시 룰북 **§5(이동 규칙) + §8-1(멱) + §8-2(포다리)** 기준을 따른다.
3. 장군/외통수/자살수 검증 시 룰북 **§7-1, §8-3, §8-4** 기준을 따른다.
4. 점수/덤 검증 시 룰북 **§3(기물 점수)** + 후수 덤 1.5(§7-2) 기준을 따른다.
5. 동형반복 3회·50수 룰은 룰북 **§7-4, §10** 기준. 50수 카운터 트리거 조건은 **§13-4** 참조.
6. 빅장은 **합법 수**로 처리한다 (룰북 §8-6, §13-6). 무승부 아님.
7. 양수겸장 시 합법 수는 궁 이동만 (룰북 §8-5, §13-7).
8. 구현이 룰북과 다른 경우 먼저 **§13 구현 노트**에 이미 기록된 정책 차이인지 확인한다. 룰북에 없는 차이라면 룰북 기준으로 버그 리포트를 작성한다.

## 테스트 가이드

### 테스트 분류

| 파일 | 개수 | 종류 | 서버 |
|------|------|------|------|
| `tests/janggi.spec.js` | 77 | 단위 (QA-001~020 시리즈) | 불필요 |
| `tests/qa-edge-cases.spec.js` | 58 | 단위 엣지케이스 | 불필요 |
| `tests/qa-e2e.spec.js` | 5 | E2E 브라우저 + WS | 필요 (3006 또는 3000) |
| `tests/rulebook-c1~c12-*.spec.js` | 111 | 룰북 기반 단위 (JR-C1~C12) | 불필요 |
| `lib/_smoke.js / _smoke_server.js / _smoke_launcher.js` | 126 | 스모크 (P1/P2/P3) | 부분 필요 |
| **합계** | **377** | | |

### 룰북 시나리오 (JR-Cx) 실행

```bash
cd C:/LazySlimeStudio/minigames/janggi

# 전체 111개 룰북 시나리오 (~2초, 단위 100%)
npx playwright test tests/rulebook-c*.spec.js --reporter=list

# 카테고리별 (예: 장군/외통수)
npx playwright test tests/rulebook-c4-check.spec.js --reporter=list
```

- 모든 룰북 시나리오는 `lib/{board,pieces,rules,score,game}.js`를 직접 import하는 단위 테스트다. 서버·브라우저 기동 불필요.
- `playwright.config.js`의 `workers: 1, fullyParallel: false` 설정으로 결정성 보장 (변경 금지).
- 시나리오 ID 체계: `JR-C{카테고리}-{시퀀스3자리}` (예: `JR-C4-011`). 회귀 발생 시 ID + 룰북 §번호로 추적.
- 모든 `test()` 블록 상단에 룰북 §번호 + Given/When/Then 한국어 주석 부착. 코드만 보고도 의도 파악 가능.

### 단위 vs E2E 가이드

- **단위 우선**: `lib/*.js` 함수 직접 호출. 빠르고(전체 ~2초) 결정적.
- **E2E 보완**: WS 메시지 변환(`MOVE` → `STATE`/`GAME_OVER`/`CHECK`)이나 setup 30초 타이머·재접속 복구 등은 `qa-e2e.spec.js` 패턴으로 커버.
- 룰북 111개는 lib 정확성에 강하나 **서버↔클라이언트 통합 회귀**는 미커버. 통합 수준 회귀가 의심되면 `qa-e2e.spec.js` 보강 우선.

### 카테고리별 §참조 매핑

| 카테고리 | 파일 | 시나리오 수 | 룰북 §참조 |
|----------|------|-------------|-----------|
| C1 기물 이동 | `rulebook-c1-pieces.spec.js` | 25 | §5-1~5-7 |
| C2 멱/포다리 | `rulebook-c2-block.spec.js` | 10 | §8-1, §8-2 |
| C3 궁성 대각/제한 | `rulebook-c3-palace.spec.js` | 10 | §2, §5-1~5-4, §5-7 |
| C4 장군/외통수/자살수 | `rulebook-c4-check.spec.js` | 15 | §7-1, §8-3, §8-4 |
| C5 동형반복/50수 | `rulebook-c5-repetition.spec.js` | 10 | §7-4, §10 |
| C6 점수제/덤 | `rulebook-c6-score.spec.js` | 10 | §3, §7-2 |
| C7 시간/초읽기 | `rulebook-c7-time.spec.js` | 5 | §9 |
| C8 무승부/기권 | `rulebook-c8-draw.spec.js` | 6 | §7-3, §8-7, §10 |
| C9 양수겸장 | `rulebook-c9-doublechk.spec.js` | 5 | §8-5, §13-7 |
| C10 빅장 | `rulebook-c10-bigcheck.spec.js` | 5 | §8-6, §11, §13-6 |
| C11 마/상 배치 | `rulebook-c11-setup.spec.js` | 5 | §4 |
| C12 절차 위반 | `rulebook-c12-procedure.spec.js` | 5 | §11-11 |

## 서버 실행

```bash
# 통합 런처 (포트 3000)
cd minigame-paradise && node launcher/server.js
# http://localhost:3000 → 장기 카드 클릭

# 단독 실행 (포트 3006, 개발/테스트용)
cd minigame-paradise && node janggi/server.js
```

## AI 봇

- matgo와 동일 패턴: `janggi/bot.js` 신규 + `janggi/server.js`의 `createApp(opts={})`가 `opts.getBotUrl`을 받아 mode=ai 진입 시 child_process로 spawn → 사람 disconnect 시 killBotChild.
- launcher 통합: `launcher/server.js`에서 `createJanggiApp({ getBotUrl: () => 'ws://localhost:${PORT}/janggi/ws?mode=bot' })`로 주입.
- 평가 함수 핵심 (`bot.js:chooseMove`):
  - `lib/rules.js`의 `getAllLegalMoves(board, side)` 사용 → `wouldBeSelfCheck` 필터 내장, 봇이 자살수를 둘 경로 원천 차단.
  - 잡는 수: `lib/score.js`의 `PIECE_SCORE`(차13/포7/마5/상/사3/졸2) 가산.
  - 장군 보너스: `cloneBoard` + `movePiece` 후 `isInCheck(sim, opponent)`이면 +1.
  - 기본 가중치 0.1, 동률 random 선택.
  - 합법 수 0이면 `RESIGN` 송신 → 외통수 직전 자동 기권 안전망.
- 마/상 배치는 `'MSMS'` 고정. 무승부 제안은 무시(묵시적 거절, 다음 MOVE 송신 시 서버가 `drawOfferedBy=null` 자동 리셋).
- 응답 지연 400~900ms. 중복 행동 방지 키 `phase|turn|moveCount`.

## 파일 구조 (요약)

```
janggi/
├── server.js                — createApp(opts) + WS handler + bot spawn/kill (3006)
├── bot.js                   — WS 봇 클라이언트 (mode=ai 진입 시 server가 spawn)
├── lib/
│   ├── board.js             — 9x10 보드, 4종 배치, 직렬화, 해시
│   ├── pieces.js            — 7종 기물 합법 이동 (멱/포다리/궁성 대각)
│   ├── rules.js             — 장군/외통수/자살수/양수겸장/동형반복
│   ├── score.js             — 기물 점수 + 덤 1.5
│   └── game.js              — GameSession (배치/이동/기권/무승부/시간)
├── public/                   — index.html + js/{main,board,pieces,ui}.js + css/style.css
├── docs/
│   └── RULEBOOK.md          — KJA 2009 권위 룰북
├── tests/
│   ├── janggi.spec.js
│   ├── qa-edge-cases.spec.js
│   ├── qa-e2e.spec.js
│   ├── rulebook-c1~c12-*.spec.js
│   └── helpers.js           — buildBoard / createPlayingGame / withKings 등
└── playwright.config.js     — workers:1, fullyParallel:false
```

## WS 프로토콜

| 방향 | 타입 | 설명 |
|------|------|------|
| C→S | `SELECT_SETUP` / `MOVE` / `RESIGN` / `DRAW_OFFER` / `DRAW_ACCEPT` / `REQUEST_MOVES` | 클라 액션 |
| S→C | `JOINED` / `STATE` / `GAME_OVER` / `CHECK` / `ERROR` | 서버 응답 |

## 알려진 제약

- AI 봇은 1수 휴리스틱 수준 (강한 AI/MCTS/정석 DB 없음, 봇 강도 조절 UI 없음)
- 관전 모드 / 기보 저장 / 모바일 레이아웃 미구현
- 외부 에셋 없음 (CSS/Canvas only)

## 주요 helpers (`tests/helpers.js`)

| 함수 | 용도 |
|------|------|
| `buildBoard(spec)` | spec 배열로 보드 빠르게 구성 |
| `createPlayingGame(boardSpec, turn)` | playing phase 게임 세션 즉시 생성 |
| `withKings(spec)` | 양 궁 강제 배치로 자살수 필터 간섭 회피 |
| `getFilteredMoves(state, side, file, rank)` | 자살수 필터 적용된 합법 수 |
| `isDoubleCheck` | `lib/rules.js`에서 직접 import (helpers re-export 누락, JR-C9 사용) |
