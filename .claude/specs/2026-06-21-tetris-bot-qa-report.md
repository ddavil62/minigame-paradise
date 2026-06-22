# QA Report: 테트리스 배틀 AI 봇 추가

- **대상 스펙**: `.claude/specs/2026-06-21-tetris-bot-spec.md`
- **구현 리포트**: `.claude/specs/2026-06-21-tetris-bot-report.md`
- **검증 게임**: `tetris-battle` (LAN 1:1, 클라이언트 권위 구조)
- **검증일**: 2026-06-21
- **회귀 게이트 실행 포트**: `3055` (격리), 신규 봇 smoke 포트 `3110`
- **종합 판정**: **QA PASS — blocker 0**

---

## 1. 검증 범위

테트리스 배틀에 추가된 단독 AI 봇 대전 모드를 검증했다. 봇은 서버 STATE를 수신하지 않고 **독자 테트리스 엔진을 내장**해 보드를 시뮬레이션하며, 라인 클리어 시에만 `GARBAGE_SEND`를 서버로 전송하는 클라이언트 권위 특수 구조다. 따라서 회귀 무영향(기존 9개 슈트)과 봇 기능 정상 동작(독자 엔진 + WS 프로토콜)을 모두 검증 대상으로 삼았다.

검증 축:
1. **회귀 게이트** — 기존 슈트가 봇 추가로 깨지지 않는가 (스펙 「기존 회귀 슈트 절대 수정 금지」 원칙 준수 확인).
2. **신규 봇 smoke** — TBOT-001~005 (봇 spawn/배치/토프아웃/disconnect/재대결).
3. **능동 프로빙** — `bot.js` 코드 + smoke 기반으로 스펙이 식별한 함정 6건 회피와 아이템 비대칭 설계의 안정성을 직접 검증.

---

## 2. 회귀 게이트 결과 (포트 3055 격리 실행, 확정 수치)

### 2-1. 서버리스 슈트

| 슈트 | 결과 | 판정 |
|------|------|------|
| `phase1-unit.test.js` | 57 / 57 | PASS |
| `phase5-vanish-zone.test.js` | 52 / 52 | PASS |
| `phase5-qa-edge.test.js` | 71 / 71 | PASS |

### 2-2. 서버바운드 슈트 (`--port 3055`)

| 슈트 | 결과 | 판정 |
|------|------|------|
| `phase1-ws.test.js` | 37 / 37 | PASS |
| `phase2-items.test.js` | 51 / 51 | PASS |
| `phase2-edge.test.js` | 14 / 14 | PASS |
| `phase3-polish.test.js` | 14 / 14 | PASS |
| `phase4-launcher.test.js` | 20 / 20 | PASS |
| `phase3-4-qa-edge.test.js` | 20 PASS / 1 FAIL (Q7b) | **CONDITIONAL** (§3 참조) |

### 2-3. 신규 봇 smoke (포트 3110)

| 슈트 | 결과 | 판정 |
|------|------|------|
| `bot-smoke.test.js` (TBOT-001~005) | 8 / 8 | PASS |

### 2-4. 합계

> **344 PASS / 1 FAIL (Q7b)**
>
> Q7b 1건을 제외하면 회귀·신규 전부 PASS. Q7b는 봇 작업과 무관한 **기존 결함**으로 non-blocker 분류(§3).

---

## 3. Q7b 분류 — non-blocker (기존 결함, 봇 작업 무관)

### 3-1. 증상

`phase3-4-qa-edge.test.js`의 Q7b("`printBanner`가 유니코드 박스 문자를 사용하지 않아야 한다")가 FAIL. 정규식이 `server.js`에서 박스 문자 7개를 잡아냈다.

### 3-2. baseline 대조 (봇 작업 이전 git HEAD)

