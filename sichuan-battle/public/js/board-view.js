/**
 * @fileoverview 상호작용 보드와 읽기 전용 상대 보드의 타일 및 입력 피드백을 안정적으로 갱신한다.
 */
import {t} from './i18n.js';

const PAIR_TIMEOUT_MS=2000;

export class BoardView {
  /**
   * @param {HTMLElement} root 보드 요소
   * @param {{interactive?:boolean,onPair?:(a:string,b:string,revision:number)=>string|null,pathLayer?:SVGElement|null,feedback?:HTMLElement|null}} [options] 보드 옵션
   */
  constructor(root,options={}){
    this.root=root;this.interactive=options.interactive!==false;this.onPair=options.onPair||(()=>null);
    this.pathLayer=options.pathLayer||null;this.feedback=options.feedback||null;this.tiles=[];this.effects=[];this.boardRevision=-1;
    this.matchId=null;this.phase='waiting';this.shufflePending=false;this.connectionReady=false;this.selectedTileId=null;this.pendingPair=null;
    this.feedbackKey=this.interactive?'selectFirst':null;this.successIds=new Set();this.invalidIds=new Set();this.feedbackTimer=null;
    /** @type {Map<string,HTMLElement>} tileId별로 경기 중 동일 객체를 유지한다. */
    this.tileNodes=new Map();this.pickCount=0;this.pairAttemptCount=0;
    if(this.interactive)this.root.addEventListener('click',(event)=>this.handleClick(event));
  }

  /** @private @param {MouseEvent} event 위임된 클릭 이벤트 @returns {void} */
  handleClick(event){
    const target=event.target instanceof Element?event.target.closest('[data-tile-id]'):null;
    if(!target||!this.root.contains(target))return;
    this.pick(String(target.dataset.tileId));
  }

  /** @param {boolean} ready 권위 snapshot 수신 뒤 입력 가능 여부 @returns {void} */
  setConnectionReady(ready){
    if(this.connectionReady===ready)return;
    this.connectionReady=ready;
    if(!ready)this.resetTransientState();
    this.render(this.tiles,this.effects,this.boardRevision);
  }

  /** @param {string} matchId 경기 ID @param {string} phase 경기 단계 @param {boolean} shufflePending 셔플 대기 여부 @returns {void} */
  setContext(matchId,phase,shufflePending){
    if((this.matchId!==null&&this.matchId!==matchId)||(this.phase==='playing'&&phase!=='playing')||(!this.shufflePending&&shufflePending))this.resetTransientState();
    this.matchId=matchId;this.phase=phase;this.shufflePending=shufflePending;
  }

  /** @returns {boolean} 현재 보드 입력 가능 여부 */
  isInteractionEnabled(){return this.interactive&&this.connectionReady&&this.phase==='playing'&&!this.shufflePending&&!this.pendingPair;}

  /** @param {object[]} tiles 서버 타일 @param {object[]} [effects=[]] 활성 효과 @param {number} [revision=0] 보드 revision */
  render(tiles,effects=[],revision=0){
    if(this.boardRevision>=0&&this.boardRevision!==revision){
      if(this.pendingPair)this.resetTransientState();
      else this.clearSelection(false);
    }
    this.boardRevision=revision;this.tiles=tiles||[];this.effects=effects;
    const available=new Set(this.tiles.filter((tile)=>!tile.removed&&!tile.locked).map((tile)=>tile.tileId));
    if(this.selectedTileId&&!available.has(this.selectedTileId))this.clearSelection(false);
    const hintIds=new Set(effects.filter((effect)=>effect.itemId==='hint').flatMap((effect)=>effect.targets||[]));
    const currentIds=new Set(this.tiles.map((tile)=>tile.tileId));
    for(const [tileId,node] of this.tileNodes)if(!currentIds.has(tileId)){node.remove();this.tileNodes.delete(tileId);}
    this.tiles.forEach((tile,index)=>{
      let node=this.tileNodes.get(tile.tileId);
      if(!node){node=this.createTile(tile.tileId);this.tileNodes.set(tile.tileId,node);}
      this.updateTileNode(node,tile,hintIds);
      // 순서가 같은 주기 동기화에서는 DOM 이동조차 하지 않아 활성 포인터와 포커스를 보존한다.
      if(this.root.children[index]!==node)this.root.insertBefore(node,this.root.children[index]||null);
    });
    this.root.setAttribute('aria-busy',this.pendingPair?'true':'false');
    this.updateFeedback();
  }

