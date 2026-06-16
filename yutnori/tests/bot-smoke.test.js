/**
 * @fileoverview 윷놀이 봇 시나리오 smoke 테스트 — ad-hoc 노드 러너.
 *
 * 실행:
 *   node tests/bot-smoke.test.js
 *
 * 검증 시나리오 (YBOT-001~005):
 *   - YBOT-001: 봇 vs 봇 1판 완주 (winner 수신, 타임아웃 없음)
 *   - YBOT-002: 봇 vs 봇 3판 연속 완주 (REMATCH 2회, 잠금 0건)
 *   - YBOT-003: corner 분기 응답 확인 (봇이 outer/shortcut 유효값 응답)
 *   - YBOT-004: center 분기 응답 확인 (봇이 top/bottom 응답)
 *   - YBOT-005: 잡기 보너스 처리 (capturedBonus=true 상태에서 THROW_YUT 송신)
 *
 * 구현 방식:
 *   - createApp(server.js)로 독립 HTTP 서버를 띄운다 (포트 3104).
 *   - 한쪽은 server.js가 spawn한 실제 bot.js 자식 프로세스(mode=ai 진입으로 트리거).
 *   - 다른 한쪽은 테스트가 직접 운전하는 "관전 겸 플레이어 봇"(인라인) — STATE를 직접
 *     관찰하면서 bot.js와 동일한 휴리스틱(choosePiece)으로 행동한다. 이를 통해 게임을
 *     끝까지 진행시키면서 분기/보너스/완주 이벤트를 카운트한다.
 *   - YBOT-003/004/005는 봇 vs 봇 대전을 충분히 반복해 자연 발생을 집계한다(≥1건이면 PASS).
 *
 * 작업 포트: 3104 (사용자 launcher 3000과 다른 게임 서버 무영향).
 */

// 봇 자식 프로세스의 행동 지연을 짧게 설정한다 (완주 속도 확보).
// server.js의 spawnBotChild가 process.env를 전파하므로 자식 bot.js가 이 값을 읽는다.
process.env.YUTNORI_BOT_DELAY_MIN = process.env.YUTNORI_BOT_DELAY_MIN || '20';
process.env.YUTNORI_BOT_DELAY_RAND = process.env.YUTNORI_BOT_DELAY_RAND || '40';

import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';
import { choosePiece } from '../bot.js';

// ── 미니 테스트 러너 ───────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function assertTrue(cond, label) {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    const msg = `  FAIL  ${label}`;
    console.log(msg);
    failures.push(msg);
  }
}

function section(name) {
  console.log(`\n[${name}]`);
}

const PORT = 3104;

/**
 * 인라인 플레이어 봇 — 테스트가 직접 운전한다.
 * bot.js와 동일한 휴리스틱으로 행동하면서, 게임 중 발생한 분기/보너스/완주를
 * 카운트하여 시나리오 검증에 활용한다.
 */
