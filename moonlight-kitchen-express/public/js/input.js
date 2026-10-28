/** @fileoverview 키보드 상태와 상호작용 상승 에지를 30Hz 메시지로 변환한다. */
const state = { up:false,down:false,left:false,right:false,interact:false,work:false,drop:false };
const mapping = Object.freeze({ KeyW:'up',ArrowUp:'up',KeyS:'down',ArrowDown:'down',KeyA:'left',ArrowLeft:'left',KeyD:'right',ArrowRight:'right',KeyE:'interact',Enter:'interact',Space:'work',KeyQ:'drop' });
let seq = 0;
let enabled = true;
let activeSend = null;

/** 모든 조작 상태를 중립으로 되돌린다. @returns {void} */
function resetState() { for (const action of Object.keys(state)) state[action] = false; }

/** 게임 입력 허용 여부를 바꾸며, 차단 시 눌린 키 상태도 즉시 해제한다. @param {boolean} next 허용 여부 @returns {void} */
export function setInputEnabled(next) { enabled = Boolean(next); if (!enabled) { resetState(); activeSend?.({ type:'INPUT', seq:seq++, ...state }); } }

/** @param {KeyboardEvent} event 키 이벤트 @returns {boolean} 게임 키 처리 여부 */
function updateKey(event) { if (!enabled || event.target instanceof HTMLButtonElement || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return false; const action = mapping[event.code]; if (!action) return false; state[action] = event.type === 'keydown'; event.preventDefault(); return true; }

/**
 * 입력 수집기를 시작한다.
 * @param {(message:object)=>void} send 전송 함수
 * @param {(action:string)=>void} [onAction] 키 누름 피드백
 * @returns {()=>void} 정리 함수
 */
export function startInput(send,onAction=()=>{}) { activeSend=send; const down = (event) => { const wasDown=Boolean(state[mapping[event.code]]); if(updateKey(event)&&!wasDown)onAction(mapping[event.code]); }; const up = (event) => updateKey(event); window.addEventListener('keydown', down); window.addEventListener('keyup', up); const timer = setInterval(() => send({ type:'INPUT', seq:seq++, ...state }), 1000/30); return () => { clearInterval(timer); activeSend=null; window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); }; }
