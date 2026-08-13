/**
 * @fileoverview 끝말잇기 배틀 막힘/희귀 종성 대체 시작 글자 확장 단위 + 게임 로직 테스트.
 *
 * node:test 러너로 실행:
 *   node --test wordchain-battle/tests/wordchain-battle-deadend.test.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { loadWords, buildFollowerCountMap, computeDeadEndAlts } from '../words.js';
import { createGame, submitWord, snapshot } from '../game.js';

// ── 사전 및 맵 초기화 ────────────────────────────────────────────
const wordSet = loadWords();
const followerCountMap = buildFollowerCountMap();

// ── 단위 테스트: buildFollowerCountMap ────────────────────────────

test('buildFollowerCountMap: "팍"의 후속 단어 수가 0이다', () => {
  const count = followerCountMap.get('팍') ?? 0;
  assert.equal(count, 0);
});

test('buildFollowerCountMap: "름"의 후속 단어 수가 6 이상이다 (두음법칙 포함)', () => {
  const count = followerCountMap.get('름') ?? 0;
  // 스펙에서 27개 (직접 18 + 두음법칙 "늠" 9)으로 실측했지만, 사전 버전에 따라 변동 가능
  assert.ok(count >= 6, `"름" 후속 수 = ${count}, 6 이상이어야 한다`);
});

// ── 단위 테스트: computeDeadEndAlts ──────────────────────────────

test('computeDeadEndAlts("팍"): {"팍", "파"} — 받침 제거 확장', () => {
  const alts = computeDeadEndAlts('팍', followerCountMap);
  assert.ok(alts instanceof Set);
  assert.ok(alts.has('팍'), '원래 글자 포함');
  assert.ok(alts.has('파'), '받침 제거 형태 포함');
  assert.equal(alts.size, 2);
});

test('computeDeadEndAlts("릅"): {"릅", "늡", "르", "느"} — 두음법칙 + 받침 제거 복합', () => {
  const alts = computeDeadEndAlts('릅', followerCountMap);
  assert.ok(alts instanceof Set);
  assert.ok(alts.has('릅'), '원래 글자');
  assert.ok(alts.has('늡'), '두음법칙 변환');
  assert.ok(alts.has('르'), '받침 제거');
  assert.ok(alts.has('느'), '두음법칙 + 받침 제거');
  assert.equal(alts.size, 4);
});

test('computeDeadEndAlts("뀌"): {"뀌"} — 받침 없고 두음법칙 없음', () => {
  const alts = computeDeadEndAlts('뀌', followerCountMap);
  assert.ok(alts instanceof Set);
  assert.ok(alts.has('뀌'));
  assert.equal(alts.size, 1);
});

test('computeDeadEndAlts("름"): null — 임계값 이상', () => {
  const alts = computeDeadEndAlts('름', followerCountMap);
  assert.equal(alts, null);
});

test('computeDeadEndAlts("냐"): 발동하지만 받침 없어 확장 없음', () => {
  // "냐"의 후속 수가 6 미만인지 확인
  const count = followerCountMap.get('냐') ?? 0;
  if (count >= 6) {
    // 사전 버전에 따라 6 이상일 수 있으므로 조건부 스킵
    assert.equal(computeDeadEndAlts('냐', followerCountMap), null);
    return;
  }
  const alts = computeDeadEndAlts('냐', followerCountMap);
  assert.ok(alts instanceof Set);
  assert.ok(alts.has('냐'));
  // 받침 없으므로 확장 없음, 두음법칙도 "냐"에는 적용 안 됨
  assert.equal(alts.size, 1);
});

// ── 게임 로직 테스트: submitWord와 deadEndAlts ───────────────────

/**
 * "팍"으로 끝나는 사전 단어를 찾는다.
 * @returns {string}
 */
function findWordEndingWith(endChar) {
  for (const w of wordSet) {
    if (w[w.length - 1] === endChar) return w;
  }
  throw new Error(`"${endChar}"으로 끝나는 단어를 찾지 못했다`);
}

/**
 * 지정 글자로 시작하는 사전 단어를 찾되, 특정 단어는 제외한다.
 * @param {string} startChar 시작 글자
 * @param {Set<string>} [exclude] 제외할 단어 집합
 * @returns {string}
 */
