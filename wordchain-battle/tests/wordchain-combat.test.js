import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, submitWord, resolveCombatTurn, getEffectiveAnswerTime, getBaseAnswerTime,
  calculateDamage, applyTimerExpiry, isGameOver, snapshot, TURN_STATE, COMBAT_CONFIG,
  beginWordInput, drawRewardOptions,
} from '../game.js';

const words = new Set([
  '가가', '가나다', '가자력', '자력', '다라마바', '다라마바사', '바나나', '나가나다', '다다', '다가라',
]);

function playingGame() {
  const game = createGame('A', 'B', 'p1');
  game.phase = 'playing';
  return game;
}

function accept(game, playerId, word) {
  const result = submitWord(game, playerId, word, words, undefined, () => 0);
  assert.equal(result.ok, true, `${word} should be accepted`);
  return result;
}

function choose(game, playerId, rewardId) {
  game.pendingCombat.rewardOptions = [rewardId];
  return resolveCombatTurn(game, playerId, rewardId);
}

test('정상 단어 제출은 턴을 넘기지 않고 REWARD_SELECT로 전환한다', () => {
  const game = playingGame();
  const result = accept(game, 'p1', '가나다');
  assert.equal(result.wordLength, 3);
  assert.equal(result.wordEffect.baseDamage, 8);
  assert.equal(game.turn, 'p1');
  assert.equal(game.turnState, TURN_STATE.REWARD_SELECT);
  assert.equal(game.pendingCombat.word, '가나다');
  assert.deepEqual(game.pendingCombat.rewardOptions.map((option) => option.rewardId), ['bonus_damage', 'attack_up', 'defense_up']);
});

test('보상 선택은 공격을 확정하고 상대 WORD_INPUT 턴을 시작한다', () => {
  const game = playingGame();
  accept(game, 'p1', '가나다');
  const combat = resolveCombatTurn(game, 'p1', 'bonus_damage');
  assert.equal(combat.ok, true);
  assert.equal(combat.damage, 13);
  assert.equal(game.players.p2.hp, 87);
  assert.equal(game.turn, 'p2');
  assert.equal(game.turnState, TURN_STATE.WORD_INPUT);
});

test('보상 시간 초과 정책은 보상 없이 기본 공격만 적용한다', () => {
  const game = playingGame();
  accept(game, 'p1', '가나다');
  const combat = resolveCombatTurn(game, 'p1', null);
  assert.equal(COMBAT_CONFIG.timers.rewardTimeoutPolicy, 'none');
  assert.equal(combat.rewardId, null);
  assert.equal(combat.damage, 8);
});

test('Attack과 Defense 보상은 플레이어별로 누적되고 Damage 공식에 반영된다', () => {
  const game = playingGame();
  accept(game, 'p1', '가나다');
  choose(game, 'p1', 'attack_up');
  accept(game, 'p2', '다라마바');
  choose(game, 'p2', 'defense_up');
  accept(game, 'p1', '바나나');
  choose(game, 'p1', 'attack_up');
  assert.equal(game.players.p1.attack, 2);
  assert.equal(game.players.p2.defense, 1);
  assert.equal(calculateDamage({ baseWordDamage: 8, attackerAttack: 2, defenderDefense: 1 }), 9);
});

test('공격 강화로 오른 Attack은 보상을 얻는 현재 공격부터 반영된다', () => {
  const game = playingGame();
  game.players.p1.attack = 2;
  accept(game, 'p1', '다라마바');
  const combat = choose(game, 'p1', 'attack_up');
  assert.equal(combat.damage, 15);
  assert.equal(game.players.p1.attack, 3);
  assert.equal(game.players.p2.hp, 85);
});

test('회복은 공격 성립 시 적용되고 Max HP를 넘지 않는다', () => {
  const game = playingGame();
  game.players.p1.hp = 98;
  accept(game, 'p1', '가나다');
  const combat = choose(game, 'p1', 'heal');
  assert.equal(combat.changes.attackerHeal, 2);
  assert.equal(game.players.p1.hp, 100);
});

test('다음 턴 시간 압박은 영구 시간과 함께 계산되고 답변 종료 후 제거된다', () => {
  const game = playingGame();
  game.players.p2.answerTimeModifier = -1;
  accept(game, 'p1', '가나다');
  choose(game, 'p1', 'next_turn_pressure');
  assert.equal(getBaseAnswerTime(game.players.p2), 9);
  assert.equal(getEffectiveAnswerTime(game.players.p2), 4);
  accept(game, 'p2', '다라마바');
  assert.equal(game.players.p2.nextTurnTimeModifier, 0);
  assert.equal(getEffectiveAnswerTime(game.players.p2), 9);
});

