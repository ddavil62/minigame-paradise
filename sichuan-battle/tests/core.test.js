/**
 * @fileoverview 사천성 보드, 경로, 아이템과 경기 상태의 핵심 회귀 테스트.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, measureAdjacency, shuffleRemaining } from '../lib/board.js';
import { findAnyLegalPair, findPath } from '../lib/pathfinder.js';
import { verifyGeneratedSolution } from '../lib/solver.js';
import { ITEM_DEFINITIONS, chooseTargets, rollDrop } from '../lib/items.js';
import { createPrng } from '../lib/prng.js';
import { SichuanGame } from '../lib/game.js';

test('1,000개 시드가 24종×4장과 저장 해답을 보장한다', () => {
  for (let seed = 0; seed < 1000; seed += 1) {
    const board = createBoard(seed); const counts = new Map();
    assert.equal(board.tiles.length, 96); assert.equal(new Set(board.tiles.map((tile) => tile.tileId)).size, 96);
    board.tiles.forEach((tile) => counts.set(tile.faceId, (counts.get(tile.faceId) || 0) + 1));
    assert.deepEqual([...counts.values()].sort((a, b) => a - b), Array(24).fill(4)); assert.equal(verifyGeneratedSolution(board), true);
  }
});

test('직선과 외곽 2회 꺼임을 찾고 3회 꺼임은 거부한다', () => {
  const straight = [{ tileId: 'a', faceId: 1, x: 0, y: 0, removed: false }, { tileId: 'b', faceId: 1, x: 2, y: 0, removed: false }]; assert.equal(findPath(straight, 'a', 'b').bends, 0);
  const outside = [...straight, { tileId: 'x', faceId: 2, x: 1, y: 0, removed: false }]; const route = findPath(outside, 'a', 'b'); assert.ok(route); assert.equal(route.bends, 2); assert.ok(route.path.some((point) => point.y === -1));
});

test('셔플은 얼굴 다중집합을 보존하고 revision을 올린다', () => {
  const board = createBoard(7); const before = board.tiles.map((tile) => tile.faceId).sort((a, b) => a - b); shuffleRemaining(board, 7);
  assert.deepEqual(board.tiles.map((tile) => tile.faceId).sort((a, b) => a - b), before); assert.equal(board.revision, 1); assert.equal(board.shuffleOrdinal, 1);
});

test('반복 셔플은 항상 완주 가능한 해답을 만든다', () => {
  for (let seed = 0; seed < 40; seed += 1) { const board = createBoard(seed); shuffleRemaining(board, seed); assert.ok(findAnyLegalPair(board.tiles)); assert.equal(verifyGeneratedSolution(board), true); }
});

test('100,000회 가중치가 목표 ±1%p에 든다', () => {
  const counts = Object.fromEntries(Object.keys(ITEM_DEFINITIONS).map((id) => [id, 0])); let pity = 0; let drops = 0;
  for (let ordinal = 1; ordinal <= 100000; ordinal += 1) { const result = rollDrop(42, ordinal, pity); pity = result.pity; if (result.dropped) { counts[result.itemId] += 1; drops += 1; } }
  const totalWeight = Object.values(ITEM_DEFINITIONS).reduce((total, definition) => total + definition.weight, 0);
  for (const [id, definition] of Object.entries(ITEM_DEFINITIONS)) assert.ok(Math.abs(counts[id] / drops * 100 - definition.weight / totalWeight * 100) < 1, `${id} distribution`);
});

test('10,000경기 드롭 기회가 30쌍 7.35~7.70개, 완주 11.55~12.00개 범위다', () => {
  for (const pairs of [30, 48]) { let total = 0; for (let seed = 0; seed < 10000; seed += 1) { let pity = 0; for (let ordinal = 1; ordinal <= pairs; ordinal += 1) { const inputPity = pity; const result = rollDrop(seed, ordinal, inputPity); pity = result.pity; if (result.dropped) total += 1; assert.deepEqual(result, rollDrop(seed, ordinal, inputPity)); } } const average = total / 10000; assert.ok(average >= (pairs === 30 ? 7.35 : 11.55) && average <= (pairs === 30 ? 7.70 : 12.00), `${pairs}: ${average}`); }
});

test('경기는 stale 요청과 중복 요청을 안전하게 처리한다', () => {
  let now = 1000; const game = new SichuanGame({ seed: 4, now: () => now }); game.addPlayer('p1', 'A'); game.addPlayer('p2', 'B'); game.start(); now = 5000; game.tick();
  assert.equal(game.players[0].board.solution, undefined); const legal = findAnyLegalPair(game.players[0].board.tiles); assert.ok(legal); const pair = [legal.a, legal.b];
  const stale = game.matchPair('p1', { requestId: 'stale', matchId: game.matchId, tileAId: pair[0].tileId, tileBId: pair[1].tileId, boardRevision: 9 }); assert.equal(stale.reason, 'STALE_REVISION');
  const intent = { requestId: 'ok', matchId: game.matchId, tileAId: pair[0].tileId, tileBId: pair[1].tileId, boardRevision: 0 }; const accepted = game.matchPair('p1', intent); assert.equal(accepted.ok, true); assert.deepEqual(game.matchPair('p1', intent), accepted); assert.equal(game.players[0].removedPairs, 1); assert.equal(game.matchPair('p1', { ...intent, requestId: 'missing', matchId: undefined }).reason, 'STALE_MATCH');
});

test('서로 다른 세 슬롯은 같은 초기 revision으로 연속 사용되고 요청 재전송은 한 번만 소비한다', () => {
  let now = 0; const game = new SichuanGame({ seed: 8, now: () => now }); const attacker = game.addPlayer('p1', 'A'); const defender = game.addPlayer('p2', 'B'); game.start(); now = 4000; game.tick();
  attacker.inventory = [{ slotId: 'a', itemId: 'lock' }, { slotId: 'b', itemId: 'flip' }, { slotId: 'c', itemId: 'fog' }]; attacker.inventoryRevision = 3;
  const intents = attacker.inventory.map((slot, index) => ({ requestId: `item-${index}`, matchId: game.matchId, slotId: slot.slotId, inventoryRevision: 3 }));
  const results = intents.map((intent) => game.useItem('p1', intent));
  assert.deepEqual(results.map((result) => result.ok), [true, true, true]); assert.equal(attacker.inventory.length, 0); assert.equal(attacker.inventoryRevision, 6); assert.equal(Object.keys(defender.effects).length, 3);
  assert.deepEqual(game.useItem('p1', intents[0]), results[0]); assert.equal(attacker.inventoryRevision, 6); assert.equal(Object.keys(defender.effects).length, 3);
  assert.equal(game.useItem('p1', { ...intents[0], requestId: 'new-request' }).reason, 'STALE_INVENTORY');
});

test('결정적 무작위 방해 대상은 상단 고정이 아니며 기존 같은 효과 타일을 제외한다', () => {
  const board = createBoard(19); const first = chooseTargets(board, 'lock', createPrng(123)); const repeat = chooseTargets(board, 'lock', createPrng(123));
  assert.deepEqual(first, repeat); assert.equal(first.length, 6); assert.ok(first.some((id) => board.tiles.find((tile) => tile.tileId === id).y >= 4));
  board.tiles.find((tile) => tile.tileId === first[0]).locked = true;
  const next = chooseTargets(board, 'lock', createPrng(456)); assert.equal(next.includes(first[0]), false);
});

test('5,000개 시드의 방해 대상은 실제 활성 y행별 최대 편차 1로 균형을 이룬다', () => {
  const board = createBoard(19);
  for (const itemId of ['lock', 'flip', 'fog']) for (let seed = 0; seed < 5000; seed += 1) {
    const ids = chooseTargets(board, itemId, createPrng(seed));
    const rows = Array(8).fill(0);
    for (const tileId of ids) {
      const tile = board.tiles.find((entry) => entry.tileId === tileId);
      rows[tile.y] += 1;
    }
    assert.ok(Math.max(...rows) - Math.min(...rows) <= 1, `${itemId}:${seed}:${rows}`);
  }
});

test('snapshot은 구버전·unknown·잘못된 슬롯을 한 번 정리하고 6종 아이템만 공개한다', () => {
  const game = new SichuanGame({ seed: 14, now: () => 5000 }); const player = game.addPlayer('p1', 'A'); game.addPlayer('p2', 'B'); game.start(); game.tick();
  player.inventory = [
    { slotId: 'legacy', itemId: 'force_shuffle' }, { slotId: 'unknown', itemId: 'banana' }, { slotId: 'missing' },
    { slotId: null, itemId: 'hint' }, { slotId: 'ok', itemId: 'hint' }, { slotId: 'ok', itemId: 'shield' },
  ];
  player.inventoryRevision = 7;
  const first = game.snapshot('p1');
  assert.deepEqual(first.me.inventory, [{ slotId: 'ok', itemId: 'hint' }]);
  assert.equal(first.me.inventoryRevision, 8);
  assert.equal(game.snapshot('p1').me.inventoryRevision, 8);
  assert.equal(game.grantItem('p1', 'force_shuffle'), null);
});

test('방어막은 시간 경과에 무관하게 다음 유효 공격 한 번만 막는다', () => {
  let now = 1000; const game = new SichuanGame({ seed: 15, now: () => now, duration: 1_000_000 }); const attacker = game.addPlayer('p1', 'A'); const defender = game.addPlayer('p2', 'B'); game.start(); now = 5000; game.tick();
  defender.inventory = [{ slotId: 'shield', itemId: 'shield' }]; defender.inventoryRevision = 1;
  assert.equal(game.useItem('p2', { requestId: 'shield', matchId: game.matchId, slotId: 'shield', inventoryRevision: 1 }).ok, true);
  now += 180000; game.tick(); assert.equal(defender.shieldActive, true);
  attacker.inventory = [{ slotId: 'lock', itemId: 'lock' }]; attacker.inventoryRevision = 1;
  const blocked = game.useItem('p1', { requestId: 'attack', matchId: game.matchId, slotId: 'lock', inventoryRevision: 1 });
  assert.equal(blocked.blocked, true); assert.equal(defender.shieldActive, false);
});

test('교착은 선택 상태에서 멈추고 즉시 셔플 선택 시 힌트를 정리해 합법 수를 복구한다', () => {
  let now = 1000; const game = new SichuanGame({ seed: 9, now: () => now }); const player = game.addPlayer('p1', 'A'); game.addPlayer('p2', 'B'); game.start(); now = 4001; game.tick(); player.removedPairs = 46;
  player.board = { revision: 0, shuffleOrdinal: 0, tiles: [{ tileId: 'a', faceId: 1, x: 0, y: 0, removed: false, locked: false }, { tileId: 'b', faceId: 1, x: 1, y: 0, removed: false, locked: false }, { tileId: 'c', faceId: 2, x: 3, y: 0, removed: false, locked: true }, { tileId: 'd', faceId: 2, x: 4, y: 0, removed: false, locked: true }] }; player.effects.h = { effectId: 'h', itemId: 'hint', targets: ['a', 'b'], endsAt: 9000 };
  const result = game.matchPair('p1', { requestId: 'choice', matchId: game.matchId, tileAId: 'a', tileBId: 'b', boardRevision: 0 }); assert.equal(result.deadlock.phase, 'choice'); assert.equal(Object.values(player.effects).some((effect) => effect.itemId === 'hint'), false); const revision = player.board.revision; now += 1000; game.tick(); assert.equal(player.board.revision, revision);
  const decision = { requestId: 'shuffle-now', matchId: game.matchId, deadlockId: result.deadlock.deadlockId, action: 'shuffle' }; const shuffled = game.resolveDeadlock('p1', decision); assert.equal(shuffled.ok, true); assert.equal(shuffled.action, 'shuffle'); assert.equal(player.board.revision, revision + 1); assert.equal(player.pendingAutoShuffle, null); assert.ok(findAnyLegalPair(player.board.tiles)); assert.deepEqual(game.resolveDeadlock('p1', decision), shuffled);
});

test('10,000개 시드가 무작위 분산 통계와 결정성 및 완주 가능성을 만족한다', () => {
  let total = 0; let horizontal = 0; let vertical = 0; let legacy = 0; const fingerprints = new Set();
  for (let seed = 0; seed < 10000; seed += 1) { const board = createBoard(seed); const metrics = measureAdjacency(board.tiles); total += metrics.totalAdjacent; horizontal += metrics.horizontalAdjacent; vertical += metrics.verticalAdjacent; legacy += metrics.legacyHorizontalSlots; fingerprints.add(board.tiles.map((tile) => tile.faceId).join(',')); assert.deepEqual(createBoard(seed), board); assert.equal(verifyGeneratedSolution(board), true, `seed ${seed}`); }
  const totalRate = total / (10000 * 172); const horizontalRate = horizontal / (10000 * 88); const verticalRate = vertical / (10000 * 84); const legacyRate = legacy / (10000 * 48);
  assert.ok(totalRate >= 0.028 && totalRate <= 0.035, `total ${totalRate}`); assert.ok(horizontalRate >= 0.0265 && horizontalRate <= 0.037, `horizontal ${horizontalRate}`); assert.ok(verticalRate >= 0.0265 && verticalRate <= 0.037, `vertical ${verticalRate}`); assert.ok(Math.abs(horizontalRate - verticalRate) <= 0.006, `direction gap ${Math.abs(horizontalRate - verticalRate)}`); assert.ok(legacyRate >= 0.026 && legacyRate <= 0.0375, `legacy ${legacyRate}`); assert.ok(fingerprints.size >= 9990, `fingerprints ${fingerprints.size}`);
});

test('초기 보드 1,000개 생성 성능은 제한 시간 안에 머물다', () => {
  const durations = []; const started = performance.now(); for (let seed = 20000; seed < 21000; seed += 1) { const itemStarted = performance.now(); createBoard(seed); durations.push(performance.now() - itemStarted); }
  const elapsed = performance.now() - started; durations.sort((a, b) => a - b); const median = durations[Math.floor(durations.length * 0.5)]; const p95 = durations[Math.floor(durations.length * 0.95)]; const max = durations.at(-1); console.log(`board benchmark total=${elapsed.toFixed(1)}ms median=${median.toFixed(2)}ms p95=${p95.toFixed(2)}ms max=${max.toFixed(2)}ms`); assert.ok(elapsed < 30000, `total ${elapsed}`); assert.ok(p95 < 50, `p95 ${p95}`); assert.ok(max < 250, `max ${max}`);
});

test('진행 단계별 셔플이 상태와 face 다중집합을 보존하며 결정적인 완주 해답을 만든다', () => {
  for (const seed of [0, 7, 91]) for (const removedPairs of [0, 1, 8, 24, 40, 47]) { const source = createBoard(seed); for (const [a, b] of source.solution.slice(0, removedPairs)) { source.tiles.find((tile) => tile.tileId === a).removed = true; source.tiles.find((tile) => tile.tileId === b).removed = true; } const before = source.tiles.map((tile) => ({ tileId: tile.tileId, x: tile.x, y: tile.y, removed: tile.removed, faceId: tile.faceId })); const first = structuredClone(source); const second = structuredClone(source); shuffleRemaining(first, seed); shuffleRemaining(second, seed); assert.deepEqual(first, second); assert.equal(first.revision, 1); assert.equal(first.shuffleOrdinal, 1); assert.equal(verifyGeneratedSolution(first), true); const activeBefore = before.filter((tile) => !tile.removed).map((tile) => tile.faceId).sort((a, b) => a - b); const activeAfter = first.tiles.filter((tile) => !tile.removed).map((tile) => tile.faceId).sort((a, b) => a - b); assert.deepEqual(activeAfter, activeBefore); first.tiles.forEach((tile, index) => { assert.equal(tile.tileId, before[index].tileId); assert.equal(tile.x, before[index].x); assert.equal(tile.y, before[index].y); assert.equal(tile.removed, before[index].removed); }); }
});

test('독립 보드 복제본 변경은 상대 보드에 영향을 주지 않는다', () => { for (let seed = 0; seed < 20; seed += 1) { const generated = createBoard(seed); const left = structuredClone(generated); const right = structuredClone(generated); left.tiles[0].removed = true; left.tiles[1].faceId = 99; assert.notDeepEqual(left, right); assert.deepEqual(right, generated); } });

test('개인화 스냅샷은 상대 공개 보드를 독립 복제하고 해답을 노출하지 않는다', () => {
  const game = new SichuanGame({ seed: 77, now: () => 1000 }); game.addPlayer('p1', 'A'); game.addPlayer('p2', 'B'); game.start();
  const first = game.snapshot('p1'); assert.ok(first.opponent.board); assert.equal('solution' in first.me.board, false); assert.equal('solution' in first.opponent.board, false);
  assert.notStrictEqual(first.me.board, first.opponent.board); assert.notStrictEqual(first.me.board.tiles, first.opponent.board.tiles);
  first.opponent.board.tiles[0].faceId = 999; assert.notEqual(game.players[1].board.tiles[0].faceId, 999);
});
