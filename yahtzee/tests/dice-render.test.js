/**
 * @fileoverview 클라이언트 다이스 렌더(dice.js) 회귀 — keep 기반 컵/drop 마스크 판정.
 *
 * 실행:
 *   node tests/dice-render.test.js
 *
 * 회귀 시나리오 (YACHT-KEEP-001~005):
 *   YACHT-KEEP-001: 새로 굴린 다이스가 우연히 prev와 같은 값이어도 컵 마스크에 포함되어야 한다.
 *                  (사용자 신고 핵심: "한 번씩 1,2 고정했는데 4,5만 돌아간다" → 인덱스 0이 안 굴러 보이는 현상)
 *   YACHT-KEEP-002: keep=true 다이스는 컵 안에 들어가면 안 된다 (유지 시각 보존).
 *   YACHT-KEEP-003: 1차 굴림 (prev=[0,0,0,0,0]) → 5개 전부 굴림 처리.
 *   YACHT-KEEP-004: keep 토글로 인한 비-굴림 재렌더 → 컵 시퀀스 발생 안 함.
 *   YACHT-KEEP-005: 다양한 keep 패턴 (전부 false / 전부 true / 중간 / 양끝) — onToggle 콜백 i가 시각 인덱스와 일치.
 *
 * DOM 의존: 최소 stub으로 document/HTMLElement만 흉내내어 dice.js를 import 후 동작 검증.
 */

// ── 최소 DOM stub ──────────────────────────────────────────────
// dice.js가 사용하는 것: document.createElement, element.appendChild, element.classList.toggle/add,
//   element.setAttribute, element.addEventListener('click', fn), element.textContent, element.type,
//   container.innerHTML = '', container._cupTimer (단순 프로퍼티).
class StubClassList {
  constructor() { this.set = new Set(); }
  add(...cls) { for (const c of cls) this.set.add(c); }
  remove(...cls) { for (const c of cls) this.set.delete(c); }
  toggle(c, on) { if (on) this.set.add(c); else this.set.delete(c); }
  contains(c) { return this.set.has(c); }
  toString() { return [...this.set].join(' '); }
}

class StubElement {
  constructor(tag) {
    this.tagName = (tag || 'div').toUpperCase();
    this.children = [];
    this.classList = new StubClassList();
    this._listeners = {};
    this._innerHTML = '';
    this._attrs = {};
  }
  get className() { return this.classList.toString(); }
  set className(v) { this.classList = new StubClassList(); for (const c of (v || '').split(/\s+/)) if (c) this.classList.add(c); }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  setAttribute(k, v) { this._attrs[k] = v; }
  addEventListener(evt, fn) {
    if (!this._listeners[evt]) this._listeners[evt] = [];
    this._listeners[evt].push(fn);
  }
  dispatchEvent(evt) {
    const fns = this._listeners[evt.type] || [];
    for (const fn of fns) fn(evt);
  }
  click() {
    // dice.js의 die.click() 같은 호출은 없지만, 테스트에서 button 클릭을 시뮬레이션할 때 사용.
    const fns = this._listeners['click'] || [];
    for (const fn of fns) fn({ type: 'click', target: this });
  }
  set innerHTML(v) {
    this._innerHTML = v;
    if (v === '') { this.children = []; }
  }
  get innerHTML() { return this._innerHTML; }
}

globalThis.document = {
  createElement(tag) { return new StubElement(tag); },
};

// ── dice.js import (DOM stub 설정 후) ──────────────────────────
const { renderDice } = await import('../public/js/dice.js');
const { DICE_COUNT } = await import('../game.js');

// ── 미니 테스트 러너 ──────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function assertEq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    const msg = `  FAIL  ${label}\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`;
    console.log(msg);
    failures.push(msg);
  }
}

function assertTrue(cond, label) {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    const msg = `  FAIL  ${label}`;
    console.log(msg);
    failures.push(msg);
  }
}

function section(name) {
  console.log(`\n[${name}]`);
}

/**
 * 컨테이너의 die 자식 5개를 추출하여 각각의 시각 상태(face value, kept, in-cup, dropping, selectable)를 반환.
 *  - container.children 중 .die 클래스를 가진 첫 5개만 추출 (컵 요소는 제외).
 *  - face value: die-face → pip-slot.on 위치 9개 패턴을 PIP_POSITIONS 역매핑.
 */
