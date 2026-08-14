/**
 * @fileoverview 끝말잇기 배틀의 서버 권위 순수 게임 로직.
 * 단어 검증, 두 단계 턴 상태, 전투 계산과 승패 판정을 한곳에서 관리한다.
 */

import { isKorean, getLastSyllable, matchesStartChar, computeDeadEndAlts, getDueumAlt } from './words.js';
import { COMBAT_CONFIG, TURN_STATE } from './combat-config.js';

export { COMBAT_CONFIG, TURN_STATE } from './combat-config.js';
export const INITIAL_HP = COMBAT_CONFIG.player.maxHp;
export const TIMER_PENALTY = COMBAT_CONFIG.timers.wordTimeoutHpPenalty;
export const TURN_TIMER_SEC = COMBAT_CONFIG.player.baseAnswerTimeSec;
export const REWARD_TIMER_SEC = COMBAT_CONFIG.timers.rewardSelectSec;

function opponentOf(playerId) {
  return playerId === 'p1' ? 'p2' : 'p1';
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resolveStartAlts(syllable, followerCountMap) {
  if (!followerCountMap || !syllable) return { alts: null, expanded: false };
  const deadEndAlts = computeDeadEndAlts(syllable, followerCountMap);
  if (deadEndAlts !== null) return { alts: deadEndAlts, expanded: true };
  const dueumAlt = getDueumAlt(syllable);
  return dueumAlt
    ? { alts: new Set([syllable, dueumAlt]), expanded: false }
    : { alts: null, expanded: false };
}

function createPlayer(id, name) {
  return {
    id,
    name: name || (id === 'p1' ? '플레이어1' : '플레이어2'),
    hp: COMBAT_CONFIG.player.maxHp,
    attack: COMBAT_CONFIG.player.initialAttack,
    defense: COMBAT_CONFIG.player.initialDefense,
    answerTimeModifier: 0,
    nextTurnTimeModifier: 0,
  };
}

export function createGame(p1Name, p2Name, firstTurn = 'p1', initialSyllable = null, followerCountMap = null) {
  const validInitialSyllable = typeof initialSyllable === 'string' && initialSyllable.length === 1
    ? initialSyllable
    : null;
  const { alts } = resolveStartAlts(validInitialSyllable, followerCountMap);
  return {
    phase: 'waiting',
    turnState: TURN_STATE.WORD_INPUT,
    players: {
      p1: createPlayer('p1', p1Name),
      p2: createPlayer('p2', p2Name),
    },
    chain: { lastWord: null, lastSyllable: validInitialSyllable, deadEndAlts: alts },
    turn: firstTurn === 'p2' ? 'p2' : 'p1',
    pendingCombat: null,
    usedWords: new Set(),
    winner: null,
    loser: null,
    reason: null,
  };
}

export function getWordEffect(wordOrLength) {
  const length = typeof wordOrLength === 'string'
    ? [...wordOrLength.normalize('NFC')].length
    : Math.max(0, Math.floor(Number(wordOrLength) || 0));
  return COMBAT_CONFIG.wordEffects.find((effect) => (
    length >= effect.minLength && (effect.maxLength === null || length <= effect.maxLength)
  )) || null;
}

export function getReward(rewardId) {
  return COMBAT_CONFIG.rewards.find((reward) => reward.id === rewardId) || null;
}

/** 설정된 보상 중 중복 없이 이번 턴에 노출할 후보를 뽑는다. */
export function drawRewardOptions(random = Math.random) {
  const pool = COMBAT_CONFIG.rewards.map((reward) => reward.id);
  const count = Math.min(COMBAT_CONFIG.timers.rewardOptionCount, pool.length);
  const options = [];
  while (options.length < count) {
    const picked = Math.floor(Math.max(0, Math.min(0.999999, Number(random()) || 0)) * pool.length);
    options.push(pool.splice(picked, 1)[0]);
  }
  return options;
}

export function getBaseAnswerTime(player) {
  return clamp(
    COMBAT_CONFIG.player.baseAnswerTimeSec + (Number(player?.answerTimeModifier) || 0),
    COMBAT_CONFIG.player.minAnswerTimeSec,
    COMBAT_CONFIG.player.maxAnswerTimeSec,
  );
}

export function getEffectiveAnswerTime(player) {
  return clamp(
    getBaseAnswerTime(player) + (Number(player?.nextTurnTimeModifier) || 0),
    COMBAT_CONFIG.player.minAnswerTimeSec,
    COMBAT_CONFIG.player.maxAnswerTimeSec,
  );
}

function applyAnswerTimeDelta(player, delta) {
  const next = clamp(
    getBaseAnswerTime(player) + delta,
    COMBAT_CONFIG.player.minAnswerTimeSec,
    COMBAT_CONFIG.player.maxAnswerTimeSec,
  );
  player.answerTimeModifier = next - COMBAT_CONFIG.player.baseAnswerTimeSec;
  return next;
}

export function calculateDamage({ baseWordDamage, attackerAttack, bonusDamage = 0, defenderDefense }) {
  return Math.max(
    COMBAT_CONFIG.damage.minimum,
    (Number(baseWordDamage) || 0)
      + (Number(attackerAttack) || 0)
      + (Number(bonusDamage) || 0)
      - (Number(defenderDefense) || 0),
  );
}

export function submitWord(game, playerId, word, wordSet, followerCountMap, random = Math.random) {
  const player = game.players[playerId];
  if (!player) return { ok: false, reason: 'invalid' };
  if (game.turn !== playerId) return { ok: false, reason: 'not_your_turn' };
  if (game.turnState !== TURN_STATE.WORD_INPUT) return { ok: false, reason: 'wrong_state' };

  const normalizedWord = typeof word === 'string' ? word.normalize('NFC') : word;
  if (!isKorean(normalizedWord)) return { ok: false, reason: 'not_korean' };
  if (!wordSet.has(normalizedWord)) return { ok: false, reason: 'invalid' };
  if (game.usedWords.has(normalizedWord)) return { ok: false, reason: 'duplicate' };

  const startChar = normalizedWord[0];
  const chain = game.chain;
  if (chain.lastSyllable) {
    const validStart = chain.deadEndAlts
      ? chain.deadEndAlts.has(startChar)
      : matchesStartChar(startChar, chain.lastSyllable);
    if (!validStart) return { ok: false, reason: 'wrong_start' };
  }

  const wordEffect = getWordEffect(normalizedWord);
  if (!wordEffect) return { ok: false, reason: 'unsupported_length' };

  game.usedWords.add(normalizedWord);
  chain.lastWord = normalizedWord;
  chain.lastSyllable = getLastSyllable(normalizedWord);
  const resolved = resolveStartAlts(chain.lastSyllable, followerCountMap);
  chain.deadEndAlts = resolved.alts;

  // 일회성 시간 압박은 답변 단계가 끝나는 순간 소비한다.
  player.nextTurnTimeModifier = 0;
  game.pendingCombat = {
    playerId,
    word: normalizedWord,
    wordLength: [...normalizedWord].length,
    wordEffectId: wordEffect.id,
    rewardOptions: drawRewardOptions(random),
  };
  game.turnState = TURN_STATE.REWARD_SELECT;

  return {
    ok: true,
    word: normalizedWord,
    wordLength: game.pendingCombat.wordLength,
    wordEffect,
    newLastSyllable: chain.lastSyllable,
    deadEndExpanded: resolved.expanded,
    nextState: game.turnState,
  };
}

/**
 * 현재 제출 단어와 선택 보상을 한 번에 확정한다. Damage 공식은 calculateDamage 한 곳만 사용한다.
 */
export function resolveCombatTurn(game, playerId, rewardId = null) {
  if (game.turn !== playerId) return { ok: false, reason: 'not_your_turn' };
  if (game.turnState !== TURN_STATE.REWARD_SELECT || game.pendingCombat?.playerId !== playerId) {
    return { ok: false, reason: 'wrong_state' };
  }
  const reward = rewardId === null ? null : getReward(rewardId);
  if (rewardId !== null && !reward) return { ok: false, reason: 'invalid_reward' };
  if (rewardId !== null && !game.pendingCombat.rewardOptions?.includes(rewardId)) {
    return { ok: false, reason: 'reward_not_offered' };
  }

  const attacker = game.players[playerId];
  const defenderId = opponentOf(playerId);
  const defender = game.players[defenderId];
  const wordEffect = COMBAT_CONFIG.wordEffects.find((effect) => effect.id === game.pendingCombat.wordEffectId);
  const bonusDamage = reward?.effectType === 'bonus_damage' ? reward.amount : 0;
  // 공격 강화는 이번 선택으로 즉시 획득하므로 현재 공격부터 Damage에 반영한다.
  const rewardAttack = reward?.effectType === 'self_attack' ? reward.amount : 0;
  const damage = calculateDamage({
    baseWordDamage: wordEffect.baseDamage,
    attackerAttack: attacker.attack + rewardAttack,
    bonusDamage,
    defenderDefense: defender.defense,
  });

  defender.hp = Math.max(0, defender.hp - damage);
  const changes = {
    attackerAttack: 0,
    attackerDefense: 0,
    attackerHeal: 0,
    attackerAnswerTime: 0,
    defenderAnswerTime: 0,
    defenderNextTime: 0,
  };

  if (reward) {
    switch (reward.effectType) {
      case 'self_attack':
        attacker.attack += reward.amount;
        changes.attackerAttack += reward.amount;
        break;
      case 'self_defense':
        attacker.defense += reward.amount;
        changes.attackerDefense += reward.amount;
        break;
      case 'self_heal': {
        if (!reward.requiresDamage || damage > 0) {
          const before = attacker.hp;
          attacker.hp = Math.min(COMBAT_CONFIG.player.maxHp, attacker.hp + reward.amount);
          changes.attackerHeal += attacker.hp - before;
        }
        break;
      }
      case 'opponent_next_time':
        defender.nextTurnTimeModifier = reward.amount;
        changes.defenderNextTime = reward.amount;
        break;
      case 'opponent_answer_time': {
        const before = getBaseAnswerTime(defender);
        const after = applyAnswerTimeDelta(defender, reward.amount);
        changes.defenderAnswerTime = after - before;
        break;
      }
      case 'self_answer_time': {
        const before = getBaseAnswerTime(attacker);
        const after = applyAnswerTimeDelta(attacker, reward.amount);
        changes.attackerAnswerTime = after - before;
        break;
      }
      default:
        break;
    }
  }

  const pending = game.pendingCombat;
  game.pendingCombat = null;
  game.turn = defenderId;
  game.turnState = TURN_STATE.WORD_INPUT;
  return {
    ok: true,
    playerId,
    targetId: defenderId,
    word: pending.word,
    wordLength: pending.wordLength,
    wordEffectId: wordEffect.id,
    rewardId: reward?.id || null,
    damage,
    targetHp: defender.hp,
    attackerHp: attacker.hp,
    changes,
    nextTurn: game.turn,
    nextState: game.turnState,
  };
}

function pickAutoWord(chain, wordSet, usedWords) {
  const candidates = [];
  for (const word of wordSet) {
    if (usedWords.has(word) || !getWordEffect(word)) continue;
    const valid = chain.deadEndAlts
      ? chain.deadEndAlts.has(word[0])
      : chain.lastSyllable ? matchesStartChar(word[0], chain.lastSyllable) : true;
    if (valid) candidates.push(word);
  }
  return candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : null;
}

export function applyTimerExpiry(game, playerId, wordSet, followerCountMap) {
  const player = game.players[playerId];
  if (!player || game.turn !== playerId || game.turnState !== TURN_STATE.WORD_INPUT) {
    return { ok: false, reason: 'wrong_state', hpLoss: 0, newHp: player?.hp || 0, nextTurn: game.turn };
  }
  player.hp = Math.max(0, player.hp - TIMER_PENALTY);
  player.nextTurnTimeModifier = 0;
  const autoWord = wordSet ? pickAutoWord(game.chain, wordSet, game.usedWords) : null;
  let deadEndExpanded = false;
  if (autoWord) {
    game.usedWords.add(autoWord);
    game.chain.lastWord = autoWord;
    game.chain.lastSyllable = getLastSyllable(autoWord);
    const resolved = resolveStartAlts(game.chain.lastSyllable, followerCountMap);
    game.chain.deadEndAlts = resolved.alts;
    deadEndExpanded = resolved.expanded;
  }
  game.turn = opponentOf(playerId);
  return {
    ok: true,
    hpLoss: TIMER_PENALTY,
    newHp: player.hp,
    nextTurn: game.turn,
    autoWord,
    deadEndExpanded,
  };
}

export function applyResign(game, playerId) {
  game.phase = 'over';
  game.winner = opponentOf(playerId);
  game.loser = playerId;
  game.reason = 'resign';
}

export function isGameOver(game) {
  for (const pid of ['p1', 'p2']) {
    if (game.players[pid].hp <= 0) {
      const winner = opponentOf(pid);
      Object.assign(game, { phase: 'over', winner, loser: pid, reason: 'hp_zero' });
      return { ended: true, winner, loser: pid };
    }
  }
  return { ended: false, winner: null, loser: null };
}

export function snapshot(game) {
  return {
    type: 'STATE',
    turn: game.turn,
    turnState: game.turnState,
    chain: {
      lastWord: game.chain.lastWord,
      lastSyllable: game.chain.lastSyllable,
      deadEndAlts: game.chain.deadEndAlts ? [...game.chain.deadEndAlts] : null,
    },
    pendingCombat: game.pendingCombat ? { ...game.pendingCombat } : null,
    players: Object.values(game.players).map((player) => ({
      id: player.id,
      name: player.name,
      hp: player.hp,
      maxHp: COMBAT_CONFIG.player.maxHp,
      attack: player.attack,
      defense: player.defense,
      answerTimeModifier: player.answerTimeModifier,
      baseAnswerTime: getBaseAnswerTime(player),
      nextTurnTimeModifier: player.nextTurnTimeModifier,
      effectiveAnswerTime: getEffectiveAnswerTime(player),
    })),
    usedWordsCount: game.usedWords.size,
  };
}
