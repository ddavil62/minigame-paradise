/**
 * @fileoverview 수집된 누락 후보 JSONL을 빈도순으로 요약한다.
 * 사용: node scripts/review-missing-words.js [--min-count 2] [--limit 100]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWords } from '../words.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const logDirectory = path.join(root, 'logs', 'dictionary-candidates');
const argValue = (name, fallback) => {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? Number(process.argv[index + 1]) : fallback;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};
const minCount = argValue('--min-count', 2);
const limit = argValue('--limit', 100);

if (!fs.existsSync(logDirectory)) {
  console.log('수집된 누락 단어 로그가 없습니다.');
  process.exit(0);
}

const dictionary = loadWords();
const candidates = new Map();
for (const name of fs.readdirSync(logDirectory).filter((value) => /^wordchain-missing-\d{4}-\d{2}-\d{2}\.jsonl$/.test(value)).sort()) {
  const lines = fs.readFileSync(path.join(logDirectory, name), 'utf8').split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    try {
      const record = JSON.parse(line);
      if (typeof record.word !== 'string' || dictionary.has(record.word)) continue;
      const current = candidates.get(record.word) || { count: 0, starts: new Set(), lastSeen: '' };
      current.count += 1;
      if (record.expectedStart) current.starts.add(record.expectedStart);
      if (record.timestamp > current.lastSeen) current.lastSeen = record.timestamp;
      candidates.set(record.word, current);
    } catch (_) {
      // 한 줄이 손상돼도 나머지 운영 로그 검토는 계속한다.
    }
  }
}

const rows = [...candidates.entries()]
  .filter(([, value]) => value.count >= minCount)
  .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0], 'ko'))
  .slice(0, limit)
  .map(([word, value]) => ({
    word,
    count: value.count,
    expectedStart: [...value.starts].join(','),
    lastSeen: value.lastSeen.slice(0, 10),
  }));

if (rows.length === 0) console.log(`검토 기준(${minCount}회 이상)에 맞는 신규 후보가 없습니다.`);
else console.table(rows);
