/**
 * @fileoverview WebSocket 연결, 재접속 토큰과 실제 전송된 요청 식별자를 캡슐화한다.
 */
export class GameNetwork extends EventTarget {
  /** @param {string} name 표시 이름 */
  constructor(name){
    super();this.name=name;this.socket=null;this.sequence=0;this.closed=false;this.reconnectTimer=null;this.socketGeneration=0;
    const parameters=new URLSearchParams(location.search);this.lobbyReady=parameters.get('lobbyReady')==='1';
    if(parameters.get('fresh')==='1'){
      sessionStorage.removeItem('sichuan:token');parameters.delete('fresh');
      const search=parameters.toString();history.replaceState(history.state,'',`${location.pathname}${search?`?${search}`:''}${location.hash}`);
    }
    this.connect();
  }

  /** @returns {void} 서버에 연결한다. */
  connect(){
    if(this.closed)return;
    clearTimeout(this.reconnectTimer);this.reconnectTimer=null;
    const protocol=location.protocol==='https:'?'wss':'ws';const token=sessionStorage.getItem('sichuan:token')||'';const generation=++this.socketGeneration;
    const socket=new WebSocket(`${protocol}://${location.host}/sichuan-battle/ws?name=${encodeURIComponent(this.name)}&sessionToken=${encodeURIComponent(token)}&lobbyReady=${this.lobbyReady?'1':'0'}`);this.socket=socket;
    socket.addEventListener('open',()=>{if(this.socket===socket&&generation===this.socketGeneration)this.dispatchEvent(new CustomEvent('connectionstate',{detail:{connected:true,generation}}));});
    socket.addEventListener('message',(event)=>{if(this.socket!==socket||generation!==this.socketGeneration)return;let message;try{message=JSON.parse(event.data);}catch{return;}if(message.type==='JOINED')sessionStorage.setItem('sichuan:token',message.sessionToken);this.dispatchEvent(new CustomEvent('message',{detail:message}));});
    socket.addEventListener('close',()=>{if(this.socket!==socket||generation!==this.socketGeneration)return;this.dispatchEvent(new CustomEvent('connectionstate',{detail:{connected:false,generation}}));if(!this.closed)this.reconnectTimer=setTimeout(()=>this.connect(),900);});
  }

  /** @param {object} payload 메시지 @returns {string|null} 실제 전송 성공 시 요청 ID */
  send(payload){
    if(this.socket?.readyState!==WebSocket.OPEN)return null;
    const requestId=payload.requestId||`${Date.now()}-${++this.sequence}`;
    try{this.socket.send(JSON.stringify({...payload,requestId}));return requestId;}
    catch{this.dispatchEvent(new CustomEvent('connectionstate',{detail:{connected:false,generation:this.socketGeneration}}));return null;}
  }

  /** @returns {void} 명시적으로 방을 떠나고 자동 재접속을 중단한다. */
  leave(){this.closed=true;clearTimeout(this.reconnectTimer);this.reconnectTimer=null;this.send({type:'LEAVE_MATCH'});setTimeout(()=>this.socket?.close(),80);}
}
