import { DEFAULT_STAGE, getStage } from './stages.js';

export const PUZZLE = DEFAULT_STAGE;
export const HINT_ACTION_GRACE_MS = 8_000;
export const RULE_TYPES = Object.freeze({
  speed: Object.freeze({ type: 'speed', difficulty: 'hard', label: '어려움', icon: '🔥', durationMs: 75_000, missPenaltyMs: 7_000, hintPenaltyMs: 12_000, maxHints: 1 }),
  classic: Object.freeze({ type: 'classic', difficulty: 'normal', label: '보통', icon: '✨', durationMs: 90_000, missPenaltyMs: 5_000, hintPenaltyMs: 10_000, maxHints: 2 }),
  relaxed: Object.freeze({ type: 'relaxed', difficulty: 'easy', label: '쉬움', icon: '🌱', durationMs: 120_000, missPenaltyMs: 3_000, hintPenaltyMs: 5_000, maxHints: 3 }),
});

function center(zone) {
  return { x: zone.x + zone.w / 2, y: zone.y + zone.h / 2 };
}

function publicDifference(difference, foundBy = null) {
  return {
    id: difference.id,
    label: difference.label,
    foundBy,
    centers: { a: center(difference.zones.a), b: center(difference.zones.b) },
  };
}

export function createGame(now = Date.now(), stageId = DEFAULT_STAGE.id, ruleType = 'classic') {
  const puzzle = getStage(stageId);
  if (!puzzle) throw new Error(`unknown published stage: ${stageId}`);
  const resolvedRuleType = ruleType || 'classic';
  if (!Object.hasOwn(RULE_TYPES, resolvedRuleType)) throw new Error(`unknown rule type: ${resolvedRuleType}`);
  const rules = RULE_TYPES[resolvedRuleType];
  return {
    puzzle,
    ruleType: resolvedRuleType,
    rules,
    phase: 'playing',
    startedAt: now,
    deadline: now + rules.durationMs,
    found: new Map(),
    hinted: new Map(),
    misses: 0,
    hintsUsed: 0,
  };
}

export function remainingMs(game, now = Date.now()) {
  return Math.max(0, game.deadline - now);
}

export function finishIfExpired(game, now = Date.now()) {
  if (game.phase === 'playing' && remainingMs(game, now) === 0) game.phase = 'lost';
  return game.phase;
}

function contains(zone, x, y) {
  return x >= zone.x && x <= zone.x + zone.w && y >= zone.y && y <= zone.y + zone.h;
}

export function guess(game, { image, x, y, playerId }, now = Date.now()) {
  finishIfExpired(game, now);
  if (game.phase !== 'playing') return { ok: false, error: '게임이 이미 종료되었어요.' };
  if ((image !== 'a' && image !== 'b') || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    return { ok: false, error: '올바르지 않은 클릭이에요.' };
  }

  const hit = game.puzzle.differences.find((difference) => contains(difference.zones[image], x, y));
  if (hit) {
    if (game.found.has(hit.id)) return { ok: true, kind: 'already', difference: publicDifference(hit, game.found.get(hit.id)) };
    game.hinted.delete(hit.id);
    game.found.set(hit.id, playerId);
    if (game.found.size === game.puzzle.differences.length) game.phase = 'won';
    return { ok: true, kind: 'found', difference: publicDifference(hit, playerId) };
  }

  game.misses += 1;
  game.deadline -= game.rules.missPenaltyMs;
  finishIfExpired(game, now);
  return { ok: true, kind: 'miss' };
}

export function useHint(game, playerId, now = Date.now(), random = Math.random) {
  finishIfExpired(game, now);
  if (game.phase !== 'playing') return { ok: false, error: '게임이 진행 중이 아니에요.' };
  if (game.hintsUsed >= game.rules.maxHints) return { ok: false, error: '힌트를 모두 사용했어요.' };
  const remaining = game.puzzle.differences.filter((difference) => !game.found.has(difference.id) && !game.hinted.has(difference.id));
  if (!remaining.length) return { ok: false, error: '남은 정답이 없어요.' };
  const randomIndex = Math.min(remaining.length - 1, Math.max(0, Math.floor(random() * remaining.length)));
  const target = remaining[randomIndex];
  game.hintsUsed += 1;
  game.deadline = Math.max(game.deadline - game.rules.hintPenaltyMs, now + HINT_ACTION_GRACE_MS);
  game.hinted.set(target.id, playerId);
  return { ok: true, difference: publicDifference(target) };
}

export function snapshot(game, now = Date.now(), revealAll = false) {
  finishIfExpired(game, now);
  const differences = revealAll
    ? game.puzzle.differences.map((difference) => publicDifference(difference, game.found.get(difference.id) || null))
    : game.puzzle.differences.filter((difference) => game.found.has(difference.id)).map((difference) => publicDifference(difference, game.found.get(difference.id)));
  const hinted = game.phase === 'playing'
    ? game.puzzle.differences.filter((difference) => game.hinted.has(difference.id)).map((difference) => publicDifference(difference))
    : [];
  return {
    type: 'STATE',
    puzzle: { id: game.puzzle.id, title: game.puzzle.title, imageA: game.puzzle.imageA, imageB: game.puzzle.imageB, total: game.puzzle.differences.length },
    rule: game.rules,
    phase: game.phase,
    remainingMs: remainingMs(game, now),
    misses: game.misses,
    hintsUsed: game.hintsUsed,
    maxHints: game.rules.maxHints,
    found: differences,
    hinted,
    revealAll,
  };
}
