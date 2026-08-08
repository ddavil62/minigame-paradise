# Hanabi — 프로젝트별 작업 컨벤션

> LAN 2인 완전 협력 카드게임 하나비(불꽃놀이). Node.js + 바닐라 JS. **1차 코어 완료 (2026-06-01)** + **대기 화면 가이드 슬라이더 추가 (2026-06-01)**. Playwright **61/61 PASS** (유닛 31 + WS 7 + QA엣지 8 + E2E 6 + 가이드 슬라이더 9). 룰북 §13 8건 전부 confirmed.

## 룰북 (필수 숙지)

**`docs/RULEBOOK.md`** — Antoine Bauza 표준 Hanabi 룰 + 본 구현 비교. matgo/janggi/yutnori와 동일한 13섹션 패턴.

- 룰북 시나리오 테스트는 §번호를 인용한다 (테스트 ID `HR-Cn-xxx`).
- 게임 로직(`game.js`)을 수정하면 **§13 구현 노트의 영향 항목을 확인**하고 영향이 있으면 같은 작업에서 §13을 갱신한다.
- `§13 구현 노트`: 구현 vs 표준 차이 **8건 전부 confirmed** (2026-06-01). 룰북 시나리오 회귀 게이트의 핵심.
- §12 체크리스트를 관련 회귀 테스트 범위의 기준으로 사용한다.

## 정체성

- **목적**: 친구가 놀러 왔을 때 LAN으로 즉시 즐기는 2인 협력 하나비
- **장르**: 완전 협력(co-op). 둘이 한 팀으로 5색 불꽃을 1→5 쌓아 최대 25점을 함께 만든다.
- **핵심 반전**: 각자 **자기 손패를 볼 수 없다**. 상대 손패는 보이지만 내 손패는 가려진다. 제한된 힌트 토큰으로만 정보를 전달.
- **레포 관리**: lazyslimestudio 하위 폴더(`hanabi/`)로 관리 (별도 git 분리 안 함). 미니게임 천국 7번째 종목.
- **기술**: Node 18+ (ESM), 순수 `node:http` + `ws` 8 (Express 미사용), 바닐라 JS (프레임워크 0)
- **외부 에셋**: 게임플레이 시각은 **CSS/HTML만** (5색 카드·토큰·불꽃 전부 코드로 표현, 게임 화면 이미지 0). 단, **대기 화면 룰 가이드 인포그래픽 7장**(GPT Image 2.0 생성, `public/assets/guide/1.png~7.png`)이 존재한다 — 게임 진행 시각이 아닌 가이드 전용 이미지.

## 핵심 설계 원칙 (변경 시 주의)

1. **서버 권위 + 손패 가림 (Server Authoritative + Hidden Hand)**
   - 모든 판정(힌트 검증·내기 성공/실패·토큰·종료·점수)은 **서버에서** 처리 (`game.js` 순수 로직).
   - **손패 가림이 본 게임의 정체성이며 서버가 강제한다.** `snapshotForPlayer(state, playerId)`가 본인 손패의 `color`/`number`를 **명시적 null로 마스킹**하고, 키 화이트리스트(`id`/`color`/`number`/`clues`)로 누설 표면을 최소화한다. 받은 힌트(`clues` 배열)는 마스킹하지 않는다.
   - 매 액션 후 각 플레이어에게 **개별 마스킹된 STATE**를 전송 (`broadcastState()` — 공통 페이로드 broadcast 아님).
   - 클라이언트는 입력 전송 + 렌더링만. `myHand[].color/number===null`을 받아 무조건 가림 렌더.
2. **게임 로직 분리**
   - `game.js`: 순수 함수 (덱·손패·토큰·판정·마스킹), 서버 불필요 단위 테스트 가능 (codenames-duet 패턴).
   - `server.js`: `createApp()` factory가 `{ handleHttp, handleUpgrade, setHostUrl }` 반환. WS noServer 모드.
3. **신뢰 환경 (LAN, 친구 대전)**
   - 입력 검증은 견고하나(턴/handIndex 범위/힌트 value 화이트리스트) 강한 안티치트는 Out of Scope.
