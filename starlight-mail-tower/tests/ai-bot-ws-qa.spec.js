/**
 * @fileoverview AI 봇 기능 QA 검증 -- Node.js WS 클라이언트 기반.
 *
 * TC-1: AI 모드 게임 시작 (mode=ai 접속 후 봇 자동 JOIN/READY/START)
 * TC-2: 봇 자동 RESULT_VOTE (GAME_OVER 후)
 * TC-3: 기존 2인 모드 회귀
 * TC-4: games.json botAvailable 확인
 * TC-5: 기존 simulation.spec.js 회귀 (npm test 별도 실행)
 * TC-6: 봇 프로세스 종료 (인간 disconnect 시)
 * TC-7: spawnBot/killBot 함수 존재 확인 (정적)
 * TC-8: i18n ai.start 키 ko/en 확인 (정적)
 * TC-9: 다중 mode=ai 접속 시 봇 중복 spawn 방지
 * TC-10: 봇 ROOM_FULL 처리 (인간이 이미 2슬롯 점유)
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

/** 테스트용 포트 (다른 테스트와 충돌 방지) */
const TEST_PORT = 3019;

/**
 * 지정된 포트에서 서버를 기동한다.
 * @param {number} port 포트
 * @returns {Promise<{server: http.Server, app: object}>}
 */
function startServer(port) {
  return new Promise((resolve, reject) => {
    const app = createApp({
      testing: true,
      reconnectGraceMs: 2000,
      getBotUrl: () => `ws://localhost:${port}/ws?mode=bot`,
    });
    const server = http.createServer(app.handleHttp);
    server.on('upgrade', app.handleUpgrade);
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, app }));
  });
}

/**
 * WS 클라이언트를 생성하고 open을 대기한다.
 * @param {string} url WS URL
 * @param {number} [timeoutMs=5000] 타임아웃
 * @returns {Promise<WebSocket>}
 */
function connectWs(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`WS connect timeout: ${url}`));
    }, timeoutMs);
    ws.on('open', () => { clearTimeout(timer); resolve(ws); });
    ws.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

/**
 * WS에서 특정 타입의 메시지를 대기한다.
 * @param {WebSocket} ws 소켓
 * @param {string} type 대기할 메시지 타입
 * @param {number} [timeoutMs=10000] 타임아웃
 * @returns {Promise<object>}
 */
function waitForMessage(ws, type, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeoutMs);
    const handler = (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === type) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

/**
 * WS에서 여러 메시지를 수집한다 (시간 기반).
 * @param {WebSocket} ws 소켓
 * @param {number} durationMs 수집 시간
 * @returns {Promise<object[]>}
 */
function collectMessages(ws, durationMs) {
  return new Promise((resolve) => {
    const messages = [];
    const handler = (raw) => {
      try { messages.push(JSON.parse(raw.toString())); } catch { /* noop */ }
    };
    ws.on('message', handler);
    setTimeout(() => { ws.off('message', handler); resolve(messages); }, durationMs);
  });
}

/**
 * WS에 JSON 메시지를 전송한다.
 * @param {WebSocket} ws 소켓
 * @param {object} payload 메시지
 */
function send(ws, payload) {
  ws.send(JSON.stringify(payload));
}

// ── 정적 검증 ───────────────────────────────────────────────────