function inspectDice(container) {
  const dice = container.children.filter((c) => c.classList && c.classList.contains('die'));
  return dice.map((d) => ({
    kept: d.classList.contains('kept'),
    inCup: d.classList.contains('in-cup'),
    dropping: d.classList.contains('dropping'),
    selectable: d.classList.contains('selectable'),
    unrolled: d.classList.contains('unrolled'),
    isButton: d.tagName === 'BUTTON',
  }));
}

function hasCup(container) {
  return container.children.some((c) => c.classList && c.classList.contains('dice-cup'));
}

// ── YACHT-KEEP-001: 동일 값 우연 케이스에서도 mask 정확 ────────
section('YACHT-KEEP-001: 동일 값 우연 굴림도 컵 마스크에 포함');
{
  const container = new StubElement('div');
  // 1차 굴림 결과: dice=[1,2,3,4,5], keep=[F,F,F,F,F] (서버 권위)
  renderDice(container, {
    dice: [1, 2, 3, 4, 5],
    keep: [false, false, false, false, false],
    selectable: true,
    onToggle: () => {},
  });
  // 1차 굴림 시 prev=null → diceChanged=false → 단순 렌더 (컵 시퀀스 없음 — 기존 동작 유지).
  // 다만 prev가 갱신되어 다음 호출부터 추적됨.
  let snap = inspectDice(container);
  assertEq(snap.length, 5, '1차 렌더 후 die 5개 존재');
  assertTrue(snap.every((d) => !d.inCup && !d.dropping), '1차는 컵 시퀀스 없음 (prev=null)');

  // 2차 굴림 시뮬: keep=[F,T,T,F,F] (인덱스 1,2 고정). 새 dice는 우연히 인덱스 0이 동일 값 1.
  //   dice=[1,2,3,4,6] vs prev=[1,2,3,4,5] → diceChanged=true (인덱스 4가 5→6).
  //   인덱스 0,3은 keep=false인데 값이 같음 (1,4). 기존 changed 기반: inCupMask=[F,F,F,F,T] → 버그.
  //   수정 기반: rollMask=!keep=[T,F,F,T,T] → 인덱스 0,3,4 모두 컵에 들어가야 함.
  renderDice(container, {
    dice: [1, 2, 3, 4, 6],
    keep: [false, true, true, false, false],
    selectable: true,
    onToggle: () => {},
  });
  snap = inspectDice(container);
  assertTrue(hasCup(container), '컵 시퀀스 시작 (컵 DOM 존재)');
  // 컵 1단계: 굴린 칸(인덱스 0,3,4)은 in-cup, keep 칸(1,2)은 노출.
  assertEq(snap[0].inCup, true, '인덱스 0 (keep=false, 동일값) → 컵 안 (버그 수정 검증)');
  assertEq(snap[1].inCup, false, '인덱스 1 (keep=true) → 컵 안 아님');
  assertEq(snap[2].inCup, false, '인덱스 2 (keep=true) → 컵 안 아님');
  assertEq(snap[3].inCup, true, '인덱스 3 (keep=false, 동일값) → 컵 안 (버그 수정 검증)');
  assertEq(snap[4].inCup, true, '인덱스 4 (keep=false, 값 변경) → 컵 안');
}

// ── YACHT-KEEP-002: keep=true 다이스는 컵에 안 들어감 ──────────
section('YACHT-KEEP-002: keep=true 다이스 시각 유지');
{
  const container = new StubElement('div');
  renderDice(container, {
    dice: [3, 3, 3, 3, 3],
    keep: [false, false, false, false, false],
    selectable: true,
    onToggle: () => {},
  });
  // 2차 굴림: keep=[T,T,T,F,F] (인덱스 0,1,2 고정), dice 값 일부 변동.
  renderDice(container, {
    dice: [3, 3, 3, 5, 6],
    keep: [true, true, true, false, false],
    selectable: true,
    onToggle: () => {},
  });
  const snap = inspectDice(container);
  assertEq(snap[0].inCup, false, '인덱스 0 keep=true → 컵 안 아님');
  assertEq(snap[1].inCup, false, '인덱스 1 keep=true → 컵 안 아님');
  assertEq(snap[2].inCup, false, '인덱스 2 keep=true → 컵 안 아님');
  assertEq(snap[3].inCup, true, '인덱스 3 keep=false → 컵 안');
  assertEq(snap[4].inCup, true, '인덱스 4 keep=false → 컵 안');
  // keep 시각 마커
  assertEq(snap[0].kept, true, '인덱스 0 kept 클래스');
  assertEq(snap[1].kept, true, '인덱스 1 kept 클래스');
  assertEq(snap[2].kept, true, '인덱스 2 kept 클래스');
  assertEq(snap[3].kept, false, '인덱스 3 kept 클래스 없음');
  assertEq(snap[4].kept, false, '인덱스 4 kept 클래스 없음');
}

