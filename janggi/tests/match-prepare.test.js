/**
 * @fileoverview prepareMatch(런처 매치 번호) 회귀 테스트.
 *  - 옛 판에 남은 접속자는 새 매치 준비 시 정리되고 새 접속자와 섞이지 않는다.
 *  - 새 매치 번호가 없는 접속은 거절된다 (진행하던 판의 빈 진영 재접속 경로 포함).
 *  - 봇(mode=bot)은 매치 번호 없이도 입장한다.
 *  - 진행 중인 판(playing)이 있으면 prepareMatch가 false를 돌려준다.
 * 실행: node tests/match-prepare.test.js (격리 포트 3181)
 */
import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); } else { failed++; console.log(`  FAIL  ${label}`); }
}

const PORT = 3181;
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

const M1 = 'match-aaaaaaaa';
const M2 = 'match-bbbbbbbb';
const M3 = 'match-cccccccc';

try { app.prepareMatch('bad'); ok(false, '잘못된 번호는 throw'); } catch { ok(true, '잘못된 번호는 throw'); }

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
ok(ja && jb && ja.playerId !== jb.playerId && ja.side !== jb.side, '새 번호 두 명은 서로 만난다(진영 분리)');
ok(!a.msgs.some((m) => m.type === 'OPPONENT_LEFT'), '옛 연결의 종료가 새 접속자에게 영향을 주지 않는다');

// 3. 배치 선택 중(아직 playing 아님)은 진행 중이 아니다 → 교체 가능.
for (const c of [a, b]) send(c, { type: 'JOIN', name: 'x' });
for (const c of [a, b]) send(c, { type: 'READY' });
await wait(200);
ok(a.msgs.some((m) => m.type === 'GAME_START' && m.phase === 'setup_cho'), '배치 선택 단계 진입');
ok(app.prepareMatch(M3) === true, '배치 선택 단계는 진행 중이 아니므로 교체 가능');
await wait(150);
ok(a.closeCode === 4001 && b.closeCode === 4001, '배치 선택 중이던 접속자도 퇴출');

// 4. 새 번호 두 명이 플레이 단계까지 진행 → 진행 중인 판은 거절.
const c1 = connect(`?mode=human&matchId=${M3}`);
const c2 = connect(`?mode=human&matchId=${M3}`);
await wait(200);
for (const c of [c1, c2]) send(c, { type: 'JOIN', name: 'y' });
for (const c of [c1, c2]) send(c, { type: 'READY' });
await wait(200);
// 초(p2=c2)가 먼저, 이어서 한(p1=c1)이 배치를 고른다.
send(c2, { type: 'SELECT_SETUP', setup: 'MSMS' });
await wait(100);
send(c1, { type: 'SELECT_SETUP', setup: 'MSMS' });
await wait(200);
ok(c1.msgs.some((m) => m.type === 'GAME_START' && m.phase === 'playing'), '플레이 단계 진입');
ok(app.prepareMatch('match-dddddddd') === false, '진행 중인 판이 있으면 prepareMatch는 false');
ok(c1.closeCode === null && c2.closeCode === null, '거절 시 진행 중인 접속자는 유지');

// 5. 진행 중 한 명이 나가 빈 진영이 생겨도 번호 없는/다른 번호 접속은 끼어들 수 없다.
c2.ws.close();
await wait(200);
const intruderNoId = connect('?mode=human');
const intruderOld = connect(`?mode=human&matchId=${M2}`);
await wait(150);
ok(intruderNoId.closeCode === 4002 && intruderOld.closeCode === 4002, '빈 진영으로 번호 없는/옛 번호 접속은 거절');
const rejoin = connect(`?mode=human&matchId=${M3}`);
await wait(150);
ok(rejoin.msgs.some((m) => m.type === 'JOINED' && m.side === 'cho'), '같은 번호의 재접속은 빈 진영으로 복귀');

// 6. 봇은 번호 없이 입장 가능. (마지막 사람이 나가 판이 끝난 뒤 새 매치로)
for (const c of [c1, rejoin]) c.ws.close();
await wait(200);
ok(app.prepareMatch('match-eeeeeeee') === true, '모두 나간 뒤 새 매치 준비 성공');
const human = connect('?mode=human&matchId=match-eeeeeeee');
await wait(100);
const bot = connect('?mode=bot');
await wait(200);
ok(bot.msgs.some((m) => m.type === 'JOINED') && bot.closeCode === null, '봇(mode=bot)은 매치 번호 없이 입장');
ok(human.msgs.filter((m) => m.type === 'JOINED').some((m) => m.opponentName === 'AI'), '사람에게 상대 AI 알림');

for (const c of [human, bot]) c.ws.close();
await wait(100);
server.close();
console.log(`\n총 ${passed + failed}건, PASS=${passed}, FAIL=${failed}`);
process.exit(failed ? 1 : 0);
