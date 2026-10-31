/**
 * @fileoverview prepareMatch(런처 매치 번호) 회귀 테스트.
 *  - 옛 판에 남은 접속자는 새 매치 준비 시 정리되고 새 접속자와 섞이지 않는다.
 *  - 새 매치 번호가 없거나 다른 접속은 거절되고, 서버가 띄운 봇(mode=bot)은 번호 없이 통과한다.
 *  - 진행 중인 판이 있으면 prepareMatch가 false를 돌려준다.
 *  - 서버가 띄운 봇 프로세스도 정리된다.
 * 격리 포트 3212.
 */
import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); } else { failed++; console.log(`  FAIL  ${label}`); }
}

const PORT = 3212;
const app = createApp({ testing: true, getBotUrl: () => `ws://127.0.0.1:${PORT}/ws?mode=bot` });
const server = http.createServer((req, res) => app.handleHttp(req, res));
server.on('upgrade', (req, socket, head) => app.handleUpgrade(req, socket, head));
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

function connect(query, { join = true, name = 'tester', readyFromLobby = false } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws${query}`);
  const msgs = [];
  let closeCode = null;
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  ws.on('close', (code) => { closeCode = code; });
  if (join) ws.on('open', () => ws.send(JSON.stringify({ type: 'JOIN', name, sessionToken: '', locale: 'ko', readyFromLobby })));
  return { ws, msgs, get closeCode() { return closeCode; } };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const lastPlayers = (c) => [...c.msgs].reverse().find((m) => m.type === 'READY_STATE')?.players ?? [];

const M1 = 'match-aaaaaaaa';
const M2 = 'match-bbbbbbbb';

ok((() => { try { app.prepareMatch('bad id!'); return false; } catch { return true; } })(), '형식이 틀린 번호는 throw');

// 1. 단독 실행(번호 미준비)은 번호 없이 입장한다.
const solo = connect('', { name: 'solo' });
await wait(200);
ok(solo.msgs.some((m) => m.type === 'WELCOME'), '번호를 준비하기 전에는 번호 없이도 입장');
solo.ws.close();
await wait(150);

// 2. 첫 매치 준비 후 옛 접속자 한 명이 대기 화면에 남아 있다. 봇도 같이 띄운다(mode=ai).
ok(app.prepareMatch(M1) === true, 'prepareMatch 첫 호출은 성공');
const ghost = connect(`?mode=ai&matchId=${M1}`, { name: 'ghost' });
await wait(2500);
ok(ghost.msgs.some((m) => m.type === 'WELCOME'), '매치 번호가 맞으면 입장');
ok(lastPlayers(ghost).length === 2, '서버가 띄운 봇은 번호 없이 통과해 같은 방에 들어온다');

// 3. 새 매치 준비 → 유령·봇 퇴출, 새 번호만 입장.
ok(app.prepareMatch(M2) === true, '진행 중인 판이 없으면(대기 화면) 새 매치 준비 성공');
await wait(200);
ok(ghost.closeCode === 4001 && ghost.msgs.some((m) => m.code === 'match_replaced'), '옛 접속자는 match_replaced + 4001로 종료');
const stale = connect(`?mode=human&matchId=${M1}`);
const noId = connect('?mode=human');
const staleAi = connect(`?mode=ai&fresh=1&matchId=${M1}`);
await wait(300);
ok(stale.closeCode === 4002 && noId.closeCode === 4002 && staleAi.closeCode === 4002, '옛 번호·번호 없는 접속은 INVALID_MATCH(4002)');
ok(stale.msgs.some((m) => m.code === 'invalid_match'), 'invalid_match 오류 메시지 전달');
const a = connect(`?mode=human&matchId=${M2}`, { name: 'a' });
await wait(200);
ok(lastPlayers(a).length === 1, '새 방에는 옛 접속자·봇이 남아 있지 않다(봇 프로세스 정리)');
const b = connect(`?mode=human&matchId=${M2}`, { name: 'b' });
await wait(300);
const wa = a.msgs.find((m) => m.type === 'WELCOME');
const wb = b.msgs.find((m) => m.type === 'WELCOME');
ok(wa && wb && wa.playerId !== wb.playerId, '새 번호 두 명은 서로 만난다');
ok(!a.msgs.some((m) => m.type === 'PAUSED') && a.closeCode === null, '옛 연결의 종료가 새 접속자에게 영향을 주지 않는다');

// 4. 진행 중인 판은 거절.
for (const c of [a, b]) c.ws.send(JSON.stringify({ type: 'READY' }));
await wait(300);
ok(a.msgs.some((m) => m.type === 'START') && b.msgs.some((m) => m.type === 'START'), '두 명 READY로 경기 시작');
ok(app.prepareMatch('match-cccccccc') === false, '진행 중인 판이 있으면 prepareMatch는 false');
ok(a.closeCode === null && b.closeCode === null, '거절 시 진행 중인 접속자는 유지');
const lateOld = connect(`?mode=human&matchId=${M2}`);
await wait(200);
ok(lateOld.msgs.some((m) => m.code === 'ROOM_FULL'), '거절 후에도 기존 매치 번호가 유지된다(정원 초과로만 거절)');

// 5. 결과 화면(진행 중 아님)에서는 다시 준비할 수 있다.
for (let i = 0; i < 8; i++) { await fetch(`http://127.0.0.1:${PORT}/__test/advance`, { method: 'POST' }); await wait(100); }
await fetch(`http://127.0.0.1:${PORT}/__test/finish`, { method: 'POST' });
await wait(3500);
ok(app.getSimulation().phase === 'result', '테스트 종료 트리거로 결과 화면 진입');
ok(app.prepareMatch('match-dddddddd') === true, '결과 화면에서는 새 매치 준비 성공');
await wait(200);
ok(a.closeCode === 4001 && b.closeCode === 4001, '결과 화면에 남은 접속자도 4001로 퇴출');
const fresh = connect('?mode=human&matchId=match-dddddddd', { name: 'f' });
await wait(250);
ok(fresh.msgs.some((m) => m.type === 'WELCOME') && app.getSimulation().phase === 'waiting', '리셋된 방에 새 번호로 대기 입장');

fresh.ws.close();
await wait(100);
app.close();
server.close();
console.log(`\n총 ${passed + failed}건, PASS=${passed}, FAIL=${failed}`);
process.exit(failed ? 1 : 0);
