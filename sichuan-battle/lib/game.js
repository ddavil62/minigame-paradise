/**
 * @fileoverview 서버 권위 사천성 경기의 제거, 아이템, 타이머와 결과 상태 전이를 관리한다.
 */
import { createBoard, serializeBoard, shuffleRemaining } from './board.js';
import { findAnyLegalPair, findPath } from './pathfinder.js';
import { ATTACK_ITEMS, ITEM_DEFINITIONS, chooseTargets, isKnownItemId, rollDrop } from './items.js';
import { createPrng, deriveSeed } from './prng.js';

const STORED_EFFECT_ITEMS = new Set(['lock', 'flip', 'fog', 'hint']);
const DEADLOCK_WAIT_MS = 5_000;

/** @param {string} id 플레이어 ID @param {string} name 표시 이름 @returns {object} 경기 플레이어 상태 */
function createPlayer(id, name, isBot = false) {
  return { id, name, board: null, revision: 0, removedPairs: 0, inventory: [], inventoryRevision: 0, pity: 0, dropOrdinal: 0,
    isBot, immuneUntil: 0, shieldActive: false, effects: {}, pendingAutoShuffle: null, requestCache: new Map(), itemUseOrdinal: 0 };
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

  /**
   * 권위 인벤토리에서 잘못된 ID·슬롯·중복·초과 슬롯을 제거한다.
   * @param {object} player 플레이어
   * @returns {void}
   */
  normalizeInventory(player) {
    const seen = new Set();
    const normalized = [];
    for (const slot of Array.isArray(player.inventory) ? player.inventory : []) {
      if (!slot || typeof slot.slotId !== 'string' || !slot.slotId || seen.has(slot.slotId) || !isKnownItemId(slot.itemId) || normalized.length >= 3) continue;
      seen.add(slot.slotId);
      normalized.push({ slotId: slot.slotId, itemId: slot.itemId });
    }
    const changed = !Array.isArray(player.inventory) || normalized.length !== player.inventory.length
      || normalized.some((slot, index) => slot.slotId !== player.inventory[index]?.slotId || slot.itemId !== player.inventory[index]?.itemId);
    if (changed) { player.inventory = normalized; player.inventoryRevision += 1; }
    return changed;
  }

  /** @param {string} playerId 플레이어 ID @param {string} itemId 아이템 ID @param {string} [slotId] 슬롯 ID @returns {object|null} 지급 슬롯 */
  grantItem(playerId, itemId, slotId) {
    const player = this.players.find((entry) => entry.id === playerId);
    if (!player || !isKnownItemId(itemId)) return null;
    this.normalizeInventory(player);
    if (player.inventory.length >= 3) return null;
    const nextSlotId = typeof slotId === 'string' && slotId ? slotId : `s-${player.inventoryRevision + 1}`;
    if (player.inventory.some((slot) => slot.slotId === nextSlotId)) return null;
    const granted = { slotId: nextSlotId, itemId };
    player.inventory.push(granted); player.inventoryRevision += 1;
    return { ...granted };
  }

  /**
   * 권위 효과 상태를 실제 저장 가능한 timed effect 구조로 정규화한다.
   * @param {object} player 플레이어
   * @returns {boolean} 정규화로 변경됐는지 여부
   */
  normalizeEffects(player) {
    const source = player.effects && typeof player.effects === 'object' && !Array.isArray(player.effects) ? player.effects : {};
    const normalized = {};
    for (const [key, effect] of Object.entries(source)) {
      if (!effect || typeof effect !== 'object' || Array.isArray(effect)
        || !STORED_EFFECT_ITEMS.has(effect.itemId) || !Number.isFinite(effect.endsAt)
        || typeof effect.effectId !== 'string' || !effect.effectId) continue;
      const targets = [...new Set((Array.isArray(effect.targets) ? effect.targets : [])
        .filter((tileId) => typeof tileId === 'string' && tileId))];
      const clean = { effectId: effect.effectId, itemId: effect.itemId, targets, endsAt: effect.endsAt };
      if (effect.itemId === 'hint') clean.path = (Array.isArray(effect.path) ? effect.path : [])
        .filter((point) => point && typeof point === 'object' && Number.isFinite(point.x) && Number.isFinite(point.y))
        .map((point) => ({ x: point.x, y: point.y }));
      normalized[key] = clean;
    }
    player.effects = normalized;
  }

  /** @returns {void} 동일 초기 보드로 경기를 시작한다. */
  start() {
    const generated = createBoard(this.seed);
    this.players.forEach((player) => {
      player.board = structuredClone(generated); player.board.solution = undefined; player.revision = 0;
      player.effects = {}; player.immuneUntil = 0; player.shieldActive = false; player.pendingAutoShuffle = null;
    });
    this.startedAt = this.now() + 3000; this.deadlineAt = this.startedAt + this.duration; this.phase = 'countdown';
  }

  /** @param {string} playerId 플레이어 @returns {object|null} 개인화 스냅샷 */
  snapshot(playerId) {
    const me = this.players.find((player) => player.id === playerId); const opponent = this.players.find((player) => player.id !== playerId);
    if (!me) return null;
    this.normalizeInventory(me); if (opponent) this.normalizeInventory(opponent);
    return { matchId: this.matchId, matchSeed: this.seed, phase: this.phase, startedAt: this.startedAt, deadlineAt: this.deadlineAt,
      me: { id: me.id, name: me.name, isBot: me.isBot, board: me.board ? serializeBoard(me.board) : null, removedPairs: me.removedPairs, inventory: me.inventory.map((slot) => ({ ...slot })),
        inventoryRevision: me.inventoryRevision, effects: this.publicEffects(me, true), shieldActive: me.shieldActive,
        deadlock: me.pendingAutoShuffle ? structuredClone(me.pendingAutoShuffle) : null },
      opponent: opponent ? { id: opponent.id, name: opponent.name, isBot: opponent.isBot, board: opponent.board ? serializeBoard(opponent.board) : null, removedPairs: opponent.removedPairs,
        remaining: 96 - opponent.removedPairs * 2, effects: this.publicEffects(opponent, false), shieldActive: opponent.shieldActive, connected: true } : null,
      result: this.result };
  }

  /** @param {object} player 플레이어 @returns {object[]} 공개 효과 */
  publicEffects(player, owner = false) {
    this.normalizeEffects(player);
    return Object.values(player.effects).map((effect) => {
      const visible = { effectId: effect.effectId, itemId: effect.itemId, endsAt: effect.endsAt };
      if (owner && effect.itemId === 'hint') {
        visible.targets = Array.isArray(effect.targets) ? [...effect.targets] : [];
        visible.path = Array.isArray(effect.path) ? structuredClone(effect.path) : [];
      }
      return visible;
    });
  }

  /** @returns {void} 만료 효과와 경기 시간을 정리한다. */
  tick() {
    const now = this.now(); if (this.phase === 'countdown' && now >= this.startedAt) this.phase = 'playing';
    for (const player of this.players) {
      this.normalizeEffects(player);
      for (const [id, effect] of Object.entries(player.effects)) if (effect.endsAt <= now) this.endEffect(player, id);
    }
    for (const player of this.players) {
      const pending = player.pendingAutoShuffle;
      if (!pending) continue;
      // 구버전 테스트/복구 상태의 executeAt 계약은 그대로 수용한다.
      if (pending.executeAt <= now) { this.shufflePlayer(player); player.pendingAutoShuffle = null; continue; }
      if (pending.phase !== 'waiting' || pending.unlockAt > now) continue;
      // 5초 사이 방해 효과가 끝나 합법 수가 돌아왔으면 보드를 섞지 않는다.
      if (!findAnyLegalPair(player.board.tiles)) this.shufflePlayer(player);
      player.pendingAutoShuffle = null;
    }
    if (!this.result && this.phase === 'playing' && now >= this.deadlineAt) this.finishByTime();
  }

  /** @param {object} player 플레이어 @param {string} effectId 효과 ID @returns {void} */
  endEffect(player, effectId) {
    this.normalizeEffects(player);
    const effect = player.effects[effectId]; if (!effect) return;
    delete player.effects[effectId];
    this.recomputeDisruptionFlags(player);
  }

  /** @param {object} player 플레이어 @returns {void} 활성 힌트를 면역 없이 즉시 제거한다. */
  clearHints(player) { this.normalizeEffects(player); for (const [id,effect] of Object.entries(player.effects)) if (effect.itemId === 'hint') delete player.effects[id]; }

  /** @param {object} player 플레이어 @returns {void} 활성 방해 효과에서 타일 플래그를 다시 계산한다. */
  recomputeDisruptionFlags(player) {
    this.normalizeEffects(player);
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

  /**
   * 교착 선택을 서버 권위 상태로 만들고 본인 타일 입력을 잠근다.
   * @param {object} player 플레이어
   * @returns {object} 공개 가능한 교착 상태
   */
  beginDeadlock(player) {
    const detectedAt = this.now();
    const deadlock = { deadlockId: `${this.matchId}-deadlock-${player.id}-${detectedAt}-${player.board.revision}`, phase: 'choice', detectedAt, unlockAt: null };
    player.pendingAutoShuffle = deadlock;
    return structuredClone(deadlock);
  }

  /**
   * 교착 상태에서 즉시 셔플 또는 정확히 5초 입력 잠금을 선택한다.
   * @param {string} playerId 플레이어 ID
   * @param {{requestId:string,matchId:string,deadlockId:string,action:string}} intent 선택 의도
   * @returns {object} 처리 결과
   */
  resolveDeadlock(playerId, intent) {
    this.tick();
    const player = this.players.find((entry) => entry.id === playerId);
    if (!player) return { ok: false, reason: 'NOT_JOINED', requestId: intent.requestId };
    if (!intent.matchId || intent.matchId !== this.matchId) return { ok: false, reason: 'STALE_MATCH', requestId: intent.requestId };
    const cacheKey = `${this.matchId}:deadlock:${intent.requestId}`;
    if (player.requestCache.has(cacheKey)) return player.requestCache.get(cacheKey);
    const pending = player.pendingAutoShuffle;
    let result;
    if (this.phase !== 'playing') result = { ok: false, reason: this.result ? 'MATCH_ENDED' : 'NOT_PLAYING' };
    else if (!pending || pending.deadlockId !== intent.deadlockId) result = { ok: false, reason: 'STALE_DEADLOCK' };
    else if (pending.phase !== 'choice') result = { ok: false, reason: 'DEADLOCK_ALREADY_RESOLVED' };
    else if (intent.action === 'shuffle') {
      this.shufflePlayer(player);
      player.pendingAutoShuffle = null;
      result = { ok: true, action: 'shuffle', revision: player.board.revision, deadlock: null };
    } else if (intent.action === 'wait') {
      pending.phase = 'waiting';
      pending.unlockAt = this.now() + DEADLOCK_WAIT_MS;
      result = { ok: true, action: 'wait', deadlock: structuredClone(pending) };
    } else result = { ok: false, reason: 'INVALID_DEADLOCK_ACTION' };
    result.requestId = intent.requestId;
    result.matchId = this.matchId;
    player.requestCache.set(cacheKey, result);
    if (player.requestCache.size > 128) player.requestCache.delete(player.requestCache.keys().next().value);
    return result;
  }

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
          if (drop.dropped) granted = this.grantItem(player.id, drop.itemId);
          let deadlock = null;
          if (player.removedPairs < 48 && !findAnyLegalPair(player.board.tiles)) deadlock = this.beginDeadlock(player);
          result = { ok: true, requestId: intent.requestId, removed: [a.tileId, b.tileId], path: route.path, revision: player.board.revision,
            removedPairs: player.removedPairs, granted, inventoryRevision: player.inventoryRevision, shuffled:false, deadlock };
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
    this.normalizeInventory(player); this.normalizeInventory(target);
    const slotIndex = player.inventory.findIndex((slot) => slot.slotId === intent.slotId); const slot = player.inventory[slotIndex];
    let result;
    let attackTargets = null;
    let existingAttack = null;
    if (slot && ATTACK_ITEMS.has(slot.itemId)) {
      this.normalizeEffects(target);
      existingAttack = Object.values(target.effects).find((effect) => effect.itemId === slot.itemId) || null;
      if (existingAttack) attackTargets = [...existingAttack.targets];
      else {
        const random = createPrng(deriveSeed(this.seed, `item:${player.id}:${player.itemUseOrdinal + 1}:${slot.itemId}`));
        attackTargets = chooseTargets(target.board, slot.itemId, random);
      }
    }
    if (!slot || !ITEM_DEFINITIONS[slot.itemId]) result = { ok: false, reason: 'STALE_INVENTORY' };
    else if (slot.itemId === 'hint' && (player.pendingAutoShuffle || !findAnyLegalPair(player.board.tiles))) result = { ok: false, reason: 'NO_HINT_AVAILABLE' };
    else if (ATTACK_ITEMS.has(slot.itemId) && target.immuneUntil > now) result = { ok: false, reason: 'IMMUNE' };
    else if (ATTACK_ITEMS.has(slot.itemId) && !attackTargets.length) result = { ok: false, reason: 'NO_VALID_TARGET' };
    else {
      player.inventory.splice(slotIndex, 1); player.inventoryRevision += 1; player.itemUseOrdinal += 1;
      const effectId = `${this.matchId}-${slot.itemId}-${player.itemUseOrdinal}`; let blocked = false; let targets = [];
      if (ATTACK_ITEMS.has(slot.itemId) && target.shieldActive) { target.shieldActive = false; blocked = true; }
      else if (slot.itemId === 'shield') player.shieldActive = true;
      else if (slot.itemId === 'cleanse') { for (const [id, effect] of Object.entries(player.effects)) if (ATTACK_ITEMS.has(effect.itemId)) delete player.effects[id]; this.recomputeDisruptionFlags(player); player.immuneUntil = now + 3000; }
      else if (slot.itemId === 'hint') {
        this.clearHints(player);
        const pair = findAnyLegalPair(player.board.tiles); targets = pair ? [pair.a.tileId, pair.b.tileId] : [];
        player.effects[effectId] = { effectId, itemId: slot.itemId, targets, path: pair?.path, endsAt: this.deadlineAt };
      }
      else if (!blocked) {
        targets = [...attackTargets];
        if (existingAttack) existingAttack.endsAt = now + ITEM_DEFINITIONS[slot.itemId].duration;
        else target.effects[effectId] = { effectId, itemId: slot.itemId, targets, endsAt: now + ITEM_DEFINITIONS[slot.itemId].duration };
        this.recomputeDisruptionFlags(target);
      }
      result = { ok: true, requestId: intent.requestId, slotId: intent.slotId, itemId: slot.itemId, inventoryRevision: player.inventoryRevision,
        blocked, refreshed: Boolean(existingAttack && !blocked), effectId: existingAttack && !blocked ? existingAttack.effectId : effectId, targets };
    }
    result.requestId ||= intent.requestId; result.slotId ||= intent.slotId;
    player.requestCache.set(cacheKey, result); if (player.requestCache.size > 128) player.requestCache.delete(player.requestCache.keys().next().value); return result;
  }

  /** @param {string|null} winnerId 승자 @param {string} reason 사유 @returns {void} */
  finish(winnerId, reason) {
    if (this.result) return;
    this.players.forEach((player) => { this.clearHints(player); player.shieldActive = false; player.pendingAutoShuffle = null; });
    this.phase = 'result'; this.result = { winnerId, reason, scores: this.players.map((player) => ({ id: player.id, removedPairs: player.removedPairs })) };
  }

  /** @returns {void} 시간 점수로 결과를 정한다. */
  finishByTime() { const [a, b] = this.players; this.finish(a.removedPairs === b.removedPairs ? null : (a.removedPairs > b.removedPairs ? a.id : b.id), a.removedPairs === b.removedPairs ? 'time_draw' : 'time_score'); }
}