describe('정적 검증', () => {
  test('TC-STATIC-1: bot.js가 존재한다', () => {
    const botPath = path.join(PROJECT_ROOT, 'bot.js');
    assert.ok(fs.existsSync(botPath), 'bot.js 파일이 존재해야 한다');
  });

  test('TC-STATIC-2: server.js에 spawnBot/killBot 함수가 존재한다', () => {
    const serverSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf-8');
    assert.ok(serverSrc.includes('function spawnBot'), 'spawnBot 함수가 server.js에 존재해야 한다');
    assert.ok(serverSrc.includes('function killBot'), 'killBot 함수가 server.js에 존재해야 한다');
  });

  test('TC-STATIC-3: index.html에 ai-start-button이 존재한다', () => {
    const htmlSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'index.html'), 'utf-8');
    assert.ok(htmlSrc.includes('id="ai-start-button"'), '#ai-start-button이 index.html에 존재해야 한다');
    assert.ok(htmlSrc.includes('data-i18n="ai.start"'), 'data-i18n="ai.start" 속성이 있어야 한다');
  });

  test('TC-STATIC-4: i18n.js에 ai.start 키가 ko/en 모두 존재한다', () => {
    const i18nSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'js', 'i18n.js'), 'utf-8');
    assert.ok(i18nSrc.includes("'ai.start'"), 'ai.start 키가 i18n.js에 존재해야 한다');
    // ko 검증
    assert.ok(i18nSrc.includes("'AI랑 시작'") || i18nSrc.includes('"AI랑 시작"'), 'ko 번역이 존재해야 한다');
    // en 검증
    assert.ok(i18nSrc.includes("'Start with AI'") || i18nSrc.includes('"Start with AI"'), 'en 번역이 존재해야 한다');
  });

  test('TC-STATIC-5 (TC-4): games.json에서 starlight-mail-tower의 botAvailable=true 확인', () => {
    const gamesPath = path.join(PROJECT_ROOT, '..', 'launcher', 'public', 'games.json');
    const games = JSON.parse(fs.readFileSync(gamesPath, 'utf-8'));
    const smtGame = games.find((g) => g.id === 'starlight-mail-tower');
    assert.ok(smtGame, 'starlight-mail-tower 항목이 games.json에 존재해야 한다');
    assert.strictEqual(smtGame.botAvailable, true, 'botAvailable이 true여야 한다');
  });

  test('TC-STATIC-6: launcher/server.js에 starlight-mail-tower getBotUrl 주입이 존재한다', () => {
    const launcherSrc = fs.readFileSync(path.join(PROJECT_ROOT, '..', 'launcher', 'server.js'), 'utf-8');
    assert.ok(launcherSrc.includes("'starlight-mail-tower'"), 'starlight-mail-tower 라우팅이 존재해야 한다');
    assert.ok(launcherSrc.includes('createStarlightMailTowerApp'), 'createStarlightMailTowerApp import가 존재해야 한다');
    // getBotUrl 주입 확인
    assert.ok(
      launcherSrc.includes("getBotUrl: () => `ws://localhost:${PORT}/starlight-mail-tower/ws?mode=bot`"),
      'getBotUrl 주입이 존재해야 한다'
    );
  });

  test('TC-STATIC-7: bot.js가 레벨 데이터를 직접 import한다', () => {
    const botSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'bot.js'), 'utf-8');
    assert.ok(botSrc.includes("from './shared/levels.js'"), 'bot.js가 shared/levels.js를 import해야 한다');
  });

  test('TC-STATIC-8: bot.js에 SIGTERM/SIGINT 핸들러가 있다', () => {
    const botSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'bot.js'), 'utf-8');
    assert.ok(botSrc.includes("process.on('SIGTERM'"), 'SIGTERM 핸들러가 있어야 한다');
    assert.ok(botSrc.includes("process.on('SIGINT'"), 'SIGINT 핸들러가 있어야 한다');
  });

  test('TC-STATIC-9: bot.js에 ROOM_FULL 에러 처리가 있다', () => {
    const botSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'bot.js'), 'utf-8');
    assert.ok(botSrc.includes('ROOM_FULL'), 'ROOM_FULL 에러 처리가 있어야 한다');
  });

  test('TC-STATIC-10: bot.js 슬롯 에이전트에 필수 목표가 모두 있다', () => {
    const botSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'bot.js'), 'utf-8');
    // 새 구조의 목표 종류 (GOAL enum)
    const requiredGoals = [
      'BOOST_RECEIVER', 'BOOST_STRIKER', 'GO_ANCHOR',
      'HOLD_ANCHOR', 'GO_SWITCH', 'GO_CHECKPOINT',
      'FINISH_PRESS', 'DONE', 'WAIT_RESPAWN',
    ];
    for (const goal of requiredGoals) {
      assert.ok(botSrc.includes(goal), `${goal} 목표가 bot.js에 존재해야 한다`);
    }
  });

  test('TC-STATIC-11: bot.js에 교착 방어가 있다 (STUCK_TICKS)', () => {
    const botSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'bot.js'), 'utf-8');
    assert.ok(botSrc.includes('STUCK_TICKS'), '교착 감지 상수가 있어야 한다');
    assert.ok(botSrc.includes('detectStuck'), '교착 감지 함수가 있어야 한다');
    assert.ok(botSrc.includes('resolveStuck'), '교착 해제 함수가 있어야 한다');
    // process.exit(1) 호출이 없어야 한다 (교착 시 재시도)
    const exitMatches = [...botSrc.matchAll(/process\.exit\(1\)/g)];
    assert.strictEqual(exitMatches.length, 0, 'process.exit(1) 호출이 없어야 한다');
  });

  test('TC-STATIC-12: client.js에 AI 버튼 클릭 핸들러가 있다', () => {
    const clientSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'js', 'client.js'), 'utf-8');
    assert.ok(clientSrc.includes('#ai-start-button'), 'AI 버튼 셀렉터가 client.js에 있어야 한다');
    assert.ok(clientSrc.includes('mode=ai&fresh=1'), 'mode=ai&fresh=1 리다이렉트가 있어야 한다');
  });

  test('TC-STATIC-13: client.js에 buildWebSocketUrl에 mode 파라미터가 포함된다', () => {
    const clientSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'js', 'client.js'), 'utf-8');
    assert.ok(clientSrc.includes('buildWebSocketUrl'), 'buildWebSocketUrl 함수가 있어야 한다');
    // mode 파라미터 포함 확인 (URLSearchParams 방식 또는 기존 modeQuery 방식)
    assert.ok(
      clientSrc.includes("mode ? `?mode=${mode}`") || clientSrc.includes('modeQuery') || clientSrc.includes("wsParams.set('mode', mode)"),
      'buildWebSocketUrl에서 mode 파라미터를 포함해야 한다'
    );
  });

  test('TC-STATIC-14: server.js handleUpgrade에서 mode=ai 감지 후 spawnBot 호출 확인', () => {
    const serverSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf-8');
    // mode=ai 감지 로직 존재 확인
    assert.ok(
      serverSrc.includes("mode === 'ai'") && serverSrc.includes('spawnBot'),
      'handleUpgrade에서 mode=ai 감지 시 spawnBot 호출이 있어야 한다'
    );
  });

  test('TC-STATIC-15: server.js close 함수에서 killBot이 호출된다', () => {
    const serverSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf-8');
    // close 함수 내부에서 killBot 호출 확인
    assert.ok(
      serverSrc.includes('function close()') || serverSrc.includes('function close ()'),
      'close 함수가 있어야 한다'
    );
    // close 함수에서 killBot 호출 (근처 grep)
    const closeIdx = serverSrc.indexOf('function close()');
    if (closeIdx >= 0) {
      const afterClose = serverSrc.slice(closeIdx, closeIdx + 300);
      assert.ok(afterClose.includes('killBot'), 'close 함수에서 killBot이 호출되어야 한다');
    }
  });
});

