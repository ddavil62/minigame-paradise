/**
 * @fileoverview Phase 4 (Launcher / 호스트 안내) 회귀 테스트.
 *
 * 검증 항목:
 *  L1. JOIN → JOINED 응답에 hostUrl 필드가 존재한다 (string, http:// 접두사).
 *  L2. hostUrl이 비어있더라도 클라 폴백 동작이 안전하도록 항상 string 타입.
 *  L3. JOINED 응답에 기존 필드(playerId, waiting)가 그대로 보존 (backward compat).
 *  L4. (정적) public/index.html에서 invite-panel/invite-url 마크업이 제거됐다 (회귀 차단: 다시 살아나면 실패).
 *  L5. (정적) public/index.html에서 copy-url-btn 버튼이 제거됐다 (회귀 차단).
 *  L6. (정적) public/index.html에 toast 컨테이너가 포함된다 (showToast 용도로 유지됨).
 *  L7. (정적) public/js/ui.js에서 invite 패널 함수(showInvitePanel/hideInvitePanel/bindCopyUrlButton)가 제거됐고,
 *      showToast는 다른 용도(아이템/방어막 알림 등)로 유지된다.
 *  L8. (정적) public/js/network.js가 hostUrl을 onJoined 콜백에 전달한다 (서버 프로토콜 하위 호환 유지).
 *  L9. (정적) start.bat과 stop.bat 파일이 존재하고 기본 명령을 포함한다.
 *
 * ── 2026-06-17 C 작업(공통 초대패널 제거)으로 인한 단언 retire/전환 ──
 * 사용자 승인 기능 제거(invite-panel/copy 버튼 → 런처 로비 카드 클릭 진입으로 통일)에 따라,
 * 제거된 DOM/함수의 "존재"를 단언하던 L4/L4b/L5/L7a/L7b/L7c/L7e는 더 이상 유효하지 않다.
 * tetris CLAUDE.md "회귀 슈트 절대 수정 금지" 정책의 명시적 예외(사용자 승인 기능 제거)다.
 * 단순 삭제 대신 "제거됨을 검증하는 positive 단언"으로 전환하여 회귀게이트 정신을 유지한다
 * (초대 패널이 다시 살아나면 테스트가 실패한다).
 * hostUrl 서버 프로토콜(L1~L3, L8)·#toast(L6)·showToast(L7d)·배치 파일(L9)은 코드에 남아있어 그대로 보존한다.
 *
 * 사전 조건: 서버 실행 중 (`node server.js --port 3055`)
 * 실행: node tests/phase4-launcher.test.js [--port 3055]
 */

import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const portIdx = argv.indexOf('--port');
const PORT = portIdx >= 0 ? parseInt(argv[portIdx + 1], 10) : 3055;
const URL = `ws://localhost:${PORT}`;

let pass = 0;
let fail = 0;
const failures = [];

function assert(cond, name, detail = '') {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push({ name, detail });
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function section(t) { console.log(`\n── ${t} ─────────────────`); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function makeClient(label = '') {
  const ws = new WebSocket(URL);
  const received = [];
  let waiters = [];
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { msg = { type: 'PARSE_ERROR' }; }
    received.push(msg);
    const still = [];
    for (const w of waiters) {
      if (w.predicate(msg)) w.resolve(msg);
      else still.push(w);
    }
    waiters = still;
  });
  ws.on('error', () => {});
  return {
    ws, received, label,
    waitOpen() {
      return new Promise((resolve, reject) => {
        if (ws.readyState === 1) return resolve();
        ws.once('open', resolve);
        ws.once('error', reject);
      });
    },
    waitMessage(predicate, timeoutMs = 1500) {
      return new Promise((resolve, reject) => {
        const found = received.find(predicate);
        if (found) return resolve(found);
        const timer = setTimeout(() => reject(new Error(`waitMessage timeout (${label})`)), timeoutMs);
        waiters.push({ predicate, resolve: (m) => { clearTimeout(timer); resolve(m); } });
      });
    },
    send(p) { ws.send(JSON.stringify(p)); },
    close() { try { ws.close(); } catch {} },
  };
}

