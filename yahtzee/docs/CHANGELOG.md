# Yahtzee CHANGELOG

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