function findWordStartingWith(startChar, exclude = new Set()) {
  for (const w of wordSet) {
    if (w[0] === startChar && !exclude.has(w)) return w;
  }
  throw new Error(`"${startChar}"으로 시작하는 단어를 찾지 못했다`);
}

/** 빈 가비지 후보 맵 (가비지 발동을 방지하기 위해) */
const emptyGarbageCandidates = new Map();

test('p1이 "팍"으로 끝나는 단어 제출 시 공유 체인에 deadEndAlts 주입', () => {
  const game = createGame('A', 'B');
  game.phase = 'playing';

  const deadEndWord = findWordEndingWith('팍');
  const result = submitWord(game, 'p1', deadEndWord, wordSet, emptyGarbageCandidates, followerCountMap);
  assert.equal(result.ok, true);
  assert.equal(result.deadEndExpanded, true);

  assert.ok(game.chain.deadEndAlts instanceof Set, 'chain.deadEndAlts는 Set이어야 한다');
  assert.ok(game.chain.deadEndAlts.has('팍'), '원래 글자 포함');
  assert.ok(game.chain.deadEndAlts.has('파'), '받침 제거 형태 포함');
});

test('"가슴팍" 수락 후 p2가 "파"로 시작하는 단어 제출 → 수락', () => {
  const game = createGame('A', 'B');
  game.phase = 'playing';

  // p1이 "가슴팍" 제출 (사전에 있는지 확인)
  const deadEndWord = findWordEndingWith('팍');
  submitWord(game, 'p1', deadEndWord, wordSet, emptyGarbageCandidates, followerCountMap);

  const paWord = findWordStartingWith('파', game.usedWords);
  const result = submitWord(game, 'p2', paWord, wordSet, emptyGarbageCandidates, followerCountMap);
  assert.equal(result.ok, true, `"파"로 시작하는 단어 "${paWord}" 수락되어야 한다`);
});

test('"가슴팍" 수락 후 p2가 관련 없는 글자로 시작하는 단어 제출 → 거부', () => {
  const game = createGame('A', 'B');
  game.phase = 'playing';

  const deadEndWord = findWordEndingWith('팍');
  submitWord(game, 'p1', deadEndWord, wordSet, emptyGarbageCandidates, followerCountMap);

  // "도"로 시작하는 단어 시도
  const wrongWord = findWordStartingWith('도', game.usedWords);
  const result = submitWord(game, 'p2', wrongWord, wordSet, emptyGarbageCandidates, followerCountMap);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'wrong_start');
});

test('p2가 deadEndAlts 상태에서 단어 제출 성공 후 deadEndAlts 소거', () => {
  const game = createGame('A', 'B');
  game.phase = 'playing';

  const deadEndWord = findWordEndingWith('팍');
  submitWord(game, 'p1', deadEndWord, wordSet, emptyGarbageCandidates, followerCountMap);
  assert.ok(game.chain.deadEndAlts !== null, '제출 전 deadEndAlts 존재');

  const paWord = findWordStartingWith('파', game.usedWords);
  submitWord(game, 'p2', paWord, wordSet, emptyGarbageCandidates, followerCountMap);

  assert.equal(game.chain.deadEndAlts, null, '제출 후 deadEndAlts 소거');
});

test('forced가 있는 상태에서 deadEndAlts가 있어도 forced 판정 우선', () => {
  const game = createGame('A', 'B');
  game.phase = 'playing';

  game.turn = 'p2';
  game.chain.forced = '가';
  game.chain.deadEndAlts = new Set(['팍', '파']);
  game.chain.lastSyllable = '팍';

  // "파"로 시작하는 단어 → forced가 "가"이므로 거부되어야 함
  const paWord = findWordStartingWith('파', game.usedWords);
  const result = submitWord(game, 'p2', paWord, wordSet, emptyGarbageCandidates, followerCountMap);
  // forced가 "가"인데 "파"로 시작 → wrong_start
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'wrong_start');

  // "가"로 시작하는 단어 → forced 조건 충족
  const gaWord = findWordStartingWith('가', game.usedWords);
  const result2 = submitWord(game, 'p2', gaWord, wordSet, emptyGarbageCandidates, followerCountMap);
  assert.equal(result2.ok, true);
});

