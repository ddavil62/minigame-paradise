# Spec: 테트리스 배틀 AI 봇 미니맵(상대 보드) 미표시 버그 수정

- 날짜: 2026-06-21
- 프로젝트: `tetris-battle` (minigame-paradise)
- 분류: bugfix / `visual_change: none` (순수 봇 백엔드 데이터 — 봇 송신 페이로드 한 줄, UI/CSS/Canvas 무변경)
- pipeline: quick (단일 버그 수정 + 회귀 테스트 + 문서)

## 1. 증상

AI 대전(`?mode=ai`) 시 화면 우측의 **상대(봇) 보드 미니맵이 비어 보인다**. 봇이 실제로는 피스를
배치하며 게임을 진행하는데도 사람 화면의 상대 미니맵에는 아무 막대도 차오르지 않는다.
사람 대 사람(human) 대전에서는 정상 — 즉 봇 경로 한정 결함.

## 2. 근본 원인

미니맵 동기화 경로는 다음과 같다.

```
(보드 소유자) BOARD_STATE { height, stack }  →  server.js  →  OPPONENT_BOARD { height, stack }  →  (상대) ui.js renderOpponent → 컬럼 막대 렌더
```

- 사람 클라(`public/js/game.js` → `public/js/board.js getColumnHeights`)는 `stack`에
  **컬럼별 visible 높이 배열**(길이 `BOARD_WIDTH=10`, 각 값 `0~VISIBLE_HEIGHT=20`)을 실어 보낸다.
- `server.js`의 `BOARD_STATE` 케이스는 그 `stack`을 그대로 `OPPONENT_BOARD`로 중계한다.
- `ui.js renderOpponent`는 받은 `stack[c]`로 컬럼 c의 막대 높이를 그린다.
- **봇(`bot.js`)은 `BOARD_STATE`를 보내긴 했으나 `stack: []`(빈 배열)로 보냈다.**
  → 상대 미니맵에 그릴 컬럼 높이 데이터가 없어 빈 화면으로 보였다.

즉 서버/UI는 정상이고, 봇이 미니맵용 페이로드를 빈 배열로 보낸 것이 단일 원인이다.

## 3. 수정

`bot.js`에 `board.js`와 **동일 포맷**의 `getColumnHeights(grid)`를 추가하고, `BOARD_STATE`
송신을 실제 컬럼 높이 배열로 변경한다.

### getColumnHeights (board.js와 동일 포맷)

```js
function getColumnHeights(grid) {
  const heights = new Array(BOARD_WIDTH).fill(0);
  for (let c = 0; c < BOARD_WIDTH; c++) {
    for (let r = VANISH_ZONE; r < BOARD_HEIGHT; r++) {
      if (grid[r][c] !== 0) {
        heights[c] = BOARD_HEIGHT - r;   // visible 높이
        break;
      }
    }
  }
  return heights;
}
```

- `VANISH_ZONE`(2)부터 스캔 → hidden zone 왜곡 방지, 값 범위 0~VISIBLE_HEIGHT(20).
- `public/js/board.js`의 `getColumnHeights`와 스캔 범위·환산식·반환 형태가 **완전히 일치**.

### BOARD_STATE 송신

```js
const stack = getColumnHeights(botGrid);
const height = stack.length ? Math.max(...stack) : 0;
send({ type: 'BOARD_STATE', height, stack });   // 이전: stack: []
```

## 4. 변경 파일

| 파일 | 변경 |
|---|---|
| `tetris-battle/bot.js` | `getColumnHeights(grid)` 추가, `BOARD_STATE` 송신을 `stack: []` → 실제 컬럼 높이 배열로 변경 (※ 이미 적용·검증 완료, 본 작업에서 재변경 없음) |
| `tetris-battle/tests/bot-smoke.test.js` | 회귀 게이트 **TBOT-006** 추가 (미니맵 stack 단언) |
| `tetris-battle/CLAUDE.md` | "변경 시 자주 깨지는 함정" 표에 봇 미니맵 동기화 1행 추가 |

## 5. 회귀 게이트 (TBOT-006)

봇이 OPPONENT_BOARD로 중계되는 `stack`이 **컬럼 높이 배열**임을 단언한다.

- `stack`이 배열로 도착한다 (Array.isArray).
- `stack.length === BOARD_WIDTH(10)`.
- 봇이 피스를 충분히 쌓은 뒤(최대 30s 폴링) `stack`에 **0 초과 값이 1개 이상** 존재한다.

`stack: []` 회귀가 되살아나면 길이/비어있음 단언이 즉시 FAIL → 미니맵 빈 화면 결함 영구 차단.

## 6. 검증

- 실 브라우저(Playwright): AI 게임 시작 후 `#opponent-canvas`가 시간에 따라 갱신(changedOverTime=true)
  + 아래쪽이 위쪽보다 밝음(컬럼 막대가 바닥부터 차오르는 정상 미니맵).
- `bot-smoke.test.js`: 기존 TBOT-001~005 유지 + 신규 TBOT-006 = **11/11 PASS**.
- 게이트 유효성: 일시적으로 `stack: []`로 되돌리면 TBOT-006 길이/비어있음 단언 2건 FAIL(9 PASS / 2 FAIL) → 즉시 원복.
- 회귀 9 슈트: phase3-4-qa-edge **Q7b(문서화된 baseline 결함)만** FAIL, 나머지 전부 PASS 유지.

## 7. 함정 메모

- 봇은 클라이언트 권위 구조라 서버 STATE를 받지 않고 **독자 엔진**을 돌린다. 미니맵 데이터도
  봇이 스스로 산출해야 하며, `board.js`의 `getColumnHeights`와 **포맷이 일치**해야 한다
  (길이 BOARD_WIDTH, VANISH_ZONE부터 스캔, `BOARD_HEIGHT - r` 환산).
- `BOARD_HEIGHT(22)`와 `VISIBLE_HEIGHT(20)` 혼동 금지 — 스캔은 `VANISH_ZONE`부터, 환산은 `BOARD_HEIGHT - r`.
- 두 소스 상수(`BOARD_WIDTH`/`VANISH_ZONE`)가 바뀌면 봇 인라인 복사본도 함께 수정.
