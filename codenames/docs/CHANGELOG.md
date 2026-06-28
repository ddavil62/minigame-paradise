# Codenames(클래식) — 변경 이력

## 2026-06-28 — 신규 프로젝트 (정통 2:2 팀 대전 1차 코어 완료)

정통 Codenames(단일 공유 키, 2팀 턴제 경쟁, 역할별 시야 분리)를 미니게임 천국 **11번째 게임 "코드네임"**으로 신규 추가했다. 기존 codenames-duet(2인 협력)과 독립 병존한다. 이번은 **휴먼 전용 4인(2:2)**이며, AI 봇은 미구현(슬롯 구조만 예약). QA PASS(blocker 0), AD3 APPROVED(REVISE 6건 반영), visual_change: ui.

### 추가

- **`codenames/game.js`** (신규) — 순수 게임 로직(서버 권위).
  - `createGame(startTeam?)` — 단일 공유 키 생성. `startTeam` 미지정 시 `Math.random()`으로 선공팀(9장 팀) 랜덤 결정, 리매치는 인자로 선공 교체. 키 합계(9/8/7/1 = 25) 불변식 검증.
  - `buildKeyCard(firstTeam)` — 선공팀 9 / 후공팀 8 / 중립 7 / 암살자 1 채운 뒤 Fisher-Yates 셔플.
  - `giveClue(state, team, word, number)` — 스파이마스터 단서. 자기 팀·`clue` 단계 검증, 공백/길이/숫자(1~9) 최소 검증 + 30자 절단, `guessesLeft = number + 1`(정통 보너스), `turnPhase='guess'`.
  - `guessCard(state, team, cardIndex)` — 요원 추측. 키 색별 4분기: `correct`(found+1, 한도 내 턴 유지 / 한도 0 턴 종료 / 전체 공개 승리), `neutral`(즉시 종료), `opponent`(상대 found+1 + 종료, 상대 완성 시 상대 승리), `assassin`(클릭 팀 즉시 패배).
  - `endTurnByPass(state, team)` — 요원 패스(조기 턴 종료). `guess` 단계에서만.
  - `endTurn(state, team)` — 상대 팀 `clue` 단계로 전환, clue/guessesLeft 초기화.
  - `snapshotForPlayer(state, role, playerId)` — **역할별 마스킹**(정체성). 스파이마스터 `myKey`=키 전체, 요원 `myKey`=공개 카드만(미공개 null).
  - 상수: `BOARD_SIZE=25`, `FIRST_TEAM_CARDS=9`, `SECOND_TEAM_CARDS=8`, `NEUTRAL_CARDS=7`, `ASSASSIN_CARDS=1`.
- **`codenames/server.js`** (신규) — WS + 정적 서버, `createApp(options)` factory(noServer 모드).
  - 3단계 phase: `role_select`(4인 입장 + PICK_ROLE + 호스트 START_GAME) → `playing`(역할별 STATE 개별 전송) → `over`(GAME_OVER + 리매치 대기).
  - `ROOM_CAPACITY=4`, `SLOTS` 4개(레드/블루 × 스파이마스터/요원). `isAllSlotsFilled()`로 중복 없는 4슬롯 충족 시 호스트 START 활성.
  - `broadcastRoleState()` / `broadcastState()`(역할별 마스킹 개별 전송) / `buildGameOverPayload()`(키 전체 복기 review 공개).
  - `tryRematch()` — `rematchPending: Set`에 양 팀 1명 이상 동의 시 `createGame(nextFirst)`로 선공 교체 재생성(omok REMATCH 패턴).
  - 좀비 슬롯 청소, heartbeat(30초 ping), 호스트 승계, 1명 이탈 시 role_select 복귀.
  - 단독 실행: `node server.js [--port N]` 기본 3014, EADDRINUSE +1 폴백(`MAX_PORT_FALLBACK=10`), 0.0.0.0 바인딩 + LAN IP 배너.
  - **봇 확장 예약**: `createApp(options.getBotUrl)` 훅 + `Player.ws` 슬롯 자리를 주석으로 예약(이번 미구현, RULEBOOK §13-2).
- **`codenames/words.js`** (신규) — duet `words.js`에서 복사한 독립 단어팩(서버 전용, public 미노출). 교차 import 금지.
- **`codenames/public/{index.html, client.js, style.css}`** (신규) — role_select 선택 화면 + 게임 보드(5×5) + 단서/추측 패널 + 결과 모달, 레드/블루 팀 색상 테마.
- **`codenames/package.json`** (신규) — `"type": "module"` + `ws` 의존성.
- **`codenames/docs/{RULEBOOK.md, PROJECT.md, CHANGELOG.md}`** (신규).
- **`codenames/tests/`** (신규) — `smoke.test.js`(WS/로직 65건, 역할 마스킹 검증 포함) + `e2e.spec.js`(Playwright 12건, 4 브라우저 컨텍스트 = 레드 마스터/요원, 블루 마스터/요원) + `screenshots/`(role-select / spymaster-view / operative-view / after-guess 등).

### 변경 (런처 통합)

- **`launcher/public/games.json`** — 11번째 항목 추가: `{ id: "codenames", name: "코드네임", port: 3014, httpPath: "/codenames/", wsPath: "/codenames/ws", color: "#B22222", emoji: "🕵️", botAvailable: false, minPlayers: 4, maxPlayers: 4 }`.
- **`launcher/server.js`** — `import { createApp as createCodenamesClassicApp } from '../codenames/server.js'` + `GAME_APPS['codenames'] = createCodenamesClassicApp()`. 라우팅은 URL 첫 세그먼트(`split('/')[0]`)로 키 매칭하므로 `codenames`와 `codenames-duet`이 정확히 분리된다(prefix 충돌 없음).

### 검증

- 신규 테스트: smoke **65** + E2E **12** = **77 PASS**.
- 회귀: codenames-duet review-smoke **27/27 PASS**(독립 병존 무영향).
- 역할 마스킹 시각 육안 검증 — 요원 화면 미공개 카드 키 누설 **0**.
- AD3 APPROVED — REVISE 6건 반영, 잔여 WARN 2건(비강제).
- QA PASS(blocker 0). LOW 2건 non-blocker — 종료 후 `silent break`, `isAllSlotsFilled`의 `joined` 미검사(둘 다 정상 흐름 무영향, RULEBOOK §13-8).

### 참고

- 스펙: `.claude/specs/2026-06-28-codenames-classic-spec.md`
- 스코프: `.claude/specs/2026-06-28-codenames-classic-scope.md`
- QA: `.claude/specs/2026-06-28-codenames-classic-qa-report.md`
- 룰북: `docs/RULEBOOK.md` (§1~§13, §13 구현 vs 표준 차이 7건 + non-blocker 2건)