// ── YACHT-KEEP-003: 1차 굴림 (prev=[0,0,0,0,0]) → 5개 전부 굴림 ──
section('YACHT-KEEP-003: 1차 굴림 마스크 (allZero=true 후 첫 굴림)');
{
  const container = new StubElement('div');
  // START 직후 첫 STATE: dice=[0,0,0,0,0]
  renderDice(container, {
    dice: [0, 0, 0, 0, 0],
    keep: [false, false, false, false, false],
    selectable: false,
    onToggle: () => {},
  });
  let snap = inspectDice(container);
  assertEq(snap.length, 5, 'unrolled 5개');
  assertTrue(snap.every((d) => d.unrolled), '5개 다 unrolled (? 표시)');

  // 1차 굴림: prev=[0,0,0,0,0], dice=[2,4,6,1,3]. allZero=false, diceChanged=true → rolledNow=true.
  renderDice(container, {
    dice: [2, 4, 6, 1, 3],
    keep: [false, false, false, false, false],
    selectable: true,
    onToggle: () => {},
  });
  snap = inspectDice(container);
  assertTrue(hasCup(container), '1차 굴림도 컵 시퀀스 작동');
  assertTrue(snap.every((d) => d.inCup), '5개 다 컵 안 (keep 전부 false)');
}

// ── YACHT-KEEP-004: keep 토글로 인한 비-굴림 재렌더 ────────────
section('YACHT-KEEP-004: keep 토글 재렌더는 컵 시퀀스 발생 안 함');
{
  const container = new StubElement('div');
  // 1차 굴림 결과
  renderDice(container, {
    dice: [1, 2, 3, 4, 5],
    keep: [false, false, false, false, false],
    selectable: true,
    onToggle: () => {},
  });
  // 사용자가 keep 토글 (dice 값은 동일) — main.js의 onToggle 내부에서 drawDice() 재호출 시뮬레이션
  renderDice(container, {
    dice: [1, 2, 3, 4, 5],
    keep: [false, true, true, false, false],
    selectable: true,
    onToggle: () => {},
  });
  assertTrue(!hasCup(container), 'dice 값 동일 → 컵 시퀀스 발생 안 함');
  const snap = inspectDice(container);
  assertTrue(snap.every((d) => !d.inCup && !d.dropping), '5개 다 컵/drop 클래스 없음');
  assertEq(snap[1].kept, true, '인덱스 1 keep 시각 적용');
  assertEq(snap[2].kept, true, '인덱스 2 keep 시각 적용');
}

// ── YACHT-KEEP-005: onToggle 콜백 인덱스 = 시각 순서 ─────────
section('YACHT-KEEP-005: onToggle 콜백 i가 시각/DOM 인덱스와 일치');
{
  const container = new StubElement('div');
  const toggleCalls = [];
  renderDice(container, {
    dice: [6, 5, 4, 3, 2],
    keep: [false, false, false, false, false],
    selectable: true,
    onToggle: (i) => { toggleCalls.push(i); },
  });
  const snap = inspectDice(container);
  assertEq(snap.length, 5, 'die 5개');
  // 각 die의 button click 시 콜백 i가 0,1,2,3,4 순으로 호출되는지 확인.
  const dice = container.children.filter((c) => c.classList.contains('die'));
  dice[0].click();
  dice[3].click();
  dice[4].click();
  dice[1].click();
  dice[2].click();
  assertEq(toggleCalls, [0, 3, 4, 1, 2], '클릭 순서 = 콜백 i 순서 (시각=콜백 인덱스 일치)');
}

