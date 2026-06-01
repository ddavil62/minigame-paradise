# Changelog

## 2026-06-01 - 대기 화면 룰 가이드 슬라이더 추가

대기 화면(`#screen-waiting`)에 GPT Image 2.0으로 생성한 룰 설명 인포그래픽 7장을 좌우 탐색 슬라이더로 노출. 상대를 기다리는 동안 처음 하는 플레이어가 룰을 학습할 수 있게 한다. Playwright 61/61 PASS(기존 52 + 신규 9), QA PASS, AD3 APPROVED. game.js/WS 무변경.

### 추가

- **가이드 인포그래픽 7장** — `public/assets/guide/1.png~7.png` (1024×1536px 세로, 2:3 비율). GPT Image 2.0 생성. 패널 구성: P1 게임 개요 / P2 핵심 반전(손패 가림) / P3 구성물 / P4 턴 3행동 / P5 힌트 규칙 / P6 내기·버리기 / P7 종료·점수. 제작 명세는 `docs/GUIDE-INFOGRAPHIC-PLAN.md`.
- **가이드 슬라이더 UI** (`public/index.html`) — `.waiting-card` 내 `.invite-panel` 다음에 `.guide-slider` 블록 삽입. `#guide-slider`/`#guide-img`/`#guide-prev`/`#guide-next`/`#guide-indicator` 셀렉터. img alt `하나비 룰 가이드 N/7`.
- **슬라이더 스타일** (`public/css/style.css`) — viewport `object-fit:contain` + `max-height:60vh`(데스크톱)/`50vh`(모바일 @480px), 세로 이미지 잘림·왜곡 없음. 버튼 38×38px(데스크톱)/44×44px(모바일 탭 타깃). 인디케이터 `N / 7`, `min-width:40px`로 자릿수 변화 시 버튼 흔들림 방지. viewport `min-height:200px`로 404 시 레이아웃 붕괴 방지. 신규 색상 없이 기존 `:root` 토큰만 사용.
- **슬라이더 로직** (`public/js/main.js`) — `// ── 시작 ──` 직전에 `initGuideSlider()` IIFE 추가. 0-based 인덱스 상태, prev/next 버튼 + 키보드 ←/→ + 터치 스와이프(50px 임계값) 4개 입력 경로. 4개 경로 모두 `current>0`/`current<TOTAL-1` 경계 가드로 언더/오버플로우 차단. 키보드는 `els.screenWaiting.classList.contains('hidden')` 가드로 대기 화면일 때만 동작(게임 진입 후 비활성).
- **신규 테스트** (`tests/rulebook-c11-guide-slider.spec.js`) — HR-C11-001~009 9개. 초기 렌더(1/7), 1→7 순회 src·인디케이터 정확성, 양 끝 버튼 비활성, prev/next 5연타 언더/오버플로우 차단, 게임 진입 후 방향키 누수 차단(HR-C11-007), PNG 200/image/png(단독+런처), 범위 밖 8.png 404, 모바일 가로 스크롤 없음.

### 변경

- **가이드 이미지 경로 이동** — `assets/guide/1.png~7.png` → `public/assets/guide/1.png~7.png`. `handleHttp`가 `PUBLIC_DIR`(`public/`)만 서빙하므로 정적 노출을 위해 public 하위로 이동. 원본 `assets/guide/`·`assets/` 빈 디렉토리 삭제(git 미추적 파일이라 fs `mv` 사용). 상대 경로 참조로 단독(`/assets/guide/N.png`)·런처(`/hanabi/assets/guide/N.png` → prefix strip) 양쪽 동작.
- **`server.js` MIME 맵** — `.png:image/png` 추가(+ 향후 확장 대비 `.jpg`/`.jpeg`/`.webp`). handleHttp 라우팅 로직 무수정. ⚠️ 코드 수정 후 node 재기동 필수(stale 프로세스는 구 MIME 맵 유지 → octet-stream 오진 가능).
- **`.waiting-rules` → `.guide-slider` 교체** — 기존 4줄 텍스트 룰 요약 제거, 슬라이더로 대체. `.waiting-card max-width` 520→560px(세로 이미지 표시 공간 확보).

### 참고

