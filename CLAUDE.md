# 미니게임 천국 (minigame-paradise)

LAN 1:1 미니게임 10종 통합 패키지. 단일 포트(3000) 통합 라우터 구조. (하나비는 2인 협력 게임)

## 게임 목록

| 경로 | 게임 | 서버 | AI 봇 |
|------|------|------|------|
| `/matgo/` | 맞고 (화투 1:1 대전) | `matgo/server.js` | O |
| `/tetris-battle/` | 테트리스 배틀 | `tetris-battle/server.js` | X |
| `/davinci-code/` | 다빈치 코드 | `davinci-code/server.js` | X |
| `/yutnori/` | 윷놀이 | `yutnori/server.js` | O |
| `/codenames-duet/` | 코드네임 듀엣 | `codenames-duet/server.js` | X |
| `/janggi/` | 장기 (한국식 표준 KJA 2009) | `janggi/server.js` | O |
| `/hanabi/` | 하나비 (협력 불꽃 카드게임) | `hanabi/server.js` | X |
| `/yahtzee/` | 요트 다이스 (Yahtzee, 1:1 점수표) | `yahtzee/server.js` | O |
| `/rummikub/` | 루미큐브 (타일 그룹/런 세트 만들기) | `rummikub/server.js` | O |
| `/omok/` | 오목 (표준 19×19, 쌍삼·사사 금수) | `omok/server.js` | O |

AI 봇 지원 게임은 1/2 AI 모드 진입 시 server.js가 `bot.js`를 child_process로 자동 spawn한다 (`getBotUrl` 옵션 패턴).

## 서버 실행

```bash
# 통합 런처 (포트 3000)
node launcher/server.js

# 개별 게임 단독 실행 (개발/테스트용)
node matgo/server.js --port 3013
```

## 테스트

각 게임별 CLAUDE.md에 테스트 가이드가 있다. QA는 반드시 해당 게임의 **룰북**을 먼저 숙지한 후 테스트를 진행한다.

