# Yutnori — 프로젝트별 작업 컨벤션

> LAN 1:1 한국 전통 윷놀이. Node.js + 바닐라 JS. Phase 1 완료, smoke 18/18 PASS. Playwright 3종(유닛 65 + WS 20 + E2E 25 = 110) 전부 PASS.

## 정체성

- **목적**: 친구가 놀러 왔을 때 LAN으로 즉시 즐기는 1:1 윷놀이
- **레포 관리**: lazyslimestudio 하위 폴더(`yutnori/`)로 관리 (별도 git 분리 안 함)
- **기술**: Node 18+ (ESM), Express 4, ws 8, 바닐라 JS (프레임워크 0), HTML5 Canvas
- **외부 에셋**: 없음 — 모든 시각은 CSS/Canvas로 표현 (윷가락도 Canvas)

## 핵심 설계 원칙 (변경 시 주의)

1. **서버 권위 (Server Authoritative)**
   - 윷가락 던지기 결과는 **서버에서 결정** (`throwYutSticks()` in server.js)
   - 말 이동/잡기/업기/완주 판정 모두 서버 (`movePiece()`, `resolveLanding()`)
   - 매 액션 후 전체 게임 상태(`STATE`)를 양쪽에 broadcast
   - 클라이언트는 입력 전송 + 상태 렌더링만 (`game.js`는 캐시 + 검증 헬퍼)
   - **tetris-battle와 차이**: tetris-battle은 클라 권위 + 서버 중계. yutnori는 턴제 + 랜덤이 핵심이므로 권위형이 적합.
2. **신뢰 환경 (LAN, 친구 대전)**
   - 입력 검증은 있으나(턴/완주/큐 잔여) 가벼움. 강한 안티치트는 Out of Scope.
3. **포트 충돌 자동 폴백**
   - 3000~3010 자동 시도. `wss = new WebSocketServer({ server })`가 HTTP server를 공유하므로 EADDRINUSE 시 **양 채널에 error 핸들러 필수** (tetris-battle 함정 동일).
4. **단순화 결정**
   - 모서리(5, 10)에 정확히 멈추면 다음 이동 시 **자동으로** 지름길 진입. (정통 룰은 선택지지만 친구 게임은 빠르게)
   - 중앙(23)에서만 분기 모달로 출구 선택.
   - 백도(빽도, X자 표식 가락) 변형 룰 미적용.
   - 중앙→좌하 출구 합류는 직접 완주(GOAL)로 단순화 (정통 룰의 마지막 칸 1개 거치기 생략).

## 디렉토리

```
yutnori/
├── server.js                 # 백엔드 + 게임 로직 (서버 권위)
├── start.bat / stop.bat      # Windows 더블클릭 런처
├── package.json
├── playwright.config.js      # Playwright 공통 설정 (port 3088)
├── README.md                 # 사용자 대상
├── CLAUDE.md                 # 본 문서
├── docs/
│   ├── PROJECT.md            # 현재 상태 스냅샷
│   └── CHANGELOG.md          # Phase별 이력
├── public/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── main.js           # 진입점
│       ├── network.js        # WebSocket
│       ├── game.js           # 클라 상태 캐시 + 검증 헬퍼
│       ├── board.js          # 칸 좌표 + 경로 정의 (서버 인덱스와 동기화)
│       ├── yut.js            # 윷 결과명/한글/가락 렌더링
│       ├── piece.js          # 클릭 hit-test
│       └── ui.js             # Canvas 보드/말 + DOM HUD
└── tests/
    ├── smoke.test.js          # 레거시 smoke, 18 assert (node 직접 실행)
    ├── yut.unit.spec.js       # Playwright 단위 65개 — throwYutSticks/computeNextCell
    ├── ws.scenarios.spec.js   # Playwright WS 20개 — 메시지 프로토콜/게임 흐름
    └── e2e-scenarios.spec.js  # Playwright E2E 25개 — 브라우저 2페이지 실전 검증
```

## 테스트 실행법

### Playwright (주력 테스트 스위트, 110개)

```powershell
cd C:\antigravity\minigame-paradise\yutnori

# 터미널 1 (서버 — E2E 테스트용. 유닛/WS는 서버 없이도 가능)
node server.js --port 3088

# 터미널 2 (전체 110개 실행)
npx playwright test tests/yut.unit.spec.js tests/ws.scenarios.spec.js tests/e2e-scenarios.spec.js --reporter=list

# 개별 실행
npx playwright test tests/yut.unit.spec.js      # 유닛 65개 (서버 불필요)
npx playwright test tests/ws.scenarios.spec.js  # WS  20개 (서버 불필요 — createApp 직접 import)
npx playwright test tests/e2e-scenarios.spec.js # E2E 25개 (port 3088 서버 필요)
```

기대: `110 passed`

### 레거시 smoke (18 assert)

```powershell
node tests/smoke.test.js --port 3088
```

기대: `PASS: 18, FAIL: 0`

### 회귀 게이트

- 모든 변경은 **Playwright 110/110 PASS**를 유지해야 한다.
- smoke 18/18도 유지한다.
- 신규 시나리오는 추가하되 기존 시나리오는 수정/삭제하지 않는다.

## WebSocket 메시지 프로토콜

