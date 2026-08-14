/**
 * @fileoverview 사전에 없어 거절된 한글 단어 후보를 날짜별 JSONL로 기록한다.
 * 게임 처리는 로그 I/O를 기다리지 않으며 기록 실패가 전투를 중단시키지 않는다.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const SAFE_WORD = /^[가-힣]{2,30}$/;

/** @param {Date} date */
function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
/**
 * @param {object} [options]
 * @param {string} [options.directory]
 * @param {() => Date} [options.now]
 * @param {(path:string, data:string, encoding:string) => Promise<void>} [options.appendFile]
 * @param {(path:string, options:object) => Promise<void>} [options.mkdir]
 */
export function createMissingWordLogger(options = {}) {
  const directory = options.directory || path.join(process.cwd(), 'logs', 'dictionary-candidates');
  const now = options.now || (() => new Date());
  const appendFile = options.appendFile || fs.appendFile.bind(fs);
  const mkdir = options.mkdir || fs.mkdir.bind(fs);
  let queue = Promise.resolve();

  return {
    directory,

    /**
     * @param {{word:string, expectedStart:string|null, acceptedStartChars:string[], previousWord:string|null, playerMode:string}} candidate
     */
    log(candidate) {
      const word = typeof candidate?.word === 'string' ? candidate.word.normalize('NFC') : '';
      if (!SAFE_WORD.test(word)) return Promise.resolve(false);
      const timestamp = now();
      const record = {
        timestamp: timestamp.toISOString(),
        word,
        expectedStart: candidate.expectedStart || null,
        acceptedStartChars: Array.isArray(candidate.acceptedStartChars)
          ? [...new Set(candidate.acceptedStartChars.filter((value) => typeof value === 'string' && /^[가-힣]$/.test(value)))]
          : [],
        previousWord: typeof candidate.previousWord === 'string' ? candidate.previousWord : null,
        playerMode: ['human', 'ai', 'bot'].includes(candidate.playerMode) ? candidate.playerMode : 'human',
      };
      const filePath = path.join(directory, `wordchain-missing-${localDateKey(timestamp)}.jsonl`);
      queue = queue
        .catch(() => undefined)
        .then(async () => {
          await mkdir(directory, { recursive: true });
          await appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8');
          return true;
        });
      return queue;
    },

    /** 테스트·정상 종료 시 대기 중인 append를 모두 기다린다. */
    flush() { return queue.catch(() => undefined); },
  };
}