- **game.js / WS 프로토콜 무변경** — `git diff --stat game.js` 빈 출력 확인. 기존 52개 Playwright 회귀 0건.
- E2E C8~C10은 대기 화면을 직접 셀렉터로 쓰지 않아(게임 화면 `#my-hand .card` 사용) `.waiting-rules` 제거 영향 없음.
- 서빙 검증: 단독(3095/3097) + 런처(3000) 양쪽 `/...assets/guide/{1,7}.png` 모두 200/image/png. 범위 밖 8.png는 404(파일 정확히 7장).
- **Mockup Sync 불필요** — 하나비는 studio-mockup 대상 프로젝트가 아니며, 가이드 이미지는 외부(GPT Image) 생성 + 게임 내부 가이드 전용. 동기화 생략.
- AD3 APPROVED, WARN 2건(향후 개선 "낮음"): (1) 이미지 404 시 placeholder/onerror 폴백 부재 — 실제 7장 전부 200이라 미발생, `min-height:200px`로 레이아웃 보존. (2) alt 포맷 경미 불일치. 둘 다 차단 사유 아님.
- 잔존 LOW(미수정, 동작 정상): `main.js` keydown 리스너 전역 상주(단일 페이지·1회 초기화라 누수 영향 없음, 가드로 게임 중 무동작 확인).
- 스펙: `.claude/specs/2026-06-01-hanabi-guide-menu-plan.md`
- 목적 정의서: `.claude/specs/2026-06-01-hanabi-guide-menu-scope.md`
- Coder 리포트: `.claude/specs/2026-06-01-hanabi-guide-menu-coder-report.md`
- QA: `.claude/specs/2026-06-01-hanabi-guide-menu-qa-report.md`
- AD3: `.claude/specs/2026-06-01-hanabi-guide-menu-ad-mode3-report.md`

---

## 2026-06-01 - 하나비(Hanabi) 1차 코어 구현 (신규 게임)

미니게임 천국 패키지에 7번째 종목 하나비(2인 완전 협력 카드게임)를 신규 추가했다. Playwright 52/52 PASS, QA PASS.

### 추가

- **`game.js`** (신규) — 순수 게임 로직. 서버 없이 단위 테스트 가능 (codenames-duet 패턴).
  - 상수: `COLORS`(5색), `NUMBERS`(1~5), 카드 분포 `{1:3, 2:2, 3:2, 4:2, 5:1}`, `INITIAL_CLUE_TOKENS=8`, `INITIAL_FUSE_TOKENS=3`, `HAND_SIZE=5`.
  - `createGame()`: 덱 50장 생성(색×숫자, id=`{color}-{number}-{index}`) + Fisher-Yates 셔플 + 2인 각 5장 분배 + `currentTurn='p1'`(§13-1).
  - `giveClue(state, by, target, clueType, value)`: §5 검증(턴/자기힌트/토큰0/0장힌트 거부), 해당 카드 `clues:[{type,value}]` 누적(§13-4), 토큰 −1.
  - `playCard(state, by, handIndex)`: §6 순번 판정. 성공 시 `fireworks[color]++`, 5완성 시 토큰 회수 `min(8, clue+1)`(§6-2). 실패 시 폭탄 −1 + 버림. 보충.
  - `discardCard(state, by, handIndex)`: §7. 토큰 8개면 차단(§13-5), 토큰 +1, 버림, 보충.
  - `checkGameEnd(state)`: 종료 우선순위 25점(perfect) > 폭탄3(fuse) > 덱소진(deck_end). result `{outcome, score, grade, reason}` 설정.
  - `snapshotForPlayer(state, playerId)`: 본인 손패 `color`/`number` 명시적 null 마스킹, 키 화이트리스트(`id`/`color`/`number`/`clues`). 상대 손패·불꽃·버림·토큰·덱장수 공개.
  - `calcScore()`, `getGrade()`(§10 등급표), 내부 `drawCard()`(덱 소진 시 `lastRoundTurnsLeft=2` 설정), `advanceTurn()`(마지막 라운드 카운트다운).
- **`server.js`** (신규) — `createApp(opts)` factory가 `{ handleHttp, handleUpgrade, setHostUrl }` 반환. 순수 `node:http` + `ws` noServer 모드.
  - 2인 입장 → `START` → `broadcastState()`(개별 마스킹 전송). 정원 초과 시 좀비 슬롯 정리 후 ERROR.
  - 메시지 라우터: `JOIN`/`GIVE_CLUE`/`PLAY_CARD`/`DISCARD_CARD`/`REMATCH`. 종료 시 `GAME_OVER` broadcast.
  - disconnect 시 `OPPONENT_LEFT` + game 리셋. Heartbeat 30초.
  - 단독 실행: 기본 포트 **3007**, `MAX_PORT_FALLBACK=10` 자동 폴백, 0.0.0.0 바인딩 + LAN IP 배너.
