import test from 'node:test';
import assert from 'node:assert/strict';
import { createConditionalRewardLogger } from '../conditional-reward-log.js';

test('정밀타 분석 로그는 실패 원인과 사전 가능 단어 수를 JSONL로 보존한다', async () => {
  const writes = [];
  const logger = createConditionalRewardLogger({
    directory: 'virtual-logs',
    now: () => new Date('2026-08-15T12:34:56.000Z'),
    mkdir: async () => undefined,
    appendFile: async (filePath, data) => { writes.push({ filePath, data }); },
  });
  await logger.log({
    matchId: 'match-1',
    playerId: 'p1',
    playerMode: 'human',
    rewardId: 'conditional_precision',
    conditionType: 'target_ending',
    status: 'FAILED_IMPOSSIBLE',
    targetCharacter: '력',
    requiredStart: '다',
    acceptedStartChars: null,
    submittedWord: '다라마바',
    submittedEnd: '바',
    wordLength: 4,
    possibleWordCount: 0,
    bonusDamage: 0,
    configuredBonusDamage: 10,
  });
  await logger.flush();

  assert.equal(writes.length, 1);
  assert.match(writes[0].filePath, /wordchain-conditional-2026-08-15\.jsonl$/);
  const record = JSON.parse(writes[0].data);
  assert.equal(record.status, 'FAILED_IMPOSSIBLE');
  assert.equal(record.possibleWordCount, 0);
  assert.equal(record.targetCharacter, '력');
  assert.equal(record.configuredBonusDamage, 10);
});
