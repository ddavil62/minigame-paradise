import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, guess, HINT_ACTION_GRACE_MS, PUZZLE, remainingMs, RULE_TYPES, snapshot, useHint } from '../game.js';

test('선택한 규칙 유형이 모든 스테이지의 시간·오답·힌트 설정에 적용된다', () => {
  const now = 500;
  for (const [ruleType, rules] of Object.entries(RULE_TYPES)) {
    const game = createGame(now, 'retro-comic-alien-laundromat-04', ruleType);
    assert.equal(game.ruleType, ruleType);
    assert.equal(remainingMs(game, now), rules.durationMs);
    assert.equal(snapshot(game, now).maxHints, rules.maxHints);
    const before = game.deadline;
    guess(game, { image: 'a', x: 0.5, y: 0.95, playerId: 'p1' }, now);
    assert.equal(game.deadline, before - rules.missPenaltyMs);
  }
  assert.equal(createGame(now, 'moonlit-greenhouse-01').ruleType, 'classic');
  assert.equal(createGame(now, 'skyship-workshop-01').ruleType, 'classic');
  assert.throws(() => createGame(now, PUZZLE.id, 'unknown'), /unknown rule type/);
});

test('정답은 한 번만 집계되고 양쪽 그림에서 판정된다', () => {
  const now = 1_000;
  const game = createGame(now);
  const first = guess(game, { image: 'a', x: 0.08, y: 0.24, playerId: 'p1' }, now);
  const duplicate = guess(game, { image: 'b', x: 0.08, y: 0.24, playerId: 'p2' }, now);
  assert.equal(first.kind, 'found');
  assert.equal(duplicate.kind, 'already');
  assert.equal(game.found.size, 1);
});

test('오답은 선택한 전역 난이도의 시간을 차감한다', () => {
  const now = 2_000;
  const game = createGame(now);
  const before = game.deadline;
  const result = guess(game, { image: 'a', x: 0.5, y: 0.95, playerId: 'p1' }, now);
  assert.equal(result.kind, 'miss');
  assert.equal(game.deadline, before - game.rules.missPenaltyMs);
});

test('힌트는 정답 처리 없이 남은 위치 하나를 공유하고 전역 난이도별 시간을 차감한다', () => {
  const now = 3_000;
  const game = createGame(now);
  const before = game.deadline;
  guess(game, { image: 'a', x: 0.08, y: 0.24, playerId: 'p2' }, now);
  const result = useHint(game, 'p1', now, () => 0.99);
  assert.equal(result.ok, true);
  assert.equal(result.difference.id, 'cat');
  assert.equal(game.found.size, 1);
  assert.deepEqual([...game.found.keys()], ['umbrella']);
  assert.deepEqual([...game.hinted.keys()], ['cat']);
  assert.equal(snapshot(game, now).found.length, 1);
  assert.equal(snapshot(game, now).hinted[0].id, 'cat');
  assert.equal(game.deadline, before - game.rules.hintPenaltyMs);
});

test('힌트 위치를 클릭하면 힌트가 사라지고 실제 발견으로 바뀐다', () => {
  const now = 3_500;
  const game = createGame(now);
  const hint = useHint(game, 'p1', now, () => 0.99);
  const target = PUZZLE.differences.find((difference) => difference.id === hint.difference.id);
  const zone = target.zones.b;
  const result = guess(game, { image: 'b', x: zone.x + zone.w / 2, y: zone.y + zone.h / 2, playerId: 'p2' }, now);

  assert.equal(result.kind, 'found');
  assert.equal(game.hinted.has(target.id), false);
  assert.equal(game.found.get(target.id), 'p2');
  assert.equal(snapshot(game, now).hinted.length, 0);
});