4. **포트 충돌 자동 폴백**
   - 단독 실행 기본 포트 **3007**, `MAX_PORT_FALLBACK=10` (yutnori 패턴). 0.0.0.0 바인딩 + LAN IP 배너.

## 디렉토리

```
hanabi/
├── game.js                  # 순수 게임 로직 (덱·손패·토큰·판정·마스킹) — 서버 불필요
├── server.js                # WS 서버 + createApp() factory + 단독 실행 (port 3007)
├── package.json             # { "type": "module" } + ws
├── playwright.config.js     # Playwright 설정
├── CLAUDE.md                # 본 문서
├── README.md                # 사용자 대상
├── docs/
│   ├── RULEBOOK.md          # 권위 룰북 (§1~§13)
│   ├── PROJECT.md           # 현재 상태 스냅샷
│   └── CHANGELOG.md         # 변경 이력
├── public/
│   ├── index.html           # 대기/게임/종료 3화면 (대기 화면에 가이드 슬라이더 포함)
│   ├── css/style.css        # 5색 카드·토큰·불꽃·다크 테마 + 가이드 슬라이더 스타일
│   ├── js/
│   │   ├── main.js          # 진입점 — 렌더링 조율, 행동 모드, 종료 화면, initGuideSlider()
│   │   └── network.js       # WebSocket 연결·메시지 송수신
│   └── assets/guide/        # 룰 가이드 인포그래픽 7장 (1.png~7.png, GPT Image 2.0 생성)
└── tests/
    ├── rulebook-c1-c5-unit.spec.js    # 유닛 31 (HR-C1~C5, 서버 불필요)
    ├── rulebook-c6-ws.spec.js         # WS 7 (HR-C6, createApp 직접 import)
    ├── rulebook-c7-qa-edge.spec.js    # QA 엣지/경계/오프바이원 8 (HR-C7)
    ├── rulebook-c8-e2e-browser.spec.js  # E2E 브라우저 입장·손패가림 2 (HR-C8)
    ├── rulebook-c9-e2e-actions.spec.js  # E2E 힌트/내기/버리기 클릭 3 (HR-C9)
    ├── rulebook-c10-e2e-gameover.spec.js # E2E 종료 오버레이 1 (HR-C10)
    └── rulebook-c11-guide-slider.spec.js # 가이드 슬라이더 9 (HR-C11, E2E)
```

## 테스트 실행법

### Playwright (61개)

```powershell
cd C:\LazySlimeStudio\minigames\hanabi

# 터미널 1 (서버 — E2E C8~C11 전용. 유닛/WS/QA엣지는 서버 없이도 가능)
node server.js --port 3095

# 터미널 2 (전체 61개)
npx playwright test --reporter=line

# 서버 없이 가능한 부분만 (유닛 31 + WS 7 + QA엣지 8 = 46개)
npx playwright test tests/rulebook-c1-c5-unit.spec.js tests/rulebook-c6-ws.spec.js tests/rulebook-c7-qa-edge.spec.js --reporter=line
```

기대: `61 passed` (유닛 31 + WS 7 + QA엣지 8 + E2E 6 + 가이드 슬라이더 9).

> ⚠️ **E2E C8~C11은 `node server.js --port 3095` 사전 구동 필수.** 서버 미구동 시 ERR_CONNECTION_REFUSED로 FAIL(테스트 결함 아님). C11(가이드 슬라이더)도 브라우저 + PNG 정적 서빙을 확인하므로 서버 구동 필요.

### 회귀 게이트 (변경 시 우선 실행)

1. **손패 누설 WS 검증** (HR-C6-001, HR-C7-001): 최중요 1순위. raw WS STATE에 본인 `color`/`number`가 null인지 키 화이트리스트로 검증. `snapshotForPlayer` 변경 시 즉시 회귀.
2. **§13-7 오프바이원** (HR-C7-003, HR-C7-004): 힌트로 마지막 라운드 마지막 턴 소비 시 정확히 `phase==='ended'`/`reason==='deck_end'`, 이후 추가 행동 `ok===false`. `giveClue`/`playCard`/`discardCard`의 종료 검사 변경 시 회귀.
3. **0장 힌트 거부** (HR-C2-003): `giveClue` 진입부 검증 변경 시 회귀.

