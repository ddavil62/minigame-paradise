/**
 * @fileoverview 서버 권위 사천성 경기의 제거, 아이템, 타이머와 결과 상태 전이를 관리한다.
 */
import { createBoard, serializeBoard, shuffleRemaining } from './board.js';
import { findAnyLegalPair, findPath } from './pathfinder.js';
import { ATTACK_ITEMS, ITEM_DEFINITIONS, chooseTargets, rollDrop } from './items.js';
import { createPrng, deriveSeed } from './prng.js';

/** @param {string} id 플레이어 ID @param {string} name 표시 이름 @returns {object} 경기 플레이어 상태 */
function createPlayer(id, name, isBot = false) {
  return { id, name, board: null, revision: 0, removedPairs: 0, inventory: [], inventoryRevision: 0, pity: 0, dropOrdinal: 0,
    isBot, immuneUntil: 0, shieldUntil: 0, effects: {}, pendingAutoShuffle: null, requestCache: new Map(), itemUseOrdinal: 0 };
}

export class SichuanGame {
  /** @param {{seed?:number,now?:()=>number,duration?:number}} [options] 테스트 및 경기 옵션 */
  constructor(options = {}) {
    this.now = options.now || Date.now; this.duration = options.duration || 180000;
    this.seed = options.seed ?? Math.floor(Math.random() * 0xffffffff); this.matchId = `m-${this.seed}-${this.now()}`;
    this.phase = 'waiting'; this.players = []; this.startedAt = 0; this.deadlineAt = 0; this.result = null;
  }

  /** @param {string} id ID @param {string} name 이름 @param {boolean} [isBot=false] AI 여부 @returns {object} 생성된 상태 */
  addPlayer(id, name, isBot = false) { const player = createPlayer(id, name, isBot); this.players.push(player); return player; }

  /** @returns {void} 동일 초기 보드로 경기를 시작한다. */
  start() {
    const generated = createBoard(this.seed);
    this.players.forEach((player) => { player.board = structuredClone(generated); player.board.solution = undefined; player.revision = 0; });
    this.startedAt = this.now() + 3000; this.deadlineAt = this.startedAt + this.duration; this.phase = 'countdown';
  }

  /** @param {string} playerId 플레이어 @returns {object|null} 개인화 스냅샷 */
  snapshot(playerId) {
    const me = this.players.find((player) => player.id === playerId); const opponent = this.players.find((player) => player.id !== playerId);
    if (!me) return null;
    return { matchId: this.matchId, matchSeed: this.seed, phase: this.phase, startedAt: this.startedAt, deadlineAt: this.deadlineAt,
      me: { id: me.id, name: me.name, isBot: me.isBot, board: me.board ? serializeBoard(me.board) : null, removedPairs: me.removedPairs, inventory: me.inventory,
        inventoryRevision: me.inventoryRevision, effects: this.publicEffects(me, true), shieldUntil: me.shieldUntil, shuffleWarning: me.pendingAutoShuffle },
      opponent: opponent ? { id: opponent.id, name: opponent.name, isBot: opponent.isBot, board: opponent.board ? serializeBoard(opponent.board) : null, removedPairs: opponent.removedPairs,
        remaining: 96 - opponent.removedPairs * 2, effects: this.publicEffects(opponent, false), shieldUntil: opponent.shieldUntil, connected: true } : null,
      result: this.result };
  }

  /** @param {object} player 플레이어 @returns {object[]} 공개 효과 */
  publicEffects(player, owner = false) {
    return Object.values(player.effects).map((effect) => {
      const visible = { effectId: effect.effectId, itemId: effect.itemId, endsAt: effect.endsAt };
      if (owner && effect.itemId === 'hint') visible.targets = [...(effect.targets || [])];
      return visible;
    });
  }

  /** @returns {void} 만료 효과와 경기 시간을 정리한다. */
  tick() {
    const now = this.now(); if (this.phase === 'countdown' && now >= this.startedAt) this.phase = 'playing';
    for (const player of this.players) if (player.pendingAutoShuffle?.executeAt <= now) { this.shufflePlayer(player); player.pendingAutoShuffle = null; }
    for (const player of this.players) for (const [id, effect] of Object.entries(player.effects)) if (effect.endsAt <= now) this.endEffect(player, id);
    if (!this.result && this.phase === 'playing' && now >= this.deadlineAt) this.finishByTime();
  }

