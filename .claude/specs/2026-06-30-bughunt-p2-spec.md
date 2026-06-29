# Feature: 버그 헌트 P2 — MED/LOW 결함 수정 + 회귀 테스트 정비 + 맞고 재헌트 계획

## 개요

버그 헌트 페이즈 2 작업 스펙. 확정 MED 결함 4건, LOW 결함(공통 phase 가드 패턴 5건 + 개별 5건), 비-baseline 회귀 FAIL 4건(stale/harness), 맞고 별도 재헌트 계획을 포함한다. HIGH 결함(P1)은 별도 작업으로 처리됨.

모든 변경은 `visual_change: none` (서버 로직/테스트만 수정, UI/에셋 변경 없음).

---

## 배경 및 동기

버그 헌터가 11종 미니게임을 격리 포트에서 적대적 검증한 결과 총 27건을 확정(P1 HIGH 결함 제외). 본 작업은 MED/LOW 결함과 stale 테스트를 정비해 세션 관리·승패 판정·phase 가드 일관성을 회복한다. 맞고는 헌터 구조화 출력 실패로 P1에 미커버됐으며, P0 null-crash 수정 적용 후 별도 적대적 재헌트를 수행한다.

---

## 우선순위 및 결함 목록

| 우선순위 | 결함 ID | 게임 | 심각도 | 분류 |
|---|---|---|---|---|
| P2-1 | TB-MED-01 | tetris-battle | MED | GAME_OVER 이중 판정 + 무승부 미처리 + 결과 플리커 |
| P2-2 | CD-MED-01 | codenames-duet | MED | 동시 승리+토큰소진 패배 오판정(판정 순서) |
| P2-3 | JG-MED-01 | janggi | MED | 재접속 복구 죽은 코드 — disconnect 시 게임 영구 소실 |
| P2-4 | OM-MED-01 | omok | MED | 봇 금수 거절 후 STATE 미브로드캐스트로 영구 정지(hang) |
| P2-5 | PHASE-LOW | 공통 5종 | LOW | 잘못된 phase에 READY/REMATCH → 재시작/리셋 (phase 가드 누락 클래스) |
| P2-6 | CD2-LOW-01 | codenames-duet | LOW | 공백만 단서 서버 검증 통과 |
| P2-7 | JG-LOW-01 | janggi | LOW | DRAW_OFFER 상대 차례 허용 (룰북 §8-7 위반) |
| P2-8 | JG-LOW-02 | janggi | LOW | 스테일메이트 미감지 — 비장군+합법수 0 시 시간패로만 해소 |
| P2-9 | YT-LOW-01 | yutnori | LOW | 3~4인 READY_STATE opponentReady 단일 상대만 반영 |
| P2-10 | CN-LOW-01 | codenames | LOW | JOIN 미수신 연결이 슬롯 점유 + 호스트로 게임 시작 가능 |
| P2-R1 | REG-DC | davinci-code | stale | smoke-test.js 구 auto-JOIN 프로토콜 기준 전체 FAIL |
| P2-R2 | REG-JG | janggi | stale | lib/_smoke_server.js 구 즉시-JOIN 프로토콜 기준 FAIL |
| P2-R3 | REG-YT | yutnori | harness | QA-RF2-002 READY_STATE 미배수로 leaked=true 오탐 |
| P2-R4 | REG-RK | rummikub | stale | STATIC-019 정규화 기능 도입 후 기대값 미갱신 |
| P2-M | MATGO | matgo | 계획 | 별도 적대적 재헌트 + P0 null-crash 수정 적용 |

---

## 구현 상세

---

### P2-1 (TB-MED-01): tetris-battle GAME_OVER 이중 판정

**근본원인**: `tetris-battle/server.js:406-421` GAME_OVER 핸들러가 `if (player.gameOver)` 송신자 자신의 중복만 차단하고, 상대가 이미 topout했는지(`players.find(opp => opp.gameOver)`) 검사를 안 함. 두 번째 GAME_OVER가 winner를 덮어써 마지막으로 죽은 쪽이 승자가 됨. 무승부(`players.every(p => p.gameOver)`) 개념 자체 없음.
결과 플리커: `main.js:188-211 onResult`가 GAME_RESULT마다 `ui.showResult+game.stop`을 재실행해 2회 호출됨.

**수정 방향**:
1. `server.js` GAME_OVER 핸들러 진입 후 `player.gameOver = true` 직전에 `players.find(opp => opp.id !== player.id && opp.gameOver)` 체크 → truthy면 무승부(`winner: null, reason: 'double_topout'`) 브로드캐스트 1회 후 break.
2. 상대 미topout 시 기존 로직(상대 승리 GAME_RESULT) 유지.
3. `main.js onResult`에 `if (this.resultShown) return; this.resultShown = true;` 가드 추가(GAME_START에서 false 리셋). 중복 showResult 차단.
4. 무승부 GAME_RESULT `winner: null`에 대한 UI 처리(`ui.showResult`) — 무승부 문구 표시.