// ── YACHT-LIVE-003: opponentTurn=true → 상대 KEEP 시각 ─────────
section('YACHT-LIVE-003: opponentTurn=true → .die.kept.opponent + "상대 KEEP" 라벨');
{
  const container = new StubElement('div');
  // 1차 렌더(prev=null) → 컵 시퀀스 없음.
  renderDice(container, {
    dice: [3, 4, 5, 6, 1],
    keep: [false, true, false, true, false],
    selectable: false,
    opponentTurn: true,
    onToggle: () => {},
  });
  const dice = container.children.filter((c) => c.classList && c.classList.contains('die'));
  assertEq(dice.length, 5, '5개 die 존재');
  // 인덱스 1,3 = keep → kept + opponent 클래스.
  assertEq(dice[1].classList.contains('kept'), true, '인덱스 1 kept');
  assertEq(dice[1].classList.contains('opponent'), true, '인덱스 1 opponent 클래스');
  assertEq(dice[3].classList.contains('kept'), true, '인덱스 3 kept');
  assertEq(dice[3].classList.contains('opponent'), true, '인덱스 3 opponent 클래스');
  // 인덱스 0,2,4 = not kept → opponent 클래스 없음.
  assertEq(dice[0].classList.contains('kept'), false, '인덱스 0 kept 없음');
  assertEq(dice[0].classList.contains('opponent'), false, '인덱스 0 opponent 클래스 없음');
  // keep-tag 텍스트가 "상대 KEEP"인지 확인.
  const tag1 = dice[1].children.find((c) => c.classList && c.classList.contains('keep-tag'));
  assertTrue(!!tag1, '인덱스 1 keep-tag 요소 존재');
  assertEq(tag1.textContent, '상대 KEEP', 'keep-tag 텍스트 = "상대 KEEP"');
  // selectable=false → click 리스너 없음.
  assertEq(dice[1].classList.contains('selectable'), false, '상대 턴이므로 selectable 없음');
}

// ── YACHT-LIVE-004: opponentTurn=false → 기존 "KEEP" 라벨 ──────
section('YACHT-LIVE-004: 본인 턴(opponentTurn=false) → 기존 KEEP 라벨 유지 (회귀)');
{
  const container = new StubElement('div');
  renderDice(container, {
    dice: [2, 2, 5, 6, 1],
    keep: [true, true, false, false, false],
    selectable: true,
    opponentTurn: false,
    onToggle: () => {},
  });
  const dice = container.children.filter((c) => c.classList && c.classList.contains('die'));
  assertEq(dice[0].classList.contains('kept'), true, '인덱스 0 kept');
  assertEq(dice[0].classList.contains('opponent'), false, '본인 턴 → opponent 클래스 없음');
  const tag0 = dice[0].children.find((c) => c.classList && c.classList.contains('keep-tag'));
  assertEq(tag0.textContent, 'KEEP', 'keep-tag = "KEEP" (본인 턴)');
  // selectable 작동.
  assertEq(dice[0].classList.contains('selectable'), true, '본인 턴 selectable');
}

// ── YACHT-KEEP-006: rollCount 증가 + dice 값 100% 동일 → 컵 애니메이션 발동 ──
// (2026-06-20 사용자 신고 핵심 회귀: keep 안 한 다이스가 우연히 직전과 전부 같은 면으로
//  굴려져도(diceChanged=false) rollCount가 증가했으면 컵 애니메이션이 발동해야 한다.)
section('YACHT-KEEP-006: rollCount 증가 + dice 전체 동일 재굴림 → 컵 발동 (이번 버그 직격)');
{
  const container = new StubElement('div');
  // 1차 굴림 결과: dice=[2,2,3,4,5], rollCount=1.
  renderDice(container, {
    dice: [2, 2, 3, 4, 5],
    keep: [false, false, false, false, false],
    selectable: true,
    rollCount: 1,
    onToggle: () => {},
  });
  // 컵 시퀀스가 진행 중일 수 있으므로 타이머를 강제로 정리해 다음 굴림을 즉시 처리하게 한다.
  if (container._cupTimer) { clearTimeout(container._cupTimer); container._cupTimer = null; }

  // 2차 굴림: keep=[T,T,F,F,F] (인덱스 0,1 고정), 새 dice가 우연히 직전과 100% 동일.
  //   dice=[2,2,3,4,5] vs prev=[2,2,3,4,5] → diceChanged=false.
  //   기존 diceChanged 기반: rolledNow=false → 컵 미발동(버그).
  //   수정(rollCount): 1→2 증가 → rolledNow=true → 컵 발동.
  renderDice(container, {
    dice: [2, 2, 3, 4, 5],
    keep: [true, true, false, false, false],
    selectable: true,
    rollCount: 2,
    onToggle: () => {},
  });
  assertTrue(hasCup(container), 'dice 전체 동일이어도 rollCount 증가 → 컵 발동 (버그 수정 검증)');
  const snap = inspectDice(container);
  assertEq(snap[0].inCup, false, '인덱스 0 keep=true → 컵 안 아님');
  assertEq(snap[1].inCup, false, '인덱스 1 keep=true → 컵 안 아님');
  assertEq(snap[2].inCup, true, '인덱스 2 keep=false → 컵 안 (동일값이어도)');
  assertEq(snap[3].inCup, true, '인덱스 3 keep=false → 컵 안 (동일값이어도)');
  assertEq(snap[4].inCup, true, '인덱스 4 keep=false → 컵 안 (동일값이어도)');
  assertEq(container._lastRollCount, 2, '_lastRollCount가 즉시 2로 갱신됨 (무한 루프 방지)');
}