test('영구 시간 감소/증가는 누적되지만 설정 최소·최대를 넘지 않는다', () => {
  const game = playingGame();
  for (let i = 0; i < 20; i += 1) {
    game.turn = 'p1'; game.turnState = TURN_STATE.REWARD_SELECT;
    game.pendingCombat = { playerId: 'p1', word: '가나다', wordLength: 3, wordEffectId: 'strike_3', rewardOptions: ['opponent_time_down'] };
    resolveCombatTurn(game, 'p1', 'opponent_time_down');
  }
  assert.equal(getBaseAnswerTime(game.players.p2), 3);
  for (let i = 0; i < 20; i += 1) {
    game.turn = 'p1'; game.turnState = TURN_STATE.REWARD_SELECT;
    game.pendingCombat = { playerId: 'p1', word: '가나다', wordLength: 3, wordEffectId: 'strike_3', rewardOptions: ['self_time_up'] };
    resolveCombatTurn(game, 'p1', 'self_time_up');
  }
  assert.equal(getBaseAnswerTime(game.players.p1), 15);
});

test('State에 맞지 않는 단어·보상 요청과 다른 플레이어 요청을 거부한다', () => {
  const game = playingGame();
  assert.equal(resolveCombatTurn(game, 'p1', 'heal').reason, 'wrong_state');
  accept(game, 'p1', '가나다');
  assert.equal(submitWord(game, 'p1', '가가', words).reason, 'wrong_state');
  assert.equal(resolveCombatTurn(game, 'p2', 'heal').reason, 'not_your_turn');
  assert.equal(resolveCombatTurn(game, 'p1', 'heal').reason, 'reward_not_offered');
  assert.equal(resolveCombatTurn(game, 'p1', 'missing').reason, 'invalid_reward');
});

test('시간 초과 페널티는 WORD_INPUT에서만 적용되고 일회성 압박을 제거한다', () => {
  const game = playingGame();
  game.players.p1.nextTurnTimeModifier = -5;
  const expired = applyTimerExpiry(game, 'p1');
  assert.equal(expired.hpLoss, 20);
  assert.equal(game.players.p1.hp, 80);
  assert.equal(game.players.p1.nextTurnTimeModifier, 0);
  game.turnState = TURN_STATE.REWARD_SELECT;
  assert.equal(applyTimerExpiry(game, game.turn).reason, 'wrong_state');
});

test('HP 0 이하는 즉시 게임 종료되며 새 게임에는 이전 전투 상태가 남지 않는다', () => {
  const game = playingGame();
  game.players.p2.hp = 1;
  accept(game, 'p1', '가나다');
  resolveCombatTurn(game, 'p1', 'bonus_damage');
  assert.equal(isGameOver(game).ended, true);
  assert.equal(game.winner, 'p1');

  const rematch = createGame('A', 'B');
  assert.deepEqual(snapshot(rematch).players.map((p) => ({ attack: p.attack, defense: p.defense, time: p.baseAnswerTime, temp: p.nextTurnTimeModifier })), [
    { attack: 0, defense: 0, time: 10, temp: 0 },
    { attack: 0, defense: 0, time: 10, temp: 0 },
  ]);
});

test('2글자와 5글자 이상 Word Effect는 능력치를 올리지 않고 Damage만 결정한다', () => {
  const game = playingGame();
  accept(game, 'p1', '가가');
  resolveCombatTurn(game, 'p1', null);
  assert.equal(game.players.p1.defense, 0);
  game.turn = 'p2';
  accept(game, 'p2', '가나다');
  resolveCombatTurn(game, 'p2', null);
  game.turn = 'p1';
  accept(game, 'p1', '다라마바사');
  resolveCombatTurn(game, 'p1', null);
  assert.equal(game.players.p1.attack, 0);
});

test('보상 3개 중 조건부 보상은 최대 1개이며 정밀타 목표가 옵션에 고정된다', () => {
  const options = drawRewardOptions(() => 0.999999, ['력']);
  const conditional = options.filter((option) => option.rewardId.startsWith('conditional_'));
  assert.equal(options.length, 3);
  assert.equal(conditional.length, 1);
  assert.equal(conditional[0].rewardId, 'conditional_precision');
  assert.equal(conditional[0].targetCharacter, '력');
});