**수정 파일**:
| 파일 | 작업 유형 | 변경 내용 |
|---|---|---|
| `tetris-battle/server.js` | 수정 | GAME_OVER 핸들러 L406-421: 상대 gameOver 체크 + 무승부 분기 추가 |
| `tetris-battle/public/js/main.js` | 수정 | onResult 중복 호출 가드 + winner=null 무승부 표시 |

**수용 기준**:
- [ ] 양쪽이 동시에 GAME_OVER 전송 시 GAME_RESULT가 1회만 브로드캐스트되고 `winner: null, reason: 'double_topout'`
- [ ] 먼저 GAME_OVER 후 나중에 GAME_OVER 시, 나중에 보낸 쪽이 패자(먼저 죽은 쪽이 승자)로 오판정하지 않음
- [ ] 단일 topout 시 기존 동작 회귀 없음 (phase3-4-qa-edge Q7b 제외 전체 PASS)
- [ ] showResult가 1회만 호출됨 (플리커 없음)

**회귀 보호**: `tetris-battle/tests/phase5-qa-edge.test.js` 또는 신규 케이스로 동시 GAME_OVER 시퀀스 커버.

---

### P2-2 (CD-MED-01): codenames-duet 동시 승리+토큰소진 패배 오판정

**근본원인**: `codenames-duet/game.js:213-226` 중립 카드 분기에서 `endTurn(state, true)`가 토큰 1→0으로 `phase='lost'`를 먼저 설정(line 268-282), 그 직후 `if(state.phase==='lost') return { lose:true }`(line 218-219)가 222-224의 승리 재검사보다 먼저 실행돼 승리를 패배로 덮음. 코드 확인: game.js line 214-226에서 정확히 이 순서로 동작함.

```
// 현재 흐름 (버그):
state.guessesLeft = 0;
endTurn(state, true);         // 토큰 1→0 → phase='lost'
if (state.phase === 'lost')   // ← 먼저 걸림
  return { lose:true };
// 승리 재검사(222-224)는 도달 불가
```

**수정 방향**:
1. `game.js` 중립 분기에서 순서 변경: `endTurn` 호출 전 또는 후에 `if (state.greenFound.p1 >= GREEN_PER_SIDE && state.greenFound.p2 >= GREEN_PER_SIDE)` 승리 조건을 **먼저** 평가하고 `phase='won'`으로 설정한 뒤 `endTurn`을 skip하거나, endTurn 후 lost 체크 전에 승리 재검사 삽입.
2. 정통 듀엣 룰: tokens 소진과 동시에 양쪽 9 도달 시 승리가 패배보다 우선.

```
// 수정 후 흐름:
state.guessesLeft = 0;
endTurn(state, true);
// 승리 우선 체크 (222-224 블록을 218-219 앞으로 이동):
if (state.greenFound.p1 >= GREEN_PER_SIDE && state.greenFound.p2 >= GREEN_PER_SIDE) {
  state.phase = 'won';
  return { ok:true, result:'neutral', win: true };
}
if (state.phase === 'lost') {
  return { ok:true, result:'neutral', lose: true };
}
```

**수정 파일**:
| 파일 | 작업 유형 | 변경 내용 |
|---|---|---|
| `codenames-duet/game.js` | 수정 | guessCard 중립 분기 판정 순서 — won 체크를 lost 체크보다 앞으로 이동 |

**수용 기준**:
- [ ] tokens=1, 양쪽 greenFound=8/8인 상태에서 마지막 토큰 소진 중립 카드 클릭 시 phase='won' 반환
- [ ] tokens>=2인 정상 케이스 회귀 없음 (review-smoke 27/27 PASS)

**회귀 보호**: 신규 단위 테스트 — tokens=1 + greenFound 8/8 상태에서 중립 카드 클릭 → result.win===true 단언.

---

### P2-3 (JG-MED-01): janggi 재접속 복구 죽은 코드

**근본원인**: `janggi/server.js:578-607` ws.on('close') 핸들러가 `players.length===0`(line 594) 분기와 `else`(line 598) 분기 **양쪽 모두** `game=null`로 세션을 파기함. `stopTickTimer()` + `clearSetupTimer()` 후 game이 null이 되므로, 재접속 복구 분기 `if (game && players.length < 2)` (line 321-344)의 `game truthy` 조건이 항상 거짓이 되어 STATE 스냅샷이 전달되지 않음. CLAUDE.md + janggi/CLAUDE.md 모두 재접속 복구를 표방하나 graceful close 경로에서는 기능 비동작.

