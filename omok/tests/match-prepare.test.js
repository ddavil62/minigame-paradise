/**
 * @fileoverview prepareMatch(런처 매치 번호) 회귀 테스트.
 *  - 옛 판에 남은 접속자는 새 매치 준비 시 정리되고 새 접속자와 섞이지 않는다.
 *  - 새 매치 번호가 없는 접속은 거절된다.
 *  - 진행 중인 판이 있으면 prepareMatch가 false를 돌려준다.
 * 격리 포트 3108.
 */
import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); } else { failed++; console.log(`  FAIL  ${label}`); }
}

const PORT = 3108;
const app = createApp();
const server = http.createServer((req, res) => app.handleHttp(req, res));
server.on('upgrade', (req, socket, head) => app.handleUpgrade(req, socket, head));
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

function connect(query) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws${query}`);
  const msgs = [];
  let closeCode = null;
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  ws.on('close', (code) => { closeCode = code; });
  return { ws, msgs, get closeCode() { return closeCode; } };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const M1 = 'match-aaaaaaaa';
const M2 = 'match-bbbbbbbb';

// 1. 첫 매치 준비 후 옛 접속자 한 명이 남아 있다.
ok(app.prepareMatch(M1) === true, 'prepareMatch 첫 호출은 성공');
const ghost = connect(`?mode=human&matchId=${M1}`);
await wait(150);
ok(ghost.msgs.some((m) => m.type === 'JOINED'), '매치 번호가 맞으면 입장');

// 2. 새 매치 준비 → 유령 퇴출, 새 번호만 입장.
ok(app.prepareMatch(M2) === true, '진행 중인 판이 없으면 새 매치 준비 성공');
await wait(150);
ok(ghost.closeCode === 4001, '옛 접속자는 MATCH_REPLACED(4001)로 종료');
const stale = connect(`?mode=human&matchId=${M1}`);
const noId = connect('?mode=human');
await wait(150);
ok(stale.closeCode === 4002 && noId.closeCode === 4002, '옛 번호·번호 없는 접속은 INVALID_MATCH(4002)');
const a = connect(`?mode=human&matchId=${M2}`);
const b = connect(`?mode=human&matchId=${M2}`);
await wait(200);
const ja = a.msgs.find((m) => m.type === 'JOINED');
const jb = b.msgs.find((m) => m.type === 'JOINED');
ok(ja && jb && ja.playerId !== jb.playerId, '새 번호 두 명은 서로 만난다');
ok(!a.msgs.some((m) => m.type === 'OPPONENT_LEFT'), '옛 연결의 종료가 새 접속자에게 영향을 주지 않는다');

// 3. 진행 중인 판은 거절.
for (const c of [a, b]) c.ws.send(JSON.stringify({ type: 'JOIN', name: 'x' }));
for (const c of [a, b]) c.ws.send(JSON.stringify({ type: 'READY' }));
await wait(250);
ok(app.prepareMatch('match-cccccccc') === false, '진행 중인 판이 있으면 prepareMatch는 false');
ok(a.closeCode === null && b.closeCode === null, '거절 시 진행 중인 접속자는 유지');

for (const c of [a, b]) c.ws.close();
await wait(100);
server.close();
console.log(`\n총 ${passed + failed}건, PASS=${passed}, FAIL=${failed}`);
process.exit(failed ? 1 : 0);