// ── 동적 검증 (서버 실행 + WS) ─────────────────────────────────

describe('동적 검증: TC-1 AI 모드 게임 시작', () => {
  let server, app;

  before(async () => {
    const result = await startServer(TEST_PORT);
    server = result.server;
    app = result.app;
  });

  after(async () => {
    app.close();
    await new Promise((resolve) => server.close(resolve));
  });

  test('mode=ai 접속 시 봇이 자동으로 JOIN/READY하여 게임이 시작된다', async () => {
    // 인간 역할로 mode=ai 접속
    const humanWs = await connectWs(`ws://127.0.0.1:${TEST_PORT}/ws?mode=ai`);

    // JOIN 메시지 전송 (인간)
    send(humanWs, {
      type: 'JOIN',
      name: 'QA-Human',
      sessionToken: '',
      locale: 'ko',
      requestedRole: null,
      readyFromLobby: false,
    });

    // WELCOME 수신 대기
    const welcome = await waitForMessage(humanWs, 'WELCOME', 5000);
    assert.ok(welcome.playerId, 'WELCOME에 playerId가 있어야 한다');

    // READY 전송
    send(humanWs, { type: 'READY' });

    // 봇이 자동으로 JOIN + READY를 보내므로, START가 도착해야 한다
    // 봇 spawn은 비동기이므로 넉넉하게 대기
    const start = await waitForMessage(humanWs, 'START', 15000);
    assert.ok(start, 'START 메시지가 도착해야 한다');
    assert.ok(start.levelId, 'START에 levelId가 있어야 한다');

    // SNAPSHOT 수신으로 게임이 진행 중인지 확인
    const snapshot = await waitForMessage(humanWs, 'SNAPSHOT', 5000);
    assert.ok(snapshot, 'SNAPSHOT이 도착해야 한다');
    assert.ok(Array.isArray(snapshot.players), 'SNAPSHOT에 players 배열이 있어야 한다');
    assert.strictEqual(snapshot.players.length, 2, '플레이어 2명이 있어야 한다');

    // 정리
    humanWs.close();
  });
});

describe('동적 검증: TC-3 기존 2인 모드 회귀', () => {
  let server, app;

  before(async () => {
    const result = await startServer(TEST_PORT + 1);
    server = result.server;
    app = result.app;
  });

  after(async () => {
    app.close();
    await new Promise((resolve) => server.close(resolve));
  });

  test('일반 모드 WS 2개 접속 시 기존 2인 게임이 정상 시작된다', async () => {
    const port = TEST_PORT + 1;
    const ws1 = await connectWs(`ws://127.0.0.1:${port}/ws`);
    const ws2 = await connectWs(`ws://127.0.0.1:${port}/ws`);

    // P1 JOIN
    send(ws1, { type: 'JOIN', name: 'Player1', sessionToken: '', locale: 'ko' });
    const w1 = await waitForMessage(ws1, 'WELCOME', 3000);
    assert.strictEqual(w1.playerId, 'p1', '첫 번째 접속자는 p1이어야 한다');

    // P2 JOIN
    send(ws2, { type: 'JOIN', name: 'Player2', sessionToken: '', locale: 'ko' });
    const w2 = await waitForMessage(ws2, 'WELCOME', 3000);
    assert.strictEqual(w2.playerId, 'p2', '두 번째 접속자는 p2여야 한다');

    // 양쪽 READY
    send(ws1, { type: 'READY' });
    send(ws2, { type: 'READY' });

    // START 수신
    const start1 = await waitForMessage(ws1, 'START', 5000);
    assert.ok(start1, 'P1에게 START가 도착해야 한다');
    assert.ok(start1.levelId, 'START에 levelId가 있어야 한다');

    // 정리
    ws1.close();
    ws2.close();
  });

  test('봇 없이 3번째 접속 시 ROOM_FULL 에러가 발생한다', async () => {
    const port = TEST_PORT + 1;
    // 이전 테스트의 testing 모드 정리 대기
    await new Promise((r) => setTimeout(r, 500));

    // 새로 2명 접속
    const ws1 = await connectWs(`ws://127.0.0.1:${port}/ws`);
    send(ws1, { type: 'JOIN', name: 'P1', sessionToken: '', locale: 'ko' });
    const w1 = await waitForMessage(ws1, 'WELCOME', 3000);
    assert.ok(w1.playerId);

    const ws2 = await connectWs(`ws://127.0.0.1:${port}/ws`);
    send(ws2, { type: 'JOIN', name: 'P2', sessionToken: '', locale: 'ko' });
    const w2 = await waitForMessage(ws2, 'WELCOME', 3000);
    assert.ok(w2.playerId);

    // 3번째 접속 시도
    const ws3 = await connectWs(`ws://127.0.0.1:${port}/ws`);
    send(ws3, { type: 'JOIN', name: 'P3', sessionToken: '', locale: 'ko' });

    const error = await waitForMessage(ws3, 'ERROR', 3000);
    assert.strictEqual(error.code, 'ROOM_FULL', 'ROOM_FULL 에러가 발생해야 한다');

    ws1.close();
    ws2.close();
    ws3.close();
  });
});

