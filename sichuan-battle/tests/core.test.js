/**
 * @fileoverview 사천성 보드, 경로, 아이템과 경기 상태의 핵심 회귀 테스트.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, measureAdjacency, shuffleRemaining } from '../lib/board.js';
import { findAnyLegalPair, findPath } from '../lib/pathfinder.js';
import { verifyGeneratedSolution } from '../lib/solver.js';
import { ITEM_DEFINITIONS, rollDrop } from '../lib/items.js';
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
  for (const [id, definition] of Object.entries(ITEM_DEFINITIONS)) assert.ok(Math.abs(counts[id] / drops * 100 - definition.weight) < 1, `${id} distribution`);
});

test('10,000경기 드롭 기회가 30쌍 22~24개, 완주 35~38개 범위다', () => {
  for (const pairs of [30, 48]) { let total = 0; for (let seed = 0; seed < 10000; seed += 1) { let pity = 0; for (let ordinal = 1; ordinal <= pairs; ordinal += 1) { const inputPity = pity; const result = rollDrop(seed, ordinal, inputPity); pity = result.pity; if (result.dropped) total += 1; assert.deepEqual(result, rollDrop(seed, ordinal, inputPity)); } } const average = total / 10000; assert.ok(average >= (pairs === 30 ? 22 : 35) && average <= (pairs === 30 ? 24 : 38), `${pairs}: ${average}`); }
});

test('경기는 stale 요청과 중복 요청을 안전하게 처리한다', () => {
  let now = 1000; const game = new SichuanGame({ seed: 4, now: () => now }); game.addPlayer('p1', 'A'); game.addPlayer('p2', 'B'); game.start(); now = 5000; game.tick();
  assert.equal(game.players[0].board.solution, undefined); const legal = findAnyLegalPair(game.players[0].board.tiles); assert.ok(legal); const pair = [legal.a, legal.b];
  const stale = game.matchPair('p1', { requestId: 'stale', matchId: game.matchId, tileAId: pair[0].tileId, tileBId: pair[1].tileId, boardRevision: 9 }); assert.equal(stale.reason, 'STALE_REVISION');
  const intent = { requestId: 'ok', matchId: game.matchId, tileAId: pair[0].tileId, tileBId: pair[1].tileId, boardRevision: 0 }; const accepted = game.matchPair('p1', intent); assert.equal(accepted.ok, true); assert.deepEqual(game.matchPair('p1', intent), accepted); assert.equal(game.players[0].removedPairs, 1); assert.equal(game.matchPair('p1', { ...intent, requestId: 'missing', matchId: undefined }).reason, 'STALE_MATCH');
});

test('강제 셔플은 0.8초 경고 후 실행하고 정화하면 취소한다', () => {
  let now = 0; const game = new SichuanGame({ seed: 8, now: () => now }); const attacker = game.addPlayer('p1', 'A'); const defender = game.addPlayer('p2', 'B'); game.start(); now = 4000; game.tick(); attacker.inventory = [{ slotId: 'attack', itemId: 'force_shuffle' }]; attacker.inventoryRevision = 1;
  const warned = game.useItem('p1', { requestId: 'force', matchId: game.matchId, slotId: 'attack', inventoryRevision: 1 }); assert.equal(warned.ok, true); assert.ok(Object.values(defender.effects).some((effect) => effect.itemId === 'force_shuffle')); const revision = defender.board.revision; now = 4799; game.tick(); assert.equal(defender.board.revision, revision); now = 4801; game.tick(); assert.equal(defender.board.revision, revision + 1);
  attacker.cooldownUntil = 0; attacker.attackCooldownUntil = 0; defender.shuffleImmuneUntil = 0; attacker.inventory = [{ slotId: 'again', itemId: 'force_shuffle' }]; attacker.inventoryRevision += 1; game.useItem('p1', { requestId: 'force2', matchId: game.matchId, slotId: 'again', inventoryRevision: attacker.inventoryRevision }); defender.inventory = [{ slotId: 'clean', itemId: 'cleanse' }]; defender.inventoryRevision = 1; game.useItem('p2', { requestId: 'cleanse', matchId: game.matchId, slotId: 'clean', inventoryRevision: 1 }); const before = defender.board.revision; now += 900; game.tick(); assert.equal(defender.board.revision, before);
});

test('자동 교차는 450ms 경고 후 힌트를 정리하고 합법 수를 복구한다', () => {
  let now = 1000; const game = new SichuanGame({ seed: 9, now: () => now }); const player = game.addPlayer('p1', 'A'); game.addPlayer('p2', 'B'); game.start(); now = 4001; game.tick(); player.removedPairs = 46;
  player.board = { revision: 0, shuffleOrdinal: 0, tiles: [{ tileId: 'a', faceId: 1, x: 0, y: 0, removed: false, locked: false }, { tileId: 'b', faceId: 1, x: 1, y: 0, removed: false, locked: false }, { tileId: 'c', faceId: 2, x: 3, y: 0, removed: false, locked: true }, { tileId: 'd', faceId: 2, x: 4, y: 0, removed: false, locked: true }] }; player.effects.h = { effectId: 'h', itemId: 'hint', targets: ['a', 'b'], endsAt: 9000 };
  const result = game.matchPair('p1', { requestId: 'auto', matchId: game.matchId, tileAId: 'a', tileBId: 'b', boardRevision: 0 }); assert.ok(result.shuffleWarning); assert.equal(result.shuffleWarning.executeAt, now + 450); assert.equal(Object.values(player.effects).some((effect) => effect.itemId === 'hint'), false); const revision = player.board.revision; now += 449; game.tick(); assert.equal(player.board.revision, revision); now += 2; game.tick(); assert.equal(player.board.revision, revision + 1); assert.equal(player.pendingAutoShuffle, null); assert.ok(findAnyLegalPair(player.board.tiles));
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
