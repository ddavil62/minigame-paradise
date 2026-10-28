/**
 * @fileoverview 조건부 보상의 성공·실패 원인을 날짜별 JSONL로 기록한다.
 * 전투는 로그 I/O를 기다리지 않으며 기록 실패도 게임 진행에 영향을 주지 않는다.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createConditionalRewardLogger(options = {}) {
  const directory = options.directory || path.join(process.cwd(), 'logs', 'conditional-rewards');
  const now = options.now || (() => new Date());
  const appendFile = options.appendFile || fs.appendFile.bind(fs);
  const mkdir = options.mkdir || fs.mkdir.bind(fs);
  let queue = Promise.resolve();

  return {
    directory,
    log(result) {
      if (!result?.rewardId || !result?.status) return Promise.resolve(false);
      const timestamp = now();
      const record = {
        timestamp: timestamp.toISOString(),
        matchId: result.matchId || null,
        playerId: result.playerId || null,
        playerMode: result.playerMode || 'human',
        rewardId: result.rewardId,
        conditionType: result.conditionType || null,
        status: result.status,
        targetCharacter: result.targetCharacter || null,
        requiredStart: result.requiredStart || null,
        acceptedStartChars: result.acceptedStartChars || null,
        submittedWord: result.submittedWord || null,
        submittedEnd: result.submittedEnd || null,
        wordLength: Number.isFinite(result.wordLength) ? result.wordLength : null,
        elapsedMs: Number.isFinite(result.elapsedMs) ? result.elapsedMs : null,
        possibleWordCount: Number.isFinite(result.possibleWordCount) ? result.possibleWordCount : null,
        bonusDamage: Number(result.bonusDamage) || 0,
        configuredBonusDamage: Number(result.configuredBonusDamage) || 0,
      };
      const filePath = path.join(directory, `wordchain-conditional-${localDateKey(timestamp)}.jsonl`);
      queue = queue
        .catch(() => undefined)
        .then(async () => {
          await mkdir(directory, { recursive: true });
          await appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8');
          return true;
        });
      return queue;
    },
    flush() { return queue.catch(() => undefined); },
  };
}
