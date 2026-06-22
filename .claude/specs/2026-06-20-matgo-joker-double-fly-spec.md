---
status: COMPLETED
completed: 2026-06-20
spec: .claude/specs/2026-06-20-matgo-joker-double-fly-spec.md
report: .claude/specs/2026-06-20-matgo-joker-double-fly-report.md
---

# 맞고 조커 손패 fly 2~3회 중복 재생 버그 수정 스펙

- 날짜: 2026-06-20
- 대상: `minigames/matgo/public/client.js` (클라이언트 전용)
- visual_change: ui (fly 연출 횟수 — 레이아웃/에셋 변경 없음)
- pipeline: full (버그 수정)

## 1. 버그

손패에서 조커를 냈을 때(케이스 A, `joker_play`), 조커 카드가 내 captured 영역으로
날아가는 fly 애니메이션이 **1번이어야 하는데 2~3번 재생**된다.

## 2. 근본 원인 (조사 완료)

두 계층이 맞물림:

- **서버**: 손 조커(케이스 A) 제너레이터(`game.js:308-329`)가 `hand_played` +
  `turn_finished` 두 step을 yield하는데 둘 다 `g.lastAction.kind === 'joker_play'`로
  고정. `server.js`의 `shouldDeferBroadcast`(103-119)가 `joker_play`를 보류하지 않아
  hand_played에서 broadcast(STATE#1), turn_finished에서 broadcast(STATE#2),
  제너레이터 종료 후 안전망 broadcast(161-163)로 STATE#3 → 동일 `joker_play` STATE가
  2~3회 송신됨.
- **클라이언트 (핵심 결함)**: `public/client.js`의 조커 fly 등록부(약 632-635)가
  `la.kind==='joker_play' && la.player===me && la.card`만 검사하고 **`pendingFlies`
  중복/이미 처리한 액션 가드가 없다.** 바로 옆 choice srcCard 경로(645-648)는
  `const already = pendingFlies.some(...); if (!already) ...` 가드가 있는데 조커
  경로에만 누락(R8 추가 시 가드 미복사). STATE가 큐잉→flush 재렌더될 때마다 조커
  fly가 재등록되어 2~3회 재생된다.

## 3. 수정 (클라이언트 전용 — 가장 안전, 회귀 게이트 E-32와 무충돌)

`public/client.js`의 조커 fly 등록부에 **이중 가드** 추가:

1. **중복 가드** (choice 경로와 동일 패턴): `pendingFlies`에 이미 같은 카드 fly가
   있으면 재등록 안 함.
2. **이미 처리한 액션 키 가드**: fly #1 완료 후 `pendingFlies`가 비워진 뒤 큐에서
   같은 `joker_play` STATE가 재렌더될 때를 막는다. 모듈 변수
   `lastJokerFlyActionKey`를 두고, 동일 액션 키(`la.kind + '|' + la.card.id + '|' +
   la.player`)면 조커 fly 등록을 건너뛴다. 라운드 시작(`GAME_START`/`ROUND_START`)
   시 이 변수를 리셋해 다음 라운드 조커 fly가 정상 동작.

서버(game.js/server.js)는 **수정하지 않는다** — 클라 가드만으로 증상이 완전히 해소되고
더 안전하다.

### 핵심 함정 (준수)

- 가드는 `joker_play`(케이스 A)에만 적용. 케이스 B(`joker_flip`)는 건드리지 않는다.
- `_jokerFlyId`를 설정하지 않을 때 `flyTargetIds.add`와 `startFlyFromHand`가 자연
  skip되어 captured 정적 표시(R8 pi 그룹 합류)는 유지된다. fly가 1회는 반드시
  발생해야 E-32 통과.

## 4. 수용 기준

- AC-1: 손 조커 1회 플레이 시 origin='hand' fly가 정확히 **1개**만 발생.
- AC-2: 조커가 `#my-captured-zone`에 안착(fade 없음) — E-32 회귀 유지.
- AC-3: fly 게이트 회귀 E-26~E-30 유지.
- AC-4: 케이스 B(`joker_flip`)는 무영향.
- AC-5: 다음 라운드에서 조커 fly 정상 동작(액션 키 리셋).
- AC-6: 단위 테스트(score.unit/game.unit) 무회귀.

## 5. 테스트

- e2e: `node server.js --port 3013` + `e2e-scenarios.spec.js` (E-32, E-26~E-30 회귀)
- adhoc: `tests/joker-adhoc.mjs` (케이스 A 턴 유지 회귀)
- 단위: `score.unit.spec.js`, `game.unit.spec.js`
- 신규 회귀: "조커 1회 플레이 시 origin='hand' fly가 정확히 1개" 검증(가능 범위).
