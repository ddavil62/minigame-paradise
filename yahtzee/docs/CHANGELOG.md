# Yahtzee CHANGELOG

## 2026-07-27 — 런처 AI handoff 및 다섯 주사위 보관 의사결정 수정

사용자 리포트 5, 9, 22를 대상으로 런처의 야추 인원 계약과 AI 의사결정을 실제 1:1 게임 규칙에 맞췄다.

### 변경

- `launcher/public/games.json`: 야추 `maxPlayers`를 2로 고정하고 카드에 `2인 대전`/`2-player battle` 메타를 추가했다.
- `launcher/public/app.js`: 실인원과 AI 슬롯을 함께 점유 인원으로 계산해 AI 채우기 뒤 사람 1 + AI 1만 표시한다.
- `bot.js`: 보관 결정이 다섯 주사위 모두인 경우 추가 굴림 대신 `pickAndScore()`로 즉시 카테고리를 선택한다.

### 수정

- AI 채우기에서 AI 3명이 추가되고 `Room Full 2/2` 또는 시작 준비 화면에 고착되던 문제를 제거했다.
- 런처 READY 뒤 야추 내부에서 READY를 다시 요구하지 않고 게임 화면으로 전환한다.
- AI가 완성된 다섯 주사위를 모두 보관하면서도 재굴림 횟수만 소비하던 비효율을 제거했다.

### 검증

- `tests/yahtzee-ai-handoff.test.js`: PASS, 반복 5/5 PASS.
- `yahtzee/tests/ai-decision-regression.test.js`: PASS.
- 기존 회귀: smoke 169/169 + dice-render 55/55 + bot-smoke 25/25.
- 신규·브라우저 8건과 기존 249건을 합쳐 Phase B 257/257 PASS.
- Chromium 1280×720에서 사람 1 + AI 1 + 빈 슬롯 0, 내부 READY 비노출, page error 0건을 확인했다.
- AD 모드 3 재검수 APPROVED.

### 참고

- 구현 리포트: `.Codex/specs/2026-07-27-minigames-phase-b-report.md`
- UI 검수: `.Codex/specs/2026-07-27-minigames-phase-b-ui-review.md`
- QA: `.Codex/specs/2026-07-27-minigames-phase-b-qa.md` (`PASS`)
- 외부 에셋 추가·변경 없음.

## 2026-06-20 — 재굴림 애니메이션 미발동 버그 수정

사용자 신고: "주사위 굴리기 해도 이미 나온 주사위가 다시 안 굴려지고 그대로 있는 문제가 여전히 있다." keep 안 한 다이스가 우연히 직전과 **전부 동일한 면**으로 굴려지면(non-kept 전부 같은 면, 확률 1/6~1/36) 컵 굴림 애니메이션이 아예 미발동해 "안 굴러갔다"로 보이던 버그. 컵 애니메이션 트리거가 "이전 프레임 대비 dice 값 변화(diceChanged)" 기준이라 값이 같으면 미진입했다. 서버 `game.js` 무결(클라 렌더 버그).

### 변경
- **트리거를 rollCount 증가 기준으로 교체**: `public/js/dice.js` 컵 흔들기/드롭 트리거를 `diceChanged` 대신 서버 권위 `rollCount` 증가로 교체. `const rolledNow = !allZero && (opts.rollCount != null ? opts.rollCount > prevRollCount : diceChanged)`. `opts.rollCount`가 없으면(테스트 스텁/구 호출부) 기존 `diceChanged` 폴백 유지(방어). 우연히 같은 면 재굴림도 정상 발동.
- **`public/js/main.js`**: `renderDice(...)` 호출부 opts에 `rollCount: state.rollCount` 전달.
- **컨테이너별 `_lastRollCount` 보관**(`_cupTimer`와 동일 컨테이너 프로퍼티 패턴): `rolledNow=true` 진입 즉시 `container._lastRollCount = opts.rollCount` 기록 → `onCupDone → renderAll` 재진입 시 rollCount 동일 + 갱신됨 → `rolledNow=false`로 컵 재발동/onCupDone 재등록 차단(무한 루프 방지).
- **턴 리셋 동기화**: 턴 넘김으로 rollCount가 리셋(이전보다 작아짐)되면 else 분기에서 `_lastRollCount`도 따라 낮춰 다음 턴 첫 굴림(0→1)이 정상 발동하도록 동기화. (불변/증가 케이스는 미갱신 → onCupDone·keep 토글 무영향.) — 스펙은 STATE 레벨 0 리셋만 기술했으나, `_lastRollCount`가 이전 턴 값(예: 3)으로 남으면 `1 > 3 = false`로 미발동하는 엣지를 막기 위해 추가(YACHT-KEEP-008로 검증).
- in-cup/drop 마스크는 기존 `!keep` 기준(YACHT-KEEP-001 수정) 그대로 유지(무변경).

