/**
 * @fileoverview 마작(일본식 리치마작) WebSocket + 정적 파일 서버.
 *
 * - 서버 권위: 모든 판정은 lib/game.js가 수행하고 클라이언트는 행동 의도만 보낸다.
 * - 4인 1룸. 사람 1~4명이 입장하면 방 설정 화면에서 호스트가 시작하며, 빈 자리는 서버 관리형 AI가 채운다.
 *   사람이 2명이면 마주 보는 자리(동·서)에 앉는다.
 * - AI는 별도 프로세스 없이 서버 안에서 lib/ai.js로 결정한다.
 * - 통합 런처에서는 createApp()을 import하고, 단독 실행(`node server.js --port N`)도 지원한다.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { MahjongGame } from './lib/game.js';
import { decide } from './lib/ai.js';
import { computeHints, fallbackDiscard } from './lib/hints.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

/** 사람이 앉는 순서: 첫 사람 동, 둘째는 마주 보는 서, 이후 남·북. */
const SEAT_ORDER = [0, 2, 1, 3];
const AI_NAMES = ['주작', '백호', '현무', '청룡'];
const LEVELS = ['easy', 'normal', 'hard'];
export const DEFAULT_TIMING = Object.freeze({
  baseMs: 15000,
  bankMs: 20000,
  reactionMs: 10000,
  aiTurnMs: [700, 1400],
  aiReactionMs: [350, 800],
  aiAckMs: [600, 1200],
  awayMs: 500,
  riichiAutoMs: 900,
  lobbyGraceMs: 8000,
  emptyResetMs: 90000,
  pauseLimit: 3, // 사람당 한 판에 일시정지할 수 있는 횟수
  pauseMaxMs: 180000, // 이 시간이 지나면 자동으로 재개한다(멈춘 사람이 자리를 비워도 방이 멈추지 않게)
});

/** @param {unknown} name 입력 이름 @returns {string} 안전한 표시 이름 */
function normalizeName(name) {
  return String(name || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 12) || '플레이어';
}