function makeInlinePlayer(url, counters) {
  const ws = new WebSocket(url);
  let myId = null;
  let lastActedFor = null;
  let lastState = null;
  let actEpoch = 0;
  let timer = null;

  function send(msg) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  ws.on('open', () => send({ type: 'JOIN', playerName: '테스트봇' }));
  ws.on('error', () => {});
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    switch (msg.type) {
      case 'JOINED':
        myId = msg.playerId;
        send({ type: 'READY' });
        break;
      case 'START':
        lastActedFor = null;
        break;
      case 'STATE':
        handleState(msg);
        break;
      case 'GAME_OVER':
        counters.gameOvers += 1;
        counters.lastWinner = msg.winner;
        // 재대결 자동 송신 (다음 판 진행).
        setTimeout(() => send({ type: 'REMATCH' }), 200);
        break;
      case 'ERROR':
        // 거절 → 다음 STATE에서 재시도.
        lastActedFor = null;
        actEpoch += 1;
        if (timer) { clearTimeout(timer); timer = null; }
        break;
      default:
        break;
    }
  });

  function handleState(s) {
    lastState = s;
    if (!myId || s.winner || !s.started) return;
    // capturedBonus 발생 집계 (어느 쪽 턴이든 STATE에 노출되면 카운트).
    if (s.capturedBonus === true) counters.capturedBonusSeen += 1;
    if (s.currentTurn !== myId) {
      if (timer) { clearTimeout(timer); timer = null; }
      lastActedFor = null; // 새 턴 진입 시 동일 키로 인한 잠금 방지 (bot.js와 동일).
      actEpoch += 1;
      return;
    }
    // awaitingBranchType 포함 — 중첩 분기(corner→center) 키 충돌 데드락 방지 (bot.js와 동일).
    const key = `${s.currentTurn}|${(s.pendingResults || []).join(',')}|${s.awaitingBranchAt}|${s.awaitingBranchType || ''}|${s.capturedBonus ? 1 : 0}`;
    if (key === lastActedFor) return;
    lastActedFor = key;
    if (timer) { clearTimeout(timer); timer = null; }
    timer = setTimeout(() => {
      timer = null;
      const cur = lastState;
      if (!cur || cur.currentTurn !== myId || cur.winner || !cur.started) return;
      act(cur);
    }, 15 + Math.floor(Math.random() * 25)); // 빠른 진행(테스트용)
  }

  function act(s) {
    actEpoch += 1;
    // 분기 대기 우선.
    if (s.awaitingBranchAt !== null && s.awaitingBranchAt !== undefined) {
      const bt = s.awaitingBranchType;
      let pathChoice;
      if (bt === 'corner') {
        counters.cornerBranches += 1;
        pathChoice = Math.random() < 0.5 ? 'shortcut' : 'outer';
      } else {
        counters.centerBranches += 1;
        pathChoice = Math.random() < 0.5 ? 'top' : 'bottom';
      }
      send({ type: 'CHOOSE_PATH', pathChoice });
      return;
    }
    const pending = s.pendingResults || [];
    if (pending.length > 0) {
      const useResult = pending[0];
      const me = (s.players || []).find((p) => p.id === myId);
      if (!me) return;
      const idx = choosePiece(me.pieces, useResult);
      if (idx >= 0) send({ type: 'MOVE_PIECE', pieceIndex: idx, useResult });
      return;
    }
    // 큐 비었으면 던지기 (capturedBonus 포함).
    if (s.capturedBonus === true) counters.bonusThrows += 1;
    send({ type: 'THROW_YUT' });
  }

  return {
    ws,
    close: () => new Promise((res) => { ws.once('close', res); ws.close(); }),
  };
}

/**
 * 서버를 띄우고, 봇(자식 프로세스) vs 인라인 봇(테스트 운전) 대전을 N판 진행한다.
 * @param {number} games 목표 완주 판 수
 * @param {number} timeoutMs 전체 타임아웃
 * @returns {Promise<object>} 집계 카운터
 */
async function runBotVsBot(games, timeoutMs) {
  const app = createApp({
    hostUrl: '',
    getBotUrl: () => `ws://localhost:${PORT}/ws?mode=bot`,
  });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });

  const counters = {
    gameOvers: 0,
    lastWinner: null,
    cornerBranches: 0,
    centerBranches: 0,
    capturedBonusSeen: 0,
    bonusThrows: 0,
  };

  // 인라인 봇이 mode=ai로 접속 → 서버가 자식 bot.js를 spawn(상대).
  const inline = makeInlinePlayer(`ws://127.0.0.1:${PORT}/ws?mode=ai`, counters);

  // N판 완주 또는 타임아웃까지 대기.
  await new Promise((resolve) => {
    const start = Date.now();
    const poll = setInterval(() => {
      if (counters.gameOvers >= games || Date.now() - start > timeoutMs) {
        clearInterval(poll);
        resolve();
      }
    }, 200);
  });

  // 정리: 인라인 봇 종료 → 서버 close 핸들러가 killBotChild로 자식 봇도 정리.
  await inline.close();
  await new Promise((res) => setTimeout(res, 300)); // 봇 kill 여유
  await new Promise((res) => server.close(res));

  return counters;
}

/**
 * 수동(passive) WS 드라이버 — 자동 행동 없이 테스트가 직접 send + waitFor 한다.
 * makeInlinePlayer(자동 휴리스틱)와 달리 결정적 시나리오 운전용.
 * @param {string} url
 * @returns {{ send: Function, waitFor: Function, close: Function }}
 */
