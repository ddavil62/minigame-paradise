/**
 * @fileoverview 별빛 우편탑 연결·재접속, 입력, HUD, 접근 가능한 오버레이 상태를 관리한다.
 */

import { CLIENT_MESSAGE, SERVER_MESSAGE } from '../shared/protocol.js';
import { applyLocale, getLocale, t, toggleLocale } from './i18n.js';
import { createRenderer } from './renderer.js';
import { isNativeKeyboardTarget } from './keyboard.js';

const canvas = document.querySelector('#game-canvas');
const renderer = createRenderer(canvas);
const readyOverlay = document.querySelector('#ready-overlay');
const readyButton = document.querySelector('#ready-button');
const aiStartButton = document.querySelector('#ai-start-button');
const readyNote = document.querySelector('#ready-note');
const connectionLabel = document.querySelector('#connection-label');
const connectionPanel = document.querySelector('.connection-panel');
const progressLabel = document.querySelector('#progress-label');
const sectionName = document.querySelector('#section-name');
const elapsedTime = document.querySelector('#elapsed-time');
const selfStatus = document.querySelector('#self-status span');
const partnerStatus = document.querySelector('#partner-status span');
const actionHint = document.querySelector('#action-hint-text');
const finishClock = document.querySelector('#finish-clock');
const respawnOverlay = document.querySelector('#respawn-overlay');
const toast = document.querySelector('#toast');
const resultOverlay = document.querySelector('#result-overlay');
const rematchButton = document.querySelector('#rematch-button');
const rematchStatus = document.querySelector('#rematch-status');
const levelList = document.querySelector('#level-list');
const levelHostNote = document.querySelector('#level-host-note');
const resultLevelName = document.querySelector('#result-level-name');
const reconnectOverlay = document.querySelector('#reconnect-overlay');
const reconnectSeconds = document.querySelector('#reconnect-seconds');
const reconnectStatus = document.querySelector('#reconnect-status');
const reconnectTicks = document.querySelector('#reconnect-ticks');
const endedOverlay = document.querySelector('#session-ended-overlay');
const endedMessage = document.querySelector('#session-ended-message');
const lobbyConfirmOverlay = document.querySelector('#lobby-confirm-overlay');
const continueButton = document.querySelector('#continue-button');
const input = { left: false, right: false, jump: false, interact: false };
const parameters = new URLSearchParams(location.search);
let pendingLobbyReadyHandoff = parameters.get('lobbyReady') === '1';
const RESUME_TOKEN_KEY = 'starlight-resume-token';
const MUTE_KEY = 'starlight-muted';
let socket = null;
let playerId = null;
let sequence = 0;
let latestSnapshot = null;
let toastTimer = 0;
let reconnectTimer = 0;
let reconnectDeadline = 0;
let connectionState = 'connecting';
let sessionPaused = false;
let sessionEnded = false;
let intentionalClose = false;
let previousFocus = null;
let levelCatalog = [];
let levelRecords = {};
let selectedLevelId = 'starlight-tower';
let hasSeenCoopBoost = false;

// HTML은 READY 버튼을 숨긴 채 시작해 런처 인계 화면의 순간 노출을 막고, 직접 진입에서만 복구한다.
readyOverlay.hidden = pendingLobbyReadyHandoff;
readyButton.hidden = pendingLobbyReadyHandoff;
if (aiStartButton) aiStartButton.hidden = pendingLobbyReadyHandoff;

// 런처의 신규 세션 진입에서만 이전 토큰을 비우고, 새로고침은 재접속으로 처리한다.
if (parameters.get('fresh') === '1') {
  localStorage.removeItem(RESUME_TOKEN_KEY);
  parameters.delete('fresh');
  const cleanUrl = `${location.pathname}?${parameters.toString()}`;
  history.replaceState(null, '', cleanUrl);
}

for (let index = 0; index < 15; index += 1) reconnectTicks.appendChild(document.createElement('i'));