### 추가
- `tests/dice-render.test.js`: **YACHT-KEEP-006**(핵심·버그 직격 — rollCount 증가 + dice 값 100% 동일 재굴림 → 컵 발동 + keep 인덱스 컵 제외 + non-keep 인덱스 컵 포함 + `_lastRollCount` 즉시 갱신) / **YACHT-KEEP-007**(rollCount 불변 재렌더 → 컵 미발동, 무한 루프 방지) / **YACHT-KEEP-008**(턴 넘김 rollCount 0 리셋 → 첫 굴림 0→1 정상 발동). 42 → **55**.
- `tests/smoke.test.js`: **YACHT-012**(rollDice 400회 통계 — keep=true 인덱스 값 동결(위반 0) + keep=false 인덱스 재굴림 + rollCount 권위값 1차→1/2차→2). 163 → **169**.

### 검증
- 회귀 **249/249 PASS**(dice-render 55 + smoke 169 + bot-smoke 25, 이전 230 → +19). 서버 `game.js`/`server.js`/`bot.js` 무수정.
- 테스트는 프로젝트 표준 node 러너(`node tests/dice-render.test.js`)로 수행(dice-render는 Playwright가 아닌 DOM stub 노드 러너). QA PASS(결함 0), AD3 APPROVED(레이아웃/스타일 무변경, 발동 빈도/타이밍만 정상화).

### 참고
- 스펙: `.claude/specs/2026-06-20-yahtzee-reroll-animation-spec.md`, 리포트: `.claude/specs/2026-06-20-yahtzee-reroll-animation-report.md`

## 2026-06-17 — UX 버그/개선 5건 (N1~N5)

사용자 신고: AI가 너무 빨리 굴려 선택을 못 본다(N1), 하단 총점이 턴 강조색에 덮여 안 보인다(N2), 미리보기가 컵 굴림 중에도 떠서 긴장감이 없다(N3), 굴리기 연타 시 효과음만 나고 기회가 날아간다(N4), 2판 연속 AI 재대결 시 버튼이 영구 고착된다(N5). 서버 `game.js`/`server.js` 무수정.

