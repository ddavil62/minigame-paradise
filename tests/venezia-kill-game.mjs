/**
 * @fileoverview 베네치아 정답 무피해 프로토콜을 관찰하는 수동 WS 진단 스크립트.
 */
import { WebSocket } from 'ws';

const ws = new WebSocket('ws://localhost:3000/venezia/ws?mode=human');
const myWords = new Map();
let gameStarted = false;
let protocolViolation = false;

ws.on('open', () => {
  console.log('Connected');
  ws.send(JSON.stringify({ type: 'JOIN', playerName: 'Cleaner' }));
});

ws.on('message', (d) => {
  const m = JSON.parse(d.toString());
  switch (m.type) {
    case 'JOINED':
      console.log(`Joined as ${m.playerId}`);
      break;
    case 'GAME_START':
      gameStarted = true;
      console.log('Game started!');
      break;
    case 'WORD_ADDED':
      if (m.word) {
        myWords.set(m.word.id, m.word);
        // Auto-submit immediately
        setTimeout(() => submitWord(m.word.id, m.word.text), 100);
      }
      break;
    case 'WORD_CLEARED':
      myWords.delete(m.wordId);
      if ('attackDamage' in m) protocolViolation = true;
      console.log('Word cleared without attack payload');
      break;
    case 'WORDS_EXPIRED':
      if (m.wordIds) m.wordIds.forEach(id => myWords.delete(id));
      break;
    case 'STATE':
      if (m.players) {
        const hps = m.players.map(p => `${p.id}:${p.hp}`).join(' ');
        console.log(`HP: ${hps}`);
        if (m.players.some((player) => player.hp !== 100)) protocolViolation = true;
      }
      break;
    case 'GAME_OVER':
      console.log(`GAME OVER! Winner: ${m.winner}`);
      setTimeout(() => { ws.close(); process.exit(0); }, 1000);
      break;
    case 'HIT':
      protocolViolation = true;
      break;
    case 'ERROR':
      if (m.message && m.message.includes('가득')) {
        console.log('Room full. Cannot enter.');
        ws.close();
        process.exit(1);
      }
      break;
    case 'ITEM_GRANTED':
      console.log(`Got item: ${m.emoji} ${m.name} in slot ${m.slotIndex}`);
      break;
    case 'ITEM_EFFECT_START':
      console.log(`Effect: ${m.effect} on ${m.targetId}`);
      break;
    default:
      break;
  }
});

function submitWord(wordId, text) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'WORD_SUBMIT', wordId, text }));
}

ws.on('close', () => { console.log('Closed'); process.exit(0); });
ws.on('error', (e) => { console.error(e.message); process.exit(1); });
setTimeout(() => {
  console.log(protocolViolation ? 'Protocol violation detected' : 'No attack payload/HIT observed');
  ws.close();
  process.exit(protocolViolation ? 1 : 0);
}, 10000);
