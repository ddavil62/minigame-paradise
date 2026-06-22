# Implementation Report: Yahtzee 재굴림 애니메이션 미발동 버그 수정

## 작업 요약

컵 굴림 애니메이션 트리거를 "이전 프레임 대비 dice 값 변화(diceChanged)"에서 "서버 권위 rollCount 증가"로 교체했다. keep 안 한 다이스가 우연히 직전과 전부 동일한 면으로 굴려져도(확률 1/6~1/36) 이제 정상적으로 컵 애니메이션이 발동한다. 서버 `game.js`는 무결이라 무수정.

## 변경된 파일

| 파일 경로 | 작업 유형 | 변경 내용 |
|---|---|---|
| `yahtzee/public/js/main.js` | 수정 | `renderDice(...)` 호출부 opts에 `rollCount: state.rollCount` 전달 (line 277~280 근처, 주석 포함) |
| `yahtzee/public/js/dice.js` | 수정 | 트리거 판정을 `opts.rollCount > prevRollCount`로 교체(폴백 diceChanged 유지). `container._lastRollCount` 보관 — rolledNow 진입 즉시 갱신(무한 루프 방지), 턴 리셋(rollCount 감소) 시 else 분기에서 동기화 (line 125~178) |
| `yahtzee/tests/dice-render.test.js` | 수정 | 신규 회귀 YACHT-KEEP-006/007/008 추가 (42→55건) |
| `yahtzee/tests/smoke.test.js` | 수정 | 신규 서버 회귀 YACHT-012(keep 동결/재굴림 400회 통계 + rollCount 권위) 추가 (163→169건) |

### 핵심 변경 (dice.js)

```js
const prevRollCount = container._lastRollCount ?? 0;
const rolledNow = !allZero && (opts.rollCount != null ? opts.rollCount > prevRollCount : diceChanged);
...
if (rolledNow) {
  if (opts.rollCount != null) container._lastRollCount = opts.rollCount;  // 즉시 갱신 → 무한 루프 방지
  ...
} else {
  // 턴 넘김으로 rollCount 리셋(감소) 시 _lastRollCount도 낮춰 다음 턴 첫 굴림(0→1) 정상 발동
  if (opts.rollCount != null && opts.rollCount < prevRollCount) {
    container._lastRollCount = opts.rollCount;
  }
  ...
}
```

## 스펙 대비 구현 상태

- [x] main.js: `renderDice` opts에 `rollCount` 전달
- [x] dice.js: 트리거를 rollCount 증가로 교체 + `_lastRollCount` 보관(WeakMap 대신 컨테이너 프로퍼티 — 기존 `_cupTimer` 패턴과 동일)
- [x] rolledNow 진입 즉시 `_lastRollCount` 갱신(무한 루프 방지)
- [x] `opts.rollCount` 없을 시 diceChanged 폴백(테스트 스텁/구 호출부 방어)
- [x] keep 토글/onCupDone 재렌더 컵 미발동 보존, 새 턴 첫 굴림 정상 발동
- [x] in-cup/drop 마스크 `!keep` 기준 그대로 유지(무변경)
- [x] 신규 회귀 YACHT-KEEP-006(버그 직격) + 007/008
- [x] 신규 서버 통계 회귀 YACHT-012
- [x] 기존 YACHT-KEEP-001~005, LIVE-003/004, 전 smoke/bot 회귀 PASS

### 스펙과 다르게 구현한 점

- 스펙은 "rollCount 리셋 시 0 리셋"을 STATE 레벨로만 기술했으나, `_lastRollCount`가 이전 턴 값(예: 3)으로 남으면 새 턴 첫 굴림(rollCount=1)이 `1 > 3 = false`로 미발동하는 엣지가 있어, **else 분기에서 rollCount 감소(턴 리셋) 시 `_lastRollCount` 동기화** 로직을 추가했다. YACHT-KEEP-008로 검증.
- 테스트 실행은 스펙의 `npx playwright test` 대신 프로젝트 표준 node 러너(`node tests/dice-render.test.js` — CLAUDE.md 명시 방식)로 수행. dice-render는 Playwright가 아니라 DOM stub 노드 러너다.

## 빌드/린트 결과

- 빌드: N/A (바닐라 JS, 빌드 단계 없음)
- 테스트:
  - `node tests/dice-render.test.js` → **55/55 PASS** (기존 42 + 신규 13)
  - `node tests/smoke.test.js` → **169/169 PASS** (기존 163 + 신규 6)
  - `node tests/bot-smoke.test.js` → **25/25 PASS** (회귀 무영향)
  - **합계 249/249 PASS** (이전 230 → +19)

## Art Director 후속 조치

- visual_change: **ui**
- AD 모드 2 필요 여부: **아니오** — 에셋 생성/교체 없음(외부 이미지 에셋 0, 컵은 CSS).
- AD 모드 3 필요 여부: **예** — 컵 굴림 애니메이션 발동 조건이 바뀌었으므로(미발동 케이스가 발동으로 변경) UI 동작 검수 대상. 단 레이아웃/스타일은 무변경, 발동 빈도/타이밍만 정상화.
- **이 섹션이 "예"인 항목은 QA 진행 전에 반드시 AD를 거쳐야 한다.**

## 알려진 이슈

- 없음.

## QA 참고사항

- **재현 시나리오**: AI 모드 진입 → 1차 굴림 → 일부 keep → 재굴림 반복. non-kept 다이스가 우연히 직전과 같은 면으로 나와도 컵 흔들기+드롭 애니메이션이 매번 발동해야 한다(수정 전엔 1/6~1/36 확률로 미발동).
- 시각 확인 시 `node server.js --port 3097` 띄운 뒤 두 페이지 시점에서 keep 후 재굴림 반복 관찰.
- 무한 루프 가드: 컵 착지 후 onCupDone→renderAll 재진입 시 컵이 다시 뜨지 않아야 한다(rollCount 불변). keep 토글 시에도 컵 미발동.
- 새 턴 시작 시 첫 굴림에 컵이 정상 발동해야 한다(rollCount 0→1).
- 서버 권위 회귀(YACHT-012): keep=true 인덱스 값 동결, keep=false 인덱스 재굴림은 game.js 계약으로 박제됨.