### 변경
- **N1 — 봇 행동 지연 2배**: `bot.js` `handleState` 지연 `600+rand*600`(600~1200ms) → `1200+Math.floor(rand*1200)`(1200~2400ms). AI 주사위 굴림 속도가 너무 빨라 선택 과정을 못 보던 문제. 모듈 상단 JSDoc에 행동 지연 명시.
- **N2 — 총점 가독성**: `public/css/style.css` `current-p1/p2` 강조 셀렉터에서 `tfoot .col-p1/.col-p2` 제거 → 턴 강조가 tbody만 적용되고 하단 총점/소계(total-row 먹색+연황색)가 강조 배경에 안 덮여 가독성 회복. thead 강조(`color`)는 유지. 시각: `tfoot .total-row .col-p1` 배경 `rgb(74,58,40)`=`--ink(#4a3a28)` 유지 확인(스크린샷 `tests/screenshots/n2-scoreboard-total.png`).
- **N3 — 미리보기 타이밍(긴장감)**: 컵 굴림 애니메이션 진행 중 카테고리 점수 미리보기 숨김 → 컵 착지 시점에 자동 노출. `scoreboard.js`(`ctx.canPreview !== false` 게이트로 `canSelectCategory` 한정, undefined=true 구 호출부 호환) + `dice.js`(컵 완료 시 `opts.onCupDone()` 호출, `renderDice` JSDoc에 옵션 명시) + `main.js`(`renderAll`에서 `canPreview = !els.diceArea._cupTimer` 계산 후 전달 + `renderDice` 호출부에 `onCupDone: () => renderAll()`). **무한 루프 가드**: 재렌더 시 dice 동일 → `dice.js`의 `rolledNow=false`(diceChanged=false) → 컵 분기 미진입 → onCupDone 재등록 없음. AD 모드3 1차 REVISE(컵 멈춘 뒤 자동 재렌더 누락) → onCupDone 콜백 방식으로 재수정 후 APPROVED. 시각: during=0 → after=13 자동 노출(`tests/screenshot-n3-cup-preview.js`, 스크린샷 `n3-cup-during-no-preview.png`/`n3-cup-after-preview-auto.png`).
- **N4 — 굴리기 날림 차단**: `main.js` btnRoll 핸들러 첫 줄 `els.btnRoll.disabled = true` → 동일 굴림 중복 ROLL_DICE 송신(레이스) 차단. STATE 수신 후 `renderActionBar`가 canRoll 재계산으로 자동 복구. native 더블클릭은 disabled 동기 적용으로 2번째 click 억제 → 1회만 송신. (QA 소견 LOW: 인간형 더블클릭의 2차 송신은 본인 턴 내 정당한 추가 굴림으로 rollCount 서버 cap(3)·턴 손실 없음. 스펙 문구 "STATE 왕복 윈도우 내 중복 차단"으로 읽어 PASS. 원 버그 "효과음만 나고 기회 날림" 해소.)
- **N5 — 재대결 고착 해소**: `main.js onStart` 콜백에 `rematchBtn.disabled=false; textContent='재대결'` 리셋 추가 → 2판 연속 AI 재대결 시 버튼이 "재대결 대기 중…"에 영구 고착되던 버그 해소.

### 추가
- `tests/smoke.test.js`: **YACHT-011** 신규 — 2판 연속 GAME_OVER → REMATCH → START 사이클 + 3판째 START 도달 검증(+8건). smoke 155 → **163**.

### 검증
- 회귀 **230/230 PASS**(smoke 163 + dice-render 42 + bot-smoke 25). 서버 `game.js`/`server.js` 무수정. bot-smoke는 무수정(기존 타임아웃이 1.2~2.4초 지연에 충분).
- 실브라우저(격리 포트 3097, Playwright): N2 총점 가독성, N3 during=0→after=13 자동 노출, N4 native dblclick 1회/기회 유지, N5 2판 START 후 버튼 복구. QA PASS(결함 0, N4만 LOW 소견), AD3 APPROVED(N2 + N3 재검수).

### 참고
- 스펙: `.claude/specs/2026-06-17-yahtzee-bugs-n1n5-spec.md`, 리포트: `.claude/specs/2026-06-17-yahtzee-bugs-n1n5-report.md`
- AD: `.claude/specs/2026-06-17-ad-yahtzee-n1n5-review.md`(N2 APPROVED/N3 REVISE) → `.claude/specs/2026-06-17-ad-yahtzee-n3-recheck.md`(N3 APPROVED)

## 2026-06-17 — 점수표 가로줄 정렬(F) + 카테고리 색 3상태 차별화(G)

사용자 신고: (F) 점수표 가로 구분선이 행과 어긋나 글자가 선에 걸친다. (G) 점수 셀 3상태(선택가능/직전확정/일반확정)가 모두 같은 토마토 색이라 구분이 안 된다. CSS만 수정, JS(`scoreboard.js`/`main.js`) 무수정 — 클래스명·`makeScoreCell` 시그니처·`scored-flash` 애니메이션 전부 유지.

