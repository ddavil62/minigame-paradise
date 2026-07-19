/** @fileoverview 플레이 가이드의 노출 정책, 탐색, 접근성, 입력 차단과 반응형 배치를 검증한다. */
import { expect,test } from '@playwright/test';

const seenKey='moonlightKitchenGuideSeen:v1';

/** 두 사각형의 교차 면적을 구한다. @param {object} a 첫 영역 @param {object} b 둘째 영역 @returns {number} 교차 면적 */
function overlap(a,b){return Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));}

/** 요소가 뷰포트 안에 완전히 들어오는지 검사한다. @param {import('@playwright/test').Locator} locator 대상 @param {{width:number,height:number}} viewport 뷰포트 @returns {Promise<void>} */
async function expectInside(locator,viewport){const box=await locator.boundingBox();expect(box).not.toBeNull();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(viewport.width);expect(box.y+box.height).toBeLessThanOrEqual(viewport.height);}

/** 도구·연결·모바일 HUD·경고 사이의 모든 가시 영역 교차가 없는지 확인한다. @param {import('@playwright/test').Page} page 페이지 @returns {Promise<void>} */
async function expectHudSeparation(page){const selectors=['#help-button','#launcher-button','#connection','#mobile-orders','#mobile-timeline','#warning'];const entries=[];for(const selector of selectors){const locator=page.locator(selector);if(await locator.isVisible()){const box=await locator.boundingBox();if(box)entries.push([selector,box]);}}for(let i=0;i<entries.length;i+=1){for(let j=i+1;j<entries.length;j+=1){expect(overlap(entries[i][1],entries[j][1]),`${entries[i][0]}와 ${entries[j][0]} 교차`).toBe(0);}}}

test('첫 로비에서 한 번 열리고 닫은 뒤에는 수동으로 다시 연다',async({page})=>{
  await page.goto('/?name=GuideAuto&role=p1');
  await expect(page.locator('#play-guide')).toBeVisible();
  await expect(page.locator('#guide-title')).toHaveText('주문 완성하기');
  await expect(page.locator('#guide-close')).toBeFocused();
  await page.locator('#guide-close').click();
  await expect(page.locator('#language')).toBeFocused();
  await expect.poll(()=>page.evaluate(key=>localStorage.getItem(key),seenKey)).toBe('1');
  await page.reload();
  await expect(page.locator('#play-guide')).toBeHidden();
  await expect(page.locator('#network-overlay')).toBeHidden();
  await page.locator('#lobby-help-button').click();
  await expect(page.locator('#play-guide')).toBeVisible();
  await page.locator('#guide-next').click();
  const recipes=page.locator('.guide-recipe');
  await expect(recipes.nth(0)).toContainText('둘 다 도마 → 화로');
  await expect(recipes.nth(1)).toContainText('반죽대 + 등불잎 · 도마 → 찜기');
  await expect(recipes.nth(2)).toContainText('도마 + 별국수 · 손질 없이 바로 사용 → 냄비');
  await page.keyboard.press('Escape');
  await expect(page.locator('#lobby-help-button')).toBeFocused();
  await page.locator('#leave').click();await page.locator('#confirm-exit').click();
});

test('로비 전용 도움말은 세 뷰포트와 ko/en에서 실제 최상단 클릭 대상으로 동작한다',async({browser})=>{
  const context=await browser.newContext();await context.addInitScript(key=>localStorage.setItem(key,'1'),seenKey);const page=await context.newPage();
  for(const viewport of [{width:1280,height:720},{width:1024,height:768},{width:390,height:844}]){
    for(const locale of ['ko','en']){
      await page.setViewportSize(viewport);await page.goto(`/?name=LobbyGuide&role=p1&locale=${locale}`);await expect(page.locator('#network-overlay')).toBeHidden();
      const button=page.locator('#lobby-help-button');await expect(button).toBeVisible();const box=await button.boundingBox();expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
      const topId=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('button')?.id,{x:box.x+box.width/2,y:box.y+box.height/2});expect(topId).toBe('lobby-help-button');
      await button.click();await expect(page.locator('#play-guide')).toBeVisible();await page.keyboard.press('Escape');await expect(button).toBeFocused();
    }
  }
  await page.locator('#leave').click();await page.locator('#confirm-exit').click();await context.close();
});

