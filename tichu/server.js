/**
 * @fileoverview 티추 WebSocket + 정적 파일 서버.
 *
 * - 서버 권위: 모든 판정은 lib/game.js가 수행하고 클라이언트는 행동 의도만 보낸다.
 * - 4인 2:2 팀전 1룸. 사람 1~4명이 입장하면 방 설정 화면에서 호스트가 시작하며, 빈 자리는 서버 관리형 AI가 채운다.
 *   사람이 2명이면 마주 보는 자리(파트너)에 앉는다. 방·방장·재접속·일시정지 규칙은 마작(mahjong/server.js)과 같다.
 * - AI는 별도 프로세스 없이 서버 안에서 lib/ai.js로 결정한다.
 * - 통합 런처에서는 createApp()을 import하고, 단독 실행(`node server.js --port N`)도 지원한다.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { TichuGame } from './lib/game.js';
import { decide, decideInterrupt, fallbackAction } from './lib/ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const LIB_DIR = path.join(__dirname, 'lib');
/** 브라우저와 공유하는 순수 모듈(서버·AI·클라이언트가 같은 조합 판정을 쓴다). 이 둘만 /lib/ 로 내보낸다. */
const SHARED_LIB = new Set(['cards.js', 'combos.js']);
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

/** 사람이 앉는 순서: 첫 사람 0, 둘째는 마주 보는 2(파트너), 이후 1·3. */
const SEAT_ORDER = [0, 2, 1, 3];
const AI_NAMES = ['주작', '백호', '현무', '청룡'];
const LEVELS = ['easy', 'normal', 'hard'];
const DEFAULT_SETTINGS = Object.freeze({ target: 1000, grand: true, bombWindowMs: 2000, aiLevel: 'normal' });
export const DEFAULT_TIMING = Object.freeze({
  baseMs: 25000, // 낼 차례 생각 시간
  bankMs: 30000, // 대국 전체 여유 시간
  grandMs: 20000, // 그랜드 티추 선택
  exchangeMs: 45000, // 카드 3장 교환
  giftMs: 15000, // 용 트릭 선물
  aiTurnMs: [800, 1600],
  aiPickMs: [900, 2200], // 그랜드·교환 선택
  aiAckMs: [600, 1200],
  awayMs: 500,
  lobbyGraceMs: 8000,
  emptyResetMs: 90000,
});

/** @param {unknown} name 입력 이름 @returns {string} 안전한 표시 이름 */
function normalizeName(name) {
  return String(name || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 12) || '플레이어';
}