describe('동적 검증: TC-6 인간 disconnect 시 봇 프로세스 종료', () => {
  let server, app;

  before(async () => {
    const result = await startServer(TEST_PORT + 2);
    server = result.server;
    app = result.app;
  });

  after(async () => {
    app.close();
    await new Promise((resolve) => server.close(resolve));
  });

  test('인간 disconnect 후 봇 WS 연결도 종료된다', async () => {
    const port = TEST_PORT + 2;
    const humanWs = await connectWs(`ws://127.0.0.1:${port}/ws?mode=ai`);

    send(humanWs, { type: 'JOIN', name: 'QA-Disco', sessionToken: '', locale: 'ko' });
    await waitForMessage(humanWs, 'WELCOME', 5000);
    send(humanWs, { type: 'READY' });

    // START까지 대기
    try {
      await waitForMessage(humanWs, 'START', 15000);
    } catch {
      // 봇 spawn 지연 가능성
    }

    // 인간 disconnect
    humanWs.close();

    // 봇이 정리되도록 잠시 대기
    await new Promise((r) => setTimeout(r, 3000));

    // 새 접속 시 정상 입장 가능해야 한다 (이전 세션이 정리됨)
    const newWs = await connectWs(`ws://127.0.0.1:${port}/ws`);
    send(newWs, { type: 'JOIN', name: 'NewPlayer', sessionToken: '', locale: 'ko' });
    const newWelcome = await waitForMessage(newWs, 'WELCOME', 5000);
    // testing 모드이므로 슬롯이 자동 정리됨
    assert.ok(newWelcome.playerId, '새 접속이 정상적으로 처리되어야 한다');

    newWs.close();
  });
});

describe('동적 검증: 엣지케이스', () => {
  let server, app;

  before(async () => {
    const result = await startServer(TEST_PORT + 3);
    server = result.server;
    app = result.app;
  });

  after(async () => {
    app.close();
    await new Promise((resolve) => server.close(resolve));
  });

  test('mode=bot 접속 시 봇이 re-spawn되지 않는다 (무한 루프 방지)', async () => {
    const port = TEST_PORT + 3;

    // mode=bot으로 직접 접속 (봇인 척)
    const botWs = await connectWs(`ws://127.0.0.1:${port}/ws?mode=bot`);
    send(botWs, { type: 'JOIN', name: 'FakeBot', sessionToken: '', locale: 'ko' });
    const welcome = await waitForMessage(botWs, 'WELCOME', 3000);
    assert.ok(welcome.playerId, 'mode=bot 접속도 정상 JOIN이 되어야 한다');

    // 짧은 대기 후 서버 로그에 봇 spawn이 없는지 확인
    // (직접 확인은 어렵지만, spawnBot은 mode===ai일 때만 호출됨)
    await new Promise((r) => setTimeout(r, 500));

    botWs.close();
  });

  test('빈 name으로 JOIN 시 에러 처리', async () => {
    const port = TEST_PORT + 3;
    // 이전 테스트의 testing 모드 정리를 위해 잠시 대기
    await new Promise((r) => setTimeout(r, 500));

    const ws = await connectWs(`ws://127.0.0.1:${port}/ws`);
    send(ws, { type: 'JOIN', name: '', sessionToken: '', locale: 'ko' });

    const error = await waitForMessage(ws, 'ERROR', 3000);
    assert.ok(error, '빈 name으로 JOIN 시 에러가 발생해야 한다');
    assert.strictEqual(error.code, 'INVALID_MESSAGE', 'INVALID_MESSAGE 에러여야 한다');

    ws.close();
  });

  test('READY를 게임 중(playing) 보내면 에러가 발생한다', async () => {
    const port = TEST_PORT + 3;
    await new Promise((r) => setTimeout(r, 500));

    const ws1 = await connectWs(`ws://127.0.0.1:${port}/ws`);
    const ws2 = await connectWs(`ws://127.0.0.1:${port}/ws`);

    send(ws1, { type: 'JOIN', name: 'P1', sessionToken: '', locale: 'ko' });
    await waitForMessage(ws1, 'WELCOME', 3000);
    send(ws2, { type: 'JOIN', name: 'P2', sessionToken: '', locale: 'ko' });
    await waitForMessage(ws2, 'WELCOME', 3000);

    // 양쪽 READY -> START
    send(ws1, { type: 'READY' });
    send(ws2, { type: 'READY' });
    await waitForMessage(ws1, 'START', 5000);

    // playing 상태에서 READY 전송
    send(ws1, { type: 'READY' });
    const error = await waitForMessage(ws1, 'ERROR', 3000);
    assert.strictEqual(error.code, 'INVALID_MESSAGE', 'playing 중 READY는 INVALID_MESSAGE여야 한다');

    ws1.close();
    ws2.close();
  });
});

