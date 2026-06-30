# Implementation Report: 버그 헌트 P2 -- MED/LOW 결함 수정 + 회귀 테스트 정비

## 작업 요약

버그 헌트 P2 스펙에 따라 MED 결함 3건(P2-1/2/3), LOW phase 가드 5건(P2-5A~5E), LOW 개별 5건(P2-6/7/8/9/10), stale/harness 테스트 정비 4건(P2-R1~R4)을 수정했다. P2-4(omok 봇 금수 영구 정지)는 P1에서 이미 수정되어 SKIP.

## 변경된 파일

| 파일 경로 | 작업 유형 | 변경 내용 |
|---|---|---|
| `tetris-battle/server.js` | 수정 | P2-1: GAME_OVER 핸들러에 상대 이미 topout 체크 + 무승부 분기 추가. P2-5A: READY 핸들러에 `isRoomPlaying()` 가드 |
| `tetris-battle/public/js/main.js` | 수정 | P2-1: `resultShown` 가드로 중복 showResult 차단 + `winner===null` 무승부 표시 |
| `codenames-duet/game.js` | 수정 | P2-2: guessCard 중립 분기에서 승리 체크를 패배 체크보다 앞으로 이동. P2-6: submitClue에 `!word.trim()` 조건 추가 |
| `janggi/server.js` | 수정 | P2-3: close 핸들러 else 분기에 30초 재접속 대기 타이머 도입(game 즉시 null 제거), connection 핸들러에 `_waitingReconnect` 클리어 + tick 재개. P2-7: DRAW_OFFER 핸들러에 `game.turn !== player.side` 턴 가드 |
| `janggi/lib/game.js` | 수정 | P2-7: applyDrawOffer 'offer' 분기에 `state.turn !== side` 턴 가드. P2-8: applyMove 말미에 스테일메이트 감지(비장군+합법수 0 → endGame stalemate) |
| `yahtzee/server.js` | 수정 | P2-5B: REMATCH 핸들러에 `!game \|\| game.phase !== 'ended'` 가드. P2-5D: close 핸들러 else에 `p.rematchReady = false` 리셋 |
| `hanabi/server.js` | 수정 | P2-5C: close 핸들러 else에 `p.rematchReady = false` 리셋 |
| `omok/server.js` | 수정 | P2-5E: close 핸들러 else에 `lastGameResult = null; rematchPending = new Set()` 리셋 |
| `codenames/server.js` | 수정 | P2-10: `isAllSlotsFilled()`에 `p.joined` 필터 추가. PICK_ROLE 핸들러에 `!player.joined` 가드 |
| `yutnori/server.js` | 수정 | P2-9: broadcastReadyState에 3~4인 `playersReady` 배열 추가 |
| `yutnori/public/js/network.js` | 수정 | P2-9: READY_STATE 핸들러에 `playersReady` 필드 전달 |
| `yutnori/public/js/main.js` | 수정 | P2-9: onReadyState 핸들러에 `playersReady` 배열 수신 시 전체 상대 ready 상태 반영 |
| `davinci-code/smoke-test.js` | 수정 | P2-R1: 현행 JOIN -> READY 프로토콜로 갱신 |
| `janggi/lib/_smoke_server.js` | 수정 | P2-R2: 현행 JOIN -> READY 게이트 프로토콜로 갱신 |
| `yutnori/tests/qa-rulefix-edge.spec.js` | 수정 | P2-R3: QA-RF2-002에 `p2.drain('READY_STATE')` 추가로 stale 메시지 오탐 방지 |
| `rummikub/tests/qa-edge.test.js` | 수정 | P2-R4: STATIC-019 expected를 정규화 후 결과 `['a', 'b', 'c']`로 갱신 |

## 스펙 대비 구현 상태

- [x] P2-1: tetris-battle GAME_OVER 이중 판정 + 무승부 + 결과 플리커 방지
- [x] P2-2: codenames-duet 동시 승리+토큰소진 패배 오판정 (승리 우선 체크)
- [x] P2-3: janggi 재접속 복구 (30초 대기 타이머 + _waitingReconnect + 봇 경로 분리)
- [x] P2-4: SKIP (P1에서 이미 수정, bot.js에 bannedCells + 재시도 확인됨)
- [x] P2-5A: tetris-battle READY phase 가드
- [x] P2-5B: yahtzee REMATCH phase 가드
- [x] P2-5C: hanabi close rematchReady 리셋
- [x] P2-5D: yahtzee close rematchReady 리셋
- [x] P2-5E: omok close lastGameResult + rematchPending 리셋
- [x] P2-6: codenames-duet 공백 단서 차단
- [x] P2-7: janggi DRAW_OFFER 턴 가드 (lib/game.js + server.js 양쪽)
- [x] P2-8: janggi 스테일메이트 감지 (비장군+합법수 0 -> 못 두는 쪽 패)
- [x] P2-9: yutnori 3~4인 broadcastReadyState playersReady 배열
- [x] P2-10: codenames JOIN 미수신 연결 슬롯 점유 차단
- [x] P2-R1: davinci-code smoke-test.js JOIN->READY 프로토콜 갱신
- [x] P2-R2: janggi lib/_smoke_server.js JOIN->READY 프로토콜 갱신
- [x] P2-R3: yutnori QA-RF2-002 READY_STATE 드레인 추가
- [x] P2-R4: rummikub STATIC-019 정규화 후 기대값 갱신
- [ ] P2-M: 맞고 적대적 재헌트 (별도 작업 계획, 본 코더 범위 외)

