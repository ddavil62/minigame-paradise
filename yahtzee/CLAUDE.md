# Yahtzee — 프로젝트별 작업 컨벤션

> LAN 1:1 턴 교대 요트 다이스. Node.js + 바닐라 JS + Canvas. **1차 코어 완료 (2026-06-08)**.

## 정체성

- **목적**: LAN으로 즉시 즐기는 정통 Yahtzee. 5다이스 1턴 3회 굴림 + 13 카테고리 점수표 + 26턴 후 총점 비교.
- **레포 관리**: lazyslimestudio 하위 폴더(`yahtzee/`)로 관리. 미니게임 천국 8번째 종목.
- **기술**: Node 18+ (ESM), 순수 `node:http` + `ws` 8 (Express 미사용), 바닐라 JS + HTML5 Canvas.
- **외부 에셋**: 0. 다이스는 Canvas 2D pip 패턴, 점수표는 HTML 테이블 + CSS. 효과음도 외부 MP3/WAV 없이 Web Audio API로 코드 합성(`js/sounds.js`) — 헤더 🔊/🔇 토글, 음소거 상태 localStorage(`yahtzee.muted`) 영속.

## 핵심 설계 원칙

1. **서버 권위 (Server Authoritative)**
   - 다이스 랜덤 + 점수 계산 + 턴 진행 + 종료 판정 모두 서버 `game.js` 순수 함수.
   - 클라는 keep 토글 + 카테고리 선택만 전송. 점수 미리보기는 UX 보조용이며 서버가 최종 권위.
2. **정보 비대칭 없음**
   - 양쪽이 동일한 STATE를 받는다 (snapshot 마스킹 불필요, 하나비와 차이점).
3. **게임 로직 분리**
   - `game.js`: 순수 함수. 서버 불필요 단위 테스트 가능.
   - `server.js`: `createApp()` factory가 `{ handleHttp, handleUpgrade, setHostUrl }` 반환. WS noServer 모드.
4. **포트 충돌 자동 폴백**
   - 단독 실행 기본 포트 **3010**, `MAX_PORT_FALLBACK=10`.

## 디렉토리

```
yahtzee/
├── game.js                  # 순수 게임 로직
├── server.js                # WS 서버 + createApp + 단독 실행 + 봇 spawn/kill
├── bot.js                   # AI 봇 (mode=ai 시 server가 child_process로 spawn)
├── package.json             # { "type": "module" } + ws
├── playwright.config.js     # 향후 브라우저 E2E 대비 스켈레톤
├── CLAUDE.md                # 본 문서
├── README.md                # 사용자 대상
├── docs/
│   ├── PROJECT.md           # 현재 상태
│   └── CHANGELOG.md         # 변경 이력
├── public/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── main.js          # 진입점
│       ├── network.js
│       ├── game.js          # 클라 상태 캐시 + 점수 미리보기
│       ├── dice.js          # Canvas pip 패턴
│       ├── scoreboard.js
│       ├── ui.js
│       └── sounds.js        # 효과음 (Web Audio API 동적 생성, 음소거 localStorage 영속)
└── tests/
    ├── smoke.test.js        # YACHT-001~010 (131건)
    └── bot-smoke.test.js    # YACHT-BOT-001~005 (25건, 봇 시나리오 — 포트 3099)
```

## AI 봇 (2026-06-08 추가)

matgo/janggi와 동일 `getBotUrl` 옵션 패턴:
- launcher 통합: `createYahtzeeApp({ getBotUrl: () => 'ws://localhost:${PORT}/yahtzee/ws?mode=bot' })`
- 단독 실행: `createApp({ getBotUrl: () => 'ws://localhost:${listeningPort}/ws?mode=bot' })` (포트 폴백 후 동적 구성)
- 1/2 AI 모드 사용자 진입(`mode=ai`) → server.js가 `child_process.spawn`으로 `bot.js` 기동 → 봇은 `mode=bot` 쿼리로 재접속하여 p2 자리 점유 → 양쪽 READY → 새 게임 시작
- 사람이 disconnect 시 `killBotChild()`로 봇도 즉시 종료

### AI 진입 UX (2026-06-08 명시적 버튼)

런처를 거치지 않고 단독 페이지에서도 AI와 즉시 시작할 수 있도록 대기 화면(`#screen-waiting`)에 **`🤖 AI랑 시작`** 버튼을 노출한다.

