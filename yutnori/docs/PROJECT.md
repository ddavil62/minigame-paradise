# Yutnori — 프로젝트 현황

> 한국 전통 윷놀이 LAN 대전. 사람 2~4인과 사람 1명 + AI 1명의 1:1 대전을 지원한다.

## 현재 상태 (2026-07-27)

**모바일 보드·AI 채우기 보정** — 390×844에서 인포바가 보드를 약 120px까지 압축하던 flex 축소를 제거해 보드를 374×374 정사각형으로 확보했다. 하단 인포바는 `.game-main` 내부 세로 스크롤로 접근하고, 1280×800 데스크톱은 694×694 보드와 320px 우측 인포바를 유지한다. 사람 대전은 기존 2~4인을 보존하며, 런처 AI 채우기는 `aiFillTargetPlayers=2`에 따라 정확히 사람 1명 + AI 1명만 구성한다. 런처 READY는 `lobbyReady=1`로 인계되어 게임 내부 READY를 다시 요구하지 않는다. AD3 APPROVED, QA **136/136 PASS**. 실행 중인 3000번 서버가 이전 코드라면 재시작해야 변경이 반영된다.

**버그 B/C 수정** — 버그 신고 기반 2건. B: 보드 빈 칸 클릭이 첫 HOME 말을 자동 출발시키던 폴백 제거(`main.js`, 내 말/HOME 박스 정확 클릭에만 이동). C: 윷·모 보너스 던지기 이중 부여로 소진 순서에 따라 던지기가 리필되던 비대칭 버그 수정 — 2026-06-17 버그 D가 도입한 `bonusFromConsumed`(이동 시점 부여) 모델을 `server.js`의 `game.pendingThrows`(던지기 시점 적립/소비) 모델로 교체, `hasBonus = capturedBonus || pendingThrows>0`. 소진 순서 무관 + 버그 D(보너스 소실) 재발 방지 양립. MOVE_PIECE·CHOOSE_PATH 양쪽 적용, STATE에 `pendingThrows` 노출(후방 호환). 회귀 게이트 **서버리스 342**(직전 338 + YR-C8-011~014 신규 4) + bot-smoke 10 + 관련 27 PASS + HT-BUGB(버그 B). YR-C8-009 기댓값 갱신(던지지 않은 yut 소비 → 리필 없음). `visual_change: none`(AD 생략), QA PASS(결함 0). 상세는 `CHANGELOG.md`.

### 2026-06-20 주요 변경 (버그 B / 버그 C)
- **버그 B — 빈 칸 클릭 오출발**: `public/js/main.js` 보드 클릭 3단계 폴백(`pickFirstHomePiece` 자동 선택) 제거. 1단계 `pickMyPieceAt`(보드 위 내 말)·2단계 `isClickOnHomeArea`+`pickFirstHomePiece`(HOME 박스 영역)에서 말 특정 시에만 `net.movePiece`. 둘 다 실패(`pieceIdx<0`) 시 "이동할 말을 클릭하세요." 토스트 후 return. 좌표 매핑(`BOARD_SIZE/rect.width|height`)은 2026-06-18 회귀 가드 유지.
- **버그 C — 윷·모 보너스 던지기 이중 리필**: `server.js`에서 `bonusFromConsumed`(이동 시점) 제거 + `game.pendingThrows` 도입(THROW_YUT 적립/소비, MOVE_PIECE/CHOOSE_PATH `hasBonus = capturedBonus===true || pendingThrows>0`로 통일, passTurn/createGame/softResetRoom/resetGame 초기화). 던지기 권리를 **소진 순서가 아닌 적립/소비**로 판정(capturedBonus 잡기 보너스 로직과 독립). STATE 노출 + `/test/inject` 주입 지원. capturedBonus 라이프사이클·§13-12 가드 무손상.
- **테스트**: 신규 HT-BUGB(`redesign-hittest-qa.spec.js`) + YR-C8-011(개먼저)/012(모먼저)/013(이중 적립 0)/014(버그 D 양립). YR-C8-009 기댓값 갱신.
- 회귀: 서버리스 **342 passed**(이전 338 + 4), bot-smoke **10/10**, 버그 C 관련 27(c8/c18/c19/qa-defect2) + e2e 30(서버 가동) + 레거시 smoke 36 PASS.
- **로직 외 무변경**: 룰북 §13 항목 변화 없음(미해소 4 + 해소 8 유지). board.js·game.js·DOM id·WS 프로토콜은 STATE에 `pendingThrows` 추가 외 무변경.

