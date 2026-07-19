/** @fileoverview 키보드 상태와 상호작용 상승 에지를 30Hz 메시지로 변환한다. */
const state = { up:false,down:false,left:false,right:false,interact:false,work:false,drop:false };
const mapping = Object.freeze({ KeyW:'up',ArrowUp:'up',KeyS:'down',ArrowDown:'down',KeyA:'left',ArrowLeft:'left',KeyD:'right',ArrowRight:'right',KeyE:'interact',Enter:'interact',Space:'work',KeyQ:'drop' });
let seq = 0;

/** @param {KeyboardEvent} event 키 이벤트 @returns {boolean} 게임 키 처리 여부 */
function updateKey(event) { if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLInputElement) return false; const action = mapping[event.code]; if (!action) return false; state[action] = event.type === 'keydown'; event.preventDefault(); return true; }

/**
 * 입력 수집기를 시작한다.
 * @param {(message:object)=>void} send 전송 함수
 * @returns {()=>void} 정리 함수
 */
export function startInput(send) { const down = (event) => updateKey(event); const up = (event) => updateKey(event); window.addEventListener('keydown', down); window.addEventListener('keyup', up); const timer = setInterval(() => send({ type:'INPUT', seq:seq++, ...state }), 1000/30); return () => { clearInterval(timer); window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); }; }