test('네 페이지, 영문, 포커스 트랩과 세 뷰포트가 동작한다',async({page})=>{
  await page.addInitScript(key=>localStorage.setItem(key,'1'),seenKey);
  await page.goto('/?name=GuidePages&role=p1&locale=en');
  await expect(page.locator('#network-overlay')).toBeHidden();
  await page.locator('#lobby-help-button').click();
  await expect(page.locator('#guide-title')).toHaveText('Complete an order');
  await expect(page.locator('#guide-prev')).toBeDisabled();
  await page.locator('#guide-next').click();
  await expect(page.locator('#guide-title')).toHaveText('Learn the three orders');
  const recipes=page.locator('.guide-recipe');
  await expect(recipes.nth(0)).toContainText('both Chopping Board → Brazier');
  await expect(recipes.nth(1)).toContainText('Kneading Table + Lantern Leaf · Chopping Board → Steamer');
  await expect(recipes.nth(2)).toContainText('Chopping Board + Star Noodles · ready to use, no prep → Pot');
  await page.setViewportSize({width:1024,height:768});
  await expectInside(page.locator('#play-guide'),{width:1024,height:768});
  await page.evaluate(()=>window.__kitchenState.renderSnapshot({...window.__kitchenState.snapshot,heat:90,stations:window.__kitchenState.snapshot.stations??[],train:window.__kitchenState.snapshot.train??{}}));
  await expect(page.locator('#warning')).toBeVisible();
  await expectHudSeparation(page);
  await page.screenshot({path:'tests/screenshots/guide-recipes-1024x768.png'});
  await page.locator('#guide-next').click();
  await expect(page.locator('#guide-title')).toHaveText('Cool together');
  await expect(page.locator('#guide-page')).toContainText('P1');
  await expect(page.locator('#guide-page')).toContainText('P2');
  await page.setViewportSize({width:390,height:844});
  await expectInside(page.locator('#play-guide'),{width:390,height:844});
  await expectHudSeparation(page);
  await page.screenshot({path:'tests/screenshots/guide-cooling-390x844.png'});
  await page.locator('#guide-next').click();
  await expect(page.locator('#guide-page')).toContainText('WASD');
  await expect(page.locator('#guide-page')).toContainText('E / Enter');
  await expect(page.locator('#guide-page')).toContainText('Space');
  await expect(page.locator('#guide-page')).toContainText('Q');
  await page.locator('#guide-next').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#guide-close')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#guide-next')).toBeFocused();
  await page.keyboard.press('Escape');await page.locator('#leave').click();await page.locator('#confirm-exit').click();
});

test('운행 중 가이드는 이동 입력을 막고 Canvas 초점을 복원한다',async({browser})=>{
  const a=await browser.newContext();const b=await browser.newContext();
  await Promise.all([a.addInitScript(key=>localStorage.setItem(key,'1'),seenKey),b.addInitScript(key=>localStorage.setItem(key,'1'),seenKey)]);
  const p1=await a.newPage();const p2=await b.newPage();
  await p1.goto('/?name=GuideP1&role=p1');await p2.goto('/?name=GuideP2&role=p2');
  await Promise.all([p1.locator('#ready').click(),p2.locator('#ready').click()]);
  await expect(p1.locator('#game')).toBeFocused();
  await expect.poll(()=>p1.evaluate(()=>window.__kitchenState.snapshot.phase)).toBe('playing');
  await p1.locator('#help-button').click();
  await expect(p1.locator('#play-guide')).toBeVisible();
  const before=await p1.evaluate(()=>{const me=window.__kitchenState.snapshot.players.find(player=>player.id===window.__kitchenState.playerId);return{x:me.x,y:me.y};});
  await p1.evaluate(()=>document.activeElement?.blur());
  await p1.keyboard.down('w');await p1.keyboard.press('e');await p1.keyboard.press('Space');await p1.keyboard.press('q');await p1.waitForTimeout(350);await p1.keyboard.up('w');
  const after=await p1.evaluate(()=>{const me=window.__kitchenState.snapshot.players.find(player=>player.id===window.__kitchenState.playerId);return{x:me.x,y:me.y};});
  expect(after).toEqual(before);
  await p1.setViewportSize({width:1280,height:720});
  await expectInside(p1.locator('#play-guide'),{width:1280,height:720});
  await p1.evaluate(()=>window.__kitchenState.renderSnapshot({...window.__kitchenState.snapshot,heat:90}));
  await expect(p1.locator('#warning')).toBeVisible();
  await expectHudSeparation(p1);
  await p1.screenshot({path:'tests/screenshots/guide-playing-1280x720.png'});
  await p1.keyboard.press('Escape');await expect(p1.locator('#game')).toBeFocused();
  await p1.locator('#launcher-button').click();await p1.locator('#confirm-exit').click();
  await a.close();await b.close();
});