test('활성 힌트는 다음 힌트 대상에서 제외된다', () => {
  const now = 3_750;
  const game = createGame(now, 'moonlit-greenhouse-01');
  const first = useHint(game, 'p1', now, () => 0);
  const second = useHint(game, 'p2', now, () => 0);

  assert.notEqual(first.difference.id, second.difference.id);
  assert.equal(game.hinted.size, 2);
  assert.equal(game.found.size, 0);
});

test('마지막 차이의 힌트는 클릭 전까지 발견이나 종료로 처리되지 않는다', () => {
  const now = 3_900;
  const game = createGame(now);
  const lastDifference = PUZZLE.differences.at(-1);
  for (const difference of PUZZLE.differences.slice(0, -1)) {
    const zone = difference.zones.a;
    guess(game, { image: 'a', x: zone.x + zone.w / 2, y: zone.y + zone.h / 2, playerId: 'p1' }, now);
  }
  game.deadline = now + 2_000;

  const hint = useHint(game, 'p1', now, () => 0.99);

  assert.equal(hint.ok, true);
  assert.equal(hint.difference.id, lastDifference.id);
  assert.equal(game.phase, 'playing');
  assert.equal(game.found.size, PUZZLE.differences.length - 1);
  assert.equal(game.hinted.has(lastDifference.id), true);
  assert.equal(remainingMs(game, now), HINT_ACTION_GRACE_MS);

  const zone = lastDifference.zones.b;
  const result = guess(game, { image: 'b', x: zone.x + zone.w / 2, y: zone.y + zone.h / 2, playerId: 'p2' }, now + 1_000);
  assert.equal(result.kind, 'found');
  assert.equal(game.phase, 'won');
});

test('모든 차이를 찾으면 승리한다', () => {
  const now = 4_000;
  const game = createGame(now);
  for (const difference of PUZZLE.differences) {
    const zone = difference.zones.a;
    guess(game, { image: 'a', x: zone.x + zone.w / 2, y: zone.y + zone.h / 2, playerId: 'p1' }, now);
  }
  assert.equal(snapshot(game, now).phase, 'won');
  assert.equal(snapshot(game, now).found.length, PUZZLE.differences.length);
});

test('레트로 만화 3편의 다섯 판정 영역 중심은 모두 정답으로 인식된다', () => {
  const now = 5_000;
  const game = createGame(now, 'retro-comic-monster-tv-studio-03');

  for (const difference of game.puzzle.differences) {
    const zone = difference.zones.a;
    const result = guess(game, {
      image: 'a',
      x: zone.x + zone.w / 2,
      y: zone.y + zone.h / 2,
      playerId: 'p1',
    }, now);
    assert.equal(result.kind, 'found', difference.id);
  }

  assert.equal(game.phase, 'won');
  assert.equal(game.found.size, 5);
});

test('레트로 만화 4편의 다섯 판정 영역 중심은 모두 정답으로 인식된다', () => {
  const now = 6_000;
  const game = createGame(now, 'retro-comic-alien-laundromat-04');

  for (const difference of game.puzzle.differences) {
    const zone = difference.zones.b;
    const result = guess(game, {
      image: 'b',
      x: zone.x + zone.w / 2,
      y: zone.y + zone.h / 2,
      playerId: 'p2',
    }, now);
    assert.equal(result.kind, 'found', difference.id);
  }

  assert.equal(game.phase, 'won');
  assert.equal(game.found.size, 5);
});

test('레트로 만화 5편의 다섯 판정 영역 중심은 모두 정답으로 인식된다', () => {
  const now = 7_000;
  const game = createGame(now, 'retro-comic-moon-barbershop-05');

  for (const difference of game.puzzle.differences) {
    const zone = difference.zones.a;
    const result = guess(game, {
      image: 'a',
      x: zone.x + zone.w / 2,
      y: zone.y + zone.h / 2,
      playerId: 'p1',
    }, now);
    assert.equal(result.kind, 'found', difference.id);
  }

  assert.equal(game.phase, 'won');
  assert.equal(game.found.size, 5);
});