- **F — 점수표 가로줄 정렬 (방법 C: tbody td border-bottom 직접 부여)**
  - `public/css/style.css`: `.zone-scoreboard`의 배경 `repeating-linear-gradient` 줄무늬 제거(이 stripe가 thead 높이·padding 오프셋에 위상이 의존해 행과 어긋나던 근본 원인). 대신 `tbody td`에 `border-bottom`을 직접 부여.
  - 행 높이를 `--score-row-h: 34px` 단일 소스로 통일 + `line-height`/`vertical-align`로 텍스트 행 중앙·선 경계 정합.
  - 섹션 헤더 행 선 회귀는 `.scoreboard tbody tr.section-divider td` 특이도 상향으로 차단(header border-bottom 차단·height:auto 유지). 760px 반응형도 정합(border 방식이라 컨테이너 오프셋 무관).
- **G — 점수 카테고리 색 3상태 차별화 (색맹 대응)**
  - `public/css/style.css`: 점수 상태 전용 변수 `--score-*` 5종 신설(기존 `--tomato`/`--ink` 등 값은 불변, 신규 변수로만 분리).
  - 3상태 분리 + 비색 보조 단서: 선택가능 preview(초록 + 점선 테두리 + 옅은 배경) / 직전확정 scored-persistent(토마토 + 좌측 액센트 바 + 채운 배경 + 굵기) / 일반확정 recorded(중립 먹색).
  - preview-zero(흐린 회색 + 점선만)와 양수 preview 구분 유지. `scored-flash` 1.4초 애니메이션 무변경.
- **검증**: 회귀 **222/222 PASS**(smoke 155 + dice-render 42 + bot-smoke 25) + 시각(3상태 동시 노출: recorded 2 / preview 12 / persistent 2). 서버 무수정. QA PASS, AD3 APPROVED.
- 리포트 스크린샷: `tests/screenshots/fg-scoreboard.png`(1280px), `fg-scoreboard-760.png`(반응형).

## 2026-06-09 — 실시간 keep 동기화 + 카테고리 강조 애니메이션

사용자 요청: keep 토글이 본인 화면에만 보이는 게 어색하다(턴 끝나야 STATE로 동기화), 어떤 카테고리에 점수가 들어갔는지 한눈에 보이지 않는다.

- **서버 권위 실시간 keep 동기화**
  - `game.js`: 신규 순수 함수 `toggleKeep(state, by, index, value)` — 본인 턴 + rollCount≥1 + 0≤index<5 가드. `state.keep[index]`만 1비트 갱신.
  - `server.js`: 신규 핸들러 `case 'TOGGLE_KEEP'` — 실패 시 토스트 폭주 방지를 위해 ERROR 전송 대신 콘솔만 남기고 조용히 무시. 성공 시 STATE 전체 broadcast(Yahtzee는 정보 비대칭 없음).
  - `public/js/network.js`: `toggleKeep(index, value)` 송신 메서드 추가. 프로토콜 주석에 `TOGGLE_KEEP { index:0~4, value:bool }` 명시.
  - `public/js/main.js`: `onToggle` 콜백에서 본인 턴 + rollCount≥1 일 때 즉시 `net.toggleKeep()` 송신(기존 pendingKeep 로컬 갱신은 유지 — 서버 STATE 반영 전까지 입력 반응성 확보, STATE 도착 시 권위 동기화).
- **상대 keep 시각화**
  - `public/js/dice.js`: `renderDice` 옵션에 `opponentTurn` 추가. 상대 턴에 본인이 keep된 다이스를 볼 때 `.die.kept.opponent` 클래스 + 라벨을 "KEEP"→"상대 KEEP"으로 교체.
  - `public/css/style.css`: `.die.kept.opponent` 보더 색상/배경을 본인 KEEP(액센트 빨강)과 구분되는 톤으로 분리. 사용자가 어느 쪽 keep인지 즉시 식별 가능.
