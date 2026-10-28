import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('예상한 WebSocket 메시지를 받지 못했어요.');
}

test('로컬 관리 API가 실행 중인 서버의 스테이지를 리로드한다', async (t) => {
  let reloadCount = 0;
  const app = createApp({
    reloadCatalog() {
      reloadCount += 1;
      return { count: 11, defaultStageId: 'night-market-01', stageIds: ['night-market-01'] };
    },
  });
  const server = http.createServer(app.handleHttp);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/admin/reload-stages`, { method: 'POST' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true, count: 11, defaultStageId: 'night-market-01', stageIds: ['night-market-01'],
  });
  assert.equal(reloadCount, 1);

  const proxied = await fetch(`http://127.0.0.1:${port}/admin/reload-stages`, {
    method: 'POST', headers: { 'x-forwarded-for': '203.0.113.10' },
  });
  assert.equal(proxied.status, 403);
  assert.equal(reloadCount, 1);
});

test('새 매치를 준비할 때 게시 스테이지 카탈로그를 다시 읽는다', () => {
  let reloadCount = 0;
  const app = createApp({
    reloadCatalog() {
      reloadCount += 1;
      return { count: 25, defaultStageId: 'night-market-01', stageIds: ['night-market-01'] };
    },
  });

  assert.equal(app.prepareMatch('fresh-match-1234'), true);
  assert.equal(reloadCount, 1);
});

