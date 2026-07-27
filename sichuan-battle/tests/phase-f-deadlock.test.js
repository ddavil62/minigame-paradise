/**
 * @fileoverview 교착 선택, 5초 본인 입력 잠금과 라운드·재접속 일관성을 검증한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SichuanGame } from '../lib/game.js';
import { findAnyLegalPair } from '../lib/pathfinder.js';

/**
 * 마지막 두 쌍 중 한 쌍만 선택 가능하고 제거 뒤 교착되는 경기를 만든다.
 * @returns {{game:SichuanGame,player:object,opponent:object,advance:(milliseconds:number)=>void,now:()=>number}}
 */
function createDeadlockGame() {
  let current = 1_000;
  const game = new SichuanGame({ seed: 91, now: () => current, duration: 30_000 });
  const player = game.addPlayer('p1', 'A');
  const opponent = game.addPlayer('p2', 'B');
  game.start();
  current = 4_001;
  game.tick();
  player.removedPairs = 46;
  player.board = {
    revision: 0,
    shuffleOrdinal: 0,
    tiles: [
      { tileId: 'a', faceId: 1, x: 0, y: 0, removed: false, locked: false },
      { tileId: 'b', faceId: 1, x: 1, y: 0, removed: false, locked: false },
      { tileId: 'c', faceId: 2, x: 3, y: 0, removed: false, locked: true },
      { tileId: 'd', faceId: 2, x: 4, y: 0, removed: false, locked: true },
    ],
  };
  return { game, player, opponent, advance(milliseconds) { current += milliseconds; }, now() { return current; } };
}

/**
 * 첫 쌍을 제거해 교착 선택 상태를 만든다.
 * @param {SichuanGame} game 경기
 * @returns {object} 교착 상태
 */
function triggerDeadlock(game) {
  const result = game.matchPair('p1', {
    requestId: 'trigger',
    matchId: game.matchId,
    tileAId: 'a',
    tileBId: 'b',
    boardRevision: 0,
  });
  assert.equal(result.ok, true);
  assert.equal(result.deadlock.phase, 'choice');
  return result.deadlock;
}

test('교착 선택 중에는 본인 짝 입력만 막고 상대 보드와 경기 시간은 그대로 유지한다', () => {
  const { game, player, opponent, advance } = createDeadlockGame();
  const deadlock = triggerDeadlock(game);
  const opponentRevision = opponent.board.revision;
  const deadlineAt = game.deadlineAt;
  advance(1_500);
  const blocked = game.matchPair('p1', {
    requestId: 'blocked',
    matchId: game.matchId,
    tileAId: 'c',
    tileBId: 'd',
    boardRevision: player.board.revision,
  });
  assert.equal(blocked.reason, 'SHUFFLE_PENDING');
  assert.equal(game.snapshot('p1').me.deadlock.deadlockId, deadlock.deadlockId);
  assert.equal(opponent.board.revision, opponentRevision);
  assert.equal(game.deadlineAt, deadlineAt);
});

test('5초 대기는 중복 선택을 거부하고 4,999ms에는 잠금, 5,000ms에는 필요한 셔플 뒤 해제한다', () => {
  const { game, player, advance, now } = createDeadlockGame();
  const deadlock = triggerDeadlock(game);
  const revision = player.board.revision;
  const intent = { requestId: 'wait', matchId: game.matchId, deadlockId: deadlock.deadlockId, action: 'wait' };
  const waiting = game.resolveDeadlock('p1', intent);
  assert.equal(waiting.ok, true);
  assert.equal(waiting.deadlock.unlockAt, now() + 5_000);
  assert.deepEqual(game.resolveDeadlock('p1', intent), waiting);
  assert.equal(game.resolveDeadlock('p1', { ...intent, requestId: 'duplicate' }).reason, 'DEADLOCK_ALREADY_RESOLVED');
  advance(4_999);
  game.tick();
  assert.equal(player.pendingAutoShuffle.phase, 'waiting');
  assert.equal(player.board.revision, revision);
  advance(1);
  game.tick();
  assert.equal(player.pendingAutoShuffle, null);
  assert.equal(player.board.revision, revision + 1);
  assert.ok(findAnyLegalPair(player.board.tiles));
});

test('5초 동안 방해 효과가 끝나 합법 수가 돌아오면 셔플 없이 정확히 해제한다', () => {
  const { game, player, advance, now } = createDeadlockGame();
  player.effects.lock = { effectId: 'lock', itemId: 'lock', targets: ['c', 'd'], endsAt: now() + 2_000 };
  const deadlock = triggerDeadlock(game);
  const revision = player.board.revision;
  game.resolveDeadlock('p1', { requestId: 'wait-clean', matchId: game.matchId, deadlockId: deadlock.deadlockId, action: 'wait' });
  advance(4_999);
  game.tick();
  assert.equal(player.pendingAutoShuffle.phase, 'waiting');
  advance(1);
  game.tick();
  assert.equal(player.pendingAutoShuffle, null);
  assert.equal(player.board.revision, revision);
  assert.ok(findAnyLegalPair(player.board.tiles));
});

test('교착 상태는 snapshot으로 복구되고 경기 종료 시 즉시 정리된다', () => {
  const { game, player } = createDeadlockGame();
  const deadlock = triggerDeadlock(game);
  game.resolveDeadlock('p1', { requestId: 'wait-reconnect', matchId: game.matchId, deadlockId: deadlock.deadlockId, action: 'wait' });
  const restored = game.snapshot('p1');
  assert.equal(restored.me.deadlock.phase, 'waiting');
  assert.ok(restored.me.deadlock.unlockAt > restored.me.deadlock.detectedAt);
  game.finish('p2', 'test');
  assert.equal(player.pendingAutoShuffle, null);
  assert.equal(game.snapshot('p1').me.deadlock, null);
});