- **카테고리 기록 강조 애니메이션**
  - `public/js/scoreboard.js`: 각 `.score-cell`에 `data-pid="p1|p2"` + `data-category="aces|...|chance"` 속성 부착(셀렉터 타깃팅용).
  - `public/css/style.css`: `@keyframes scored-flash` 1.4s — scale 1→1.55→1.3→1 + tomato 글로우 + text-shadow. 양쪽 시점에서 동일 강조(시각 피드백 일관성).
  - `public/js/main.js`: `onCategoryScored` 수신 시 `pendingFlash = { by, category }`로 큐 적재 → 직후 STATE 도착으로 renderAll이 DOM을 새로 그리면 해당 셀에 `.scored-flash` 클래스를 강제 reflow 후 add → 1.5s 뒤 정리.
- **신규 테스트 (전부 PASS)**
  - `tests/smoke.test.js`: YACHT-LIVE-001(toggleKeep 단위 검증 11건 — 1차 굴림 전 거부 / 본인 턴만 허용 / index 범위 가드 / phase 가드), YACHT-LIVE-002(WS TOGGLE_KEEP 양쪽 STATE.keep 일치 13건). 총 **155건 / 155 PASS**.
  - `tests/dice-render.test.js`: YACHT-LIVE-003(상대 턴 opponent 클래스 + 라벨 "상대 KEEP") + YACHT-LIVE-004(본인 턴 회귀 — 기존 "KEEP" 라벨 유지). 총 **42건 / 42 PASS**.
  - `tests/bot-smoke.test.js`: 25/25 PASS 유지(봇 회귀).
  - 누적 222 / 222 PASS.
- **시각 검증**: `tests/screenshot-live-keep.js` (두 페이지 동시 — p2 시점에서 상대 KEEP 시각 + 카테고리 강조 애니메이션 진행 중 캡처). 사용자 직접 확인용. 실행 전: `node server.js --port 3097`.
- 서버/네트워크 무파괴 변경 — 진행 중 launcher(PID 86396, 포트 3000)에 영향 없음. F5만 누르면 적용.

## 2026-06-09 — 효과음 추가 (Web Audio API 동적 생성, 외부 에셋 0)

사용자 요청: "효과음들이 좀 있으면 좋겠는데. 하던 게임에 영향이 가진 않게."

- `public/js/sounds.js` 신규: Web Audio API로 9종 효과음 동적 합성(`playRoll`/`playDiceLand`/`playKeepToggle`/`playScore`/`playYahtzee`/`playUpperBonus`/`playWin`/`playLose`/`playButtonClick`) + 음소거 모듈(`isMuted`/`setMuted`/`toggleMuted`, localStorage 영속). 외부 MP3/WAV 0건. AudioContext lazy init + webkitAudioContext fallback + 동시 재생 충돌 방지(매 호출 새 노드).
- `public/js/main.js`: 굴리기 클릭 `playRoll`, DICE_ROLLED 수신 0.42초 후 `playDiceLand`, keep 토글 `playKeepToggle`, CATEGORY_SCORED 시 `playScore`(야츠/추가 야츠 보너스는 `playYahtzee`로 대체), STATE에서 본인 상단 보너스 0→35 전환 감지 `playUpperBonus`, GAME_OVER 본인 승/패 `playWin`/`playLose`. 무승부는 무음.
- `public/index.html`: 헤더 우상단 `#btn-mute` (🔊/🔇 토글) 추가.
- `public/css/style.css`: `.btn-mute` 스타일 + 헤더 grid-template-columns 5컬럼 확장 + 모바일(820px 이하) 반응형 조정.
- 서버/네트워크/게임 로직 무수정 — 진행 중인 사용자 launcher(PID 86396, 포트 3000)는 F5만 누르면 적용.
- 회귀: smoke 131/131 + bot-smoke 25/25 = 156/156 PASS 유지.

## 2026-06-08 — 대기 화면 "AI랑 시작" 명시적 버튼

사용자 피드백: "AI 모드로 들어갈 방법이 없는데? 준비완료했는데 상대가 없으니 준비가 안돼. 버튼이 명시적으로 있는게 낫지 않을까?"