/** @returns {string} 현재 경로의 WebSocket URL (mode 파라미터 포함) */
function buildWebSocketUrl() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const basePath = location.pathname.replace(/\/[^/]*$/, '/');
  const mode = parameters.get('mode');
  const modeQuery = mode ? `?mode=${mode}` : '';
  return `${protocol}//${location.host}${basePath}ws${modeQuery}`;
}

/** @param {object} message 송신 메시지 @returns {void} */
function send(message) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }

/** @param {number} milliseconds 밀리초 @returns {string} MM:SS.d */
function formatTime(milliseconds) { const tenths = Math.floor(milliseconds / 100); return `${String(Math.floor(tenths / 600)).padStart(2, '0')}:${String(Math.floor((tenths % 600) / 10)).padStart(2, '0')}.${tenths % 10}`; }

/** @param {string} levelId 레벨 ID @returns {object|null} */
function findLevel(levelId) { return levelCatalog.find((level) => level.id === levelId) ?? null; }

/** @returns {void} */
function renderLevelCards() {
  levelList.replaceChildren();
  for (const level of levelCatalog) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'level-card'; button.dataset.levelId = level.id; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(level.id === selectedLevelId)); button.disabled = playerId !== 'p1';
    button.style.setProperty('--card-sky', level.palette.sky); button.style.setProperty('--card-haze', level.palette.haze); button.style.setProperty('--card-accent', level.palette.accent);
    const record = levelRecords[level.id];
    const estimated = getLocale() === 'ko' ? `${t('menu.estimatedTime')} ${level.minutes}분` : `${t('menu.estimatedTime')} ${level.minutes} min`;
    button.innerHTML = `<span class="level-banner" aria-hidden="true"></span><span class="level-info"><strong></strong><small></small><em></em><span class="level-meta"><span><b>${t('menu.estimatedTime')}</b><span>${estimated.replace(`${t('menu.estimatedTime')} `, '')}</span></span><span><b>${t('menu.best')}</b><time>${record ? formatTime(record) : '--:--.-'}</time></span></span></span><span class="selection-seal">✉ <b>${t('menu.selected')}</b></span><span class="guest-lock" aria-hidden="true"></span>`;
    button.querySelector('strong').textContent = t(level.nameKey); button.querySelector('small').textContent = t(level.themeKey); button.querySelector('em').textContent = t(level.descriptionKey);
    button.addEventListener('click', () => send({ type: CLIENT_MESSAGE.SELECT_LEVEL, levelId: level.id }));
    levelList.appendChild(button);
  }
  levelHostNote.textContent = t(playerId === 'p1' ? 'menu.hostControl' : 'menu.hostOnly');
}

/** @param {object} message 서버 메뉴 상태 @returns {void} */
function updateMenu(message) {
  levelCatalog = message.levels ?? levelCatalog; levelRecords = message.records ?? levelRecords; selectedLevelId = message.selectedLevelId ?? selectedLevelId; renderLevelCards();
  if (message.phase === 'waiting' && !pendingLobbyReadyHandoff) { readyOverlay.hidden = false; resultOverlay.hidden = true; }
}

/** @param {string} message 사용자 문구 @returns {void} */
function showToast(message) { clearTimeout(toastTimer); toast.textContent = message; toast.classList.add('visible'); toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 1000); }

/** @returns {void} */
function updateConnectionLabel() {
  connectionPanel.dataset.state = connectionState;
  connectionLabel.textContent = t(`connection.${connectionState === 'recovered' ? 'online' : connectionState}`);
}

/** @param {boolean} inert 모달 뒤 상호작용 차단 여부 @returns {void} */
function setBackgroundInert(inert) {
  for (const selector of ['#game-canvas', '#hud', '#toast', '#ready-overlay', '#respawn-overlay', '#result-overlay', '.toolbar']) {
    const element = document.querySelector(selector);
    if (element) element.inert = inert;
  }
}

