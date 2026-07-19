/** @fileoverview 달빛 주방열차 정적 서버, 30Hz 권위 세션과 15초 재접속을 제공한다. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RECONNECT_GRACE_MS, ROUND_DURATION_MS } from './shared/game-data.js';
import { CLIENT_MESSAGE, ERROR_CODE, MAX_PAYLOAD_BYTES, SERVER_MESSAGE, SNAPSHOT_RATE, TICK_RATE, validateClientMessage } from './shared/protocol.js';
import { applyInput, createSimulation, finishForTesting, snapshotSimulation, stepSimulation } from './game/simulation.js';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const MIME = Object.freeze({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml' });

/**
 * 독립 또는 통합 프록시에서 사용할 게임 앱을 만든다.
 * @param {{reconnectGraceMs?:number,testing?:boolean}} [options] 테스트 옵션
 * @returns {{handleHttp:Function,handleUpgrade:Function,close:Function,getSimulation:Function}}
 */
export function createApp(options = {}) {
  const reconnectGraceMs = options.reconnectGraceMs ?? RECONNECT_GRACE_MS;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  const clients = new Map(); const slots = new Map(); const ready = new Set(); const expiredTokens = new Set(); const votes = new Map();
  let simulation = createSimulation(); let pauseState = null; let lastSnapshotTick = -1; let voteTimer = null; let voteDeadline = null;

  /** @param {import('ws').WebSocket} ws 소켓 @param {object} payload 메시지 @returns {void} */
  function send(ws, payload) { if (ws.readyState === 1) ws.send(JSON.stringify(payload)); }
  /** @param {object} payload 메시지 @returns {void} */
  function broadcast(payload) { for (const slot of slots.values()) if (slot.ws) send(slot.ws, payload); }
  /** @returns {void} */
  function broadcastReady() { broadcast({ type: SERVER_MESSAGE.READY_STATE, players: [...slots.values()].map((slot) => ({ id: slot.playerId, name: slot.name, ready: ready.has(slot.playerId), connected: Boolean(slot.ws) })) }); }
  /** @returns {'p1'|'p2'|null} */
  function nextSlot() { if (!slots.has('p1')) return 'p1'; if (!slots.has('p2')) return 'p2'; return null; }
  /** @returns {void} */
  function startIfReady() { const joined = [...slots.values()].filter((slot) => slot.ws); if (simulation.phase !== 'waiting' || joined.length !== 2 || !joined.every((slot) => ready.has(slot.playerId))) return; simulation = createSimulation(simulation.seed); simulation.phase = 'playing'; ready.clear(); broadcast({ type: SERVER_MESSAGE.START, seed: simulation.seed, durationMs: ROUND_DURATION_MS, startedAt: Date.now() }); }

  /** 연결된 슬롯이 없을 때 세션 상태를 원자적으로 초기화한다. 중복 호출해도 안전하다. @returns {boolean} 초기화 여부 */
  function resetSessionIfEmpty() { if ([...slots.values()].some((slot) => slot.ws?.readyState === 1)) return false; for (const slot of slots.values()) if (slot.timer) clearTimeout(slot.timer); slots.clear(); ready.clear(); votes.clear(); expiredTokens.clear(); pauseState = null; if (voteTimer) clearTimeout(voteTimer); voteTimer = null; voteDeadline = null; simulation = createSimulation(); lastSnapshotTick = -1; return true; }

  /** 슬롯의 타이머와 참조를 한 번만 정리한다. @param {string} playerId 역할 @param {import('ws').WebSocket|null} [expectedWs] 예상 소켓 @returns {boolean} */
  function cleanupSlot(playerId, expectedWs = null) { const slot = slots.get(playerId); if (!slot || (expectedWs && slot.ws && slot.ws !== expectedWs)) return false; if (slot.timer) clearTimeout(slot.timer); slot.timer = null; slot.disconnectDeadline = null; slot.ws = null; slots.delete(playerId); ready.delete(playerId); votes.delete(playerId); return true; }

  /** @param {string} reason 종료 사유 @param {object} [details] 추가 정보 @returns {void} */
  function endSession(reason, details = {}) { if (simulation.phase !== 'ended') { simulation.phase = 'ended'; pauseState = null; broadcast({ type: SERVER_MESSAGE.SESSION_ENDED, reason, ...details }); } for (const [playerId, slot] of [...slots]) { if (slot.timer) clearTimeout(slot.timer); slot.timer = null; slot.disconnectDeadline = null; if (!slot.ws || slot.ws.readyState !== 1) cleanupSlot(playerId); } resetSessionIfEmpty(); }

  /** @param {string} playerId 만료 역할 @returns {void} */
  function expireReconnect(playerId) { const slot = slots.get(playerId); if (!slot || slot.ws) return; expiredTokens.add(slot.resumeToken); cleanupSlot(playerId); endSession('reconnect_expired', { missingPlayerId: playerId }); }

  /** @param {object} client 연결 메타 @returns {void} */
  function pauseForDisconnect(client) { const slot = slots.get(client.playerId); if (!slot || slot.ws !== client.ws) return; slot.ws = null; if (simulation.phase === 'result') { endSession('partner_left_result', { playerId: slot.playerId }); return; } slot.disconnectDeadline = Date.now() + reconnectGraceMs; if (!pauseState) pauseState = { previousPhase: simulation.phase, startedAt: Date.now() }; simulation.phase = 'paused'; slot.timer = setTimeout(() => expireReconnect(slot.playerId), reconnectGraceMs); slot.timer.unref(); broadcast({ type: SERVER_MESSAGE.PAUSED, missingPlayerId: slot.playerId, reconnectDeadline: slot.disconnectDeadline }); }

  /** @param {import('ws').WebSocket} ws 소켓 @param {object} client 메타 @param {object} slot 슬롯 @returns {void} */
  function resumeSlot(ws, client, slot) { if (slot.timer) clearTimeout(slot.timer); slot.timer = null; slot.ws = ws; slot.disconnectDeadline = null; Object.assign(client, { playerId: slot.playerId, name: slot.name, locale: slot.locale, resumeToken: slot.resumeToken }); send(ws, { type: SERVER_MESSAGE.WELCOME, playerId: slot.playerId, resumeToken: slot.resumeToken, resumed: true, serverTime: Date.now() }); if ([...slots.values()].filter((entry) => entry.ws).length === 2 && pauseState) { const pausedMs = Date.now() - pauseState.startedAt; simulation.phase = pauseState.previousPhase; pauseState = null; broadcast({ type: SERVER_MESSAGE.RESUMED, playerId: slot.playerId, pausedMs }); } const player = simulation.players.find((entry) => entry.id === slot.playerId); setImmediate(() => send(ws, { type: SERVER_MESSAGE.SNAPSHOT, ...snapshotSimulation(simulation), ackSeq: player?.ackSeq ?? 0 })); broadcastReady(); }

  /** @param {import('ws').WebSocket} ws 소켓 @param {object} message 검증 메시지 @returns {void} */
  function handleMessage(ws, message) {
    const client = clients.get(ws); if (!client) return;
    if (message.type === CLIENT_MESSAGE.JOIN) {
      if (client.playerId) return;
      const resumable = [...slots.values()].find((slot) => message.sessionToken && slot.resumeToken === message.sessionToken && !slot.ws && slot.disconnectDeadline > Date.now());
      if (resumable) { resumeSlot(ws, client, resumable); return; }
      if (message.sessionToken && expiredTokens.has(message.sessionToken)) { send(ws, { type: SERVER_MESSAGE.ERROR, code: ERROR_CODE.RESUME_EXPIRED, messageKey: 'error.resumeExpired' }); ws.close(1008); return; }
      if (!['waiting'].includes(simulation.phase)) { send(ws, { type: SERVER_MESSAGE.ERROR, code: ERROR_CODE.SESSION_ACTIVE, messageKey: 'error.sessionActive' }); ws.close(1008); return; }
      const preferred = message.requestedRole && !slots.has(message.requestedRole) ? message.requestedRole : null; const playerId = preferred ?? nextSlot();
      if (!playerId) { send(ws, { type: SERVER_MESSAGE.ERROR, code: ERROR_CODE.ROOM_FULL, messageKey: 'error.roomFull' }); ws.close(1008); return; }
      const resumeToken = crypto.randomBytes(24).toString('base64url'); const slot = { playerId, name: message.name, locale: message.locale, resumeToken, ws, disconnectDeadline: null, timer: null }; slots.set(playerId, slot); Object.assign(client, { playerId, name: slot.name, locale: slot.locale, resumeToken });
      send(ws, { type: SERVER_MESSAGE.WELCOME, playerId, resumeToken, resumed: false, serverTime: Date.now() }); if (message.readyFromLobby) ready.add(playerId); broadcastReady(); startIfReady(); return;
    }
    if (!client.playerId) { send(ws, { type: SERVER_MESSAGE.ERROR, code: ERROR_CODE.JOIN_REQUIRED, messageKey: 'error.joinRequired' }); return; }
    if (message.type === CLIENT_MESSAGE.READY) { if (simulation.phase !== 'waiting') return; ready.add(client.playerId); broadcastReady(); startIfReady(); return; }
    if (message.type === CLIENT_MESSAGE.INPUT) { const now = Date.now(); if (now - client.rateWindowAt >= 1000) { client.rateWindowAt = now; client.rateCount = 0; } client.rateCount += 1; if (client.rateCount > 60) { send(ws, { type: SERVER_MESSAGE.ERROR, code: ERROR_CODE.RATE_LIMIT, messageKey: 'error.rateLimit' }); return; } applyInput(simulation, client.playerId, message, ++simulation.receiveOrdinal); return; }
    if (message.type === CLIENT_MESSAGE.RESULT_VOTE && simulation.phase === 'result') { votes.set(client.playerId, message.action);if(!voteDeadline){voteDeadline=Date.now()+30000;voteTimer=setTimeout(()=>{votes.clear();voteDeadline=null;voteTimer=null;broadcast({type:SERVER_MESSAGE.RESULT_VOTE_STATE,votes:{},status:'reset'});},30000);voteTimer.unref();}const actions=[...slots.values()].filter((slot)=>slot.ws).map((slot)=>votes.get(slot.playerId));const status=actions.filter(Boolean).length===2&&actions[0]!==actions[1]?'split':'waiting';broadcast({ type: SERVER_MESSAGE.RESULT_VOTE_STATE, votes: Object.fromEntries(votes), status, deadline:voteDeadline }); if (actions.length === 2 && actions[0] && actions[0] === actions[1]) {if(voteTimer)clearTimeout(voteTimer);voteTimer=null;voteDeadline=null; if (actions[0] === 'RETRY') { simulation = createSimulation(simulation.seed); simulation.phase = 'playing'; votes.clear(); broadcast({ type: SERVER_MESSAGE.START, seed: simulation.seed, durationMs: ROUND_DURATION_MS, startedAt: Date.now() }); } else { votes.clear();ready.clear();broadcast({ type: SERVER_MESSAGE.RESULT_VOTE_STATE, votes: {}, status: 'lobby' });simulation.phase='ended';pauseState=null;for(const [playerId,slot] of [...slots])if(!slot.ws||slot.ws.readyState!==1)cleanupSlot(playerId);resetSessionIfEmpty(); } } return; }
    if (message.type === CLIENT_MESSAGE.LEAVE_GAME) { endSession('player_left', { playerId: client.playerId }); }
  }

  wss.on('connection', (ws) => { const client = { ws, playerId: null, invalidCount: 0, rateWindowAt: Date.now(), rateCount: 0 }; clients.set(ws, client); ws.on('message', (raw) => { if (raw.length > MAX_PAYLOAD_BYTES) { ws.close(1009); return; } let parsed; try { parsed = JSON.parse(raw.toString()); } catch { parsed = null; } const validation = validateClientMessage(parsed); if (!validation.ok) { client.invalidCount += 1; send(ws, { type: SERVER_MESSAGE.ERROR, code: validation.code, messageKey: 'error.invalidMessage' }); if (client.invalidCount >= 3) ws.close(1008); return; } handleMessage(ws, validation.value); }); ws.on('close', () => { const current = clients.get(ws); clients.delete(ws); if (!current?.playerId) { resetSessionIfEmpty(); return; } if (simulation.phase !== 'ended') { pauseForDisconnect(current); return; } cleanupSlot(current.playerId, ws); resetSessionIfEmpty(); }); });

  const timer = setInterval(() => { if (simulation.phase === 'playing') { stepSimulation(simulation, 1000 / TICK_RATE); if(options.testing&&simulation.tick===3)finishForTesting(simulation); for (const event of simulation.events.splice(0)) { const payload = { type: SERVER_MESSAGE.EVENT, id: `event_${++simulation.nextEventId}`, kind: event.kind, serverTime: Date.now(), payload: event.payload }; broadcast(payload); if (event.kind === 'GAME_OVER') broadcast({ type: SERVER_MESSAGE.GAME_OVER, ...event.payload }); } for (const direct of simulation.directMessages.splice(0)) { const slot = slots.get(direct.playerId); if (slot?.ws) send(slot.ws, direct.message); } if (simulation.tick % (TICK_RATE / SNAPSHOT_RATE) === 0 && simulation.tick !== lastSnapshotTick) { lastSnapshotTick = simulation.tick; for (const slot of slots.values()) if (slot.ws) send(slot.ws, { type: SERVER_MESSAGE.SNAPSHOT, ...snapshotSimulation(simulation), ackSeq: simulation.players.find((player) => player.id === slot.playerId).ackSeq }); } } }, 1000 / TICK_RATE); timer.unref();

  /** @param {http.IncomingMessage} req 요청 @param {http.ServerResponse} res 응답 @returns {void} */
  function handleHttp(req, res) { const requestPath = new URL(req.url, 'http://local').pathname; const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, ''); const filePath = path.resolve(PUBLIC_DIR, relative); if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) { res.writeHead(404); res.end('Not found'); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); fs.createReadStream(filePath).pipe(res); }
  /** @param {http.IncomingMessage} req 요청 @param {import('stream').Duplex} socket 소켓 @param {Buffer} head 선행 데이터 @returns {void} */
  function handleUpgrade(req, socket, head) { wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req)); }
  /** @returns {void} */
  function close() { clearInterval(timer);if(voteTimer)clearTimeout(voteTimer); for (const slot of slots.values()) if (slot.timer) clearTimeout(slot.timer); for (const client of clients.keys()) client.close(); wss.close(); }
  return { handleHttp, handleUpgrade, close, getSimulation: () => simulation };
}

/** @param {string[]} argv 명령행 인자 @returns {number} 포트 */
function parsePort(argv) { const index = argv.indexOf('--port'); return index >= 0 ? Number(argv[index + 1]) : Number(process.env.PORT || 3016); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { const app = createApp(); const server = http.createServer(app.handleHttp); server.on('upgrade', app.handleUpgrade); const port = parsePort(process.argv); server.listen(port, '0.0.0.0', () => process.stdout.write(`Moonlight Kitchen Express: http://localhost:${port}\n`)); }
