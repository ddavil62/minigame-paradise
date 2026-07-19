/** @fileoverview 브라우저에서 atlas 디코딩과 부분 실패 시 Canvas 폴백 지속을 검증한다. */
import { expect,test } from '@playwright/test';

test('세 runtime atlas가 디코딩되고 필수 frame을 조회할 수 있다',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await expect.poll(()=>page.evaluate(()=>window.__kitchenAssets?.ready)).toBe(true);
  const result=await page.evaluate(()=>({
    failed:window.__kitchenAssets.failedKeys,
    item:Boolean(window.__kitchenAssets.getFrame('item.moon_mushroom.RAW')),
    station:Boolean(window.__kitchenAssets.getFrame('station.brazier')),
    crew:Boolean(window.__kitchenAssets.getFrame('crew.p2.left')),
  }));
  expect(result).toEqual({failed:[],item:true,station:true,crew:true});
  expect(errors).toEqual([]);
});

test('한 atlas 404는 성공한 시트와 게임 렌더를 막지 않는다',async({page})=>{
  await page.route('**/fallback-atlas.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({
    version:1,
    images:{items:'./assets/sprites/moonlight-items.webp',crew:'./missing-crew.webp'},
    frames:{
      'item.moon_mushroom.RAW':{image:'items',x:0,y:0,w:128,h:128},
      'crew.p1.down':{image:'crew',x:0,y:0,w:128,h:160},
    },
  })}));
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {createKitchenAssets}=await import('./js/assets.js');
    const store=createKitchenAssets('./fallback-atlas.json');
    await store.load();
    return {ready:store.ready,failed:store.failedKeys,item:Boolean(store.getFrame('item.moon_mushroom.RAW')),crew:store.getFrame('crew.p1.down')};
  });
  expect(result.ready).toBe(true);
  expect(result.failed).toEqual(['crew']);
  expect(result.item).toBe(true);
  expect(result.crew).toBeNull();
  await expect(page.locator('#game')).toBeVisible();
});
