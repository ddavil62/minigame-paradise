/**
 * @fileoverview 바닥 조커 → 선공자 자동 획득 smoke (2026-06-03 룰 정정).
 *
 * 작업용 서버(포트 3098)에 두 클라이언트로 접속 → GAME_START 후 STATE에서
 *   - floor에 조커가 없는지
 *   - 카드 총합 50장 (hand 10+10 + floor + deck 22 + captured)
 *   - 바닥에 조커가 있던 라운드라면 선공자(p1) captured에 조커가 들어 있는지
 * 셔플로 인해 비결정적이지만 여러 라운드 시도하여 최소 1회 조커 케이스를 본다.
 */
import { WebSocket } from 'ws';

const PORT = parseInt(process.argv[2] || '3098', 10);
const URL = `ws://127.0.0.1:${PORT}/ws?mode=human`;

function open() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function recvUntil(ws, predicate, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error('timeout waiting for message'));
    }, timeout);
    function handler(data) {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (predicate(msg)) {
        clearTimeout(t);
        ws.off('message', handler);
        resolve(msg);
      }
    }
    ws.on('message', handler);
  });
}

function send(ws, obj) { ws.send(JSON.stringify(obj)); }

let passed = 0;
let failed = 0;
const log = (s) => console.log(s);

async function runOnce(attempt) {
  const p1 = await open();
  const p2 = await open();
  // 양쪽 다 JOINED + GAME_START + 첫 STATE 받을 때까지 대기
  const [s1, s2] = await Promise.all([
    recvUntil(p1, (m) => m.type === 'STATE' && m.you === 'p1'),
    recvUntil(p2, (m) => m.type === 'STATE' && m.you === 'p2'),
  ]);
  // 검증 (p1 시점에서 floor/captured 양쪽 모두 보임)
  const handP1 = s1.yourHand.length;
  const handP2 = s2.yourHand.length;
  const floor = s1.floor.length;
  const deck = s1.deckCount;
  const capP1 = s1.captured.p1.length;
  const capP2 = s1.captured.p2.length;
  const total = handP1 + handP2 + floor + deck + capP1 + capP2;
  const floorHasJoker = s1.floor.some((c) => c.type === 'joker');

  const issues = [];
  if (total !== 50) issues.push(`total=${total} (≠50)`);
  if (floorHasJoker) issues.push('floor에 조커 잔존');
  if (capP2 > 0) issues.push(`p2 captured ${capP2}장 (선공 p1이어야 함)`);
  if (capP1 > 0 && !s1.captured.p1.every((c) => c.type === 'joker')) issues.push('p1 captured에 조커 외 카드');

  p1.close(); p2.close();
  // 서버가 close 처리할 시간 — players 배열에서 제거되도록
  await new Promise((r) => setTimeout(r, 250));

  if (issues.length === 0) {
    passed++;
    log(`  PASS  attempt#${attempt} — floor=${floor}, cap.p1=${capP1}(${s1.captured.p1.map((c)=>c.id).join(',')||'-'}), total=50`);
  } else {
    failed++;
    log(`  FAIL  attempt#${attempt} — ${issues.join(' / ')}`);
  }
  return { capP1, floor, hadJoker: capP1 > 0 };
}

(async () => {
  log('');
  log(`바닥 조커 자동 획득 smoke (포트 ${PORT})`);
  log('─'.repeat(60));
  let anyJokerSeen = false;
  // 5회 시도 — 셔플로 인해 조커가 바닥에 안 떨어지는 라운드도 있을 수 있다.
  for (let i = 1; i <= 5; i++) {
    const r = await runOnce(i);
    if (r.hadJoker) anyJokerSeen = true;
  }
  log('─'.repeat(60));
  log(`Result: ${passed} passed, ${failed} failed`);
  if (anyJokerSeen) log('NOTE: 조커 자동 획득 사례 ≥1회 관찰됨 (통합 동작 확인).');
  else log('NOTE: 5회 모두 바닥에 조커 없음 — 결정적 검증은 단위 테스트가 담당.');
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('smoke error:', e);
  process.exit(1);
});