- **장기 (janggi)**: 룰북 `janggi/docs/RULEBOOK.md` (KJA 2009, §1~§13 + 부록 A/B) + 룰북 기반 Playwright 시나리오 111개(`tests/rulebook-c1~c12-*.spec.js`, JR-C1~C12, §11 11/11 커버리지) 완비 (2026-05-31).
- **맞고 (matgo)**: 룰북 + 단위/E2E 104개 + 신규 G-40~G-44 5건(쓸) + JOKER-001~009 9건(조커). 2026-05-31 룰 보강 5건 — 사통(같은 월 4장 모달 +7), 흔들기/폭탄 카드 클릭 시점 모달(`shake_decision` phase 제거, `awaiting_sangtong` 신설), 첫뻑 +7 base 가산, 폭탄 후 덱 2턴 연속 뒤집기, floor 카드 ID 기반 `floorSlotMap` 위치 고정. 2026-06-03 6건째: **쓸(`sseul`)** — 바닥 같은 월 2장 + 손패 1장(awaiting_floor_choice → 선택) + 더미 1장 매치 = 그 월 4장 전부 + 상대 피 1장. `sweep_from_flip` 토스트는 "쓸!" → "뻑 풀이!"로 정정. 2026-06-03 7건째: **조커 2장** — 덱 50장(`m00_joker_a/b`, `type='joker'`, `month=0`), 매치 불가, captured 시 피 +2, 케이스 A(손 조커 → 상대 피 1 + captured + 더미 1장 손 보충 + 매치 스킵) / 케이스 B(더미 뒤집은 게 조커 → 상대 피 1 + 손에 추가 + 한 번 더 뒤집기, 재귀). `bonusFlipSteps`도 동일. **2026-06-03 정정**: 바닥에 깔린 조커는 데드 슬롯이 아니라 **선공자 자동 획득**(`applyFloorJokerToFirst` in `startRound` — 분배 직후 floor 조커 N장 → `captured[firstTurn]`, 추가 보너스 없음, `lastAction.kind='floor_joker_to_first'` 토스트). **2026-06-15 바닥 리필 룰**: 조커 제거 후 `deck.pop()`으로 floor를 8로 리필(연쇄 최대 2, deck 소진 방어) → `createGame` 결과 `floor`는 **항상 8**(deck 충분 시), `deck`은 `22 - N` 가변(이전 "floor 6~8 가변" 표기 폐기), 카드 총 50 불변. **2026-06-15 선공 바닥 조커 연출 수정**: `client.js` `isRoundStart`에 `floor_joker_to_first` 추가 → 조커·리필 카드 모두 fly 없이 appear. **2026-06-08 조커 라운드 종료 불가 수정**: 케이스 B로 한쪽 손이 +1 누적되어 양쪽 0 동시 도달 불가능했던 버그 수정. `finishTurn` 종료 조건을 "한쪽 손+credit=0 + 상대 credit=0"으로 변경 + 종료 시 양쪽 잔여 손 카드를 본인 captured로 자동 정산(`flushHandsToCaptured`). 폭탄 권리(credit) 우선 보존. `score.js` 무수정. 회귀 JOKER-014~017 추가 (joker-adhoc 19/19, sseul-adhoc 11/11, bombdup-adhoc 7/7, floor-joker-smoke 5/5 = 42/42 PASS).
- **윷놀이 (yutnori)**: 룰북 `yutnori/docs/RULEBOOK.md` (한국 표준 + 본 구현 비교, §1~§13 + 부록) + 룰북 기반 Playwright 시나리오(`tests/rulebook-c1~c18-*.spec.js`, YR-C1~C18, §13 12건 커버). §13 구현 vs 표준 차이 **12건** (미해소 7 + 해소 5). **2026-06-11 룰 정합 수정 4건(FIX-1~4) + 중첩 분기 수정**: FIX-1 재입장 ID 중복 데드락 / FIX-2 모서리(5/10) 외곽·지름길 선택 분기(§13-1 [HIGH] 해소, `branchType corner/center` + 모서리 지름길 후 중앙 통과 시 corner→center 2단계 중첩 분기 모달) / FIX-3 centerExitB `23→24→25→GOAL` 잔여 소진(§13-2 [HIGH] 해소, 신규 칸 24/25) / FIX-4 capturedBonus 소진 조건 정밀화. §13-12 [LOW] §6-1 윷·모 잡기 중복 보너스 차단 신규 등록(미구현, 별도 발주). 2026-05-31 해소: §13-9 HOME 시각 통일 / §13-10 HOME → 칸 N 정통 매핑 / §13-11 capturedBonus 리셋. 테스트: 서버리스 회귀 289 + QA 엣지 26 = **315/315 PASS** + E2E 25 + smoke 40(신규 `qa-rulefix-edge.spec.js`, `rulebook-c15~c18-*.spec.js`). QA PASS(결함 0), AD3 APPROVED. **2026-06-12 AI 봇 추가**: `bot.js`(STATE 기반 상태 머신, `getBotUrl`+spawn 패턴, `mode=ai` 자동 spawn + 대기 화면 "🤖 AI랑 시작" 진입점), STATE에 `capturedBonus` 필드 추가(후방 호환). 중첩 분기(corner shortcut→center 재무장) 간헐 데드락(HIGH)을 봇 dedup 키에 `awaitingBranchType` 추가로 해소. 봇 smoke `tests/bot-smoke.test.js`(YBOT-001~005, 포트 3104) **4회 연속 7/7 PASS** + 서버리스 315 + E2E 25 유지. **2026-06-15 §13-5/§13-6/§13-12 해소** (첫칸 빽도 워프 cell 1↔19 / 지름길B 경유 중앙 정착 자동 centerExitB / 윷·모 잡기 중복 보너스 차단). **2026-06-16 버그A/B 해소**: 버그A — 중앙(23) **통과**(정확히 안 멈춤) 시 BRANCH 미발송 + 진입 지름길 기준 자동 라우팅(지름길A→centerExitA, 지름길B→centerExitB), 분기 결정은 정확 착지에만 / 버그B — centerExitA에 중간 칸 28/29 신설(`23→28→29→15→…→GOAL`, centerExitB 24/25와 거울 대칭, 백도 29→28/28→23). 수정 `server.js`/`public/js/board.js`. 검증: 서버리스 **338** + bot-smoke **10/10**(YBOT-004 결정적 inject 프로브) + E2E **25** = 전부 PASS, QA PASS(결함 0), AD3 APPROVED(28=(356.67,356.67)/29=(433.33,433.33) 겹침 0).
- **루미큐브 (rummikub)**: LAN 1:1 타일 게임 (2026-06-10 신규). 타일 106장(1~13×4색×2 + 조커 2), 손 14×2, 더미 78. 그룹(같은 숫자/다른 색 3~4장) / 런(같은 색/연속 숫자 3장+, wrap-around 없음). 첫 등판 30점 이상 필요. 턴 시작 시 `turnSnapshot` 캡처 → 도중 자유 이동 → END_TURN 시 보드 검증 + 첫 등판 점수 검증 → invalid 또는 미달 시 롤백 + 더미 1장. 손 0장 즉시 승리. 서버 권위(`game.js`) — 분배·세트 검증·첫 등판 30점·승리 판정 모두 서버. **AI 봇 강화 완료 (2026-06-10)** — 첫 등판 백트래킹 + 등판 후 그리디 + **조커 활용**(그룹 빈 색 + 런 빈 자리 모든 패턴) + **보드 재구성**(보드 세트 분해 + 새 세트 재조립, 500ms 시간 제한). 조커 회수(SWAP_JOKER)는 표준 룰 지원하지만 봇은 미시도(안전 회피). 효과음 Web Audio 8종. **2026-06-11 룰 정합 수정 10건**: 손 타일을 1장도 내지 않은 턴(순수 재배치)은 commit 불가 → 롤백 + 더미 1장(신규 `no_tile_played` reason, `deck_empty_pass` 패스 카운터 우회 봉쇄), 첫 등판 전 기존 보드 타일 결합 차단, 런 점수 순서 독립 계산, 조커 회수 등판 후 + 정확 타일 검증, 빈 세트 4개 상한, 봇 actionEpoch 체인 취소 등(QA 능동 공격 발견 LOW 1건 QA-ISSUE-1 포함 즉시 보정). smoke `tests/smoke.test.js` (RUMMI-001~032, **138/138 PASS**) + qa-pass3-attack 48/48 + qa-pass3-parity 12/12. 작업 포트 3096. **2026-06-12 손패 정렬 버튼 2종(색상순 기본/숫자순, localStorage `rummikub.sortMode` 영속) + 보드 세트 자동 정규화(`normalizeSetTiles` — `moveTile`/`swapJoker` 후 valid 세트만 오름차순, WS 프로토콜 무변경)**: 신규 RUMMI-033~037로 smoke **150/150** + 능동 공격 `qa-pass4-sort` 34/34 + Playwright `sort-buttons-qa` 1/1, AD3 APPROVED.
- **요트 다이스 (yahtzee)**: LAN 1:1 턴 교대 5다이스 점수표 게임 (2026-06-08 신규). 서버 권위 — 다이스 랜덤·점수 계산·턴 전환 모두 `game.js` 순수 함수. 표준 Yahtzee 13 카테고리 + 상단 보너스(63점 → +35) + 야츠 보너스(첫 야츠 50점 후 +100점 누적). smoke 테스트 `tests/smoke.test.js`(ad-hoc 노드 러너, 10건 YACHT-001~010, 131/131 PASS). **AI 봇 지원** (2026-06-08 추가): `bot.js` 휴리스틱 — 최빈/스트레이트/큰값 keep + 카테고리 우선순위(Yahtzee→Straight→FullHouse→Quad→Triple→상단→Chance→손해 최소 0점). 봇 시나리오 `tests/bot-smoke.test.js`(25/25 PASS, YACHT-BOT-001~005, 포트 3099). 외부 에셋 0(다이스는 Canvas 2D pip 패턴). **2026-06-09 효과음 9종**(Web Audio API 코드 합성, 외부 MP3 0건, 헤더 🔊/🔇 토글, localStorage `yahtzee.muted` 영속). **2026-06-09 실시간 keep 동기화 + 카테고리 강조**: 신규 `TOGGLE_KEEP { index, value }` 메시지(서버 `game.js::toggleKeep` 가드 — phase/턴/rollCount≥1/0≤index<5, 실패는 조용히 무시) → 상대 턴에서 본인 keep 다이스가 `.die.kept.opponent` + 라벨 "상대 KEEP"으로 즉시 동기화. CATEGORY_SCORED 시 `data-pid`+`data-category` 셀에 `@keyframes scored-flash`(1.4s, scale 1→1.55→1.3→1 + tomato 글로우) 적용. 신규 회귀 YACHT-LIVE-001(toggleKeep 단위 가드)/002(WS 양쪽 STATE.keep 일치)/003·004(opponent KEEP 라벨). 합계 **222/222 PASS** (smoke 155 + dice-render 42 + bot-smoke 25).
- **코드네임 듀엣 (codenames-duet)**: 2026-06-09 **복기 모드 추가** — 게임 종료(`GAME_END`) 시 서버가 `review = { words, keyCardP1, keyCardP2, revealed, greenFound, tokensLeft }`를 함께 브로드캐스트. 결과 모달의 "🔍 복기 보기" 버튼 → 모달 닫고 보드 25칸이 **양쪽 시점 키 카드 전체 공개**(좌상단=내 시점, 우하단=상대 시점 점). 상단 `#review-banner` (sticky)에 결과 요약 + 새 게임/다른 종목/결과 다시 보기 버튼. 복기 중 카드 클릭·단서 입력 비활성. **자동 새 게임 트리거 없음** (사용자가 명시적으로 `NEW_GAME` 보낼 때만 시작). 회귀: `tests/review-smoke.mjs`(27/27 PASS, REVIEW-000~004) + `tests/review-visual.mjs`(11/11 PASS, Playwright). 작업 포트 3098(launcher 3000과 격리). **AI 봇 미지원.**
- **하나비 (hanabi)**: 룰북 `hanabi/docs/RULEBOOK.md` (Antoine Bauza 표준 Hanabi + 본 구현 비교, §1~§13, 2026-06-01) + 룰북 기반 Playwright 시나리오 61개(`tests/rulebook-c1~c11-*.spec.js`, HR-C1~C11) 완비 (2026-06-01). 2인 완전 협력 카드게임 — 서버 권위 + **손패 가림**(`snapshotForPlayer`가 본인 손패 color/number null 마스킹)이 정체성. §13 구현 vs 표준 차이 **8건 전부 confirmed**. 회귀 게이트: 손패 누설(HR-C6-001/HR-C7-001), §13-7 오프바이원(HR-C7-003/004, 2026-06-01 giveClue checkGameEnd 누락 HIGH 버그 수정). 테스트: 유닛 31 + WS 7 + QA엣지 8 + E2E 6 + 가이드 슬라이더 9. **대기 화면 룰 가이드 슬라이더**(인포그래픽 7장 `public/assets/guide/`, 버튼·키보드·스와이프, HR-C11, 2026-06-01 추가 — game.js/WS 무변경). E2E(C8~C11)는 `node server.js --port 3095` 사전 구동 필요. **AI 봇 미지원.**
- **오목 (omok)**: 표준 19×19 오목 (2026-06-15 신규, 10번째 종목). 룰: **쌍삼(33)·사사(44) 금수**(흑·백 양쪽 동일, 착수 거부), 5목 이상 연속(가로/세로/대각 4방향) 승리, **장목(6목 이상)도 승리**(반칙 아님), 선공=흑(p1). 서버 권위 — 착수 검증·4방향 `checkWin`(5목 이상·장목 포함)·금수·`checkDraw`(361칸) 모두 `game.js` 순수 함수. **AI 봇 지원**(`bot.js` 휴리스틱 1수 평가 — 빈 교차점 361칸 전수 평가, 공격 1.0 + 수비 0.9 가중치, CHAIN_WEIGHT 테이블, 첫 수 천원, `getBotUrl`+`child_process.spawn` 패턴 + 대기 화면 "🤖 AI랑 시작"). 외부 이미지 에셋 0 — Canvas(728px, 19×19 격자·나뭇결·화점 9곳·좌표 라벨 A~T/1~19) + CSS 우드 테마. 단독 실행 포트 3012(충돌 시 +1 폴백). **2026-06-15 쌍삼·사사 금수 + 세션 유지 리매치 추가**: (1) 금수 — 한 착수로 열린3(`_XXX_`) 2개+ 또는 4목(len===4) 2개+ 동시 생성 시 **착수 거부**(board/moveCount 원복·ERROR 토스트·게임 계속), `game.js`에 `isOpenThree`/`isFour`/`checkDoubleThree`/`checkDoubleFour` 추가, `placeStone` 순서 = 기존검증→가상착수→`checkWin`(승리 우선)→`checkDoubleThree`→`checkDoubleFour`(거부 원복)→`checkDraw`→턴교대. **5목+ 완성 수는 33/44 동시여도 승리**(checkWin 선행), 장목은 여전히 승리. (2) 리매치 — `location.reload()` 제거, WS 연결 유지한 채 양쪽 "한 판 더" 동의 시 재시작. 신규 메시지 `REMATCH`(C→S)/`REMATCH_WAITING{ready}`/`REMATCH_START{nextBlack}`(S→C). 선공: 패자=다음 흑, 기권자=흑, 무승부=색 교체(p1/p2 id 불변·color만 재배정 + `createGame()` 재생성, `server.js` `swapColorsForRematch`/`rematchPending`/`lastGameResult`). 봇은 GAME_OVER/REMATCH_WAITING 시 자동 REMATCH(0.5s, 타임아웃 보호 10s), `REMATCH_START`에서 myColor 재설정, 종료 안 함. 수정: `game.js`/`server.js`/`bot.js`/`public/js/{main,network}.js`/`public/index.html`/`public/css/style.css`. 테스트: smoke 106(OMOK-001~012, 포트 3105) + bot-smoke 14(OMOK-BOT-001~004, 포트 3106) + QA엣지 35(`qa-edge` +QA-R1~R6) + QA draw/bot 9 + QA 금수공격 28(`qa-renju-attack` — 닫힌3 비금수/장목 승리/5목+33 승리/경계 래핑/흑백 양쪽) + QA 리매치공격 14(`qa-rematch-attack` — 색 swap/WAITING/START/원복) + E2E 3 + 모바일 1(격리 포트 3077) = **210건 전부 PASS**(기존 117 회귀 포함, 장목 승리·대각/세로 승리·draw 금수 오탐 0건). QA PASS(결함 0), AD3 APPROVED.