- baseline(git HEAD) `server.js`에서도 **동일하게** Q7b가 실패한다. printBanner 정규식이 박스 문자 7개를 잡는 매칭 줄 수(78줄)가 baseline과 변경본에서 **완전히 동일**하다.
- 즉, 이 실패는 봇 추가 전부터 존재했고, 봇 변경으로 새로 발생하거나 악화되지 않았다.

### 3-3. 근본 원인 (테스트 취약성)

- 검증 정규식 `/function printBanner[\s\S]+?\n\}/` 이 **비탐욕(non-greedy)** 이라, printBanner 함수 경계(line 600~630)를 넘어 **첫 col-0 `}`(line~677)** 까지 매칭한다.
- 그 매칭 범위 안에 들어오는 **기존 주석** `// ── 서버 시작 (Phase 4 D...) ─────`(line 632)의 유니코드 `─`가 박스 문자로 검출된다. printBanner 본문 자체의 문제가 아니라 정규식이 함수 경계를 넘어선 것이 원인이다.

### 3-4. 봇 변경과의 무관성

- 코더가 추가한 봇 섹션(`server.js` line~41 부근: `import fs` / `import { spawn }` / `spawnBotChild` / `killBotChild`)은 정규식 매칭 범위(line 600~677) **밖**이다.
- 따라서 Q7b 실패에 봇 변경이 기여한 바가 전혀 없다.

### 3-5. 미수정 사유

- 스펙 제약 「기존 회귀 슈트 절대 수정 금지」(spec L870, CLAUDE.md 회귀 게이트 원칙)에 따라 회귀 게이트 슈트를 손대지 않았다.
- 근본 보정(정규식을 printBanner 함수 경계로 한정)은 봇 작업 범위 밖이며, 별도 이슈로 분리하는 것이 옳다.

> **결론: Q7b는 봇 작업과 무관한 기존 테스트 취약성 → non-blocker. 봇 추가의 QA 게이트를 막지 않는다.**

---

## 4. 신규 봇 smoke 검증 항목별 결과 (TBOT-001~005)

| ID | 시나리오 | 검증 포인트 | 판정 |
|----|----------|------------|------|
| TBOT-001 | `mode=ai` 진입 → 봇 자동 spawn → 사람 JOINED(p1) → START 수신 | `JOINED.playerId='p1'`, `START.countdown=3` | PASS |
| TBOT-002 | 봇 피스 배치 → BOARD_STATE → 서버가 사람에게 OPPONENT_BOARD 중계 | `OPPONENT_BOARD` 수신(봇 실배치 증거) | PASS |
| TBOT-003 | 사람 GAME_OVER → 봇(p2) 승리자 GAME_RESULT | `winner='p2'`, `reason='topout'` | PASS |
| TBOT-004 | 사람 disconnect → 방 초기화 → 봇 child process 종료 | 새 접속 시 `JOINED.waiting=true`(좀비 없음) | PASS |
| TBOT-005 | 사람 REMATCH → 봇 자동 동의(500ms) → START 재수신 | `START.countdown=3` 재수신 | PASS |

> 시나리오 내 개별 단언 합계 **8/8 PASS**.

---

## 5. 능동 프로빙 — 봇 기능 직접 검증 (`bot.js` 코드 + smoke 기반)

스펙이 식별한 함정과 의도적 비대칭 설계가 실제로 안전·정확하게 구현됐는지 능동적으로 파고들었다. 전 항목 PASS.

### 5-1. 아이템 처리 (스펙 의도적 비대칭) — PASS

- `ITEM_EFFECT` 핸들러에서 `itemId === 'garbage_bomb'` 일 때만 `pendingGarbage += GARBAGE_BOMB_LINES(2)` 반영. `dark`/`freeze`는 **로그만 찍고 무시**(crash 없음).
- `ITEM_GRANT` 는 봇이 아이템 슬롯이 없어 무시(`ITEM_USE` 미발신).
- `SHIELD_BLOCK` / `OPPONENT_BOARD` / `ERROR` 핸들이 존재해 미정의 메시지에도 봇이 죽지 않는다.
- **검증 결과**: 사람이 다크/프리즈/가비지폭탄으로 봇을 교란할 수 있고(재미 보존), 봇 내부 계산은 정확히 유지되며 어떤 아이템에도 봇 프로세스가 죽지 않는다. **의도된 비대칭이 정확히 구현됨.**

