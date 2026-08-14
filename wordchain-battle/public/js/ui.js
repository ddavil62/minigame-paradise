/** @fileoverview 끝말잇기 배틀 DOM 렌더링. 서버 스냅샷만 화면에 반영한다. */

const $ = (selector) => document.querySelector(selector);
const el = {
  waitingScreen: $('#waiting-screen'), gameScreen: $('#game-screen'),
  nameMe: $('#name-me'), nameOpp: $('#name-opp'), panelMe: $('#panel-me'), panelOpp: $('#panel-opp'),
  hpMe: $('#hp-me'), hpOpp: $('#hp-opp'), hpTextMe: $('#hp-text-me'), hpTextOpp: $('#hp-text-opp'),
  attackMe: $('#attack-me'), attackOpp: $('#attack-opp'), defenseMe: $('#defense-me'), defenseOpp: $('#defense-opp'),
  answerTimeMe: $('#answer-time-me'), answerTimeOpp: $('#answer-time-opp'), tempTimeMe: $('#temp-time-me'), tempTimeOpp: $('#temp-time-opp'),
  attackMeterMe: $('#attack-meter-me'), attackMeterOpp: $('#attack-meter-opp'), defenseMeterMe: $('#defense-meter-me'), defenseMeterOpp: $('#defense-meter-opp'),
  timeRingMe: $('#time-ring-me'), timeRingOpp: $('#time-ring-opp'), statusMe: $('#status-me'), statusOpp: $('#status-opp'),
  wordEffectList: $('#word-effect-list'), rewardList: $('#reward-list'), rewardAction: $('#reward-action'),
  rewardPrompt: $('#reward-prompt'), wordAction: $('#word-action'), stateLabel: $('#state-label'),
  chainShared: $('#chain-shared'), turnBanner: $('#turn-banner'), typingIndicator: $('#typing-indicator'),
  startChar: $('#start-char'), inputCharPreview: $('#input-char-preview'), timerText: $('#timer-text'), rewardTimerText: $('#reward-timer-text'), wordInput: $('#word-input'), submitBtn: $('#submit-btn'),
  menuAttack: $('#menu-atk'), menuDefense: $('#menu-def'),
  feedback: $('#feedback'), combatPopup: $('#combat-popup'), countdownOverlay: $('#countdown-overlay'), countdownNum: $('#countdown-num'), countdownFirstTurn: $('#countdown-first-turn'),
  projectile: $('#word-projectile'), impactRing: $('#impact-ring'), damageFloat: $('#damage-float'),
  defeatMe: $('#defeat-me'), defeatOpp: $('#defeat-opp'),
  actionArea: $('.action-area'), timeoutBanner: $('#timeout-banner'),
  resultModal: $('#result-modal'), resultTitle: $('#result-title'), resultDetail: $('#result-detail'),
  rematchBtn: $('#rematch-btn'), rematchStatus: $('#rematch-status'), exitBtn: $('#exit-btn'),
};
const timerDisplay = el.timerText?.parentElement;
let rewardHandler = null;
let rewardById = new Map();
let combatConfig = {};
let activeSide = 'me';
let combatTimers = [];
const hpLocks = new Map();
let timeoutTimerLocked = false;
let pendingTimerRemaining = null;
export const LETHAL_FINISHER_MS = 2300;
const playerState = {
  me: { attack: 0, defense: 0 },
  opp: { attack: 0, defense: 0 },
};

export function showWaiting() { el.waitingScreen.classList.add('active'); el.gameScreen.classList.remove('active'); }
export function showGame() { el.waitingScreen.classList.remove('active'); el.gameScreen.classList.add('active'); }

export function setName(who, name) { (who === 'me' ? el.nameMe : el.nameOpp).textContent = name; }

