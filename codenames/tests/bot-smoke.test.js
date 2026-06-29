/**
 * @fileoverview 코드네임 클래식 AI 봇 스모크 — 격리 포트 3115, launcher 3000 미접촉.
 *
 * 실행: node codenames/tests/bot-smoke.test.js
 *
 * 봇 딜레이는 환경변수로 단축(CODENAMES_BOT_DELAY_MIN=0 / RAND=25)한다.
 * 봇은 child_process로 실제 spawn 되며(getBotUrl 훅), 환경변수는 자식에 상속된다.
 *
 * 구성:
 *   CBOT-001  봇 포함 1판 완주(데드락 없음) × 다회 — 적 단서 회피·턴 진행
 *   CBOT-002  스파이마스터 봇 단서: 자기팀 ≥2커버(또는 폴백1) + 단어!=보드
 *   CBOT-003  스파이마스터 봇 단서: 암살자/상대 태그 회피(실키 대조)
 *   CBOT-004  요원 봇 추측: 단서 태그 역조회 카드 + 보너스 추측 미사용
 *   CBOT-005  AI채우기 1사람+3봇 → 4슬롯 정확 배정 + isBot 정확
 *   CBOT-006  AI채우기 2사람+2봇
 *   CBOT-007  AI채우기 3사람+1봇
 *   CBOT-008  #13 좀비: 사람 disconnect 후 재접속 시 "방 가득" 미발생
 *   CBOT-009  휴먼 전용 보호: getBotUrl 없으면(또는 트리거 없으면) 봇 spawn 0
 *   CBOT-010  런처 경유 갭: team/role 없는 제너릭 봇 3개 spawn → red/spymaster 충돌 규명
 */

// 봇 act 딜레이 단축(자식 프로세스로 상속).
process.env.CODENAMES_BOT_DELAY_MIN = '0';
process.env.CODENAMES_BOT_DELAY_RAND = '25';

import http from 'http';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';
import { tagsForWord } from '../bot-knowledge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOT_PATH = path.join(__dirname, '..', 'bot.js');
const PORT = 3115;

