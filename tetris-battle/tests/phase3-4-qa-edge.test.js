/**
 * @fileoverview Phase 3+4 통합 QA 능동 엣지케이스 테스트.
 *
 * 이미 작성된 6개 슈트(phase1-unit/ws, phase2-items/edge, phase3-polish, phase4-launcher)는
 * 정상 동작과 회귀 방지에 집중되어 있다. 본 슈트는 QA 단계에서 도출한
 * "리포트에 적혀 있지만 실제로는 깨지는" 시나리오를 검증한다.
 *
 * 검증 대상:
 *  - Q1. 포트 충돌 시 자동 폴백 (Phase 4 plan D) — server.js EADDRINUSE 처리
 *  - Q2. start.bat / stop.bat 정적 안전성 (포트 범위 일치)
 *  - Q3. GAME_OVER 후 ITEM_GRANT가 자기 자신에게도 도착하지 않아야 (lines=0 grant도 차단)
 *  - Q4. JOIN 이전(연결만 된 상태) GAME_OVER → 서버 크래시 없음
 *  - Q5. server.js HOST_URL 산출 — lanIps[0]이 가상 어댑터일 때 후순위 정렬 동작
 *  - Q6. ui.js의 클립보드 fallback이 navigator.clipboard 미지원 시 동작 (정적)
 *  - Q7. 콘솔 ANSI 박스가 ASCII만 사용하는지 (cmd.exe 코드페이지 949 호환)
 */

import { WebSocket, WebSocketServer } from 'ws';
import http from 'http';
import net from 'net';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function expect(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${detail ? ' (' + detail + ')' : ''}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ' (' + detail + ')' : ''}`);
  }
}

function section(title) {
  console.log(`\n── ${title} ─────────────────`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PORT = parseInt(process.argv.find((a, i) => process.argv[i - 1] === '--port'), 10) || 3055;
const BASE = `ws://localhost:${PORT}`;

function openClient() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE);
    const got = [];
    ws.on('message', (data) => {
      try { got.push(JSON.parse(data.toString())); } catch (e) { /* ignore */ }
    });
    ws.on('open', () => resolve({ ws, got }));
    ws.on('error', reject);
  });
}

function sendJson(ws, payload) {
  ws.send(JSON.stringify(payload));
}