/** @param {WebSocket} ws 소켓 @param {object} payload 메시지 */
function send(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

const isInt = (v) => Number.isInteger(v);

/**
 * 클라이언트 행동 입력을 서버가 이해하는 형태로 정규화한다.
 * @param {any} a 원본
 * @returns {object|null} 정규화된 행동
 */
function sanitizeAction(a) {
  if (!a || typeof a.type !== 'string') return null;
  const out = { type: a.type };
  const ids = (list, max) => Array.isArray(list) && list.length <= max && list.every(isInt) ? list.slice() : null;
  switch (a.type) {
    case 'grand': out.on = !!a.on; break;
    case 'exchange': out.give = ids(a.give, 3); if (!out.give) return null; break;
    case 'play':
      out.ids = ids(a.ids, 14);
      if (!out.ids) return null;
      if (a.as !== undefined) { if (!isInt(a.as)) return null; out.as = a.as; }
      if (a.wish !== undefined) { if (!isInt(a.wish)) return null; out.wish = a.wish; }
      break;
    case 'gift': if (!isInt(a.to)) return null; out.to = a.to; break;
    case 'tichu': case 'pass': case 'next': break;
    default: return null;
  }
  return out;
}

/** @param {number[]} range [min,max] @returns {number} 무작위 지연 */
function between([min, max]) { return min + Math.random() * (max - min); }

/**
 * 방 하나의 엔진을 만든다. 룸 상태는 closure로 격리되고 WebSocket 서버도 방마다 따로 가진다.
 * @param {{testing?:boolean, timing?:object, rng?:() => number}} opts 옵션
 * @param {{onIdle?:() => void}} [hooks] onIdle: 접속자가 없어 방이 초기화됐을 때 호출(방 목록에서 치우라는 신호)
 * @returns {{handleUpgrade:Function, close:Function, _room:object}} 방 엔진
 */
function createRoomEngine(opts, hooks = {}) {
  const T = { ...DEFAULT_TIMING, ...(opts.timing || {}) };
  const wss = new WebSocketServer({ noServer: true });

  const room = {
    phase: 'lobby', // lobby | playing | over
    settings: { ...DEFAULT_SETTINGS },
    /** @type {(null|{seat:number,type:'human'|'ai',name:string,key?:string,ws?:WebSocket|null,connected?:boolean,level?:string,bank?:number,autoPlay?:boolean,timeouts?:number,turnStart?:number})[]} */
    slots: [null, null, null, null],
    hostKey: null,
    lobbyHostClaimed: false, // 런처 대기실 호스트(role=p1)가 방장을 가져갔는지
    /** @type {TichuGame|null} */ game: null,
    pendingRef: null,
    seatTimers: {},
    irqTimers: {}, // AI가 내 차례가 아닐 때 폭탄으로 끼어드는 타이머
    pause: null, // 일시정지 중이면 {seat, name, at}. 시간 제한은 없고 누구든 재개할 때까지 멈춘다
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

  function clearIrq() {
    for (const h of Object.values(room.irqTimers)) clearTimeout(h);
    room.irqTimers = {};
  }

  function clearSeatTimers() {
    for (const t of Object.values(room.seatTimers)) clearTimeout(t.handle);
    room.seatTimers = {};
    clearIrq();
  }

  function clearPause() {
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
      room.settings = { ...DEFAULT_SETTINGS };
      hooks.onIdle?.();
    }, T.emptyResetMs);
    room.emptyTimer.unref?.();
  }

  function reassignHost() {
    if (humans().some((s) => s.key === room.hostKey)) return;
    const next = humans().find((s) => s.connected) || humans()[0];
    room.hostKey = next ? next.key : null;
  }

  // ── 대국 진행 ───────────────────────────────────────────
  function timerInfo(g) {
    const out = [];
    for (const seat of g.waitingSeats()) {
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
      send(slot.ws, {
        type: 'STATE',
        view: g.viewFor(slot.seat),
        seats: seatsPublic(),
        timers,
        pause: room.pause,
        bank: slot.bank,
        events,
        serverNow: Date.now(),
      });
    }
  }

  function afterChange() {
    const g = room.game;
    if (!g) return;
    const events = g.drainEvents();
    const finished = !g.pending && room.phase !== 'over';
    if (!g.pending) room.phase = 'over';
    scheduleSeats();
    scheduleInterrupts();
    broadcastState(events);
    if (finished) broadcastRoom(); // 방장만 다시 하기를 누를 수 있다는 정보(phase)를 모두에게 알린다
  }

  function applyAction(seat, action) {
    const g = room.game;
    if (!g || room.phase !== 'playing') return { ok: false, error: 'not_playing' };
    if (room.pause) return { ok: false, error: 'paused' };
    const res = g.act(seat, action);
    if (res.ok) afterChange();
    return res;
  }

  function runAuto(seat, token, kind) {
    const g = room.game;
    if (!g || room.phase !== 'playing' || room.pause || room.pendingRef !== g.pending) return;
    const t = room.seatTimers[seat];
    if (!t || t.token !== token) return;
    delete room.seatTimers[seat];
    const slot = room.slots[seat];
    const view = g.viewFor(seat);
    let action = null;
    if (kind === 'ai') {
      action = decide(view, { level: slot.level, rng: opts.rng });
    } else {
      if (kind === 'timeout' && slot.type === 'human') {
        slot.timeouts = (slot.timeouts || 0) + 1;
        if (slot.timeouts >= 2) slot.autoPlay = true;
      }
      action = fallbackAction(view);
    }
    let res = action ? g.act(seat, action) : { ok: false };
    if (!res.ok) {
      const fb = fallbackAction(view);
      res = fb ? g.act(seat, fb) : { ok: false };
    }
    if (res.ok) afterChange();
    else scheduleSeats(); // 폭탄 대기 시간 등으로 거절되면 곧 다시 시도한다
  }

  function dropSeatTimer(seat) {
    const t = room.seatTimers[seat];
    if (t) { clearTimeout(t.handle); delete room.seatTimers[seat]; }
  }

  /** AI가 낼 차례일 때 폭탄 끼어들기 대기 시간(openAt)이 지난 뒤에 움직이도록 지연을 늘린다. */
  function aiDelay(g, range) {
    const ms = between(range);
    if (g.pending?.type !== 'turn' || !g.h.trick.top) return ms;
    return Math.max(ms, g.h.openAt - Date.now() + 120);
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
    const waiting = g.waitingSeats();
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
        ms = p.type === 'turn' ? aiDelay(g, T.aiTurnMs)
          : p.type === 'ack' ? between(T.aiAckMs)
            : p.type === 'gift' ? between(T.aiTurnMs) : between(T.aiPickMs);
      } else if (!slot.connected || slot.autoPlay) {
        kind = 'away';
        ms = T.awayMs;
      } else if (p.type === 'ack') {
        // 결과 확인은 시간 제한이 없다. 접속 중인 사람이 모두 직접 누를 때까지 기다린다(결과를 읽는 중에 넘어가지 않게).
        continue;
      } else {
        kind = 'timeout';
        if (p.type === 'turn') { base = T.baseMs; total = T.baseMs + slot.bank; slot.turnStart = now; }
        else { base = total = p.type === 'grand' ? T.grandMs : p.type === 'exchange' ? T.exchangeMs : T.giftMs; }
        ms = total;
      }
      const handle = setTimeout(() => runAuto(seat, token, kind), ms);
      handle.unref?.();
      room.seatTimers[seat] = { handle, token, kind, at: now, ms, deadline: kind === 'timeout' ? now + ms : 0, total, base };
    }
  }

  /** 내 차례가 아닌 AI가 폭탄으로 끼어들 수 있는지 매 상태 변화마다 다시 본다. */
  function scheduleInterrupts() {
    clearIrq();
    const g = room.game;
    if (room.pause || !g || room.phase !== 'playing' || g.pending?.type !== 'turn' || !g.h.trick.top) return;
    const windowMs = Math.max(600, g.settings.bombWindowMs || 0);
    for (let seat = 0; seat < 4; seat++) {
      const slot = room.slots[seat];
      if (!slot || slot.type !== 'ai' || g.pending.seat === seat) continue;
      const action = decideInterrupt(g.viewFor(seat), { level: slot.level });
      if (!action) continue;
      const handle = setTimeout(() => {
        delete room.irqTimers[seat];
        if (room.pause || room.game !== g) return;
        const res = g.act(seat, action);
        if (res.ok) afterChange();
      }, between([350, windowMs - 200]));
      handle.unref?.();
      room.irqTimers[seat] = handle;
    }
  }

  /** 일시정지: 모든 좌석 타이머를 멈추고 남은 시간을 기억한다. 횟수·시간 제한 없이 누구든 재개할 수 있다. */
  function pauseGame(slot) {
    if (room.phase !== 'playing' || !room.game || room.pause) return { ok: false, error: 'not_pausable' };
    const now = Date.now();
    for (const t of Object.values(room.seatTimers)) {
      clearTimeout(t.handle);
      t.handle = null;
      t.remaining = Math.max(0, t.at + t.ms - now);
    }
    clearIrq();
    room.pause = { seat: slot.seat, name: slot.name, at: now };
    broadcastState([{ t: 'pause', seat: slot.seat, name: slot.name }]);
    return { ok: true };
  }

  /** 재개: 멈춘 시간만큼 여유 시간·폭탄 대기 계산을 미루고 남은 시간부터 타이머를 이어 간다. */
  function resumeGame(by) {
    if (!room.pause) return { ok: false, error: 'not_paused' };
    const now = Date.now();
    const dur = now - room.pause.at;
    clearPause();
    for (const s of humans()) if (s.turnStart) s.turnStart += dur;
    if (room.game?.h?.openAt) room.game.h.openAt += dur;
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
    scheduleInterrupts();
    broadcastState([{ t: 'resume', seat: by.seat, name: by.name }]);
    return { ok: true };
  }

  function startGame() {
    clearPause();
    // 빈 자리를 AI로 채운다.
    const used = new Set(room.slots.filter((s) => s && s.type === 'ai').map((s) => s.name));
    const names = AI_NAMES.filter((n) => !used.has(n));
    for (let i = 0; i < 4; i++) {
      if (!room.slots[i]) {
        room.slots[i] = { seat: i, type: 'ai', name: names.shift() || `AI${i}`, level: room.settings.aiLevel };
      }
    }
    for (const slot of humans()) { slot.bank = T.bankMs; slot.autoPlay = false; slot.timeouts = 0; }
    const { target, grand, bombWindowMs } = room.settings;
    room.game = new TichuGame({ settings: { target, grand, bombWindowMs }, rng: opts.rng });
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
      slot = { seat, type: 'human', name, key, ws, connected: true, bank: T.bankMs, autoPlay: false, timeouts: 0 };
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
    if (room.game) { scheduleSeats(); scheduleInterrupts(); broadcastState(); }
    armEmptyTimer();
  }

  function applySettings(raw) {
    if (!raw || typeof raw !== 'object') return;
    const s = room.settings;
    if (raw.target === 500 || raw.target === 1000) s.target = raw.target;
    if (typeof raw.grand === 'boolean') s.grand = raw.grand;
    if ([0, 1000, 2000, 3000].includes(raw.bombWindowMs)) s.bombWindowMs = raw.bombWindowMs;
    if (LEVELS.includes(raw.aiLevel)) s.aiLevel = raw.aiLevel;
  }

  const ERROR_TEXT = {
    paused: '일시정지 중이에요. 재개하면 이어서 할 수 있어요.',
    wait: '폭탄을 낼 시간을 잠깐 기다려요.',
    wish: '소원 숫자를 낼 수 있으면 꼭 내야 해요.',
    must_lead: '선은 패스할 수 없어요.',
    not_turn: '지금은 내 차례가 아니에요.',
  };

  wss.on('connection', (ws, req) => {
    const params = new URL(req.url || '/ws', 'http://localhost').searchParams;
    const key = String(params.get('key') || '').slice(0, 64) || `k${Math.random().toString(36).slice(2)}`;
    const name = normalizeName(params.get('name'));
    const attached = attachHuman(ws, key, name);
    if (attached.error) {
      send(ws, { type: 'ERROR', code: attached.error, message: attached.message });
      ws.close(1000, attached.error);
      armEmptyTimer(); // 입장에 실패한 채 비어 있는 새 방이 남지 않게 한다
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
      scheduleInterrupts();
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
            if (wasTurn && t && started && action.type !== 'tichu') {
              const over = Date.now() - started - T.baseMs;
              if (over > 0) slot.bank = Math.max(0, slot.bank - over);
            }
          } else {
            send(ws, { type: 'ERROR', code: res.error || 'illegal', message: ERROR_TEXT[res.error] || '지금은 할 수 없는 행동입니다.' });
            broadcastState();
          }
          break;
        }
        case 'PAUSE':
          pauseGame(slot);
          break;
        case 'RESUME':
          if (room.pause) resumeGame(slot);
          break;
        case 'ASSIST':
          break; // 도우미는 클라이언트가 손패로 직접 계산한다(호환용으로 무시)
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

  return { handleUpgrade, close, _room: room };
}

