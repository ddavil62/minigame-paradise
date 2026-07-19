/** @fileoverview AD 검수용 전체 스프라이트 진단 장면을 세 기준 뷰포트로 캡처한다. */
import { expect,test } from '@playwright/test';

test('전체 재료 상태·설비·완성 요리·두 캐릭터를 세 뷰포트에서 캡처한다',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/?name=AssetQA&role=p1&locale=ko');
  await expect.poll(()=>page.evaluate(()=>window.__kitchenAssets?.ready)).toBe(true);
  await page.evaluate(()=>{
    const stationData=[
      ...['moon_mushroom','sunset_pepper','silver_dough','lantern_leaf','comet_radish'].map((kind,index)=>({id:`crate_${kind}`,type:'crate',kind,x:72+index*88,y:160,w:72,h:64,state:'IDLE'})),
      {id:'board_a',type:'board',x:80,y:312,w:96,h:64,state:'ACTIVE',progressMs:5200},{id:'dough_table',type:'dough',x:216,y:424,w:112,h:64,state:'READY'},
      {id:'plate_shelf',type:'plate_shelf',x:384,y:248,w:120,h:64,state:'IDLE'},{id:'cooling_pump',type:'cooling_pump',x:448,y:424,w:96,h:96,state:'ACTIVE'},
      {id:'brazier',type:'brazier',x:744,y:160,w:112,h:80,state:'READY'},{id:'steamer',type:'steamer',x:888,y:160,w:112,h:80,state:'ACTIVE'},
      {id:'pot',type:'pot',x:1032,y:160,w:112,h:80,state:'BURNT'},{id:'noodle_supply',type:'noodle_supply',kind:'star_noodle',x:1152,y:160,w:64,h:80,state:'IDLE'},
      {id:'plating_a',type:'plating',x:752,y:424,w:112,h:72,state:'IDLE'},{id:'trash',type:'trash',x:1040,y:424,w:80,h:80,state:'IDLE'},
      {id:'service',type:'service',x:1168,y:288,w:48,h:160,state:'READY'},{id:'exhaust_valve',type:'exhaust_valve',x:1096,y:520,w:96,h:80,state:'ACTIVE'},
    ];
    const kinds=['moon_mushroom','sunset_pepper','silver_dough','lantern_leaf','comet_radish','star_noodle'];
    const processes=['RAW','PREPPED','COOKED','BURNT'];
    const items=[];
    processes.forEach((process,row)=>kinds.forEach((kind,column)=>items.push({id:`${kind}_${process}`,kind,process,location:'FLOOR',x:342+column*72,y:338+row*54})));
    ['plate','mushroom_skewer','lantern_dumpling','comet_noodle'].forEach((kind,index)=>items.push({id:`dish_${kind}`,kind,process:kind==='plate'?'RAW':'COOKED',location:'FLOOR',x:790+index*68,y:558}));
    const snapshot={score:480,combo:1.5,elapsedMs:76000,heat:91,stations:stationData,items,players:[
      {id:'p1',x:760,y:570,facingX:-1,facingY:0,heldItemId:null,work:false},{id:'p2',x:840,y:570,facingX:1,facingY:0,heldItemId:null,work:false},
    ],orders:[
      {id:'order_1',recipeId:'mushroom_skewer',stationIndex:2,dueAtMs:108000,status:'ACTIVE'},
      {id:'order_2',recipeId:'lantern_dumpling',stationIndex:2,dueAtMs:119000,status:'ACTIVE'},
      {id:'order_3',recipeId:'comet_noodle',stationIndex:3,dueAtMs:126000,status:'ACTIVE'},
    ],train:{stopIndex:2,coolingProgressMs:1200}};
    document.querySelectorAll('.overlay,.network-overlay').forEach(element=>element.classList.add('hidden'));
    window.__kitchenState.renderSnapshot(snapshot);
  });
  for(const viewport of [{width:1280,height:720},{width:1024,height:768},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    const layout=await page.evaluate(()=>{
      window.__kitchenState.renderSnapshot(window.__kitchenState.snapshot);
      const presentation=window.__kitchenState.rendererPresentation();
      if(presentation.mobile)document.querySelector('.stage').scrollTo({left:250,behavior:'auto'});
      const warning=document.querySelector('#warning').getBoundingClientRect();
      const orders=document.querySelector('#mobile-orders').getBoundingClientRect();
      const timeline=document.querySelector('#mobile-timeline').getBoundingClientRect();
      const intersection=(first,second)=>Math.max(0,Math.min(first.bottom,second.bottom)-Math.max(first.top,second.top));
      const rectangleIntersection=(first,second)=>{const width=Math.max(0,Math.min(first.x+first.width,second.x+second.width)-Math.max(first.x,second.x));const height=Math.max(0,Math.min(first.y+first.height,second.y+second.height)-Math.max(first.y,second.y));return width&&height?{width,height,area:width*height}:{width:0,height:0,area:0};};
      return{
        presentation,
        warningOrderIntersection:presentation.mobile?intersection(warning,orders):0,
        warningTimelineIntersection:presentation.mobile?intersection(warning,timeline):0,
        canvasOrderIntersection:presentation.canvasHud&&presentation.mobile?29:0,
        playerCoolingIntersections:presentation.playerRects.map(player=>({id:player.id,...rectangleIntersection(player,presentation.coolingPanelRect)})),
        footerCoolingIntersections:presentation.footerRects.map(footer=>({id:footer.id,...rectangleIntersection(footer,presentation.coolingPanelRect)})),
      };
    });
    expect(layout.warningOrderIntersection).toBe(0);
    expect(layout.warningTimelineIntersection).toBe(0);
    expect(layout.canvasOrderIntersection).toBe(0);
    for(const intersection of layout.playerCoolingIntersections){expect(intersection.width).toBe(0);expect(intersection.height).toBe(0);expect(intersection.area).toBe(0);}
    for(const intersection of layout.footerCoolingIntersections){expect(intersection.width).toBe(0);expect(intersection.height).toBe(0);expect(intersection.area).toBe(0);}
    expect(layout.presentation.canvasHud).toBe(viewport.width>600);
    await page.waitForTimeout(100);
    if(viewport.width<=600){await page.evaluate(()=>{document.querySelector('.stage').scrollLeft=250;});await page.waitForTimeout(20);}
    await page.screenshot({path:`tests/screenshots/assets-play-${viewport.width}x${viewport.height}.png`});
  }
});
