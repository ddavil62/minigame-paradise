---
status: COMPLETED
completed: 2026-06-28
spec: .claude/specs/2026-06-28-minigames-bugfix-3-spec.md
scope: .claude/specs/2026-06-28-minigames-bugfix-3-scope.md
---

# 변경 리포트: 재현 확정 버그 3건 수정 — codenames-duet #10 · tetris-battle #12/#13

> 작업일: 2026-06-28
> 대상: `minigames` (미니게임 천국)
> QA PASS, AD3 APPROVED(#10), 회귀 무회귀 확인

## 요약

라이브 재현으로 확정된 버그 3건을 근본 원인 수준에서 제거했다. 처리 순서는 #10(codenames-duet, 단순) → #12(tetris-battle 봇 타이밍) → #13(tetris-battle 좀비 봇, 복잡)이다.

| # | 게임 | 증상 | 수정 파일 | 검증 |
|---|------|------|----------|------|
| #10 | codenames-duet | 새 게임 시 이전 복기 점/배경 잔존 | `codenames-duet/public/client.js` | 라이브 0/0/0, AD3 APPROVED |
| #12 | tetris-battle | AI봇이 카운트다운 없이 즉시 시작(start desync) | `tetris-battle/bot.js` | 봇 첫 액션 +5168ms |
| #13 | tetris-battle | AI채우기 재진입 시 "Room is full" | `tetris-battle/server.js` | 재진입 정상 입장 |

---

## #10 codenames-duet — 새 게임에 이전 복기 점 잔존

### 근본 원인
`GAME_START` 핸들러가 복기 모드에서 카드에 부착한 DOM(`.review-cell`/`.was-revealed` 클래스, `.review-grid` 서브요소)을 정리하지 않아, 종료→복기→새 게임 시 25개 카드에 이전 복기 아티팩트가 그대로 남았다.

### 수정 (`codenames-duet/public/client.js`)
- `clearReviewArtifacts()` 헬퍼 신설: 25개 카드에서 `.review-cell`/`.was-revealed` 클래스 제거 + `.review-grid` DOM 제거 + `.my-indicator` 인라인 `display` 복원.
- `GAME_START` 핸들러와 `closeReviewBackToModal()` 양쪽에서 호출.
- `GAME_START` 경로는 `renderState(lastState)` 재호출 없이 cleanup만 수행(곧 새 게임 STATE가 서버에서 도착하므로 old state 재렌더 불필요). `closeReviewBackToModal()`의 `if (lastState) renderState(lastState)`는 "이전 게임 화면 복원" 고유 기능이므로 유지.

### 검증
- 라이브: 암살자 종료 → 복기 보기(review-cell 25 / dot 50 / assassin 6) → 새 게임 후 전부 **0**.
- 회귀: review-smoke **27/27 PASS**.
- AD3: **APPROVED** (6항목 PASS).

---

## #12 tetris-battle — AI봇이 카운트다운 없이 즉시 시작 (start desync)

### 근본 원인
`bot.js` START 핸들러가 `msg.countdown` 값을 무시하고 즉시 `scheduleNextPiece()`를 호출 → 사람 `main.js`의 `runCountdown(3)`이 t=4000ms에 `game.start()`하는 것보다 봇이 ~4초 먼저 플레이를 시작했다.

### 수정 (`tetris-battle/bot.js`)
- START 핸들러에서 `resetBot()`(보드/봉투/콤보 초기화)은 즉시 실행.
- `isRunning = true` + `scheduleNextPiece()`는 `(countdown + 1) * 1000`ms(= countdown 3 기준 4000ms) 지연 실행 → 사람 카운트다운 완료 시점과 동기화.
- `countdown` 값이 바뀌어도 공식으로 자동 추종.

### 검증
- 라이브: 봇 첫 액션이 START 후 **+5168ms**(= 4000ms 대기 + ~1168ms 첫 피스 배치 간격), 봇 로그 "START(countdown=3) → 4000ms 후 게임 루프 시작".
- 회귀: bot-smoke **11/11 PASS**, phase4-launcher PASS, phase1-ws PASS.

---

## #13 tetris-battle — AI채우기 재진입 시 "Room is full"

### 근본 원인
사람 disconnect 시 `killBotChild()`의 SIGTERM은 비동기라 봇 WS 슬롯이 `players` 배열에 좀비로 잔존 → 사람 재연결 시 정원 판정에 좀비가 포함되어 봇 미생성(대기 고착) 또는 "Room is full"이 발생했다.

### 수정 (`tetris-battle/server.js`)
- (1) 사람 ws close 시: 짝 봇 슬롯을 `players`에서 **동기 제거** + `ws.terminate()`로 즉시 TCP 종료(`killBotChild()` 병행). `terminate()`로 발화되는 봇 close 핸들러의 `players.filter`는 이미 제거된 상태라 no-op.
- (2) 사람 connection 진입부: 정원 판정 직전 `ws.readyState !== OPEN`인 **죽은(좀비) 슬롯만 선제 terminate+제거**(안전망). 살아있는 봇은 보존 — AI채우기는 봇이 먼저 접속하므로 전체 sweep은 금지(살아있는 봇까지 제거하면 안 됨).
- `import { WebSocket }` 추가(`readyState` 상수 비교용).

### 검증
- 라이브: 로비 → 테트리스 → AI채우기 → 준비 → 시작 시 "Room is full" 없이 P2 정상 입장, 상대(봇) 입장 완료.
- 회귀: bot-smoke **11/11 PASS**.

---

## 회귀 결과 (무회귀 확인)

- codenames review-smoke **27/27 PASS**
- tetris bot-smoke **11/11 PASS**, phase4-launcher PASS, phase1-ws PASS
- tetris phase3-4-qa-edge: **Q7b 1건만 FAIL** — `tetris-battle/CLAUDE.md`에 명시된 기존 baseline 결함(printBanner 정규식 비탐욕 취약성, 본 수정과 무관). 회귀 게이트 비차단.

## 제외 (재현 불가)

- **#8 yutnori 클릭**: 현재 코드에서 미재현. 2026-06-20 버그B 수정이 이미 반영됨.
- **#9 tetris 조기 패배**: 결정적 재현 실패. VANISH_ZONE 탑아웃 정상 동작 가능성.

## AD / 파이프라인

- `visual_change`: ui(#10만 해당), tetris #12/#13은 none.
- AD 모드1/2(에셋): 해당 없음(이미지 에셋 변경 0).
- AD 모드3(UI): #10 새 게임 보드에서 복기 아티팩트 0개 시각 확인 → **APPROVED**.

## 참고

- 스펙: `.claude/specs/2026-06-28-minigames-bugfix-3-spec.md`
- 스코프: `.claude/specs/2026-06-28-minigames-bugfix-3-scope.md`
</content>
</invoke>