## 런처 로비

단일 화면에서 게임 카드 10개를 즉시 표시하고, 호스트가 카드를 클릭하여 게임을 선택한다. 스타트 버튼이나 별도의 종목 선택 단계는 없다.

- 1/2: 호스트가 카드 클릭 시 AI 모드로 게임 시작 (봇 미지원 게임은 비활성)
- 2/2: 호스트가 카드 클릭 시 인간 대전으로 양쪽 동시 이동
- 게스트: 카드 클릭 불가, 투표만 가능
- 게임 완료 후 "다른 종목" 버튼(`#btn-return-lobby`)으로 양쪽 동시 로비 복귀
- 게임 진행 중 상시 "게임 선택" 버튼(`#btn-back-to-lobby`)으로 로비 복귀 가능. confirm 다이얼로그 표시 후 `POST /lobby/return` 호출. 상대방은 disconnect 감지(OPPONENT_LEFT / GAME_RESULT disconnect / GAME_OVER disconnect) + path 기반 런처 모드 판정으로 1.2초 후 자동 redirect

### WS 프로토콜 (launcher /ws)

| 방향 | 메시지 | 페이로드 | 설명 |
|------|--------|---------|------|
| C->S | `PICK_GAME` | `{ gameId }` | 호스트가 게임 선택 |
| C->S | `VOTE_GAME` | `{ gameId }` | 투표 toggle |
| S->C | `LOBBY_STATE` | `{ count, role, hostId, mode, votes }` | 로비 상태 스냅샷 |
| S->C | `REDIRECT` | `{ gameId, path, mode }` | 게임 페이지 이동 |
| S->C | `FULL` | `{ message }` | 정원 초과 거절 |
| S->C | `RESET` | `{}` | 호스트 disconnect 시 초기화 |
| S->C | `RETURN_LOBBY` | `{}` | 로비 복귀 (양쪽 location.href='/') |

