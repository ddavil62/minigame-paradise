/**
 * @fileoverview prepareMatch(런처 매치 번호) 회귀 테스트.
 *  - 옛 판에 남은 접속자는 새 매치 준비 시 정리되고 새 접속자와 섞이지 않는다.
 *  - 새 매치 번호가 없거나 다른 접속은 거절된다.
 *  - 진행 중인 판이 있으면 prepareMatch가 false를 돌려준다.
 *  - 서버가 관리하는 AI 요청 상태도 정리된다.
 * 격리 포트 3211.
 */
import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); } else { failed++; console.log(`  FAIL  ${label}`); }
}

const PORT = 3211;
const app = createApp({ testing: true, seed: 4242, duration: 60_000, getBotUrl: () => `ws://127.0.0.1:${PORT}/sichuan-battle/ws`, aiConfig: { spawn: false } });
const server = http.createServer((req, res) => app.handleHttp(req, res));
server.on('upgrade', (req, socket, head) => app.handleUpgrade(req, socket, head));
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

function connect(query) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/sichuan-battle/ws${query}`);
  const msgs = [];
  let closeCode = null;
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  ws.on('close', (code) => { closeCode = code; });
  return { ws, msgs, get closeCode() { return closeCode; } };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const M1 = 'match-aaaaaaaa';
const M2 = 'match-bbbbbbbb';

ok((() => { try { app.prepareMatch('bad id!'); return false; } catch { return true; } })(), '형식이 틀린 번호는 throw');

// 1. 첫 매치 준비 후 옛 접속자 한 명이 대기 화면에 남아 있다. AI도 요청해 둔다.
ok(app.prepareMatch(M1) === true, 'prepareMatch 첫 호출은 성공');
const ghost = connect(`?name=ghost&matchId=${M1}`);
await wait(150);
ok(ghost.msgs.some((m) => m.type === 'JOINED'), '매치 번호가 맞으면 입장');
ghost.ws.send(JSON.stringify({ type: 'REQUEST_AI' }));
await wait(100);
ok(ghost.msgs.some((m) => m.type === 'AI_REQUESTED'), 'AI 요청이 접수된다');

// 2. 새 매치 준비 → 유령 퇴출, AI 요청 상태 정리, 새 번호만 입장.
ok(app.prepareMatch(M2) === true, '진행 중인 판이 없으면 새 매치 준비 성공');
await wait(150);
ok(ghost.closeCode === 4001 && ghost.msgs.some((m) => m.code === 'match_replaced'), '옛 접속자는 match_replaced + 4001로 종료');
const stale = connect(`?name=stale&matchId=${M1}`);
const noId = connect('?name=none');
await wait(150);
ok(stale.closeCode === 4002 && noId.closeCode === 4002, '옛 번호·번호 없는 접속은 INVALID_MATCH(4002)');
ok(stale.msgs.some((m) => m.code === 'invalid_match'), 'invalid_match 오류 메시지 전달');
const a = connect(`?name=a&matchId=${M2}`);
await wait(150);
a.ws.send(JSON.stringify({ type: 'REQUEST_AI' }));
await wait(100);
ok(a.msgs.some((m) => m.type === 'AI_REQUESTED'), '옛 판의 AI 요청 상태가 정리되어 새 판에서 AI를 다시 요청할 수 있다');
const b = connect(`?name=b&matchId=${M2}`);
await wait(200);
const ja = a.msgs.find((m) => m.type === 'JOINED');
const jb = b.msgs.find((m) => m.type === 'JOINED');
ok(ja && jb && ja.playerId !== jb.playerId, '새 번호 두 명은 서로 만난다');
ok(!a.msgs.some((m) => m.type === 'CONNECTION_STATE') && !b.msgs.some((m) => m.code === 'ROOM_FULL'), '옛 연결의 종료가 새 접속자에게 영향을 주지 않는다');

// 3. 진행 중인 판은 거절.
for (const c of [a, b]) c.ws.send(JSON.stringify({ type: 'READY' }));
await wait(250);
ok(a.msgs.some((m) => m.type === 'START') && b.msgs.some((m) => m.type === 'START'), '두 명 READY로 경기 시작');
ok(app.prepareMatch('match-cccccccc') === false, '진행 중인 판이 있으면 prepareMatch는 false');
ok(a.closeCode === null && b.closeCode === null, '거절 시 진행 중인 접속자는 유지');
const lateOld = connect(`?name=late&matchId=${M2}`);
await wait(150);
ok(lateOld.msgs.some((m) => m.code === 'ROOM_FULL'), '거절 후에도 기존 매치 번호가 유지된다(정원 초과로만 거절)');

// 4. 사람이 모두 나가 결과 상태가 아니어도(연결 없음) 다시 준비 가능.
for (const c of [a, b]) c.ws.close();
await wait(200);
ok(app.prepareMatch('match-dddddddd') === true, '사람 연결이 없으면 새 매치 준비 성공');
const fresh = connect('?name=f&matchId=match-dddddddd');
await wait(150);
ok(fresh.msgs.some((m) => m.type === 'JOINED' && m.waiting === true), '리셋된 방에 새 번호로 대기 입장');

fresh.ws.close();
await wait(100);
app.close();
server.close();
console.log(`\n총 ${passed + failed}건, PASS=${passed}, FAIL=${failed}`);
process.exit(failed ? 1 : 0);
