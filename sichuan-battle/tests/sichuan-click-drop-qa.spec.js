/**
 * @fileoverview 실제 주기 동기화와 같은 revision 표현 변경에서 타일 노드 및 입력 보존을 독립 검증한다.
 */
import {test,expect} from '@playwright/test';

/** @param {number} seed 시드 @returns {()=>number} 재현 가능한 난수 생성기 */
function seededRandom(seed){
  let state=seed>>>0;
  return()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/0x100000000;};
}

test('실제 250ms 동기화와 128회 고정 시드 위상에서도 클릭과 DOM identity가 보존된다',async({page})=>{
  const opponent=await page.context().newPage();
  await Promise.all([
    page.goto('/?name=IndependentInputQA-A&e2e=1'),
    opponent.goto('/?name=IndependentInputQA-B&e2e=1')
  ]);
  await page.locator('#board .tile').first().waitFor();
  let tileId=null;
  await expect.poll(async()=>{
    tileId=await page.evaluate(()=>document.querySelector('#board .tile:not(:disabled)')?.dataset.tileId||null);
    return tileId;
  },{timeout:6000}).not.toBeNull();
  const tile=page.locator(`#board [data-tile-id="${tileId}"]`);
  const box=await tile.boundingBox();
  const point={x:box.x+box.width/2,y:box.y+box.height/2};
  await page.evaluate((id)=>{window.__qaHeldNode=window.__sichuanTileNode(id);},tileId);

  // 실제 서버의 250ms STATE_SYNC가 pointerdown과 pointerup 사이에 최소 한 번 지나가게 한다.
  const before=await page.evaluate(()=>window.__sichuanBoardState().pickCount);
  await page.mouse.move(point.x,point.y);
  await page.mouse.down();
  await page.waitForTimeout(350);
  expect(await page.evaluate((id)=>window.__qaHeldNode===window.__sichuanTileNode(id)&&window.__qaHeldNode.isConnected,tileId)).toBe(true);
  await page.mouse.up();
  await expect.poll(async()=>page.evaluate(()=>window.__sichuanBoardState().pickCount)).toBe(before+1);
  await tile.click();

  // 고정 시드로 동기화 삽입 위상을 바꾸며 선택/취소를 반복한다.
  const random=seededRandom(0x51c4a7);
  const stressStart=await page.evaluate(()=>window.__sichuanBoardState().pickCount);
  for(let index=0;index<128;index+=1){
    await page.waitForTimeout(Math.floor(random()*7));
    await page.mouse.move(point.x,point.y);
    await page.mouse.down();
    if(random()<0.7)await page.evaluate(()=>window.__sichuanInjectMessage({type:'STATE_SYNC',snapshot:window.__sichuanTestSnapshot(),serverNow:Date.now()}));
    await page.waitForTimeout(Math.floor(random()*7));
    await page.mouse.up();
  }
  await expect.poll(async()=>page.evaluate(()=>window.__sichuanBoardState().pickCount)).toBe(stressStart+128);
  expect(await page.evaluate((id)=>window.__qaHeldNode===window.__sichuanTileNode(id)&&window.__qaHeldNode.isConnected,tileId)).toBe(true);
  expect((await page.evaluate(()=>window.__sichuanBoardState())).selectedTileId).toBeNull();

  // revision을 올리지 않는 뒤집기·안개·힌트 표현도 같은 객체에 즉시 반영되어야 한다.
  await tile.focus();
  const renderedState=await page.evaluate((id)=>{
    const snapshot=window.__sichuanTestSnapshot();
    const target=snapshot.me.board.tiles.find((entry)=>entry.tileId===id);
    target.flipped=true;target.fogged=true;
    snapshot.me.effects=[...(snapshot.me.effects||[]),{effectId:'qa-hint',itemId:'hint',targets:[id],expiresAt:Date.now()+1000}];
    window.__sichuanInjectMessage({type:'STATE_SYNC',snapshot,serverNow:Date.now()});
    const node=window.__sichuanTileNode(id);
    return{
      expressions:['flipped','fogged','hinted'].every((name)=>node.classList.contains(name)),
      identity:node===window.__qaHeldNode,
      focused:document.activeElement===node
    };
  },tileId);
  // 다음 250ms 권위 동기화가 도착하기 전에 같은 렌더 프레임의 세 표현을 함께 검증한다.
  expect(renderedState).toEqual({expressions:true,identity:true,focused:true});
  // 두 연결을 순서대로 닫아 첫 close가 상대 연결을 확인한 뒤, 마지막 close가 방을 확실히 정리하게 한다.
  await page.evaluate(()=>window.__sichuanTestSend({type:'LEAVE_MATCH'}));
  await opponent.waitForTimeout(300);
  await opponent.evaluate(()=>window.__sichuanTestSend({type:'LEAVE_MATCH'}));
  await opponent.waitForTimeout(500);
});