### HTTP 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/lobby/return` | 게임 완료 화면에서 호출. 서버가 votes/mode 리셋 + RETURN_LOBBY broadcast. 204 응답 |
| `POST` | `/bug-report` | 버그 신고 수신 → `bug-reports.jsonl`에 append. 200 `{ok:true}` / 빈 텍스트·비JSON 400. 게임 prefix 라우팅보다 **먼저** 매칭 (공통 버그리포트 위젯 참조) |

## 공통 버그리포트 위젯 (2026-06-16 신규)

게임 10종 + 로비 **전체**에 자동 표시되는 버그 신고 위젯. 게임/런처 `index.html`은 **무수정** — 런처 미들웨어가 일괄 주입한다.

### 자동 주입 메커니즘 (`launcher/server.js`)

- `http.createServer` 콜백 **최상단**(라우팅 이전)에서 `attachWidgetInjector(res)`가 `res.writeHead/write/end`를 1회 wrap한다.
- **text/html 응답에만** `</body>` 앞(`lastIndexOf`, 대소문자 무시, iframe 방어)에 다음 스니펫을 삽입한다. `</body>`가 없으면 끝에 append.
  ```html
  <link rel="stylesheet" href="/bug-widget.css"><script src="/bug-widget.js" defer></script>
  ```