- 노출 조건: 호스트(p1) + 단독 대기(`waiting=true`) + 현재 mode≠ai (이미 ai면 봇이 곧 들어오므로 중복 버튼 숨김)
- 클릭 동작: `?mode=ai`로 새로고침 → `network.js`가 sessionStorage 저장 + WS URL에 `mode=ai` 부착 → `server.js`의 기존 자동 봇 spawn 로직 트리거
- WS mode 쿼리 부착은 matgo/janggi와 동일 패턴(`URLSearchParams(location.search)` + `sessionStorage` 백업)
- 시각 위계: "준비 완료"(액센트 빨강) ↔ "또는" 구분선 ↔ "AI랑 시작"(액센트-2 살구). 두 진입점 모두 동등한 1차 액션으로 보이되 색상으로 구분

### 봇 휴리스틱 (`bot.js`)

| 단계 | 정책 |
|---|---|
| keep 결정 | (1) 최빈 숫자 ≥ 2개 → 그 숫자들 모두 keep, (2) 연속 4개 이상 → 연속 부분 keep (중복 1개만), (3) 그 외 → 큰 다이스(5~6)만 keep |
| 굴림 중단 | 야츠/라지스트레이트 완성 + 슬롯 비면 즉시 중단. 2차 굴림에서 풀하우스/스몰스트레이트 완성 + 슬롯 비어도 중단. 3차는 무조건 카테고리 선택 |
| 카테고리 선택 우선순위 | Yahtzee(50) → Large/Small Straight(40/30) → Full House(25) → Four/Three of a Kind → 상단(face×3 이상) → Chance → 손해 최소 슬롯 0점 |
| 행동 지연 | 1200~2400ms (사람스러움 — 2026-06-17 N1로 600~1200ms에서 2배 확대, AI 선택 가시성 확보) |
| 자동 재대결 | GAME_OVER 수신 시 0.5초 후 REMATCH 송신 |

룰 일관성: 봇의 `calcScore`는 서버 `game.js`의 `calcCategoryScore`와 동일 (Full House는 3+2 패턴만, 야츠는 풀하우스 0점). 의존성 격리를 위해 game.js를 import하지 않고 동일 룰을 재구현.

## 테스트 실행법

```powershell
cd C:\LazySlimeStudio\minigames\yahtzee
node tests/smoke.test.js        # 163건 (YACHT-001~011 + LIVE-001/002)
node tests/dice-render.test.js  #  42건 (YACHT-LIVE-003/004 — 상대 KEEP 라벨)
node tests/bot-smoke.test.js    #  25건 (YACHT-BOT-001~005, 봇 시나리오)
# 시각 검증 (선택): node server.js --port 3097 띄운 뒤
node tests/screenshot-live-keep.js  # 두 페이지 시점 캡처 (tests/screenshots/live-*.png)
```

기대: `총 N건, PASS=N, FAIL=0`. 합계 **230 / 230 PASS** (smoke 163 — YACHT-011 2판 연속 재대결 사이클 포함 + dice-render 42 + bot-smoke 25).

> ⚠️ WS 시나리오는 포트 3098/3099/3097을 일시적으로 사용한다. 사용자 launcher(3000)와 다른 게임 서버는 영향받지 않는다.

## WebSocket 메시지 프로토콜

상세는 `docs/PROJECT.md` 참조.

## 코드 컨벤션

- **언어**: 한국어 UI + 한국어 주석/문서
- **모듈**: ES Modules. CommonJS `require()` 금지.
- **외부 라이브러리**: 클라 0, 서버는 ws만.
- **주석**: `@fileoverview` + JSDoc + 한국어 인라인.

## 변경 시 자주 깨지는 함정