/** @param {WebSocket} ws 소켓 @param {object} payload 메시지 */
function send(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

/** @param {unknown} v 값 @returns {number|undefined} 안전한 정수 */
function int(v) { return Number.isInteger(v) ? v : undefined; }

/**
 * 클라이언트 행동 입력을 서버가 이해하는 형태로 정규화한다.
 * @param {any} a 원본
 * @returns {object|null} 정규화된 행동
 */
function sanitizeAction(a) {
  if (!a || typeof a.type !== 'string') return null;
  const out = { type: a.type };
  if (a.id !== undefined) { const id = int(a.id); if (id === undefined) return null; out.id = id; }
  if (a.kind !== undefined) { const k = int(a.kind); if (k === undefined) return null; out.kind = k; }
  if (a.ids !== undefined) {
    if (!Array.isArray(a.ids) || a.ids.length > 3 || !a.ids.every(Number.isInteger)) return null;
    out.ids = a.ids.slice();
  }
  if (a.riichi !== undefined) out.riichi = !!a.riichi;
  return out;
}

/** @param {number[]} range [min,max] @returns {number} 무작위 지연 */
function between([min, max]) { return min + Math.random() * (max - min); }

/**
 * 마작 앱 인스턴스를 만든다. 룸 상태는 closure로 격리된다.
 * @param {{testing?:boolean, timing?:object, rng?:() => number}} [opts] 옵션
 * @returns {{handleHttp:Function, handleUpgrade:Function, setHostUrl:Function, close:Function, _room:object}} 앱
 */
export function createApp(opts = {}) {
  const T = { ...DEFAULT_TIMING, ...(opts.timing || {}) };
  const wss = new WebSocketServer({ noServer: true });

  const room = {
    phase: 'lobby', // lobby | playing | over
    settings: { length: 'east', aka: true, kuitan: true, aiLevel: 'normal' },
    /** @type {(null|{seat:number,type:'human'|'ai',name:string,key?:string,ws?:WebSocket|null,connected?:boolean,level?:string,bank?:number,assist?:boolean,autoPlay?:boolean,timeouts?:number,turnStart?:number})[]} */
    slots: [null, null, null, null],
    hostKey: null,
    lobbyHostClaimed: false, // 런처 대기실 호스트(role=p1)가 방장을 가져갔는지
    /** @type {MahjongGame|null} */ game: null,
    pendingRef: null,
    seatTimers: {},
    pause: null, // 일시정지 중이면 {seat, name, at, autoAt}
    pauseTimer: null,
    pauseUsed: {}, // 세션키 → 이번 판에 쓴 일시정지 횟수
    lobbyTimers: new Map(),
    emptyTimer: null,
  };

  // ── 공통 유틸 ───────────────────────────────────────────
  const humans = () => room.slots.filter((s) => s && s.type === 'human');
  const connectedHumans = () => humans().filter((s) => s.connected);

  function slotPublic(slot, seat) {
    if (!slot) return { seat, type: 'empty', name: '', connected: false, host: false };
    return {
      seat,
      type: slot.type,
      name: slot.name,
      connected: slot.type === 'ai' ? true : !!slot.connected,
      level: slot.type === 'ai' ? slot.level : undefined,
      host: slot.type === 'human' && slot.key === room.hostKey,
      away: slot.type === 'human' && !!slot.autoPlay,
    };
  }

  function seatsPublic() { return room.slots.map((s, i) => slotPublic(s, i)); }

  function broadcastRoom() {
    for (const slot of humans()) {
      if (!slot.connected) continue;
      send(slot.ws, {
        type: 'ROOM',
        phase: room.phase,
        settings: room.settings,
        seats: seatsPublic(),
        me: slot.seat,
        isHost: slot.key === room.hostKey,
        canStart: slot.key === room.hostKey && room.phase === 'lobby' && connectedHumans().length >= 1,
      });
    }
  }

  function clearSeatTimers() {
    for (const t of Object.values(room.seatTimers)) clearTimeout(t.handle);
    room.seatTimers = {};
  }

  function clearPause() {
    clearTimeout(room.pauseTimer);
    room.pauseTimer = null;
    room.pause = null;
  }

  function resetToLobby() {
    clearSeatTimers();
    clearPause();
    room.game = null;
    room.pendingRef = null;
    room.phase = 'lobby';
    room.slots = room.slots.map((s) => (s && s.type === 'human' ? s : null));
    broadcastRoom();
  }

  function armEmptyTimer() {
    clearTimeout(room.emptyTimer);
    room.emptyTimer = null;
    if (connectedHumans().length > 0) return;
    room.emptyTimer = setTimeout(() => {
      if (connectedHumans().length > 0) return;
      clearSeatTimers();
      clearPause();
      room.game = null;
      room.phase = 'lobby';
      room.slots = [null, null, null, null];
      room.hostKey = null;
      room.lobbyHostClaimed = false;
      room.settings = { length: 'east', aka: true, kuitan: true, aiLevel: 'normal' };
    }, T.emptyResetMs);
    room.emptyTimer.unref?.();
  }

  function reassignHost() {
    if (humans().some((s) => s.key === room.hostKey)) return;
    const next = humans().find((s) => s.connected) || humans()[0];
    room.hostKey = next ? next.key : null;
  }

  // ── 대국 진행 ───────────────────────────────────────────
  function waitingSeats(g) {
    const p = g.pending;
    if (!p) return [];
    if (p.type === 'turn') return [p.seat];
    if (p.type === 'reaction') return Object.keys(p.eligible).map(Number).filter((s) => !p.responses[s]);
    return [0, 1, 2, 3].filter((s) => !p.acks.has(s));
  }

  function timerInfo(g) {
    const out = [];
    for (const seat of waitingSeats(g)) {
      const t = room.seatTimers[seat];
      if (t && t.deadline) out.push({ seat, deadline: t.deadline, total: t.total, base: t.base });
    }
    return out;
  }

  function broadcastState(events = []) {
    const g = room.game;
    if (!g) return;
    const timers = timerInfo(g);
    for (const slot of humans()) {
      if (!slot.connected) continue;
      const view = g.viewFor(slot.seat);
      send(slot.ws, {
        type: 'STATE',
        view,
        seats: seatsPublic(),
        timers,
        pause: room.pause,
        pausesLeft: Math.max(0, T.pauseLimit - (room.pauseUsed[slot.key] || 0)),
        bank: slot.bank,
        assist: !!slot.assist,
        hints: slot.assist ? computeHints(view) : null,
        events,
        serverNow: Date.now(),
      });
    }
  }

  function afterChange() {
    const g = room.game;
    if (!g) return;
    const events = g.drainEvents();
    if (!g.pending) room.phase = 'over';
    scheduleSeats();
    broadcastState(events);
  }

  function applyAction(seat, action) {
    const g = room.game;
    if (!g || room.phase !== 'playing') return { ok: false, error: 'not_playing' };
    if (room.pause) return { ok: false, error: 'paused' };
    const res = g.act(seat, action);
    if (res.ok) afterChange();
    return res;
  }

  /** 리치 후 쯔모·깡 선택지가 없으면 쯔모기리밖에 할 수 없으므로 자동으로 진행한다. */
  function isRiichiLocked(g, seat) {
    if (!g.h.riichi[seat]) return false;
    const legal = g.legalFor(seat);
    return !!legal && legal.kind === 'turn' && !legal.tsumo && legal.ankan.length === 0 && legal.kakan.length === 0;
  }

  function fallbackAction(g, seat) {
    const legal = g.legalFor(seat);
    if (!legal) return null;
    if (legal.kind === 'ack') return { type: 'next' };
    if (legal.kind === 'reaction') return { type: 'pass' };
    if (legal.tsumo) return { type: 'tsumo' };
    return { type: 'discard', id: fallbackDiscard(g.viewFor(seat)) ?? legal.discard[0] };
  }

  function runAuto(seat, token, kind) {
    const g = room.game;
    if (!g || room.phase !== 'playing' || room.pause || room.pendingRef !== g.pending) return;
    const t = room.seatTimers[seat];
    if (!t || t.token !== token) return;
    delete room.seatTimers[seat];
    const slot = room.slots[seat];
    let action;
    if (kind === 'ai') {
      action = decide(g.viewFor(seat), { level: slot.level, rng: opts.rng });
    } else {
      if (kind === 'timeout' && slot.type === 'human') {
        slot.timeouts = (slot.timeouts || 0) + 1;
        if (slot.timeouts >= 2) slot.autoPlay = true;
      }
      action = fallbackAction(g, seat);
    }
    let res = action ? g.act(seat, action) : { ok: false };
    if (!res.ok) {
      const fb = fallbackAction(g, seat);
      res = fb ? g.act(seat, fb) : { ok: false };
    }
    if (res.ok) afterChange();
  }

  function dropSeatTimer(seat) {
    const t = room.seatTimers[seat];
    if (t) { clearTimeout(t.handle); delete room.seatTimers[seat]; }
  }

  let tokenSeq = 0;
  function scheduleSeats() {
    if (room.pause) return; // 일시정지 중에는 타이머를 새로 만들지 않는다(재개할 때 다시 호출)
    const g = room.game;
    if (!g || !g.pending) { clearSeatTimers(); room.pendingRef = null; return; }
    const p = g.pending;
    if (room.pendingRef !== p) {
      clearSeatTimers();
      room.pendingRef = p;
    }
    const waiting = waitingSeats(g);
    for (const seat of Object.keys(room.seatTimers).map(Number)) {
      if (!waiting.includes(seat)) { clearTimeout(room.seatTimers[seat].handle); delete room.seatTimers[seat]; }
    }
    for (const seat of waiting) {
      if (room.seatTimers[seat]) continue;
      const slot = room.slots[seat];
      const token = ++tokenSeq;
      const now = Date.now();
      let kind;
      let ms;
      let total = 0;
      let base = 0;
      if (slot.type === 'ai') {
        kind = 'ai';
        ms = between(p.type === 'turn' ? T.aiTurnMs : p.type === 'reaction' ? T.aiReactionMs : T.aiAckMs);
      } else if (!slot.connected || slot.autoPlay) {
        kind = 'away';
        ms = T.awayMs;
      } else if (p.type === 'ack') {
        // 결과 확인은 시간 제한이 없다. 접속 중인 사람이 모두 직접 누를 때까지 기다린다(설명을 읽는 중에 넘어가지 않게).
        continue;
      } else if (p.type === 'turn' && isRiichiLocked(g, seat)) {
        kind = 'riichi';
        ms = T.riichiAutoMs;
      } else {
        kind = 'timeout';
        if (p.type === 'turn') { base = T.baseMs; total = T.baseMs + slot.bank; slot.turnStart = now; }
        else { base = total = T.reactionMs; }
        ms = total;
      }
      const handle = setTimeout(() => runAuto(seat, token, kind), ms);
      handle.unref?.();
      room.seatTimers[seat] = { handle, token, kind, at: now, ms, deadline: kind === 'timeout' ? now + ms : 0, total, base };
    }
  }

  /** 일시정지: 모든 좌석 타이머를 멈추고 남은 시간을 기억한다. 누구든 재개할 수 있다. */
  function pauseGame(slot) {
    if (room.phase !== 'playing' || !room.game || room.pause) return { ok: false, error: 'not_pausable' };
    const used = room.pauseUsed[slot.key] || 0;
    if (used >= T.pauseLimit) return { ok: false, error: 'pause_limit' };
    room.pauseUsed[slot.key] = used + 1;
    const now = Date.now();
    for (const t of Object.values(room.seatTimers)) {
      clearTimeout(t.handle);
      t.handle = null;
      t.remaining = Math.max(0, t.at + t.ms - now);
    }
    room.pause = { seat: slot.seat, name: slot.name, at: now, autoAt: now + T.pauseMaxMs };
    room.pauseTimer = setTimeout(() => resumeGame(null), T.pauseMaxMs);
    room.pauseTimer.unref?.();
    broadcastState([{ t: 'pause', seat: slot.seat, name: slot.name }]);
    return { ok: true };
  }

  /** 재개: 멈춘 시간만큼 여유 시간 계산을 미루고 남은 시간부터 타이머를 이어 간다. by가 null이면 자동 재개. */
  function resumeGame(by) {
    if (!room.pause) return { ok: false, error: 'not_paused' };
    const now = Date.now();
    const dur = now - room.pause.at;
    clearPause();
    for (const s of humans()) if (s.turnStart) s.turnStart += dur;
    for (const [seat, t] of Object.entries(room.seatTimers)) {
      const ms = t.remaining ?? t.ms;
      delete t.remaining;
      t.at = now;
      t.ms = ms;
      if (t.deadline) t.deadline = now + ms;
      t.handle = setTimeout(() => runAuto(Number(seat), t.token, t.kind), ms);
      t.handle.unref?.();
    }
    scheduleSeats();
    broadcastState([{ t: 'resume', seat: by ? by.seat : -1, name: by ? by.name : '', auto: !by }]);
    return { ok: true };
  }

  function startGame() {
    clearPause();
    room.pauseUsed = {};
    // 빈 자리를 AI로 채운다.
    const used = new Set(room.slots.filter((s) => s && s.type === 'ai').map((s) => s.name));
    const names = AI_NAMES.filter((n) => !used.has(n));
    for (let i = 0; i < 4; i++) {
      if (!room.slots[i]) {
        room.slots[i] = { seat: i, type: 'ai', name: names.shift() || `AI${i}`, level: room.settings.aiLevel };
      }
    }
    for (const slot of humans()) { slot.bank = T.bankMs; slot.autoPlay = false; slot.timeouts = 0; }
    room.game = new MahjongGame({
      settings: { length: room.settings.length, aka: room.settings.aka, kuitan: room.settings.kuitan },
      rng: opts.rng,
    });
    room.phase = 'playing';
    room.game.start();
    afterChange();
    broadcastRoom();
  }

  // ── 접속 / 메시지 ───────────────────────────────────────
  function attachHuman(ws, key, name) {
    let slot = humans().find((s) => s.key === key);
    if (slot) {
      if (slot.ws && slot.ws !== ws && slot.ws.readyState === WebSocket.OPEN) {
        try { slot.ws.close(4000, 'replaced'); } catch { /* noop */ }
      }
      slot.ws = ws;
      slot.connected = true;
      slot.autoPlay = false;
      slot.timeouts = 0;
      dropSeatTimer(slot.seat);
      if (name) slot.name = name;
      clearTimeout(room.lobbyTimers.get(key));
      room.lobbyTimers.delete(key);
    } else {
      if (humans().length >= 4) return { error: 'room_full', message: '방이 가득 찼습니다.' };
      if (room.phase === 'playing') return { error: 'in_progress', message: '대국이 진행 중입니다. 끝난 뒤 다시 입장해 주세요.' };
      const seat = SEAT_ORDER.find((s) => !room.slots[s]);
      slot = { seat, type: 'human', name, key, ws, connected: true, bank: T.bankMs, assist: false, autoPlay: false, timeouts: 0 };
      room.slots[seat] = slot;
      if (!room.hostKey) room.hostKey = key;
    }
    clearTimeout(room.emptyTimer);
    return { slot };
  }

  function onClose(ws, slot) {
    if (slot.ws !== ws) return;
    slot.connected = false;
    slot.ws = null;
    if (room.phase === 'lobby' || room.phase === 'over') {
      const handle = setTimeout(() => {
        room.lobbyTimers.delete(slot.key);
        if (slot.connected) return;
        const idx = room.slots.indexOf(slot);
        if (idx >= 0) room.slots[idx] = null;
        reassignHost();
        broadcastRoom();
        armEmptyTimer();
      }, T.lobbyGraceMs);
      handle.unref?.();
      room.lobbyTimers.set(slot.key, handle);
    } else {
      // 대국 중이면 남은 제한 시간을 기다리지 않고 자동 진행으로 넘긴다.
      dropSeatTimer(slot.seat);
      reassignHost();
      scheduleSeats();
    }
    broadcastRoom();
    armEmptyTimer();
  }

  function leave(slot) {
    const idx = room.slots.indexOf(slot);
    if (idx < 0) return;
    if (room.phase === 'playing') {
      dropSeatTimer(idx);
      room.slots[idx] = { seat: idx, type: 'ai', name: `${slot.name}(대리)`, level: room.settings.aiLevel };
    } else {
      room.slots[idx] = null;
    }
    reassignHost();
    broadcastRoom();
    if (room.game) { scheduleSeats(); broadcastState(); }
    armEmptyTimer();
  }

  function applySettings(raw) {
    if (!raw || typeof raw !== 'object') return;
    const s = room.settings;
    if (raw.length === 'east' || raw.length === 'half') s.length = raw.length;
    if (typeof raw.aka === 'boolean') s.aka = raw.aka;
    if (typeof raw.kuitan === 'boolean') s.kuitan = raw.kuitan;
    if (LEVELS.includes(raw.aiLevel)) s.aiLevel = raw.aiLevel;
  }

  wss.on('connection', (ws, req) => {
    const params = new URL(req.url || '/ws', 'http://localhost').searchParams;
    const key = String(params.get('key') || '').slice(0, 64) || `k${Math.random().toString(36).slice(2)}`;
    const name = normalizeName(params.get('name'));
    const attached = attachHuman(ws, key, name);
    if (attached.error) {
      send(ws, { type: 'ERROR', code: attached.error, message: attached.message });
      ws.close(1000, attached.error);
      return;
    }
    const { slot } = attached;
    // 런처 대기실 호스트(role=p1)가 방장이어야 한다. 리디렉션 후 먼저 접속한 사람이 방장이 되는 것을 바로잡는다(최초 1회만).
    if (params.get('role') === 'p1' && !room.lobbyHostClaimed && room.phase === 'lobby') {
      room.lobbyHostClaimed = true;
      room.hostKey = key;
    }
    send(ws, { type: 'JOINED', seat: slot.seat, key, host: key === room.hostKey, phase: room.phase });
    broadcastRoom();
    if (room.game) {
      scheduleSeats();
      broadcastState();
    }

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!msg || typeof msg.type !== 'string') return;
      const isHost = slot.key === room.hostKey;
      switch (msg.type) {
        case 'CONFIG':
          if (isHost && room.phase === 'lobby') { applySettings(msg.settings); broadcastRoom(); }
          break;
        case 'RENAME':
          if (room.phase === 'lobby') { slot.name = normalizeName(msg.name); broadcastRoom(); }
          break;
        case 'START':
          if (isHost && room.phase === 'lobby') startGame();
          break;
        case 'ACT': {
          const action = sanitizeAction(msg.action);
          if (!action) { send(ws, { type: 'ERROR', code: 'bad_action' }); break; }
          const wasTurn = room.game?.pending?.type === 'turn' && room.game.pending.seat === slot.seat;
          const t = room.seatTimers[slot.seat];
          const started = slot.turnStart;
          const res = applyAction(slot.seat, action);
          if (res.ok) {
            slot.autoPlay = false;
            slot.timeouts = 0;
            if (wasTurn && t && started) {
              const over = Date.now() - started - T.baseMs;
              if (over > 0) slot.bank = Math.max(0, slot.bank - over);
            }
          } else {
            send(ws, { type: 'ERROR', code: res.error || 'illegal', message: res.error === 'paused' ? '일시정지 중이에요. 재개하면 이어서 할 수 있어요.' : '지금은 할 수 없는 행동입니다.' });
            broadcastState();
          }
          break;
        }
        case 'PAUSE': {
          const res = pauseGame(slot);
          if (res.error === 'pause_limit') send(ws, { type: 'ERROR', code: 'pause_limit', message: `일시정지는 한 판에 ${T.pauseLimit}번까지 쓸 수 있어요.` });
          break;
        }
        case 'RESUME':
          if (room.pause) resumeGame(slot);
          break;
        case 'ASSIST':
          slot.assist = !!msg.on;
          if (room.game) broadcastState();
          break;
        case 'REMATCH':
          if (isHost && room.phase === 'over') resetToLobby();
          break;
        case 'LEAVE':
          leave(slot);
          try { ws.close(1000, 'LEAVE'); } catch { /* noop */ }
          break;
        case 'PING':
          send(ws, { type: 'PONG' });
          break;
        default:
          break;
      }
    });
    ws.on('close', () => onClose(ws, slot));
    ws.on('error', () => { /* close 이벤트에서 정리 */ });
  });

  // ── HTTP ────────────────────────────────────────────────
  function handleHttp(req, res) {
    const reqPath = (req.url || '/').split('?')[0] || '/';
    const urlPath = reqPath === '/' ? '/index.html' : reqPath;
    let decoded;
    try { decoded = decodeURIComponent(urlPath); } catch { res.writeHead(400); res.end('Bad request'); return; }
    const safePath = path.normalize(decoded).replace(/^([\\/])+/, '');
    const fullPath = path.join(PUBLIC_DIR, safePath);
    if (!fullPath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(fullPath, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fullPath).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  }

  function handleUpgrade(req, socket, head) {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  }

  function close() {
    clearSeatTimers();
    clearPause();
    clearTimeout(room.emptyTimer);
    for (const h of room.lobbyTimers.values()) clearTimeout(h);
    for (const c of wss.clients) { try { c.terminate(); } catch { /* noop */ } }
    wss.close();
  }

  return { handleHttp, handleUpgrade, setHostUrl() {}, close, _room: room };
}