### 5-2. 양방향 가비지 정합 — PASS

- 수신: `GARBAGE_RECV` → `pendingGarbage` 누적 → **다음 피스 배치 직전** `addGarbage(botGrid, pendingGarbage)`로 봇 보드 반영. hole 위치가 `board.js`와 동일.
- 송신: 봇 라인 클리어 시 `garbageFromLines + comboBonus` 결과가 > 0 일 때 `GARBAGE_SEND` 전송. smoke TBOT(OPPONENT_BOARD/송신 경로)가 입증.
- **검증 결과**: 사람↔봇 가비지 양방향이 서버 권위 슈트(`phase2-items` 51/51)와 동일 로직으로 동작.

### 5-3. VANISH_ZONE 함정 회피 — PASS

- `getStackHeight` 가 `VANISH_ZONE(2)` 부터 스캔해 0~`VISIBLE_HEIGHT` 범위를 반환 → 미니맵 높이 왜곡 없음.
- `evaluateBoard` 의 `colHeights = BOARD_HEIGHT - r` 환산이 hidden zone(상단 2줄)을 정확히 보정.
- **검증 결과**: `BOARD_HEIGHT(22)` vs `VISIBLE_HEIGHT(20)` 혼동으로 인한 봇 조기 사망·이상 배치 없음(스펙 「함정」 회피 확인).

### 5-4. botCombo 초기값 -1 함정 회피 — PASS

- 초기 `botCombo = -1`. 첫 클리어 시 `++` → 0 → `comboBonus(0) = 0`(서버 콤보 로직과 일치).
- 무클리어 또는 토프아웃 시 `-1` 로 리셋(`resetBot` 포함).
- **검증 결과**: 초기값을 0으로 잘못 두면 첫 클리어에 보너스 +1이 붙어 회귀 실패하는 함정을 정확히 회피.

### 5-5. 토프아웃 → GAME_OVER → 사람 승리 — PASS

- 봇 스폰 충돌(또는 `chooseBestPlacement` null) 시 `GAME_OVER` 전송 → 서버가 상대에게 `GAME_RESULT { winner, reason:'topout' }` 브로드캐스트.
- **검증 결과**: smoke TBOT-003 PASS(대칭 시나리오). 종료 경로 정상.

### 5-6. 재대결 상태 초기화 — PASS

- `GAME_RESULT` 후 봇이 500ms 지연 자동 `REMATCH` → `START` 재수신 시 봇 상태(`botGrid`/`pendingGarbage`/`botCombo`)를 모두 초기화.
- **검증 결과**: smoke TBOT-005 PASS. 이전 게임의 가비지/콤보 잔여가 새 게임으로 누수되지 않음.

### 5-7. disconnect 정리(좀비 없음) — PASS

- 사람(비봇) disconnect 시 `killBotChild` 가 봇 child_process 종료 + 룸 완전 초기화.
- **검증 결과**: smoke TBOT-004 PASS. 새 접속이 `waiting=true` 로 빈 방을 받음 → 봇 좀비 프로세스 잔류 없음.

### 5-8. 난이도 / 사용자 의도 부합 — PASS

- 배치 간격 `800~1200ms` 상수 + 1-look 표준 휴리스틱(2-look 미사용) → "적당히 이길 수 있는 캐주얼 상대" 의도.
- **검증 결과**: 완벽 최강 봇이 아니라 자연스러운 실수를 유발하는 캐주얼 강도로 구현됨 → 스펙 배경/동기 부합.

---

## 6. 수용 기준(AC) 대조