test('send 예외와 셔플·경기·연결 reset이 pending 및 늦은 응답을 격리한다',async({page})=>{
  // 앱 WebSocket을 만들지 않는 동일 origin 리소스에서 모듈만 불러와 네트워크 수명주기를 격리한다.
  await page.goto('/sichuan-battle/assets/tiles/tile-01.png');
  const result=await page.evaluate(async()=>{
    const [{BoardView},{GameNetwork}]=await Promise.all([
      import('/sichuan-battle/js/board-view.js'),
      import('/sichuan-battle/js/network.js')
    ]);
    const NativeWebSocket=window.WebSocket;
    class StubWebSocket extends EventTarget{
      static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
      constructor(){super();this.readyState=StubWebSocket.CONNECTING;}
      close(){this.readyState=StubWebSocket.CLOSED;}
    }
    window.WebSocket=StubWebSocket;
    const network=new GameNetwork('isolated-qa');
    window.WebSocket=NativeWebSocket;
    network.closed=true;
    let disconnectEvents=0;
    network.addEventListener('connectionstate',(event)=>{if(!event.detail.connected)disconnectEvents+=1;});
    network.socket={readyState:WebSocket.CLOSED,send:()=>{}};
    const closedResult=network.send({type:'MATCH_PAIR'});
    network.socket={readyState:WebSocket.OPEN,send:()=>{throw new Error('qa send failure');}};
    const thrownResult=network.send({type:'MATCH_PAIR'});

    const root=document.createElement('div');
    document.body.appendChild(root);
    const tiles=[
      {tileId:'a',faceId:1,removed:false,locked:false,flipped:false,fogged:false},
      {tileId:'b',faceId:1,removed:false,locked:false,flipped:false,fogged:false}
    ];
    const view=new BoardView(root,{onPair:(a,b,revision)=>network.send({type:'MATCH_PAIR',tileAId:a,tileBId:b,boardRevision:revision})});
    view.setContext('match-a','playing',false);
    view.setConnectionReady(true);
    view.render(tiles,[],1);
    view.pick('a');view.pick('b');
    const sendFailureClean=view.pendingPair===null&&root.getAttribute('aria-busy')==='false'&&view.selectedTileId==='a';

    let sequence=0;
    network.socket={readyState:WebSocket.OPEN,send:()=>{}};
    view.onPair=()=>`qa-${++sequence}`;
    view.pick('b');
    const firstRequest=view.pendingPair.requestId;
    view.setContext('match-a','playing',true);
    const shuffleClean=view.pendingPair===null&&view.selectedTileId===null;
    view.setContext('match-a','playing',false);
    view.pick('a');view.pick('b');
    const secondRequest=view.pendingPair.requestId;
    const staleIgnored=!view.handleAccepted({requestId:firstRequest,matchId:'match-a'})&&view.pendingPair?.requestId===secondRequest;
    view.setContext('match-b','playing',false);
    const rematchClean=view.pendingPair===null&&view.selectedTileId===null;
    view.render(tiles,[],1);
    view.pick('a');view.pick('b');
    view.setConnectionReady(false);
    const disconnectClean=view.pendingPair===null&&view.selectedTileId===null&&!view.isInteractionEnabled();
    return{closedResult,thrownResult,disconnectEvents,sendFailureClean,shuffleClean,staleIgnored,rematchClean,disconnectClean};
  });
  expect(result).toEqual({
    closedResult:null,
    thrownResult:null,
    disconnectEvents:2,
    sendFailureClean:true,
    shuffleClean:true,
    staleIgnored:true,
    rematchClean:true,
    disconnectClean:true
  });
});