/** @returns {void} */
function updateHud() {
  if (!latestSnapshot || !playerId) return;
  progressLabel.textContent = `${Math.min(latestSnapshot.checkpointId + 1, 8)} / 8`;
  const sectionKey = latestSnapshot.checkpointId < 3 ? 'section.name' : latestSnapshot.checkpointId < 6 ? 'section.windRing' : 'section.observatory';
  sectionName.removeAttribute('data-i18n'); sectionName.textContent = t(sectionKey);
  elapsedTime.textContent = formatTime(latestSnapshot.elapsedMs);
  const local = latestSnapshot.players.find((player) => player.id === playerId);
  const partner = latestSnapshot.players.find((player) => player.id !== playerId);
  selfStatus.textContent = t(local?.anchored ? 'status.anchored' : 'status.moving');
  partnerStatus.textContent = t(sessionPaused ? 'connection.closed' : partner?.anchored ? 'status.anchored' : 'status.partner');
  const device = latestSnapshot.devices[latestSnapshot.checkpointId];
  if (latestSnapshot.checkpointId >= 8) {
    actionHint.textContent = t('hint.final'); finishClock.hidden = false;
    const firstPressedAt = [latestSnapshot.finishState.leftPressedAt, latestSnapshot.finishState.rightPressedAt].filter((value) => value !== null).sort((a, b) => a - b)[0];
    const remainingTicks = firstPressedAt === undefined ? 12 : Math.max(0, Math.ceil((3000 - (latestSnapshot.elapsedMs - firstPressedAt)) / 250));
    finishClock.querySelectorAll('i').forEach((tick, index) => tick.classList.toggle('active', index < remainingTicks));
  } else {
    finishClock.hidden = true;
    const showBoostHint = latestSnapshot.checkpointId === 0 && device?.state === 'IDLE' && !hasSeenCoopBoost && latestSnapshot.players.every((player) => player.boostConsumed === false);
    actionHint.textContent = t(showBoostHint ? 'hint.boost' : device?.state === 'POWERED' ? device.anchorPlayerId === playerId ? 'hint.checkpoint' : 'hint.switch' : device?.state === 'LATCHED' ? 'hint.checkpoint' : 'hint.anchor');
  }
  respawnOverlay.hidden = !latestSnapshot.players.some((player) => player.respawnTimer > 0);
}

/** @param {Array<{id:string,name:string,ready:boolean,connected?:boolean}>} players 참가자 @returns {void} */
function updateReadyState(players) {
  for (const role of ['p1', 'p2']) {
    const player = players.find((entry) => entry.id === role);
    const name = document.querySelector(`#${role}-name`);
    const card = document.querySelector(`#${role}-crew`);
    name.removeAttribute('data-i18n'); name.textContent = player?.name ?? '…';
    card.classList.toggle('ready', Boolean(player?.ready));
    card.classList.toggle('connected', Boolean(player?.connected));
  }
  readyNote.removeAttribute('data-i18n'); readyNote.textContent = players.length < 2 ? t('waiting.partner') : players.every((player) => player.ready) ? t('ready.done') : t('waiting.ready');
  const mineReady = players.find((player) => player.id === playerId)?.ready;
  readyButton.disabled = Boolean(mineReady);
  readyButton.textContent = t(mineReady ? 'ready.done' : 'ready');
}

/** @param {{kind:string,eventId?:number,payload?:object}} event 서버 이벤트 @returns {void} */
function handleEvent(event) {
  if (event.kind === 'COOP_BOOST') {
    hasSeenCoopBoost = true;
    renderer.playCoopBoost({ eventId: event.eventId, ...event.payload });
    showToast(t('event.boost'));
    updateHud();
    return;
  }
  const keys = { DEVICE_POWERED: 'event.powered', DEVICE_LATCHED: 'event.latched', CHECKPOINT: 'event.checkpoint', FALL: 'event.fall', FINISH_STARTED: 'event.finish', FINISH_EXPIRED: 'event.expired' };
  if (keys[event.kind]) showToast(t(keys[event.kind]));
}