## WebSocket 메시지 프로토콜

### C→S

| 타입 | 페이로드 | 설명 |
|------|----------|------|
| `JOIN` | `{ playerName? }` | 입장 |
| `GIVE_CLUE` | `{ clueType:'color'\|'number', value:string\|number }` | 힌트 주기. target은 서버가 자동 판정(항상 상대). |
| `PLAY_CARD` | `{ handIndex:number }` | 손패 카드 내기 (0~4) |
| `DISCARD_CARD` | `{ handIndex:number }` | 손패 카드 버리기 (0~4) |
| `REMATCH` | `{}` | 재대결 요청 |

### S→C

| 타입 | 페이로드 | 설명 |
|------|----------|------|
| `JOINED` | `{ playerId:'p1'\|'p2', waiting, hostUrl }` | 접속 완료. waiting=true면 상대 대기 중. |
| `START` | `{}` | 양쪽 입장 → 게임 시작 (STATE도 각자 전송됨) |
| `STATE` | `snapshotForPlayer()` 구조 | 매 액션 후 **각 플레이어에게 개별 마스킹** 전송 (`myHand`/`opponentHand`/`fireworks`/`tokens`/`discardPile`/`deckSize`/`currentTurn`/`phase`/`lastRoundTurnsLeft`/`result`) |
| `GAME_OVER` | `{ result:{ outcome, score, grade, reason } }` | 게임 종료 (`reason`: `perfect`/`fuse`/`deck_end`) |
| `OPPONENT_LEFT` | `{ message }` | 상대 disconnect |
| `REMATCH_STATUS` | `{ ... }` | 재대결 동의 상태 |
| `ERROR` | `{ message }` | 잘못된 요청 (턴 아님, 0장 힌트, 토큰 부족 등) |

## 코드 컨벤션

- **언어**: 한국어 UI + 한국어 주석/문서
- **모듈**: ES Modules (`"type":"module"`). CommonJS `require()` 금지.
- **외부 라이브러리**: 클라이언트 0, 서버는 ws만 (devDependency로 playwright). Express 미사용.
- **주석**: `@fileoverview` + JSDoc + `// §번호` 인용 (§13-N 결정 사항 근거).

## 변경 시 자주 깨지는 함정

| 항목 | 함정 |
|---|---|
| **손패 누설** | `snapshotForPlayer`에서 본인 `myHand[].color/number`는 반드시 **명시적 null**. 키를 그대로 펼치거나(`...c`) 새 필드를 추가할 때 실제 색/숫자가 새어나갈 수 있다. raw WS 키 화이트리스트(`id`/`color`/`number`/`clues`) 유지. HR-C6-001/HR-C7-001로 매번 검증. |
| **§13-7 giveClue 종료 검사** | `giveClue()`도 `advanceTurn(state)` 직후 **반드시 `checkGameEnd(state)` 호출**. `playCard`/`discardCard`와 동일 패턴. 누락 시 힌트로 덱 소진 마지막 턴을 소비할 때 게임이 종료되지 않고 오프바이원(추가 턴) 발생 — **QA HIGH 버그였음(2026-06-01 수정)**. HR-C7-003/004 회귀 게이트. |
| **포트 충돌 핸들러** | WS가 HTTP server를 공유하므로 EADDRINUSE 시 **server와 wss 양쪽에 error 핸들러 필요** (yutnori/tetris-battle 함정 동일). 한쪽만 등록하면 unhandled로 즉시 종료. |
| **토큰 상한/하한 분기** | `discardCard`는 `tokens.clue===8`이면 진입부에서 차단(§13-5). `playCard` 5완성 회수는 `min(8, clue+1)`(§6-2). 5완성 시 `fiveCompleted` 플래그는 회수 여부와 무관하게 true(`game.js:262-264`, QA EDGE4). |
| **마지막 라운드 초기화** | `createGame()`/REMATCH 시 `deckEmptyTurn=null`, `lastRoundTurnsLeft=null` 초기화 필수. `drawCard()`가 덱 소진을 1회만 감지하도록. |
| **종료 우선순위** | `checkGameEnd()`는 25점(perfect) > 폭탄3(fuse) > 덱소진(deck_end) 순. 25점+fuse0 동시 시 win/perfect 우선 (QA EDGE5). |
| **가이드 이미지 PNG MIME** | `server.js` MIME 맵에 `.png`(+`.jpg`/`.jpeg`/`.webp`)가 등록되어 있어야 한다. 누락 시 `application/octet-stream`으로 응답되어 브라우저가 렌더 안 함. **코드 수정 후 node 재기동 필수** — stale 프로세스는 구 MIME 맵을 유지하므로 재기동 후 응답을 확인한다. |
| **가이드 이미지 public 하위 서빙** | `handleHttp`는 `PUBLIC_DIR`(`public/`)만 서빙. 가이드 이미지는 반드시 `public/assets/guide/`에 둔다(`assets/guide/` 직하면 403). 상대 경로 `assets/guide/N.png`로 참조하면 단독(`/assets/...`)·런처(`/hanabi/assets/...` → prefix strip) 양쪽 동작. handleHttp 라우팅은 무수정 유지. |
| **가이드 키보드 누수** | 슬라이더 ←/→ keydown 리스너는 `document` 전역 등록. 게임 진입 후 방향키가 슬라이더를 움직이지 않도록 `els.screenWaiting.classList.contains('hidden')` 가드 필수(`main.js`). 가드 제거 시 게임 중 키 누수(HR-C11-007 회귀). |

