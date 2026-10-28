/** @fileoverview 서버 권위 상태를 UI에 연결하고 플레이어 의도만 전송한다. */

import * as net from './network.js';
import * as ui from './ui.js';
import { rejectReasonToKo } from './input.js';
import { audio } from './audio.js';

let myId = null;
let isPlaying = false;
let currentTurn = null;
let currentTurnState = null;
let lethalPresentationUntil = 0;
let gameOverPresentationTimer = null;

function cancelPendingGameOver() {
  if (gameOverPresentationTimer) clearTimeout(gameOverPresentationTimer);
  gameOverPresentationTimer = null;
  lethalPresentationUntil = 0;
}

function presentGameOver(msg) {
  gameOverPresentationTimer = null;
  const won = msg.winner === myId;
  const detail = msg.reason === 'resign'
    ? (won ? '상대가 기권했습니다.' : '기권했습니다.')
    : (won ? '상대의 HP가 0이 되었습니다!' : '내 HP가 0이 되었습니다.');
  ui.showResult(won ? '승리!' : '패배...', detail);
  audio.setPlaying(false);
  audio.play(won ? 'win' : 'lose');
}

function getPlayerName() {
  const fromUrl = new URLSearchParams(location.search).get('name');
  return fromUrl || sessionStorage.getItem('playerName') || '플레이어';
}

function handleSubmit() {
  if (!isPlaying || currentTurn !== myId || currentTurnState !== 'word_input') return;
  const word = ui.getInputValue();
  if (!word) return;
  audio.play('submit');
  net.send({ type: 'WORD_SUBMIT', word });
  net.send({ type: 'TYPING', count: 0 });
  ui.clearInput();
}

function conditionalResultCopy(result) {
  if (!result) return '';
  if (result.status === 'SUCCESS') return `${result.rewardName} 성공! +${result.bonusDamage} BONUS`;
  if (result.status === 'FAILED_TIMEOUT') return `${result.rewardName} 시간초과 · 보상 소멸`;
  return `${result.rewardName} 실패 · 보상 소멸`;
}

function renderState(msg) {
  const previousTurnState = currentTurnState;
  const players = msg.players || [];
  for (const player of players) ui.updatePlayer(player.id === myId ? 'me' : 'opp', player);
  currentTurn = msg.turn || null;
  currentTurnState = msg.turnState || 'word_input';
  if (isPlaying && currentTurnState === 'reward_select' && previousTurnState !== 'reward_select') audio.play('rewardOpen');
  const isMyTurn = isPlaying && currentTurn === myId;
  const activePlayer = players.find((player) => player.id === currentTurn);
  ui.setTurn(isMyTurn, currentTurnState, activePlayer?.effectiveAnswerTime || 10);
  ui.setRewardOptions(currentTurnState === 'reward_select' ? msg.pendingCombat?.rewardOptions || [] : []);
  ui.setActionState(currentTurnState, isMyTurn);
  const chain = msg.chain || {};
  if (!isPlaying) ui.setStartCharPending();
  else if (chain.lastSyllable) ui.setStartChar(chain.lastSyllable, chain.deadEndAlts);
  else ui.setStartCharPending();
}