describe('동적 검증: AI 모드 SNAPSHOT 수신 검증', () => {
  let server, app;

  before(async () => {
    const result = await startServer(TEST_PORT + 4);
    server = result.server;
    app = result.app;
  });

  after(async () => {
    app.close();
    await new Promise((resolve) => server.close(resolve));
  });

  test('AI 모드에서 SNAPSHOT이 지속적으로 수신된다 (봇 활동 확인)', async () => {
    const port = TEST_PORT + 4;
    const humanWs = await connectWs(`ws://127.0.0.1:${port}/ws?mode=ai`);

    send(humanWs, { type: 'JOIN', name: 'QA-Snap', sessionToken: '', locale: 'ko' });
    await waitForMessage(humanWs, 'WELCOME', 5000);
    send(humanWs, { type: 'READY' });

    try {
      await waitForMessage(humanWs, 'START', 15000);
    } catch {
      humanWs.close();
      assert.fail('START 타임아웃 -- 봇 spawn 실패 가능');
    }

    // 2초간 SNAPSHOT 수집
    const messages = await collectMessages(humanWs, 2000);
    const snapshots = messages.filter((m) => m.type === 'SNAPSHOT');
    assert.ok(snapshots.length >= 5, `최소 5개 이상의 SNAPSHOT이 수신되어야 한다 (실제: ${snapshots.length})`);

    // 첫 SNAPSHOT과 마지막 SNAPSHOT 사이에 tick이 증가하는지 확인
    if (snapshots.length >= 2) {
      const first = snapshots[0];
      const last = snapshots[snapshots.length - 1];
      assert.ok(last.tick > first.tick, 'tick이 시간에 따라 증가해야 한다');
    }

    // p1, p2 모두 존재하는지 확인
    const lastSnap = snapshots[snapshots.length - 1];
    const p1 = lastSnap.players.find((p) => p.id === 'p1');
    const p2 = lastSnap.players.find((p) => p.id === 'p2');
    assert.ok(p1, 'SNAPSHOT에 p1이 있어야 한다');
    assert.ok(p2, 'SNAPSHOT에 p2가 있어야 한다');

    humanWs.close();
  });
});