function makeDriver(url) {
  const ws = new WebSocket(url);
  const buf = [];
  const waiters = [];
  ws.on('error', () => {});
  ws.on('open', () => ws.send(JSON.stringify({ type: 'JOIN', playerName: '프로브' })));
  ws.on('message', (data) => {
    let m;
    try { m = JSON.parse(data.toString()); } catch { return; }
    buf.push(m);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (!m.__c && waiters[i].pred(m)) {
        m.__c = true;
        clearTimeout(waiters[i].timer);
        waiters[i].resolve(m);
        waiters.splice(i, 1);
      }
    }
  });
  function send(msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
  function waitFor(pred, timeoutMs = 8000) {
    const hit = buf.find((m) => !m.__c && pred(m));
    if (hit) { hit.__c = true; return Promise.resolve(hit); }
    return new Promise((resolve, reject) => {
      const w = { pred, resolve, timer: null };
      w.timer = setTimeout(() => {
        const k = waiters.indexOf(w);
        if (k >= 0) waiters.splice(k, 1);
        reject(new Error('waitFor timeout'));
      }, timeoutMs);
      waiters.push(w);
    });
  }
  return { ws, send, waitFor, close: () => new Promise((res) => { ws.once('close', res); ws.close(); }) };
}

/**
 * YBOT-004 결정적 center 분기 프로브.
 *
 * 버그A 수정(2026-06-16) 이후 center 분기는 "지름길A로 중앙(23)에 정확히 착지한 뒤 다음 이동"
 * 시에만 발생한다(중앙 통과는 자동 라우팅, 지름길B 착지는 §13-6 자동 bottom). 자연 발생이 드물어
 * 봇 vs 봇 N판 집계는 flaky하므로, inject로 중앙(23) 정착 상태를 만들어 ① center 분기 요청 발생
 * ② 봇 스타일 top 응답 수락 ③ centerExitA 첫 칸(28, 버그B 신설) 도달 ④ 분기 대기 해제(데드락 없음)를
 * 결정적으로 검증한다. (서버 측 동선은 yut.unit / qa-rulefix-edge가 추가로 커버.)
 *
 * @returns {Promise<{centerBranchSeen:boolean, finalCell:(number|null), awaitingCleared:(boolean|null), error:(string|null)}>}
 */