// ── Q1. 포트 충돌 자동 폴백 ───────────────────────────────────────
// server.js를 다른 포트(예: 3066)로 한 번 띄우고, 같은 포트로 또 한 번 띄워서
// 두 번째 인스턴스가 EADDRINUSE를 만나도 +1 폴백으로 살아남는지 확인.
async function testPortFallback() {
  section('Q1. 포트 충돌 시 자동 폴백 (Phase 4 plan D)');

  // 1) 임시 HTTP 서버로 3066 포트를 점유한다 (테스트가 PORT를 침범하지 않도록 격리).
  // Node http.Server.listen()는 host 미지정 시 ipv6 dual-stack(`::`)에 listen하므로
  // tetris-battle server.js(역시 host 미지정)와 동일한 채널을 점유하여 진짜 EADDRINUSE를 재현한다.
  // (0.0.0.0만 잡으면 ipv4-only가 되어 server.js의 `::` listen이 충돌하지 않음 — Q1 결함 재현 실패.)
  const blocker = http.createServer();
  await new Promise((resolve, reject) => {
    blocker.once('listening', resolve);
    blocker.once('error', reject);
    blocker.listen(3066);
  });

  // 2) tetris-battle server.js를 3066 포트로 띄운다 → 충돌 → 3067로 폴백 기대.
  const proc = spawn(
    process.execPath,
    [path.join(ROOT, 'server.js'), '--port', '3066'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let stdout = '';
  let stderr = '';
  let exited = false;
  let exitCode = null;
  proc.stdout.on('data', (d) => { stdout += d.toString(); });
  proc.stderr.on('data', (d) => { stderr += d.toString(); });
  proc.on('exit', (code) => { exited = true; exitCode = code; });

  // 최대 4초 대기 (폴백 100ms + 시작 ~1s)
  const deadline = Date.now() + 4000;
  let fallbackPortOk = false;
  while (Date.now() < deadline) {
    if (exited) break;
    // 3067에 연결 시도해서 살아있는지 확인
    try {
      await new Promise((resolve, reject) => {
        const sock = new net.Socket();
        sock.setTimeout(200);
        sock.once('connect', () => { fallbackPortOk = true; sock.destroy(); resolve(); });
        sock.once('error', (e) => { sock.destroy(); reject(e); });
        sock.once('timeout', () => { sock.destroy(); reject(new Error('timeout')); });
        sock.connect(3067, '127.0.0.1');
      });
      if (fallbackPortOk) break;
    } catch (e) {
      // 아직 안 떴거나 폴백 실패
    }
    await sleep(150);
  }

  if (!exited && !fallbackPortOk) {
    proc.kill('SIGKILL');
  }

  // 정리
  await new Promise((resolve) => blocker.close(resolve));
  if (!exited) {
    proc.kill('SIGKILL');
    await sleep(150);
  }

  // 평가 — 폴백 성공 우선 판정 (kill로 인한 exit code !== 0보다 fallbackPortOk가 우선)
  // 데드라인 도달 시 117번 줄에서 SIGKILL을 호출하면 exit code=null이 되어
  // 폴백 성공 케이스에서도 exitCode !== 0 분기에 잘못 진입하는 회귀를 방지한다.
  if (fallbackPortOk) {
    expect('Q1a. 포트 충돌 시 server.js가 죽지 않고 폴백', true, '3067로 폴백 성공');
    expect('Q1b. 폴백 포트 3067에 LISTENING', true);
  } else if (exited && exitCode !== 0) {
    expect(
      'Q1a. 포트 충돌 시 server.js가 죽지 않고 폴백',
      false,
      `프로세스가 exitCode=${exitCode}로 종료됨 — Plan D 폴백 실패. stderr 일부: ${stderr.slice(0, 200).replace(/\n/g, ' ')}`,
    );
    expect('Q1b. 폴백 포트 3067에 LISTENING', false, '인스턴스가 죽어서 폴백 불가');
  } else {
    expect(
      'Q1a. 포트 충돌 시 server.js가 죽지 않고 폴백',
      false,
      `프로세스는 살아있지만 3067에 LISTENING도 안됨 (예상치 못한 상태). stdout: ${stdout.slice(0, 300).replace(/\n/g, ' ')} | stderr: ${stderr.slice(0, 200).replace(/\n/g, ' ')}`,
    );
    expect('Q1b. 폴백 포트 3067에 LISTENING', false);
  }

  // 종료 정리
  proc.removeAllListeners();
  await sleep(250);
}

// ── Q2. start.bat / stop.bat 포트 범위 일치 검증 ─────────────────
function testBatchPortRange() {
  section('Q2. start.bat / stop.bat 정적 검증');

  const stop = fs.readFileSync(path.join(ROOT, 'stop.bat'), 'utf8');
  // stop.bat이 3000~3010 명시
  const ports = [3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010];
  const allInStop = ports.every((p) => stop.includes(String(p)));
  expect('Q2a. stop.bat 3000~3010 명시', allInStop);

  // stop.bat이 LISTENING 상태만 종료 (TIME_WAIT 보호)
  expect('Q2b. stop.bat이 LISTENING 상태만 종료', /LISTENING/.test(stop));

  // start.bat이 chcp 65001 사용 (UTF-8)
  const start = fs.readFileSync(path.join(ROOT, 'start.bat'), 'utf8');
  expect('Q2c. start.bat이 chcp 65001 사용 (UTF-8)', /chcp\s+65001/.test(start));

  // start.bat은 ASCII만 사용 (한글/특수문자 X) — Windows cmd 코드페이지 호환
  // (file 자체에는 영문만 있어야 함. 주석에 한글 있으면 안 됨)
  const nonAscii = start.split('').filter((c) => c.charCodeAt(0) > 127);
  expect(
    'Q2d. start.bat 본문이 ASCII-only (cmd 코드페이지 호환)',
    nonAscii.length === 0,
    `non-ASCII char count: ${nonAscii.length}`,
  );
  const stopNonAscii = stop.split('').filter((c) => c.charCodeAt(0) > 127);
  expect(
    'Q2e. stop.bat 본문이 ASCII-only',
    stopNonAscii.length === 0,
    `non-ASCII char count: ${stopNonAscii.length}`,
  );

  // server.js MAX_PORT_FALLBACK = 10 → 3000+10 = 3010. stop.bat 범위와 일치.
  const serverJs = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const maxFallback = /MAX_PORT_FALLBACK\s*=\s*(\d+)/.exec(serverJs);
  const fallbackVal = maxFallback ? parseInt(maxFallback[1], 10) : null;
  expect(
    'Q2f. server.js MAX_PORT_FALLBACK=10과 stop.bat 3000~3010 일치',
    fallbackVal === 10,
    `MAX_PORT_FALLBACK=${fallbackVal}`,
  );
}

// ── Q3. GAME_OVER 후 ITEM_GRANT 차단 ───────────────────────────
// Phase 3 LOW-2 (P5에서 검증된 lines>0 GARBAGE_RECV 차단)에 더해
// "lines=0 송신으로 GRANT만 시도해도 차단되는지" 확인. P5는 lines>0만 검증.
async function testGameOverGrantBlocked() {
  section('Q3. GAME_OVER 후 lines=0 GARBAGE_SEND → ITEM_GRANT 차단');

  const a = await openClient();
  const b = await openClient();
  await sleep(50);
  sendJson(a.ws, { type: 'JOIN', playerName: 'A' });
  sendJson(b.ws, { type: 'JOIN', playerName: 'B' });
  await sleep(100);
  sendJson(a.ws, { type: 'READY' });
  sendJson(b.ws, { type: 'READY' });
  await sleep(150);

  // A 게임오버
  sendJson(a.ws, { type: 'GAME_OVER' });
  await sleep(200);

  // A의 grant 횟수 베이스라인 기록
  const baselineGrants = a.got.filter((m) => m.type === 'ITEM_GRANT').length;

  // 게임오버 후 lines=0 송신 100회 → 단 1건도 GRANT 오면 안됨
  for (let i = 0; i < 100; i++) {
    sendJson(a.ws, { type: 'GARBAGE_SEND', lines: 0, combo: 0 });
  }
  await sleep(400);
  const afterGrants = a.got.filter((m) => m.type === 'ITEM_GRANT').length;

  expect(
    'Q3. GAME_OVER 후 lines=0 SEND도 GRANT 차단 (P5 보완)',
    afterGrants === baselineGrants,
    `baseline=${baselineGrants}, after=${afterGrants} (증분 ${afterGrants - baselineGrants})`,
  );

  a.ws.close();
  b.ws.close();
  await sleep(200);
}

// ── Q4. JOIN 전 GAME_OVER → 서버 안전성 ─────────────────────────
// READY/JOIN 전에 GAME_OVER를 보내도 서버가 안전하게 무시하는지.
// (player 객체는 connection 직후 생성되므로 정상이어야 하지만 회귀 보장 필요)
async function testEarlyGameOver() {
  section('Q4. JOIN 전 GAME_OVER → 서버 안전');

  const a = await openClient();
  await sleep(50);
  // JOIN 안 보냄, 바로 GAME_OVER
  sendJson(a.ws, { type: 'GAME_OVER' });
  await sleep(200);

  // 서버가 살아있다면 새 클라가 정상 연결 가능
  const b = await openClient();
  await sleep(50);
  sendJson(b.ws, { type: 'JOIN', playerName: 'B-after-early-go' });
  await sleep(150);

  const joined = b.got.find((m) => m.type === 'JOINED');
  expect('Q4. JOIN 전 GAME_OVER 후에도 서버가 살아있음 (JOINED 수신)', !!joined);

  a.ws.close();
  b.ws.close();
  await sleep(200);
}

// ── Q5. server.js HOST_URL 가상 어댑터 후순위 정렬 ──────────────
function testHostUrlPriority() {
  section('Q5. server.js HOST_URL 우선순위 정렬 (정적 검증)');

  const serverJs = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  // VIRTUAL_IF_PATTERNS에 vEthernet/VirtualBox/VMware/Hyper-V/WSL 포함
  expect('Q5a. vEthernet 가상 어댑터 패턴 포함', /vEthernet/.test(serverJs));
  expect('Q5b. WSL 가상 어댑터 패턴 포함', /WSL/.test(serverJs));
  // interfacePriority: Wi-Fi=0, Ethernet=1, 기타=2, 가상=9
  expect('Q5c. Wi-Fi 우선순위 0', /wi-?fi|wireless|wlan/i.test(serverJs));
  expect('Q5d. 가상 어댑터 후순위 9', /return\s+9/.test(serverJs));
  // HOST_URL fallback: LAN IP 미감지 시 localhost
  expect('Q5e. HOST_URL localhost fallback', /HOST_URL\s*=\s*`http:\/\/localhost/.test(serverJs));
}

// ── Q6. ui.js 클립보드 fallback ─────────────────────────────────
function testClipboardFallback() {
  section('Q6. ui.js copyToClipboard fallback 안전성 (정적 검증)');

  const uiJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'ui.js'), 'utf8');
  // 1) navigator.clipboard 우선 시도 + try/catch
  expect(
    'Q6a. navigator.clipboard.writeText 호출 + try/catch',
    /navigator\.clipboard.*writeText/s.test(uiJs) && /try\s*\{[\s\S]*?navigator\.clipboard/.test(uiJs),
  );
  // 2) execCommand fallback 존재
  expect('Q6b. document.execCommand("copy") fallback 존재', /execCommand\s*\(\s*['"]copy['"]/.test(uiJs));
  // 3) 폴백 토스트 ('복사 실패') 노출
  expect('Q6c. 복사 실패 토스트 메시지 존재', /복사\s*실패/.test(uiJs));
  // 4) 폴백 메시지(괄호로 시작)는 복사 차단
  expect('Q6d. 폴백 메시지(괄호 시작) 복사 차단', /url\.startsWith\(['"]\(['"]\)/.test(uiJs));
}

// ── Q7. 콘솔 박스 ASCII-only ───────────────────────────────────
function testConsoleBoxAscii() {
  section('Q7. 서버 콘솔 박스 출력 — ASCII 박스 문자 사용 (cmd 949 호환)');

  const serverJs = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  // printBanner 함수 안에서 '+' '-' '|' 만 사용 (유니코드 박스 문자 X)
  const printBannerMatch = serverJs.match(/function printBanner[\s\S]+?\n\}/);
  expect('Q7a. printBanner 함수 존재', !!printBannerMatch);
  if (printBannerMatch) {
    const body = printBannerMatch[0];
    // 유니코드 박스 문자(┌┐└┘─│등 U+2500~U+257F) 사용 여부 검사
    const boxChars = /[─-╿]/.test(body);
    expect(
      'Q7b. printBanner가 유니코드 박스 문자 미사용 (ASCII +/-/|만)',
      !boxChars,
      boxChars ? '유니코드 box drawing char 발견' : 'ASCII만 사용',
    );
  }
}

// ── 실행 ─────────────────────────────────────────────────────────
(async () => {
  console.log(`\n=== Phase 3+4 QA 능동 엣지케이스 (port ${PORT}) ===`);

  await testPortFallback();
  testBatchPortRange();
  await testGameOverGrantBlocked();
  await testEarlyGameOver();
  testHostUrlPriority();
  testClipboardFallback();
  testConsoleBoxAscii();

  console.log(`\n=== 결과: ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
