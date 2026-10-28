/** @fileoverview 한 브라우저가 AI 동료를 추가해 실제 서버 운행을 시작하는 흐름을 검증한다. */
import { expect,test } from '@playwright/test';

test('AI와 혼자 시작하면 P2 봇이 이동하고 진단 상태가 노출된다',async({page})=>{
  test.setTimeout(20000);
  await page.goto('/?name=SoloPilot&role=p1');
  await expect(page.locator('#network-overlay')).toBeHidden();
  await page.locator('#solo').click();
  await expect(page.locator('#lobby')).toBeHidden();
  await expect(page.locator('#game')).toBeFocused();
  await expect.poll(()=>page.evaluate(()=>window.__kitchenState.snapshot.aiPlayers?.[0]?.playerId)).toBe('p2');
  const startX=await page.evaluate(()=>window.__kitchenState.snapshot.players.find(player=>player.id==='p2').x);
  await expect.poll(()=>page.evaluate(()=>window.__kitchenState.snapshot.players.find(player=>player.id==='p2').x),{timeout:8000}).not.toBe(startX);
  const ai=await page.evaluate(()=>window.__kitchenState.snapshot.aiPlayers[0]);
  expect(ai.targetId).toBeTruthy();expect(ai.goal.length).toBeGreaterThan(0);
  await page.screenshot({path:'tests/screenshots/solo-ai-playing-1280x720.png'});
  await page.locator('#launcher-button').click();await page.locator('#confirm-exit').click();
});