  /** @param {object} player 플레이어 @param {string} effectId 효과 ID @returns {void} */
  endEffect(player, effectId) {
    const effect = player.effects[effectId]; if (!effect) return;
    delete player.effects[effectId];
    this.recomputeDisruptionFlags(player);
  }

  /** @param {object} player 플레이어 @returns {void} 활성 힌트를 면역 없이 즉시 제거한다. */
  clearHints(player) { for (const [id,effect] of Object.entries(player.effects)) if (effect.itemId === 'hint') delete player.effects[id]; }

  /** @param {object} player 플레이어 @returns {void} 활성 방해 효과에서 타일 플래그를 다시 계산한다. */
  recomputeDisruptionFlags(player) {
    player.board.tiles.forEach((tile) => { tile.locked = false; tile.flipped = false; tile.fogged = false; });
    for (const effect of Object.values(player.effects)) {
      const key = effect.itemId === 'lock' ? 'locked' : effect.itemId === 'flip' ? 'flipped' : effect.itemId === 'fog' ? 'fogged' : null;
      if (!key) continue;
      const targets = new Set(effect.targets || []);
      player.board.tiles.forEach((tile) => { if (targets.has(tile.tileId) && !tile.removed) tile[key] = true; });
    }
  }

  /** @param {object} player 플레이어 @returns {void} 모든 셔플이 공유하는 힌트 정리와 재배치 진입점. */
  shufflePlayer(player) { this.clearHints(player); shuffleRemaining(player.board,this.seed); this.recomputeDisruptionFlags(player); }

  /** @param {string} playerId 플레이어 @param {object} intent 제거 의도 @returns {object} 처리 결과 */
  matchPair(playerId, intent) {
    this.tick(); const player = this.players.find((entry) => entry.id === playerId);
    if (!player) return { ok: false, reason: 'NOT_JOINED' };
    if (!intent.matchId || intent.matchId !== this.matchId) return { ok:false, reason:'STALE_MATCH' };
    const cacheKey=`${this.matchId}:${intent.requestId}`;
    if (player.requestCache.has(cacheKey)) return player.requestCache.get(cacheKey);
    let result;
    if (this.phase !== 'playing') result = { ok: false, reason: this.result ? 'MATCH_ENDED' : 'NOT_PLAYING' };
    else if (player.pendingAutoShuffle) result = { ok:false, reason:'SHUFFLE_PENDING' };
    else if (intent.boardRevision !== player.board.revision) result = { ok: false, reason: 'STALE_REVISION', authoritativeRevision: player.board.revision };
    else {
      const a = player.board.tiles.find((tile) => tile.tileId === intent.tileAId); const b = player.board.tiles.find((tile) => tile.tileId === intent.tileBId);
      if (!a || !b || a === b || a.removed || b.removed) result = { ok: false, reason: 'INVALID_TILE' };
      else if (a.locked || b.locked) result = { ok: false, reason: 'LOCKED' };
      else if (a.faceId !== b.faceId) result = { ok: false, reason: 'FACE_MISMATCH' };
      else {
        const route = findPath(player.board.tiles, a.tileId, b.tileId);
        if (!route) result = { ok: false, reason: 'NO_PATH' };
        else {
          a.removed = true; b.removed = true; player.board.revision += 1; player.removedPairs += 1; player.dropOrdinal += 1;
          const removedIds=new Set([a.tileId,b.tileId]);for(const [id,effect] of Object.entries(player.effects))if(effect.itemId==='hint'&&effect.targets?.some((targetId)=>removedIds.has(targetId)))delete player.effects[id];
          const drop = rollDrop(this.seed, player.dropOrdinal, player.pity); player.pity = drop.pity; let granted = null;
          if (drop.dropped && player.inventory.length < 3) { granted = { slotId: `s-${player.inventoryRevision + 1}`, itemId: drop.itemId }; player.inventory.push(granted); player.inventoryRevision += 1; }
          let shuffleWarning = null;
          if (player.removedPairs < 48 && !findAnyLegalPair(player.board.tiles)) { const effectId=`${this.matchId}-auto-shuffle-${this.now()}`;shuffleWarning={effectId,executeAt:this.now()+450,reason:'auto'};player.pendingAutoShuffle=shuffleWarning; }
          result = { ok: true, requestId: intent.requestId, removed: [a.tileId, b.tileId], path: route.path, revision: player.board.revision,
            removedPairs: player.removedPairs, granted, inventoryRevision: player.inventoryRevision, shuffled:false, shuffleWarning };
          if (player.removedPairs === 48) this.finish(player.id, 'board_clear');
        }
      }
    }
    player.requestCache.set(cacheKey, result); if (player.requestCache.size > 128) player.requestCache.delete(player.requestCache.keys().next().value);
    return result;
  }

