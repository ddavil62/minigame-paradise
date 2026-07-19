/** @fileoverview 플레이 가이드의 문구·차단 우선순위·접근성·레이아웃을 독립 검증한다. */
import { expect,test } from '@playwright/test';

const seenKey='moonlightKitchenGuideSeen:v1';
const viewports=[{width:1280,height:720},{width:1024,height:768},{width:390,height:844}];

/** 두 사각형의 교차 면적을 계산한다. @param {object} a 첫 영역 @param {object} b 둘째 영역 @returns {number} 교차 면적 */
function overlap(a,b){return Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));}

test('버전 키와 네 페이지 한국어·영어 문구가 정확하다',async({browser})=>{
  const expected={
    ko:[
      ['주문 완성하기','주문을 확인하고, 재료를 손질해 요리한 뒤 정차 중에 전달하세요.','주문 카드에서 재료와 제한 시간을 확인하세요.|재료 상자에서 E로 집으세요.|맞는 작업대에서 Space를 누르세요.|빈 접시를 조리 완료 설비에 들고 가 E로 음식을 담으세요.|정차 중 배식창에서 E로 전달하세요.|별국수는 공급대에서 이미 손질된 상태로 나옵니다.'],
      ['세 가지 주문 익히기','재료별 작업대와 마지막 조리 설비를 맞추세요.','달버섯 + 노을고추 · 둘 다 도마 → 화로|은빛 반죽 · 반죽대 + 등불잎 · 도마 → 찜기|혜성무 · 도마 + 별국수 · 손질 없이 바로 사용 → 냄비|조리가 끝나면 타기 전에 빈 접시로 회수하세요.'],
      ['과열 함께 식히기','열도 85 이상에서는 두 승무원이 동시에 냉각해야 합니다.','열도 85 이상: 함께 냉각하세요|P1 · 냉각 펌프로 이동해 Space를 누르세요.|P2 · 배기 밸브로 이동해 Space를 누르세요.|두 승무원이 동시에 누르고 있어야 냉각됩니다.'],
      ['조작 익히기','가까운 대상을 바라보고 알맞은 키를 사용하세요.','WASD / ↑↓←→|E / Enter|Space|Q|이동하기|가까운 대상 집기·놓기·설비에 넣기·가져오기·전달하기|재료 손질·냉각 설비 작동|들고 있는 물건을 바닥에 내려놓기']
    ],
    en:[
      ['Complete an order','Check the order, prepare and cook its ingredients, then deliver during a stop.','Check ingredients and time on the order card.|Pick up ingredients from crates with E.|Hold Space at the matching prep station.|Bring an empty plate to the ready cooker and press E.|Deliver at the service window with E during a stop.|Star noodles come prepared from their supply crate.'],
      ['Learn the three orders','Match each ingredient to its prep station and final cooker.','Moon Mushroom + Sunset Pepper · both Chopping Board → Brazier|Silver Dough · Kneading Table + Lantern Leaf · Chopping Board → Steamer|Comet Radish · Chopping Board + Star Noodles · ready to use, no prep → Pot|Collect finished food with an empty plate before it burns.'],
      ['Cool together','At HEAT 85 or higher, both crew must cool at the same time.','HEAT 85+: Cool together|P1 · Move to the cooling pump and hold Space.|P2 · Move to the exhaust valve and hold Space.|Cooling works only while both crew hold at the same time.'],
      ['Learn the controls','Face a nearby target and use the matching key.','WASD / ↑↓←→|E / Enter|Space|Q|Move|Pick up, put down, load, collect, or deliver nearby|Prepare ingredients or operate cooling equipment|Drop your held item on the floor']
    ]
  };
  for(const locale of ['ko','en']){
    const context=await browser.newContext();
    await context.addInitScript(()=>localStorage.setItem('moonlightKitchenGuideSeen:v0','1'));
    const page=await context.newPage();await page.goto(`/?name=CopyQA&role=p1&locale=${locale}`);
    await expect(page.locator('#play-guide')).toBeVisible();
    for(let index=0;index<4;index+=1){
      await page.evaluate(value=>window.__kitchenGuide.page(value),index);
      await expect(page.locator('#guide-title')).toHaveText(expected[locale][index][0]);
      await expect(page.locator('#guide-description')).toHaveText(expected[locale][index][1]);
      const body=(await page.locator('#guide-page').innerText()).replaceAll('\n','|');
      for(const fragment of expected[locale][index][2].split('|'))expect(body).toContain(fragment);
      await expect(page.locator('#guide-progress')).toHaveText(`${index+1} / 4`);
    }
    await expect(page.locator('#guide-next')).toHaveText(locale==='ko'?'운행표로 돌아가기':'Back to manifest');
    await page.locator('#guide-next').click();
    await expect.poll(()=>page.evaluate(key=>localStorage.getItem(key),seenKey)).toBe('1');
    await page.reload();await expect(page.locator('#play-guide')).toBeHidden();await page.evaluate(()=>document.querySelector('#confirm-exit').click());await page.waitForTimeout(180);
    await context.close();
  }
});

