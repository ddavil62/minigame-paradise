import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizePresenceState,
  pruneChatHistory,
  sanitizeChatText,
  sanitizePresenceName,
} from '../launcher/presence.js';

const gamesMap = new Map([
  ['matgo', { id: 'matgo' }],
  ['yutnori', { id: 'yutnori' }],
]);

test('presence nickname removes control and bidi characters and limits length', () => {
  assert.equal(sanitizePresenceName('  철\u0000수\u202e  '), '철수');
  assert.equal(sanitizePresenceName('abcdefghijklmnop'), 'abcdefghijkl');
  assert.equal(sanitizePresenceName(null), '');
});

test('presence state only accepts known games and statuses', () => {
  assert.deepEqual(normalizePresenceState({ name: '영희', status: 'waiting', gameId: 'matgo' }, gamesMap), {
    name: '영희',
    status: 'waiting',
    gameId: 'matgo',
  });
  assert.deepEqual(normalizePresenceState({ name: '영희', status: 'playing', gameId: 'unknown' }, gamesMap), {
    name: '영희',
    status: 'lobby',
    gameId: null,
  });
  assert.equal(normalizePresenceState({ name: '   ', status: 'lobby' }, gamesMap), null);
});

test('chat text keeps line breaks but removes controls and enforces the message limit', () => {
  assert.equal(sanitizeChatText('  안녕\r\n친구\u0000\u202e  '), '안녕\n친구');
  assert.equal(Array.from(sanitizeChatText('가'.repeat(550))).length, 500);
  assert.equal(sanitizeChatText(null), '');
});

test('chat cleanup removes expired records and retains only the newest 100 messages', () => {
  const messages = Array.from({ length: 105 }, (_, index) => ({ id: String(index), sentAt: index + 1 }));
  messages.unshift({ id: 'expired', sentAt: 0 });
  const fresh = pruneChatHistory(messages, 1);
  assert.equal(fresh.length, 100);
  assert.equal(fresh[0].id, '5');
  assert.equal(fresh.at(-1).id, '104');
  assert.deepEqual(pruneChatHistory(null, 1), []);
});