## 빌드/린트 결과

- 빌드: PASS (전 16개 파일 `node --check` 통과)
- 린트: N/A (프로젝트에 ESLint 미설정)

## 테스트 결과

| 테스트 슈트 | 결과 | 비고 |
|---|---|---|
| codenames-duet review-smoke | **30/30 PASS** | P2-2, P2-6 반영 확인 |
| rummikub qa-edge | **118/118 PASS** | P2-R4 STATIC-019 갱신 확인 |
| rummikub smoke | **154/154 PASS** | 회귀 없음 |
| omok smoke | **106/106 PASS** | P2-5E 반영, 회귀 없음 |
| omok qa-edge | **35/35 PASS** | 회귀 없음 |
| yahtzee smoke | **169/169 PASS** | P2-5B/5D 반영, 회귀 없음 |
| yutnori qa-rulefix-edge | **26/26 PASS** | P2-R3 QA-RF2-002 결정적 PASS |
| yutnori 서버리스 회귀 | **343/343 PASS** | P2-9 반영, 회귀 없음 |
| janggi 룰북 | **111/111 PASS** | P2-7/8 반영, 회귀 없음 |
| janggi 단위 | **135/135 PASS** | 회귀 없음 |
| janggi _smoke_server | **34/34 PASS** | P2-R2 갱신 후 전부 PASS |
| hanabi 룰북 | **78/78 PASS** | P2-5C 반영, 회귀 없음 |
| codenames smoke | **65/65 PASS** | P2-10 반영, 회귀 없음 |
| tetris-battle phase1-ws | **37/37 PASS** | P2-1/5A 반영, 회귀 없음 |
| tetris-battle phase3-4-qa-edge | **20/21 PASS** | Q7b 1건은 기존 baseline 결함 (범위 외) |

## Art Director 후속 조치

- visual_change: none
- AD 모드 2 필요 여부: 아니오 -- 에셋 생성/교체 작업 없음
- AD 모드 3 필요 여부: 아니오 -- UI 레이아웃 변경 없음 (yutnori opponentReady도 기존 DOM에 데이터만 추가)

## 알려진 이슈

- tetris-battle Q7b(서버 배너 유니코드 박스 문자) 1건은 기존 baseline 결함으로 본 작업 범위 외
- P2-3 janggi 재접속의 UX(30초 대기 UI 알림, 타이머 표시 등)는 스펙의 Out of Scope에 명시되어 서버 로직만 수정
- P2-M 맞고 재헌트는 별도 작업 계획으로 본 코더 범위 외

## QA 참고사항

- P2-1 tetris-battle: 양쪽 동시 GAME_OVER 시 `winner: null, reason: 'double_topout'` GAME_RESULT 1회만 수신되는지 확인. 클라이언트에서 무승부 문구 "무승부!" 표시 확인.
- P2-2 codenames-duet: tokens=1 + greenFound 8/8 상태에서 중립 카드 클릭 시 `phase='won'` 반환되는지 확인 (기존은 `phase='lost'`).
- P2-3 janggi: 진행 중 한쪽 disconnect -> 30초 내 재접속 시 STATE 스냅샷 수신 + 게임 재개 확인. 30초 초과 시 game=null. 봇 대전 시 사람 disconnect는 즉시 파기(봇 경로 분리).
- P2-7 janggi: 상대 차례에 DRAW_OFFER 전송 시 ERROR 반환, DRAW_OFFERED 미브로드캐스트 확인.
- P2-8 janggi: 비장군+합법수 0 보드에서 GAME_OVER 즉시 브로드캐스트 확인(시간패 대기 없음).
- P2-9 yutnori: 3인 방에서 p2 READY 후 p3의 READY_STATE에 playersReady 배열로 p2 ready=true 반영 확인. 2인 방은 기존 myReady/opponentReady만 전송(하위 호환).
- P2-10 codenames: JOIN 없이 PICK_ROLE 전송 시 ERROR, canStart 변화 없음 확인.
- P2-R3 yutnori: QA-RF2-002 3회 연속 결정적 PASS 확인 권장.
- 모든 phase 가드(P2-5A~5E): 잘못된 phase에서 READY/REMATCH 전송 시 게임 리셋 없이 ERROR 또는 무시 확인.