async function run() {
  // 서버 사전 확인
  try {
    const probe = new WebSocket(URL);
    await new Promise((resolve, reject) => {
      probe.once('open', () => { probe.close(); resolve(); });
      probe.once('error', reject);
      setTimeout(() => reject(new Error('probe timeout')), 1500);
    });
  } catch (e) {
    console.log(`\n[!] 서버 미실행 (${URL}). 실행: node server.js --port ${PORT}`);
    process.exit(1);
  }

  // ── L1~L3. JOINED 응답에 hostUrl 필드 ─────────────────────
  section('L1~L3. JOINED 응답 hostUrl 필드 + 기존 필드 보존');
  {
    const a = makeClient('A');
    await a.waitOpen();
    a.send({ type: 'JOIN', playerName: 'A' });
    const joined = await a.waitMessage((m) => m.type === 'JOINED');
    // L1: hostUrl 존재 + 문자열 타입 + http:// 또는 빈 문자열
    assert(typeof joined.hostUrl === 'string',
      `L1. JOINED.hostUrl은 string (실제 type: ${typeof joined.hostUrl})`);
    // L2: 빈 문자열도 허용하지만 비어있지 않다면 http:// 접두사여야 함
    const url = joined.hostUrl;
    const urlOk = url === '' || url.startsWith('http://') || url.startsWith('https://');
    assert(urlOk, `L2. hostUrl 형식 (빈 문자열 또는 http(s)://) — 실제: "${url}"`);
    // L3: 기존 필드 보존
    assert(joined.playerId === 'p1', `L3a. playerId 보존 (실제: ${joined.playerId})`);
    assert(joined.waiting === true, `L3b. waiting 보존 (실제: ${joined.waiting})`);
    // L1b (멀티룸 2026-08-01): JOINED 응답에 roomId 필드가 포함된다
    assert(typeof joined.roomId === 'string' && joined.roomId.length > 0,
      `L1b. JOINED.roomId 존재 (멀티룸 초대 링크 기반, 실제: "${joined.roomId}")`);
    // L1c: hostUrl이 비어있지 않다면 ?room= 파라미터 포함
    if (url) {
      const hasRoom = url.includes('?room=') || url.includes('&room=');
      assert(hasRoom, `L1c. JOINED.hostUrl에 ?room= 파라미터 포함 (멀티룸 초대 링크, 실제: "${url}")`);
    }
    a.close();
    await sleep(150);
  }

  // ── L4~L6. 정적 HTML 마크업 검증 (C 작업 후 현실 반영) ──────
  section('L4~L6. public/index.html 마크업 (invite-panel 제거 검증 + toast 유지)');
  {
    const htmlPath = path.join(ROOT, 'public', 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    // L4/L4b/L5: 2026-06-17 C 작업으로 제거됨 → "제거됨"을 positive 검증 (다시 살아나면 실패)
    assert(!html.includes('id="invite-panel"'),
      'L4. index.html에서 #invite-panel 영역 제거됨 (C 작업)');
    assert(!html.includes('id="invite-url"'),
      'L4b. index.html에서 #invite-url 표시 영역 제거됨 (C 작업)');
    assert(!html.includes('id="copy-url-btn"'),
      'L5. index.html에서 #copy-url-btn 버튼 제거됨 (C 작업)');
    // L6: #toast는 showToast(아이템/방어막 알림 등) 용도로 유지됨
    assert(html.includes('id="toast"'),
      'L6. index.html에 #toast 컨테이너 포함 (유지)');
  }

  // ── L7. ui.js 함수 정의 (invite 함수 제거 검증 + showToast 유지) ─
  section('L7. public/js/ui.js 함수 (invite 함수 제거 + showToast 유지)');
  {
    const uiPath = path.join(ROOT, 'public', 'js', 'ui.js');
    const ui = fs.readFileSync(uiPath, 'utf8');
    // L7a/L7b/L7c/L7e: 2026-06-17 C 작업으로 제거됨 → "제거됨"을 positive 검증
    assert(!ui.includes('function showInvitePanel'),
      'L7a. showInvitePanel 함수 제거됨 (C 작업)');
    assert(!ui.includes('function hideInvitePanel'),
      'L7b. hideInvitePanel 함수 제거됨 (C 작업)');
    assert(!ui.includes('function bindCopyUrlButton'),
      'L7c. bindCopyUrlButton 함수 제거됨 (C 작업)');
    // L7d: showToast는 다른 용도로 남아있어 유지 + export 유지 확인
    assert(ui.includes('function showToast'),
      'L7d. showToast 함수 정의 (유지)');
    // L7e: showInvitePanel이 더 이상 return 객체에 export되지 않음을 검증
    assert(!/showInvitePanel\s*,/.test(ui),
      'L7e. showInvitePanel이 return 객체에서 제거됨 (C 작업)');
  }

  // ── L8. network.js의 hostUrl 전달 ─────────────────────────
  section('L8. network.js가 hostUrl을 onJoined 콜백에 전달');
  {
    const netPath = path.join(ROOT, 'public', 'js', 'network.js');
    const net = fs.readFileSync(netPath, 'utf8');
    assert(net.includes('hostUrl'),
      'L8a. network.js가 hostUrl 키를 처리');
    assert(/onJoined\s*\(\s*\{[\s\S]*hostUrl/.test(net),
      'L8b. onJoined 호출에 hostUrl 포함');
  }

  // ── L9. 배치 파일 존재 ────────────────────────────────────
  section('L9. start.bat / stop.bat');
  {
    const startPath = path.join(ROOT, 'start.bat');
    const stopPath = path.join(ROOT, 'stop.bat');
    assert(fs.existsSync(startPath), 'L9a. start.bat 파일 존재');
    assert(fs.existsSync(stopPath), 'L9b. stop.bat 파일 존재');
    if (fs.existsSync(startPath)) {
      const s = fs.readFileSync(startPath, 'utf8');
      assert(s.includes('node server.js'), 'L9c. start.bat이 node server.js 실행');
      assert(/start\s+(""\s+)?http:\/\/localhost:3000/i.test(s),
        'L9d. start.bat이 http://localhost:3000 자동 오픈');
    }
    if (fs.existsSync(stopPath)) {
      const s = fs.readFileSync(stopPath, 'utf8');
      assert(/netstat/i.test(s) && /taskkill/i.test(s),
        'L9e. stop.bat이 netstat + taskkill 사용 (포트 기반 정확한 종료)');
    }
  }

  // ── 결과 요약 ─────────────────────────────────────────────
  console.log('');
  console.log('=================================================');
  console.log(` Phase 4 Launcher 회귀 결과: ${pass} PASS / ${fail} FAIL`);
  console.log('=================================================');
  if (failures.length) {
    console.log('\n실패 목록:');
    for (const f of failures) console.log(`  - ${f.name}${f.detail ? ' — ' + f.detail : ''}`);
  }
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error('테스트 중 예외:', e);
  process.exit(2);
});