- **`public/`** (신규) — 외부 이미지 에셋 없이 CSS/HTML만으로 5색 카드·토큰·불꽃 표현.
  - `index.html`: 대기/게임/종료 3화면. 상대 손패·정보 행·불꽃·버림 더미·내 손패·행동/힌트 패널·종료 오버레이.
  - `css/style.css`: 5색 카드(60×90px), 가림 카드(사선 + `?`), 힌트 마킹, 불꽃 슬롯(56×76px, 5완성 glow), 토큰 원, 다크 네이비 테마. 색상 — white `#F5F5F5`/red `#E74C3C`/blue `#2980B9`/green `#27AE60`/yellow `#F1C40F`, accent `#FF6B35`.
  - `js/network.js`: WS 연결(`/hanabi/ws` ↔ 단독 `/ws`), `onOpen` 콜백에서 JOIN 전송(race condition 회피 — yutnori의 고정 300ms 타이머보다 견고).
  - `js/main.js`: 상태 렌더링, 행동 모드(내기/버리기/힌트), 버튼 비활성 규칙(토큰0→힌트 disabled §5-2, 토큰8→버리기 disabled §13-5), 종료 화면(점수+등급+사유 라벨), 로비 복귀.
- **테스트** (신규, `tests/`) — Playwright 52개.
  - `rulebook-c1-c5-unit.spec.js` 31 (HR-C1~C5, 서버 불필요).
  - `rulebook-c6-ws.spec.js` 7 (HR-C6, createApp 직접 import, raw WS 누설 검증).
  - `rulebook-c7-qa-edge.spec.js` 8 (HR-C7, 엣지/경계/오프바이원 + raw WS 누설).
  - `rulebook-c8-e2e-browser.spec.js` 2 / `rulebook-c9-e2e-actions.spec.js` 3 / `rulebook-c10-e2e-gameover.spec.js` 1 (E2E, `node server.js --port 3095` 필요).
- **런처 통합**: `launcher/server.js` `GAME_APPS`에 `'hanabi': createHanabiApp()` 등록(봇 없음), printBanner 목록 추가. `launcher/public/games.json`에 hanabi 항목 추가(`port:3007`, `color:#FF6B35`, `emoji:🎇`, `botAvailable:false`).

### 수정

- **§13-7 giveClue 오프바이원 버그 수정** (QA HIGH 대응) — `game.js` `giveClue()` 216~217줄.
  - 증상: `giveClue()`가 `advanceTurn(state)`만 호출하고 `checkGameEnd(state)`를 호출하지 않아, 덱 소진 마지막 라운드의 마지막 턴을 "힌트"로 소비할 경우 `lastRoundTurnsLeft===0`이 되어도 `phase`가 `'playing'`으로 남아 게임이 종료되지 않고 한 플레이어가 추가 턴(3번째 턴)을 수행할 수 있었다.
  - 원인: `playCard`/`discardCard`는 `advanceTurn` 후 `checkGameEnd`를 호출하나 `giveClue`만 누락. 기존 38개 테스트가 잡지 못한 힌트 경로 사각지대.
  - 수정: `advanceTurn(state);` 뒤에 `checkGameEnd(state);` 1줄 추가(`playCard`/`discardCard`와 동일 패턴) + §13-7 근거 주석. 진입부 `phase!=='playing'` 가드가 이미 있어 종료 후 힌트는 차단되며, `checkGameEnd`는 25점·폭탄3을 힌트로 새로 유발하지 않고 deck_end만 추가로 잡아 부작용 없음.
  - 검증: 신규 회귀 테스트 HR-C7-003(힌트로 마지막 라운드 종료 → `phase==='ended'`, `reason==='deck_end'`), HR-C7-004(종료 후 추가 행동 `ok===false`)가 FAIL→PASS 전환. 전체 50 PASS/2 FAIL → **52 PASS/0 FAIL**.
  - 부수 해소: 클라이언트 "남은 턴 0" UI 모순(`main.js:298-300`)이 종료 정상 트리거로 자동 해소.

### 참고

- 룰북 §13 8건 전부 proposed → confirmed (구현 위치 기재).
- AD 모드3: APPROVED, FAIL 0건, WARN 3건(하드코딩 HEX / 불꽃 색명 라벨 하단 돌출 / 결과 폰트 계층 — UI 폴리시로 분리).
- 잔존 LOW(미수정, 동작 정상): `game.js:256-263` 5완성 분기 `fiveCompleted=true` 중복 대입(가독성).
- 스펙: `.claude/specs/2026-06-01-hanabi-new-game-plan.md`
- Coder 리포트(Fix 포함): `.claude/specs/2026-06-01-hanabi-new-game-coder-report.md`
- QA: `.claude/specs/2026-06-01-hanabi-new-game-qa-report.md`
- AD3: `.claude/specs/2026-06-01-hanabi-ad-mode3-report.md`
