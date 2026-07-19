/**
 * Connect to venezia room, wait for game to end, then exit cleanly.
 * This drains any existing game so the room resets.
 */
import { WebSocket } from 'ws';

const ws = new WebSocket('ws://localhost:3000/venezia/ws?mode=human');
ws.on('open', () => {
  console.log('Connected');
  ws.send(JSON.stringify({ type: 'JOIN', playerName: 'DrainBot' }));
});
ws.on('message', (d) => {
  const m = JSON.parse(d.toString());
  console.log(m.type, m.playerId || '');
  if (m.type === 'GAME_OVER') {
    console.log('Game over. Closing in 1s...');
    setTimeout(() => { ws.close(); process.exit(0); }, 1000);
  }
  if (m.type === 'OPPONENT_LEFT') {
    console.log('Opponent left. Closing...');
    ws.close();
    process.exit(0);
  }
  if (m.type === 'ERROR') {
    console.log('Error:', m.message);
    ws.close();
    process.exit(1);
  }
});
ws.on('close', () => { console.log('Closed'); process.exit(0); });
ws.on('error', (e) => { console.error(e.message); process.exit(1); });
// Max 90 seconds (game should end before that)
setTimeout(() => { console.log('Timeout'); ws.close(); process.exit(0); }, 90000);