/** @param {{elapsedMs:number,falls:number,roleSwaps:number}} result 결과 @returns {void} */
function showResult(result) {
  document.querySelector('#result-time').textContent = formatTime(result.elapsedMs); document.querySelector('#result-best').textContent = formatTime(result.bestMs ?? result.elapsedMs); document.querySelector('#result-falls').textContent = String(result.falls); document.querySelector('#result-swaps').textContent = String(result.roleSwaps);
  document.querySelector('#new-best-badge').hidden = !result.newBest;
  levelRecords = result.records ?? levelRecords; const level = findLevel(result.levelId ?? selectedLevelId); resultLevelName.textContent = level ? t(level.nameKey) : '';
  resultOverlay.querySelectorAll('[data-result-action]').forEach((button) => { button.disabled = false; button.classList.remove('chosen'); }); rematchButton.querySelector('.button-label').textContent = t('result.retry'); rematchStatus.textContent = t('result.waitingChoice'); resultOverlay.className = 'overlay result-overlay'; resultOverlay.removeAttribute('aria-busy'); resultOverlay.hidden = false;
}

/** @returns {void} */
function updateReconnectCountdown() {
  if (!reconnectDeadline) return;
  const seconds = Math.max(0, Math.ceil((reconnectDeadline - Date.now()) / 1000));
  reconnectSeconds.textContent = String(seconds);
  reconnectTicks.querySelectorAll('i').forEach((tick, index) => tick.classList.toggle('active', index < seconds));
}

/** @param {number} deadline 서버 유예 마감 시각 @returns {void} */
function showReconnect(deadline) {
  reconnectDeadline = deadline; sessionPaused = true; reconnectOverlay.classList.remove('recovered'); reconnectOverlay.hidden = false; lobbyConfirmOverlay.hidden = true; updateReconnectCountdown();
  setBackgroundInert(true); clearInterval(reconnectTimer); reconnectTimer = window.setInterval(updateReconnectCountdown, 200); reconnectOverlay.focus(); updateHud();
}

/** @param {'reconnect_expired'|'agreed_exit'|'network_failed'} reason 종료 사유 @returns {void} */
function showSessionEnded(reason) {
  sessionEnded = true; sessionPaused = true; clearInterval(reconnectTimer); reconnectOverlay.hidden = true; lobbyConfirmOverlay.hidden = true; resultOverlay.classList.toggle('network-failed', reason === 'network_failed');
  setBackgroundInert(true); endedMessage.removeAttribute('data-i18n'); endedMessage.textContent = t(reason === 'agreed_exit' ? 'session.agreed' : 'session.expired'); endedOverlay.hidden = false; endedOverlay.querySelector('button').focus();
}

/** @returns {void} */
function finishResume() {
  sessionPaused = false; readyOverlay.hidden = true; connectionState = 'recovered'; updateConnectionLabel(); reconnectOverlay.classList.add('recovered'); reconnectStatus.removeAttribute('data-i18n'); reconnectStatus.textContent = t('reconnect.recovered'); reconnectTicks.querySelectorAll('i').forEach((tick) => tick.classList.add('active'));
  window.setTimeout(() => { reconnectOverlay.hidden = true; reconnectOverlay.classList.remove('recovered'); reconnectStatus.textContent = t('reconnect.paused'); connectionState = 'online'; updateConnectionLabel(); setBackgroundInert(false); }, 240); updateHud();
}

