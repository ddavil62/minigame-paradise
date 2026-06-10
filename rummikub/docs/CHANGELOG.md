# Rummikub — 변경 이력

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