  /** @private @param {string} tileId 타일 ID @returns {HTMLElement} */
  createTile(tileId){
    const node=document.createElement(this.interactive?'button':'span');
    node.className='tile';node.dataset.tileId=tileId;
    if(this.interactive){node.type='button';node.setAttribute('role','gridcell');node.setAttribute('aria-pressed','false');}
    else{node.setAttribute('aria-hidden','true');node.tabIndex=-1;}
    return node;
  }

  /** @private @param {HTMLElement} node 기존 노드 @param {object} tile 서버 타일 @param {Set<string>} hintIds 힌트 ID @returns {void} */
  updateTileNode(node,tile,hintIds){
    node.style.backgroundImage=`url('/sichuan-battle/assets/tiles/tile-${String(tile.faceId).padStart(2,'0')}.png')`;
    if(this.interactive){
      node.setAttribute('aria-label',tile.flipped?t('flippedTile'):t('tileLabel',{face:tile.faceId}));
      node.disabled=tile.removed||tile.locked||!this.isInteractionEnabled();
      node.setAttribute('aria-pressed',this.selectedTileId===tile.tileId?'true':'false');
    }
    node.classList.toggle('removed',tile.removed);node.classList.toggle('locked',tile.locked);node.classList.toggle('flipped',tile.flipped);node.classList.toggle('fogged',tile.fogged);node.classList.toggle('hinted',this.interactive&&hintIds.has(tile.tileId));
    node.classList.toggle('selected',this.selectedTileId===tile.tileId);node.classList.toggle('pending',Boolean(this.pendingPair&&[this.pendingPair.tileAId,this.pendingPair.tileBId].includes(tile.tileId)));
    node.classList.toggle('match-success',this.successIds.has(tile.tileId));node.classList.toggle('match-invalid',this.invalidIds.has(tile.tileId));
    const back=node.querySelector('.tile-back');
    if(tile.flipped&&!back){const next=document.createElement('span');next.className='tile-back';next.textContent='?';next.setAttribute('aria-hidden','true');node.appendChild(next);}
    else if(!tile.flipped&&back)back.remove();
  }

  /** @param {string} tileId 선택한 ID @returns {void} */
  pick(tileId){
    if(!this.isInteractionEnabled())return;
    const tile=this.tiles.find((entry)=>entry.tileId===tileId);if(!tile||tile.removed||tile.locked)return;
    this.pickCount+=1;
    if(!this.selectedTileId){this.selectedTileId=tileId;this.feedbackKey='selectSecond';this.render(this.tiles,this.effects,this.boardRevision);return;}
    if(this.selectedTileId===tileId){this.clearSelection();this.feedbackKey='selectionCancelled';this.updateFeedback();return;}
    const first=this.selectedTileId;const requestId=this.onPair(first,tileId,this.boardRevision);
    if(!requestId)return;
    this.pairAttemptCount+=1;
    const pending={requestId,matchId:this.matchId,boardRevision:this.boardRevision,tileAId:first,tileBId:tileId,sentAt:Date.now(),timeoutId:null};
    pending.timeoutId=setTimeout(()=>{if(this.pendingPair!==pending)return;this.clearPending('timeout');this.clearSelection(false);this.feedbackKey='selectFirst';this.render(this.tiles,this.effects,this.boardRevision);},PAIR_TIMEOUT_MS);
    this.pendingPair=pending;this.feedbackKey='checkingPair';
    this.render(this.tiles,this.effects,this.boardRevision);
  }