/** 방 번호가 없는 접속(직접 접속·북마크·단독 실행)이 들어가는 기본 방 */
const DEFAULT_ROOM_ID = 'default';
const ROOM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * 티추 앱을 만든다. 방은 `?room=<id>`로 나뉘며, 런처 대기실이 시작할 때마다 새 방 번호를 발급한다.
 * 그래서 이전 판에서 방 설정 화면에 남아 있던 사람이 있어도 새 대기실 멤버는 그 방에 합류하지 않는다.
 * 방 번호가 없으면 기본 방을 쓴다(단독 실행·테스트).
 * @param {{testing?:boolean, timing?:object, rng?:() => number}} [opts] 옵션
 * @returns {{handleHttp:Function, handleUpgrade:Function, setHostUrl:Function, close:Function, _room:object, _rooms:Map}} 앱
 */
export function createApp(opts = {}) {
  /** @type {Map<string, ReturnType<typeof createRoomEngine>>} */
  const engines = new Map();

  function getEngine(id) {
    let engine = engines.get(id);
    if (!engine) {
      engine = createRoomEngine(opts, {
        onIdle: () => {
          // 기본 방은 남겨 두고, 발급된 방은 비면 치운다(같은 번호로 다시 오면 새로 만든다).
          if (id === DEFAULT_ROOM_ID || engines.get(id) !== engine) return;
          engines.delete(id);
          engine.close();
        },
      });
      engines.set(id, engine);
    }
    return engine;
  }

  function roomIdOf(url) {
    const id = new URL(url || '/ws', 'http://localhost').searchParams.get('room');
    return id && ROOM_ID_RE.test(id) ? id : DEFAULT_ROOM_ID;
  }

  // ── HTTP ────────────────────────────────────────────────
  function handleHttp(req, res) {
    const reqPath = (req.url || '/').split('?')[0] || '/';
    let decoded;
    try { decoded = decodeURIComponent(reqPath === '/' ? '/index.html' : reqPath); } catch { res.writeHead(400); res.end('Bad request'); return; }
    // /lib/cards.js, /lib/combos.js 는 서버와 같은 코드를 브라우저가 가져간다.
    const libMatch = /^\/lib\/([a-z]+\.js)$/.exec(decoded);
    const baseDir = libMatch && SHARED_LIB.has(libMatch[1]) ? LIB_DIR : PUBLIC_DIR;
    const safePath = libMatch && SHARED_LIB.has(libMatch[1]) ? libMatch[1] : path.normalize(decoded).replace(/^([\\/])+/, '');
    const fullPath = path.join(baseDir, safePath);
    if (!fullPath.startsWith(baseDir)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(fullPath, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fullPath).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  }

  function handleUpgrade(req, socket, head) {
    getEngine(roomIdOf(req.url)).handleUpgrade(req, socket, head);
  }

  function close() {
    for (const engine of engines.values()) engine.close();
    engines.clear();
  }

  return {
    handleHttp, handleUpgrade, setHostUrl() {}, close,
    get _room() { return getEngine(DEFAULT_ROOM_ID)._room; },
    _rooms: engines,
  };
}

// ── 단독 실행 ───────────────────────────────────────────────
function isDirectExecution() {
  if (!process.argv[1]) return false;
  const argvPath = process.argv[1].replace(/\\/g, '/');
  const metaPath = import.meta.url.replace('file:///', '').replace('file://', '');
  return metaPath === argvPath || metaPath.endsWith(argvPath);
}

if (isDirectExecution() && !process.env.TICHU_NO_LISTEN) {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf('--port');
  const port = idx >= 0 && argv[idx + 1] ? parseInt(argv[idx + 1], 10) : 3022;
  // TICHU_FAST=1은 화면 검증용으로 AI 지연과 제한 시간을 줄인다.
  const fast = process.env.TICHU_FAST === '1';
  const app = createApp(fast ? {
    timing: { aiTurnMs: [30, 90], aiPickMs: [40, 120], aiAckMs: [30, 80], baseMs: 8000, bankMs: 8000, grandMs: 6000, exchangeMs: 10000, giftMs: 6000 },
  } : {});
  const server = http.createServer((req, res) => {
    // 단독 실행에서는 /tichu/ 접두어도 허용한다.
    if (req.url && req.url.startsWith('/tichu/')) req.url = req.url.slice('/tichu'.length);
    app.handleHttp(req, res);
  });
  server.on('upgrade', app.handleUpgrade);
  server.listen(port, '0.0.0.0', () => {
    const lan = Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal);
    console.log(`[tichu] http://localhost:${port}${lan[0] ? `  (LAN ${lan[0].address})` : ''}`);
  });
}
