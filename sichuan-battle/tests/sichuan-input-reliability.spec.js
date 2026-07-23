/**
 * @fileoverview 주기 동기화 사이의 포인터 입력과 pending 수명주기를 결정적으로 검증한다.
 */
import {test,expect} from '@playwright/test';

/** @param {import('@playwright/test').Page} page 페이지 @param {string} tileId 타일 ID @returns {Promise<{x:number,y:number}>} */
async function tileCenter(page,tileId){
  const box=await page.locator(`#board [data-tile-id="${tileId}"]`).boundingBox();
  return{x:box.x+box.width/2,y:box.y+box.height/2};
}

test('pointerdown과 STATE_SYNC 사이에도 동일 노드에서 click을 정확히 처리하고 120회 버틴다',async({page})=>{
  await page.goto('/?name=InputStress&e2e=1&mode=ai');
  await page.locator('#board .tile').first().waitFor();
  let tileId=null;await expect.poll(async()=>{tileId=await page.evaluate(()=>document.querySelector('#board .tile:not(:disabled)')?.dataset.tileId||null);return tileId;},{timeout:6000}).not.toBeNull();
  const point=await tileCenter(page,tileId);
  const before=await page.evaluate(()=>window.__sichuanBoardState().pickCount);
  await page.evaluate((id)=>{window.__heldTileNode=window.__sichuanTileNode(id);},tileId);
  await page.mouse.move(point.x,point.y);await page.mouse.down();
  await page.evaluate(()=>window.__sichuanInjectMessage({type:'STATE_SYNC',snapshot:window.__sichuanTestSnapshot(),serverNow:Date.now()}));
  expect(await page.evaluate((id)=>window.__heldTileNode===window.__sichuanTileNode(id)&&window.__heldTileNode.isConnected,tileId)).toBe(true);
  await page.mouse.up();
  await expect.poll(async()=>page.evaluate(()=>window.__sichuanBoardState().pickCount)).toBe(before+1);
  await expect(page.locator(`#board [data-tile-id="${tileId}"]`)).toHaveAttribute('aria-pressed','true');
  await page.locator(`#board [data-tile-id="${tileId}"]`).click();
  const stressStart=await page.evaluate(()=>window.__sichuanBoardState().pickCount);
  for(let index=0;index<120;index+=1){
    await page.mouse.move(point.x,point.y);await page.mouse.down();
    await page.evaluate(()=>window.__sichuanInjectMessage({type:'STATE_SYNC',snapshot:window.__sichuanTestSnapshot(),serverNow:Date.now()}));
    await page.mouse.up();
  }
  const state=await page.evaluate(()=>window.__sichuanBoardState());
  expect(state.pickCount).toBe(stressStart+120);
  expect(state.selectedTileId).toBeNull();
  expect(await page.evaluate((id)=>window.__heldTileNode===window.__sichuanTileNode(id)&&window.__heldTileNode.isConnected,tileId)).toBe(true);
  await page.evaluate(()=>window.__sichuanTestSend({type:'LEAVE_MATCH'}));
});

test('실제 touch와 Space/Enter도 동기화 중 한 번씩만 선택한다',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  const page=await context.newPage();await page.goto('/?name=TouchInput&e2e=1&mode=ai');
  await page.locator('#board .tile').first().waitFor();let tileId=null;await expect.poll(async()=>{tileId=await page.evaluate(()=>document.querySelector('#board .tile:not(:disabled)')?.dataset.tileId||null);return tileId;},{timeout:6000}).not.toBeNull();
  const tile=page.locator(`#board [data-tile-id="${tileId}"]`);const point=await tileCenter(page,tileId);
  const cdp=await context.newCDPSession(page);const before=await page.evaluate(()=>window.__sichuanBoardState().pickCount);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y,id:1}]});
  await page.evaluate(()=>window.__sichuanInjectMessage({type:'STATE_SYNC',snapshot:window.__sichuanTestSnapshot(),serverNow:Date.now()}));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(async()=>page.evaluate(()=>window.__sichuanBoardState().pickCount)).toBe(before+1);
  await tile.focus();await page.keyboard.press('Space');await page.keyboard.press('Enter');
  await expect.poll(async()=>page.evaluate(()=>window.__sichuanBoardState().pickCount)).toBe(before+3);
  await page.evaluate(()=>window.__sichuanTestSend({type:'LEAVE_MATCH'}));
  await context.close();
});

test('미전송·오래된 응답·타임아웃·revision·재접속에서 pending을 복구한다',async({page})=>{
  await page.goto('/?name=PendingLife&e2e=1&mode=ai');await page.locator('#board .tile').first().waitFor();
  const result=await page.evaluate(async()=>{
    const {BoardView}=await import('/sichuan-battle/js/board-view.js');
    const root=document.createElement('div');document.body.appendChild(root);
    const tiles=[{tileId:'a',faceId:1,removed:false,locked:false,flipped:false,fogged:false},{tileId:'b',faceId:1,removed:false,locked:false,flipped:false,fogged:false}];
    const view=new BoardView(root,{onPair:()=>null});view.setContext('match-a','playing',false);view.setConnectionReady(true);view.render(tiles,[],1);
    view.pick('a');view.pick('b');const unsentPending=view.pendingPair;
    view.onPair=()=> 'request-a';view.pick('b');
    const wrongRequest=view.handleAccepted({requestId:'other',matchId:'match-a'});
    const wrongMatch=view.handleRejected({requestId:'request-a',matchId:'old-match'});
    await new Promise((resolve)=>setTimeout(resolve,2050));
    const timedOut=view.pendingPair===null&&view.selectedTileId===null&&view.isInteractionEnabled();
    const late=view.handleAccepted({requestId:'request-a',matchId:'match-a'});
    view.pick('a');view.pick('b');view.render(tiles,[],2);const revisionCleared=view.pendingPair===null;
    view.pick('a');view.pick('b');view.setConnectionReady(false);const reconnectCleared=view.pendingPair===null&&view.selectedTileId===null&&!view.isInteractionEnabled();
    view.setConnectionReady(true);view.setContext('match-b','playing',false);view.render(tiles,[],0);
    return{unsentPending,wrongRequest,wrongMatch,timedOut,late,revisionCleared,reconnectCleared,enabledAfterSnapshot:view.isInteractionEnabled()};
  });
  expect(result).toEqual({unsentPending:null,wrongRequest:false,wrongMatch:false,timedOut:true,late:false,revisionCleared:true,reconnectCleared:true,enabledAfterSnapshot:true});
  await page.evaluate(()=>window.__sichuanTestSend({type:'LEAVE_MATCH'}));
});