| 항목 | 함정 |
|---|---|
| **야츠 보너스 트리거** | `scoreCategory()`에서 `sheet.yahtzee === 50` 체크는 **방금 기록한 카테고리가 yahtzee 자신인 경우는 제외**해야 한다(첫 야츠 50점 그 자체는 보너스 아님). 코드 분기: `category !== 'yahtzee' && sheet.yahtzee === 50`. |
| **1차 굴림 keep 무시** | `rollDice()`에서 `rollCount === 0`이면 keep 입력을 검증/사용하지 않고 5개 전부 새로 굴린다. 검증 누락 시 첫 굴림에 keep 배열 미전송으로 에러 발생. |
| **포트 충돌 핸들러** | WS가 HTTP server를 공유하므로 EADDRINUSE 시 server와 wss 양쪽에 error 핸들러 필요. |
| **턴 교대 + 종료 동시 발생** | `scoreCategory()` 말미에서 `turnNumber += 1` 후 `isAllFilled` 확인 → 종료면 `finalizeResult`. 둘 다 한 트랜잭션에서 처리해야 STATE에 일관된 phase가 반영된다. |
| **클라 미리보기 vs 서버 점수 불일치** | 클라 `js/game.js`의 `calcCategoryScore`는 서버 `game.js`의 룰과 정확히 일치해야 한다. 룰 변경 시 양쪽 동시 수정. |
| **실시간 keep 토글 권위** | `TOGGLE_KEEP` 핸들러는 본인 턴이 아니거나 1차 굴림 전이면 ERROR가 아니라 **조용히 무시**(콘솔만). 토스트 폭주 방지. 성공 시에만 STATE broadcast. 클라 `pendingKeep`는 STATE 도착 시 항상 서버 권위로 재동기화한다(`pendingKeep = state.keep.slice()`). |
| **카테고리 강조 타이밍** | CATEGORY_SCORED 직후 STATE가 도착하며 renderAll이 점수표 DOM을 새로 그린다(셀 객체 교체). 그래서 onCategoryScored 시점에 즉시 classList.add 하면 다음 STATE에서 새 셀로 교체되어 사라진다. **반드시 큐(`pendingFlash`)에 보관 → renderAll 말미에 새 셀 찾아서 add**. reflow 강제(`void cell.offsetWidth`) 후 add 해야 동일 카테고리 연속 기록 시 애니메이션 재시작. |
| **컵 진행 중 미리보기 게이트 (N3)** | 컵 굴림 애니메이션 중에는 카테고리 점수 미리보기를 숨긴다. `main.js renderAll`이 `canPreview = !els.diceArea._cupTimer`를 계산해 `renderScoreboard(ctx)`에 전달, `scoreboard.js`가 `ctx.canPreview !== false` 게이트로 `canSelectCategory`를 한정(undefined는 true — 구 호출부 호환). 컵 착지 시 `dice.js`가 `opts.onCupDone()` 호출 → `main.js`의 `onCupDone: () => renderAll()`이 재렌더해 미리보기 자동 노출. **무한 루프 가드**: 재렌더 시 dice 값이 동일하므로 `dice.js`의 `rolledNow=false`(diceChanged=false) → 컵 분기 미진입 → onCupDone 재등록 없음. |
| **굴리기 버튼 연타 (N4)** | `btnRoll` 핸들러 첫 줄에서 `els.btnRoll.disabled = true`로 즉시 비활성화 → 동일 굴림 중복 ROLL_DICE 송신(레이스) 차단. STATE 수신 후 `renderActionBar`가 canRoll 재계산으로 자동 복구. native 더블클릭은 disabled 동기 적용으로 2번째 click이 억제되어 1회만 송신(dispatchEvent/force click은 우회하므로 검증 시 native dblclick 사용). |
| **재대결 버튼 고착 (N5)** | 2판 연속 AI 재대결 시 버튼이 "재대결 대기 중…"에 영구 고착되던 버그 → `main.js onStart` 콜백에서 `rematchBtn.disabled=false; textContent='재대결'`로 리셋해야 한다. |
| **턴 강조 셀렉터 범위 (N2)** | `current-p{n}` 강조는 **tbody에만** 적용한다(`tfoot .col-p{n}` 셀렉터 제외). tfoot에 강조 배경이 덮이면 하단 총점/소계(total-row 먹색+연황색)가 가려져 가독성이 깨진다. thead 강조(`color`)는 유지. |

## 파이프라인 적용 규칙

- **`visual_change: ui`**가 기본. UI 변경 시 AD3 검수.
- **`visual_change: art`는 발생하지 않음** (외부 이미지 에셋 없음). AD1/2 생략.
- 순수 서버/로직 변경(`game.js`/`server.js`)은 `visual_change: none` 가능.

## Mockup Sync

- 게임플레이 시각이 전부 CSS/HTML/Canvas이므로 `studio-mockup` 동기화 **불필요**.

## 참조

- 사용자 문서: `README.md`
- 현재 상태: `docs/PROJECT.md`
- 변경 이력: `docs/CHANGELOG.md`
