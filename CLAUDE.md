# 미니게임 천국 (minigame-paradise)

LAN 1:1 미니게임 9종 통합 패키지. 단일 포트(3000) 통합 라우터 구조. (하나비는 2인 협력 게임)

## 게임 목록

| 경로 | 게임 | 서버 | AI 봇 |
|------|------|------|------|
| `/matgo/` | 맞고 (화투 1:1 대전) | `matgo/server.js` | O |
| `/tetris-battle/` | 테트리스 배틀 | `tetris-battle/server.js` | X |
| `/davinci-code/` | 다빈치 코드 | `davinci-code/server.js` | X |
| `/yutnori/` | 윷놀이 | `yutnori/server.js` | X |
| `/codenames-duet/` | 코드네임 듀엣 | `codenames-duet/server.js` | X |
| `/janggi/` | 장기 (한국식 표준 KJA 2009) | `janggi/server.js` | O |
| `/hanabi/` | 하나비 (협력 불꽃 카드게임) | `hanabi/server.js` | X |
| `/yahtzee/` | 요트 다이스 (Yahtzee, 1:1 점수표) | `yahtzee/server.js` | O |
| `/rummikub/` | 루미큐브 (타일 그룹/런 세트 만들기) | `rummikub/server.js` | O |

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
- **맞고 (matgo)**: 룰북 + 단위/E2E 104개 + 신규 G-40~G-44 5건(쓸) + JOKER-001~009 9건(조커). 2026-05-31 룰 보강 5건 — 사통(같은 월 4장 모달 +7), 흔들기/폭탄 카드 클릭 시점 모달(`shake_decision` phase 제거, `awaiting_sangtong` 신설), 첫뻑 +7 base 가산, 폭탄 후 덱 2턴 연속 뒤집기, floor 카드 ID 기반 `floorSlotMap` 위치 고정. 2026-06-03 6건째: **쓸(`sseul`)** — 바닥 같은 월 2장 + 손패 1장(awaiting_floor_choice → 선택) + 더미 1장 매치 = 그 월 4장 전부 + 상대 피 1장. `sweep_from_flip` 토스트는 "쓸!" → "뻑 풀이!"로 정정. 2026-06-03 7건째: **조커 2장** — 덱 50장(`m00_joker_a/b`, `type='joker'`, `month=0`), 매치 불가, captured 시 피 +2, 케이스 A(손 조커 → 상대 피 1 + captured + 더미 1장 손 보충 + 매치 스킵) / 케이스 B(더미 뒤집은 게 조커 → 상대 피 1 + 손에 추가 + 한 번 더 뒤집기, 재귀). `bonusFlipSteps`도 동일. **2026-06-03 정정**: 바닥에 깔린 조커는 데드 슬롯이 아니라 **선공자 자동 획득**(`applyFloorJokerToFirst` in `startRound` — 분배 직후 floor 조커 N장 → `captured[firstTurn]`, 추가 보너스 없음, `lastAction.kind='floor_joker_to_first'` 토스트). `createGame` 결과 `floor`는 6~8 가변, 카드 총 50 일관. **2026-06-08 조커 라운드 종료 불가 수정**: 케이스 B로 한쪽 손이 +1 누적되어 양쪽 0 동시 도달 불가능했던 버그 수정. `finishTurn` 종료 조건을 "한쪽 손+credit=0 + 상대 credit=0"으로 변경 + 종료 시 양쪽 잔여 손 카드를 본인 captured로 자동 정산(`flushHandsToCaptured`). 폭탄 권리(credit) 우선 보존. `score.js` 무수정. 회귀 JOKER-014~017 추가 (joker-adhoc 19/19, sseul-adhoc 11/11, bombdup-adhoc 7/7, floor-joker-smoke 5/5 = 42/42 PASS).
- **윷놀이 (yutnori)**: 룰북 `yutnori/docs/RULEBOOK.md` (한국 표준 + 본 구현 비교, §1~§13 + 부록) + 룰북 기반 Playwright 시나리오(`tests/rulebook-c1~c18-*.spec.js`, YR-C1~C18, §13 12건 커버). §13 구현 vs 표준 차이 **12건** (미해소 7 + 해소 5). **2026-06-11 룰 정합 수정 4건(FIX-1~4) + 중첩 분기 수정**: FIX-1 재입장 ID 중복 데드락 / FIX-2 모서리(5/10) 외곽·지름길 선택 분기(§13-1 [HIGH] 해소, `branchType corner/center` + 모서리 지름길 후 중앙 통과 시 corner→center 2단계 중첩 분기 모달) / FIX-3 centerExitB `23→24→25→GOAL` 잔여 소진(§13-2 [HIGH] 해소, 신규 칸 24/25) / FIX-4 capturedBonus 소진 조건 정밀화. §13-12 [LOW] §6-1 윷·모 잡기 중복 보너스 차단 신규 등록(미구현, 별도 발주). 2026-05-31 해소: §13-9 HOME 시각 통일 / §13-10 HOME → 칸 N 정통 매핑 / §13-11 capturedBonus 리셋. 테스트: 서버리스 회귀 289 + QA 엣지 26 = **315/315 PASS** + E2E 25 + smoke 40(신규 `qa-rulefix-edge.spec.js`, `rulebook-c15~c18-*.spec.js`). QA PASS(결함 0), AD3 APPROVED.
- **루미큐브 (rummikub)**: LAN 1:1 타일 게임 (2026-06-10 신규). 타일 106장(1~13×4색×2 + 조커 2), 손 14×2, 더미 78. 그룹(같은 숫자/다른 색 3~4장) / 런(같은 색/연속 숫자 3장+, wrap-around 없음). 첫 등판 30점 이상 필요. 턴 시작 시 `turnSnapshot` 캡처 → 도중 자유 이동 → END_TURN 시 보드 검증 + 첫 등판 점수 검증 → invalid 또는 미달 시 롤백 + 더미 1장. 손 0장 즉시 승리. 서버 권위(`game.js`) — 분배·세트 검증·첫 등판 30점·승리 판정 모두 서버. **AI 봇 강화 완료 (2026-06-10)** — 첫 등판 백트래킹 + 등판 후 그리디 + **조커 활용**(그룹 빈 색 + 런 빈 자리 모든 패턴) + **보드 재구성**(보드 세트 분해 + 새 세트 재조립, 500ms 시간 제한). 조커 회수(SWAP_JOKER)는 표준 룰 지원하지만 봇은 미시도(안전 회피). 효과음 Web Audio 8종. **2026-06-11 룰 정합 수정 10건**: 손 타일을 1장도 내지 않은 턴(순수 재배치)은 commit 불가 → 롤백 + 더미 1장(신규 `no_tile_played` reason, `deck_empty_pass` 패스 카운터 우회 봉쇄), 첫 등판 전 기존 보드 타일 결합 차단, 런 점수 순서 독립 계산, 조커 회수 등판 후 + 정확 타일 검증, 빈 세트 4개 상한, 봇 actionEpoch 체인 취소 등(QA 능동 공격 발견 LOW 1건 QA-ISSUE-1 포함 즉시 보정). smoke `tests/smoke.test.js` (RUMMI-001~032, **138/138 PASS**) + qa-pass3-attack 48/48 + qa-pass3-parity 12/12. 작업 포트 3096.
- **요트 다이스 (yahtzee)**: LAN 1:1 턴 교대 5다이스 점수표 게임 (2026-06-08 신규). 서버 권위 — 다이스 랜덤·점수 계산·턴 전환 모두 `game.js` 순수 함수. 표준 Yahtzee 13 카테고리 + 상단 보너스(63점 → +35) + 야츠 보너스(첫 야츠 50점 후 +100점 누적). smoke 테스트 `tests/smoke.test.js`(ad-hoc 노드 러너, 10건 YACHT-001~010, 131/131 PASS). **AI 봇 지원** (2026-06-08 추가): `bot.js` 휴리스틱 — 최빈/스트레이트/큰값 keep + 카테고리 우선순위(Yahtzee→Straight→FullHouse→Quad→Triple→상단→Chance→손해 최소 0점). 봇 시나리오 `tests/bot-smoke.test.js`(25/25 PASS, YACHT-BOT-001~005, 포트 3099). 외부 에셋 0(다이스는 Canvas 2D pip 패턴). **2026-06-09 효과음 9종**(Web Audio API 코드 합성, 외부 MP3 0건, 헤더 🔊/🔇 토글, localStorage `yahtzee.muted` 영속). **2026-06-09 실시간 keep 동기화 + 카테고리 강조**: 신규 `TOGGLE_KEEP { index, value }` 메시지(서버 `game.js::toggleKeep` 가드 — phase/턴/rollCount≥1/0≤index<5, 실패는 조용히 무시) → 상대 턴에서 본인 keep 다이스가 `.die.kept.opponent` + 라벨 "상대 KEEP"으로 즉시 동기화. CATEGORY_SCORED 시 `data-pid`+`data-category` 셀에 `@keyframes scored-flash`(1.4s, scale 1→1.55→1.3→1 + tomato 글로우) 적용. 신규 회귀 YACHT-LIVE-001(toggleKeep 단위 가드)/002(WS 양쪽 STATE.keep 일치)/003·004(opponent KEEP 라벨). 합계 **222/222 PASS** (smoke 155 + dice-render 42 + bot-smoke 25).
- **코드네임 듀엣 (codenames-duet)**: 2026-06-09 **복기 모드 추가** — 게임 종료(`GAME_END`) 시 서버가 `review = { words, keyCardP1, keyCardP2, revealed, greenFound, tokensLeft }`를 함께 브로드캐스트. 결과 모달의 "🔍 복기 보기" 버튼 → 모달 닫고 보드 25칸이 **양쪽 시점 키 카드 전체 공개**(좌상단=내 시점, 우하단=상대 시점 점). 상단 `#review-banner` (sticky)에 결과 요약 + 새 게임/다른 종목/결과 다시 보기 버튼. 복기 중 카드 클릭·단서 입력 비활성. **자동 새 게임 트리거 없음** (사용자가 명시적으로 `NEW_GAME` 보낼 때만 시작). 회귀: `tests/review-smoke.mjs`(27/27 PASS, REVIEW-000~004) + `tests/review-visual.mjs`(11/11 PASS, Playwright). 작업 포트 3098(launcher 3000과 격리). **AI 봇 미지원.**
- **하나비 (hanabi)**: 룰북 `hanabi/docs/RULEBOOK.md` (Antoine Bauza 표준 Hanabi + 본 구현 비교, §1~§13, 2026-06-01) + 룰북 기반 Playwright 시나리오 61개(`tests/rulebook-c1~c11-*.spec.js`, HR-C1~C11) 완비 (2026-06-01). 2인 완전 협력 카드게임 — 서버 권위 + **손패 가림**(`snapshotForPlayer`가 본인 손패 color/number null 마스킹)이 정체성. §13 구현 vs 표준 차이 **8건 전부 confirmed**. 회귀 게이트: 손패 누설(HR-C6-001/HR-C7-001), §13-7 오프바이원(HR-C7-003/004, 2026-06-01 giveClue checkGameEnd 누락 HIGH 버그 수정). 테스트: 유닛 31 + WS 7 + QA엣지 8 + E2E 6 + 가이드 슬라이더 9. **대기 화면 룰 가이드 슬라이더**(인포그래픽 7장 `public/assets/guide/`, 버튼·키보드·스와이프, HR-C11, 2026-06-01 추가 — game.js/WS 무변경). E2E(C8~C11)는 `node server.js --port 3095` 사전 구동 필요. **AI 봇 미지원.**

## 런처 로비

단일 화면에서 게임 카드 7개를 즉시 표시하고, 호스트가 카드를 클릭하여 게임을 선택한다. 스타트 버튼이나 별도의 종목 선택 단계는 없다.

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

## 기술 스택

- 바닐라 JavaScript (Node.js 서버, 브라우저 클라이언트)
- WebSocket (`ws` 패키지)
- Playwright (QA 자동화)
- 의존성: `npm install` (루트 `package.json`)