**수정 방향**:
1. `else` 분기(1명 이상 잔류)에서 `game = null` 즉시 파기 대신, 타임아웃 기반 재접속 대기 상태로 전환. 예: `game._waitingReconnect = true`로 마킹 + 일정 시간(예: 30초) 후 `game = null` 타임아웃.
2. 재접속 connection 핸들러(line 321-344)에서 `game && players.length < 2` 조건 유효화: `_waitingReconnect` 마킹 게임이 있으면 STATE 스냅샷 전달 + `_waitingReconnect = false` 클리어.
3. 타임아웃 내 재접속 없으면 타이머 콜백에서 `game = null` 처리.
4. 단, 봇 상대 게임에서 사람 disconnect 시는 봇도 종료되므로 기존 즉시 파기 유지(봇 슬롯 동기 제거 경로 분리).

**설계 제약**: `stopTickTimer()`는 재접속 대기 중 일시 중지 후 재접속 시 재개, 또는 타임아웃 후 종료.

**수정 파일**:
| 파일 | 작업 유형 | 변경 내용 |
|---|---|---|
| `janggi/server.js` | 수정 | close 핸들러 else 분기: game 즉시 null 제거, 재접속 대기 타이머 로직 추가 |
| `janggi/server.js` | 수정 | connection 핸들러 재접속 분기: _waitingReconnect 게임에 STATE 전달 |

**수용 기준**:
- [ ] 진행 중 한쪽 ws.close() → 30초 내 같은 side로 재접속 시 STATE 스냅샷 수신 + 게임 진행 재개
- [ ] 30초 초과 재접속 시 game=null, OPPONENT_LEFT 처리
- [ ] 0명 disconnect(양쪽 모두 이탈) 시 즉시 game=null (기존 동작 유지)
- [ ] janggi 룰북 회귀 슈트 246/246 PASS

**회귀 보호**: `tests/qa-e2e.spec.js`에 신규 재접속 케이스 — ws.close()→재접속→STATE 수신 시나리오.

---

### P2-4 (OM-MED-01): omok 봇 금수 거절 후 영구 정지(hang)

**근본원인**: `omok/bot.js:120-133` ERROR 핸들러가 `lastActedFor=null`만 하고 `act()`/`chooseMove()` 재호출이나 재시도 타이머를 등록하지 않음. `act()`는 `handleState()` 내부에서만 예약되는데, 금수 거절 시 `server.js PLACE 핸들러:393-396`이 `sendTo ERROR`만 보내고 STATE 브로드캐스트를 하지 않아 봇의 재행동 트리거가 영원히 오지 않음. CLAUDE.md(omok §봇) "금수 거부(ERROR) 수신 시에도 봇이 멎지 않도록" 불변식 미구현. 추가로 `chooseMove`는 금수 회피 로직 없는 결정적 argmax라 재시도해도 동일 금수 칸 선택 → 무한 거절 루프 가능성.

**수정 방향**:
1. `bot.js` ERROR 핸들러에 재시도 로직 추가: `lastActedFor = null` 후 단기 타이머(예: 200~400ms)로 `act()` 재호출.
2. `chooseMove()`에 금수 회피 로직 추가: 이전 거절 칸을 `rejectedCells: Set`으로 기록, 점수 산출 시 rejected 칸을 점수 0으로 처리해 재시도 시 다른 칸 선택.
3. 무한 루프 방어: rejected 후보가 모든 빈 칸을 소진하면(이론상 불가하나) fallback으로 임의 빈 칸 선택.
4. `rejectedCells`는 STATE 수신 시 리셋(새 게임 상태 반영).

**수정 파일**:
| 파일 | 작업 유형 | 변경 내용 |
|---|---|---|
| `omok/bot.js` | 수정 | ERROR 핸들러: lastActedFor=null 후 act() 재시도 타이머 추가 |
| `omok/bot.js` | 수정 | chooseMove: rejectedCells Set 도입, 거절 칸 재선택 방지 |

**수용 기준**:
- [ ] 봇 차례에 금수 칸 PLACE → ERROR 수신 → 200~600ms 내 다른 칸 PLACE 재시도
- [ ] 재시도 칸이 금수가 아니면 게임 정상 진행
- [ ] 봇 smoke 14/14 PASS 유지

**회귀 보호**: `tests/bot-smoke.test.js`에 쌍삼 덫 보드 상태에서 봇이 5초 내 두 번째 PLACE를 보냄을 단언하는 케이스 추가(OMOK-BOT-005).

---

### P2-5 (PHASE-LOW): 공통 phase 가드 누락 — 5종 일괄 수정

**공통 패턴**: 게임 진행 중(또는 올바르지 않은 phase에서) READY/REMATCH/rematchReady 메시지가 재전송되면 startNewGame()/START 재브로드캐스트가 발동하는 일관성 결함. 5개 게임에서 동일 부류.

#### 5-A: tetris-battle READY phase 가드 (TB-LOW-01)

**근본원인**: `tetris-battle/server.js:311-320` READY 핸들러에 `isRoomPlaying()` 가드 없음. `player.ready`는 게임 진행 중 false 리셋이 없어 중복 READY 1건으로 `players.every(p=>p.ready)` 재성립 → START 재브로드캐스트.

**수정**: READY 핸들러 진입부에 `if (isRoomPlaying()) break;` 추가. REMATCH 경로는 `resetRoomFlags`가 이미 처리하므로 READY만 수정.