  /** @param {string} playerId 플레이어 @param {object} intent 사용 의도 @returns {object} 결과 */
  useItem(playerId, intent) {
    this.tick(); const player = this.players.find((entry) => entry.id === playerId); const target = this.players.find((entry) => entry.id !== playerId); const now = this.now();
    if (!player || !target || this.phase !== 'playing') return { ok: false, reason: 'NOT_PLAYING' };
    if (!intent.matchId || intent.matchId !== this.matchId) return { ok:false, reason:'STALE_MATCH' };
    const cacheKey=`${this.matchId}:${intent.requestId}`;
    if (player.requestCache.has(cacheKey)) return player.requestCache.get(cacheKey);
    const slotIndex = player.inventory.findIndex((slot) => slot.slotId === intent.slotId); const slot = player.inventory[slotIndex];
    let result;
    if (!slot || !ITEM_DEFINITIONS[slot.itemId]) result = { ok: false, reason: 'STALE_INVENTORY' };
    else if (slot.itemId === 'hint' && (player.pendingAutoShuffle || !findAnyLegalPair(player.board.tiles))) result = { ok: false, reason: 'NO_HINT_AVAILABLE' };
    else if (slot.itemId === 'shield' && player.shieldUntil > now) result = { ok: false, reason: 'ALREADY_ACTIVE' };
    else if (ATTACK_ITEMS.has(slot.itemId) && target.immuneUntil > now) result = { ok: false, reason: 'IMMUNE' };
    else {
      player.inventory.splice(slotIndex, 1); player.inventoryRevision += 1; player.itemUseOrdinal += 1;
      const effectId = `${this.matchId}-${slot.itemId}-${player.itemUseOrdinal}`; let blocked = false; let targets = [];
      if (ATTACK_ITEMS.has(slot.itemId) && target.shieldUntil > now) { target.shieldUntil = 0; blocked = true; }
      else if (slot.itemId === 'shield') player.shieldUntil = now + ITEM_DEFINITIONS.shield.duration;
      else if (slot.itemId === 'cleanse') { for (const id of Object.keys(player.effects)) delete player.effects[id]; this.recomputeDisruptionFlags(player); player.immuneUntil = now + 3000; }
      else if (slot.itemId === 'hint') { const pair = findAnyLegalPair(player.board.tiles); targets = pair ? [pair.a.tileId, pair.b.tileId] : []; player.effects[effectId] = { effectId, itemId: slot.itemId, targets, path: pair?.path, endsAt: now + 3000 }; }
      else if (!blocked) {
        const random = createPrng(deriveSeed(this.seed, `item:${player.id}:${player.itemUseOrdinal}:${slot.itemId}`));
        targets = chooseTargets(target.board, slot.itemId, random);
        target.effects[effectId] = { effectId, itemId: slot.itemId, targets, endsAt: now + ITEM_DEFINITIONS[slot.itemId].duration };
        this.recomputeDisruptionFlags(target);
      }
      result = { ok: true, requestId: intent.requestId, itemId: slot.itemId, inventoryRevision: player.inventoryRevision, blocked, effectId, targets };
    }
    player.requestCache.set(cacheKey, result); if (player.requestCache.size > 128) player.requestCache.delete(player.requestCache.keys().next().value); return result;
  }

  /** @param {string|null} winnerId 승자 @param {string} reason 사유 @returns {void} */
  finish(winnerId, reason) { if (this.result) return; this.phase = 'result'; this.result = { winnerId, reason, scores: this.players.map((player) => ({ id: player.id, removedPairs: player.removedPairs })) }; }

  /** @returns {void} 시간 점수로 결과를 정한다. */
  finishByTime() { const [a, b] = this.players; this.finish(a.removedPairs === b.removedPairs ? null : (a.removedPairs > b.removedPairs ? a.id : b.id), a.removedPairs === b.removedPairs ? 'time_draw' : 'time_score'); }
}
