import { WebSocket } from 'ws';
const ws = new WebSocket('ws://localhost:3000/venezia/ws?mode=human');
ws.on('open', () => console.log('connected'));
ws.on('message', (d) => {
  const m = JSON.parse(d.toString());
  if (m.type === 'JOINED') {
    console.log('JOINED as', m.playerId, 'waiting:', m.waiting);
  } else if (m.type === 'GAME_START') {
    console.log('GAME_START received');
  } else if (m.type === 'OPPONENT_LEFT') {
    console.log('OPPONENT_LEFT - room should be clean now');
  } else {
    console.log(m.type);
  }
});
setTimeout(() => { ws.close(); console.log('closing...'); }, 3000);
ws.on('close', () => { console.log('closed'); process.exit(0); });
ws.on('error', (e) => { console.error(e.message); process.exit(1); });
setTimeout(() => process.exit(2), 5000);