export function updatePlayer(who, player) {
  const hpBar = who === 'me' ? el.hpMe : el.hpOpp;
  const hpText = who === 'me' ? el.hpTextMe : el.hpTextOpp;
  const attack = who === 'me' ? el.attackMe : el.attackOpp;
  const defense = who === 'me' ? el.defenseMe : el.defenseOpp;
  const answerTime = who === 'me' ? el.answerTimeMe : el.answerTimeOpp;
  const temp = who === 'me' ? el.tempTimeMe : el.tempTimeOpp;
  const attackMeter = who === 'me' ? el.attackMeterMe : el.attackMeterOpp;
  const defenseMeter = who === 'me' ? el.defenseMeterMe : el.defenseMeterOpp;
  const timeRing = who === 'me' ? el.timeRingMe : el.timeRingOpp;
  const maxHp = Number.isFinite(player?.maxHp) ? player.maxHp : 100;
  const hp = Number.isFinite(player?.hp) ? player.hp : maxHp;
  const attackValue = Number.isFinite(player?.attack) ? player.attack : 0;
  const defenseValue = Number.isFinite(player?.defense) ? player.defense : 0;
  const baseAnswerTime = Number.isFinite(player?.baseAnswerTime) ? player.baseAnswerTime : 10;
  const hpLock = hpLocks.get(who);
  if (hpLock) hpLock.pending = { hp, maxHp };
  const visibleHp = hpLock ? hpLock.hp : hp;
  const visibleMaxHp = hpLock ? hpLock.maxHp : maxHp;
  hpBar.style.width = `${Math.max(0, Math.min(100, visibleHp / visibleMaxHp * 100))}%`;
  hpBar.classList.toggle('low', visibleHp <= visibleMaxHp * 0.3);
  hpText.textContent = `${visibleHp}/${visibleMaxHp}`;
  attack.textContent = attackValue;
  defense.textContent = defenseValue;
  answerTime.textContent = `${baseAnswerTime}초`;
  playerState[who] = { attack: attackValue, defense: defenseValue };
  attackMeter.style.setProperty('--meter', `${Math.min(100, attackValue * 14)}%`);
  defenseMeter.style.setProperty('--meter', `${Math.min(100, defenseValue * 14)}%`);
  timeRing.textContent = baseAnswerTime;
  const maxAnswerTime = Number(combatConfig?.player?.maxAnswerTimeSec) || 15;
  timeRing.parentElement.style.setProperty('--ring', `${Math.min(100, baseAnswerTime / maxAnswerTime * 100)}%`);
  const modifier = Number(player.nextTurnTimeModifier) || 0;
  const effectiveAnswerTime = Number.isFinite(player?.effectiveAnswerTime)
    ? player.effectiveAnswerTime
    : Math.max(0, baseAnswerTime + modifier);
  temp.textContent = modifier < 0 ? `다음 턴 추가 압박 ${modifier}초 → 실제 ${effectiveAnswerTime}초` : '';
  temp.classList.toggle('hidden', modifier >= 0);
  updateDamageMenu();
}

export function animateHpHit(who) {
  const bar = who === 'me' ? el.hpMe : el.hpOpp;
  bar.classList.remove('hit'); void bar.offsetWidth; bar.classList.add('hit');
}

export function animateAttack(attackerWho, targetWho) {
  const attacker = attackerWho === 'me' ? el.panelMe : el.panelOpp;
  const target = targetWho === 'me' ? el.panelMe : el.panelOpp;
  attacker.classList.remove('attacking');
  target.classList.remove('taking-hit');
  void attacker.offsetWidth;
  attacker.classList.add('attacking');
  target.classList.add('taking-hit');
  setTimeout(() => {
    attacker.classList.remove('attacking');
    target.classList.remove('taking-hit');
  }, 520);
}

function scheduleCombat(callback, delay) {
  const timer = setTimeout(callback, delay);
  combatTimers.push(timer);
  return timer;
}

function clearCombatTimers() {
  for (const timer of combatTimers) clearTimeout(timer);
  combatTimers = [];
}

function releaseHpLock(who, fallbackHp) {
  const lock = hpLocks.get(who);
  if (!lock) return;
  const next = lock.pending || { hp: fallbackHp, maxHp: lock.maxHp };
  hpLocks.delete(who);
  const hpBar = who === 'me' ? el.hpMe : el.hpOpp;
  const hpText = who === 'me' ? el.hpTextMe : el.hpTextOpp;
  hpBar.style.width = `${Math.max(0, Math.min(100, next.hp / next.maxHp * 100))}%`;
  hpBar.classList.toggle('low', next.hp <= next.maxHp * 0.3);
  hpText.textContent = `${next.hp}/${next.maxHp}`;
}