## 룰북 §13 매핑 요약 — 구현 vs 표준 차이 (8건, 전부 confirmed)

코드 수정 시 영향 항목을 반드시 확인한다. 상세는 `docs/RULEBOOK.md` §13.

| § | 항목 | 영향도 | 상태 | 구현 위치 |
|---|------|-------|------|-----------|
| §13-1 | 선후공 p1 고정 | LOW | 확정 | `game.js createGame() currentTurn='p1'` |
| §13-2 | 2인 고정·손패 5장 | MED | 확정 | `game.js HAND_SIZE=5`, `opponentOf()` |
| §13-3 | 멀티컬러 미포함 | LOW | 확정 | `game.js COLORS` 5색 |
| §13-4 | 받은 힌트 카드 마킹 | MED | 확정 | `giveClue() clues[]` + `main.js` 마킹 렌더 |
| §13-5 | 토큰8 시 버리기 금지 | LOW | 확정 | `discardCard()` 진입부 차단 + 버튼 비활성 |
| §13-6 | 폭탄3 패배 시 현재점수+"실패" | MED | 확정 | `checkGameEnd() reason:'fuse'` |
| §13-7 | 덱소진 마지막 라운드 오프바이원 | MED | **확정(버그 수정)** | `giveClue() 216-217` checkGameEnd 추가, HR-C7-003/004 |
| §13-8 | AI 봇 미지원 | MED | 확정 | `bot.js` 없음, `botAvailable:false` |

## 시각 검증

- CSS/HTML을 바꾸면 실제 브라우저에서 게임 화면과 작은 뷰포트를 확인한다.
- 외부 이미지 에셋은 사용하지 않는다. 순수 서버·게임 로직 변경에는 시각 검증이 필요하지 않다.

## Mockup Sync

- 게임플레이 시각이 전부 CSS/HTML이고, 가이드 인포그래픽 7장은 외부(GPT Image) 생성 + 게임 내부 가이드 전용이므로 `studio-mockup` 동기화 **불필요**. (하나비는 studio-mockup 대상 프로젝트가 아님.)

## 참조

- 사용자 문서: `README.md`
- **권위 룰북**: `docs/RULEBOOK.md`
- 현재 상태: `docs/PROJECT.md`
- 변경 이력: `docs/CHANGELOG.md`
- 스펙: `.claude/specs/2026-06-01-hanabi-new-game-plan.md`
- QA: `.claude/specs/2026-06-01-hanabi-new-game-qa-report.md`