// ── 단독 실행 ───────────────────────────────────────────────
function isDirectExecution() {
  if (!process.argv[1]) return false;
  const argvPath = process.argv[1].replace(/\\/g, '/');
  const metaPath = import.meta.url.replace('file:///', '').replace('file://', '');
  return metaPath === argvPath || metaPath.endsWith(argvPath);
}

if (isDirectExecution() && !process.env.MAHJONG_NO_LISTEN) {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf('--port');
  const port = idx >= 0 && argv[idx + 1] ? parseInt(argv[idx + 1], 10) : 3021;
  // MAHJONG_FAST=1은 화면 검증용으로 AI 지연과 제한 시간을 줄인다.
  const fast = process.env.MAHJONG_FAST === '1';
  const app = createApp(fast ? {
    timing: { aiTurnMs: [20, 60], aiReactionMs: [10, 40], aiAckMs: [30, 80], baseMs: 6000, bankMs: 6000, reactionMs: 4000 },
  } : {});
  const server = http.createServer((req, res) => {
    // 단독 실행에서는 /mahjong/ 접두어도 허용한다.
    if (req.url && req.url.startsWith('/mahjong/')) req.url = req.url.slice('/mahjong'.length);
    app.handleHttp(req, res);
  });
  server.on('upgrade', app.handleUpgrade);
  server.listen(port, '0.0.0.0', () => {
    const lan = Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal);
    console.log(`[mahjong] http://localhost:${port}${lan[0] ? `  (LAN ${lan[0].address})` : ''}`);
  });
}