function lockCurrentHp(who) {
  const hpText = who === 'me' ? el.hpTextMe : el.hpTextOpp;
  const [hp, maxHp] = hpText.textContent.split('/').map(Number);
  if (Number.isFinite(hp) && Number.isFinite(maxHp)) {
    hpLocks.set(who, { hp, maxHp, pending: null });
  }
}

/** 단어 비행부터 치명타 K.O.까지 한 번의 공격 연출을 재생한다. */
export function playCombatSequence({ attackerWho, targetWho, word = '', damage = 0, targetHp = null, lethal = false }) {
  clearCombatTimers();
  const attacker = attackerWho === 'me' ? el.panelMe : el.panelOpp;
  const target = targetWho === 'me' ? el.panelMe : el.panelOpp;
  const defeatFx = targetWho === 'me' ? el.defeatMe : el.defeatOpp;
  lockCurrentHp(targetWho);

  attacker.classList.remove('attacking');
  target.classList.remove('taking-hit');
  el.projectile.className = `word-projectile from-${attackerWho}`;
  el.projectile.innerHTML = '';
  const letters = [...String(word)].slice(0, 6);
  for (const letter of letters) {
    const tile = document.createElement('span');
    tile.textContent = letter;
    el.projectile.append(tile);
  }
  el.impactRing.className = `impact-ring target-${targetWho}`;
  el.damageFloat.className = `damage-float target-${targetWho}`;
  el.damageFloat.textContent = `-${damage}`;
  void el.projectile.offsetWidth;
  attacker.classList.add('attacking');

  scheduleCombat(() => {
    releaseHpLock(targetWho, Number.isFinite(targetHp) ? targetHp : 0);
    target.classList.add('taking-hit');
    animateHpHit(targetWho);
    el.impactRing.classList.add('active');
    el.damageFloat.classList.add('active');
  }, 620);

  if (lethal) {
    scheduleCombat(() => {
      target.classList.add('defeated');
      defeatFx.classList.add('active');
      defeatFx.setAttribute('aria-hidden', 'false');
    }, 760);
  }

  scheduleCombat(() => {
    attacker.classList.remove('attacking');
    target.classList.remove('taking-hit');
    el.projectile.className = 'word-projectile';
    el.projectile.innerHTML = '';
    el.impactRing.className = 'impact-ring';
    el.damageFloat.className = 'damage-float';
  }, lethal ? LETHAL_FINISHER_MS : 1450);
}

/** 답변 시간초과를 타이머 폭발과 해당 플레이어 피격으로 표현한다. */
export function playTimeoutSequence({ who, damage = 0, targetHp = null, lethal = false }) {
  clearCombatTimers();
  const target = who === 'me' ? el.panelMe : el.panelOpp;
  const defeatFx = who === 'me' ? el.defeatMe : el.defeatOpp;
  lockCurrentHp(who);
  timeoutTimerLocked = true;
  pendingTimerRemaining = null;
  el.timerText.textContent = '0';
  el.rewardTimerText.textContent = '0';
  el.actionArea.classList.remove('timeout');
  timerDisplay.classList.remove('tick', 'timeout-zero');
  el.timeoutBanner.classList.remove('active');
  el.impactRing.className = `impact-ring target-${who} timeout-impact`;
  el.damageFloat.className = `damage-float target-${who} timeout-damage`;
  el.damageFloat.textContent = `-${damage}`;
  el.timeoutBanner.textContent = `TIME OUT · HP -${damage}`;
  void el.actionArea.offsetWidth;
  el.actionArea.classList.add('timeout');
  timerDisplay.classList.add('urgent', 'timeout-zero');
  el.timeoutBanner.classList.add('active');
  el.timeoutBanner.setAttribute('aria-hidden', 'false');

  scheduleCombat(() => {
    releaseHpLock(who, Number.isFinite(targetHp) ? targetHp : 0);
    target.classList.add('timeout-hit');
    animateHpHit(who);
    el.impactRing.classList.add('active');
    el.damageFloat.classList.add('active');
  }, 150);

  if (lethal) {
    scheduleCombat(() => {
      target.classList.add('defeated');
      defeatFx.classList.add('active');
      defeatFx.setAttribute('aria-hidden', 'false');
    }, 430);
  }

  scheduleCombat(() => {
    target.classList.remove('timeout-hit');
    el.actionArea.classList.remove('timeout');
    timerDisplay.classList.remove('timeout-zero');
    el.timeoutBanner.classList.remove('active');
    el.timeoutBanner.setAttribute('aria-hidden', 'true');
    el.impactRing.className = 'impact-ring';
    el.damageFloat.className = 'damage-float';
    timeoutTimerLocked = false;
    if (pendingTimerRemaining !== null) {
      const nextRemaining = pendingTimerRemaining;
      pendingTimerRemaining = null;
      updateTimer(nextRemaining);
    }
  }, lethal ? LETHAL_FINISHER_MS : 1450);
}

