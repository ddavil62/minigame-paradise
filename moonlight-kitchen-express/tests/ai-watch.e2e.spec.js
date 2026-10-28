/** @fileoverview 한 관전자가 서버 AI 둘의 자동 운행과 녹화용 HUD를 보는 흐름을 검증한다. */
import { expect,test } from '@playwright/test';

test('AI 대 AI 관전은 입력을 숨기고 두 AI의 작업 HUD를 Canvas에 표시한다',async({page})=>{
  test.setTimeout(20000);
  const errors=[];page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto('/?name=Observer&role=p1');
  await expect(page.locator('#network-overlay')).toBeHidden();
  await expect(page.locator('#watch-ai')).toHaveText('AI 대 AI 관전');
  await page.locator('#watch-ai').click();
  await expect(page.locator('body')).toHaveClass(/watch-mode/);
  await expect(page.locator('#lobby')).toBeHidden();
  await expect(page.locator('#first-order-coach')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>window.__kitchenState.snapshot.aiPlayers?.length)).toBe(2);
  await expect.poll(()=>page.evaluate(()=>window.__kitchenState.rendererPresentation().spectator)).toBe(true);
  const before=await page.evaluate(()=>window.__kitchenState.snapshot.players.map(player=>({id:player.id,x:player.x,y:player.y})));
  await expect.poll(()=>page.evaluate(previous=>window.__kitchenState.snapshot.players.some(player=>{const start=previous.find(entry=>entry.id===player.id);return Math.hypot(player.x-start.x,player.y-start.y)>12;}),before),{timeout:8000}).toBe(true);
  await page.screenshot({path:'tests/screenshots/ai-vs-ai-watch-1280x720.png'});
  expect(errors).toEqual([]);
  await page.locator('#launcher-button').click();await page.locator('#confirm-exit').click();
});
