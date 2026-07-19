/**
 * Test venezia AI game flow via direct WebSocket.
 */
import { WebSocket } from 'ws';

const URL_HUMAN = 'ws://localhost:3000/venezia/ws?mode=ai';

console.log('Connecting human as mode=ai...');
const ws = new WebSocket(URL_HUMAN);
const messages = [];

ws.on('open', () => {
  console.log('Human connected');
  // Send JOIN after 300ms (same as client)
  setTimeout(() => {
    ws.send(JSON.stringify({ type: 'JOIN', playerName: 'TestHuman' }));
    console.log('JOIN sent');
  }, 300);
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  messages.push(msg.type);
  console.log(`[${(Date.now() % 100000)}ms] Received: ${msg.type}`, JSON.stringify(msg).slice(0, 200));

  if (msg.type === 'GAME_START') {
    console.log('\n=== GAME STARTED SUCCESSFULLY ===');
    setTimeout(() => {
      ws.close();
      process.exit(0);
    }, 2000);
  }
  if (msg.type === 'ERROR') {
    console.log('ERROR:', msg.message);
    ws.close();
    process.exit(1);
  }
});

ws.on('error', (err) => {
  console.error('WS error:', err.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('Connection closed');
  console.log('Messages received:', messages.join(', '));
});

// Timeout after 15 seconds
setTimeout(() => {
  console.log('\n=== TIMEOUT - Game did not start in 15s ===');
  console.log('Messages received:', messages.join(', '));
  ws.close();
  process.exit(1);
}, 15000);
