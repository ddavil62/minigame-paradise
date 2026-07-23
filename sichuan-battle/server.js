/**
 * @fileoverview 사천성 배틀의 정적 파일과 서버 권위 LAN 1:1 WebSocket 세션을 제공한다.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { SichuanGame } from './lib/game.js';
import { ITEM_DEFINITIONS } from './lib/items.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const ASSET_DIR = path.join(__dirname, 'assets');
const BOT_PATH = path.join(__dirname, 'bot.js');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
/** 운영 환경의 재접속 유예 시간 계약이다. */
export const DISCONNECT_GRACE_MS = 15_000;

/** @param {string} name 사용자 입력 이름 @returns {string} 안전한 표시 이름 */
function normalizeName(name) { return String(name || 'Player').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 12) || 'Player'; }

/** @param {WebSocket} ws 소켓 @param {object} payload 메시지 @returns {void} */
function send(ws, payload) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload)); }

/**
 * 통합 런처 또는 독립 서버에서 사용할 앱 인스턴스를 생성한다.
 * @param {{hostUrl?:string,testing?:boolean,now?:()=>number,seed?:number,duration?:number,disconnectGraceMs?:number,getBotUrl?:()=>string|null,aiConfig?:object}} [options] 설정
 * @returns {{handleHttp:Function,handleUpgrade:Function,setHostUrl:Function,close:Function}}
 */