### 2026-06-18 주요 변경 (시각 재디자인)
**시각 재디자인 (룰/로직 무변경)** — 사용자 요청 "지금 룰 기반으로 훨씬 보기 좋은 레이아웃 + 아트/UI 컨셉 변경"을 게임 로직 무변경으로 구현. (1) **2단 레이아웃**: 기존 3단(좌패널·보드·우패널) → 왼쪽 큰 보드 + 오른쪽 320px 인포바 통합(윷가락→남은결과→나의말→상대말→최근결과→룰, 요트다이스 패턴 차용). `.game-main grid 1fr 320px`, 반응형 1100/900px. (2) **테마(한지/원목/먹/단)**: 팔레트 교체(배경 #2c1f12, 한지 #f0e6c8, 원목 #6b4220, 강조 #d4812a, P1 #c0392b/P2 #1a6fad), 웹폰트 Jua+Gowun Dodum(요트·오목 통일), 헤더/패널/버튼 입체화. 외부 이미지 에셋 0 유지(Canvas/CSS 합성). (3) **Canvas 보드**: 나뭇결(bezier 2겹+비네팅), 칸 radialGradient(일반/모서리/중앙"방"), 말 3D, **centerExitA(23→28→29→15) 점선 신규 렌더(누락 보완, centerExitB와 대칭)**. (4) **윷가락 재설계**: 실측 장작윷 비율 — H:W≈5:1(가늘고 긴 막대, 기존 1.36:1 뭉툭 교정), 완전 반원 끝, 반원통 단면 그라디언트, yut-canvas 220×80→120×130 세로형. **부수 버그픽스(HIGH)**: 2단 도입으로 `ui.js resizeBoard()`가 캔버스 표시크기 동적화 → `main.js` 클릭 hit-test가 옛 `canvas.width≡560` 가정으로 좌표 어긋나 보드 말 클릭/이동 실패(QA 발견) → 클릭 매핑을 `BOARD_SIZE/rect.width|height`(560 좌표계, dpr 무관)로 수정. 변경 파일: `public/index.html`, `css/style.css`, `js/ui.js`, `js/yut.js`, `js/main.js`(board.js·server.js·game.js·DOM id 무변경). 회귀 게이트 **서버리스 338 + bot-smoke 10 + e2e 25 = 373 PASS + hit-test QA 4 + dpr 1/2/2.5 매트릭스**. QA PASS(HIGH 결함 해소·재검증), AD3 APPROVED(WARN 3 비강제).

### 2026-06-18 주요 변경 (시각 재디자인)
- **레이아웃**: `public/index.html` 2단 구조 + Google Fonts(Jua/Gowun Dodum), `css/style.css` 테마 팔레트·`.game-main` 그리드(1fr 320px)·입체 효과(gradient+inset+shadow+눌림)·반응형 1100/900px.
- **Canvas 보드**: `js/ui.js` 나뭇결(bezier 2겹+비네팅)·칸 radialGradient(일반/모서리/중앙)·말 3D·centerExitA(23→28→29→15) 점선 신규 렌더(centerExitB와 대칭, 누락 보완) + `resizeBoard()`가 캔버스 표시 크기 동적화.
- **윷가락**: `js/yut.js` H:W≈5:1 가늘고 긴 막대(기존 1.36:1 교정)·완전 반원 끝·반원통 단면 그라디언트(평평면 밝은 베이지+나뭇결 / 둥근면 짙은 갈색+볼록 음영)·백도 X 표식 유지, yut-canvas 120×130 세로형.
- **버그픽스(HIGH)**: `js/main.js` 보드 클릭 hit-test를 `BOARD_SIZE(560)/rect.width|height` 비율 매핑으로 수정(canvas.width 동적화 무관, dpr 1/2/2.5 정합). 신규 회귀 `tests/redesign-hittest-qa.spec.js`(4건).
- **로직 무변경**: board.js·server.js·game.js·DOM id·WS 프로토콜·STATE 스키마 전부 무수정. 서버리스 338 + bot-smoke 10 + e2e 25 = 373 회귀 PASS 유지.

### 2026-06-16 주요 변경 (버그A / 버그B 해소)
- **버그A — 중앙 통과 자동 라우팅**: `server.js` — 중앙(23)을 잔여 steps로 통과하는 이동은 awaitingBranch를 켜지 않고 `piece.lastPath`(지름길 진입 경로) 기준으로 자동 출구 라우팅. 지름길A 통과 → centerExitA(28/29 경유), 지름길B 통과 → centerExitB(24/25 경유). BRANCH_REQUEST/분기 모달은 중앙·모서리 **정확 착지** 시에만 무장. 중첩 분기(모서리 정확 착지 후 shortcut→중앙 통과, piece.cell=5/10)와 비충돌.
- **버그B — centerExitA 28/29 대칭 신설**: `server.js advanceOneCell` centerExitA `23→28→29→15→16→17→18→19→GOAL`(이전 `23→15` 직행), 백도 복귀 `29→28`/`28→23`, 시작 칸 28/29 이동은 `pathContext='centerExitA'` 잔여 소진. `board.js buildCenterExitA`/`CENTER_EXIT_A` 좌표·hit-test·경로선 추가. centerExitB(24/25)와 x=280 수직 거울 대칭. STATE 스키마/클라 프로토콜 무변경.
- **테스트**: 신규 11건(중앙 통과 자동 라우팅 + centerExitA 28/29 경유/잡기/업기/백도). 갱신 9파일: yut.unit, rulebook-c2/c7/c11/c12/c13/c14/c16, ws.scenarios, qa-rulefix-edge, bot-smoke(YBOT-004 결정적 inject 프로브 보강).
- 회귀: 서버리스 **338 passed**(이전 327 + 신규 11), bot-smoke **10/10**(YBOT-004 결정적 프로브), E2E 25 PASS. 중첩 분기(YR-C16) 무영향.
- 룰북 §13: §13-2(centerExitA 28/29 대칭) + §13-6(중앙 통과 자동 라우팅) 보강. 미해소 4 + 해소 8 유지.

### 2026-06-15 주요 변경 (§13-5 / §13-6 해소)
- **§13-6 — 지름길B 중앙 자동 라우팅**: `server.js computeNextCell` 반환에 `finalPath` 추가 + `movePiece`가 `piece.lastPath`에 저장. MOVE_PIECE 자동 조건 `piece.cell===23 && piece.lastPath==='shortcutB'`이면 BRANCH_REQUEST 없이 centerExitB(bottom) 자동. 지름길A 경유는 자유 선택 유지, 중첩 분기(cell 5/10)는 자동 조건과 비충돌(YR-C16 무영향). STATE 스키마/클라 무변경.
- **§13-5 — 첫칸 빽도 워프**: `computeNextCell` steps=-1에서 cell 1↔19 양방향 워프(외곽 범용 후퇴 범위 2~18로 좁힘). done=false. HOME 빽도 자동 폐기·cell 0 정책 유지.
- **테스트**: 신규(지름길B 자동/지름길A 선택유지/cell1↔19 양방향/워프 후 완주) + 정책 변경 갱신 YR-C7-008·YR-C5-001·YR-C3 capture. rulebook-c5/c7/yut.unit에 반영.
- 회귀: 서버리스 **327 passed**(이전 321 + 신규 6), 봇 smoke 7/7 PASS. 중첩 분기 무영향.
- 룰북 §13: 구현 vs 표준 차이 12건 → 미해소 4 + 해소 8 (§13-5/§13-6 해소 추가).

### 2026-06-15 주요 변경 (§13-12 해소)
- **`server.js`**: MOVE_PIECE(~972)·CHOOSE_PATH(~1066) capturedBonus 부여 가드(`useResult !== 'yut' && useResult !== 'mo'`). 윷·모 자체 보너스와 잡기 보너스 중복 차단(한 행위 최대 1회), 도/개/걸 잡기는 +1 유지.
- **신규 `tests/rulebook-c19-capture-bonus-no-stack.spec.js`** (YR-C19-001~006). 기존 YR-C8-009는 구버그(중복 보너스) 단언 → 해소 룰로 기댓값 갱신.
- **연구 보고서 보존**: `docs/2026-06-15-yutnori-rule-research.md` (딥리서치 권위 룰 가이드, 향후 표준 기준).
- 회귀: 서버리스 295 + QA 엣지 26 = **321/321 PASS**(이전 315 + YR-C19 6), 봇 smoke 7/7 PASS, E2E 25 유지.
- 룰북 §13: 구현 vs 표준 차이 12건 → 미해소 6 + 해소 6 (§13-12 해소 추가).

### 2026-06-12 주요 변경 (AI 봇)

### 2026-06-12 주요 변경 (AI 봇)
- **`bot.js` 신규** — STATE 기반 상태 머신 봇(분기 응답 → 그리디 말 이동 → 던지기). matgo/janggi/yahtzee/rummikub와 동일한 `getBotUrl` + `child_process.spawn` 패턴. 강한 AI가 아니라 게임 전 흐름을 데드락 없이 완주하는 테스트용 봇.
- **`server.js`**: `getBotUrl` 옵션 + `spawnBotChild`/`killBotChild` + connection 핸들러 `mode=ai/bot/human` 파싱 + **STATE에 `capturedBonus` 필드 추가(후방 호환)**.
- **클라**: 대기 화면 `#ai-panel`("🤖 AI랑 시작") 버튼(p1+혼자 대기+mode≠ai일 때 노출), `?mode=ai` 재진입, `network.js` mode 쿼리 + sessionStorage 백업.
- **런처**: yutnori `getBotUrl` 주입, `games.json` `botAvailable: false → true`(런처 1/2 AI 모드 활성).
- **신규 `tests/bot-smoke.test.js`** (YBOT-001~005, 포트 3104).
- **간헐 데드락(HIGH) 수정**: 봇 중복 행동 방지 키에 `awaitingBranchType` 추가. 중첩 분기(corner shortcut→center 재무장) 시 키가 동일해져 봇이 2차 분기를 무시하던 영구 턴 잠금 해소.

### 2026-06-11 주요 변경
- **FIX-1** 재입장 ID 중복 데드락 수정(미사용 ID 탐색 배정).
- **FIX-2** 모서리(5/10) 외곽/지름길 선택 분기(§13-1 [HIGH] 해소). `BRANCH_REQUEST corner` + `CHOOSE_PATH outer/shortcut`. 모서리 지름길 + 중앙 통과 시 corner→center 2단계 중첩 분기 모달.
- **FIX-3** centerExitB `23→24→25→GOAL` 잔여 소진(§13-2 [HIGH] 해소). 신규 칸 24/25 활성화(`board.js buildCenterExitB`).
- **FIX-4** capturedBonus 소진 조건 정밀화(큐 빈 capturedBonus 진입 THROW에서만 소진, 윷/모 진입 시 보존).
- **§13-12** [LOW] §6-1 윷·모 잡기 중복 보너스 차단 신규 등록(2026-06-15 해소).
- **중첩 분기 결함 수정**: 모서리 지름길 진입이 중앙 통과 시 윷/모 결과 증발 HIGH 버그 → `computeNextCell` 복합 branchChoice(`shortcut-top/bottom`) + CHOOSE_PATH center 재무장.
- **룰북 §13**: 구현 vs 표준 차이 **12건** (미해소 6 + 해소 6). §13-1/§13-2 [HIGH] 본 작업 해소, §13-12 [LOW]는 2026-06-15 해소.

**Phase 2 완료** — 백도(빽도) 추가 + 룰 매핑 정정. smoke 40/40 PASS.

### Phase 2 주요 변경
- 백도(빽도): 마크 가락(0번)만 뒤집힐 때 발동 → -1칸. HOME 말 사용 불가(자동 폐기). 보너스 없음.
- `throwYutSticks` 매핑 버그 수정 (정통 룰: fronts 0→윷, 1→걸, 2→개, 3→도/백도, 4→모).
- 마크 가락 빨간 X 시각화 + 백도 결과 빨간색 칩.
- smoke 시나리오 7~9 신규 (단위 5000회 분포, computeNextCell 백도/지름길 진입, HOME 백도 차단 검증).

**Phase 1 완료** — 동작 가능한 MVP. smoke 18/18 PASS.

### 완료 항목

- ✅ 서버 권위 게임 로직 (윷 던지기, 말 이동, 잡기/업기, 지름길, 분기, 완주 판정)
- ✅ WebSocket 프로토콜 (JOIN/READY/START/STATE/THROW_YUT/MOVE_PIECE/CHOOSE_PATH/GAME_OVER/REMATCH)
- ✅ 보드 렌더링 (사각형 + 두 대각 지름길 + 중앙 "방"). 2026-06-18 재디자인: 나뭇결·칸 radialGradient·말 3D·centerExitA 점선 신규 렌더, 한지/원목 테마.
- ✅ 윷가락 시각화 (Canvas, 4개 가락의 앞/뒤 색상 차이). 2026-06-18 재디자인: H:W≈5:1 가늘고 긴 막대·반원통 단면, 세로형 캔버스.
- ✅ 2단 레이아웃 (2026-06-18) — 왼쪽 큰 보드 + 오른쪽 320px 인포바 통합, 반응형 1100/900px, 웹폰트 Jua+Gowun Dodum.
- ✅ 말 4×2색 렌더링 + 업힘 카운트 표시
- ✅ 결과 큐 → 클릭으로 사용할 결과 선택 → 말 클릭 이동
- ✅ 중앙 분기 모달
- ✅ AI 봇 (`bot.js`, 2026-06-12) — `mode=ai` 자동 spawn, 대기 화면 "🤖 AI랑 시작" 진입점, 런처 1/2 AI 모드
- ✅ 재대결 흐름
- ✅ tetris-battle 패턴: ANSI 콘솔 박스, LAN IP 자동 감지, 포트 3000~3010 폴백
- ✅ 친구 초대 패널 + 주소 복사 버튼 + 토스트
- ✅ `start.bat`/`stop.bat` (Windows 더블클릭, 첫 실행 시 npm install 자동)
- ✅ stop.bat은 윈도우 타이틀 기반 — tetris-battle/matgo 서버 영향 없음

### 룰 단순화 현황 (2026-06-11 갱신)

- ~~모서리에 정확히 멈춘 다음 턴은 자동 지름길 진입~~ → **2026-06-11 FIX-2로 외곽/지름길 선택 모달 적용** (§13-1 해소). 모서리(corner) + 중앙(center) 모두 분기 모달, 모서리 지름길 후 중앙 통과 시 2단계 중첩 모달.
- ~~중앙→좌하 출구는 직접 완주 처리~~ → **2026-06-11 FIX-3로 23→24→25→GOAL 잔여 소진** (§13-2 해소, 칸 24/25 활성화). **2026-06-16 버그B**: centerExitA도 28/29 대칭 신설(`23→28→29→15→…→GOAL`).
- ~~중앙 분기는 진입 경로 무관 top/bottom 자유 선택~~ → **2026-06-15 §13-6 해소**: 지름길B 경유 중앙 정착(`piece.lastPath==='shortcutB'`)은 자동 centerExitB(bottom), 지름길A 경유는 자유 선택 유지.
- ~~중앙 통과(정확히 안 멈춤) 시 분기 모달~~ → **2026-06-16 버그A**: 중앙 통과는 BRANCH 미발송 + 진입 지름길 기준 자동 라우팅(지름길A→centerExitA, 지름길B→centerExitB). 분기 결정은 정확 착지에만.
- ~~첫칸(cell 1) 빽도는 단순 후퇴(cell 0)~~ → **2026-06-15 §13-5 해소**: cell 1↔19 워프(done=false). HOME 빽도 자동 폐기는 유지.
- ~~백도(빽도) 변형 룰 미적용~~ → **Phase 2에서 추가** (마크 가락 0번).
- 백도(빽도) X자 표식 가락 변형 룰 미적용(현행 유지).

### 알려진 제한

- 같은 칸의 자기 말 묶음을 "업힘 1묶음"으로 시각화하지만, **이동 시에는** 같은 cell에 있는 자기 piece 인덱스 전부를 group으로 함께 이동시킴 (의도된 단순화)
- ~~§13-12 [LOW]: §6-1 윷·모로 잡으면 잡기 보너스 + 윷/모 보너스 둘 다 발생~~ → **2026-06-15 해소** (MOVE_PIECE/CHOOSE_PATH 가드로 윷·모 잡기 보너스 미부여, 도/개/걸은 +1 유지)
- HOME 영역 클릭은 좌하/우상 코너 박스 + 빈 영역 폴백으로 처리. 더 명시적인 HOME 클릭 UI는 향후 폴리시.

## 디렉토리

(상세는 `CLAUDE.md` 참조)

## 다음 단계 후보

| 우선순위 | 항목 |
|---|---|
| 중간 | 백도 변형 룰 옵션 |
| 낮음 | 던지기 애니메이션 (가락 회전 → 결과 노출) |
| 낮음 | 사운드 효과 |

## 테스트 현황 (2026-06-18)

- **시각 재디자인 hit-test QA (2026-06-18): `tests/redesign-hittest-qa.spec.js` 4/4 PASS + dpr 1/2/2.5 매트릭스**: 2단 레이아웃 도입으로 캔버스 표시 크기가 동적화된 환경에서 보드 클릭 hit-test가 `BOARD_SIZE(560)/rect.width|height` 비율로 정확히 매핑되는지 검증(말 클릭/이동 좌표 정합). 회귀 게이트.
- **봇 smoke (YBOT-001~005, 포트 3104): 10/10 PASS**: 봇 vs 봇 1판 완주 + 3판 연속 REMATCH 완주 + corner/center 분기 응답 + capturedBonus 던지기. 2026-06-16 YBOT-004를 결정적 inject 프로브로 보강(중앙 통과 자동 라우팅 검증). 인라인 봇 vs 서버 spawn bot.js 대전. `node tests/bot-smoke.test.js`. 데드락 0.
- **서버리스 회귀 338/338 PASS**: 이전 327 + 신규 11건(버그A 중앙 통과 자동 라우팅 + 버그B centerExitA 28/29 경유/잡기/업기/백도). 갱신 9파일: yut.unit, rulebook-c2/c7/c11/c12/c13/c14/c16, ws.scenarios, qa-rulefix-edge.
  - 룰북 (YR-C1~C19): 룰북 §1~§13 + 부록 커버, §13 12건 커버. c15 재입장 / c16 모서리 분기(중첩 포함) / c17 centerExitB / c18 보너스 정밀화 / c19 §13-12 윷·모 잡기 중복 차단. c5 빽도(cell1↔19 워프) / c7 분기(지름길B 자동).
  - 신규 파일: `rulebook-c19-capture-bonus-no-stack.spec.js`(YR-C19 6). 기존 `qa-rulefix-edge.spec.js`(QA 엣지 26), `rulebook-c15~c18-*.spec.js`.
- **E2E 25/25 PASS**: `e2e-scenarios.spec.js` (서버 가동 시 별도 회귀).
- `tests/smoke.test.js`: 시나리오 1~8 36 assert + 모서리 분기 보조 assert, 풀 실행 **40 PASS** (레거시 유지). 8b "참고용" WS 샘플러는 환경 의존 장기 실행으로 기능 무관.

## 참조

- 사용자 문서: `README.md`
- 컨벤션: `CLAUDE.md`
- 변경 이력: `docs/CHANGELOG.md`