| 방향 | 타입 | 페이로드 | 비고 |
|------|------|----------|------|
| C→S | JOIN | `{ playerName }` | 입장 |
| S→C | JOINED | `{ playerId, waiting, hostUrl }` | p1/p2 할당 |
| C→S | READY | `{}` | 시작 준비 |
| S→C | START | `{ countdown }` | 양쪽 READY 시 broadcast |
| S→C | STATE | `{ started, currentTurn, pendingResults, awaitingBranchAt, winner, players }` | 매 액션 후 전체 상태 broadcast |
| C→S | THROW_YUT | `{}` | 권위: 서버가 결과 결정 |
| S→C | YUT_RESULT | `{ by, sticks, result, steps, bonus }` | 양쪽 broadcast |
| C→S | MOVE_PIECE | `{ pieceIndex, useResult }` | 사용 결과는 큐에서 차감 |
| S→C | BRANCH_REQUEST | `{ pieceIndex, playerId }` | 중앙 분기 대기 |
| C→S | CHOOSE_PATH | `{ pathChoice: 'top'|'bottom' }` | 분기 응답 |
| S→C | GAME_OVER | `{ winner, reason? }` | 4말 완주 또는 disconnect |
| C→S | REMATCH | `{}` | 재대결 요청 |
| S→C | REMATCH_STATUS | `{ p1Ready, p2Ready }` | 양쪽 모두 시 START 재발송 |
| S→C | ERROR | `{ message }` | 잘못된 요청 |

## 코드 컨벤션

- **언어**: 한국어 UI + 한국어 주석/문서
- **모듈**: ES Modules (`"type": "module"`)
- **외부 라이브러리**: 클라이언트 0, 서버는 ws + express만 (devDependency로 playwright)
- **주석**: `@fileoverview` + JSDoc + `// ── 섹션 ──` 구분

## 변경 시 자주 깨지는 함정

| 항목 | 함정 |
|---|---|
| `wss = new WebSocketServer({ server })` | server와 wss 양쪽에 error 핸들러 필요. wss에만 또는 server에만 등록하면 EADDRINUSE 시 unhandled로 즉시 종료. |
| `board.js` 칸 좌표 vs `server.js` 인덱스 | 칸 인덱스 매핑은 양쪽이 **반드시 일치**해야 함 (0~19 외곽, 21/22 지름길A, 26/27 지름길B, 23 중앙). 변경 시 양쪽 동시 갱신. |
| `MOVE_PIECE`의 `useResult` 검증 | 서버는 `pendingResults`에 해당 결과명이 있는지 indexOf로 검사. 큐에 없으면 ERROR. |
| 보너스 턴 처리 | `lastResult === 'yut' || 'mo'`이면 큐가 비어도 다시 던질 수 있음. 잡기 보너스는 `game.capturedBonus` 플래그로 별도. 턴 종료 판단 시 `hasBonus` 체크 필수. |
| 분기 대기 (`awaitingBranchAt`) | THROW/MOVE 모두 차단. 중앙 도달 시 piece는 **아직 이동시키지 않은 상태**로 두고 awaiting만 기록 → CHOOSE_PATH 시 movePiece 재호출. |
| `start.bat` 인코딩 | ASCII-only로 유지. 한글 포함 시 cmd 949 코드페이지에서 깨짐. |
| `stop.bat` 방식 | tetris-battle와 달리 윈도우 타이틀(`Yutnori Server`) 기준으로 종료 → 포트 3000~3010을 공유하는 다른 프로젝트(tetris-battle, matgo) 서버를 실수로 죽이지 않음. |
| 윷가락 fronts↔result 매핑 | 정통 룰: 평평면 개수 = 칸 수 (도=1, 개=2, 걸=3, 윷=4). **모만 예외 (0개 → 5칸).** 백도는 fronts=1이고 그 평평면이 마크 가락일 때 발동. 거꾸로(fronts=0→윷, 4→모) 매핑하면 사용자 직관과 정반대로 동작하여 즉시 신고됨. Phase 2.1 핫픽스 사유. |

## 파이프라인 적용 규칙

- **`visual_change: ui`**가 기본 (Canvas/CSS 변경). UI 변경 시 AD3 검수 권장.
- **`visual_change: art`는 발생하지 않음** (외부 이미지 에셋 사용 안 함). AD1/2 생략.
- 순수 서버 변경은 `visual_change: none` 가능.

## 향후 작업 우선순위

| 우선순위 | 항목 | 비고 |
|---|---|---|
| 중간 | 백도(빽도) 변형 룰 옵션 추가 | X자 표식 가락 1개 |
| 중간 | 분기 진입 옵션 (모서리에서 외곽 계속 vs 지름길 선택) | 정통 룰 |
| 낮음 | 던지기 애니메이션 (가락 회전) | 시각 폴리시 |
| 낮음 | 사운드 (윷가락 소리, 잡기 효과음) | |
| 낮음 | 채팅 또는 이모지 | 친구 대전 폴리시 |
| 낮음 | 옵저버 모드 | 현재 2인 1룸 고정 |

## Mockup Sync

- 외부 이미지 에셋이 없으므로 `studio-mockup` 동기화 **불필요**.

## 참조

- 사용자 문서: `README.md`
- 현재 상태: `docs/PROJECT.md`
- 변경 이력: `docs/CHANGELOG.md`
- Coder 리포트: `C:\LazySlimeStudio\.claude\specs\2026-05-25-yutnori-coder-report.md`
