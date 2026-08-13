/**
 * @fileoverview 리포트 #60("흔들기로 한장 냈는데 다음턴에 더미만 뒤집기가 안돼") 재현 하네스.
 * matgo 룰 엔진(game.js)을 서버 없이 직접 구동해 흔들기/폭탄의 덱 뒤집기 권리 차이를 실측한다.
 *
 * 실행: node tests/shake-bonusflip-probe.mjs   (서버 불필요, 결정적)
 *
 * - R1 흔들기 선언 + 손패 잔존 → 같은 턴 덱 뒤집기는 정상, 다음 내 턴 더미 클릭은 불가
 * - R2 흔들기 라운드에서 손패 0장 소진 → 소프트락 없음(턴 스킵 + 양쪽 0에서 라운드 종료)
 * - R3 대조군: 폭탄은 bombDeckCredit +2를 주므로 더미만 뒤집기가 동작
 * - R4 잔여 리스크(범위 외): 조커 케이스 A + 덱 소진 시 finishTurnKeepTurn 데드락
 */
import { buildDeck } from '../cards.js';
import {
  createGame,
  playCardSteps,
  bonusFlipSteps,
  bombSteps,
  shakeDecision,
  snapshotForPlayer,
} from '../game.js';

const ALL = buildDeck();
/** 카드 ID로 카드 객체를 찾는다. */
const C = (id) => {
  const c = ALL.find((x) => x.id === id);
  if (!c) throw new Error('no such card: ' + id);
  return c;
};
/** 카드 ID 배열을 카드 배열로 변환한다. */
const CS = (...ids) => ids.map(C);

/** 제너레이터를 끝까지 소진하고 yield된 step 목록을 반환한다. */
function drain(gen) {
  const steps = [];
  for (const s of gen) steps.push(s);
  return steps;
}

/** 스냅샷에서 클라이언트 canBonusFlip 조건(client.js:1084~1087)을 그대로 재계산한다. */
function clientCanBonusFlip(snap, me) {
  return snap.turn === me
    && snap.phase === 'awaiting_play'
    && (snap.bombDeckCredit?.[me] || 0) > 0
    && snap.deckCount > 0;
}

let pass = 0;
let fail = 0;
/** 단언 헬퍼. */
function assert(label, cond, extra = '') {
  if (cond) { pass += 1; console.log('  PASS ' + label + (extra ? ' — ' + extra : '')); }
  else { fail += 1; console.log('  FAIL ' + label + (extra ? ' — ' + extra : '')); }
}

/** 최소 게임 상태를 만든다(랜덤 분배 제거). */
function makeGame(cfg) {
  const g = createGame('p1');
  g.hands.p1 = cfg.p1Hand;
  g.hands.p2 = cfg.p2Hand;
  g.floor = cfg.floor;
  g.deck = cfg.deck;
  g.turn = cfg.turn || 'p1';
  g.phase = 'awaiting_play';
  g.captured = { p1: [], p2: [] };   // captured는 평면 배열이다 (createGame 기준)
  g.bombDeckCredit = { p1: 0, p2: 0 };
  g.pendingBombFlips = { p1: 0, p2: 0 };
  g.shaking = { p1: false, p2: false };
  g.shakeAsked = { p1: false, p2: false };
  return g;
}

// ── R1: 실제 로그와 동일한 상황 — 흔들기 선언 + 손패 다수 잔존 ─────────────
// 2026-07-29T10:33:45 로그: p2가 6월 3장 보유, 바닥에 6월 없음 → 흔들기 후 1장 냄.
console.log('\n[R1] 흔들기 선언 후 손패 잔존 — 같은 턴 덱 뒤집기 + 다음 내 턴 더미 클릭 가능 여부');
{
  const g = makeGame({
    p1Hand: CS('m06_kkeut', 'm06_pi_a', 'm06_pi_b', 'm01_pi_a'),
    p2Hand: CS('m02_pi_a', 'm02_pi_b', 'm03_pi_a', 'm03_pi_b'),
    floor: CS('m08_pi_a', 'm10_pi_a'),
    deck: CS('m11_pi_b', 'm12_pi_ssangpi', 'm07_pi_a', 'm05_pi_a'),
    turn: 'p1',
  });
  const shakeRes = shakeDecision(g, 'p1', 'shake', 6);
  assert('shakeDecision ok', shakeRes.ok === true);
  assert('shaking.p1 = true', g.shaking.p1 === true);
  assert('shake는 bombDeckCredit을 주지 않는다', (g.bombDeckCredit.p1 || 0) === 0,
    'bombDeckCredit.p1=' + g.bombDeckCredit.p1);

  const steps = drain(playCardSteps(g, 'p1', 'm06_kkeut'));
  const kinds = steps.map((s) => s.step || ('error:' + s.error));
  assert('같은 턴 deck_flipped 발생(흔들기가 drawAndResolve를 건너뛰지 않음)',
    kinds.includes('deck_flipped'), 'steps=' + JSON.stringify(kinds));
  assert('턴이 상대(p2)로 넘어간다', g.turn === 'p2', 'turn=' + g.turn);

  // p2가 아무 카드 하나 내고 턴을 p1에게 돌려준다 → p1의 "다음 턴"
  drain(playCardSteps(g, 'p2', 'm02_pi_a'));
  assert('p1의 다음 턴이 돌아왔다', g.turn === 'p1', 'turn=' + g.turn);

  const snap = snapshotForPlayer(g, 'p1');
  const can = clientCanBonusFlip(snap, 'p1');
  assert('클라이언트 canBonusFlip === false (더미에 clickable/bonus-available 미부여)',
    can === false, 'canBonusFlip=' + can
      + ' hand=' + snap.yourHand.length
      + ' credit=' + (snap.bombDeckCredit?.p1 || 0)
      + ' deckCount=' + snap.deckCount);

  const bf = drain(bonusFlipSteps(g, 'p1'));
  assert('서버 bonusFlipSteps 거부 = 보너스 뒤집기 권리가 없다',
    bf.length === 1 && bf[0].error === '보너스 뒤집기 권리가 없다',
    JSON.stringify(bf));
}