export function clearCombatPresentation() {
  clearCombatTimers();
  hpLocks.clear();
  for (const panel of [el.panelMe, el.panelOpp]) panel.classList.remove('attacking', 'taking-hit', 'timeout-hit', 'defeated');
  for (const defeatFx of [el.defeatMe, el.defeatOpp]) {
    defeatFx.classList.remove('active');
    defeatFx.setAttribute('aria-hidden', 'true');
  }
  el.projectile.className = 'word-projectile';
  el.projectile.innerHTML = '';
  el.impactRing.className = 'impact-ring';
  el.damageFloat.className = 'damage-float';
  el.actionArea.classList.remove('timeout');
  timerDisplay.classList.remove('timeout-zero');
  el.timeoutBanner.classList.remove('active');
  el.timeoutBanner.setAttribute('aria-hidden', 'true');
  timeoutTimerLocked = false;
  pendingTimerRemaining = null;
}

function lengthLabel(effect) {
  return effect.maxLength === null ? `${effect.minLength}글자 이상` : `${effect.minLength}글자`;
}

export function renderCombatConfig(config) {
  combatConfig = config || {};
  el.wordEffectList.innerHTML = '';
  const wordEffects = Array.isArray(config?.wordEffects) ? config.wordEffects : [];
  for (const effect of wordEffects) {
    const item = document.createElement('div');
    item.className = 'word-effect-item';
    item.dataset.baseDamage = String(effect.baseDamage || 0);
    item.innerHTML = `<strong class="menu-length">${lengthLabel(effect)}</strong><i class="menu-dots"></i><span class="menu-damage"><b>0</b><small>DMG</small></span><span class="menu-formula"></span>`;
    el.wordEffectList.append(item);
  }
  if (wordEffects.length === 0) {
    const item = document.createElement('div');
    item.className = 'word-effect-item config-error';
    item.innerHTML = '<strong>전투 설정을 불러오지 못했습니다</strong><span>서버 업데이트 후 다시 접속해 주세요.</span>';
    el.wordEffectList.append(item);
  }
  el.rewardList.innerHTML = '';
  rewardById = new Map((Array.isArray(config?.rewards) ? config.rewards : []).map((reward) => [reward.id, reward]));
  updateDamageMenu();
}

/** 현재 턴의 공격자와 방어자 스탯을 반영해 글자 수별 예상 Damage를 갱신한다. */
function updateDamageMenu() {
  const attacker = playerState[activeSide] || playerState.me;
  const defender = playerState[activeSide === 'me' ? 'opp' : 'me'] || playerState.opp;
  const minimum = Number(combatConfig?.damage?.minimum) || 1;
  el.menuAttack.textContent = attacker.attack;
  el.menuDefense.textContent = defender.defense;
  for (const item of el.wordEffectList.querySelectorAll('.word-effect-item[data-base-damage]')) {
    const baseDamage = Number(item.dataset.baseDamage) || 0;
    const damage = Math.max(minimum, baseDamage + attacker.attack - defender.defense);
    item.querySelector('.menu-damage b').textContent = damage;
    item.querySelector('.menu-formula').textContent = `${baseDamage} + ${attacker.attack} − ${defender.defense}`;
  }
}

