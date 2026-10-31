/**
 * @fileoverview prepareMatch(런처 매치 번호) 회귀 테스트.
 *  - 옛 판에 남은 접속자는 새 매치 준비 시 정리되고 새 접속자와 섞이지 않는다.
 *  - 새 매치 번호가 없거나 다른 접속은 거절된다.
 *  - 진행 중인 판(플레이 중, 재접속 대기 포함)이 있으면 prepareMatch가 false를 돌려준다.
 *  - 서버 내부 AI 슬롯도 리셋된다.
 * 격리 포트 3213.
 */
import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); } else { failed++; console.log(`  FAIL  ${label}`); }
}

const PORT = 3213;
const app = createApp();
const server = http.createServer((req, res) => app.handleHttp(req, res));
server.on('upgrade', (req, socket, head) => app.handleUpgrade(req, socket, head));
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

function connect(query, { join = true, name = 'tester', readyFromLobby = false } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws${query}`);
  const msgs = [];
  let closeCode = null;
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  ws.on('close', (code) => { closeCode = code; });
  if (join) ws.on('open', () => ws.send(JSON.stringify({ type: 'JOIN', name, locale: 'ko', readyFromLobby })));
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

// 2. 첫 매치 준비 후 옛 접속자가 AI 슬롯과 함께 대기 화면에 남아 있다.
ok(app.prepareMatch(M1) === true, 'prepareMatch 첫 호출은 성공');
const ghost = connect(`?matchId=${M1}`, { name: 'ghost' });
await wait(200);
ok(ghost.msgs.some((m) => m.type === 'WELCOME'), '매치 번호가 맞으면 입장');
ghost.ws.send(JSON.stringify({ type: 'PLAY_AI_VS_AI' }));
await wait(100);
ok(lastPlayers(ghost).some((p) => p.isBot), '서버 내부 AI 슬롯이 방에 있다');
ok(app.getSimulation().phase === 'playing', 'AI 관전이 시작돼 플레이 중이다');
ok(app.prepareMatch(M2) === false, '사람 연결이 있는 플레이 중에는 prepareMatch가 false');
ghost.ws.close();
await wait(200);
ok(app.getSimulation().phase === 'paused', '옛 접속자가 끊기면 재접속 대기(paused)');
ok(app.prepareMatch(M2) === true, '열린 사람 연결이 없으면 재접속 대기 중이어도 새 매치 준비 성공(AI 슬롯 포함 리셋)');
ok(app.getSimulation().phase === 'waiting' && lastPlayers(ghost).length > 0, '방이 대기 상태로 리셋된다');

// 3. 대기 단계에 멈춘 옛 접속자는 새 매치 준비로 정리된다.
const ghost3 = connect(`?matchId=${M2}`, { name: 'ghost3' });
await wait(200);
ok(ghost3.msgs.some((m) => m.type === 'WELCOME'), '대기 화면에 멈춘 옛 접속자가 있다');
const M3 = 'match-ffffffff';
ok(app.prepareMatch(M3) === true, '진행 중인 판이 없으면(대기 화면) 새 매치 준비 성공');
await wait(200);
ok(ghost3.closeCode === 4001 && ghost3.msgs.some((m) => m.code === 'match_replaced'), '옛 접속자는 match_replaced + 4001로 종료');
const stale = connect(`?matchId=${M1}`);
const noId = connect('');
await wait(200);
ok(stale.closeCode === 4002 && noId.closeCode === 4002, '옛 번호·번호 없는 접속은 INVALID_MATCH(4002)');
ok(stale.msgs.some((m) => m.code === 'invalid_match'), 'invalid_match 오류 메시지 전달');
const a = connect(`?matchId=${M3}`, { name: 'a' });
await wait(200);
ok(lastPlayers(a).length === 1 && !lastPlayers(a).some((p) => p.isBot), '새 방에는 옛 접속자·AI 슬롯이 남아 있지 않다');
const b = connect(`?matchId=${M3}`, { name: 'b' });
await wait(250);
const wa = a.msgs.find((m) => m.type === 'WELCOME');
const wb = b.msgs.find((m) => m.type === 'WELCOME');
ok(wa && wb && wa.playerId !== wb.playerId, '새 번호 두 명은 서로 만난다');
ok(a.closeCode === null && !a.msgs.some((m) => m.type === 'PAUSED'), '옛 연결의 종료가 새 접속자에게 영향을 주지 않는다');

// 4. 진행 중인 판은 거절.
for (const c of [a, b]) c.ws.send(JSON.stringify({ type: 'READY' }));
await wait(300);
ok(a.msgs.some((m) => m.type === 'START') && b.msgs.some((m) => m.type === 'START'), '두 명 READY로 경기 시작');
ok(app.prepareMatch('match-cccccccc') === false, '진행 중인 판이 있으면 prepareMatch는 false');
ok(a.closeCode === null && b.closeCode === null, '거절 시 진행 중인 접속자는 유지');
const lateOld = connect(`?matchId=${M3}`);
await wait(200);
ok(lateOld.msgs.some((m) => m.code === 'SESSION_ACTIVE'), '거절 후에도 기존 매치 번호가 유지된다(진행 중이라 SESSION_ACTIVE로만 거절)');

// 5. 한 명이 끊겨 재접속을 기다리는 중에도(남은 한 명이 열려 있으면) 진행 중이다.
b.ws.close();
await wait(200);
ok(app.getSimulation().phase === 'paused', '한 명 이탈로 재접속 대기(paused)');
ok(app.prepareMatch('match-eeeeeeee') === false, '재접속 대기 중에도 prepareMatch는 false');

// 6. 남은 사람도 나가고 유예가 남아 있어도(열린 사람 연결 없음) 새 매치 준비 가능.
a.ws.close();
await wait(200);
ok(app.prepareMatch('match-dddddddd') === true, '열린 사람 연결이 없으면 새 매치 준비 성공');
const fresh = connect('?matchId=match-dddddddd', { name: 'f' });
await wait(250);
ok(fresh.msgs.some((m) => m.type === 'WELCOME') && app.getSimulation().phase === 'waiting', '리셋된 방에 새 번호로 대기 입장');

fresh.ws.close();
await wait(100);
app.close();
server.close();
console.log(`\n총 ${passed + failed}건, PASS=${passed}, FAIL=${failed}`);
process.exit(failed ? 1 : 0);