#### 5-B: yahtzee REMATCH phase 가드 (YZ-LOW-01)

**근본원인**: `yahtzee/server.js:434-451` REMATCH case가 `players.length < roomMaxPlayers` 인원 체크만 있고 `game && game.phase === 'ended'` phase 가드 없음. 진행 중 양쪽이 REMATCH 보내면 `startNewGame()` 무조건 실행.

**수정**: REMATCH 핸들러에 `if (!game || game.phase !== 'ended') { sendTo(player, {type:'ERROR', message:'게임 종료 후에만 리매치 가능합니다.'}); break; }` 추가.

#### 5-C: hanabi close 시 rematchReady 미리셋 (HN-LOW-01)

**근본원인**: `hanabi/server.js:303-319` close 핸들러가 `readySet.delete + players.filter`만 하고 생존 플레이어의 `player.rematchReady`를 리셋하지 않음. 신규 접속자가 JOIN 없이 REMATCH만 보내면 핸드셰이크 우회 가능.

**수정**: close 핸들러 else 분기(1명 잔류)에서 `for (const p of players) p.rematchReady = false;` 추가.

#### 5-D: yahtzee close 시 rematchReady 미리셋 (YZ-LOW-02)

**근본원인**: `yahtzee/server.js:473-486` close 핸들러 else 분기가 `p.ready=false`만 하고 `p.rematchReady`는 미리셋. 상대 교체 후 stale rematchReady + 신규 합류자 REMATCH 1회로 단일 동의 게임 시작 가능.

**수정**: else 분기(1명 잔류)에서 `for (const p of players) p.rematchReady = false;` 추가.

#### 5-E: omok close 시 lastGameResult + rematchPending 미리셋 (OM-LOW-01)

**근본원인**: `omok/server.js:495-505` close 핸들러 else 분기(1명 잔류)가 `game=null`과 `readySet=new Set()`만 처리하고 `lastGameResult`와 `rematchPending`을 리셋하지 않음. 0명 분기(490-494)는 리셋함 — 비대칭. 신규 합류자가 raw REMATCH 전송 시 stale lastGameResult로 REMATCH_START 발동 + 지난 게임 결과로 선공 재배정.

**수정**: else 분기(1명 잔류)에서 `lastGameResult = null; rematchPending = new Set();` 추가.

**수정 파일 요약**:
| 파일 | 작업 유형 | 변경 내용 |
|---|---|---|
| `tetris-battle/server.js` | 수정 | READY 핸들러 L311: `if (isRoomPlaying()) break;` |
| `yahtzee/server.js` | 수정 | REMATCH 핸들러 L434: `phase!=='ended'` 가드 추가 |
| `hanabi/server.js` | 수정 | close 핸들러 else 분기: `p.rematchReady=false` 리셋 |
| `yahtzee/server.js` | 수정 | close 핸들러 else 분기: `p.rematchReady=false` 리셋 |
| `omok/server.js` | 수정 | close 핸들러 else 분기: `lastGameResult=null; rematchPending=new Set()` |

**수용 기준**:
- [ ] tetris: 진행 중 중복 READY 전송 시 START 재브로드캐스트 없음
- [ ] yahtzee: 진행 중 REMATCH 전송 시 ERROR 응답, 게임 리셋 없음
- [ ] hanabi: 상대 퇴장 후 신규 접속자 REMATCH-without-JOIN에서 게임 시작 없음
- [ ] yahtzee: 상대 퇴장 후 신규 합류자 단일 REMATCH로 게임 시작 없음
- [ ] omok: 상대 퇴장 후 신규 합류자 REMATCH 시도 시 `!lastGameResult` 가드로 ERROR
- [ ] 각 게임 기존 smoke/qa 슈트 회귀 없음

---

### P2-6 (CD2-LOW-01): codenames-duet 공백 단서 통과

**근본원인**: `codenames-duet/game.js:150` `if(!word||typeof word!=='string')` 검사가 `trim()` 전에 실행되어 공백-only 문자열(' ', '\t\n')이 truthy string으로 통과됨. L155에서 `word.trim().slice(0,30)`로 ''로 확정되어 `currentClue.word=''` 브로드캐스트.

**수정**: `game.js submitClue` 검증을 `if (!word || typeof word !== 'string' || !word.trim())` 으로 변경해 trim 후 빈 문자열도 차단.

**수정 파일**:
| 파일 | 작업 유형 | 변경 내용 |
|---|---|---|
| `codenames-duet/game.js` | 수정 | submitClue L150: `!word.trim()` 조건 추가 |

**수용 기준**:
- [ ] `submitClue(state, 'p1', '   ', 1)` → ok:false 또는 ERROR 반환
- [ ] 정상 단서('단어', 'WORD') 통과 회귀 없음

---

### P2-7 (JG-LOW-01): janggi DRAW_OFFER 상대 차례 허용