- Content-Type 판정: `writeHead` headers 인자 또는 `res.getHeader('content-type')`. `writeHead`를 거치지 않는 Express(`setHeader`+`write`) 경로 대비 `write`/`end` 첫 호출 시 재판정(`decided` 플래그로 1회만) → yutnori/tetris-battle 같은 Express 게임도 동작.
- HTML 확정 시 `content-length` 헤더 제거 → Node가 `Transfer-Encoding: chunked` 자동 전환.
- **비HTML·바이너리 무손상**: js/css/json/png 등은 버퍼링 없이 원본 write/end 즉시 통과(PNG 바이트 동일 검증 완료). 위젯 스크립트 자체에도 미주입.
- WS upgrade(`server.on('upgrade')`)는 별도 이벤트라 wrap 영향 없음.

### 신고 저장 (`POST /bug-report`)

- 라우팅: `POST /lobby/return` 아래, **게임 prefix 라우팅보다 먼저** 매칭(게임 서버로 전달 방지).
- `minigames/bug-reports.jsonl`에 `fs.appendFile`로 1행씩 append (JSON Lines, appendFile 원자성으로 동시 신고 인터리빙 안전).
- 레코드 5필드: `gameId`(pathname 첫 세그먼트, 로비=`launcher`), `timestamp`(ISO), `screenSize{w,h}`, `url`, `text`.
- 검증: 비JSON·`text` 누락·공백만 → 400. 서버측 길이 상한 미강제(스펙상 Out of Scope, LAN 한정).
- `bug-reports.jsonl`은 `.gitignore` 등록(런타임 데이터, 커밋 제외).