| AC | 내용 | 판정 | 근거 |
|----|------|------|------|
| AC-1 | 대기 화면 AI 버튼 표시, 게임 시작 후 숨김 | PASS | main.js onJoined/onStart |
| AC-2 | 버튼 클릭 → `?mode=ai` + WS 쿼리 부착 | PASS | network.aiStart/connect |
| AC-3 | 서버 `mode=ai` 감지 → 200ms 후 bot spawn | PASS | TBOT-001 |
| AC-4 | 봇 JOIN/READY → 양쪽 START countdown=3 | PASS | TBOT-001 |
| AC-5 | 봇 800~1200ms 배치 + OPPONENT_BOARD 중계 | PASS | TBOT-002 |
| AC-6 | 봇 라인 클리어 → GARBAGE_RECV 도달 | PASS | §5-2 (garbageFromLines+comboBonus 동일) |
| AC-7 | 봇 토프아웃 → GAME_RESULT(reason=topout) | PASS | TBOT-003 / §5-5 |
| AC-8 | 사람 REMATCH → 봇 0.5초 자동 동의 → START 재전송 | PASS | TBOT-005 |
| AC-9 | 사람 disconnect → 봇 child process 종료 | PASS | TBOT-004 / §5-7 |
| AC-10 | garbage_bomb 효과 → 봇 보드 가비지 2줄 | PASS | §5-1 |
| AC-11 | launcher 통합 모드 봇 spawn | PASS | getBotUrl 주입 + phase4-launcher 20/20 |
| AC-12 | 회귀 슈트 PASS 유지 | **PASS\*** | 9개 슈트 중 8개 전부 PASS + phase3-4-qa-edge는 Q7b 기존 결함 1건만(§3, 봇 무관 non-blocker) |
| AC-13 | bot-smoke TBOT-001~005 전부 PASS | PASS | 8/8 |

> AC-12는 Q7b(봇 무관·baseline 동일·기존 테스트 취약성) 1건을 제외하면 회귀 무영향이 입증되어 **PASS로 판정**한다.

---

## 7. 발견 결함 요약

| ID | 심각도 | 분류 | 봇 작업 관련 | 처리 |
|----|--------|------|-------------|------|
| Q7b | Low | 기존 테스트 취약성(printBanner 정규식 경계 초과) | **무관**(baseline 동일) | non-blocker, 별도 이슈 권장 |

- **blocker: 0건**
- **봇 작업으로 새로 유발된 결함: 0건**

---

## 8. 종합 판정

> ### QA PASS — blocker 0

- **봇 기능 정상**: spawn/배치/가비지 양방향/토프아웃/재대결/disconnect 정리 전부 정상(TBOT-001~005 8/8 PASS).
- **회귀 무영향**: 서버리스 3슈트 + 서버바운드 6슈트(phase3-4-qa-edge의 Q7b 제외) 전부 PASS. Q7b는 봇 작업 이전부터 존재한 테스트 취약성으로 baseline 동일 → non-blocker.
- **함정 6건 회피 확인**: fs import / VANISH_ZONE 높이 / botCombo -1 / connection req 파싱 / spawn 타이밍 / aiStart 노출.
- **사용자 의도 부합**: "적당히 이길 수 있는 캐주얼 상대" 난이도 + 아이템 의도적 비대칭(사람이 봇 교란 가능, 봇은 안정) 구현.

### 후속 권장

- (선택) Q7b 정규식을 `printBanner` 함수 경계로 한정하도록 보정하는 별도 이슈 발주. 봇 작업과 분리.

### Art Director 게이트 메모

- 구현 리포트 기준 `visual_change: ui` (대기 화면 "🤖 AI랑 시작" 버튼 1개 추가) → AD 모드3(UI 레이아웃) 대상. 본 QA는 기능·회귀 검증이며, AD 모드3 APPROVED 여부는 오케스트레이터 게이트에서 별도 확인 대상이다.