export function createApp(options = {}) {
  let hostUrl = options.hostUrl || ''; const wss = new WebSocketServer({ noServer: true });
  const getBotUrl = typeof options.getBotUrl === 'function' ? options.getBotUrl : (() => null);
  // 운영 계약은 15초로 고정하고 테스트 모드에서만 실제 타이머 경로를 빠르게 검증한다.
  const disconnectGraceMs = options.testing && Number.isFinite(options.disconnectGraceMs) ? Math.max(1, options.disconnectGraceMs) : DISCONNECT_GRACE_MS;
  /** @type {{slots:object[],game:SichuanGame|null,rematch:Set<string>,tick:NodeJS.Timeout|null}} */
  const room = { slots: [], game: null, rematch: new Set(), tick: null };
  let aiSession = null; let aiGeneration = 0;

  /** @param {string} base 기본 URL @param {string} token 서버 발급 토큰 @returns {string} 인증 URL */
  function makeBotUrl(base, token) { const url = new URL(base); url.searchParams.set('mode', 'bot'); url.searchParams.set('botToken', token); return url.toString(); }

  /** @param {string} reason 정리 사유 @param {boolean} [clearRoom=false] 방도 초기화할지 @returns {void} */
  function disposeAiSession(reason, clearRoom = false) {
    if (!aiSession && !room.slots.some((slot) => slot.isBot)) return;
    const current = aiSession; aiSession = null; aiGeneration += 1;
    if (current?.process && !current.process.killed) current.process.kill();
    for (const slot of room.slots.filter((entry) => entry.isBot)) { slot.disposed = true; try { slot.ws.close(1000, reason); } catch {} clearTimeout(slot.disconnectTimer); }
    room.slots = room.slots.filter((slot) => !slot.isBot);
    if (clearRoom) { clearInterval(room.tick); room.tick = null; room.slots.forEach((slot) => clearTimeout(slot.disconnectTimer)); room.slots = []; room.game = null; room.rematch.clear(); }
  }

  /** @param {object} requester 요청 슬롯 @returns {void} 서버 발급 토큰으로 AI를 생성한다. */
  function requestAiOpponent(requester) {
    if (room.game || room.slots.some((slot) => slot.isBot) || aiSession || room.slots.filter((slot) => slot.connected && !slot.isBot).length !== 1) { send(requester.ws, { type: 'ERROR', code: 'AI_UNAVAILABLE' }); return; }
    const base = getBotUrl(); if (!base) { send(requester.ws, { type: 'ERROR', code: 'AI_UNAVAILABLE' }); return; }
    const token = crypto.randomBytes(24).toString('hex'); const generation = ++aiGeneration; const botUrl = makeBotUrl(base, token);
    try {
      const child = options.aiConfig?.spawn === false ? null : spawn(process.execPath, [BOT_PATH, '--url', botUrl], { stdio: options.aiConfig?.stdio || 'ignore', windowsHide: true });
      aiSession = { token, generation, process: child, authorized: false, requesterId: requester.id };
      child?.once('exit', () => { if (aiSession?.generation === generation && !aiSession.authorized) { aiSession = null; send(requester.ws, { type: 'ERROR', code: 'AI_UNAVAILABLE' }); } });
      send(requester.ws, { type: 'AI_REQUESTED' });
    } catch { aiSession = null; send(requester.ws, { type: 'ERROR', code: 'AI_UNAVAILABLE' }); }
  }

  /** @param {object} slot 슬롯 @returns {void} 개인 스냅샷을 보낸다. */
  function sendState(slot) { if (room.game) send(slot.ws, { type: 'STATE_SYNC', snapshot: room.game.snapshot(slot.id), serverNow: Date.now() }); }

  /** @returns {void} 모든 연결에 개인화 상태를 동기화한다. */
  function syncAll() { room.slots.filter((slot) => slot.connected).forEach(sendState); }

  /** @returns {void} 대기실 연결 상태를 알린다. */
  function broadcastRoom() {
    for (const slot of room.slots.filter((entry) => entry.connected)) send(slot.ws, { type: 'ROOM_STATE', myId: slot.id, players: room.slots.map((entry) => ({ id: entry.id, name: entry.name, ready: entry.ready, connected: entry.connected, isBot: Boolean(entry.isBot) })) });
  }

  /** @returns {void} 두 플레이어 준비 완료 시 경기를 시작한다. */
  function maybeStart() {
    const active = room.slots.filter((slot) => slot.connected);
    if (active.length !== 2 || !active.every((slot) => slot.ready) || room.game) return;
    room.game = new SichuanGame({ seed: options.testing ? options.seed : undefined, now: options.now, duration: options.duration });
    active.forEach((slot) => room.game.addPlayer(slot.id, slot.name, Boolean(slot.isBot))); room.game.start();
    active.forEach((slot) => send(slot.ws, { type: 'START', snapshot: room.game.snapshot(slot.id), serverNow: Date.now() }));
    room.tick = setInterval(() => {
      const revisions = new Map(room.game?.players.map((player) => [player.id, player.board.revision]) || []);
      room.game?.tick();
      for (const player of room.game?.players || []) if (player.board.revision !== revisions.get(player.id)) {
        const slot = room.slots.find((entry) => entry.id === player.id); if (slot) send(slot.ws, { type: 'BOARD_SHUFFLED', board: room.game.snapshot(player.id).me.board });
      }
      syncAll();
    }, 250);
  }

  /** @param {object} slot 플레이어 슬롯 @param {string} type 메시지 종류 @returns {boolean} 빈도 제한 통과 여부 */
  function allowMessage(slot,type){const now=Date.now();slot.rateEvents=slot.rateEvents.filter((event)=>event.at>now-1000);const total=slot.rateEvents.length;const typed=slot.rateEvents.filter((event)=>event.type===type).length;const limited=total>=30||(type==='MATCH_PAIR'&&typed>=15)||(type==='USE_ITEM'&&typed>=8);if(limited){slot.rateViolations+=1;send(slot.ws,{type:'ERROR',code:'RATE_LIMIT'});if(slot.rateViolations>=3)slot.ws.close(1008,'rate limit');return false;}slot.rateEvents.push({type,at:now});if(slot.rateViolations>0&&total<20)slot.rateViolations-=1;return true;}

  /** @param {object} slot 요청자 @param {object} message 메시지 @returns {void} */
  function handleMessage(slot, message) {
    if (!message || Array.isArray(message) || typeof message !== 'object' || typeof message.type !== 'string') { send(slot.ws, { type: 'ERROR', code: 'INVALID_MESSAGE' }); return; }
    if (message.type === 'READY') { slot.ready = !slot.ready; broadcastRoom(); maybeStart(); return; }
    if (message.type === 'REQUEST_AI') { if (slot.isBot) { send(slot.ws, { type: 'ERROR', code: 'AI_UNAVAILABLE' }); return; } requestAiOpponent(slot); return; }
    if (message.type === 'PING') { send(slot.ws, { type: 'PONG', clientTime: message.clientTime, serverNow: Date.now() }); return; }
    if (message.type === 'RETURN_LOBBY' || message.type === 'LEAVE_MATCH') { if (room.slots.some((entry) => entry.isBot)) disposeAiSession('human left', true); else slot.ws.close(); return; }
    if (!room.game) { send(slot.ws, { type: 'ERROR', code: 'NOT_PLAYING' }); return; }
    if(options.testing&&message.type==='TEST_FINISH_MATCH'){room.game.finish(slot.id,'test');syncAll();return;}
    if (options.testing && message.type === 'TEST_GRANT_ITEM' && ITEM_DEFINITIONS[message.itemId]) {
      const player=room.game.players.find((entry)=>entry.id===slot.id);if(player&&player.inventory.length<3){player.inventoryRevision+=1;player.inventory.push({slotId:`test-${player.inventoryRevision}`,itemId:message.itemId});syncAll();}return;
    }
    if (message.type === 'MATCH_PAIR') {
      const result = room.game.matchPair(slot.id, message);
      send(slot.ws, { type: result.ok ? 'PAIR_ACCEPTED' : 'PAIR_REJECTED', ...result, requestId: message.requestId });
      if(result.ok&&result.shuffleWarning)send(slot.ws,{type:'SHUFFLE_WARNING',targetId:slot.id,...result.shuffleWarning});syncAll(); return;
    }
    if (message.type === 'USE_ITEM') {
      const result = room.game.useItem(slot.id, message);
      send(slot.ws, { type: 'ITEM_RESOLVED', ...result });
      if (result.ok && result.itemId === 'force_shuffle' && !result.blocked) { const target=room.slots.find((entry)=>entry.id!==slot.id);room.slots.forEach((entry) => send(entry.ws, { type: 'SHUFFLE_WARNING', effectId: result.effectId, targetId: target?.id, executeAt: Date.now() + 800 })); }
      if (result.blocked) room.slots.forEach((entry) => send(entry.ws, { type: 'ATTACK_BLOCKED', itemId: result.itemId, defenderId: room.slots.find((entry) => entry.id !== slot.id)?.id }));
      syncAll(); return;
    }
    if (message.type === 'REMATCH') {
      if(room.game.phase!=='result'||!room.game.result){send(slot.ws,{type:'ERROR',code:'REMATCH_NOT_AVAILABLE'});return;}
      if(!message.matchId||message.matchId!==room.game.matchId){send(slot.ws,{type:'ERROR',code:'STALE_MATCH'});return;}
      room.rematch.add(slot.id); room.slots.forEach((entry) => send(entry.ws, { type: 'REMATCH_STATUS', votes: room.rematch.size }));
      if (room.rematch.size === 2) { clearInterval(room.tick); room.game = null; room.rematch.clear(); room.slots.forEach((entry) => { entry.ready = true; }); maybeStart(); }
      return;
    }
    send(slot.ws, { type: 'ERROR', code: 'UNKNOWN_TYPE' });
  }

  wss.on('connection', (ws, request) => {
    const url = new URL(request.url || '/', 'http://localhost'); const token = url.searchParams.get('sessionToken'); const botMode = url.searchParams.get('mode') === 'bot';
    if (botMode && (!aiSession || aiSession.authorized || url.searchParams.get('botToken') !== aiSession.token)) { send(ws, { type: 'ERROR', code: 'BOT_UNAUTHORIZED' }); ws.close(1008, 'bot unauthorized'); return; }
    let slot = token ? room.slots.find((entry) => entry.token === token && entry.graceUntil > Date.now()) : null;
    if (!slot && room.slots.filter((entry) => entry.connected).length >= 2) { send(ws, { type: 'ERROR', code: 'ROOM_FULL' }); ws.close(); return; }
    if (slot) { slot.ws = ws; slot.connected = true; clearTimeout(slot.disconnectTimer); room.slots.filter((entry) => entry.isBot && entry.connected).forEach((entry) => send(entry.ws, { type: 'CONNECTION_STATE', opponentConnected: true })); }
    else {
      const id = room.slots.some((entry) => entry.id === 'p1') ? 'p2' : 'p1'; slot = { id, token: crypto.randomUUID(), name: botMode ? '사천 현자 AI' : normalizeName(url.searchParams.get('name')), isBot: botMode, ready: false, ws, connected: true, graceUntil: 0, disconnectTimer: null, rateEvents: [], rateViolations: 0, oversizeEvents: [] }; room.slots.push(slot); if (botMode) aiSession.authorized = true;
    }
    send(ws, { type: 'JOINED', playerId: slot.id, sessionToken: slot.token, hostUrl, reconnected: Boolean(token), waiting: !room.game, isBot: Boolean(slot.isBot), aiAvailable: Boolean(getBotUrl()) });
    if (room.game) sendState(slot); else broadcastRoom();
    ws.on('message', (raw) => {
      if (raw.length > 8192) {const now=Date.now();slot.oversizeEvents=slot.oversizeEvents.filter((at)=>at>now-10000);slot.oversizeEvents.push(now);send(ws,{type:'ERROR',code:'MESSAGE_TOO_LARGE'});if(slot.oversizeEvents.length>=3)ws.close(1009,'repeated oversized messages');return;}
      try {const message=JSON.parse(raw.toString());if(message&&typeof message==='object'&&!Array.isArray(message)&&typeof message.type==='string'&&!allowMessage(slot,message.type))return;handleMessage(slot,message);} catch { send(ws, { type: 'ERROR', code: 'INVALID_JSON' }); }
    });
    ws.on('close', () => {
      if (slot.disposed) return;
      slot.connected = false;
      if (slot.isBot) { disposeAiSession('bot disconnected', true); return; }
      if (!room.game || room.game.phase === 'waiting') { room.slots = room.slots.filter((entry) => entry !== slot); broadcastRoom(); return; }
      if (!room.slots.some((entry) => entry.connected)) {
        clearInterval(room.tick); room.slots.forEach((entry) => clearTimeout(entry.disconnectTimer)); room.slots = []; room.game = null; room.rematch.clear(); return;
      }
      slot.graceUntil = Date.now() + disconnectGraceMs; room.slots.filter((entry) => entry.connected).forEach((entry) => send(entry.ws, { type: 'CONNECTION_STATE', opponentConnected: false, graceEndsAt: slot.graceUntil }));
      slot.disconnectTimer = setTimeout(() => { if (!slot.connected && room.game) { if (!room.game.result) { const winner = room.slots.find((entry) => entry !== slot && entry.connected); room.game.finish(winner?.id || null, 'disconnect'); syncAll(); } if (room.slots.some((entry) => entry.isBot)) disposeAiSession('reconnect expired', true); } }, disconnectGraceMs + 50);
    });
  });

  /** @param {http.IncomingMessage} request 요청 @param {http.ServerResponse} response 응답 @returns {void} */
  function handleHttp(request, response) {
    const rawPath = decodeURIComponent((request.url || '/').split('?')[0]); let relative = rawPath.replace(/^\/sichuan-battle\/?/, '').replace(/^\/+/, '');
    if (!relative || relative.endsWith('/')) relative += 'index.html';
    const root = relative.startsWith('assets/') ? __dirname : PUBLIC_DIR; const absolute = path.resolve(root, relative);
    if (!absolute.startsWith(root) || (!absolute.startsWith(PUBLIC_DIR) && !absolute.startsWith(ASSET_DIR))) { response.writeHead(403); response.end('Forbidden'); return; }
    fs.stat(absolute, (error, stat) => { if (error || !stat.isFile()) { response.writeHead(404); response.end('Not Found'); return; } response.writeHead(200, { 'Content-Type': MIME[path.extname(absolute)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); fs.createReadStream(absolute).pipe(response); });
  }

  /** @param {http.IncomingMessage} request 요청 @param {import('node:stream').Duplex} socket 소켓 @param {Buffer} head 선행 데이터 @returns {void} */
  function handleUpgrade(request, socket, head) { wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request)); }
  return { handleHttp, handleUpgrade, setHostUrl(value) { hostUrl = value; }, close() { disposeAiSession('server close', true); clearInterval(room.tick); room.slots.forEach((slot) => clearTimeout(slot.disconnectTimer)); wss.close(); } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3018); const app = createApp({ testing: process.env.SICHUAN_E2E === '1', seed: process.env.SICHUAN_E2E === '1' ? 4242 : undefined, getBotUrl: () => `ws://127.0.0.1:${port}/sichuan-battle/ws?mode=bot` }); const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade); server.listen(port, '0.0.0.0', () => {
    const address = Object.values(os.networkInterfaces()).flat().find((entry) => entry?.family === 'IPv4' && !entry.internal)?.address || 'localhost';
    app.setHostUrl(`http://${address}:${port}/`); console.log(`사천성 배틀: http://localhost:${port}`);
  });
}
