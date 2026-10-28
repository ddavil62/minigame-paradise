import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { createGame, finishIfExpired, guess, RULE_TYPES, snapshot, useHint } from './game.js';
import { getStage, PUBLISHED_STAGES, publishedStageSummaries, reloadPublishedStages } from './stages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const ASSET_DIR = path.join(__dirname, 'assets');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json; charset=utf-8' };
const MATCH_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;

function sendJson(ws, payload) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

export function createApp({ reloadCatalog = reloadPublishedStages } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  let expectedMatchId = null;
  let players = [];
  let game = null;
  let tickTimer = null;
  let selectedRuleType = 'classic';

  function stopTick() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
  }

  function broadcast(payload) {
    for (const player of players) sendJson(player.ws, payload);
  }

  function broadcastExcept(excludedWs, payload) {
    for (const player of players) {
      if (player.ws !== excludedWs) sendJson(player.ws, payload);
    }
  }

  function broadcastState(revealAll = false) {
    if (!game) return;
    const state = snapshot(game, Date.now(), revealAll);
    const roster = joinedPlayers();
    const owner = selectorId();
    for (const player of players) {
      if (!player.joined) continue;
      sendJson(player.ws, { ...state, players: roster, canSelectStage: player.id === owner, selectorId: owner });
    }
  }

  function joinedPlayers() {
    return players.filter((player) => player.joined).map((player) => ({ id: player.id, name: player.name }));
  }

  function selectorId() {
    const joined = players.filter((player) => player.joined);
    return joined.find((player) => player.id === 'p1')?.id || joined[0]?.id || null;
  }

  function broadcastStageSelection() {
    const stages = publishedStageSummaries();
    const roster = joinedPlayers();
    const owner = selectorId();
    for (const player of players) {
      if (!player.joined) continue;
      sendJson(player.ws, {
        type: 'STAGE_SELECTION',
        stages,
        ruleTypes: Object.values(RULE_TYPES),
        selectedRuleType,
        players: roster,
        canSelect: player.id === owner,
        selectorId: owner,
      });
    }
  }

  function reloadStages() {
    const result = reloadCatalog();
    if (!game) broadcastStageSelection();
    return result;
  }

  function ensureTicking() {
    if (tickTimer) return;
    tickTimer = setInterval(() => {
      if (!game) return;
      const previous = game.phase;
      finishIfExpired(game);
      broadcastState(game.phase !== 'playing');
      if (previous === 'playing' && game.phase !== 'playing') stopTick();
    }, 1000);
  }

  function startGame(stageId, ruleType = selectedRuleType) {
    game = createGame(Date.now(), stageId, ruleType);
    selectedRuleType = game.ruleType;
    broadcast({ type: 'GAME_START', stageId, ruleType: game.ruleType });
    broadcastState();
    ensureTicking();
  }

  function closeStalePlayers() {
    for (const player of players) {
      sendJson(player.ws, { type: 'ERROR', message: '새 경기가 시작되어 이전 연결을 종료해요.' });
      try { player.ws.close(4001, 'MATCH_REPLACED'); } catch { /* noop */ }
    }
    players = [];
  }

  function prepareMatch(matchId) {
    if (!MATCH_ID_RE.test(matchId || '')) throw new Error('invalid spot-the-difference matchId');
    if (game?.phase === 'playing' && players.some((player) => player.ws.readyState === WebSocket.OPEN)) return false;
    // The launcher can stay alive while new stages are published. Refresh from
    // disk whenever a room is prepared so its selection screen is never based
    // on the catalog that happened to be loaded at process startup.
    reloadCatalog();
    stopTick();
    closeStalePlayers();
    expectedMatchId = matchId;
    game = null;
    selectedRuleType = 'classic';
    return true;
  }

  wss.on('connection', (ws, req) => {
    const params = new URL(req.url || '/ws', 'http://localhost').searchParams;
    const matchId = params.get('matchId');
    const requestedRole = params.get('role');
    if (!expectedMatchId || matchId !== expectedMatchId) {
      sendJson(ws, { type: 'ERROR', message: '유효하지 않은 경기예요. 로비에서 다시 입장해 주세요.' });
      ws.close(4002, 'INVALID_MATCH');
      return;
    }
    players = players.filter((player) => player.ws.readyState === WebSocket.OPEN);
    const used = new Set(players.map((player) => player.id));
    const playerId = requestedRole && !used.has(requestedRole) ? requestedRole : ['p1', 'p2'].find((id) => !used.has(id));
    if (!playerId) {
      sendJson(ws, { type: 'ERROR', message: '방이 가득 찼어요.' });
      ws.close(4003, 'ROOM_FULL');
      return;
    }

    const player = { id: playerId, name: '', joined: false, lastCursorAt: 0, ws };
    players.push(player);
    sendJson(ws, { type: 'JOINED', playerId });

    ws.on('message', (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (!message || typeof message !== 'object' || typeof message.type !== 'string') return;
      if (message.type === 'JOIN') {
        player.name = typeof message.name === 'string' && message.name.trim() ? message.name.trim().slice(0, 16) : `플레이어 ${playerId.slice(1)}`;
        player.joined = true;
        if (!game) broadcastStageSelection(); else broadcastState(game.phase !== 'playing');
        return;
      }
      if (!player.joined) return;
      if (message.type === 'SET_DIFFICULTY') {
        if (game) return;
        if (playerId !== selectorId()) {
          sendJson(ws, { type: 'ERROR', message: '난이도 선택은 방장만 할 수 있어요.' });
          return;
        }
        if (!Object.hasOwn(RULE_TYPES, message.ruleType)) {
          sendJson(ws, { type: 'ERROR', message: '올바른 난이도를 선택해 주세요.' });
          return;
        }
        selectedRuleType = message.ruleType;
        broadcastStageSelection();
        return;
      }
      if (message.type === 'SELECT_STAGE') {
        if (game) return;
        if (playerId !== selectorId()) {
          sendJson(ws, { type: 'ERROR', message: '스테이지 선택은 방장만 할 수 있어요.' });
          return;
        }
        const requestedStage = message.random === true
          ? PUBLISHED_STAGES[Math.floor(Math.random() * PUBLISHED_STAGES.length)]
          : getStage(message.stageId);
        if (!requestedStage) {
          sendJson(ws, { type: 'ERROR', message: '선택할 수 없는 스테이지예요.' });
          return;
        }
        startGame(requestedStage.id);
        return;
      }
      if (!game) return;
      if (message.type === 'CURSOR') {
        if (game.phase !== 'playing') return;
        const now = Date.now();
        if (now - player.lastCursorAt < 40) return;
        const image = message.image;
        const x = Number(message.x);
        const y = Number(message.y);
        if ((image !== 'a' && image !== 'b') || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return;
        player.lastCursorAt = now;
        broadcastExcept(ws, { type: 'CURSOR', playerId, image, x, y });
        return;
      }
      if (message.type === 'CURSOR_LEAVE') {
        broadcastExcept(ws, { type: 'CURSOR_LEAVE', playerId });
        return;
      }
      if (message.type === 'GUESS') {
        const result = guess(game, { image: message.image, x: Number(message.x), y: Number(message.y), playerId });
        if (!result.ok) sendJson(ws, { type: 'ERROR', message: result.error });
        else {
          broadcast({ type: 'FEEDBACK', kind: result.kind, playerId, image: message.image, x: Number(message.x), y: Number(message.y), difference: result.difference || null });
          broadcastState(game.phase !== 'playing');
          if (game.phase !== 'playing') stopTick();
        }
        return;
      }
      if (message.type === 'HINT') {
        const result = useHint(game, playerId);
        if (!result.ok) sendJson(ws, { type: 'ERROR', message: result.error });
        else {
          broadcast({ type: 'FEEDBACK', kind: 'hint', playerId, difference: result.difference });
          broadcastState(game.phase !== 'playing');
          if (game.phase !== 'playing') stopTick();
        }
        return;
      }
      if (message.type === 'RESTART') startGame(game.puzzle.id, game.ruleType);
      if (message.type === 'NEXT_STAGE' || message.type === 'RANDOM_STAGE') {
        if (playerId !== selectorId()) {
          sendJson(ws, { type: 'ERROR', message: '스테이지 이동은 방장만 할 수 있어요.' });
          return;
        }
        if (game.phase === 'playing') return;
        const currentIndex = PUBLISHED_STAGES.findIndex((stage) => stage.id === game.puzzle.id);
        const candidates = PUBLISHED_STAGES.filter((stage) => stage.id !== game.puzzle.id);
        const requestedStage = message.type === 'NEXT_STAGE'
          ? PUBLISHED_STAGES[(currentIndex + 1) % PUBLISHED_STAGES.length]
          : candidates[Math.floor(Math.random() * candidates.length)] || game.puzzle;
        startGame(requestedStage.id, game.ruleType);
        return;
      }
      if (message.type === 'BACK_TO_STAGES') {
        if (playerId !== selectorId()) {
          sendJson(ws, { type: 'ERROR', message: '스테이지 이동은 방장만 할 수 있어요.' });
          return;
        }
        stopTick();
        game = null;
        broadcast({ type: 'GAME_START', stageId: null });
        broadcastStageSelection();
      }
    });

    ws.on('close', () => {
      players = players.filter((candidate) => candidate !== player);
      if (players.length) {
        broadcast({ type: 'CURSOR_LEAVE', playerId });
        broadcast({ type: 'PLAYER_LEFT', playerId });
        if (!game) broadcastStageSelection();
      }
      if (!players.length) {
        stopTick();
        game = null;
        expectedMatchId = null;
      }
    });
  });

  function handleHttp(req, res) {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (pathname === '/admin/reload-stages') {
      if (req.method !== 'POST') {
        res.writeHead(405, { Allow: 'POST', 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
        return;
      }
      const remoteAddress = req.socket.remoteAddress || '';
      const isLoopback = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';
      const isProxied = Boolean(req.headers.forwarded || req.headers['x-forwarded-for'] || req.headers['x-real-ip']);
      if (!isLoopback || isProxied) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'stage reload is local-only' }));
        return;
      }
      try {
        const result = reloadStages();
        console.log(`[spot-the-difference] stages reloaded: ${result.count}`);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: true, ...result }));
      } catch (error) {
        console.error('[spot-the-difference] stage reload failed:', error.message);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: error.message }));
      }
      return;
    }
    const fromAssets = pathname.startsWith('/assets/');
    const root = fromAssets ? ASSET_DIR : PUBLIC_DIR;
    const relative = fromAssets ? pathname.slice('/assets/'.length) : (pathname === '/' ? 'index.html' : pathname.slice(1));
    const fullPath = path.resolve(root, relative);
    if (!fullPath.startsWith(path.resolve(root) + path.sep)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    fs.readFile(fullPath, (error, data) => {
      if (error) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fullPath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': fromAssets ? 'no-cache' : 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  }

  function handleUpgrade(req, socket, head) {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  }

  return { handleHttp, handleUpgrade, prepareMatch, reloadStages };
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const app = createApp();
  app.prepareMatch('local-prototype');
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  server.listen(Number(process.env.PORT) || 3020, () => console.log('[spot-the-difference] http://localhost:3020'));
}