// ── 미니 러너 ──────────────────────────────────────────────────────
let passed = 0; let failed = 0; const failures = [];
function assert(cond, label) {
  if (cond) { passed += 1; console.log(`  PASS  ${label}`); }
  else { failed += 1; failures.push(label); console.log(`  FAIL  ${label}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 서버 기동 ──────────────────────────────────────────────────────
const app = createApp({
  getBotUrl: () => `ws://localhost:${PORT}/ws?mode=bot`,
});
const server = http.createServer(app.handleHttp);
server.on('upgrade', app.handleUpgrade);

function listen() {
  return new Promise((res) => server.listen(PORT, '127.0.0.1', res));
}

// ── WS 사람 클라이언트 헬퍼 ────────────────────────────────────────
/**
 * 사람 클라이언트를 만든다. onState 콜백으로 reactive 자동 플레이를 붙일 수 있다.
 * @param {object} [opts]
 * @param {(s:object, api:object)=>void} [opts.onState]
 */
function makeHuman(opts = {}) {
  const messages = [];
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?mode=human`);
  const api = {
    ws, messages,
    send: (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); },
    lastOf: (t) => [...messages].reverse().find((m) => m.type === t),
    lastState: () => [...messages].reverse().find((m) => m.type === 'STATE'),
  };
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(d.toString()); } catch { return; }
    messages.push(m);
    if (m.type === 'STATE' && opts.onState) opts.onState(m, api);
  });
  return api;
}
function waitOpen(ws) {
  return new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
}
function waitFor(messages, pred, timeoutMs = 4000) {
  return new Promise((res, rej) => {
    const start = Date.now();
    const t = setInterval(() => {
      const hit = [...messages].reverse().find(pred);
      if (hit) { clearInterval(t); res(hit); return; }
      if (Date.now() - start > timeoutMs) { clearInterval(t); rej(new Error('timeout')); }
    }, 20);
  });
}

/** 직접 봇 child 를 spawn(런처 갭 재현용 — team/role 옵션 지정 가능). */
function spawnBotChild(extra = '') {
  const url = `ws://localhost:${PORT}/ws?mode=bot${extra}`;
  return spawn(process.execPath, [BOT_PATH, '--url', url], { detached: false, stdio: 'ignore' });
}

// ── 사람 스파이마스터/요원 자동 드라이버(게임 진행용, 봇 검증 대상 아님) ──
const opp = (t) => (t === 'red' ? 'blue' : 'red');

/**
 * 스파이마스터(사람) 자동 단서: 실키(myKey 전체)로 자기팀 ≥2커버 안전 태그를 고른다.
 * 봇과 동일 회피 원칙을 쓰되, 여기서는 게임 진행 드라이버 역할일 뿐이다.
 */
function driveSpymaster(s, api, myTeam) {
  if (s.currentTeam !== myTeam || s.turnPhase !== 'clue') return;
  const board = new Set(s.words);
  const myWords = []; const danger = [];
  for (let i = 0; i < 25; i++) {
    if (s.revealed[i] !== null) continue;
    if (s.myKey[i] === myTeam) myWords.push(s.words[i]);
    else if (s.myKey[i] === 'assassin' || s.myKey[i] === opp(myTeam)) danger.push(s.words[i]);
  }
  if (myWords.length === 0) return;
  const dangerTags = new Set();
  for (const w of danger) for (const t of tagsForWord(w)) dangerTags.add(t);
  // 빈도 집계.
  const freq = {};
  for (const w of myWords) for (const t of tagsForWord(w)) freq[t] = (freq[t] || 0) + 1;
  const cands = Object.entries(freq)
    .filter(([t]) => !dangerTags.has(t) && !board.has(t))
    .map(([t, c]) => ({ t, c })).sort((a, b) => b.c - a.c);
  if (cands.length > 0) {
    api.send({ type: 'CLUE', word: cands[0].t, number: Math.min(9, Math.max(1, cands[0].c)) });
    return;
  }
  // 폴백 1:1.
  for (const w of myWords) for (const t of tagsForWord(w)) {
    if (!dangerTags.has(t) && !board.has(t)) { api.send({ type: 'CLUE', word: t, number: 1 }); return; }
  }
  for (const w of myWords) {
    const ts = tagsForWord(w).filter((t) => !board.has(t));
    if (ts.length) { api.send({ type: 'CLUE', word: ts[0], number: 1 }); return; }
  }
}

/**
 * 요원(사람) 자동 추측: currentClue 역조회로 미공개 카드를 고른다. 보너스 미사용.
 */
function driveOperative(s, api, myTeam) {
  if (s.currentTeam !== myTeam || s.turnPhase !== 'guess') return;
  if (!s.currentClue || !s.currentClue.word) { api.send({ type: 'END_TURN' }); return; }
  if (s.guessesLeft <= 1) { api.send({ type: 'END_TURN' }); return; }
  const tag = s.currentClue.word;
  let pick = -1; let bestPos = 999;
  for (let i = 0; i < 25; i++) {
    if (s.revealed[i] !== null) continue;
    const pos = tagsForWord(s.words[i]).indexOf(tag);
    if (pos >= 0 && pos < bestPos) { bestPos = pos; pick = i; }
  }
  if (pick < 0) { api.send({ type: 'END_TURN' }); return; }
  api.send({ type: 'GUESS', cardIndex: pick });
}

// ════════════════════════════════════════════════════════════════
async function main() {
  await listen();
  console.log(`[bot-smoke] 서버 listen :${PORT}`);

  // ──────────────────────────────────────────────────────────────
  // CBOT-001~004: 봇 스파이마스터(red) + 봇 요원(red) + 봇 스파이마스터(blue) 검증
  //   구성: 사람 host=blue/operative(드라이버) + 봇3(red/sm, red/op, blue/sm)
  //   → red 팀은 완전 봇, blue 스파이마스터도 봇. 사람은 blue 요원만 구동.
  //   여러 판 반복해 데드락/암살자 즉사 빈도 측정 + 단서/추측 품질 캡처.
  // ──────────────────────────────────────────────────────────────
  console.log('\n[CBOT-001~004] 봇 포함 완주 + 단서/추측 품질');
  let completions = 0; let assassinDeaths = 0; let deadlocks = 0;
  const clueViolations = []; // {reason}
  const guessViolations = [];
  const deadlockStates = [];
  const GAMES = 12;

  for (let g = 0; g < GAMES; g++) {
    // 실키 관측용으로 사람 host를 blue/spymaster 가 아니라 blue/operative 로 두되,
    // 실키 검증은 별도(아래 CBOT-003 전용 캡처)에서 수행. 여기선 진행/데드락/완주 중심.
    const human = makeHuman({ onState: (s, api) => driveOperative(s, api, 'blue') });
    await waitOpen(human.ws);
    human.send({ type: 'JOIN', name: '드라이버' });
    await waitFor(human.messages, (m) => m.type === 'JOINED');
    human.send({ type: 'PICK_ROLE', team: 'blue', role: 'operative' });
    await sleep(60);
    // 봇 3개 정확 슬롯 spawn.
    const b1 = spawnBotChild('&team=red&role=spymaster');
    const b2 = spawnBotChild('&team=red&role=operative');
    const b3 = spawnBotChild('&team=blue&role=spymaster');
    // 슬롯 4개 채워질 때까지 대기.
    try {
      await waitFor(human.messages, (m) => m.type === 'ROLE_STATE'
        && m.canStart === true, 6000);
    } catch {
      assert(false, `CBOT-001 [game ${g}] 4슬롯 충원 실패(봇 합류 안 됨)`);
      [b1, b2, b3].forEach((b) => b.kill());
      human.ws.close();
      await sleep(150);
      continue;
    }
    // 단서/추측 품질 캡처용: 모든 STATE를 훑어 red 단서/추측 검증.
    // 사람(blue op)은 키를 모르므로 여기선 red 단서의 보드-단어 회피와
    // 요원의 태그 역조회만 검증(실키 회피 검증은 CBOT-003).
    let prevState = null;
    const seenRedClues = new Set();
    const tap = (d) => {
      let m; try { m = JSON.parse(d.toString()); } catch { return; }
      if (m.type !== 'STATE') return;
      // red 단서 캡처(보드 단어와 동일하면 위반 — game.js는 검사 안 하므로 봇 책임).
      if (m.currentTeam === 'red' && m.turnPhase === 'guess' && m.currentClue) {
        const ck = m.currentClue.word + '|' + m.currentClue.number;
        if (!seenRedClues.has(ck)) {
          seenRedClues.add(ck);
          if (m.words.includes(m.currentClue.word)) {
            clueViolations.push(`단서가 보드 단어와 동일: ${m.currentClue.word}`);
          }
          if (!(m.currentClue.number >= 1 && m.currentClue.number <= 9)) {
            clueViolations.push(`단서 숫자 범위 위반: ${m.currentClue.number}`);
          }
        }
      }
      // 요원 추측 역조회 검증: 직전 STATE가 red 요원 추측 단계였고, 그 사이 새 카드가
      // 공개되었으면 그 추측은 red 요원이 prevState.currentClue 에 대해 한 것이다.
      // (현재 STATE 기준이 아니라 직전 STATE 기준으로 귀속해 turn flip 오귀속을 막는다.)
      if (prevState && prevState.currentTeam === 'red' && prevState.turnPhase === 'guess'
          && prevState.currentClue) {
        const tag = prevState.currentClue.word;
        for (let i = 0; i < 25; i++) {
          if (prevState.revealed[i] === null && m.revealed[i] !== null) {
            const w = m.words[i];
            if (!tagsForWord(w).includes(tag)) {
              guessViolations.push(`요원 추측 비매칭: "${w}" ∌ 태그 "${tag}"`);
            }
          }
        }
      }
      prevState = { currentTeam: m.currentTeam, turnPhase: m.turnPhase, currentClue: m.currentClue, revealed: m.revealed.slice() };
    };
    human.ws.on('message', tap);
    human.send({ type: 'START_GAME' });

    // 완주(GAME_OVER) 대기 — 데드락 시 timeout.
    try {
      const over = await waitFor(human.messages, (m) => m.type === 'GAME_OVER', 25000);
      completions += 1;
      if (over.reason === 'assassin') assassinDeaths += 1;
    } catch {
      deadlocks += 1;
      const st = human.lastState();
      const revCount = st ? st.revealed.filter((x) => x !== null).length : -1;
      const diag = st ? `currentTeam=${st.currentTeam} turnPhase=${st.turnPhase} redFound=${st.redFound} blueFound=${st.blueFound} revealed=${revCount} clue=${st.currentClue ? st.currentClue.word + '/' + st.currentClue.number : 'null'}` : 'no-state';
      deadlockStates.push(diag);
      console.log(`  [game ${g}] GAME_OVER 미수신(데드락) — ${diag}`);
    }
    human.ws.off('message', tap);
    [b1, b2, b3].forEach((b) => { try { b.kill(); } catch { /* */ } });
    human.ws.close();
    await sleep(250); // 봇 종료/룸 리셋 대기
  }

  assert(completions === GAMES, `CBOT-001 ${GAMES}판 전부 완주(데드락 0) — 완주 ${completions}, 데드락 ${deadlocks}`);
  assert(deadlocks === 0, `CBOT-001b 데드락 0건 (실제 ${deadlocks})`);
  if (deadlockStates.length) { console.log('  데드락 멈춤 상태:'); for (const d of deadlockStates) console.log('    · ' + d); }
  console.log(`  INFO  암살자 즉사 ${assassinDeaths}/${completions}판`);
  assert(assassinDeaths <= Math.ceil(completions * 0.4), `CBOT-001c 암살자 즉사 빈도 낮음(≤40%) — ${assassinDeaths}/${completions}`);
  assert(clueViolations.length === 0, `CBOT-002 단서 보드단어회피·숫자범위 위반 0 (실제 ${clueViolations.length}: ${clueViolations.slice(0, 3).join(' / ')})`);
  assert(guessViolations.length === 0, `CBOT-004 요원 태그 역조회 비매칭 0 (실제 ${guessViolations.length}: ${guessViolations.slice(0, 3).join(' / ')})`);

  // ──────────────────────────────────────────────────────────────
  // CBOT-003: 스파이마스터 봇 단서 vs 실키 — 암살자/상대 태그 회피 + ≥2커버
  //   구성: 사람 host=blue/spymaster(실키 관측) + 봇 red/spymaster + 사람 red/operative + 사람 blue/operative
  //   red 봇 스파이마스터의 첫 CLUE를 캡처해 blue 스파이마스터가 본 실키로 검증.
  // ──────────────────────────────────────────────────────────────
  console.log('\n[CBOT-003] 스파이마스터 봇 단서 실키 대조(암살자/상대 회피)');
  {
    let smViolations = 0; let smChecks = 0; let cover2 = 0; let fallback1 = 0;
    const ROUNDS = 5;
    for (let r = 0; r < ROUNDS; r++) {
      const blueSM = makeHuman(); // 실키 관측(스파이마스터 = 전체 키)
      await waitOpen(blueSM.ws);
      blueSM.send({ type: 'JOIN', name: '관측' });
      await waitFor(blueSM.messages, (m) => m.type === 'JOINED');
      blueSM.send({ type: 'PICK_ROLE', team: 'blue', role: 'spymaster' });
      await sleep(40);
      const redOp = makeHuman(); await waitOpen(redOp.ws);
      redOp.send({ type: 'JOIN', name: 'redop' });
      await waitFor(redOp.messages, (m) => m.type === 'JOINED');
      redOp.send({ type: 'PICK_ROLE', team: 'red', role: 'operative' });
      await sleep(40);
      const blueOp = makeHuman(); await waitOpen(blueOp.ws);
      blueOp.send({ type: 'JOIN', name: 'blueop' });
      await waitFor(blueOp.messages, (m) => m.type === 'JOINED');
      blueOp.send({ type: 'PICK_ROLE', team: 'blue', role: 'operative' });
      await sleep(40);
      const redSMbot = spawnBotChild('&team=red&role=spymaster');
      try {
        await waitFor(blueSM.messages, (m) => m.type === 'ROLE_STATE' && m.canStart === true, 6000);
      } catch {
        assert(false, `CBOT-003 [r${r}] 슬롯 충원 실패`);
        redSMbot.kill(); [blueSM, redOp, blueOp].forEach((c) => c.ws.close()); await sleep(150); continue;
      }
      blueSM.send({ type: 'START_GAME' });
      // 첫 STATE에서 selker(실키) 확보 후 red 봇 CLUE 대기.
      let clue = null;
      try {
        clue = await waitFor(blueSM.messages, (m) => m.type === 'STATE'
          && m.currentTeam === 'red' && m.turnPhase === 'guess' && m.currentClue, 8000);
      } catch { /* red 선공 아닐 수 있음 — 아래서 처리 */ }
      // red가 후공이면 blue 먼저 단서 필요 → blueSM 가 드라이브 후 재시도.
      if (!clue) {
        // blue 스파이마스터로 한 번 단서를 주어 턴을 넘긴다.
        const s0 = blueSM.lastState();
        if (s0 && s0.currentTeam === 'blue' && s0.turnPhase === 'clue') {
          driveSpymaster(s0, blueSM, 'blue');
          // blue 요원이 패스해서 red 턴으로.
          await sleep(80);
          const sb = blueOp.lastState();
          if (sb && sb.currentTeam === 'blue' && sb.turnPhase === 'guess') blueOp.send({ type: 'END_TURN' });
        }
        try {
          clue = await waitFor(blueSM.messages, (m) => m.type === 'STATE'
            && m.currentTeam === 'red' && m.turnPhase === 'guess' && m.currentClue, 8000);
        } catch { /* */ }
      }
      if (clue) {
        smChecks += 1;
        const key = blueSM.lastState().myKey; // blue 스파이마스터 = 전체 실키
        const words = clue.words;
        const tag = clue.currentClue.word;
        const num = clue.currentClue.number;
        // 자기팀(red) 미공개 커버 수.
        let cover = 0; let dangerHit = false; let boardHit = words.includes(tag);
        for (let i = 0; i < 25; i++) {
          if (clue.revealed[i] !== null) continue;
          const has = tagsForWord(words[i]).includes(tag);
          if (!has) continue;
          if (key[i] === 'red') cover += 1;
          if (key[i] === 'assassin' || key[i] === 'blue') dangerHit = true;
        }
        if (dangerHit) smViolations += 1; // 암살자/상대 단어가 단서 태그 보유 → 회피 실패
        if (boardHit) smViolations += 1;
        if (cover >= 2) cover2 += 1; else fallback1 += 1;
        // number 가 실제 커버와 일치(또는 폴백 1).
        if (cover >= 2 && num !== cover) smViolations += 1;
      }
      redSMbot.kill();
      [blueSM, redOp, blueOp].forEach((c) => c.ws.close());
      await sleep(220);
    }
    console.log(`  INFO  단서 검증 ${smChecks}회 — ≥2커버 ${cover2}, 폴백1 ${fallback1}`);
    assert(smChecks > 0, `CBOT-003 red 봇 단서 캡처 성공 (${smChecks}회)`);
    assert(smViolations === 0, `CBOT-003 암살자/상대 회피 + 보드회피 + 숫자정합 위반 0 (실제 ${smViolations})`);
  }

  // ──────────────────────────────────────────────────────────────
  // CBOT-005~007: AI채우기 슬롯 배정 (1+3 / 2+2 / 3+1)
  // ──────────────────────────────────────────────────────────────
  console.log('\n[CBOT-005~007] AI채우기 슬롯 배정');
  /**
   * humanPicks: [{team,role}, ...] 사람들이 차지할 슬롯. 첫 사람이 호스트.
   * 호스트가 FILL_WITH_AI → 빈 슬롯 봇 충원. 결과 ROLE_STATE 검증.
   */
  async function aiFillCase(humanPicks, label) {
    const humans = [];
    for (let i = 0; i < humanPicks.length; i++) {
      const h = makeHuman();
      await waitOpen(h.ws);
      h.send({ type: 'JOIN', name: `사람${i + 1}` });
      await waitFor(h.messages, (m) => m.type === 'JOINED');
      h.send({ type: 'PICK_ROLE', ...humanPicks[i] });
      await sleep(50);
      humans.push(h);
    }
    // 호스트가 AI 채우기.
    humans[0].send({ type: 'FILL_WITH_AI' });
    let ok = false; let rs = null;
    try {
      rs = await waitFor(humans[0].messages, (m) => m.type === 'ROLE_STATE' && m.canStart === true, 6000);
      ok = true;
    } catch { /* */ }
    let assigned = true; let botCount = 0;
    if (ok) {
      const SLOTS = [['red', 'spymaster'], ['red', 'operative'], ['blue', 'spymaster'], ['blue', 'operative']];
      for (const [t, ro] of SLOTS) {
        const occ = rs.players.filter((p) => p.team === t && p.role === ro);
        if (occ.length !== 1) assigned = false;
      }
      botCount = rs.players.filter((p) => p.isBot).length;
    }
    assert(ok && assigned, `${label} 4슬롯 정확 충원(중복0/누락0)`);
    assert(botCount === (4 - humanPicks.length), `${label} 봇 수 ${4 - humanPicks.length} (실제 ${botCount}) + isBot 정확`);
    // 실제 시작 가능까지 확인(START).
    if (ok) {
      humans[0].send({ type: 'START_GAME' });
      let started = false;
      try { await waitFor(humans[0].messages, (m) => m.type === 'GAME_START', 4000); started = true; } catch { /* */ }
      assert(started, `${label} 호스트 START_GAME → 게임 시작`);
    }
    for (const h of humans) h.ws.close();
    await sleep(350);
  }

  await aiFillCase([{ team: 'red', role: 'spymaster' }], 'CBOT-005 1사람+3봇');
  await aiFillCase([{ team: 'red', role: 'spymaster' }, { team: 'blue', role: 'operative' }], 'CBOT-006 2사람+2봇');
  await aiFillCase([
    { team: 'red', role: 'spymaster' }, { team: 'red', role: 'operative' }, { team: 'blue', role: 'spymaster' },
  ], 'CBOT-007 3사람+1봇');

  // ──────────────────────────────────────────────────────────────
  // CBOT-008: #13 좀비 — 사람 disconnect 후 재접속 시 "방 가득" 미발생
  //   1사람+3봇 게임 시작 후 사람 끊김 → 봇 슬롯 동기 정리 → 재접속 4번 OK.
  // ──────────────────────────────────────────────────────────────
  console.log('\n[CBOT-008] #13 좀비 정리(disconnect→재접속)');
  {
    const h = makeHuman();
    await waitOpen(h.ws);
    h.send({ type: 'JOIN', name: '호스트' });
    await waitFor(h.messages, (m) => m.type === 'JOINED');
    h.send({ type: 'PICK_ROLE', team: 'red', role: 'spymaster' });
    await sleep(50);
    h.send({ type: 'FILL_WITH_AI' });
    try { await waitFor(h.messages, (m) => m.type === 'ROLE_STATE' && m.canStart === true, 6000); } catch { /* */ }
    // 사람 강제 종료(비정상 disconnect 모사).
    h.ws.terminate();
    await sleep(600); // close 핸들러 + 봇 terminate 전파 대기

    // 재접속 4명 — 어느 누구도 "방 가득" ERROR 받지 않아야.
    let roomFull = false;
    const re = [];
    for (let i = 0; i < 4; i++) {
      const c = makeHuman();
      await waitOpen(c.ws);
      c.send({ type: 'JOIN', name: `재접속${i}` });
      re.push(c);
      await sleep(120);
    }
    await sleep(300);
    for (const c of re) {
      if (c.messages.some((m) => m.type === 'ERROR' && /가득/.test(m.message || ''))) roomFull = true;
    }
    assert(!roomFull, 'CBOT-008 재접속 4명 "방 가득" ERROR 0 (#13 봇 슬롯 동기 정리)');
    // 4명 모두 JOINED 받았는지(실제 입장).
    const joinedAll = re.every((c) => c.messages.some((m) => m.type === 'JOINED'));
    assert(joinedAll, 'CBOT-008b 재접속 4명 전원 JOINED');
    for (const c of re) c.ws.close();
    await sleep(300);
  }

  // ──────────────────────────────────────────────────────────────
  // CBOT-009: 휴먼 전용 보호 — AI 트리거 없이 4사람이면 봇 spawn 0
  // ──────────────────────────────────────────────────────────────
  console.log('\n[CBOT-009] 휴먼 전용 보호(트리거 없으면 봇 0)');
  {
    const SLOTS = [['red', 'spymaster'], ['red', 'operative'], ['blue', 'spymaster'], ['blue', 'operative']];
    const humans = [];
    for (let i = 0; i < 4; i++) {
      const h = makeHuman();
      await waitOpen(h.ws);
      h.send({ type: 'JOIN', name: `휴먼${i}` });
      await waitFor(h.messages, (m) => m.type === 'JOINED');
      h.send({ type: 'PICK_ROLE', team: SLOTS[i][0], role: SLOTS[i][1] });
      await sleep(40);
      humans.push(h);
    }
    await sleep(300);
    const rs = humans[0].lastOf('ROLE_STATE');
    const anyBot = rs ? rs.players.some((p) => p.isBot) : true;
    assert(rs && !anyBot && rs.canStart === true, 'CBOT-009 4사람 게임: isBot 봇 0 + canStart true (봇 spawn 0)');
    // 시작도 정상.
    humans[0].send({ type: 'START_GAME' });
    let started = false;
    try { await waitFor(humans[0].messages, (m) => m.type === 'GAME_START', 4000); started = true; } catch { /* */ }
    assert(started, 'CBOT-009b 4사람 휴먼 게임 정상 시작(봇 무관)');
    for (const h of humans) h.ws.close();
    await sleep(300);
  }

  // ──────────────────────────────────────────────────────────────
  // CBOT-010: 런처 경유 GAP-1 자동배정 — team/role 없는 제너릭 봇 3개가 빈 슬롯 자동 충원
  //   launcher/server.js spawnBotForAiFill 은 `?mode=bot`만 붙인다(team/role 無).
  //   GAP-1 수정: 서버가 제너릭 봇을 빈 슬롯에 자동 배정 → 봇은 ROLE_STATE에서 채택.
  //   사람1(미선택) + 봇3 → 봇이 빈 3슬롯 차지, 사람이 남은 1슬롯 선택 시 canStart.
  // ──────────────────────────────────────────────────────────────
  console.log('\n[CBOT-010] 런처 경유 GAP-1(제너릭 봇 빈 슬롯 자동배정)');
  {
    const host = makeHuman();
    await waitOpen(host.ws);
    host.send({ type: 'JOIN', name: '런처사람' });
    await waitFor(host.messages, (m) => m.type === 'JOINED');
    // 사람은 슬롯 미선택(런처 REDIRECT 직후 role_select 막 도달한 상태 모사).
    // 런처가 하듯 team/role 없이 제너릭 봇 3개 spawn → 서버 자동배정(400ms 지연).
    const gb = [spawnBotChild(''), spawnBotChild(''), spawnBotChild('')];
    await sleep(1500); // 봇 JOIN + 서버 자동배정(400ms) + ROLE_STATE 전파
    const rs = host.lastOf('ROLE_STATE');
    const botSlots = rs ? rs.players.filter((p) => p.isBot) : [];
    const ALL_SLOTS = [['red', 'spymaster'], ['red', 'operative'], ['blue', 'spymaster'], ['blue', 'operative']];
    // 봇이 차지한 distinct 슬롯 수(중복 점유 없어야).
    const botSlotKeys = new Set(botSlots.map((p) => `${p.team}-${p.role}`));
    const filledSlots = rs ? ALL_SLOTS.filter(([t, ro]) => rs.players.some((p) => p.team === t && p.role === ro)).length : 0;
    console.log(`  INFO  제너릭 봇 결과: 봇슬롯 ${botSlots.length}개(distinct ${botSlotKeys.size}), 채워진 논리슬롯 ${filledSlots}/4, canStart=${rs ? rs.canStart : '?'}`);
    // GAP-1: 봇3이 서로 다른 빈 슬롯 3개를 자동 점유(중복 0). 사람 미선택이라 canStart는 아직 false.
    assert(botSlots.length === 3 && botSlotKeys.size === 3,
      `CBOT-010 제너릭 봇3 빈 슬롯 자동배정(중복0) — 봇 ${botSlots.length}, distinct ${botSlotKeys.size}`);
    assert(filledSlots === 3 && (rs ? rs.canStart !== true : false),
      `CBOT-010b 봇3 점유로 3/4 슬롯 + 사람 미선택이라 canStart false — 채워진 ${filledSlots}/4`);
    // 사람이 남은 1슬롯 선택 → canStart true 검증.
    const emptySlot = rs ? ALL_SLOTS.find(([t, ro]) => !rs.players.some((p) => p.team === t && p.role === ro)) : null;
    if (emptySlot) {
      host.send({ type: 'PICK_ROLE', team: emptySlot[0], role: emptySlot[1] });
      let started = false;
      try {
        await waitFor(host.messages, (m) => m.type === 'ROLE_STATE' && m.canStart === true, 4000);
        started = true;
      } catch { /* */ }
      assert(started, `CBOT-010c 사람이 남은 슬롯(${emptySlot.join('/')}) 선택 → canStart true`);
    } else {
      assert(false, 'CBOT-010c 남은 빈 슬롯 없음(자동배정 과다)');
    }
    gb.forEach((b) => { try { b.kill(); } catch { /* */ } });
    host.ws.close();
    await sleep(400);
  }

  // ── 결과 ──
  console.log(`\n총: ${passed + failed}건  PASS: ${passed}  FAIL: ${failed}`);
  if (failures.length) { console.log('실패 목록:'); for (const f of failures) console.log('  - ' + f); }
  server.close();
  await sleep(200);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('치명 오류:', e); server.close(); process.exit(2); });