**근본원인**: `janggi/lib/game.js:328-336` `applyDrawOffer()`의 'offer' 분기가 `phase==='playing'`만 검사하고 `state.turn===side` 턴 가드 없음. `janggi/server.js:527-537` DRAW_OFFER 핸들러도 턴 검사 없음. 룰북 §8-7 '자기 차례에 무승부 제안'과 불일치.

**수정**:
1. `lib/game.js applyDrawOffer` 'offer' 분기에 `if (state.turn !== side) return { ok:false, reason:'상대 차례에는 무승부 제안 불가' };` 추가.
2. 또는 `server.js` DRAW_OFFER 핸들러에서 `if (game.gameSession.state.turn !== player.side) { sendTo(player, {type:'ERROR', message:'자기 차례에만 무승부 제안 가능합니다.'}); break; }` 추가.
   - lib 단위 함수 수정이 테스트 커버리지에 유리하므로 lib에 우선 추가. server.js는 서버 레벨 가드로 보완.

**수정 파일**:
| 파일 | 작업 유형 | 변경 내용 |
|---|---|---|
| `janggi/lib/game.js` | 수정 | applyDrawOffer 'offer' 분기: `state.turn !== side` 차단 |
| `janggi/server.js` | 수정 | DRAW_OFFER 핸들러: 턴 검사 가드 추가 |

**수용 기준**:
- [ ] 상대 차례에 DRAW_OFFER 전송 → ERROR, DRAW_OFFERED 브로드캐스트 없음
- [ ] 자기 차례에 DRAW_OFFER 전송 → 정상 처리 (기존 동작 유지)
- [ ] 룰북 회귀 슈트 `rulebook-c12-procedure.spec.js` PASS

---

### P2-8 (JG-LOW-02): janggi 스테일메이트 미감지

**근본원인**: `janggi/lib/game.js:282-293` `applyMove()`가 직전 수 후 `isInCheck` 시에만 `isCheckmate` 평가. `janggi/lib/rules.js:128-135` `isCheckmate()`는 `!isInCheck`이면 즉시 false 반환 → 비장군+합법수 0(스테일메이트)은 게임 종료/무승부/패스 어디서도 처리되지 않아 오직 시간패(690tick ≈ 11.5분)로만 해소.

**수정 방향**:
1. `lib/game.js applyMove` 말미에 상대 턴(`newTurn`) 진입 전 스테일메이트 검사 추가:
   ```js
   const oppMoves = getAllLegalMoves(state.board, newTurn);
   if (oppMoves.length === 0 && !isInCheck(state.board, newTurn)) {
     // 스테일메이트 → 즉시 패 또는 무승부 (정통 판정 결정 필요)
     state.winner = currentTurn; // 수를 둔 쪽 승 (또는 'draw'로 처리)
     state.endReason = 'stalemate';
     state.phase = 'ended';
   }
   ```
2. 처리 정책 결정: 정통 판정은 스테일메이트=패(못 두는 쪽 패). `GAME_OVER` 브로드캐스트.

**수정 파일**:
| 파일 | 작업 유형 | 변경 내용 |
|---|---|---|
| `janggi/lib/game.js` | 수정 | applyMove: 스테일메이트 감지 + endReason='stalemate' 처리 |
| `janggi/server.js` | 수정 | stalemate GAME_OVER 브로드캐스트 (phase=ended 전환 시) |

**수용 기준**:
- [ ] 비장군+합법수 0 보드 상태에서 applyMove 직후 phase='ended', endReason='stalemate'
- [ ] GAME_OVER 즉시 브로드캐스트 (11.5분 대기 없음)
- [ ] 기존 장군/외통수 케이스 회귀 없음 (rulebook-c4-check.spec.js PASS)

---

### P2-9 (YT-LOW-01): yutnori 3~4인 opponentReady 단일 반영

**근본원인**: `yutnori/server.js:664-675` `broadcastReadyState()`가 `players.find(p => p.id !== me.id)`로 단 1명의 상대만 골라 `{ myReady, opponentReady }` 전송. 3~4인 방에서 나머지 상대들의 ready 상태가 누락됨. JSDoc line 662에 "N인은 playersReady 배열로 추가 전달"이 명시됐으나 미구현.

**수정 방향**:
1. `broadcastReadyState()`에 인원수 분기 추가:
   - 2인: 기존 `{ myReady, opponentReady }` 유지(하위 호환)
   - 3~4인: `playersReady: players.map(p => ({ id: p.id, ready: p.ready }))` 배열 추가 전송
2. `public/js/main.js`(또는 `network.js`)의 `READY_STATE` 핸들러에서 `playersReady` 배열 수신 시 각 플레이어별 ready 상태 표시 처리.

**수정 파일**:
| 파일 | 작업 유형 | 변경 내용 |
|---|---|---|
| `yutnori/server.js` | 수정 | broadcastReadyState: 3~4인 시 playersReady 배열 추가 전송 |
| `yutnori/public/js/main.js` 또는 `network.js` | 수정 | READY_STATE 핸들러: playersReady 배열 수신 시 UI 반영 |