test('2인이 정답 발견 상태를 즉시 공유한다', async (t) => {
  const app = createApp();
  assert.equal(app.prepareMatch('test-match-1234'), true);
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const messages1 = [];
  const messages2 = [];
  const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws?matchId=test-match-1234&role=p1`);
  const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws?matchId=test-match-1234&role=p2`);
  ws1.on('message', (data) => messages1.push(JSON.parse(data.toString())));
  ws2.on('message', (data) => messages2.push(JSON.parse(data.toString())));
  t.after(() => {
    try { ws1.close(); } catch { /* noop */ }
    try { ws2.close(); } catch { /* noop */ }
    server.close();
  });

  await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);
  ws1.send(JSON.stringify({ type: 'JOIN', name: '하나' }));
  ws2.send(JSON.stringify({ type: 'JOIN', name: '둘' }));
  const selection1 = await waitFor(() => messages1.find((message) => message.type === 'STAGE_SELECTION' && message.players?.length === 2));
  const selection2 = await waitFor(() => messages2.find((message) => message.type === 'STAGE_SELECTION' && message.players?.length === 2));
  assert.equal(selection1.canSelect, true);
  assert.equal(selection2.canSelect, false);
  assert.equal(selection1.stages.length, 65);
  assert.deepEqual(selection1.ruleTypes.map((rule) => rule.type), ['speed', 'classic', 'relaxed']);
  assert.equal(selection1.selectedRuleType, 'classic');
  assert.equal(selection1.stages.some((stage) => stage.id === 'moonlit-clockwork-shop-01'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'moonlit-puppet-theater-01'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'starlit-desert-ruins-01'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'firefly-summer-camp-01'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'wonder-park-dream-gate-01'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'wonder-park-carousel-garden-02'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'wonder-park-candy-parade-03'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'wonder-park-moonboat-lagoon-04'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'goblin-night-moon-rabbit-mill-01'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'goblin-night-snack-stall-02'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'goblin-night-mask-workshop-03'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'goblin-night-moon-ferry-dock-04'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'cat-detective-moonlit-museum-02'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'magic-delivery-starlight-post-01'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'magic-delivery-dragon-peak-05'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'toy-kingdom-block-castle-01'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'toy-kingdom-windup-train-station-02'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'toy-kingdom-music-box-plaza-03'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'toy-kingdom-patchwork-dragon-bridge-04'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'toy-kingdom-star-crown-palace-05'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'dragon-academy-moon-observatory-04'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'dragon-academy-starlight-graduation-05'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'magic-delivery-broom-workshop-02'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'magic-delivery-cloud-airship-dock-03'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'magic-delivery-moonlit-canal-boat-04'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'cat-detective-foggy-platform-03'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'goblin-night-cloud-garden-05'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'tiny-things-teacup-harbor-01'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'tiny-things-planter-jungle-04'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'cat-detective-rainy-office-01'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'animal-detectives-museum-01'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'animal-detectives-snow-train-03'), true);
  assert.equal(selection1.stages.some((stage) => stage.id === 'animal-detectives-masquerade-04'), true);
  assert.equal(selection1.stages[0].id, 'night-market-01');

  ws2.send(JSON.stringify({ type: 'SELECT_STAGE', stageId: 'night-market-01' }));
  const selectionError = await waitFor(() => messages2.find((message) => message.type === 'ERROR' && message.message.includes('방장')));
  assert.equal(selectionError.message, '스테이지 선택은 방장만 할 수 있어요.');

  ws1.send(JSON.stringify({ type: 'SET_DIFFICULTY', ruleType: 'unknown' }));
  const ruleError = await waitFor(() => messages1.find((message) => message.type === 'ERROR' && message.message.includes('난이도')));
  assert.equal(ruleError.message, '올바른 난이도를 선택해 주세요.');

  ws1.send(JSON.stringify({ type: 'SET_DIFFICULTY', ruleType: 'relaxed' }));
  const easySelection1 = await waitFor(() => messages1.find((message) => message.type === 'STAGE_SELECTION' && message.selectedRuleType === 'relaxed'));
  const easySelection2 = await waitFor(() => messages2.find((message) => message.type === 'STAGE_SELECTION' && message.selectedRuleType === 'relaxed'));
  assert.equal(easySelection1.selectedRuleType, 'relaxed');
  assert.equal(easySelection2.selectedRuleType, 'relaxed');

  ws1.send(JSON.stringify({ type: 'SELECT_STAGE', stageId: 'night-market-01' }));
  const startedState = await waitFor(() => messages1.find((message) => message.type === 'STATE' && message.players?.length === 2));
  assert.equal(startedState.rule.type, 'relaxed');
  assert.equal(startedState.maxHints, 3);
  assert.ok(startedState.remainingMs > 118_000 && startedState.remainingMs <= 120_000);

  ws1.send(JSON.stringify({ type: 'CURSOR', image: 'b', x: 0.42, y: 0.61 }));
  const sharedCursor = await waitFor(() => messages2.find((message) => message.type === 'CURSOR'));
  assert.deepEqual(sharedCursor, { type: 'CURSOR', playerId: 'p1', image: 'b', x: 0.42, y: 0.61 });
  assert.equal(messages1.some((message) => message.type === 'CURSOR'), false);
  ws1.send(JSON.stringify({ type: 'CURSOR_LEAVE' }));
  const cursorLeave = await waitFor(() => messages2.find((message) => message.type === 'CURSOR_LEAVE'));
  assert.deepEqual(cursorLeave, { type: 'CURSOR_LEAVE', playerId: 'p1' });

  ws1.send(JSON.stringify({ type: 'GUESS', image: 'a', x: 0.08, y: 0.24 }));
  const feedback1 = await waitFor(() => messages1.find((message) => message.type === 'FEEDBACK' && message.kind === 'found'));
  const feedback2 = await waitFor(() => messages2.find((message) => message.type === 'FEEDBACK' && message.kind === 'found'));
  assert.equal(feedback1.playerId, 'p1');
  assert.deepEqual(feedback2, feedback1);
  const state1 = await waitFor(() => messages1.find((message) => message.type === 'STATE' && message.found?.length === 1));
  const state2 = await waitFor(() => messages2.find((message) => message.type === 'STATE' && message.found?.length === 1));
  assert.equal(state1.found[0].id, 'umbrella');
  assert.equal(state2.found[0].foundBy, 'p1');

  ws2.send(JSON.stringify({ type: 'GUESS', image: 'b', x: 0.5, y: 0.95 }));
  const miss1 = await waitFor(() => messages1.find((message) => message.type === 'FEEDBACK' && message.kind === 'miss'));
  const miss2 = await waitFor(() => messages2.find((message) => message.type === 'FEEDBACK' && message.kind === 'miss'));
  assert.deepEqual(miss1, { type: 'FEEDBACK', kind: 'miss', playerId: 'p2', image: 'b', x: 0.5, y: 0.95, difference: null });
  assert.deepEqual(miss2, miss1);
});