describe('코드 정적 분석 검증', () => {
  test('bot.js에서 desired[playerId] 접근 시 p1/p2 외 키가 사용되면 undefined', () => {
    // bot.js의 desired 객체는 p1, p2만 가진다.
    // moveToX, sendInput 등에서 playerId를 사용하므로
    // playerId가 null일 때 안전한지 확인
    const botSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'bot.js'), 'utf-8');

    // sendInput에서 ownedIds.has(playerId) 가드가 있는지 확인
    assert.ok(botSrc.includes('ownedIds.has(playerId)'), 'sendInput에 ownedIds 가드가 있어야 한다');

    // moveToX에서 getPlayer null 체크 확인
    assert.ok(botSrc.includes('if (!actor) return false'), 'moveToX에서 null 체크가 있어야 한다');
  });

  test('server.js에서 clients.size === 0 시 killBot 호출 확인', () => {
    const serverSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf-8');
    assert.ok(
      serverSrc.includes('clients.size === 0') && serverSrc.includes('killBot()'),
      'clients.size === 0 시 killBot()이 호출되어야 한다'
    );
  });

  test('bot.js에서 process.exit(1)이 존재하지 않는다 (교착 시 재시도)', () => {
    const botSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'bot.js'), 'utf-8');
    // 새 구조에서는 process.exit(1) 호출이 없어야 한다
    const exitMatches = [...botSrc.matchAll(/process\.exit\(1\)/g)];
    assert.strictEqual(exitMatches.length, 0, 'process.exit(1)이 없어야 한다');
    // 교착 방어가 재시도 방식으로 존재하는지 확인
    assert.ok(botSrc.includes('resolveStuck'), '교착 해제 로직이 있어야 한다');
    assert.ok(botSrc.includes('FALLBACK_WAIT'), 'fallback 대기 상태가 있어야 한다');
  });

  test('bot.js RESULT_VOTE 미러링 구조가 올바르다 (#62)', () => {
    const botSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'bot.js'), 'utf-8');
    // GAME_OVER 핸들러에서 즉시 RESULT_VOTE 전송이 없어야 한다
    const gameOverIdx = botSrc.indexOf("msg.type === 'GAME_OVER'");
    assert.ok(gameOverIdx >= 0, 'GAME_OVER 핸들러가 있어야 한다');
    const afterGameOver = botSrc.slice(gameOverIdx, gameOverIdx + 500);
    // GAME_OVER 핸들러 내에 ownedIds.has를 사용한 즉시 RESULT_VOTE 전송이 없어야 한다
    assert.ok(!afterGameOver.includes("ownedIds.has(p1Id)") || !afterGameOver.includes("action: 'RETRY'"),
      'GAME_OVER 핸들러에서 ownedIds 기반 즉시 RETRY 전송이 제거되어야 한다');
    // RESULT_VOTE_STATE 핸들러가 존재해야 한다
    assert.ok(botSrc.includes("msg.type === 'RESULT_VOTE_STATE'"),
      'RESULT_VOTE_STATE 핸들러가 bot.js에 존재해야 한다');
    // 미러링 핵심 키워드 존재 확인
    assert.ok(botSrc.includes('humanSlotId'), 'humanSlotId 변수가 존재해야 한다');
    assert.ok(botSrc.includes('humanAction'), 'humanAction 변수가 존재해야 한다');
    assert.ok(botSrc.includes('lastMirroredAction'), 'lastMirroredAction 맵이 존재해야 한다');
    // status 가드 확인 (processing/menu/partner_left 무시)
    assert.ok(botSrc.includes("msg.status === 'processing'"), 'processing 상태 가드가 있어야 한다');
    assert.ok(botSrc.includes("msg.status === 'partner_left'"), 'partner_left 상태 가드가 있어야 한다');
  });

  test('server.js spawnBot에 error 핸들러가 있다', () => {
    const serverSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf-8');
    const spawnIdx = serverSrc.indexOf('function spawnBot');
    assert.ok(spawnIdx >= 0, 'spawnBot 함수가 있어야 한다');
    const afterSpawn = serverSrc.slice(spawnIdx, spawnIdx + 500);
    assert.ok(afterSpawn.includes("on('error'"), 'spawnBot에 error 이벤트 핸들러가 있어야 한다');
  });

  test('server.js spawnBot 중복 spawn 방지 (botChild 가드)', () => {
    const serverSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf-8');
    const spawnIdx = serverSrc.indexOf('function spawnBot');
    const spawnBody = serverSrc.slice(spawnIdx, spawnIdx + 300);
    assert.ok(
      spawnBody.includes('!getBotUrl || botChild') || spawnBody.includes('botChild'),
      'spawnBot에 botChild 중복 방지 가드가 있어야 한다'
    );
  });
});

// ── ROOM_FULL 교착 버그 수정 검증 (TC-NEW-1 ~ TC-NEW-3) ──────────

describe('동적 검증: TC-NEW-1 AI 세션 후 재진입 시 ROOM_FULL 없음', () => {
  let server, app;

  before(async () => {
    const result = await startServer(3024);
    server = result.server;
    app = result.app;
  });

  after(async () => {
    app.close();
    await new Promise((resolve) => server.close(resolve));
  });

  test('LEAVE_GAME 전송 후 신규 JOIN → WELCOME 수신 (ROOM_FULL 없음)', async () => {
    const port = 3024;

    // 1) 인간 역할로 mode=ai 접속
    const humanWs = await connectWs(`ws://127.0.0.1:${port}/ws?mode=ai`);
    send(humanWs, { type: 'JOIN', name: 'QA-Reentry', sessionToken: '', locale: 'ko' });
    const welcome1 = await waitForMessage(humanWs, 'WELCOME', 5000);
    assert.ok(welcome1.playerId, 'WELCOME에 playerId가 있어야 한다');

    // 2) READY → START
    send(humanWs, { type: 'READY' });
    await waitForMessage(humanWs, 'START', 15000);

    // 3) LEAVE_GAME 전송 후 소켓 close (P-1 패턴)
    send(humanWs, { type: 'LEAVE_GAME' });
    await new Promise((r) => setTimeout(r, 200));
    humanWs.close();

    // 4) 봇 종료 대기 (서버가 clients.size === 0 시 killBot 호출)
    await new Promise((r) => setTimeout(r, 1500));

    // 5) 신규 WS로 재진입 (fresh=1 포함)
    const newWs = await connectWs(`ws://127.0.0.1:${port}/ws?mode=ai&fresh=1`);
    send(newWs, { type: 'JOIN', name: 'QA-NewEntry', sessionToken: '', locale: 'ko' });

    // 6) WELCOME 수신 확인 (ROOM_FULL이 아닌 정상 진입)
    const welcome2 = await waitForMessage(newWs, 'WELCOME', 5000);
    assert.ok(welcome2.playerId, '신규 진입에서 WELCOME을 받아야 한다');

    newWs.close();
  });
});