async function runCenterBranchProbe() {
  // getBotUrl=null → 봇 자식 spawn 안 함. 두 드라이버를 직접 운전(mode=human).
  const app = createApp({ hostUrl: '', getBotUrl: () => null });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  const result = { centerBranchSeen: false, finalCell: null, awaitingCleared: null, error: null };
  let p1 = null;
  let p2 = null;
  try {
    p1 = makeDriver(`ws://127.0.0.1:${PORT}/ws?mode=human`);
    p2 = makeDriver(`ws://127.0.0.1:${PORT}/ws?mode=human`);
    await p1.waitFor((m) => m.type === 'JOINED');
    await p2.waitFor((m) => m.type === 'JOINED');
    p1.send({ type: 'READY' });
    p2.send({ type: 'READY' });
    await p1.waitFor((m) => m.type === 'START');
    // p1 말 0을 중앙(23)에 정착시키고 결과 큐에 do 1개 주입.
    await fetch(`http://127.0.0.1:${PORT}/test/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        started: true, currentTurn: 'p1', pendingResults: ['do'],
        awaitingBranchAt: null, awaitingBranchType: null, capturedBonus: false,
        pieces: {
          p1: [{ cell: 23 }, { cell: -1 }, { cell: -1 }, { cell: -1 }],
          p2: [{ cell: -1 }, { cell: -1 }, { cell: -1 }, { cell: -1 }],
        },
      }),
    });
    // inject가 반영된 STATE(말0 cell=23)를 확실히 식별해 race 회피.
    await p1.waitFor((m) =>
      m.type === 'STATE'
      && (m.players || []).find((p) => p.id === 'p1')?.pieces?.[0]?.cell === 23);
    // 중앙(23)에서 do → 출발 칸이 23이므로 center 분기 요청 발생 기대.
    p1.send({ type: 'MOVE_PIECE', pieceIndex: 0, useResult: 'do' });
    const br = await p1.waitFor((m) => m.type === 'BRANCH_REQUEST', 5000);
    result.centerBranchSeen = br.branchType === 'center';
    // 봇 스타일 응답: top → centerExitA.
    // 최종 STATE 식별: 분기 해제(awaitingBranchAt=null) + 말0이 HOME(-1)/중앙(23) 아님.
    // (START 단계의 미소비 STATE(cell=-1)나 분기 대기 STATE(cell=23)를 오매칭하지 않도록 정밀화.)
    p1.send({ type: 'CHOOSE_PATH', pathChoice: 'top' });
    const st = await p1.waitFor((m) => {
      if (m.type !== 'STATE' || m.awaitingBranchAt !== null) return false;
      const c = (m.players || []).find((p) => p.id === 'p1')?.pieces?.[0]?.cell ?? -1;
      return c !== -1 && c !== 23;
    }, 5000);
    const me = (st.players || []).find((p) => p.id === 'p1');
    result.finalCell = me.pieces[0].cell;
    result.awaitingCleared = st.awaitingBranchAt === null;
  } catch (e) {
    result.error = e.message;
  } finally {
    if (p1) await p1.close();
    if (p2) await p2.close();
    await new Promise((res) => server.close(res));
  }
  return result;
}

// ── YBOT-001: 봇 vs 봇 1판 완주 ─────────────────────────────────
async function main() {
  section('YBOT-001: 봇 vs 봇 1판 완주');
  const c1 = await runBotVsBot(1, 30000);
  assertTrue(c1.gameOvers >= 1, `1판 이상 완주 (gameOvers=${c1.gameOvers})`);
  assertTrue(['p1', 'p2'].includes(c1.lastWinner), `유효한 winner 수신 (winner=${c1.lastWinner})`);

  // ── YBOT-002: 봇 vs 봇 3판 연속 완주 (REMATCH) ──
  section('YBOT-002: 봇 vs 봇 3판 연속 완주 (REMATCH 2회)');
  const c2 = await runBotVsBot(3, 90000);
  assertTrue(c2.gameOvers >= 3, `3판 이상 연속 완주 (gameOvers=${c2.gameOvers}) — 데드락/턴 잠금 0`);
  assertTrue(['p1', 'p2'].includes(c2.lastWinner), `최종 판 winner 유효 (winner=${c2.lastWinner})`);

  // ── YBOT-003/004/005: 분기 + 보너스 자연 발생 집계 (c2 3판 누적) ──
  // 3판 진행 동안 corner/center 분기와 잡기 보너스가 모두 발생했는지 확인한다.
  section('YBOT-003: corner 분기 응답 확인');
  assertTrue(c2.cornerBranches >= 1,
    `corner 분기 ≥1건 응답 (cornerBranches=${c2.cornerBranches}) — 응답 후 서버 에러 없이 진행`);

  // YBOT-004: 버그A 수정(2026-06-16)으로 center 분기는 지름길A 중앙 정확 착지 후 다음 이동 시에만
  // 발생해 자연 집계가 드물다(flaky). 결정적 inject 프로브로 분기 발생 + top 응답 + centerExitA(28) 도달을 검증.
  section('YBOT-004: center 분기 응답 확인 (결정적 inject 프로브)');
  console.log(`    (참고) 3판 자연 발생 center 분기 = ${c2.centerBranches}건`);
  const probe = await runCenterBranchProbe();
  assertTrue(probe.error === null,
    `프로브 실행 오류 없음 (error=${probe.error})`);
  assertTrue(probe.centerBranchSeen === true,
    `중앙(23) 정착 후 MOVE → center 분기 요청 발생 (branchType=center)`);
  assertTrue(probe.finalCell === 28,
    `top 응답 수락 → centerExitA 첫 칸 28 도달 (finalCell=${probe.finalCell})`);
  assertTrue(probe.awaitingCleared === true,
    `분기 대기 해제 (영구 잠금/데드락 없음, awaitingBranchAt=null)`);

  section('YBOT-005: 잡기 보너스 처리');
  assertTrue(c2.capturedBonusSeen >= 1,
    `capturedBonus=true STATE ≥1건 (capturedBonusSeen=${c2.capturedBonusSeen}) — 보너스 던지기 ${c2.bonusThrows}회`);
}

main()
  .then(() => {
    console.log('\n────────────────────────────────────────');
    console.log(`총 ${passed + failed}건, PASS=${passed}, FAIL=${failed}`);
    if (failed > 0) {
      console.log('\n실패 목록:');
      for (const f of failures) console.log(f);
      process.exit(1);
    } else {
      console.log('모든 봇 smoke 테스트 통과.');
      process.exit(0);
    }
  })
  .catch((err) => {
    console.log(`\n  FAIL  scenario 예외: ${err.message}\n${err.stack}`);
    console.log('\n────────────────────────────────────────');
    console.log(`총 ${passed + failed + 1}건, PASS=${passed}, FAIL=${failed + 1}`);
    process.exit(1);
  });
