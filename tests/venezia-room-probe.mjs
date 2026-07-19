/**
 * Probe the venezia room state via direct WebSocket connection.
 */
import { WebSocket } from 'ws';

const URL = 'ws://localhost:3000/venezia/ws?mode=human';
console.log('Connecting to:', URL);

const ws = new WebSocket(URL);
ws.on('open', () => console.log('Connected'));
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('Received:', JSON.stringify(msg));
  if (msg.type === 'JOINED') {
    console.log(`Joined as ${msg.playerId}, waiting: ${msg.waiting}`);
    // Close after receiving
    setTimeout(() => { ws.close(); process.exit(0); }, 500);
  }
  if (msg.type === 'ERROR') {
    console.log('Error:', msg.message);
    ws.close();
    process.exit(1);
  }
});
ws.on('error', (err) => { console.error('WS error:', err.message); process.exit(1); });
ws.on('close', () => { console.log('Closed'); });

setTimeout(() => { console.log('Timeout'); ws.close(); process.exit(1); }, 5000);