test('차단 오버레이 우선순위와 포커스 트랩·복원이 유지된다',async({page})=>{
  await page.addInitScript(key=>localStorage.setItem(key,'1'),seenKey);await page.goto('/?name=PriorityQA&role=p1');await expect(page.locator('#network-overlay')).toBeHidden();
  await page.locator('#lobby-help-button').click();await expect(page.locator('#guide-close')).toBeFocused();
  await page.locator('#guide-close').focus();await page.keyboard.press('Shift+Tab');await expect(page.locator('#guide-next')).toBeFocused();
  await page.keyboard.press('Tab');await expect(page.locator('#guide-close')).toBeFocused();
  await page.keyboard.press('Escape');await expect(page.locator('#lobby-help-button')).toBeFocused();
  await page.locator('#exit-confirm').evaluate(element=>element.classList.remove('hidden'));await expect(page.locator('#exit-confirm')).toBeVisible();
  await page.evaluate(()=>window.__kitchenGuide.open());await expect(page.locator('#play-guide')).toBeHidden();
  await page.locator('#keep-playing').click();
  await page.evaluate(()=>window.__kitchenState.showResult({success:false,score:0,served:0,expired:0,maxCombo:1,overheatAccidents:0,players:[]}));
  await page.evaluate(()=>window.__kitchenGuide.open());await expect(page.locator('#play-guide')).toBeHidden();
});

test('모든 기준 뷰포트와 언어에서 dialog·고정 영역·44px 대상이 안전하다',async({browser})=>{
  for(const viewport of viewports){
    for(const locale of ['ko','en']){
      const context=await browser.newContext({viewport});await context.addInitScript(key=>localStorage.setItem(key,'1'),seenKey);
      const page=await context.newPage();await page.goto(`/?name=LayoutQA&role=p1&locale=${locale}`);await page.locator('#lobby-help-button').click();
      await expect(page.locator('#play-guide')).toHaveAttribute('role','dialog');await expect(page.locator('#play-guide')).toHaveAttribute('aria-modal','true');
      for(let index=0;index<4;index+=1){
        await page.evaluate(value=>window.__kitchenGuide.page(value),index);
        const metrics=await page.evaluate(()=>{
          const rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
          const targets=[...document.querySelectorAll('#play-guide button')].filter(el=>el.getClientRects().length).map(el=>({id:el.id,...rect(`#${el.id}`)}));
          const pageEl=document.querySelector('#guide-page');return{dialog:rect('#play-guide'),header:rect('.guide-header'),page:rect('#guide-page'),footer:rect('.guide-footer'),targets,overflow:pageEl.scrollWidth-pageEl.clientWidth};
        });
        expect(metrics.dialog.x).toBeGreaterThanOrEqual(0);expect(metrics.dialog.y).toBeGreaterThanOrEqual(0);expect(metrics.dialog.x+metrics.dialog.width).toBeLessThanOrEqual(viewport.width);expect(metrics.dialog.y+metrics.dialog.height).toBeLessThanOrEqual(viewport.height);
        expect(overlap(metrics.header,metrics.page)).toBe(0);expect(overlap(metrics.page,metrics.footer)).toBe(0);expect(overlap(metrics.header,metrics.footer)).toBe(0);expect(metrics.overflow).toBeLessThanOrEqual(1);
        for(const target of metrics.targets){expect(target.width,`${target.id} 폭`).toBeGreaterThanOrEqual(44);expect(target.height,`${target.id} 높이`).toBeGreaterThanOrEqual(44);}
      }
      await page.emulateMedia({reducedMotion:'reduce'});const motion=await page.locator('#guide-page').evaluate(el=>({transition:getComputedStyle(el).transitionDuration,scroll:getComputedStyle(el).scrollBehavior}));expect(motion.transition).toBe('0s');expect(motion.scroll).toBe('auto');
      await context.close();
    }
  }
});

test('누르고 있던 입력도 가이드가 즉시 중립화하고 닫은 뒤 고착되지 않는다',async({browser})=>{
  const contexts=await Promise.all([browser.newContext(),browser.newContext()]);
  await Promise.all(contexts.map(context=>context.addInitScript(key=>localStorage.setItem(key,'1'),seenKey)));
  const [p1,p2]=await Promise.all(contexts.map(context=>context.newPage()));await p1.goto('/?name=NeutralP1&role=p1');await p2.goto('/?name=NeutralP2&role=p2');
  await Promise.all([p1.locator('#ready').click(),p2.locator('#ready').click()]);await expect.poll(()=>p1.evaluate(()=>window.__kitchenState.snapshot.phase)).toBe('playing');
  await p1.keyboard.down('w');await p1.waitForTimeout(180);await p1.locator('#help-button').click();
  const atOpen=await p1.evaluate(()=>{const me=window.__kitchenState.snapshot.players.find(p=>p.id===window.__kitchenState.playerId);return{x:me.x,y:me.y,held:me.heldItemId};});
  await p1.keyboard.press('e');await p1.keyboard.press('Space');await p1.keyboard.press('q');await p1.waitForTimeout(320);
  const whileOpen=await p1.evaluate(()=>{const me=window.__kitchenState.snapshot.players.find(p=>p.id===window.__kitchenState.playerId);return{x:me.x,y:me.y,held:me.heldItemId};});expect(whileOpen).toEqual(atOpen);
  await p1.keyboard.press('Escape');await expect(p1.locator('#game')).toBeFocused();await p1.waitForTimeout(250);
  const afterClose=await p1.evaluate(()=>{const me=window.__kitchenState.snapshot.players.find(p=>p.id===window.__kitchenState.playerId);return{x:me.x,y:me.y,held:me.heldItemId};});expect(afterClose).toEqual(atOpen);
  await p1.keyboard.up('w');await p1.keyboard.down('d');await p1.waitForTimeout(250);await p1.keyboard.up('d');await expect.poll(async()=>p1.evaluate(()=>window.__kitchenState.snapshot.players.find(p=>p.id===window.__kitchenState.playerId).x)).not.toBe(atOpen.x);
  await Promise.all(contexts.map(context=>context.close()));
});