### 위젯 UX (`launcher/public/bug-widget.{js,css}`, 바닐라)

- 우하단 `position:fixed` 🐛 FAB → 클릭 시 텍스트 패널 펼침 → 제출 시 패널 접힘 + "기록됨" 토스트(2초). 외부 클릭/✕ 닫기.
- 빈 입력 무시, double-submit 방지(제출 즉시 `disabled`), 중복 주입 가드(`window.__bwWidgetLoaded`).
- CSS는 `.bw-` prefix로만 한정(게임 전역 스타일 미오염), z-index 9001~9003(게임 오버레이 위).

### "로그 확인" 워크플로우

사용자가 **"버그 로그 보고 확인하라"**고 하면, Claude가 `C:\LazySlimeStudio\minigames\bug-reports.jsonl`을 Read해 신고 내역(gameId·url·text 등)을 보고 해당 버그를 해결한다. 이 파일이 신고 수집 채널의 단일 출처다.

### 테스트

- QA 자산: `tests/bug-report-widget-qa.spec.js`(Playwright 7/7 — FAB 표시·펼침·외부클릭 닫힘·제출→토스트·5필드·빈텍스트 미발송·더블클릭 1회·모바일 360px).
- 회귀: omok smoke 106/106, WS upgrade, POST /lobby/return 204 무영향. AC-1~AC-11 + 예외 15건 전부 PASS. QA PASS(blocker 0), AD3 APPROVED.

## 기술 스택

- 바닐라 JavaScript (Node.js 서버, 브라우저 클라이언트)
- WebSocket (`ws` 패키지)
- Playwright (QA 자동화)
- 의존성: `npm install` (루트 `package.json`)