**수용 기준**:
- [ ] 3인 방에서 p2 READY 후 p3의 READY_STATE에 p2 ready=true 반영
- [ ] 4인 방에서 opponentReady는 전체 상대 중 모든 prepared 상태 반영
- [ ] 2인 방 기존 동작(myReady, opponentReady) 회귀 없음
- [ ] 서버리스 회귀 342/342 PASS

---

### P2-10 (CN-LOW-01): codenames JOIN 미수신 연결 슬롯 점유

**근본원인**: `codenames/server.js:232-239` `isAllSlotsFilled()`가 team/role만 세고 `player.joined` 검사 없음. `server.js:440` `isHost`가 연결 시점 부여(JOIN 무관). `PICK_ROLE` 핸들러(server.js:496-519)에 joined 요구 없음 → JOIN 없이 슬롯 점유 + 호스트 START 가능. RULEBOOK §13-8에 non-blocker로 등재된 동일 항목이나 실재 구현 갭.

**수정 방향**:
1. `isAllSlotsFilled()` 내 추가 검사: `players.filter(p => p.joined).filter(p => p.team === slot.team && p.role === slot.role)` 로 joined 플레이어만 카운트.
2. `PICK_ROLE` 핸들러 진입부에 `if (!player.joined) { sendTo(player, {type:'ERROR', message:'입장(JOIN) 후 역할 선택 가능합니다.'}); break; }` 추가.

**수정 파일**:
| 파일 | 작업 유형 | 변경 내용 |
|---|---|---|
| `codenames/server.js` | 수정 | isAllSlotsFilled: joined 플레이어만 카운트 |
| `codenames/server.js` | 수정 | PICK_ROLE 핸들러: !player.joined 가드 추가 |

**수용 기준**:
- [ ] JOIN 없이 PICK_ROLE 전송 시 ERROR, canStart 변화 없음
- [ ] JOIN 후 PICK_ROLE → 정상 슬롯 점유 (기존 smoke 65/65 PASS)
- [ ] 정상 4인 게임 흐름 회귀 없음

---

### P2-R1 (REG-DC): davinci-code smoke-test.js stale 처리

**근본원인**: `davinci-code/smoke-test.js`가 구 auto-JOIN 프로토콜 기준(접속 직후 JOINED+STATE 자동 수신 기대). 현재 server.js는 READY 게이트 패턴(JOIN→READY→게임 시작)이라 전 항목 FAIL + 'Cannot read properties of undefined (reading phase)' 예외.

**분류**: 제품 결함 아님. 테스트가 폐기된 프로토콜 기준으로 stale.

**수정 방향**:
- 옵션 A (권장): 기존 smoke-test.js를 현행 JOIN→READY 프로토콜로 갱신.
- 옵션 B: 이미 `tests/review-smoke.mjs`(27건) + `tests/review-visual.mjs`(11건)가 실질 회귀를 커버하면 smoke-test.js를 obsolete 주석 처리 + README 갱신.

**수정 파일**:
| 파일 | 작업 유형 | 변경 내용 |
|---|---|---|
| `davinci-code/smoke-test.js` | 수정 또는 제거 | 현행 프로토콜로 갱신 또는 obsolete 처리 |

**수용 기준**:
- [ ] davinci-code 전체 회귀 슈트(review-smoke 27 + review-visual 11) PASS 유지
- [ ] smoke-test.js가 갱신된 경우: 현행 프로토콜로 전부 PASS

---

### P2-R2 (REG-JG): janggi lib/_smoke_server.js stale 처리

**근본원인**: `janggi/lib/_smoke_server.js` 19건 FAIL. 테스트가 2개 WS 연결 직후 READY 없이 GAME_START(setup_cho)/SETUP_PROMPT/MOVE를 기대하나, server.js는 `readySet.size===2` 양방향 READY 게이트 도입으로 '2인 JOIN 즉시 배치 시작' 방식을 폐기했음. 15건 PASS는 JOIN/연결 레벨 테스트.

**분류**: 제품 결함 아님. READY 게이트 변경 이후 갱신되지 않은 stale 테스트.

**수정 방향**: `_smoke_server.js`를 현행 READY 게이트 프로토콜로 갱신 (각 WS 연결 후 READY 전송 추가). janggi lib 단위 슈트(246건) + 룰북 111건은 서버 불필요라 영향 없음.

**수정 파일**:
| 파일 | 작업 유형 | 변경 내용 |
|---|---|---|
| `janggi/lib/_smoke_server.js` | 수정 | 테스트 흐름에 READY 전송 추가, 기대 시퀀스 현행 프로토콜에 맞게 갱신 |

**수용 기준**:
- [ ] `_smoke_server.js` 전체 PASS (갱신 기준)
- [ ] janggi 룰북 246건 회귀 없음

---

### P2-R3 (REG-YT): yutnori QA-RF2-002 harness drain 이슈

