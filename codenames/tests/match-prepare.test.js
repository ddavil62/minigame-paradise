/**
 * @fileoverview prepareMatch(런처 매치 번호) 회귀 테스트 — 격리 포트 3158.
 *  - 옛 판(역할 선택 화면 등)에 남은 접속자는 새 매치 준비 시 정리되고 새 접속자와 섞이지 않는다.
 *  - 새 매치 번호가 없거나 옛 번호인 사람 접속은 거절된다.
 *  - AI 채우기 봇(mode=bot, 번호 없음)은 통과하고, prepareMatch 시 봇 프로세스·접속이 정리된다.
 *  - 진행 중(phase=playing + 사람 연결)이면 false, role_select는 진행 중이 아니다.
 * 봇은 getBotUrl 훅으로 실제 spawn 된다(딜레이 단축 환경변수 상속).
 */
process.env.CODENAMES_BOT_DELAY_MIN = '0';
process.env.CODENAMES_BOT_DELAY_RAND = '25';

import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); } else { failed++; console.log(`  FAIL  ${label}`); }
}

const PORT = 3158;
const app = createApp({ getBotUrl: () => `ws://127.0.0.1:${PORT}/ws?mode=bot` });
const server = http.createServer((req, res) => app.handleHttp(req, res));
server.on('upgrade', (req, socket, head) => app.handleUpgrade(req, socket, head));
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

function connect(query) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws${query}`);
  const msgs = [];
  let closeCode = null;
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  ws.on('close', (code) => { closeCode = code; });
  return {
    ws, msgs,
    get closeCode() { return closeCode; },
    get roleState() { return [...msgs].reverse().find((m) => m.type === 'ROLE_STATE') || null; },
  };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (c, m) => c.ws.send(JSON.stringify(m));
async function waitFor(fn, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await wait(50); }
  return false;
}

const M1 = 'match-aaaaaaaa';
const M2 = 'match-bbbbbbbb';
const M3 = 'match-cccccccc';
const M4 = 'match-dddddddd';
const M5 = 'match-eeeeeeee';

let invalidThrown = false;
try { app.prepareMatch('bad id!'); } catch (e) { invalidThrown = true; }
ok(invalidThrown, '형식이 잘못된 매치 번호는 throw');

// 1. 첫 매치 준비 후 옛 접속자 한 명이 역할 선택 화면에 남아 있다.
ok(app.prepareMatch(M1) === true, 'prepareMatch 첫 호출은 성공');
const ghost = connect(`?mode=human&matchId=${M1}`);
await wait(150);
send(ghost, { type: 'JOIN', name: 'ghost' });
send(ghost, { type: 'PICK_ROLE', team: 'red', role: 'spymaster' });
ok(await waitFor(() => ghost.roleState && ghost.roleState.players.length === 1), '매치 번호가 맞으면 입장');

// 2. 새 매치 준비 → 유령 퇴출, 새 번호만 입장.
ok(app.prepareMatch(M2) === true, 'role_select는 진행 중이 아니므로 새 매치 준비 성공');
await wait(150);
ok(ghost.closeCode === 4001, '옛 접속자는 MATCH_REPLACED(4001)로 종료');
ok(ghost.msgs.some((m) => m.code === 'match_replaced'), '옛 접속자에게 match_replaced 오류 전달');
const stale = connect(`?mode=human&matchId=${M1}`);
const noId = connect('?mode=human');
await wait(200);
ok(stale.closeCode === 4002 && noId.closeCode === 4002, '옛 번호·번호 없는 접속은 INVALID_MATCH(4002)');

// 3. AI 채우기: 사람(mode=ai, 새 번호) 1명 + 봇 3명(번호 없음)이 같은 방에서 만난다.
const human = connect(`?mode=ai&matchId=${M2}`);
await wait(150);
send(human, { type: 'JOIN', name: 'H' });
send(human, { type: 'PICK_ROLE', team: 'blue', role: 'operative' });
ok(await waitFor(() => {
  const rs = human.roleState;
  return rs && rs.players.length === 4 && rs.players.filter((p) => p.isBot).length === 3 && rs.canStart;
}), '새 번호 사람 1명 + 번호 없는 봇 3명이 한 방에 채워진다(봇 통과)');
ok(human.roleState && human.roleState.players.every((p) => p.name !== 'ghost'), '옛 접속자 흔적이 방에 없다');
ok(human.closeCode === null && !human.msgs.some((m) => m.type === 'OPPONENT_LEFT'),
  '옛 연결의 종료가 새 접속자에게 영향을 주지 않는다');

// 4. 진행 중인 판은 거절.
send(human, { type: 'START_GAME' });
ok(await waitFor(() => human.msgs.some((m) => m.type === 'GAME_START')), '호스트 START_GAME으로 게임 시작');
ok(app.prepareMatch(M3) === false, '진행 중인 판이 있으면 prepareMatch는 false');
await wait(150);
ok(human.closeCode === null, '거절 시 진행 중인 접속자는 유지');
const late = connect(`?mode=human&matchId=${M2}`);
await wait(200);
ok(late.closeCode !== 4002 && late.msgs.some((m) => m.message && /가득/.test(m.message)),
  '거절 후에도 기존 매치 번호 M2가 유지된다(정원 초과 오류, invalid_match 아님)');
human.ws.close();
await wait(300);

// 5. 사람이 나가면 방이 초기화되어 새 매치 준비 성공.
ok(app.prepareMatch(M3) === true, '사람이 나가 판이 끝나면 새 매치 준비 성공');

// 6. role_select에서 AI 채우기 진행 중(봇 spawn 일부 예약 중) prepareMatch → 봇 정리 + 접속 퇴출, 봇이 되살아나지 않는다.
const human2 = connect(`?mode=ai&matchId=${M3}`);
await wait(150);
send(human2, { type: 'JOIN', name: 'H2' });
send(human2, { type: 'PICK_ROLE', team: 'blue', role: 'operative' });
await wait(260); // 첫 봇은 spawn되었고 나머지 슬롯은 150ms 간격 spawn 예약 중인 시점.
ok(app.prepareMatch(M4) === true, '역할 선택 단계(봇 포함)는 진행 중이 아니므로 prepareMatch 성공');
await wait(300);
ok(human2.closeCode === 4001, '사람과 봇 포함 전원이 MATCH_REPLACED로 종료(사람 확인)');
await wait(1200); // 이미 예약된 봇 spawn이 있었다면 이 사이에 나타난다.
const fresh = connect(`?mode=human&matchId=${M4}`);
await wait(150);
send(fresh, { type: 'JOIN', name: 'F' });
await wait(1200);
ok(fresh.roleState && fresh.roleState.players.length === 1 && fresh.roleState.players[0].name === 'F',
  '정리된 봇이 되살아나 새 방에 섞이지 않는다');
ok(fresh.roleState && fresh.roleState.players[0].isHost === true, '새 접속자가 호스트가 된다');

// 7. 자기 이름 없는 단독 사람 재교체도 가능.
ok(app.prepareMatch(M5) === true, '대기 중인 방도 다시 교체 가능');
await wait(150);
ok(fresh.closeCode === 4001, '그 접속자도 MATCH_REPLACED로 종료');

server.close();
console.log(`\n총 ${passed + failed}건, PASS=${passed}, FAIL=${failed}`);
process.exit(failed ? 1 : 0);