/** 서버가 이번 턴에 추첨한 보상 3개만 순서대로 표시한다. */
export function setRewardOptions(rewardIds = []) {
  el.rewardList.innerHTML = '';
  for (const [index, rewardId] of rewardIds.entries()) {
    const reward = rewardById.get(rewardId);
    if (!reward) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'reward-card';
    button.dataset.rewardId = reward.id;
    button.setAttribute('aria-label', `${index + 1}번 ${reward.name}: ${reward.description}`);
    button.title = reward.description;
    button.innerHTML = `<kbd>${index + 1}</kbd><strong class="reward-icon" aria-hidden="true">${reward.icon || '◆'}</strong><span>${reward.description}</span>`;
    button.addEventListener('click', () => rewardHandler?.(reward.id));
    el.rewardList.append(button);
  }
}

export function setActionState(turnState, isMyTurn) {
  const rewardState = turnState === 'reward_select';
  el.wordAction.classList.toggle('hidden', rewardState);
  el.rewardAction.classList.toggle('hidden', !rewardState);
  el.stateLabel.textContent = rewardState ? '보상 선택' : '반격 단어 선택';
  el.rewardPrompt.textContent = isMyTurn ? '10초 안에 클릭하거나 1·2·3 키로 선택하세요.' : '상대가 보상을 선택하고 있습니다.';
  for (const button of el.rewardList.querySelectorAll('button')) button.disabled = !isMyTurn;
  setInputEnabled(!rewardState && isMyTurn);
  if (rewardState) setTypingProgress(0);
}

export function setTurn(isMyTurn, turnState, answerTime = 10) {
  const rewardState = turnState === 'reward_select';
  if (isMyTurn !== null) activeSide = isMyTurn ? 'me' : 'opp';
  el.turnBanner.textContent = isMyTurn === null
    ? '첫 턴을 정하는 중...'
    : rewardState
      ? (isMyTurn ? '내 보상 선택 — 전황에 맞는 효과를 고르세요!' : '상대 보상 선택 — 잠시 기다려주세요.')
      : (isMyTurn ? `내 차례 — ${answerTime}초 안에 이어주세요!` : '상대 차례 — 단어를 기다리는 중...');
  el.turnBanner.classList.toggle('mine', isMyTurn === true);
  el.panelMe.classList.toggle('active-turn', isMyTurn === true);
  el.panelOpp.classList.toggle('active-turn', isMyTurn === false);
  el.statusMe.textContent = isMyTurn === true ? (rewardState ? '보상 선택 중' : '현재 행동 중 · 단어 입력') : '다음 반격 준비 중';
  el.statusOpp.textContent = isMyTurn === false ? (rewardState ? '보상 선택 중' : '현재 행동 중 · 단어 입력') : '다음 반격 준비 중';
  updateDamageMenu();
}

export function addChainWord(who, word, isAuto = false) {
  const li = document.createElement('li');
  li.className = `${who}${isAuto ? ' auto-word' : ''}`;
  li.innerHTML = `<span class="chain-speaker">${who === 'me' ? '나' : '상대'}</span><span class="chain-word"></span>`;
  li.querySelector('.chain-word').textContent = isAuto ? `${word} (자동)` : word;
  el.chainShared.append(li);
  while (el.chainShared.children.length > 10) el.chainShared.firstChild.remove();
  el.chainShared.scrollTop = el.chainShared.scrollHeight;
}

