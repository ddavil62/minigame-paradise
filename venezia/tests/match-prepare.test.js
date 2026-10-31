/**
 * @fileoverview prepareMatch(런처 매치 번호) 회귀 테스트.
 *  - 옛 판에 남은 접속자는 새 매치 준비 시 정리되고 새 접속자와 섞이지 않는다.
 *  - 새 매치 번호가 없는 접속은 거절되고, 봇(mode=bot)은 번호 없이 통과한다.
 *  - 진행 중인 판(playing)이 있으면 prepareMatch가 false를 돌려준다.
 * 격리 포트 3110. 실행: node tests/match-prepare.test.js
 */
import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); } else { failed++; console.log(`  FAIL  ${label}`); }
}

const PORT = 3110;
const app = createApp();
const server = http.createServer((req, res) => app.handleHttp(req, res));
server.on('upgrade', (req, socket, head) => app.handleUpgrade(req, socket, head));
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(PORT, '127.0.0.1', resolve);
});

function connect(query) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws${query}`);
  const msgs = [];
  let closeCode = null;
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  ws.on('close', (code) => { closeCode = code; });
  ws.on('error', () => {});
  return { ws, msgs, get closeCode() { return closeCode; } };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const M1 = 'match-aaaaaaaa';
const M2 = 'match-bbbbbbbb';

// 0. 잘못된 번호 형식은 예외.
let threw = false;
try { app.prepareMatch('x'); } catch { threw = true; }
ok(threw, '형식이 잘못된 matchId는 예외');

// 1. 첫 매치 준비 후 옛 접속자 한 명이 남아 있다.
ok(app.prepareMatch(M1) === true, 'prepareMatch 첫 호출은 성공');
const ghost = connect(`?mode=human&matchId=${M1}`);
await wait(150);
ok(ghost.msgs.some((m) => m.type === 'JOINED'), '매치 번호가 맞으면 입장');

// 2. 새 매치 준비 -> 유령 퇴출, 새 번호만 입장.
ok(app.prepareMatch(M2) === true, '진행 중인 판이 없으면 새 매치 준비 성공');
await wait(150);
ok(ghost.closeCode === 4001, '옛 접속자는 MATCH_REPLACED(4001)로 종료');
ok(ghost.msgs.some((m) => m.type === 'ERROR' && m.code === 'match_replaced'), '옛 접속자에게 match_replaced 안내');
const stale = connect(`?mode=human&matchId=${M1}`);
const noId = connect('?mode=human');
await wait(150);
ok(stale.closeCode === 4002 && noId.closeCode === 4002, '옛 번호·번호 없는 접속은 INVALID_MATCH(4002)');
ok(stale.msgs.some((m) => m.code === 'invalid_match'), 'invalid_match 오류 코드 전달');
const a = connect(`?mode=human&matchId=${M2}`);
const b = connect(`?mode=human&matchId=${M2}`);
await wait(200);
const ja = a.msgs.find((m) => m.type === 'JOINED');
const jb = b.msgs.find((m) => m.type === 'JOINED');
ok(ja && jb && ja.playerId !== jb.playerId, '새 번호 두 명은 서로 만난다');
ok(!a.msgs.some((m) => m.type === 'OPPONENT_LEFT') && !b.msgs.some((m) => m.type === 'OPPONENT_LEFT'),
  '옛 연결의 종료가 새 접속자에게 영향을 주지 않는다');

// 3. 진행 중인 판은 거절.
a.ws.send(JSON.stringify({ type: 'JOIN', playerName: 'A' }));
b.ws.send(JSON.stringify({ type: 'JOIN', playerName: 'B' }));
await wait(300);
ok(a.msgs.some((m) => m.type === 'GAME_START'), '두 명 JOIN으로 판 시작');
ok(app.prepareMatch('match-cccccccc') === false, '진행 중인 판이 있으면 prepareMatch는 false');
ok(a.closeCode === null && b.closeCode === null, '거절 시 진행 중인 접속자는 유지');
const afterReject = connect(`?mode=human&matchId=${M2}`);
await wait(150);
ok(afterReject.closeCode !== null && afterReject.msgs.some((m) => m.type === 'ERROR'),
  '거절된 prepareMatch는 기대 번호를 바꾸지 않는다(M2 유지, 정원 초과로 거절)');

// 4. 판이 끝나(접속 종료) 비면 다시 준비 가능, 봇은 번호 없이 통과.
for (const c of [a, b]) c.ws.close();
await wait(200);
ok(app.prepareMatch('match-dddddddd') === true, '접속자가 없으면 다시 준비 가능');
const human = connect('?mode=human&matchId=match-dddddddd');
const bot = connect('?mode=bot');
await wait(200);
ok(bot.closeCode === null && bot.msgs.some((m) => m.type === 'JOINED'), '봇(mode=bot)은 매치 번호 없이 입장');
ok(human.closeCode === null, '사람은 번호가 맞으면 유지');

for (const c of [human, bot]) c.ws.close();
await wait(150);
server.close();
console.log(`\n총 ${passed + failed}건, PASS=${passed}, FAIL=${failed}`);
process.exit(failed ? 1 : 0);
