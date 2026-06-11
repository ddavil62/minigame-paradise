# Rummikub — 변경 이력

## 2026-06-11 — 룰 정합 수정 10건 (코드 리뷰 9건 + QA 후속 1건, smoke 138/138)

코드 리뷰에서 발견된 룰 버그 4건·UI 동작 불일치 3건·견고성 결함 2건을 전수 수정하고, QA 능동 공격에서 추가로 발견된 LOW 결함 1건(QA-ISSUE-1)을 즉시 보정했다.

### 추가
- **`no_tile_played` (TURN_RESULT reason 신설)** — `game.js::endTurn`. 보드 변경이 있어도 손 타일을 1장도 내지 않은 턴(순수 재배치)은 commit 불가. `state.hands[by].length >= snap.hands[by].length`이면 `restoreFromSnapshot` 후 더미 1장 drawOne, 덱이 비었으면 `consecutivePassesAfterDeckEmpty` +1. `deck_empty_pass` 패스 카운터를 재배치로 무한 우회하던 구멍 봉쇄. 클라 `main.js::onTurnResult`는 본인이면 error 토스트 + playDraw, 상대면 "재배치만 → 롤백 + 더미 뽑기" 토스트. (#1, HIGH)
- **빈 세트 4개 상한** — `game.js::addNewSet`. 보드의 빈 세트(tiles 0장)가 4개 이상이면 거부(서버 ERROR). 클라 UI 스크롤 폭주 방지. 채워서 3개 이하로 줄면 다시 생성 가능. (#8, LOW)
- **봇 actionEpoch 체인 취소** — `bot.js`. 모듈 변수 `actionEpoch` 도입. `actTurn` 시작 시 +1 후 `myEpoch` 캡처, ERROR 수신·내 턴 아님 감지 시 +1. `applySetsSequentially`/`applyBoardExtensions`/`applyReconstruction`의 모든 setTimeout 콜백 첫 줄에 `if (actionEpoch !== myEpoch) return;` 가드 삽입(시그니처에 `myEpoch` 파라미터 추가, 재귀도 전달). 턴 교대 후 잔여 setTimeout 체인이 상대 턴에 MOVE_TILE를 침범하던 결함 차단. export 목록 불변. (#9, LOW)
- 신규 회귀 RUMMI-023~032 + RUMMI-026b. smoke 113 → **138/138 PASS**.
- 신규 QA 스위트 `qa-pass3-attack`(48/48 능동 공격) + `qa-pass3-parity`(12/12 서버-클라 정합).

### 변경
- **첫 등판 전 보드 격리** — `game.js::moveTile` + `computeInitialMeldScore`. `!state.played[by]`이면 본인이 이번 턴 손에서 낸 타일(`turnSnapshot.hands[by]` 포함)로만 set→set 이동 허용, 기존 보드 타일 결합 차단. computeInitialMeldScore는 기존 보드 타일이 섞인 세트의 점수 기여를 0으로 처리(방어선 2중화). 첫 등판 30점 오염 차단. (#2, HIGH)
- **런 점수 순서 독립 계산** — `game.js::computeInitialMeldScore`, `public/js/game.js::computeFreshMeldScore`. 기존 `total += start + i`(배열 인덱스 기준)를 폐기. `[start..end] − {숫자타일 numbers}`로 빠진 슬롯 집합을 구해, 숫자 타일은 자기 number, 조커는 세트 내 등장 순서대로 빠진 슬롯을 오름차순 배정. 서버는 `addedIndices.sort` 후 순회, 클라는 jokerCountInSet 카운터로 fresh 조커만 산정 — 양쪽 동일 결과. 예: 런 `[6,7,8,5]`=26, 조커 인덱스0=빠진슬롯5(=15), 조커 2장=[4,5]배정(=18). (#3, MED)
- **조커 회수 등판 후 + 정확 검증** — `game.js::swapJoker`, `public/js/game.js::inferJokerReplacement`, `public/js/main.js::tryStartJokerSwap`. swapJoker 상단에 `!state.played[by]` 거부 가드. 1차 정확 검증 추가 — 그룹: 같은 숫자 + 세트에 없는 색 / 런: 같은 색 + 빠진 슬롯 숫자 중 하나(기존 candidateTiles/validateSet 블록은 보조 안전망 유지). `findRunStart`를 헬퍼 섹션 상단으로 이동(시그니처 불변). 클라 inferJokerReplacement는 인덱스(`start + jokerIndex`)→빠진 슬롯 집합 + jokersBeforeThis 카운트 기준으로 교체, tryStartJokerSwap은 미등판 시 토스트 후 차단. (#4, MED)
- **클라 boardChanged 재배치 감지** — `public/js/main.js`. 상태 변수 `turnStartBoardSig`(Map) 추가, 턴/게임/화면 시작 시 비어있지 않은 세트의 `setId → tiles.join(',')` 캡처. boardChanged는 fresh>0 / 빈 세트 / 세트 수 변화 / 시그니처 불일치(순서 포함)를 모두 변경으로 판정 — 서버 `boardsEqualIgnoringEmpty`와 동등. renderActionBar 직후 손 미사용 변경(재배치만) 시 등판 전/후로 분기된 경고 힌트 텍스트를 덮어씀. (#5, MED)
- **이탈 후 ready 리셋** — `server.js::ws.on('close')`. players 필터링 직후 잔류 플레이어 전원 `ready=false; rematchReady=false`로 리셋. 재접속 시 한 명만 READY로 자동 게임 시작되던 문제 차단. (#7, LOW)

### 수정
- **같은 세트 내 오른쪽 이동 off-by-one** — `game.js::moveTile` mutation 단계. `toSet === fromSet && insertIdx > fromSetIdx`이면 `insertIdx -= 1` 보정(from splice로 인덱스가 당겨지는 것 보정). from이 hand면 fromSet=null이라 보정 없음. 결과: `[a,b,c,d]`에서 a→idx2 = `[b,a,c,d]`. (#6, LOW)
- **[QA-ISSUE-1] 같은 세트 끝 슬롯 이동 이중 차감** — `game.js::moveTile`. 같은 세트 내 `to.index = 이동 전 length`(우측 끝)로 이동 시, from splice로 줄어든 `toSet.tiles.length` 기준 bounds-check와 #6 보정이 이중 차감되어 타일이 한 칸 못 미치던 결함(`[a,b,c,d]` a→idx4 기대 `[b,c,d,a]` vs 실제 `[b,c,a,d]`). bounds-check를 `preLen`(splice 전 길이) 기준으로 수정. run 검증·점수는 순서 독립이라 게임 로직·승패 무영향이었던 순수 시각 결함. 회귀 RUMMI-032 추가. (QA 능동 공격 발견, 메인 오케스트레이터 즉시 수정)

### 참고
- 스펙: `.claude/specs/2026-06-11-rummikub-rule-fixes-spec.md`
- 리포트: `.claude/specs/2026-06-11-rummikub-rule-fixes-impl-report.md`
- QA: `.claude/specs/2026-06-11-rummikub-rule-fixes-qa-report.md`
- AD3: `.claude/specs/2026-06-11-rummikub-rule-fixes-ad3-review.md` (APPROVED)
- 테스트: smoke 138/138 + qa-pass3-attack 48/48 + qa-pass3-parity 12/12 + qa-pass2(edge 46/fuzz 14/rematch 8/disconnect 28/client-static 24) + qa-edge 118/118 + qa-followup 7/7 + bot-vs-bot 3판 완주. 구식 단정 테스트 5건 갱신(STATIC-C2-3, STATIC-C4, INT-006, STATIC-019, QA-ISSUE-1 케이스).

## 2026-06-10 — QA 버그 수정 (HIGH 1 + MED 2, qa-edge 118/118 + qa-followup 7/7)

- **HIGH-1 fix (`game.js::moveTile` 트랜잭션 일관성)**: from을 splice로 제거하기 전에 to 라우팅(잘못된 kind / 없는 setId)을 먼저 dry-run으로 검증한다. 양쪽 검증을 모두 통과한 후에만 실제 mutation을 수행 → 타일 영구 유실 클래스 차단. STATIC-006, HIGH-1 확장 1~3 모두 회귀로 봉인.
- **MED-1 fix (`game.js::endTurn` 빈 NEW_SET 카운터 우회 차단)**: `boardsEqualIgnoringEmpty` 신규 비교로 보드 변화 판정 시 빈 세트는 무시한다. 빈 NEW_SET 추가만 + END_TURN하면 실질 변화 0으로 판정 → `no_change` 분기로 `consecutivePassesAfterDeckEmpty`가 정상 증가 → 더미 빈 상태에서 라운드 종료 트리거 가능. STATIC-008 회귀로 봉인.
- **MED-2 fix (`game.js::moveTile` first-meld 후 보드→손 회수 가드 완화)**: `wasInMyHand` 가드를 `!state.played[by]` 분기 안으로 이동. 첫 등판 후엔 룰상 보드 자유 재구성이 가능하므로 보드→손 회수를 허용. END_TURN 시 invalid한 보드는 기존 롤백 메커니즘이 안전망. STATIC-018(허용) + STATIC-018b(첫 등판 전 가드 유지) 회귀로 봉인.
- 테스트: smoke 113/113 + qa-edge 118/118 + qa-followup 7/7 = **238/238 PASS**.

## 2026-06-10 — 봇 강화 (남은 한계 2건 해소, smoke 113/113)

- **봇 조커 활용**: `bot.js::enumerateCandidateSets`가 손에 조커가 있으면 그룹/런의 빈 자리를 조커로 채우는 후보를 추가 생성한다. 그룹 빈 색(2색+조커 또는 3색+조커), 런 양 끝/사이/4장(조커 2장까지) 모두 지원. 조커 1장당 1번만 사용(같은 후보 안에서 중복 방지). 첫 등판 30점 검증 시 조커 점수는 game.js와 동일하게 대체 타일 숫자로 계산.
- **봇 보드 재구성**: `bot.js::findBoardReconstruction` 신규 — 등판 후 보드 valid 세트 1개를 분해해 손 타일과 합쳐 새 세트 1개를 만든다. 분해 후 남은 세트도 valid(그룹 ≥3, 런 ≥3) + 새 세트 valid + 손 ≥1장 감소하는 조합만 채택. 500ms 시간 제한 + 깊이 제한(분해 1회). 못 찾으면 단순 확장(`findBoardExtensions`) fallback. 조커 포함 세트는 회수 흐름이 복잡해 분해 후보에서 제외(안전 회피).
- bot.js 휴리스틱 함수를 모듈로 export(`enumerateCandidateSets`, `findBoardReconstruction`, `isValidSet` 등) — smoke 단위 테스트가 휴리스틱을 직접 검증 가능. `__isMain` 가드로 import 시 WS 연결을 만들지 않음.
- 신규 smoke RUMMI-018(조커 그룹 후보 생성), RUMMI-019/019b(조커 런 사이/양 끝), RUMMI-020(보드 런 분해 + 새 그룹 생성, 손 -2), RUMMI-021(500ms 시간 제한 + null fallback), RUMMI-022(조커 포함 세트 분해 제외). 총 21건 추가, smoke **113/113 PASS** (기존 92건 회귀 무이상).

## 2026-06-10 — 신규 프로젝트 (1차 코어 완료)

- 루미큐브 LAN 1:1 신규 추가 (미니게임 천국 9번째).
- 핵심 룰 구현: 106 타일 / 손 14×2 / 그룹·런 / 첫 등판 30점 / 롤백 / 손 0장 승리.
- 서버 권위 모델: `game.js` 순수 함수 + `server.js` WS noServer 모드.
- AI 봇 (`bot.js`): 백트래킹 첫 등판 + 그리디 등판 후 (조커 미사용, 보드 재조합 미지원).
- 클라 UI: 보드(세트 박스) + 손(가로 정렬) + 클릭 선택 → 슬롯 클릭 이동.
- 효과음: Web Audio API 8종 (선택/배치/세트완성/턴종료/뽑기/승/패/버튼).
- launcher 통합: `createApp` 등록 + `games.json` 카드 추가.
- smoke 테스트: RUMMI-001~010 (룰 단위 + 봇 시나리오).

## 2026-06-10 — 한계 3건 해결 (smoke 92/92)

- **조커 회수 표준 룰**: `SWAP_JOKER { setId, jokerIndex, handTileId }` 신규 액션. 본인 손에서 조커가 대체하던 정확한 타일(런: 색+숫자, 그룹: 같은 숫자+그 세트에 없는 색)을 그 자리에 넣고 조커를 회수한다. `state.jokerReturnedThisTurn`로 추적해 END_TURN 시점에 손에 회수 조커가 남아있으면 `reason='joker_unused'`로 롤백 + 더미 1장. UI는 보드 조커 클릭 → 손에서 회수 가능한 타일 1개면 즉시 swap, 여러 개면 보라 글로우 강조 + 클릭 선택. 회수 조커는 손에서 `필수` 배지 표시.
- **봇 보드 재조합**: `bot.js`에 `findBoardExtensions` 추가 — 첫 등판 후 손 타일이 보드 valid 런 양 끝(앞/뒤 숫자) 또는 valid 그룹의 4번째 색에 즉시 붙는 경우 자동 MOVE_TILE. 조커 포함 세트는 안전 회피. 실패해도 서버 END_TURN 검증에서 롤백되므로 안전.
- **더미 빈 후 무한 루프 + 손 적은 자 승리**: `state.consecutivePassesAfterDeckEmpty` 카운터. 더미가 비고 보드 변경 없이 END_TURN 시 +1, 보드 commit 시 0 리셋. 2 도달(=양쪽 한 번씩 패스)하면 라운드 종료 → 손 타일 수 적은 자 승리, 같으면 무승부(`winner='draw'`). GAME_OVER `reason='deck_empty_pass'`.
- 신규 smoke 시나리오 RUMMI-011~017 (조커 회수 3건 + 봇 확장 valid 2건 + 라운드 종료 2건). 총 92/92 PASS, 기존 57건 회귀 무이상.
