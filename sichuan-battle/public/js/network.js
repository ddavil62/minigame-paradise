/**
 * @fileoverview WebSocket 연결, 재접속 토큰과 요청 식별자를 캡슐화한다.
 */
export class GameNetwork extends EventTarget {
  /** @param {string} name 표시 이름 */ constructor(name){super();this.name=name;this.socket=null;this.sequence=0;this.connect();}
  /** @returns {void} 서버에 연결한다. */ connect(){const protocol=location.protocol==='https:'?'wss':'ws';const token=sessionStorage.getItem('sichuan:token')||'';this.socket=new WebSocket(`${protocol}://${location.host}/sichuan-battle/ws?name=${encodeURIComponent(this.name)}&sessionToken=${encodeURIComponent(token)}`);this.socket.addEventListener('message',(event)=>{let message;try{message=JSON.parse(event.data);}catch{return;}if(message.type==='JOINED')sessionStorage.setItem('sichuan:token',message.sessionToken);this.dispatchEvent(new CustomEvent('message',{detail:message}));});this.socket.addEventListener('close',()=>setTimeout(()=>this.connect(),900));}
  /** @param {object} payload 메시지 @returns {string} 요청 ID */ send(payload){const requestId=payload.requestId||`${Date.now()}-${++this.sequence}`;if(this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify({...payload,requestId}));return requestId;}
}