// ── YACHT-KEEP-007: rollCount 불변 재렌더(onCupDone/keep 토글) → 컵 미발동 ──
// (무한 루프 방지 + keep 토글 기존 동작 유지 회귀.)
section('YACHT-KEEP-007: rollCount 불변 재렌더 → 컵 미발동 (무한 루프 방지)');
{
  const container = new StubElement('div');
  // 1차 굴림: rollCount=1.
  renderDice(container, {
    dice: [1, 2, 3, 4, 5],
    keep: [false, false, false, false, false],
    selectable: true,
    rollCount: 1,
    onToggle: () => {},
  });
  if (container._cupTimer) { clearTimeout(container._cupTimer); container._cupTimer = null; }
  assertEq(container._lastRollCount, 1, '굴림 후 _lastRollCount=1');

  // onCupDone → renderAll 재진입 시뮬: dice/keep 동일, rollCount 불변(1) → 컵 미발동.
  renderDice(container, {
    dice: [1, 2, 3, 4, 5],
    keep: [false, false, false, false, false],
    selectable: true,
    rollCount: 1,
    onToggle: () => {},
  });
  assertTrue(!hasCup(container), 'rollCount 불변 재렌더 → 컵 미발동');

  // keep 토글 재렌더: dice 동일, rollCount 여전히 1 → 컵 미발동(기존 YACHT-KEEP-004 동작 유지).
  renderDice(container, {
    dice: [1, 2, 3, 4, 5],
    keep: [false, true, true, false, false],
    selectable: true,
    rollCount: 1,
    onToggle: () => {},
  });
  assertTrue(!hasCup(container), 'keep 토글 재렌더(rollCount 불변) → 컵 미발동');
  const snap = inspectDice(container);
  assertEq(snap[1].kept, true, '인덱스 1 keep 시각 적용');
}

// ── YACHT-KEEP-008: 새 턴 rollCount 0 리셋 후 첫 굴림(0→1) → 컵 발동 ──
section('YACHT-KEEP-008: 턴 넘김 rollCount 0 리셋 → 첫 굴림(0→1) 정상 발동');
{
  const container = new StubElement('div');
  // 이전 턴 마지막 굴림: rollCount=3.
  renderDice(container, {
    dice: [6, 6, 6, 1, 2],
    keep: [false, false, false, false, false],
    selectable: true,
    rollCount: 3,
    onToggle: () => {},
  });
  if (container._cupTimer) { clearTimeout(container._cupTimer); container._cupTimer = null; }

  // 턴 넘김 후 새 턴 STATE: dice=[0,0,0,0,0], rollCount=0 (리셋). 컵 미발동(allZero).
  renderDice(container, {
    dice: [0, 0, 0, 0, 0],
    keep: [false, false, false, false, false],
    selectable: false,
    rollCount: 0,
    onToggle: () => {},
  });
  assertTrue(!hasCup(container), '새 턴 리셋 STATE(rollCount=0, allZero) → 컵 미발동');

  // 새 턴 첫 굴림: rollCount 0→1. _lastRollCount는 0(리셋 시 미갱신)이므로 0<1 → 발동.
  renderDice(container, {
    dice: [4, 5, 6, 1, 2],
    keep: [false, false, false, false, false],
    selectable: true,
    rollCount: 1,
    onToggle: () => {},
  });
  assertTrue(hasCup(container), '새 턴 첫 굴림(rollCount 0→1) → 컵 정상 발동');
}

// ── 결과 ──────────────────────────────────────────────────────
console.log('\n────────────────────────────────────────');
console.log(`총 ${passed + failed}건, PASS=${passed}, FAIL=${failed}`);
if (failed > 0) {
  console.log('\n실패 목록:');
  for (const f of failures) console.log(f);
  process.exit(1);
} else {
  console.log('모든 dice-render 테스트 통과.');
  process.exit(0);
}