test('장문 공격 성공 보너스와 현재 추가 공격 보상은 같은 Damage에 가산 중첩된다', () => {
  const game = playingGame();
  game.players.p1.pendingConditionalReward = {
    rewardId: 'conditional_long_word', conditionType: 'min_word_length', bonusDamage: 8,
  };
  const accepted = submitWord(game, 'p1', '다라마바', words, undefined, () => 0, { submittedAtMs: 1000 });
  assert.equal(accepted.conditionalRewardResult.status, 'SUCCESS');
  game.pendingCombat.rewardOptions = [{ rewardId: 'bonus_damage' }];
  const combat = resolveCombatTurn(game, 'p1', 'bonus_damage');
  assert.equal(combat.damageBreakdown.conditionalBonusDamage, 8);
  assert.equal(combat.damageBreakdown.immediateBonusDamage, 5);
  assert.equal(combat.damage, 25);
  assert.equal(game.players.p1.pendingConditionalReward, null);
});

test('장문 공격은 3글자 정상 제출에 실패하고 시간초과에도 소멸한다', () => {
  const game = playingGame();
  game.players.p1.pendingConditionalReward = {
    rewardId: 'conditional_long_word', conditionType: 'min_word_length', bonusDamage: 8,
  };
  const accepted = submitWord(game, 'p1', '가나다', words, undefined, () => 0, { submittedAtMs: 1000 });
  assert.equal(accepted.conditionalRewardResult.success, false);
  assert.equal(game.players.p1.pendingConditionalReward, null);

  const timeoutGame = playingGame();
  timeoutGame.players.p1.pendingConditionalReward = {
    rewardId: 'conditional_long_word', conditionType: 'min_word_length', bonusDamage: 8,
  };
  const expired = applyTimerExpiry(timeoutGame, 'p1', words);
  assert.equal(expired.conditionalRewardResult.status, 'FAILED_TIMEOUT');
  assert.equal(timeoutGame.players.p1.pendingConditionalReward, null);
});

test('속공은 서버 WORD_INPUT 시작 시각부터 3초 이내 경계를 포함해 판정한다', () => {
  for (const [elapsedMs, success] of [[3000, true], [3001, false]]) {
    const game = playingGame();
    game.players.p1.pendingConditionalReward = {
      rewardId: 'conditional_quick', conditionType: 'max_elapsed_seconds', bonusDamage: 8,
    };
    beginWordInput(game, 10_000);
    const result = submitWord(game, 'p1', '가나다', words, undefined, () => 0, {
      submittedAtMs: 10_000 + elapsedMs,
    });
    assert.equal(result.conditionalRewardResult.success, success);
    assert.equal(result.conditionalRewardResult.elapsedMs, elapsedMs);
  }
});

test('거절된 입력은 조건부 보상을 소모하지 않는다', () => {
  const game = playingGame();
  game.players.p1.pendingConditionalReward = {
    rewardId: 'conditional_precision', conditionType: 'target_ending', targetCharacter: '력', bonusDamage: 10,
  };
  assert.equal(submitWord(game, 'p1', '없는말', words).ok, false);
  assert.equal(game.players.p1.pendingConditionalReward.rewardId, 'conditional_precision');
});

test('정밀타 로그 판정은 성공·플레이어 선택·사전상 불가능을 구분한다', () => {
  const cases = [
    { word: '가자력', expected: 'SUCCESS', possible: 1 },
    { word: '가나다', expected: 'FAILED_PLAYER_CHOICE', possible: 1 },
  ];
  for (const sample of cases) {
    const game = playingGame();
    game.chain.lastSyllable = '가';
    game.players.p1.pendingConditionalReward = {
      rewardId: 'conditional_precision', conditionType: 'target_ending', targetCharacter: '력', bonusDamage: 10,
    };
    const result = submitWord(game, 'p1', sample.word, words, undefined, () => 0, { submittedAtMs: 1000 });
    assert.equal(result.conditionalRewardResult.status, sample.expected);
    assert.equal(result.conditionalRewardResult.possibleWordCount, sample.possible);
  }

  const impossible = playingGame();
  impossible.chain.lastSyllable = '다';
  impossible.players.p1.pendingConditionalReward = {
    rewardId: 'conditional_precision', conditionType: 'target_ending', targetCharacter: '력', bonusDamage: 10,
  };
  const result = submitWord(impossible, 'p1', '다라마바', words, undefined, () => 0, { submittedAtMs: 1000 });
  assert.equal(result.conditionalRewardResult.status, 'FAILED_IMPOSSIBLE');
  assert.equal(result.conditionalRewardResult.possibleWordCount, 0);
});
