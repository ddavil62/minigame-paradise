# Codenames(클래식) — 변경 이력

## 2026-06-28 — AI 봇 추가 (접근법 C: 완전 오프라인 태그맵)

코드네임 클래식을 **휴먼 전용 → AI 봇 지원**으로 전환했다. **접근법 C(오프라인 큐레이션 태그맵)** — 런타임 외부 의존성 **0**(LLM API·임베딩·HTTP 호출 없음). 빌드타임에 생성한 590단어 정적 태그맵만으로 스파이마스터(단서 생성)·요원(추측) 양역할을 수행한다. 사람 1~3명 + 봇으로 즉시 시작 가능. `botAvailable: false → true`. QA 최종 PASS(DEFECT-1·GAP-1 수정 후), AD3 APPROVED, visual_change: ui.

### 추가

- **`codenames/bot-knowledge.js`** (신규) — 빌드타임 생성 **590단어 정적 태그맵**(128 고유태그). 런타임 API 호출 0, 외부 npm·Node 내장 모듈 import 0(순수 `export const TAG_MAP`). 단어 1개당 평균 3~7태그(상위 분류 → 하위 분류 → 교차 속성). 역조회 헬퍼:
  - `tagsForWord(word)` — 단어의 태그 배열.
  - `wordsForTag(tag)` — 해당 태그를 가진 단어 목록.
  - `commonTags(words)` — 단어 집합의 공통 태그(교집합).
  - `allTags()` — 전체 태그 Set.
- **`codenames/bot.js`** (신규) — WS 클라이언트 봇(스파이마스터 + 요원 양역할).
  - **스파이마스터**: 자기팀 미공개 단어 ≥2개가 공유하는 공통 태그를 단서로 선택, `number`=커버 단어 수. **암살자 + 상대팀 + 중립 카드의 태그를 가진 후보는 제외**(2단 폴백 — 유효 태그 0이면 위험 회피 1:1 단서, 그마저 없으면 임의 자기팀 단어 첫 태그). 보드에 실재하는 단어는 단서로 회피.
  - **요원**: `currentClue.word`의 태그를 역조회 → 보드 미공개 단어와 태그 교집합 점수 순위 → 최상위 GUESS. 보너스 추측 미사용(보수적), 후보 소진 시 END_TURN.
  - 행동 딜레이 1~2초(환경변수 `CODENAMES_BOT_DELAY_MIN`/`CODENAMES_BOT_DELAY_RAND`로 테스트 단축), GAME_OVER/REMATCH_WAITING 시 자동 REMATCH, OPPONENT_LEFT에서만 `process.exit`. 미정의 메시지에 프로세스 종료 없음.
  - import는 `bot-knowledge.js`만(`game.js`/`server.js` import 금지 — 외부 의존성 0 원칙).
- **`codenames/tests/bot-knowledge.test.js`** (신규) — 태그맵 단위 **22건**(590단어 커버리지 100%·미매핑 0·빈 태그 배열 0, 헬퍼 정합, 암살자 회피 검증).
- **`codenames/tests/bot-smoke.test.js`** (신규) — 봇 vs 봇 1판 완주 smoke **23건**(CBOT 시리즈). 3회 반복 데드락 0.

### 변경

- **`codenames/server.js`** — `getBotUrl` 훅 활성화 + **다중 봇 spawn**(`botChildren: Map<slotKey, ChildProcess>`, slotKey=`{team}-{role}`, 슬롯 간 지연 spawn으로 playerId 충돌 방지).
  - **`FILL_WITH_AI`** 핸들러 추가(role_select 단계) — 게임 내 빈 슬롯을 봇으로 채움. 명시 team/role 봇 spawn.
  - **team/role 없는 봇 자동 슬롯 배정** — 런처 제너릭 spawn(`?mode=ai`)으로 들어온 봇이 PICK_ROLE 없이 입장하면 서버가 빈 슬롯에 자동 배정. 런처 "AI채우기" 진입 경로 지원(GAP-1 수정).
  - **#13 좀비 정리** — 사람 disconnect 시 짝 봇 슬롯을 동기 `terminate()` + `killAllBots()`, connection 진입부 `readyState !== OPEN` 죽은 슬롯 선제 제거(살아있는 봇 보존). 재접속 시 "방이 가득 찼다" ERROR 무재발.
  - `Player.mode`(`human`/`ai`/`bot`) typedef 추가, `broadcastRoleState`에 `isBot` 필드 노출, `resetRoom`에 `killAllBots()` 추가.
- **`codenames/public/`** — role_select 봇 슬롯 "AI" 뱃지 + 호스트 "AI로 빈자리 채우기" 버튼 + 봇슬롯 클릭 가드(사람이 봇 자리 못 뺏게).
- **`launcher/public/games.json`** — codenames `botAvailable: false → true`.
- **`launcher/server.js`** — codenames `createApp`에 `getBotUrl` 주입(omok/yutnori 등록 패턴).

### 수정 (QA 발견)

- **DEFECT-1** — 스파이마스터 봇 데드락. 유효 태그 0 + 폴백 미발동 조건에서 봇이 CLUE를 영원히 보류하던 버그. 폴백 로직 보강으로 해소(봇 smoke 23×3 데드락 0으로 검증).
- **GAP-1** — 런처 "AI채우기" 진입 미지원. 런처는 team/role 없는 제너릭 봇을 spawn하는데 서버가 PICK_ROLE 없는 봇을 슬롯 배정하지 않아 시작 불가. 서버 자동 슬롯 배정으로 해소.

### 2가지 AI 진입 경로

1. **게임 내** "AI로 빈자리 채우기"(호스트) — 사람이 자기 자리를 먼저 고른 뒤 빈 슬롯에 명시 team/role 봇 배정.
2. **런처** "AI채우기" — 런처가 제너릭 봇(`?mode=ai`)을 spawn → 서버가 빈 슬롯에 자동 배정.

### 검증

- 봇 smoke **23**(`bot-smoke.test.js`) — 3회 반복 데드락 0.
- bot-knowledge 단위 **22** — 590단어 커버리지 100%(미매핑 0).
- AI채우기 시나리오 — 1인+3봇 / 2인+2봇 / 3인+1봇 모두 정상 시작.
- #13 좀비 무재발(사람 disconnect → 재접속 ERROR 0).
- 휴먼 회귀 — codenames smoke 65 + E2E 12 + codenames-duet 27 무영향.
- QA 최종 **PASS**(원 QA PARTIAL → DEFECT-1·GAP-1 수정 후 해소), AD3 APPROVED.

### v1 한계 (추후 보강 여지)

- 단서가 카테고리/태그 기반이라 LLM 같은 **창의적 단서는 아님**(사용자 합의). 아쉬우면 연상어(association) 보강 가능.

### 참고

- 스펙: `.claude/specs/2026-06-28-codenames-bot-spec.md`
- 스코프: `.claude/specs/2026-06-28-codenames-bot-scope.md`
- QA: `.claude/specs/2026-06-28-codenames-bot-qa-report.md`

---

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