- `public/index.html`: `#ready-panel` 하단에 `#ai-panel` (구분선 "또는" + `🤖 AI랑 시작` 버튼 + 보조 힌트) 추가. 호스트(p1) 단독 대기 시에만 표시.
- `public/css/style.css`: `.btn-start-ai` (액센트-2 살구색, 호버/액티브) + `.ai-divider` + `.ai-panel`/`.ai-hint` 추가. "준비 완료"(액센트 빨강)와 색상으로 위계 분리.
- `public/js/main.js`: `onJoined`에서 호스트 + waiting + 현재 mode≠ai일 때 AI 패널 노출. 버튼 클릭 시 `?mode=ai`로 새로고침 → server.js의 기존 자동 봇 spawn 로직 활용. 상대 이탈(`onOpponentLeft`) 시 AI 옵션 재노출.
- `public/js/network.js`: WS URL에 mode 쿼리 부착(matgo/janggi와 동일 패턴) + sessionStorage 백업. 새로고침해도 같은 모드로 재진입.
- 서버 무수정. 회귀 smoke 131/131 + bot-smoke 25/25 = 156/156 PASS.

## 2026-06-08 — AI 봇 추가

- `bot.js` 신규: WebSocket 클라이언트 봇. 자기 턴마다 최빈/스트레이트/큰값 keep 휴리스틱 + 카테고리 우선순위(Yahtzee→Straight→FullHouse→Quad→Triple→상단→Chance→손해 최소 0점) 자동 진행.
- `server.js`: `createApp(opts.getBotUrl)` 옵션 추가. mode=ai 사용자 진입 시 봇 자동 spawn(child_process), 사람 disconnect 시 봇도 같이 종료(`killBotChild`). 단독 실행도 listening 포트 동적 참조하여 `getBotUrl` 자동 구성.
- `launcher/server.js`: yahtzee 등록에 `getBotUrl` 옵션 주입.
- `launcher/public/games.json`: yahtzee `botAvailable: false` → `true`.
- `tests/bot-smoke.test.js` 신규: 봇 시나리오 회귀(YACHT-BOT-001~005, 25건, 포트 3099). 사람 mode=ai 접속 → 봇 spawn → 26턴 완주 → GAME_OVER + 양쪽 13 카테고리 채움 + 점수 합 정합성 검증.
- 기존 `tests/smoke.test.js` 131/131 PASS 유지.

## 2026-06-08 — 1차 코어 완료

신규 프로젝트 생성. LAN 1:1 턴 교대 요트 다이스.

### 추가
- `game.js`: 순수 게임 로직 (다이스 5개, 1턴 3회 굴림, 13 카테고리 점수 계산, 상단 보너스, 야츠 보너스, 26턴 종료 판정).
- `server.js`: WS + 정적 파일 서버. `createApp()` factory + 단독 실행(포트 3010, MAX_PORT_FALLBACK=10) + launcher 통합.
- 클라이언트: 대기/게임/종료 3화면. Canvas 다이스(pip 패턴), 13 카테고리 점수표 + 미리보기 점수, 헤더 점수바, 종료 breakdown.
- launcher 통합: `launcher/server.js`에 yahtzee 등록 + `games.json`에 카드 추가 (`#E84A5F`, emoji 🎲).
- `minigames/CLAUDE.md` 게임 목록표 + 테스트 항목에 yahtzee 추가.
- smoke 테스트 `tests/smoke.test.js` (YACHT-001~010, ad-hoc 노드 러너 + WS 시나리오).

### 룰 확정
- Full House는 "3+2" 패턴만 인정 (야츠는 풀하우스 0점) — 사용자 스펙.
- 야츠 보너스: yahtzee 슬롯에 50점 기록 상태에서 추가 야츠 시 +100점 누적. yahtzee 슬롯에 0점 기록 상태면 추가 야츠 보너스 없음.
- 카테고리 0점 기록 허용 (못 맞춰도 1개는 반드시 선택).
- 1차 굴림은 keep 입력 무시 (5개 전부 새로 굴림).
