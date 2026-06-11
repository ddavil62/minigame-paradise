# Rummikub — 프로젝트별 작업 컨벤션

> LAN 1:1 루미큐브. Node.js + 바닐라 JS. **1차 코어 완료 + 한계 3건 해결 + 봇 강화 2건 (2026-06-10) + 룰 정합 수정 10건 (2026-06-11)**. 미니게임 천국 9번째 종목.

## 정체성

- **목적**: LAN으로 즐기는 정통 루미큐브. 106 타일(1~13×4색×2 + 조커 2) + 첫 등판 30점 + 손 0장 승리.
- **레포 관리**: lazyslimestudio 하위 폴더(`rummikub/`)로 관리.
- **기술**: Node 18+ (ESM), 순수 `node:http` + `ws` 8, 바닐라 JS + HTML/CSS (Canvas 미사용 — 타일은 DOM).
- **외부 에셋**: 0. 타일은 CSS로 직사각형 + 색깔 숫자, 효과음은 Web Audio API 동적 합성.

## 핵심 설계 원칙

1. **서버 권위** — 타일 분배·세트 검증·첫 등판 30점·승리 판정 모두 `game.js` 순수 함수.
2. **정보 비대칭** — 본인 손은 본인에게만 전체 전달, 상대는 갯수만 (`snapshotFor`).
3. **턴 단위 트랜잭션** — 턴 시작 시 `turnSnapshot` 캡처 → 도중 자유 이동 → END_TURN 시 검증 후 commit 또는 롤백.
4. **포트 충돌 자동 폴백** — 단독 실행 기본 포트 **3011**, `MAX_PORT_FALLBACK=10`.

## 디렉토리

```
rummikub/
├── game.js                  # 순수 게임 로직 (타일/세트 검증/턴/롤백)
├── server.js                # WS 서버 + createApp + 단독 실행 + 봇 spawn/kill
├── bot.js                   # AI 봇 (mode=ai 시 spawn)
├── package.json             # type: module + ws
├── playwright.config.js
├── CLAUDE.md
├── README.md
├── docs/
│   ├── PROJECT.md
│   └── CHANGELOG.md
├── public/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── main.js          # 진입점, 상호작용 라우팅
│       ├── network.js
│       ├── game.js          # 클라 상태 캐시 + 미리보기 점수
│       ├── tiles.js         # 단일 타일 DOM 생성
│       ├── board.js         # 보드 렌더 + 클릭 핸들링
│       ├── hand.js          # 손 렌더 + 클릭 핸들링
│       ├── ui.js            # HUD + 결과 + 토스트
│       └── sounds.js        # 효과음 (Web Audio)
└── tests/
    └── smoke.test.js        # RUMMI-001~032
```

## WebSocket 프로토콜

| 방향 | 메시지 | 페이로드 | 설명 |
|------|--------|---------|------|
| C→S | `JOIN` | `{ playerName? }` | 입장 |
| C→S | `READY` | `{}` | 준비 (양쪽 READY → START) |
| C→S | `NEW_SET` | `{}` | 보드에 빈 세트 추가 (빈 세트 4개 초과 시 ERROR) |
| C→S | `MOVE_TILE` | `{ from, to }` | 타일 이동 |
| C→S | `SWAP_JOKER` | `{ setId, jokerIndex, handTileId }` | 보드 조커 ↔ 본인 손의 대체 타일 교환 (첫 등판 전 시도 시 ERROR) |
| C→S | `END_TURN` | `{}` | 턴 종료(서버가 검증) |
| C→S | `REMATCH` | `{}` | 재대결 |
| S→C | `JOINED` | `{ playerId, waiting, hostUrl }` | 입장 확인 |
| S→C | `READY_STATUS` | `{ p1Ready, p2Ready }` | 준비 상태 |
| S→C | `START` | `{}` | 게임 시작 |
| S→C | `STATE` | `{ board, myHand, oppHandCount, deckSize, currentTurn, turnNumber, played, tileDict, jokerReturnedThisTurn }` | 상태 |
| S→C | `TURN_RESULT` | `{ by, committed, drewTile, reason, error }` | END_TURN 결과 (`reason`: `committed`/`no_change`/`invalid_board`/`initial_meld_short`/`joker_unused`/`no_tile_played`) |
| S→C | `GAME_OVER` | `{ winner, reason, handCounts }` | 종료 (`reason`: `empty_hand`/`deck_empty_pass`. winner=`p1`/`p2`/`draw`) |
| S→C | `OPPONENT_LEFT` / `REMATCH_STATUS` / `ERROR` | — | 기타 |