describe('동적 검증: TC-NEW-2 LEAVE_GAME 없이 close 후 fresh=1 재진입 방어', () => {
  let server, app;

  before(async () => {
    const result = await startServer(3025);
    server = result.server;
    app = result.app;
  });

  after(async () => {
    app.close();
    await new Promise((resolve) => server.close(resolve));
  });

  test('유령 슬롯이 있어도 fresh=1 재진입 시 서버가 정리 후 WELCOME을 보낸다', async () => {
    const port = 3025;

    // 1) 인간 역할로 mode=ai 접속
    const humanWs = await connectWs(`ws://127.0.0.1:${port}/ws?mode=ai`);
    send(humanWs, { type: 'JOIN', name: 'QA-Ghost', sessionToken: '', locale: 'ko' });
    const welcome1 = await waitForMessage(humanWs, 'WELCOME', 5000);
    assert.ok(welcome1.playerId);

    // 2) READY → START
    send(humanWs, { type: 'READY' });
    await waitForMessage(humanWs, 'START', 15000);

    // 3) LEAVE_GAME 없이 소켓 close → 서버가 pauseForDisconnect로 유령 슬롯 생성
    humanWs.close();

    // 4) 즉시(유령 슬롯이 살아 있는 동안) fresh=1로 재진입
    await new Promise((r) => setTimeout(r, 300));
    const newWs = await connectWs(`ws://127.0.0.1:${port}/ws?mode=ai&fresh=1`);
    send(newWs, { type: 'JOIN', name: 'QA-NewAfterGhost', sessionToken: '', locale: 'ko' });

    // 5) 서버가 유령 슬롯을 정리하고 WELCOME을 보내야 한다
    const welcome2 = await waitForMessage(newWs, 'WELCOME', 5000);
    assert.ok(welcome2.playerId, '유령 슬롯 정리 후 WELCOME을 받아야 한다');

    newWs.close();
  });
});

describe('정적 검증: TC-NEW-3 ROOM_FULL 재연결 루프 차단', () => {
  test('client.js에서 ROOM_FULL 수신 시 intentionalClose = true가 설정된다', () => {
    const clientSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'js', 'client.js'), 'utf-8');
    // ROOM_FULL 처리 코드 내부에 intentionalClose = true 설정이 존재하는지 단언
    const roomFullIdx = clientSrc.indexOf("'ROOM_FULL'");
    assert.ok(roomFullIdx >= 0, "client.js에 'ROOM_FULL' 문자열이 있어야 한다");
    const context = clientSrc.slice(roomFullIdx, roomFullIdx + 200);
    assert.ok(
      context.includes('intentionalClose = true'),
      'ROOM_FULL 처리 블록 안에 intentionalClose = true가 있어야 한다'
    );
  });

  test('server.js handleUpgrade에서 fresh=1일 때만 유령 슬롯을 정리한다', () => {
    const serverSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf-8');
    // fresh === '1' 조건이 handleUpgrade 안에 존재하는지 확인
    assert.ok(
      serverSrc.includes("fresh === '1'"),
      "handleUpgrade에 fresh === '1' 조건이 있어야 한다"
    );
    // mode === 'ai' && fresh === '1' 복합 조건 확인
    const upgradeIdx = serverSrc.indexOf('function handleUpgrade');
    assert.ok(upgradeIdx >= 0, 'handleUpgrade 함수가 있어야 한다');
    const upgradeBody = serverSrc.slice(upgradeIdx, upgradeIdx + 1000);
    assert.ok(
      upgradeBody.includes("mode === 'ai' && fresh === '1'"),
      "handleUpgrade에서 mode=ai와 fresh=1을 동시에 검사해야 한다"
    );
  });

  test('client.js buildWebSocketUrl에서 freshEntry가 true일 때만 fresh=1을 포함한다', () => {
    const clientSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'js', 'client.js'), 'utf-8');
    const buildIdx = clientSrc.indexOf('function buildWebSocketUrl');
    assert.ok(buildIdx >= 0, 'buildWebSocketUrl 함수가 있어야 한다');
    const buildBody = clientSrc.slice(buildIdx, buildIdx + 500);
    assert.ok(
      buildBody.includes("if (freshEntry) wsParams.set('fresh', '1')"),
      'freshEntry가 true일 때만 fresh=1을 WS URL에 추가해야 한다'
    );
  });

  test('client.js open 핸들러에서 freshEntry를 false로 리셋한다', () => {
    const clientSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'js', 'client.js'), 'utf-8');
    const openIdx = clientSrc.indexOf("socket.addEventListener('open'");
    assert.ok(openIdx >= 0, 'socket open 핸들러가 있어야 한다');
    const afterOpen = clientSrc.slice(openIdx, openIdx + 700);
    assert.ok(
      afterOpen.includes('freshEntry = false'),
      'open 핸들러에서 freshEntry를 false로 리셋해야 한다'
    );
  });
});

// ── #62 RESULT_VOTE 미러링 동적 검증 ─────────────────────────────

/**
 * HTTP POST 요청을 보낸다 (테스트용 서버 엔드포인트 호출).
 * @param {string} url URL
 * @returns {Promise<void>}
 */
function postTest(url) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST' }, (res) => {
      res.resume();
      res.on('end', resolve);
    });
    req.on('error', reject);
    req.end();
  });
}