**근본원인**: `yutnori/tests/qa-rulefix-edge.spec.js` QA-RF2-002 '상대 턴 CHOOSE_PATH 무시' 케이스가 서버 동작은 정상인데 FAIL. 원인: 테스트 하네스의 `p2.drain('STATE')`가 STATE만 비우고 READY_STATE(JOIN/READY 핸드셰이크에서 broadcast된 4건)를 비우지 않아 `await p2.next(null, 600)`이 stale READY_STATE를 집어 `leaked=true` 오탐. 서버 제품 회귀 아님.

**수정 방향**: QA-RF2-002 케이스에서 게임 시작 후 `p2.drain(null)` (모든 타입 드레인) 또는 `p2.drain('READY_STATE')` 추가 호출로 stale READY_STATE 소진 후 검사.

**수정 파일**:
| 파일 | 작업 유형 | 변경 내용 |
|---|---|---|
| `yutnori/tests/qa-rulefix-edge.spec.js` | 수정 | QA-RF2-002: 드레인 대상 타입 확장 또는 all-drain 추가 |

**수용 기준**:
- [ ] QA-RF2-002 결정적 PASS (3/3)
- [ ] 나머지 qa-rulefix-edge 25건 회귀 없음
- [ ] 서버리스 회귀 342 전체 PASS

---

### P2-R4 (REG-RK): rummikub STATIC-019 stale 처리

**근본원인**: `rummikub/tests/qa-edge.test.js` STATIC-019 'B→보드 같은 세트 이동(순서 변경)'이 FAIL. valid 그룹 [red5, blue5, black5]에서 red5를 index 2로 이동 시 테스트는 [blue5, red5, black5]를 기대하나 실제는 [red5, blue5, black5]. 2026-06-12 추가된 `normalizeSetTiles`(valid 그룹을 COLOR_ORDER red→blue→black→orange 오름차순 정렬)가 슬롯 이동을 덮어쓰는 정상 동작. 즉 현재 결과 [red5, blue5, black5]가 의도된 정규화 결과이며 게임 결함 아님.

**분류**: 제품 결함 아님. 정규화 기능 도입으로 기대값이 바뀐 stale 테스트.

**수정 방향**: STATIC-019의 expected 값을 정규화 이후 기대값 `[red5, blue5, black5]`로 갱신하고 주석에 정규화 도입 사유 기록. 공식 슈트 smoke(150) + qa-pass4-sort(34)는 PASS이므로 회귀 없음.

**수정 파일**:
| 파일 | 작업 유형 | 변경 내용 |
|---|---|---|
| `rummikub/tests/qa-edge.test.js` | 수정 | STATIC-019 expected 값을 정규화 결과로 갱신 + 주석 |

**수용 기준**:
- [ ] STATIC-019 PASS (117→118/118)
- [ ] smoke 150 + qa-pass4-sort 34 회귀 없음

---

### P2-M (MATGO): 맞고 별도 적대적 재헌트 계획

맞고(`matgo/server.js`)는 버그 헌트 P1에서 헌터 구조화 출력 실패로 미커버됨. 아래 계획에 따라 별도 재헌트를 실행한다.

#### P0 null-crash 수정 적용

`matgo/server.js:398-408` 메시지 라우터가 동일한 취약 패턴을 보유한다:
```js
// 현재 (취약):
try {
  msg = JSON.parse(data.toString());
} catch (e) { return; }
switch (msg.type) {  // ← msg===null 시 null.type 크래시
```

P1 HIGH 수정 항목으로 모든 게임 서버에 `msg === null || typeof msg !== 'object'` 가드가 적용된 경우, 맞고도 동일 수정 적용 대상임을 명시 확인한다. P1 코더가 공통 패턴으로 처리했다면 이 항목은 이미 완료. P1 리포트 확인 후 미적용 시 여기서 보완.

#### 맞고 적대적 재헌트 범위

헌터는 다음 벡터를 격리 포트(3013 또는 3013xx)에서 검증한다:

1. **null-crash 재현 확인**: P0 수정 후 WS 'null' 전송 → 서버 생존 여부.
2. **재접속/playerId 중복**: matgo server.js가 playerId를 length 기반으로 배정하는지 확인. 유사 버그(다른 게임의 HIGH) 미수정 시 여기서 발견.
3. **룰 결함 탐색**: matgo는 복잡한 룰(사통/쓸/조커/폭탄)을 가져 오판정 경계가 많음. 특히:
   - 뻑 풀이 상황에서 자뻑 2피 / 타인 뻑 1피 판정 정합
   - 조커 케이스 A 턴 유지 후 보너스 뒤집기 상태 정합
   - 라운드 종료 조건(`finishTurn`의 한쪽 0+상대 credit=0)의 엣지
   - 점수 계산(박/고배수/첫뻑) 경계 케이스
4. **입력검증**: 잘못된 카드 ID, 비자기 차례 액션, 존재하지 않는 phase 전환 등.
5. **세션 관리**: disconnect 후 재접속, 정원 초과, rematch 플래그 잔류.