`from`/`to` 위치 형식:
- `{ kind: 'hand', tileId }`
- `{ kind: 'set', setId, tileId?, index? }`

## AI 봇

- 패턴: yahtzee/matgo/janggi와 동일 `getBotUrl` 옵션 + `child_process.spawn`.
- 진입: 대기 화면의 "🤖 AI랑 시작" 버튼 → `?mode=ai` 재접속.
- 휴리스틱:
  - **첫 등판 미완**: 손 타일에서 가능한 그룹/런 후보 열거(조커 후보 포함) → 상위 12개 중 30점 이상 조합 백트래킹 탐색.
  - **등판 후**: 그리디 — 점수 큰 순으로 중복 없이 채택. 같은 조커 ID가 두 후보에 동시 채택되지 않도록 백트래킹의 `usedIds` 검사가 보장.
  - **조커 활용 (2026-06-10 한계 해소)**: `enumerateCandidateSets`가 손 조커를 그룹 빈 색(2색+조커 / 3색+조커 / 2색+조커 2장) 또는 런 빈 자리(양 끝/사이/4장 패턴)에 끼우는 후보를 자동 생성. 점수는 game.js `validateSet`와 동일하게 대체 타일 숫자로 계산.
  - **보드 단순 확장 (2026-06-10)**: `findBoardExtensions` — 등판 후 손 타일이 보드 valid 런 양 끝(앞/뒤 숫자) 또는 그룹의 4번째 색에 정확히 들어맞으면 자동 MOVE_TILE. 조커 포함 세트는 안전 회피.
  - **보드 재구성 (2026-06-10 한계 해소)**: `findBoardReconstruction` — 보드 valid 세트 1개를 분해해(그룹은 어느 위치, 런은 양 끝) 분리 타일 + 손 타일로 새 세트 1개를 재조립. 분해 후 남은 세트 valid + 새 세트 valid + 손 ≥1장 감소 조건 만족 시 채택. 500ms 시간 제한 + 깊이 1단계. 조커 포함 세트는 분해 후보에서 제외. 못 찾으면 `findBoardExtensions` fallback.
  - 액션 시퀀스 (`applyReconstruction`): `new_set_with_tiles` 액션으로 NEW_SET → 분리 타일(`set→set`) + 손 타일(`hand→set`)을 같은 새 세트에 채움.
  - 봇 휴리스틱 실패 시 서버 END_TURN 검증에서 자동 롤백 → 더미 1장(안전망).
- 행동 지연 800~1500ms.
- GAME_OVER 시 0.5초 후 REMATCH 자동 송신.
- **테스트용 import**: `bot.js`는 `__isMain` 가드로 직접 실행 시에만 WS 연결. smoke 테스트가 `enumerateCandidateSets` / `findBoardReconstruction` / `isValidSet` 등을 모듈로 import해 단위 검증.

## 테스트 실행법

```powershell
cd C:\LazySlimeStudio\minigames\rummikub
node tests/smoke.test.js  # RUMMI-001~032
```

기대: `총 138건, PASS=138, FAIL=0` (2026-06-11 룰 정합 수정 10건 + 회귀 RUMMI-023~032 추가 후 기준).

작업 포트: 봇 시나리오는 3096 사용 (사용자 launcher 3000과 다른 게임 무영향).

