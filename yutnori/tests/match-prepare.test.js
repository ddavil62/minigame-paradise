/**
 * @fileoverview prepareMatch(런처 매치 번호) 회귀 테스트.
 *  - 옛 판에 남은 접속자는 새 매치 준비 시 정리되고 새 접속자와 섞이지 않는다.
 *  - 새 매치 번호가 없는 접속은 거절된다 (거절된 접속은 방 정원을 건드리지 못한다).
 *  - prepareMatch가 첫 접속자의 ?players=N으로 고정된 정원을 초기화한다.
 *  - 봇(mode=bot)은 매치 번호 없이도 입장한다.
 *  - 진행 중인 판(started && !winner)이 있으면 prepareMatch가 false를 돌려준다.
 * 실행: node tests/match-prepare.test.js (격리 포트 3183)
 */
import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); } else { failed++; console.log(`  FAIL  ${label}`); }
}

const PORT = 3183;
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
const send = (c, p) => c.ws.send(JSON.stringify(p));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const full = (c) => c.msgs.some((m) => m.type === 'ERROR' && /full/i.test(m.message || ''));

const M1 = 'match-aaaaaaaa';
const M2 = 'match-bbbbbbbb';
const M3 = 'match-cccccccc';

try { app.prepareMatch('bad'); ok(false, '잘못된 번호는 throw'); } catch { ok(true, '잘못된 번호는 throw'); }

// 1. 첫 매치 준비 후, 3인 방(?players=3)을 연 옛 접속자가 남아 있다.
ok(app.prepareMatch(M1) === true, 'prepareMatch 첫 호출은 성공');
const ghost = connect(`?mode=human&players=3&matchId=${M1}`);
await wait(150);
send(ghost, { type: 'JOIN', playerName: 'ghost' });
await wait(100);
ok(ghost.msgs.some((m) => m.type === 'JOINED' && m.waiting === true), '번호가 맞으면 입장(정원 3이라 대기 중)');

// 2. 새 매치 준비 → 유령 퇴출, 정원 초기화, 새 번호만 입장.
ok(app.prepareMatch(M2) === true, '진행 중인 판이 없으면 새 매치 준비 성공');
await wait(150);
ok(ghost.closeCode === 4001, '옛 접속자는 MATCH_REPLACED(4001)로 종료');
const stale = connect(`?mode=human&players=4&matchId=${M1}`);
const noId = connect('?mode=human&players=4');
await wait(150);
ok(stale.closeCode === 4002 && noId.closeCode === 4002, '옛 번호·번호 없는 접속은 INVALID_MATCH(4002)');
const a = connect(`?mode=human&matchId=${M2}`);
await wait(100);
const b = connect(`?mode=human&matchId=${M2}`);
await wait(100);
const c3 = connect(`?mode=human&matchId=${M2}`);
await wait(150);
ok(full(c3), '정원은 2로 초기화되어 3번째 접속은 거절(옛 ?players=3/4가 남지 않음)');
for (const c of [a, b]) send(c, { type: 'JOIN', playerName: 'x' });
await wait(150);
const ja = a.msgs.find((m) => m.type === 'JOINED');
const jb = b.msgs.find((m) => m.type === 'JOINED');
ok(ja && jb && ja.playerId !== jb.playerId, '새 번호 두 명은 서로 만난다');
ok(!a.msgs.some((m) => m.type === 'OPPONENT_LEFT' || m.type === 'GAME_OVER'),
  '옛 연결의 종료가 새 접속자에게 영향을 주지 않는다');

// 3. 전원 READY → 진행 중이므로 거절.
for (const c of [a, b]) send(c, { type: 'READY' });
await wait(250);
ok(a.msgs.some((m) => m.type === 'START'), '게임 시작');
ok(app.prepareMatch(M3) === false, '진행 중인 판이 있으면 prepareMatch는 false');
await wait(100);
ok(a.closeCode === null && b.closeCode === null, '거절 시 진행 중인 접속자는 유지');
const intruder = connect(`?mode=human&matchId=${M1}`);
await wait(150);
ok(intruder.closeCode === 4002, '거절된 뒤에도 기존 번호(M2)만 유효');

// 4. 모두 나간 뒤 새 매치 + 봇은 번호 없이 입장.
for (const c of [a, b, c3]) c.ws.close();
await wait(200);
ok(app.prepareMatch(M3) === true, '모두 나간 뒤 새 매치 준비 성공');
const human = connect(`?mode=human&matchId=${M3}`);
await wait(100);
const bot = connect('?mode=bot');
await wait(200);
ok(bot.closeCode === null && !bot.msgs.some((m) => m.code === 'invalid_match') && !full(bot),
  '봇(mode=bot)은 매치 번호 없이 입장');

for (const c of [human, bot]) c.ws.close();
await wait(100);
server.close();
console.log(`\n총 ${passed + failed}건, PASS=${passed}, FAIL=${failed}`);
process.exit(failed ? 1 : 0);
