/**
 * @fileoverview kr_korean.csv (국립국어원 표준국어대사전 표제어) → words.json 변환 빌드 스크립트.
 *
 * 사용법:
 *   node scripts/build-wordlist.js [csv_path]
 *   기본 CSV 경로: data/kr_korean.csv
 *
 * 출력: data/words.json — { "words": ["가나", "나라", ...] }
 *
 * 필터 조건:
 *   1. 품사: 명사 (동사/형용사/어미/접사/조사 등 제외)
 *   2. 한글 전용: /^[가-힣]+$/
 *   3. 최소 2글자 이상
 *   4. 중복 제거
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

// ── 인자 파싱 ──
const csvPath = process.argv[2] || path.join(ROOT, 'data', 'kr_korean.csv');
const outPath = path.join(ROOT, 'data', 'words.json');

// ── 유효 품사 목록 ──
const VALID_POS = new Set([
  '명사',
]);

// ── 한글 전용 패턴 ──
const HANGUL_RE = /^[가-힣]+$/;

console.log(`[build-wordlist] CSV 읽기: ${csvPath}`);
const raw = fs.readFileSync(csvPath, 'utf8');

// BOM 제거
const content = raw.replace(/^\uFEFF/, '');
const lines = content.split(/\r?\n/).filter(Boolean);

const wordSet = new Set();
let skippedPos = 0;
let skippedHangul = 0;
let skippedLength = 0;

for (const line of lines) {
  const commaIdx = line.indexOf(',');
  if (commaIdx === -1) continue;

  const word = line.slice(0, commaIdx).trim();
  const pos = line.slice(commaIdx + 1).trim();

  // 접사 기호 제거 (예: -가 → 가)
  if (word.startsWith('-')) continue;

  // 품사 필터
  if (!VALID_POS.has(pos)) {
    skippedPos++;
    continue;
  }

  // 한글 전용 필터
  if (!HANGUL_RE.test(word)) {
    skippedHangul++;
    continue;
  }

  // 최소 2글자
  if (word.length < 2) {
    skippedLength++;
    continue;
  }

  wordSet.add(word);
}

const words = [...wordSet].sort();

console.log(`[build-wordlist] 통계:`);
console.log(`  전체 라인: ${lines.length}`);
console.log(`  품사 제외: ${skippedPos}`);
console.log(`  비한글 제외: ${skippedHangul}`);
console.log(`  1글자 제외: ${skippedLength}`);
console.log(`  최종 단어 수: ${words.length}`);

// ── 초성별 분포 출력 (가비지 후보 판단용) ──
const initialsCount = new Map();
for (const w of words) {
  const first = w[0];
  initialsCount.set(first, (initialsCount.get(first) || 0) + 1);
}

const sorted = [...initialsCount.entries()].sort((a, b) => b[1] - a[1]);
console.log(`\n[build-wordlist] 시작 글자 분포 (상위 30):`);
for (const [ch, cnt] of sorted.slice(0, 30)) {
  console.log(`  ${ch}: ${cnt}`);
}

const under50 = sorted.filter(([, cnt]) => cnt < 50);
console.log(`\n[build-wordlist] 유효 단어 50개 미만 글자 (가비지 후보 제외 대상):`);
for (const [ch, cnt] of under50) {
  console.log(`  ${ch}: ${cnt}`);
}

// ── JSON 저장 ──
fs.writeFileSync(outPath, JSON.stringify({ words }), 'utf8');
const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(1);
console.log(`\n[build-wordlist] 저장 완료: ${outPath} (${sizeKB} KB)`);
