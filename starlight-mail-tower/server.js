/**
 * @fileoverview 별빛 우편탑 정적 파일, 30Hz 권위 세션, 15초 재접속 수명주기를 제공한다.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { advanceModuleForTesting, applyInput, createSimulation, snapshotSimulation, stepSimulation, triggerFinishForTesting } from './game/simulation.js';
import { createRecordStore } from './game/records.js';
import { WORLD } from './shared/level-data.js';
import { DEFAULT_LEVEL_ID, LEVELS, getLevel, getLevelCatalog, getNextLevel, validateLevel } from './shared/levels.js';
import { CLIENT_MESSAGE, ERROR_CODE, LEVEL_VERSION, SERVER_MESSAGE, SNAPSHOT_RATE, TICK_RATE, validateClientMessage } from './shared/protocol.js';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const MIME = Object.freeze({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' });
const DEFAULT_RECONNECT_GRACE_MS = 15_000;

/**
 * 현재 연결된 두 역할이 모두 재시작에 동의했는지 확인한다.
 * @param {Map<string,{playerId:string,ws:object|null}>} slots 역할 슬롯
 * @param {Set<string>} votes 재시작 투표 집합
 * @returns {boolean} 현재 연결된 정확히 두 명의 만장일치 여부
 */
export function hasRestartQuorum(slots, votes) {
  const connectedIds = [...slots.values()].filter((slot) => slot.ws).map((slot) => slot.playerId);
  return connectedIds.length === 2 && votes.size === 2 && connectedIds.every((playerId) => votes.has(playerId));
}

/**
 * 별빛 우편탑 앱 인스턴스를 만든다.
 * @param {{hostUrl?:string,testing?:boolean,reconnectGraceMs?:number}} [options] 통합 런처·테스트 옵션
 * @returns {{handleHttp:Function,handleUpgrade:Function,setHostUrl:Function,close:Function,getSimulation:Function}}
 */