test('"름"으로 끝나는 단어 제출 → deadEndExpanded: false, 두음법칙 대체 글자("늠")는 표시용으로 남는다', () => {
  const game = createGame('A', 'B');
  game.phase = 'playing';

  const reumWord = findWordEndingWith('름');
  const result = submitWord(game, 'p1', reumWord, wordSet, emptyGarbageCandidates, followerCountMap);
  assert.equal(result.ok, true);
  assert.equal(result.deadEndExpanded, false, '희귀 종성 확장(받침 제거)은 발동하지 않아야 한다');

  // matchesStartChar는 두음법칙 대체 글자("늠")를 항상 허용하므로,
  // 임계값 이상인 정상 케이스라도 UI에 노출되어야 한다.
  assert.ok(game.chain.deadEndAlts instanceof Set, 'deadEndAlts는 두음법칙 대체 표시를 위해 Set이어야 한다');
  assert.ok(game.chain.deadEndAlts.has('름'), '원래 글자 포함');
  assert.ok(game.chain.deadEndAlts.has('늠'), '두음법칙 대체 글자 포함');
  assert.equal(game.chain.deadEndAlts.size, 2, '받침 제거 확장은 없어야 한다');
});

test('"리"로 끝나는 단어 제출 → 두음법칙 대체 글자("이")가 상대 체인에 노출된다', () => {
  const game = createGame('A', 'B');
  game.phase = 'playing';

  const riWord = findWordEndingWith('리');
  const result = submitWord(game, 'p1', riWord, wordSet, emptyGarbageCandidates, followerCountMap);
  assert.equal(result.ok, true);

  assert.ok(game.chain.deadEndAlts instanceof Set, '"리"는 두음법칙 대체("이")가 있으므로 deadEndAlts가 채워져야 한다');
  assert.ok(game.chain.deadEndAlts.has('리'));
  assert.ok(game.chain.deadEndAlts.has('이'), '두음법칙 대체 글자 "이" 포함');
});

test('정상 임계값 단어 수락 후 SubmitResult.deadEndExpanded === false', () => {
  const game = createGame('A', 'B');
  game.phase = 'playing';

  // 아무 단어 제출 (끝 글자가 정상 범위인 것 찾기)
  const normalWord = findWordStartingWith('사');
  const result = submitWord(game, 'p1', normalWord, wordSet, emptyGarbageCandidates, followerCountMap);
  assert.equal(result.ok, true);
  assert.equal(result.deadEndExpanded, false);
});

test('막힘 단어 수락 후 SubmitResult.deadEndExpanded === true', () => {
  const game = createGame('A', 'B');
  game.phase = 'playing';

  const deadEndWord = findWordEndingWith('팍');
  const result = submitWord(game, 'p1', deadEndWord, wordSet, emptyGarbageCandidates, followerCountMap);
  assert.equal(result.ok, true);
  assert.equal(result.deadEndExpanded, true);
});

test('snapshot(game) 반환값에 deadEndAlts 배열 또는 null 포함', () => {
  const game = createGame('A', 'B');
  game.phase = 'playing';

  // deadEndAlts가 null인 초기 상태
  const snap1 = snapshot(game);
  assert.equal(snap1.chain.deadEndAlts, null);

  // 공유 체인에 deadEndAlts 주입
  game.chain.deadEndAlts = new Set(['팍', '파']);
  const snap2 = snapshot(game);
  assert.ok(Array.isArray(snap2.chain.deadEndAlts), 'Set이 Array로 변환되어야 한다');
  assert.ok(snap2.chain.deadEndAlts.includes('팍'));
  assert.ok(snap2.chain.deadEndAlts.includes('파'));
});

test('followerCountMap이 undefined이면 확장 로직 건너뜀 (하위 호환)', () => {
  const game = createGame('A', 'B');
  game.phase = 'playing';

  const deadEndWord = findWordEndingWith('팍');
  // followerCountMap 없이 호출
  const result = submitWord(game, 'p1', deadEndWord, wordSet, emptyGarbageCandidates);
  assert.equal(result.ok, true);
  assert.equal(result.deadEndExpanded, false);
  assert.equal(game.chain.deadEndAlts, null);
});