net.on('JOINED', (msg) => { myId = msg.yourId; if (msg.waiting) ui.showWaiting(); });
net.on('GAME_START', (msg) => {
  cancelPendingGameOver();
  ui.resetGameUI();
  ui.showGame();
  ui.renderCombatConfig(msg.combatConfig || {});
  isPlaying = false;
  currentTurn = null;
  currentTurnState = null;
  audio.setPlaying(false);
  for (const player of msg.players || []) ui.setName(player.id === myId ? 'me' : 'opp', player.name);
  const isMyFirstTurn = msg.firstTurn === myId;
  ui.setTurn(isMyFirstTurn, 'word_input');
  ui.showCountdown(msg.countdown, isMyFirstTurn);
});
net.on('PLAYING', () => { ui.hideCountdown(); isPlaying = true; ui.setInputEnabled(false); ui.setStartCharPending(); audio.setPlaying(true); audio.play('start'); });
net.on('STATE', renderState);
net.on('WORD_ACCEPTED', (msg) => {
  audio.play('accepted');
  ui.addChainWord(msg.playerId === myId ? 'me' : 'opp', msg.word);
  if (msg.playerId === myId) ui.showFeedback(`${msg.wordLength}글자 · ${msg.wordEffect.description}`, 1800);
  if (msg.conditionalRewardResult) {
    const owner = msg.playerId === myId ? '' : '상대 ';
    ui.showFeedback(`${owner}${conditionalResultCopy(msg.conditionalRewardResult)}`, 2400);
  }
});
net.on('WORD_REJECTED', (msg) => {
  if (msg.playerId !== myId) return;
  ui.showInputError();
  audio.play('invalid');
  ui.showFeedback(rejectReasonToKo(msg.reason));
});
net.on('REWARD_SELECTED', (msg) => { audio.play('rewardSelect'); if (msg.playerId === myId) ui.showFeedback('보상을 선택했습니다.', 1000); });
net.on('REWARD_REJECTED', (msg) => { audio.play('invalid'); ui.showFeedback(['invalid_reward', 'reward_not_offered'].includes(msg.reason) ? '이번에 제시된 보상만 선택할 수 있습니다.' : '지금은 보상을 선택할 수 없습니다.'); });
net.on('REWARD_EXPIRED', (msg) => { audio.play('rewardExpired'); if (msg.playerId === myId) ui.showFeedback('선택 시간이 끝나 보상 없이 공격합니다.', 2200); });
net.on('COMBAT_RESOLVED', (msg) => {
  const attacker = msg.playerId === myId ? '나' : '상대';
  ui.showCombatResult(`${attacker}의 공격: ${msg.damage} Damage${msg.rewardId ? ' · 보상 적용' : ' · 보상 없음'}`);
  const attackerWho = msg.playerId === myId ? 'me' : 'opp';
  const targetWho = msg.targetId === myId ? 'me' : 'opp';
  const lethal = Number(msg.targetHp) <= 0;
  ui.playCombatSequence({
    attackerWho,
    targetWho,
    word: msg.word,
    damage: msg.damage,
    targetHp: msg.targetHp,
    lethal,
  });
  lethalPresentationUntil = lethal ? Date.now() + ui.LETHAL_FINISHER_MS : 0;
});
net.on('TIMER_TICK', (msg) => { ui.updateTimer(msg.remaining); audio.play('timer', msg.remaining); });
net.on('TIMER_EXPIRED', (msg) => {
  const who = msg.playerId === myId ? 'me' : 'opp';
  const lethal = Number(msg.newHp) <= 0;
  if (msg.playerId === myId) {
    const timeoutMessage = msg.autoWord
      ? `시간 초과! HP -${msg.hpLoss}, "${msg.autoWord}"(으)로 자동 진행됩니다.`
      : `시간 초과! HP -${msg.hpLoss}`;
    const conditionalMessage = msg.conditionalRewardResult
      ? ` · ${conditionalResultCopy(msg.conditionalRewardResult)}`
      : '';
    ui.showFeedback(`${timeoutMessage}${conditionalMessage}`, 2800);
  }
  if (msg.autoWord) ui.addChainWord(who, msg.autoWord, true);
  if (msg.conditionalRewardResult && msg.playerId !== myId) {
    ui.showFeedback(`상대 ${conditionalResultCopy(msg.conditionalRewardResult)}`, 2200);
  }
  ui.playTimeoutSequence({ who, damage: msg.hpLoss, targetHp: msg.newHp, lethal });
  lethalPresentationUntil = lethal ? Date.now() + ui.LETHAL_FINISHER_MS : 0;
});
net.on('TYPING', (msg) => {
  if (msg.playerId !== myId && currentTurn === msg.playerId && currentTurnState === 'word_input') ui.setTypingProgress(msg.count);
});
net.on('GAME_OVER', (msg) => {
  isPlaying = false; currentTurn = null; currentTurnState = null; ui.setInputEnabled(false);
  const remaining = msg.reason === 'hp_zero' ? lethalPresentationUntil - Date.now() : 0;
  if (remaining > 0) gameOverPresentationTimer = setTimeout(() => presentGameOver(msg), remaining);
  else presentGameOver(msg);
});
net.on('REMATCH_WAITING', () => ui.setRematchStatus('상대의 응답을 기다리는 중...'));
net.on('REMATCH_START', () => { cancelPendingGameOver(); audio.setPlaying(false); ui.hideResult(); ui.resetGameUI(); isPlaying = false; currentTurn = null; currentTurnState = null; });
net.on('OPPONENT_LEFT', () => { cancelPendingGameOver(); audio.setPlaying(false); isPlaying = false; ui.setInputEnabled(false); ui.showResult('상대 퇴장', '상대가 게임을 나갔습니다.'); });
net.on('ERROR', (msg) => {
  console.warn('[main] 서버 에러:', msg.message);
  if (msg.retryable === false) {
    isPlaying = false;
    ui.showConnectionError(msg.message);
  }
});

ui.onSubmitClick(handleSubmit);
ui.onInputEnter(handleSubmit);
ui.onInputChange((count) => {
  if (count > 0) audio.play('type', count);
  if (isPlaying && currentTurn === myId && currentTurnState === 'word_input') net.send({ type: 'TYPING', count });
});
function selectReward(rewardId) {
  if (isPlaying && currentTurn === myId && currentTurnState === 'reward_select') {
    net.send({ type: 'REWARD_SELECT', rewardId });
    ui.setActionState('reward_select', false);
  }
}
ui.onRewardSelect(selectReward);
ui.onRewardHotkey(selectReward);
ui.onRematchClick(() => { net.send({ type: 'REMATCH' }); ui.setRematchStatus('리매치 요청 전송됨...'); });
ui.onExitClick(() => {
  if (isPlaying && !window.confirm('게임을 나가시겠습니까? 기권 처리됩니다.')) return;
  if (isPlaying) net.send({ type: 'RESIGN' });
  net.disconnect();
  location.href = '/';
});

const soundButton = document.getElementById('sound-btn');
function renderSoundButton() {
  const muted = audio.isMuted();
  soundButton.textContent = muted ? '♪̸' : '♪';
  soundButton.setAttribute('aria-pressed', String(muted));
  soundButton.setAttribute('aria-label', muted ? '게임 소리 켜기' : '게임 소리 끄기');
}
soundButton.addEventListener('click', () => { audio.toggleMuted(); renderSoundButton(); });
audio.bindUnlock();
renderSoundButton();

net.connect(getPlayerName());