export function createApp(options = {}) {
  for (const level of LEVELS) {
    const validation = validateLevel(level);
    if (!validation.ok) throw new Error(`Invalid level ${level.id}: ${validation.errors.join(', ')}`);
  }
  let hostUrl = options.hostUrl ?? '';
  const getBotUrl = options.getBotUrl ?? null;
  let botChild = null;
  const reconnectGraceMs = options.reconnectGraceMs ?? (Number(process.env.STARLIGHT_RECONNECT_MS) || DEFAULT_RECONNECT_GRACE_MS);
  const testing = options.testing === true || process.env.STARLIGHT_TESTING === '1';
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });
  const clients = new Map();
  const slots = new Map();
  const expiredTokens = new Set();
  const ready = new Set();
  const restartVotes = new Set();
  const resultVotes = new Map();
  const defaultRecordsPath = path.join(ROOT_DIR, testing ? 'test-results' : 'data', 'records.json');
  const recordStore = createRecordStore(options.recordsPath ?? defaultRecordsPath);
  let selectedLevelId = DEFAULT_LEVEL_ID;
  let simulation = createSimulation(selectedLevelId);
  let restartTimer = null;
  let resultTimer = null;
  let pauseState = null;

  /** @param {import('ws').WebSocket} ws 대상 소켓 @param {object} payload 메시지 @returns {void} */
  function send(ws, payload) { if (ws.readyState === 1) ws.send(JSON.stringify(payload)); }

  /** @param {object} payload 메시지 @returns {void} */
  function broadcast(payload) { for (const [ws, client] of clients) if (client.playerId) send(ws, payload); }

  /** @returns {void} */
  function broadcastReadyState() {
    broadcast({ type: SERVER_MESSAGE.READY_STATE, players: [...slots.values()].map((slot) => ({ id: slot.playerId, name: slot.name, ready: ready.has(slot.playerId), connected: Boolean(slot.ws) })) });
  }

  /** @returns {void} */
  function broadcastMenuState() { broadcast({ type: SERVER_MESSAGE.MENU_STATE, phase: simulation.phase, selectedLevelId, levels: getLevelCatalog(), records: recordStore.getAll(), hostPlayerId: 'p1', votes: Object.fromEntries(resultVotes) }); }

  /** @returns {'p1'|'p2'|null} */
  function nextSlot() { if (!slots.has('p1')) return 'p1'; if (!slots.has('p2')) return 'p2'; return null; }

  /** @returns {void} */
  function startIfReady() {
    if (simulation.phase !== 'waiting') return;
    const joined = [...slots.values()].filter((slot) => slot.ws);
    if (joined.length !== 2 || !joined.every((slot) => ready.has(slot.playerId))) return;
    simulation = createSimulation(selectedLevelId);
    simulation.phase = 'playing';
    ready.clear(); resultVotes.clear();
    broadcast({ type: 'START', levelId: selectedLevelId });
  }

  /**
   * 예약된 결과 합의 전환을 취소한다.
   * @returns {void}
   */
  function cancelResultTransition() { if (resultTimer) { clearTimeout(resultTimer); resultTimer = null; } }

  /**
   * 종료된 세션에 연결 또는 유효한 재접속 예약이 없으면 다음 매치용 초기 상태로 되돌린다.
   * @returns {boolean} 초기화를 수행했는지 여부
   */
  function resetEndedSessionIfAbandoned() {
    if (simulation.phase !== 'ended' || clients.size !== 0) return false;
    const now = Date.now();
    const hasReconnectReservation = [...slots.values()].some((slot) => !slot.ws && slot.disconnectDeadline && slot.disconnectDeadline > now);
    if (hasReconnectReservation) return false;

    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
    cancelResultTransition();
    for (const slot of slots.values()) if (slot.disconnectTimer) clearTimeout(slot.disconnectTimer);
    slots.clear();
    expiredTokens.clear();
    ready.clear();
    restartVotes.clear();
    resultVotes.clear();
    pauseState = null;
    selectedLevelId = DEFAULT_LEVEL_ID;
    simulation = createSimulation(selectedLevelId);
    return true;
  }

  /**
   * 현재 연결된 두 역할의 최신 결과 표를 다시 평가해 유일한 전환을 예약한다.
   * @returns {void}
   */
  function scheduleResultConsensus() {
    cancelResultTransition();
    const connectedIds = [...slots.values()].filter((slot) => slot.ws).map((slot) => slot.playerId);
    if (simulation.phase !== 'result' || connectedIds.length !== 2) return;
    const action = resultVotes.get(connectedIds[0]);
    if (!action || connectedIds.some((id) => resultVotes.get(id) !== action)) return;
    broadcast({ type: SERVER_MESSAGE.RESULT_VOTE_STATE, votes: Object.fromEntries(resultVotes), status: 'processing' });
    resultTimer = setTimeout(() => {
      resultTimer = null;
      const currentIds = [...slots.values()].filter((slot) => slot.ws).map((slot) => slot.playerId);
      if (simulation.phase !== 'result' || currentIds.length !== 2 || currentIds.some((id) => resultVotes.get(id) !== action)) { scheduleResultConsensus(); return; }
      resultVotes.clear(); ready.clear(); restartVotes.clear();
      if (action === 'NEXT') selectedLevelId = getNextLevel(selectedLevelId).id;
      if (action === 'SELECT') { simulation = createSimulation(selectedLevelId); simulation.phase = 'waiting'; broadcast({ type: SERVER_MESSAGE.RESULT_VOTE_STATE, votes: {}, status: 'menu' }); broadcastReadyState(); broadcastMenuState(); return; }
      simulation = createSimulation(selectedLevelId); simulation.phase = 'playing'; broadcast({ type: 'START', levelId: selectedLevelId }); broadcastMenuState();
    }, 360);
    resultTimer.unref();
  }

  /** @param {string} missingPlayerId 만료할 역할 @returns {void} */
  function expireReconnect(missingPlayerId) {
    const slot = slots.get(missingPlayerId);
    if (!slot || slot.ws) return;
    if (slot.disconnectTimer) clearTimeout(slot.disconnectTimer);
    expiredTokens.add(slot.resumeToken);
    slots.delete(missingPlayerId);
    ready.delete(missingPlayerId);
    restartVotes.delete(missingPlayerId);
    resultVotes.delete(missingPlayerId);
    cancelResultTransition();
    simulation.phase = 'ended';
    pauseState = null;
    broadcast({ type: SERVER_MESSAGE.SESSION_ENDED, reason: 'reconnect_expired', playerId: missingPlayerId });
    resetEndedSessionIfAbandoned();
  }

  /** @param {object} client 연결 메타 @returns {void} */
  function pauseForDisconnect(client) {
    const slot = slots.get(client.playerId);
    if (!slot || slot.ws !== client.ws) return;
    slot.ws = null;
    cancelResultTransition();
    slot.disconnectDeadline = Date.now() + reconnectGraceMs;
    if (!pauseState) pauseState = { previousPhase: simulation.phase };
    simulation.phase = 'paused';
    if (slot.disconnectTimer) clearTimeout(slot.disconnectTimer);
    slot.disconnectTimer = setTimeout(() => expireReconnect(client.playerId), reconnectGraceMs);
    slot.disconnectTimer.unref();
    broadcast({ type: SERVER_MESSAGE.PAUSED, reason: 'partner_reconnecting', playerId: client.playerId, reconnectDeadline: slot.disconnectDeadline });
  }

  /** mode=ai 진입 시 봇 프로세스를 기동한다. @returns {void} */
  function spawnBot() {
    if (!getBotUrl || botChild) return;
    const url = getBotUrl();
    botChild = spawn(process.execPath, [path.join(ROOT_DIR, 'bot.js'), '--url', url], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    });
    botChild.on('error', (err) => {
      console.error(`[starlight-bot] spawn 에러:`, err.message);
      botChild = null;
    });
    botChild.on('exit', (code) => {
      botChild = null;
      console.log(`[starlight-bot] 종료 (code=${code})`);
    });
    console.log(`[starlight-bot] 기동: ${url} (pid=${botChild.pid})`);
  }

  /** 봇 프로세스를 종료한다. @returns {void} */
  function killBot() {
    if (botChild) {
      console.log(`[starlight-bot] kill (pid=${botChild.pid})`);
      botChild.kill('SIGTERM');
      botChild = null;
    }
  }

  /** @param {import('ws').WebSocket} ws 소켓 @param {object} client 메타 @param {object} slot 역할 슬롯 @returns {void} */
  function resumeSlot(ws, client, slot) {
    if (slot.disconnectTimer) clearTimeout(slot.disconnectTimer);
    slot.disconnectTimer = null;
    slot.ws = ws;
    slot.disconnectDeadline = null;
    Object.assign(client, { playerId: slot.playerId, name: slot.name, locale: slot.locale, resumeToken: slot.resumeToken });
    send(ws, { type: SERVER_MESSAGE.WELCOME, playerId: slot.playerId, sessionId: 'starlight-session', resumeToken: slot.resumeToken, levelVersion: LEVEL_VERSION, hostUrl, resumed: true, selectedLevelId, levels: getLevelCatalog(), records: recordStore.getAll() });
    send(ws, { type: SERVER_MESSAGE.SNAPSHOT, ...snapshotSimulation(simulation), ackSeq: simulation.players.find((player) => player.id === slot.playerId)?.ackSeq ?? -1 });
    const connectedSlots = [...slots.values()].filter((entry) => entry.ws);
    if (connectedSlots.length === 2) {
      simulation.phase = pauseState?.previousPhase && pauseState.previousPhase !== 'paused' ? pauseState.previousPhase : 'playing';
      pauseState = null;
      broadcast({ type: SERVER_MESSAGE.RESUMED, playerId: slot.playerId });
      if (simulation.phase === 'result') scheduleResultConsensus();
    } else {
      simulation.phase = 'paused';
      const nextDeadline = Math.min(...[...slots.values()].filter((entry) => !entry.ws && entry.disconnectDeadline).map((entry) => entry.disconnectDeadline));
      send(ws, { type: SERVER_MESSAGE.PAUSED, reason: 'partner_reconnecting', playerId: slot.playerId, reconnectDeadline: Number.isFinite(nextDeadline) ? nextDeadline : Date.now() + reconnectGraceMs });
    }
    broadcastReadyState();
  }

  /** @param {import('ws').WebSocket} ws 발신 소켓 @param {object} message 검증 메시지 @returns {void} */
  function handleMessage(ws, message) {
    const client = clients.get(ws);
    if (!client) return;
    if (message.type === CLIENT_MESSAGE.JOIN) {
      if (client.playerId) return;
      const resumeSlotEntry = [...slots.values()].find((slot) => message.sessionToken && slot.resumeToken === message.sessionToken && !slot.ws && slot.disconnectDeadline > Date.now());
      if (resumeSlotEntry) { resumeSlot(ws, client, resumeSlotEntry); return; }
      if (message.sessionToken) {
        // 서버 재시작 전 토큰이나 이미 사용 중인 토큰을 신규 참가자로 받아들이면
        // 오래된 탭의 자동 재접속이 빈 역할을 선점하므로 유효한 예약 외에는 모두 만료 처리한다.
        send(ws, { type: SERVER_MESSAGE.ERROR, code: ERROR_CODE.RESUME_EXPIRED, messageKey: 'error.resumeExpired' });
        ws.close(1008, 'resume expired');
        return;
      }
      const preferred = message.requestedRole && !slots.has(message.requestedRole) ? message.requestedRole : null;
      const playerId = preferred ?? nextSlot();
      if (!playerId) { send(ws, { type: SERVER_MESSAGE.ERROR, code: ERROR_CODE.ROOM_FULL, messageKey: 'error.roomFull' }); ws.close(1008, 'room full'); return; }
      const resumeToken = crypto.randomUUID();
      const slot = { playerId, name: message.name, locale: message.locale, resumeToken, ws, disconnectDeadline: null, disconnectTimer: null };
      slots.set(playerId, slot);
      // 같은 역할을 새 사람이 이어받을 때 이전 연결 수명의 결과 표를 절대 상속하지 않는다.
      resultVotes.delete(playerId); cancelResultTransition();
      Object.assign(client, { playerId, name: slot.name, locale: slot.locale, resumeToken });
      send(ws, { type: SERVER_MESSAGE.WELCOME, playerId, sessionId: 'starlight-session', resumeToken, levelVersion: LEVEL_VERSION, hostUrl, resumed: false, selectedLevelId, levels: getLevelCatalog(), records: recordStore.getAll() });
      if (message.readyFromLobby && simulation.phase === 'waiting') ready.add(playerId);
      broadcastReadyState();
      broadcastMenuState();
      startIfReady();
      return;
    }
    if (!client.playerId) { send(ws, { type: SERVER_MESSAGE.ERROR, code: ERROR_CODE.JOIN_REQUIRED, messageKey: 'error.joinRequired' }); return; }
    if (message.type === CLIENT_MESSAGE.READY) {
      if (simulation.phase !== 'waiting') { send(ws, { type: SERVER_MESSAGE.ERROR, code: ERROR_CODE.INVALID_MESSAGE, messageKey: 'error.invalidMessage' }); return; }
      ready.add(client.playerId); broadcastReadyState(); startIfReady(); return;
    }
    if (message.type === CLIENT_MESSAGE.SELECT_LEVEL) {
      if (simulation.phase !== 'waiting' || client.playerId !== 'p1' || !getLevel(message.levelId)) { send(ws, { type: SERVER_MESSAGE.ERROR, code: ERROR_CODE.INVALID_MESSAGE, messageKey: 'error.levelSelection' }); return; }
      selectedLevelId = message.levelId;
      ready.clear();
      simulation = createSimulation(selectedLevelId);
      broadcastReadyState(); broadcastMenuState();
      return;
    }
    if (message.type === CLIENT_MESSAGE.RESULT_VOTE && simulation.phase === 'result') {
      resultVotes.set(client.playerId, message.action);
      broadcast({ type: SERVER_MESSAGE.RESULT_VOTE_STATE, votes: Object.fromEntries(resultVotes) });
      scheduleResultConsensus();
      return;
    }
    if (message.type === CLIENT_MESSAGE.RESTART_VOTE && simulation.phase === 'result') {
      message.agree ? restartVotes.add(client.playerId) : restartVotes.delete(client.playerId);
      broadcast({ type: SERVER_MESSAGE.REMATCH_STATE, ready: [...restartVotes] });
      if (hasRestartQuorum(slots, restartVotes) && !restartTimer) {
        broadcast({ type: SERVER_MESSAGE.REMATCH_STATE, ready: [...restartVotes], status: 'processing' });
        restartTimer = setTimeout(() => {
          restartTimer = null;
          if (!hasRestartQuorum(slots, restartVotes) || simulation.phase !== 'result') { broadcast({ type: SERVER_MESSAGE.REMATCH_STATE, ready: [...restartVotes] }); return; }
          restartVotes.clear(); simulation = createSimulation(selectedLevelId); simulation.phase = 'playing'; broadcast({ type: 'START', levelId: selectedLevelId });
        }, 600);
        restartTimer.unref();
      }
      return;
    }
    if (message.type === CLIENT_MESSAGE.LEAVE_GAME) {
      client.explicitLeave = true;
      restartVotes.delete(client.playerId);
      resultVotes.delete(client.playerId);
      cancelResultTransition();
      if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
      if (simulation.phase === 'result') { broadcast({ type: SERVER_MESSAGE.REMATCH_STATE, ready: [...restartVotes], status: 'partner_left', playerId: client.playerId }); broadcast({ type: SERVER_MESSAGE.RESULT_VOTE_STATE, votes: Object.fromEntries(resultVotes), status: 'partner_left' }); }
      else { simulation.phase = 'ended'; broadcast({ type: SERVER_MESSAGE.SESSION_ENDED, reason: 'agreed_exit', playerId: client.playerId }); }
      const slot = slots.get(client.playerId);
      if (slot) slots.delete(client.playerId);
      ready.delete(client.playerId);
      return;
    }
    if (message.type === CLIENT_MESSAGE.INPUT && simulation.phase === 'playing') {
      const now = Date.now();
      if (now - client.inputWindowAt >= 1000) Object.assign(client, { inputWindowAt: now, inputCount: 0 });
      if (client.inputCount >= 60) return;
      client.inputCount += 1;
      applyInput(simulation, client.playerId, message);
    }
  }

  /** @param {import('ws').WebSocket} ws 새 소켓 @returns {void} */
  function registerSocket(ws) {
    const client = { ws, playerId: null, name: '', locale: 'ko', resumeToken: '', explicitLeave: false, inputWindowAt: Date.now(), inputCount: 0 };
    clients.set(ws, client);
    ws.on('message', (raw) => {
      if (raw.length > 2048) return ws.close(1009, 'payload too large');
      let parsed; try { parsed = JSON.parse(raw.toString()); } catch { parsed = null; }
      const result = validateClientMessage(parsed);
      if (!result.ok) return send(ws, { type: SERVER_MESSAGE.ERROR, code: result.code, messageKey: 'error.invalidMessage' });
      handleMessage(ws, result.message);
    });
    ws.on('close', () => {
      clients.delete(ws);
      if (client.playerId) {
        restartVotes.delete(client.playerId);
        if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
      }
      if (client.playerId && !client.explicitLeave && simulation.phase !== 'ended') pauseForDisconnect(client);
      else if (client.playerId) {
        ready.delete(client.playerId);
        const slot = slots.get(client.playerId);
        if (slot?.ws === ws) {
          slot.ws = null;
          slot.disconnectDeadline = null;
        }
      }
      // 모든 클라이언트가 떠나면 봇 프로세스도 종료한다.
      if (clients.size === 0) killBot();
      resetEndedSessionIfAbandoned();
      if (testing && clients.size === 0) {
        for (const slot of slots.values()) if (slot.disconnectTimer) clearTimeout(slot.disconnectTimer);
        pauseState = null; slots.clear(); ready.clear(); restartVotes.clear(); resultVotes.clear(); cancelResultTransition(); selectedLevelId = DEFAULT_LEVEL_ID; simulation = createSimulation(selectedLevelId);
      }
      broadcastReadyState();
    });
  }

  wss.on('connection', registerSocket);

  let accumulator = 0;
  let lastTime = performance.now();
  let snapshotAccumulator = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    accumulator = Math.min(accumulator + (now - lastTime) / 1000, 0.25);
    lastTime = now;
    const fixedDt = 1 / TICK_RATE;
    while (accumulator >= fixedDt) {
      const events = stepSimulation(simulation, fixedDt);
      events.forEach((event) => {
        broadcast({ type: SERVER_MESSAGE.EVENT, ...event });
        if (event.kind === 'GAME_COMPLETED') {
          const record = recordStore.update(selectedLevelId, event.payload.elapsedMs);
          broadcast({ type: SERVER_MESSAGE.GAME_OVER, ...event.payload, levelId: selectedLevelId, bestMs: record.bestMs, newBest: record.updated, records: recordStore.getAll() });
        }
      });
      accumulator -= fixedDt;
      snapshotAccumulator += fixedDt;
    }
    if (snapshotAccumulator >= 1 / SNAPSHOT_RATE) {
      const snapshot = snapshotSimulation(simulation);
      for (const [ws, client] of clients) if (client.playerId) send(ws, { type: SERVER_MESSAGE.SNAPSHOT, ...snapshot, ackSeq: snapshot.players.find((player) => player.id === client.playerId)?.ackSeq ?? -1 });
      snapshotAccumulator = 0;
    }
  }, 8);
  timer.unref();

  /** @param {http.IncomingMessage} req 요청 @param {http.ServerResponse} res 응답 @returns {void} */
  function handleHttp(req, res) {
    const requestUrl = new URL(req.url ?? '/', 'http://local');
    const pathname = decodeURIComponent(requestUrl.pathname);
    if (testing && req.method === 'POST' && pathname.startsWith('/__test/')) {
      if (pathname === '/__test/advance') advanceModuleForTesting(simulation);
      else if (pathname === '/__test/fall') simulation.players[0].y = simulation.level.world.dangerY + 1;
      else if (pathname === '/__test/select') { const id = requestUrl.searchParams.get('level'); if (getLevel(id)) { selectedLevelId = id; simulation = createSimulation(id); } }
      else if (pathname === '/__test/finish') triggerFinishForTesting(simulation);
      else if (pathname === '/__test/expire-reconnect' && pauseState) {
        const missingSlot = [...slots.values()].find((slot) => !slot.ws && slot.disconnectDeadline);
        if (missingSlot) expireReconnect(missingSlot.playerId);
      }
      else if (pathname === '/__test/set-reconnect-seconds' && pauseState) {
        const seconds = Math.max(1, Math.min(15, Number(requestUrl.searchParams.get('seconds')) || 5));
        const slot = [...slots.values()].find((entry) => !entry.ws && entry.disconnectDeadline);
        if (slot) { slot.disconnectDeadline = Date.now() + seconds * 1000; broadcast({ type: SERVER_MESSAGE.PAUSED, reason: 'partner_reconnecting', playerId: slot.playerId, reconnectDeadline: slot.disconnectDeadline }); }
      }
      else { res.writeHead(404); res.end('Not Found'); return; }
      res.writeHead(204); res.end(); return;
    }
    let base = PUBLIC_DIR;
    let relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
    if (relative.startsWith('shared/')) { base = path.join(ROOT_DIR, 'shared'); relative = relative.slice('shared/'.length); }
    const target = path.resolve(base, relative);
    if (!target.startsWith(path.resolve(base) + path.sep) && target !== path.resolve(base)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(target, (error, data) => { if (error) { res.writeHead(404); res.end('Not Found'); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data); });
  }

  /** @param {http.IncomingMessage} req 요청 @param {import('stream').Duplex} socket 소켓 @param {Buffer} head 업그레이드 헤드 @returns {void} */
  function handleUpgrade(req, socket, head) {
    const requestUrl = new URL(req.url ?? '/', 'http://local');
    const mode = requestUrl.searchParams.get('mode');
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
      // mode=ai: 인간이 접속한 것이므로 봇 spawn
      if (mode === 'ai' && !botChild) spawnBot();
    });
  }
  /** @param {string} value 호스트 주소 @returns {void} */
  function setHostUrl(value) { hostUrl = value; }
  /** @returns {void} */
  function close() { killBot(); clearInterval(timer); if (restartTimer) clearTimeout(restartTimer); if (resultTimer) clearTimeout(resultTimer); for (const slot of slots.values()) if (slot.disconnectTimer) clearTimeout(slot.disconnectTimer); for (const ws of clients.keys()) ws.terminate(); wss.close(); }
  /** @returns {object} */
  function getSimulation() { return simulation; }
  return { handleHttp, handleUpgrade, setHostUrl, close, getSimulation };
}

/** @returns {number} */
function readPort() { const index = process.argv.indexOf('--port'); return index >= 0 ? Number(process.argv[index + 1]) || 3015 : Number(process.env.PORT) || 3015; }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  server.listen(readPort(), '0.0.0.0', () => { const address = server.address(); const port = typeof address === 'object' && address ? address.port : readPort(); console.log(`[starlight-mail-tower] http://0.0.0.0:${port}`); });
}
