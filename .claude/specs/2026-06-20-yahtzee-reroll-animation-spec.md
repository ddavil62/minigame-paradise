---
status: COMPLETED
completed: 2026-06-20
spec: .claude/specs/2026-06-20-yahtzee-reroll-animation-spec.md
report: .claude/specs/2026-06-20-yahtzee-reroll-animation-report.md
---

# Yahtzee 재굴림 애니메이션 미발동 버그 수정 스펙

- 날짜: 2026-06-20
- 게임: yahtzee (요트 다이스)
- 작업 디렉토리: `C:\LazySlimeStudio\minigames\yahtzee`
- 분류: `visual_change: ui` (컵 굴림 애니메이션 발동 조건 변경, 레이아웃/에셋 무변경) / `pipeline: full`

## 1. 버그 (사용자 신고)

"주사위 굴리기 해도 이미 나온 주사위가 다시 안 굴려지고 그대로 있는 문제가 여전히 있다."
→ keep(고정) 안 한 다이스인데도 재굴림 컵 애니메이션이 안 나고 이전 값 그대로 보인다.

## 2. 근본 원인 (조사 완료 — 클라 렌더 버그, 서버 game.js 무결)

`public/js/dice.js`의 컵 흔들기/드롭 애니메이션 트리거가
**"이전 프레임 대비 dice 값 변화(diceChanged)"** 였다.

```js
const diceChanged = !!prev && dice.some((v, i) => v !== prev[i]);
const rolledNow = !allZero && diceChanged;
```

keep 안 한 다이스가 우연히 직전과 **전부 동일한 면**으로 굴려지면(non-kept 전부 같은 면,
확률 1/6~1/36) `diceChanged=false → rolledNow=false`가 되어 컵 애니메이션이 **아예 미발동** →
사용자에겐 "안 굴러갔다"로 보인다. 값 자체는 서버가 새로 굴린 정상 값.

이전 YACHT-KEEP-001 수정은 `rolledNow=true` 진입 후 in-cup/drop 마스크를 `!keep` 기준으로 바꾼 것이라,
*일부* 같은 값 케이스는 고쳤지만 *전체 프레임 동일* 케이스(미진입)는 미해결로 재발("여전히").

## 3. 수정 방침 (최소)

애니메이션 트리거를 **값 변화가 아니라 굴림 이벤트(rollCount 증가)** 로 교체.
STATE에 권위적 `rollCount`(굴릴 때마다 +1, 턴 넘기면 0 리셋)가 있다.

### 3-1. `public/js/main.js`

`renderDice(...)` 호출부 opts에 `rollCount: state.rollCount` 추가.

### 3-2. `public/js/dice.js`

- 컨테이너별 직전 rollCount를 `container._lastRollCount`에 보관.
- 트리거 판정:
  ```js
  const prevRollCount = container._lastRollCount ?? 0;
  const rolledNow = !allZero && (opts.rollCount != null ? opts.rollCount > prevRollCount : diceChanged);
  ```
  `opts.rollCount`가 없으면(테스트 스텁/구 호출부) 기존 `diceChanged` 폴백 유지(방어).
- `rolledNow=true` 진입 즉시 `container._lastRollCount = opts.rollCount` 기록 →
  `onCupDone → renderAll` 재진입 시 rollCount 동일 + _lastRollCount 갱신됨 → `rolledNow=false`로
  컵 재발동/onCupDone 재등록 차단(무한 루프 방지).
- 턴 넘김으로 rollCount가 리셋(이전보다 작아짐)되면 else 분기에서 `_lastRollCount`도 따라 낮춰
  다음 턴 첫 굴림(0→1)이 정상 발동하도록 동기화. (불변/증가 케이스는 미갱신 → onCupDone·keep 토글 무영향.)
  *(구현 확정: `_lastRollCount`가 이전 턴 값으로 남으면 `1 > 3 = false`로 미발동하는 엣지를 막기 위해 else 분기 `opts.rollCount < prevRollCount` 조건으로 동기화. YACHT-KEEP-008로 검증.)*
- in-cup/drop 마스크는 이미 `!keep` 기준(YACHT-KEEP-001 수정)이라 그대로 유지.

### 3-3. 보존되는 기존 동작

- keep 토글 재렌더(`onToggle`의 drawDice): rollCount 불변 → 컵 미발동(YACHT-KEEP-004 유지).
- onCupDone 재렌더: rollCount 불변 → 컵 미발동(무한 루프 가드 유지).
- 새 턴 첫 굴림: rollCount 0→1 → 정상 발동.

## 4. 테스트

### 신규 (dice-render.test.js — 클라 렌더 회귀)

- **YACHT-KEEP-006**(핵심): rollCount 증가 + dice 값 100% 동일 재굴림 → 컵 발동(`hasCup === true`) + keep 인덱스 컵 제외 + non-keep 인덱스 컵 포함 + `_lastRollCount` 즉시 갱신. **이번 버그 직격 회귀.**
- **YACHT-KEEP-007**: rollCount 불변 재렌더(onCupDone/keep 토글) → 컵 미발동(무한 루프 방지).
- **YACHT-KEEP-008**: 턴 넘김 rollCount 0 리셋 → 첫 굴림(0→1) 정상 발동.

### 신규 (smoke.test.js — 서버 회귀 방어)

- **YACHT-012**: rollDice 다회(400회) 통계 — keep=true 인덱스 값 동결(위반 0) + keep=false 인덱스 재굴림 대상(다회 중 값 변화 발생) + rollCount 권위값(1차→1, 2차→2).

### 회귀(기존 전건 PASS 확인)

- YACHT-KEEP-001~005, YACHT-LIVE-003/004 (dice-render)
- YACHT-001~011, LIVE-001/002 (smoke)
- YACHT-BOT-001~005 (bot-smoke)

## 5. Out of Scope

- 서버 `game.js`/`bot.js` 로직 변경(무결 입증). 마스크 판정(`!keep`)도 무변경.
- 레이아웃/에셋/효과음 변경 없음.