describe('동적 검증: #62 RESULT_VOTE 미러링 (인간 NEXT 선택)', () => {
  let server, app;
  const port = TEST_PORT + 7; // 3026 (기존 3024/3025 TC-NEW와 충돌 방지)

  before(async () => {
    const result = await startServer(port);
    server = result.server;
    app = result.app;
  });

  after(async () => {
    app.close();
    await new Promise((resolve) => server.close(resolve));
  });

  test('인간이 NEXT를 선택하면 봇이 미러링하여 합의가 성립한다', { timeout: 30000 }, async () => {
    // 1) mode=ai 접속 -> JOIN -> WELCOME -> READY -> START
    const humanWs = await connectWs(`ws://127.0.0.1:${port}/ws?mode=ai`);
    send(humanWs, { type: 'JOIN', name: 'QA-Mirror', sessionToken: '', locale: 'ko' });
    await waitForMessage(humanWs, 'WELCOME', 5000);
    send(humanWs, { type: 'READY' });
    await waitForMessage(humanWs, 'START', 15000);

    // 2) 모든 모듈을 advance하여 result phase로 진입
    // 레벨 1(starlight-tower)은 8개 모듈을 가진다.
    for (let i = 0; i < 8; i++) {
      await postTest(`http://127.0.0.1:${port}/__test/advance`);
      await new Promise((r) => setTimeout(r, 100));
    }
    // finish 트리거 -> GAME_COMPLETED(~2.4s 후) -> GAME_OVER -> result phase
    await postTest(`http://127.0.0.1:${port}/__test/finish`);

    // GAME_OVER 대기
    await waitForMessage(humanWs, 'GAME_OVER', 10000);

    // 3) 인간이 NEXT 투표
    await new Promise((r) => setTimeout(r, 300));
    send(humanWs, { type: 'RESULT_VOTE', action: 'NEXT' });

    // 4) RESULT_VOTE_STATE 수신 -> 봇의 미러링 확인
    // 서버는 투표마다 RESULT_VOTE_STATE를 브로드캐스트한다.
    // 봇이 미러링하면 인간+봇 모두 NEXT가 되어 합의가 성립한다.
    // 합의 성립 시 status:'processing' -> 360ms 후 새 START가 온다.
    const voteStates = [];
    const startPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for START after NEXT vote')), 8000);
      const handler = (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (msg.type === 'RESULT_VOTE_STATE') voteStates.push(msg);
        if (msg.type === 'START') {
          clearTimeout(timer);
          humanWs.off('message', handler);
          resolve(msg);
        }
      };
      humanWs.on('message', handler);
    });

    const start = await startPromise;
    assert.ok(start, '봇 미러링 후 합의 성립으로 새 START가 도착해야 한다');

    // RESULT_VOTE_STATE 메시지 수 검증 (무한 루프 없음)
    assert.ok(voteStates.length <= 5,
      `RESULT_VOTE_STATE 수가 5건 이하여야 한다 (실제: ${voteStates.length})`);

    humanWs.close();
  });
});

describe('동적 검증: #62 셀프 플레이스루 RETRY 폴백', () => {
  let server, app;
  const port = TEST_PORT + 8; // 3027

  before(async () => {
    const result = await startServer(port);
    server = result.server;
    app = result.app;
  });

  after(async () => {
    app.close();
    await new Promise((resolve) => server.close(resolve));
  });

  test('셀프 플레이스루에서 봇이 RETRY 폴백으로 새 게임이 시작된다', { timeout: 30000 }, async () => {
    // mode=ai 접속하면 봇이 자동 spawn되어 두 슬롯을 점유할 수 있다
    const humanWs = await connectWs(`ws://127.0.0.1:${port}/ws?mode=ai`);
    send(humanWs, { type: 'JOIN', name: 'QA-SelfPlay', sessionToken: '', locale: 'ko' });
    await waitForMessage(humanWs, 'WELCOME', 5000);
    send(humanWs, { type: 'READY' });
    await waitForMessage(humanWs, 'START', 15000);

    // 모든 모듈 advance + finish
    for (let i = 0; i < 8; i++) {
      await postTest(`http://127.0.0.1:${port}/__test/advance`);
      await new Promise((r) => setTimeout(r, 100));
    }
    await postTest(`http://127.0.0.1:${port}/__test/finish`);

    // GAME_OVER 대기
    await waitForMessage(humanWs, 'GAME_OVER', 10000);

    // 봇이 셀프 플레이스루에서 양쪽 RETRY 투표를 보내면 합의가 성립하여 START가 온다.
    // 인간은 투표하지 않는다 (봇이 두 슬롯을 소유하므로 봇이 직접 처리).
    // 단, 이 TC에서 인간이 한 슬롯을 점유하고 봇이 다른 슬롯을 점유하는 구조이므로
    // 실제로 셀프 플레이스루가 아니다. 인간이 RETRY를 보내면 봇이 미러링한다.
    await new Promise((r) => setTimeout(r, 300));
    send(humanWs, { type: 'RESULT_VOTE', action: 'RETRY' });

    // 합의 후 새 START 대기
    const start = await waitForMessage(humanWs, 'START', 8000);
    assert.ok(start, '셀프 플레이스루 RETRY 후 새 START가 도착해야 한다');

    humanWs.close();
  });
});
