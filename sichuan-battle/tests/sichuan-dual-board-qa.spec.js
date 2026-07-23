/**
 * @fileoverview 듀얼 보드의 판정 대기, 중복 입력 차단, 경로 및 실패 회복을 공격적으로 검증한다.
 */
import {test,expect} from '@playwright/test';
import {findAnyLegalPair,findPath} from '../lib/pathfinder.js';

/**
 * 현재 보드에서 같은 문양이지만 연결할 수 없는 두 타일을 찾는다.
 * @param {object[]} tiles 공개 보드 타일
 * @returns {{a:object,b:object}|null} 연결 불가 짝
 */
function findBlockedPair(tiles){
  const active=tiles.filter((tile)=>!tile.removed&&!tile.locked);
  for(let index=0;index<active.length;index+=1)for(let next=index+1;next<active.length;next+=1){
    if(active[index].faceId===active[next].faceId&&!findPath(tiles,active[index].tileId,active[next].tileId))return {a:active[index],b:active[next]};
  }
  return null;
}

test('판정 지연 중 한 요청만 보내고 성공 경로와 reason별 실패 뒤 입력을 회복한다',async({browser})=>{
  const contextA=await browser.newContext({viewport:{width:1366,height:768}});
  const contextB=await browser.newContext({viewport:{width:1366,height:768}});
  await contextA.addInitScript(()=>{
    window.__qaPairPayloads=[];
    const original=WebSocket.prototype.send;
    WebSocket.prototype.send=function(data){
      let payload=null;
      try{payload=JSON.parse(data);}catch{}
      if(payload?.type==='MATCH_PAIR'){
        window.__qaPairPayloads.push(payload);
        setTimeout(()=>original.call(this,data),350);
        return;
      }
      original.call(this,data);
    };
  });
  const a=await contextA.newPage();const b=await contextB.newPage();const errors=[];
  for(const page of [a,b]){
    page.on('pageerror',(error)=>errors.push(error.message));
    page.on('console',(message)=>{if(message.type()==='error')errors.push(message.text());});
  }
  await Promise.all([a.goto('/?name=QA-A&e2e=1'),b.goto('/?name=QA-B&e2e=1')]);
  await a.locator('#board .tile').first().waitFor();await a.waitForTimeout(3200);
  const initial=await a.evaluate(()=>window.__sichuanTestSnapshot());
  const legal=findAnyLegalPair(initial.me.board.tiles);expect(legal).toBeTruthy();
  const third=initial.me.board.tiles.find((tile)=>!tile.removed&&tile.tileId!==legal.a.tileId&&tile.tileId!==legal.b.tileId);
  await a.locator(`#board [data-tile-id="${legal.a.tileId}"]`).click();
  await a.locator(`#board [data-tile-id="${legal.b.tileId}"]`).click();
  await expect(a.locator('#board')).toHaveAttribute('aria-busy','true');
  await expect(a.locator('#board .pending')).toHaveCount(2);
  await a.locator(`#board [data-tile-id="${third.tileId}"]`).evaluate((node)=>node.click());
  expect(await a.evaluate(()=>window.__qaPairPayloads.length)).toBe(1);
  await expect(a.locator('#path-layer polyline')).toHaveCount(1,{timeout:2000});
  await expect(a.locator('#my-score')).toHaveText('1');
  await expect(b.locator('#opponent-score')).toHaveText('1');
  await b.locator(`#board [data-tile-id="${legal.a.tileId}"]`).click();
  await b.locator(`#board [data-tile-id="${legal.b.tileId}"]`).click();
  await expect(b.locator('#my-score')).toHaveText('1');
  await expect(a.locator('#opponent-score')).toHaveText('1');
  await expect(a.locator(`#opponent-board [data-tile-id="${legal.a.tileId}"]`)).toHaveClass(/removed/);

  const afterSuccess=await a.evaluate(()=>window.__sichuanTestSnapshot());
  const blocked=findBlockedPair(afterSuccess.me.board.tiles);expect(blocked).toBeTruthy();
  await a.locator(`#board [data-tile-id="${blocked.a.tileId}"]`).click();
  await a.locator(`#board [data-tile-id="${blocked.b.tileId}"]`).click();
  await expect(a.locator('#board-feedback')).toContainText(/경로|path/i,{timeout:2000});
  await expect(a.locator('#board .match-invalid')).toHaveCount(2);
  await expect(a.locator('#board')).toHaveAttribute('aria-busy','false');
  const beforeLanguage=await a.locator('#board-feedback').textContent();
  await a.locator('#language-button').click();
  await expect(a.locator('#board-feedback')).not.toHaveText(beforeLanguage);
  await expect(a.locator('#board .match-invalid')).toHaveCount(0,{timeout:2000});

  const latest=await a.evaluate(()=>window.__sichuanTestSnapshot());
  const next=latest.me.board.tiles.find((tile)=>!tile.removed&&!tile.locked);
  await a.locator(`#board [data-tile-id="${next.tileId}"]`).click();
  await expect(a.locator(`#board [data-tile-id="${next.tileId}"]`)).toHaveAttribute('aria-pressed','true');
  await a.screenshot({path:'tests/screenshots/qa-dual-board-pending-recovery.png',fullPage:true});
  const oldMatchId=latest.matchId;
  await a.evaluate(()=>window.__sichuanTestSend({type:'TEST_FINISH_MATCH'}));
  await Promise.all([expect(a.locator('#result-view')).toBeVisible(),expect(b.locator('#result-view')).toBeVisible()]);
  await a.locator('#rematch-button').click();
  await b.locator('#rematch-button').click();
  await expect.poll(async()=>a.evaluate(()=>window.__sichuanTestSnapshot()?.matchId),{timeout:3000}).not.toBe(oldMatchId);
  await expect(a.locator('#board .tile')).toHaveCount(96);
  await expect(b.locator('#opponent-board .tile')).toHaveCount(96);
  expect(errors).toEqual([]);
  await Promise.all([a.evaluate(()=>window.__sichuanTestSend({type:'LEAVE_MATCH'})),b.evaluate(()=>window.__sichuanTestSend({type:'LEAVE_MATCH'}))]);
  await contextA.close();await contextB.close();
});