// ── R2: 가설 A — 흔들기 선언 후 그 월 마지막 1장까지 소진 ─────────────────
console.log('\n[R2] 흔들기 라운드에서 손패를 0장까지 소진 — 소프트락 여부');
{
  const g = makeGame({
    p1Hand: CS('m06_kkeut'),          // 이미 흔들기 선언한 라운드의 마지막 1장
    p2Hand: CS('m02_pi_a', 'm02_pi_b'),
    floor: CS('m08_pi_a', 'm10_pi_a'),
    deck: CS('m11_pi_b', 'm12_pi_ssangpi', 'm07_pi_a'),
    turn: 'p1',
  });
  g.shaking.p1 = true;
  g.shakeAsked.p1 = true;

  drain(playCardSteps(g, 'p1', 'm06_kkeut'));
  assert('p1 손패 0장', g.hands.p1.length === 0);
  assert('p1 bombDeckCredit 0', (g.bombDeckCredit.p1 || 0) === 0);
  assert('턴이 p1에게 돌아오지 않는다(oppHasAction 스킵) → 소프트락 아님',
    g.turn === 'p2', 'turn=' + g.turn + ' phase=' + g.phase);

  drain(playCardSteps(g, 'p2', 'm02_pi_a'));
  assert('p1이 행동 불가라 턴이 p2에게 유지된다',
    g.turn === 'p2', 'turn=' + g.turn);

  drain(playCardSteps(g, 'p2', 'm02_pi_b'));
  assert('양쪽 손+credit=0 → 라운드 종료(phase=round_end)',
    g.phase === 'round_end', 'phase=' + g.phase);
}

// ── R3: 대조군 — 폭탄은 credit +2를 주므로 더미만 뒤집기가 동작한다 ────────
console.log('\n[R3] 대조군 — 폭탄 경로의 더미만 뒤집기');
{
  const g = makeGame({
    p1Hand: CS('m06_kkeut', 'm06_pi_a', 'm06_pi_b', 'm01_pi_a'),
    p2Hand: CS('m02_pi_a', 'm02_pi_b', 'm03_pi_a'),
    floor: CS('m06_tti_cheong', 'm10_pi_a'),   // 6월 1장 → 폭탄 성립
    deck: CS('m11_pi_b', 'm12_pi_ssangpi', 'm07_pi_a', 'm05_pi_a', 'm04_pi_a'),
    turn: 'p1',
  });
  drain(bombSteps(g, 'p1', 6));
  assert('폭탄 후 bombDeckCredit.p1 = 2', (g.bombDeckCredit.p1 || 0) === 2,
    'credit=' + g.bombDeckCredit.p1);
  // p1 턴이 상대로 넘어갔다면 되돌려서 p1 턴으로 맞춘다
  if (g.turn !== 'p1') { g.turn = 'p1'; g.phase = 'awaiting_play'; }
  const snap = snapshotForPlayer(g, 'p1');
  assert('클라이언트 canBonusFlip === true', clientCanBonusFlip(snap, 'p1') === true,
    'credit=' + (snap.bombDeckCredit?.p1 || 0) + ' hand=' + snap.yourHand.length);
  const bf = drain(bonusFlipSteps(g, 'p1'));
  const errs = bf.filter((s) => s.error);
  assert('서버 bonusFlipSteps 정상 수행', errs.length === 0, JSON.stringify(bf.map((s) => s.step || s.error)));
}

console.log('\n=== RESULT: ' + pass + ' PASS / ' + fail + ' FAIL ===');

// ── R4: 잔여 리스크 확인 — 조커 케이스 A(finishTurnKeepTurn) + 덱 소진 ────────
// 흔들기와 무관하지만 "행동 불가" 계열의 실제 데드락 후보를 실측한다.
console.log('\n[R4] 잔여 리스크 — 조커를 마지막 손패로 내고 덱이 비어 있을 때');
{
  const g = makeGame({
    p1Hand: CS('m00_joker_a'),
    p2Hand: CS('m02_pi_a', 'm02_pi_b'),
    floor: CS('m08_pi_a', 'm10_pi_a'),
    deck: [],                       // 덱 소진 → 손 보충 불가
    turn: 'p1',
  });
  g.captured.p2 = CS('m03_pi_a');   // 상대 피 1장(강탈 대상)
  drain(playCardSteps(g, 'p1', 'm00_joker_a'));
  console.log('  turn=' + g.turn + ' phase=' + g.phase
    + ' p1Hand=' + g.hands.p1.length + ' p1Credit=' + (g.bombDeckCredit.p1 || 0)
    + ' deck=' + g.deck.length);
  const stuck = g.turn === 'p1' && g.phase === 'awaiting_play'
    && g.hands.p1.length === 0 && (g.bombDeckCredit.p1 || 0) === 0 && g.deck.length === 0;
  console.log('  ' + (stuck ? 'DEADLOCK 재현됨 (턴 유지 + 행동 수단 0)' : '데드락 없음'));
}