  /** @param {object} message 서버 승인 응답 @returns {boolean} 현재 요청을 처리했는지 */
  handleAccepted(message){
    if(!this.matchesPending(message))return false;
    const ids=message.removed||[this.pendingPair.tileAId,this.pendingPair.tileBId];this.successIds=new Set(ids);this.clearPending('accepted');this.selectedTileId=null;this.feedbackKey='matchSuccess';
    this.showPath(message.path||[]);this.render(this.tiles,this.effects,this.boardRevision);this.scheduleFeedbackClear();return true;
  }

  /** @param {object} message 서버 거절 응답 @returns {boolean} 현재 요청을 처리했는지 */
  handleRejected(message){
    if(!this.matchesPending(message))return false;
    this.invalidIds=new Set([this.pendingPair.tileAId,this.pendingPair.tileBId]);this.clearPending('rejected');this.selectedTileId=null;
    this.feedbackKey=BoardView.feedbackKeyForReason(message.reason);this.render(this.tiles,this.effects,this.boardRevision);this.scheduleFeedbackClear();return true;
  }

  /** @private @param {object} message 서버 응답 @returns {boolean} 현재 경기의 현재 요청인지 */
  matchesPending(message){return Boolean(this.pendingPair&&message.requestId===this.pendingPair.requestId&&message.matchId===this.pendingPair.matchId);}

  /** @param {string} reason 정리 사유 @returns {void} pending과 타이머를 해제한다. */
  clearPending(reason){
    if(!this.pendingPair)return;
    clearTimeout(this.pendingPair.timeoutId);this.pendingPair=null;
  }

  /** @private @param {string} reason 서버 거절 사유 @returns {string} 번역 키 */
  static feedbackKeyForReason(reason){return ({FACE_MISMATCH:'invalidFace',NO_PATH:'invalidPath',LOCKED:'invalidLocked',STALE_REVISION:'invalidStale',NOT_PLAYING:'invalidPhase',MATCH_ENDED:'invalidPhase',SHUFFLE_PENDING:'invalidShuffle',INVALID_TILE:'invalidTile'})[reason]||'invalid';}

  /** @param {boolean} [update=true] 즉시 재렌더 여부 @returns {void} 선택을 해제한다. */
  clearSelection(update=true){this.selectedTileId=null;if(update){this.feedbackKey='selectFirst';this.render(this.tiles,this.effects,this.boardRevision);}}

  /** @returns {void} 선택, 대기, 경로와 일시 피드백을 모두 정리한다. */
  resetTransientState(){clearTimeout(this.feedbackTimer);this.feedbackTimer=null;this.clearPending('reset');this.selectedTileId=null;this.successIds.clear();this.invalidIds.clear();this.feedbackKey=this.interactive?'selectFirst':null;if(this.pathLayer)this.pathLayer.replaceChildren();}

  /** @private @returns {void} 일시 피드백을 기본 안내로 되돌린다. */
  scheduleFeedbackClear(){clearTimeout(this.feedbackTimer);this.feedbackTimer=setTimeout(()=>{this.successIds.clear();this.invalidIds.clear();this.feedbackKey='selectFirst';this.render(this.tiles,this.effects,this.boardRevision);},700);}

  /** @private @returns {void} 접근성 상태 문구를 갱신한다. */
  updateFeedback(){if(!this.feedback)return;this.feedback.textContent=this.feedbackKey?t(this.feedbackKey):'';this.feedback.dataset.state=this.feedbackKey||'';}

  /** @param {{x:number,y:number}[]} path 경로 @returns {void} */
  showPath(path){if(!this.pathLayer||path.length<2)return;const points=path.map((point)=>`${point.x+.5},${point.y+.5}`).join(' ');this.pathLayer.innerHTML=`<polyline points="${points}"/>`;setTimeout(()=>this.pathLayer?.replaceChildren(),520);}
}