export function clearChains() { el.chainShared.innerHTML = ''; }
export function setTypingProgress(count) {
  const visible = Number(count) > 0;
  el.typingIndicator.textContent = visible ? `상대가 입력 중... (${count}자)` : '';
  el.typingIndicator.classList.toggle('hidden', !visible);
}
export function setStartChar(char, altChars = null) {
  el.startChar.classList.remove('pending');
  if (!char) { el.startChar.textContent = '자유'; el.inputCharPreview.textContent = '자유'; return; }
  const alts = altChars ? [...altChars].filter((value) => value && value !== char) : [];
  const label = char + (alts.length ? ` (또는 ${alts.join(', ')})` : '');
  el.startChar.textContent = char;
  el.startChar.title = label;
  el.startChar.setAttribute('aria-label', label);
  el.inputCharPreview.textContent = char;
}
export function setStartCharPending() { el.startChar.textContent = '???'; el.startChar.classList.add('pending'); el.inputCharPreview.textContent = '?'; }
export function updateTimer(remaining) {
  if (timeoutTimerLocked) { pendingTimerRemaining = remaining; return; }
  el.timerText.textContent = remaining;
  el.rewardTimerText.textContent = remaining;
  timerDisplay?.classList.toggle('urgent', remaining <= 3);
  if (timerDisplay) {
    timerDisplay.classList.remove('tick');
    void timerDisplay.offsetWidth;
    timerDisplay.classList.add('tick');
  }
}
export function setInputEnabled(enabled) { el.wordInput.disabled = !enabled; el.submitBtn.disabled = !enabled; if (enabled) el.wordInput.focus(); }
export function clearInput() { el.wordInput.value = ''; }
export function getInputValue() { return el.wordInput.value.trim(); }
export function showInputError() { el.wordInput.classList.remove('error'); void el.wordInput.offsetWidth; el.wordInput.classList.add('error'); }
export function showFeedback(message, duration = 2000) {
  el.feedback.textContent = message;
  if (message && duration > 0) setTimeout(() => { if (el.feedback.textContent === message) el.feedback.textContent = ''; }, duration);
}
export function showCombatResult(message) {
  el.combatPopup.textContent = message;
  el.combatPopup.classList.remove('hidden');
  setTimeout(() => el.combatPopup.classList.add('hidden'), 2200);
}
export function showCountdown(seconds, isMyFirstTurn) {
  el.countdownFirstTurn.textContent = isMyFirstTurn ? '내가 선공!' : '상대가 선공!';
  el.countdownFirstTurn.classList.toggle('mine', isMyFirstTurn);
  el.countdownOverlay.classList.remove('hidden'); let count = seconds; el.countdownNum.textContent = count;
  const interval = setInterval(() => { count -= 1; if (count <= 0) { clearInterval(interval); el.countdownOverlay.classList.add('hidden'); } else el.countdownNum.textContent = count; }, 1000);
}
export function hideCountdown() { el.countdownOverlay.classList.add('hidden'); }
export function showResult(title, detail) { el.resultTitle.textContent = title; el.resultDetail.textContent = detail; el.rematchStatus.textContent = ''; el.resultModal.classList.remove('hidden'); }
export function hideResult() { el.resultModal.classList.add('hidden'); }
export function setRematchStatus(text) { el.rematchStatus.textContent = text; }
export function resetGameUI() {
  clearCombatPresentation();
  clearChains(); setStartCharPending(); updateTimer(10); setTurn(null, 'word_input'); setTypingProgress(0); clearInput(); showFeedback(''); hideResult();
  updatePlayer('me', { hp: 100, maxHp: 100, attack: 0, defense: 0, baseAnswerTime: 10, effectiveAnswerTime: 10 });
  updatePlayer('opp', { hp: 100, maxHp: 100, attack: 0, defense: 0, baseAnswerTime: 10, effectiveAnswerTime: 10 });
  setRewardOptions([]);
  setActionState('word_input', false);
}
export function onRewardSelect(handler) { rewardHandler = handler; }
export function onRewardHotkey(handler) {
  document.addEventListener('keydown', (event) => {
    if (event.repeat || el.rewardAction.classList.contains('hidden')) return;
    const index = Number(event.key) - 1;
    if (!Number.isInteger(index) || index < 0 || index > 2) return;
    const button = el.rewardList.querySelectorAll('button')[index];
    if (!button || button.disabled) return;
    event.preventDefault();
    handler(button.dataset.rewardId);
  });
}
export function onRematchClick(handler) { el.rematchBtn.addEventListener('click', handler); }
export function onSubmitClick(handler) { el.submitBtn.addEventListener('click', handler); }
export function onInputEnter(handler) { el.wordInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') handler(); }); }
export function onInputChange(handler) { el.wordInput.addEventListener('input', () => handler(el.wordInput.value.length)); }
export function onExitClick(handler) { el.exitBtn.addEventListener('click', handler); }