#### 재헌트 실행 방법

- 격리 포트 및 결정적 재현 스크립트 사용 (P1 검증 패턴 동일)
- 발견 결함은 severity 분류 후 P3 스펙으로 별도 발주
- 재헌트 결과 없음(무결) 시에도 검증 완료 리포트 작성

---

## 수용 기준 (전체 P2)

- [ ] MED 4건 수정 후 각 해당 슈트 PASS
- [ ] LOW phase 가드 5건: 진행 중 잘못된 phase 메시지에 ERROR 또는 무시, 재시작/리셋 없음
- [ ] LOW 개별 5건: 각 수용 기준 달성
- [ ] stale/harness 4건: 갱신 후 PASS
- [ ] 수정 범위에 포함된 게임의 기존 전체 슈트 회귀 없음:
  - tetris-battle: 9 슈트 343/344 PASS (Q7b baseline FAIL 제외)
  - codenames-duet: review-smoke 27 + review-visual 11 PASS
  - janggi: 룰북 246 + 단위 135 PASS
  - omok: 210/210 PASS
  - yahtzee: 249/249 PASS
  - hanabi: 61/61 PASS
  - yutnori: 서버리스 342 PASS
  - rummikub: smoke 150 + qa-pass4-sort 34 PASS
  - codenames: smoke 65 + E2E 12 PASS

---

## 범위 경계 (Out of Scope)

- P1 HIGH 결함 수정 (별도 작업 — 이미 완료 예정)
- tetris-battle Q7b 테스트 정규식 보정 (기존 baseline 결함, 별도 이슈)
- 맞고 재헌트에서 발견될 P3 신규 결함 (별도 스펙 발주)
- davinci-code HIGH 결함 3건 (다빈치 코드는 별도 P2b 또는 P3로 분리 가능)
- janggi 재접속 타임아웃 UX (30초 대기 UI 알림 등 — 서버 로직만 수정)
- yutnori 3~4인 N인 지원 전체 UX (opponentReady 표시만 수정, 분기 UI는 별도)
- AI 강화 (omok 봇 금수 회피가 1수 미니맥스로의 업그레이드는 Out of Scope, 재시도 로직만)

---

## Art Director 실행 계획

- visual_change: none
- AD 모드 1 (에셋 컨셉): 해당 없음 — 서버 로직/테스트만 수정, 에셋 생성 없음
- AD 모드 2 (에셋 검증): 해당 없음
- AD 모드 3 (UI 레이아웃): 해당 없음 — UI 변경 없음 (yutnori opponentReady도 기존 DOM 요소에 데이터만 추가)
- 멀티 페이즈 시 AD 반복 계획: 전 페이즈 AD 해당 없음 (visual_change: none 일관)

---

## 제약사항

- 각 게임의 기존 회귀 슈트를 수정/삭제하지 않는다. stale 항목은 갱신 또는 주석 처리로만 처리.
- janggi 재접속 수정 시 반드시 봇 대전 경로(사람 disconnect → 봇 즉시 terminate)와 분리해야 한다.
- omok 봇 수정 시 기존 금수 검사(`checkDoubleThree`, `checkDoubleFour`)를 변경하지 않는다. chooseMove 레벨에서만 방어.
- codenames LOW 수정은 기존 role_select 흐름(isAllSlotsFilled 정상 케이스)을 전혀 깨면 안 된다.
- 공통 phase 가드(P2-5) 5건은 각각 독립적으로 수정 가능하나, yahtzee는 server.js 단일 파일에 2건(5-B + 5-D)이 있어 동시 수정한다.

---

## 참고사항

- 버그 헌트 findings 원본: `C:/Users/홍선표/AppData/Local/Temp/claude/C--LazySlimeStudio/2fd77b60-9444-4f73-8070-fcf778a2c4c7/tasks/bughunt-findings.md`
- P1 HIGH 결함 스펙: 별도 파일 (tetris-battle #1/yutnori #1/#2/davinci-code #1/#2/#3/janggi #1/hanabi #1/codenames #1/rummikub #1 포함)
- P0 공통 null-crash 수정: 모든 게임 `ws.on('message')` 핸들러에 `if (msg === null || typeof msg !== 'object') return;` 가드 — P1 적용 범위 확인 후 matgo 적용 여부 결정
- codenames-duet #3 수정은 HIGH 버그(#1 더블 크레딧)와 연동된 경계 케이스이나 판정 순서 자체는 독립 결함
- janggi 스테일메이트(P2-8) 정책: 못 두는 쪽 패. 표준 장기 룰은 스테일메이트를 패로 처리하나, 룰북 §13에 기록된 기존 차이 항목이 아니므로 버그로 수정 대상
- yutnori broadcastReadyState JSDoc이 N인 playersReady를 명시했으나 미구현 — 단순 누락(dead doc)이 아닌 의도된 미완성 기능으로 이번에 완성