/** @param {object} message 서버 메시지 @returns {void} */
function handleServerMessage(message) {
  if (message.type === SERVER_MESSAGE.WELCOME) {
    playerId = message.playerId; localStorage.setItem(RESUME_TOKEN_KEY, message.resumeToken); renderer.setPlayerId(playerId); connectionState = 'online'; updateConnectionLabel(); document.body.dataset.playerId = playerId; updateMenu(message);
  } else if (message.type === SERVER_MESSAGE.READY_STATE) updateReadyState(message.players);
  else if (message.type === SERVER_MESSAGE.MENU_STATE) updateMenu(message);
  else if (message.type === 'START') { pendingLobbyReadyHandoff = false; readyButton.hidden = false; if (aiStartButton) aiStartButton.hidden = false; renderer.resetInterpolation(); readyOverlay.hidden = true; resultOverlay.hidden = true; rematchButton.disabled = false; sessionPaused = false; hasSeenCoopBoost = false; }
  else if (message.type === SERVER_MESSAGE.SNAPSHOT) {
    latestSnapshot = message; renderer.setSnapshot(message, performance.now()); const local = message.players.find((player) => player.id === playerId); document.body.dataset.serverTick = String(message.tick); document.body.dataset.levelId = message.levelId; document.body.dataset.checkpoint = String(message.checkpointId); document.body.dataset.finishPhase = message.finishState.phase; if (local) document.body.dataset.playerX = String(Math.round(local.x)); updateHud();
  } else if (message.type === SERVER_MESSAGE.EVENT) handleEvent(message);
  else if (message.type === SERVER_MESSAGE.GAME_OVER) showResult(message);
  else if (message.type === SERVER_MESSAGE.PAUSED) { renderer.resetInterpolation(); showReconnect(message.reconnectDeadline); }
  else if (message.type === SERVER_MESSAGE.RESUMED) { renderer.resetInterpolation(); finishResume(); }
  else if (message.type === SERVER_MESSAGE.SESSION_ENDED) showSessionEnded(message.reason);
  else if (message.type === SERVER_MESSAGE.RESULT_VOTE_STATE) {
    const votes = message.votes ?? {}; const mine = votes[playerId]; const values = Object.values(votes);
    resultOverlay.querySelectorAll('[data-result-action]').forEach((button) => {
      const action = button.dataset.resultAction; button.classList.toggle('chosen', action === mine); button.classList.toggle('agreed', values.length === 2 && values.every((value) => value === action)); button.disabled = false;
      let marks = button.querySelector('.vote-marks'); if (!marks) { marks = document.createElement('span'); marks.className = 'vote-marks'; marks.innerHTML = '<i class="p1">△</i><i class="p2">••</i>'; button.appendChild(marks); }
      marks.querySelector('.p1').classList.toggle('active', votes.p1 === action); marks.querySelector('.p2').classList.toggle('active', votes.p2 === action);
    });
    rematchStatus.textContent = t(values.length === 0 ? 'result.waitingChoice' : values.length === 1 ? 'result.partnerChoice' : values[0] === values[1] ? 'result.processing' : 'result.choiceMismatch');
    resultOverlay.classList.toggle('processing', message.status === 'processing'); if (message.status === 'processing') resultOverlay.setAttribute('aria-busy', 'true'); else resultOverlay.removeAttribute('aria-busy');
    if (message.status === 'menu') { resultOverlay.hidden = true; readyOverlay.hidden = false; }
  }
  else if (message.type === SERVER_MESSAGE.REMATCH_STATE) {
    const mineReady = message.ready.includes(playerId); rematchButton.disabled = mineReady; rematchStatus.textContent = t(message.status === 'partner_left' ? 'result.partnerLeft' : message.status === 'processing' ? 'result.processing' : message.ready.length === 2 ? 'result.bothReady' : mineReady ? 'result.ready' : 'result.waiting');
    resultOverlay.classList.toggle('solo-ready', message.ready.length === 1); resultOverlay.classList.toggle('solo-p1', message.ready.length === 1 && message.ready[0] === 'p1'); resultOverlay.classList.toggle('solo-p2', message.ready.length === 1 && message.ready[0] === 'p2'); resultOverlay.classList.toggle('both-ready', message.ready.length === 2);
    if (message.status === 'partner_left') resultOverlay.classList.add('partner-left'); if (message.status === 'processing') { resultOverlay.classList.add('processing'); resultOverlay.setAttribute('aria-busy', 'true'); }
  } else if (message.type === SERVER_MESSAGE.ERROR) { showToast(t(message.messageKey)); if (message.code === 'RESUME_EXPIRED') showSessionEnded('reconnect_expired'); }
}

/** @returns {void} */
function connect() {
  if (sessionEnded || intentionalClose) return;
  connectionState = 'connecting'; updateConnectionLabel();
  socket = new WebSocket(buildWebSocketUrl());
  socket.addEventListener('open', () => {
    connectionState = 'online'; updateConnectionLabel();
    const fallback = `${t('default.name')} ${Math.floor(Math.random() * 90 + 10)}`;
    send({ type: CLIENT_MESSAGE.JOIN, name: parameters.get('name')?.slice(0, 20) || fallback, sessionToken: localStorage.getItem(RESUME_TOKEN_KEY) ?? '', locale: getLocale(), requestedRole: parameters.get('role'), readyFromLobby: parameters.get('lobbyReady') === '1' });
  });
  socket.addEventListener('message', (event) => { try { handleServerMessage(JSON.parse(event.data)); } catch { showToast(t('error.invalidMessage')); } });
  socket.addEventListener('close', () => { connectionState = 'closed'; updateConnectionLabel(); if (!intentionalClose && !sessionEnded) window.setTimeout(connect, 350); });
}