## 코드 컨벤션

- **언어**: 한국어 UI + 한국어 주석/문서
- **모듈**: ES Modules
- **외부 라이브러리**: 클라 0, 서버는 ws만
- **주석**: `@fileoverview` + JSDoc + 한국어 인라인

## 변경 시 자주 깨지는 함정

| 항목 | 함정 |
|---|---|
| **턴 롤백 정확성** | `endTurn`에서 invalid/first-meld 미달 시 `restoreFromSnapshot`으로 board + hands + nextSetSeq를 완전 복구해야 한다. nextSetSeq 누락 시 다음 NEW_SET ID가 충돌. |
| **첫 등판 점수 안분** | `computeInitialMeldScore`는 본인이 이번 턴 손에서 보드로 옮긴 타일만 점수에 포함. 그룹은 sampleNumber × added 수, 런은 **순서 독립** 계산(숫자 타일은 자기 number, 조커는 빠진 슬롯 오름차순 배정 — 배열 인덱스 기준 금지). `findRunStart`가 `validateSet`의 best start와 일치해야 한다. 클라 `computeFreshMeldScore`도 동일 로직 유지. (2026-06-11 #3 fix) |
| **턴 commit 조건 = 손 감소 필수** | `endTurn`은 보드 변경이 있어도 손 타일을 1장 이상 내지 않으면(`state.hands[by].length >= snap.hands[by].length`) commit 불가 → 롤백 + 더미 1장 + `reason='no_tile_played'`. 순수 재배치만으로 commit하면 `deck_empty_pass` 패스 카운터를 무한 우회할 수 있으므로 이 가드를 제거하지 말 것. 덱 빈 상태의 no_tile_played는 `consecutivePassesAfterDeckEmpty`를 +1. (2026-06-11 #1 fix) |
| **첫 등판 전 보드 격리** | `moveTile`은 `!state.played[by]`이면 본인이 이번 턴 손에서 낸 타일(`turnSnapshot.hands[by]` 포함)로만 set→set 이동 허용. 기존 보드 타일 결합 시 첫 등판 30점이 오염되므로 차단. `computeInitialMeldScore`도 기존 보드 타일이 섞인 세트는 점수 기여 0으로 방어선 2중화. 첫 등판 후엔 가드 해제. (2026-06-11 #2 fix) |
| **조커 회수 = 등판 후 + 정확 타일** | `swapJoker`는 `!state.played[by]`이면 거부("첫 등판 후에만 가능"). 대체 타일은 그룹=같은 숫자+세트에 없는 색, 런=같은 색+빠진 슬롯 숫자 중 하나여야 함(1차 정확 검증). 클라 `inferJokerReplacement`/`tryStartJokerSwap`도 빠진 슬롯 집합 기준 + 미등판 차단으로 동기화. (2026-06-11 #4 fix) |
| **moveTile to.index는 이동 전 좌표** | 같은 세트 내 이동 시 `to.index`는 "from을 빼기 전 배열" 기준 슬롯이다. from splice 후 인덱스가 당겨지므로 `toSet === fromSet && insertIdx > fromSetIdx`이면 `insertIdx -= 1` 보정. **단 끝 슬롯(`to.index = 이동 전 length`) bounds-check는 `preLen`(splice 전 길이) 기준으로 해야 하며, splice 후 줄어든 length로 검사하면 보정과 이중 차감되어 한 칸 못 미친다.** (2026-06-11 #6 + QA-ISSUE-1 fix) |
| **빈 세트 상한** | `addNewSet`은 보드의 빈 세트(tiles 0장)가 4개 이상이면 거부(서버 ERROR). 클라 UI 스크롤 폭주 방지. 빈 세트를 채워 3개 이하로 줄면 다시 생성 가능. (2026-06-11 #8 fix) |
| **bot actionEpoch 체인 취소** | `bot.js`는 모듈 변수 `actionEpoch`로 진행 중 setTimeout 액션 체인을 무효화. `actTurn` 시작 시 +1 후 `myEpoch` 캡처, ERROR 수신·내 턴 아님 감지 시 +1. 체인 함수(`applySetsSequentially`/`applyBoardExtensions`/`applyReconstruction`) setTimeout 콜백 첫 줄에 `if (actionEpoch !== myEpoch) return;` 가드 필수. 누락 시 상대 턴에 MOVE_TILE 침범. (2026-06-11 #9 fix) |
| **fresh 타일 추적(클라)** | main.js의 freshTileIds는 STATE 도착마다 (boardNow - turnStartBoardIds) ∩ turnStartHand로 재계산. 턴 전환 감지(lastTurnKey)가 잘못되면 fresh가 누적되어 다음 턴에 잘못된 점수가 보인다. |
| **빈 세트 자동 제거** | END_TURN commit 시 + finishTurn(롤백 후) 양쪽에서 `removeEmptySets`. 안 하면 빈 세트가 계속 누적. |
| **타일 lookup** | 클라는 `state.tileDict`로 lookup. 본인 손 + 보드 타일만 전송 — 상대 손은 갯수만이라 tileDict에 없음. |
| **조커 회수 흐름** | `swapJoker`는 보드 valid 상태 + 정확한 대체 타일에서만 성공. `state.jokerReturnedThisTurn`는 매 턴 시작 시 `finishTurn`에서 초기화 + 스냅샷에 포함되어 롤백 시 함께 복원. 회수 조커가 손에 남아 END_TURN 시도 시 `reason='joker_unused'`로 롤백. |
| **deck 빈 후 패스 카운터** | `consecutivePassesAfterDeckEmpty`는 보드 변경 없이 END_TURN(=`no_change`/`invalid_board`/`initial_meld_short`/`joker_unused`) + 더미 0일 때만 +1. commit 발생 시 0 리셋. 2 도달 시 `finishTurn`이 라운드 종료 + 손 적은 자 승리(`winner='draw'` 가능, `reason='deck_empty_pass'`). |
| **moveTile 트랜잭션 일관성** | from을 splice로 제거하기 **전에** to 라우팅(잘못된 kind / 없는 setId)을 먼저 dry-run으로 검증해야 한다. 안 그러면 to가 거부될 때 from 타일이 영구 유실됨. 새 라우팅 분기 추가 시 1·2단계(검증) → 3단계(mutation) 순서를 절대 깨지 말 것. (2026-06-10 HIGH-1 fix) |
| **endTurn boardChanged 판정** | 빈 NEW_SET 추가/제거만으로 boardChanged=true 판정하면 commit 분기로 빠져 `consecutivePassesAfterDeckEmpty`가 무한 리셋된다. `boardsEqualIgnoringEmpty`로 빈 세트 무시 후 비교해야 함. 새 보드 변경 케이스 추가 시 빈 세트가 실질 변화로 잘못 카운트되지 않도록 확인. (2026-06-10 MED-1 fix) |
| **first-meld 후 보드→손 가드** | `wasInMyHand` 가드는 `!state.played[by]`일 때만 적용한다. 첫 등판 후엔 룰상 보드 자유 재구성이 가능하므로 가드 해제. 단 END_TURN 시 invalid 보드는 자동 롤백되므로 안전망 유지. 새 회수 분기 추가 시 동일 패턴 따를 것. (2026-06-10 MED-2 fix) |

## 파이프라인 적용 규칙

- 신규 프로젝트로 시작 — `visual_change: ui` 기본.
- 외부 이미지 에셋 없음 → AD1/2 생략 가능, AD3는 UI 작업 시 검수.

## Mockup Sync

- 시각이 전부 CSS/HTML이므로 `studio-mockup` 동기화 불필요.

## 참조

- 사용자 문서: `README.md`
- 현재 상태: `docs/PROJECT.md`
- 변경 이력: `docs/CHANGELOG.md`
