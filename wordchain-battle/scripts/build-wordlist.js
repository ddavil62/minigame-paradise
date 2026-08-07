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
 *   2. 형태소 경계 하이픈 제거 후 한글 전용: /^[가-힣]+$/
 *      (표준국어대사전 원문은 합성명사의 형태소 경계를 하이픈으로 표기한다.
 *       예: "자동-차", "비행-기", "선생-님". 실제 표기는 하이픈 없이 붙여 쓰므로
 *       한글 검사 전에 하이픈을 제거해야 "자동차", "비행기" 같은 흔한 합성명사가
 *       누락되지 않는다. 반면 "^"(공백 표기, 예: "국제^자동차^연맹")는 별도 단어로
 *       띄어 쓰는 구(句)이므로 제거하지 않고 그대로 필터링 대상에 남긴다.)
 *   3. 최소 2글자 이상
 *   4. 중복 제거
 *
 * 보충 단어(data/supplement-words.json):
 *   표준국어대사전은 국가 공인 규범 사전이라 연예인/캐릭터 등 현대 고유명사를
 *   등재하지 않는다("유재석", "람보" 등은 원본 CSV 어디에도 없음. CSV의
 *   "인명"/"지명" 품사 태그도 대부분 외국 역사인물·다단어 표기라 실질 도움이 안 됨).
 *   이런 고유명사는 별도로 수동 큐레이션한 data/supplement-words.json을 만들어
 *   본 사전과 병합한다. 이 파일은 카테고리별 객체로 구성되며 빌드 시 전부
 *   평탄화하여 동일한 한글/길이 검증을 거친 뒤 wordSet에 추가된다.
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
const supplementPath = path.join(ROOT, 'data', 'supplement-words.json');

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

  const rawWord = line.slice(0, commaIdx).trim();
  const pos = line.slice(commaIdx + 1).trim();

  // 접사 기호 제거 (예: -가 → 가)
  if (rawWord.startsWith('-')) continue;

  // 품사 필터
  if (!VALID_POS.has(pos)) {
    skippedPos++;
    continue;
  }

  // 형태소 경계 하이픈 제거: "자동-차" → "자동차" (실제 표기는 붙여 쓴다)
  const word = rawWord.replace(/-/g, '');

  // 한글 전용 필터 (하이픈 제거 후에도 "^"(구 표시) 등이 남으면 제외)
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

const dictWordCount = wordSet.size;

// ── 보충 단어(연예인/캐릭터 등 고유명사) 병합 ──
let supplementAdded = 0;
if (fs.existsSync(supplementPath)) {
  const supplement = JSON.parse(fs.readFileSync(supplementPath, 'utf8'));
  for (const [category, list] of Object.entries(supplement)) {
    if (category.startsWith('_') || !Array.isArray(list)) continue;
    for (const rawWord of list) {
      const word = String(rawWord).trim();
      if (!HANGUL_RE.test(word) || word.length < 2) continue;
      if (!wordSet.has(word)) supplementAdded++;
      wordSet.add(word);
    }
  }
  console.log(`[build-wordlist] 보충 단어(고유명사) 병합: +${supplementAdded}개`);
}

const words = [...wordSet].sort();

console.log(`[build-wordlist] 통계:`);
console.log(`  전체 라인: ${lines.length}`);
console.log(`  품사 제외: ${skippedPos}`);
console.log(`  비한글 제외: ${skippedHangul}`);
console.log(`  1글자 제외: ${skippedLength}`);
console.log(`  사전 단어 수: ${dictWordCount}`);
console.log(`  최종 단어 수(보충 포함): ${words.length}`);

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