/** @param {string} code 키 코드 @returns {keyof typeof input|null} */
function mapKey(code) { if (code === 'KeyA' || code === 'ArrowLeft') return 'left'; if (code === 'KeyD' || code === 'ArrowRight') return 'right'; if (code === 'Space') return 'jump'; if (code === 'KeyE' || code === 'Enter') return 'interact'; return null; }

/** @returns {void} */
function returnToLobby() { intentionalClose = true; localStorage.removeItem(RESUME_TOKEN_KEY); send({ type: CLIENT_MESSAGE.LEAVE_GAME }); window.setTimeout(() => { socket?.close(); location.href = '/'; }, 120); }

/** @returns {void} */
function openLobbyConfirm() { previousFocus = document.activeElement; lobbyConfirmOverlay.hidden = false; continueButton.focus(); }

/** @returns {void} */
function closeLobbyConfirm() { lobbyConfirmOverlay.hidden = true; previousFocus?.focus?.(); }

readyButton.addEventListener('click', () => send({ type: CLIENT_MESSAGE.READY }));
if (aiStartButton) {
  aiStartButton.addEventListener('click', () => {
    localStorage.removeItem(RESUME_TOKEN_KEY);
    location.href = `${location.pathname}?mode=ai&fresh=1`;
  });
}
document.querySelectorAll('[data-result-action]').forEach((button) => button.addEventListener('click', () => send({ type: CLIENT_MESSAGE.RESULT_VOTE, action: button.dataset.resultAction })));
document.querySelector('#session-lobby-button').addEventListener('click', returnToLobby);
document.querySelector('#toolbar-lobby-button').addEventListener('click', openLobbyConfirm);
continueButton.addEventListener('click', closeLobbyConfirm);
document.querySelector('#confirm-lobby-button').addEventListener('click', returnToLobby);
document.querySelector('#locale-button').addEventListener('click', (event) => { const locale = toggleLocale(); event.currentTarget.setAttribute('aria-pressed', String(locale === 'en')); updateConnectionLabel(); updateHud(); renderLevelCards(); });
document.querySelector('#mute-button').addEventListener('click', (event) => { const muted = event.currentTarget.getAttribute('aria-pressed') !== 'true'; event.currentTarget.setAttribute('aria-pressed', String(muted)); localStorage.setItem(MUTE_KEY, String(muted)); });
window.addEventListener('keydown', (event) => {
  if (!lobbyConfirmOverlay.hidden) {
    if (event.key === 'Escape') { event.preventDefault(); closeLobbyConfirm(); return; }
    if (event.key === 'Tab') { const buttons = [...lobbyConfirmOverlay.querySelectorAll('button')]; const index = buttons.indexOf(document.activeElement); event.preventDefault(); buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus(); return; }
  }
  if (isNativeKeyboardTarget(event.target)) return;
  const key = mapKey(event.code); if (!key || sessionPaused) return; input[key] = true; event.preventDefault();
});
window.addEventListener('keyup', (event) => { if (isNativeKeyboardTarget(event.target)) return; const key = mapKey(event.code); if (!key) return; input[key] = false; event.preventDefault(); });
document.querySelector('#mute-button').setAttribute('aria-pressed', localStorage.getItem(MUTE_KEY) === 'true' ? 'true' : 'false');
document.querySelector('#locale-button').setAttribute('aria-pressed', String(getLocale() === 'en'));
window.setInterval(() => { if (!sessionPaused) send({ type: CLIENT_MESSAGE.INPUT, seq: sequence++, ...input }); }, 1000 / 30);
applyLocale();
connect();
renderer.start();
