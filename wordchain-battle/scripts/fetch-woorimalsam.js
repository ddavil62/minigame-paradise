/**
 * @fileoverview 국립국어원 우리말샘(opendict.korean.go.kr) 오픈 API에서
 * 표준국어대사전(words.json) 기반 단어풀에 없는 명사를 보강 수집한다.
 *
 * 사용법:
 *   WOORIMALSAM_API_KEY=<발급받은 키> node scripts/fetch-woorimalsam.js
 *   (또는) node scripts/fetch-woorimalsam.js <키>
 *
 * 인증키 발급:
 *   https://opendict.korean.go.kr/service/openApiInfo 에서 본인 계정으로 로그인 후
 *   "오픈 API 신청"으로 발급받는다(신청 즉시 승인). 이 저장소나 커밋에 키 값을
 *   남기지 말 것 — 반드시 환경변수로만 전달한다.
 *
 * 수집 방식 (검색 API 기반 접두사 순회):
 *   1. 기존 words.json에서 실제 쓰이는 1음절 시작 글자를 시드로 사용한다.
 *   2. 각 접두사에 advanced search(pos=명사, method=start, type1=word,
 *      type3=general)로 질의한다. total 필드는 이 필터들을 반영하지 않아
 *      실제보다 훨씬 크게 나오는 경우가 있으므로 신뢰하지 않는다. 대신
 *      페이지(num=100)가 꽉 차지 않는 시점(=실제 결과 소진)까지 순차 조회한다.
 *   3. API의 start 파라미터 상한(1000)에 도달했는데도 여전히 페이지가 꽉 차면
 *      "그 접두사로는 다 못 받음"으로 보고 다음 단계로 세분화한다.
 *   4. 세분화 시 기존 words.json에서 해당 접두사로 시작하는 다음 음절 접두사
 *      목록을 뽑아 그걸로 나눠 재귀 검색한다(MAX_DEPTH까지). 표준국어대사전이
 *      이미 26만 단어를 커버하므로 이 방식은 무작위 조합 폭발 없이 실제
 *      존재하는 접두사만 순회한다.
 *   5. 이미 words.json/supplement-words.json에 있는 단어는 제외하고 신규
 *      단어만 data/woorimalsam-words.json에 저장한다.
 *   6. 진행 상황은 data/.woorimalsam-progress.json에 체크포인트로 남겨,
 *      API 호출 제한이나 중단 후 재실행 시 이어서 수집한다.
 *
 * 결과 병합:
 *   build-wordlist.js가 data/woorimalsam-words.json을 supplement-words.json과
 *   동일한 방식으로 words.json 생성 시 병합한다.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

const API_KEY = process.env.WOORIMALSAM_API_KEY || process.argv[2];
if (!API_KEY) {
  console.error('사용법: WOORIMALSAM_API_KEY=<키> node scripts/fetch-woorimalsam.js');
  console.error('  (또는) node scripts/fetch-woorimalsam.js <키>');
  console.error('  키 발급: https://opendict.korean.go.kr/service/openApiInfo');
  process.exit(1);
}

const WORDS_PATH = path.join(ROOT, 'data', 'words.json');
const SUPPLEMENT_PATH = path.join(ROOT, 'data', 'supplement-words.json');
const OUT_PATH = path.join(ROOT, 'data', 'woorimalsam-words.json');
const PROGRESS_PATH = path.join(ROOT, 'data', '.woorimalsam-progress.json');

const API_BASE = 'https://opendict.korean.go.kr/api/search';
const REQUEST_DELAY_MS = 300;
const PAGE_SIZE = 100; // num 최대값
const MAX_START = 1000; // start 최대값
const MAX_REACHABLE = MAX_START + PAGE_SIZE; // 접두사 1개당 조회 가능한 최대 건수
const MAX_DEPTH = 4; // 접두사 세분화 최대 음절 수

const HANGUL_RE = /^[가-힣]+$/;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 우리말샘 검색 API(advanced=y)에서 한 페이지를 가져온다.
 * @param {string} prefix 검색어(접두사)
 * @param {number} start 시작 번호(1~1000)
 * @returns {Promise<{total: number, items: Array<{word: string}>}>}
 */
async function searchPage(prefix, start) {
  const url = new URL(API_BASE);
  url.searchParams.set('key', API_KEY);
  url.searchParams.set('q', prefix);
  url.searchParams.set('req_type', 'json');
  url.searchParams.set('advanced', 'y');
  url.searchParams.set('target', '1'); // 어휘(표제어)
  url.searchParams.set('method', 'start'); // 접두사 일치
  url.searchParams.set('pos', '1'); // 명사
  url.searchParams.set('type1', 'word'); // 구/관용구/속담 제외, 단어만
  url.searchParams.set('type3', 'general'); // 방언/북한어/옛말 제외, 일반어만
  url.searchParams.set('start', String(start));
  url.searchParams.set('num', String(PAGE_SIZE));

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} (prefix="${prefix}", start=${start})`);
  }
  const data = await res.json();
  if (data.error) {
    throw new Error(`[우리말샘 API 오류 ${data.error.error_code}] ${data.error.message} (prefix="${prefix}")`);
  }

  const channel = data.channel;
  const total = Number(channel.total) || 0;
  const rawItems = channel.item;
  const items = Array.isArray(rawItems) ? rawItems : (rawItems ? [rawItems] : []);
  return { total, items };
}

/**
 * 접두사 하나에 대해 API가 조회 가능한 범위까지 전량 수집한다.
 * @param {string} prefix
 * @param {Set<string>} collected 수집 결과를 누적할 Set
 * @returns {Promise<{total: number, truncated: boolean}>}
 */
async function collectPrefix(prefix, collected) {
  let start = 1;
  let reportedTotal = 0;
  let truncated = false;

  // total 필드는 pos/type1/type3 필터 적용 전 개수를 반환해 실제 조회 가능한
  // 건수보다 훨씬 크게 나오는 경우가 있다(API 문서에 없는 특이 동작). 그래서
  // total을 신뢰하지 않고, 페이지가 꽉 차지 않을 때(자연 소진)까지 계속
  // 조회하는 방식으로 판단한다.
  for (;;) {
    const page = await searchPage(prefix, start);
    reportedTotal = page.total;
    for (const item of page.items) {
      if (typeof item.word === 'string') collected.add(item.word);
    }
    await sleep(REQUEST_DELAY_MS);

    if (page.items.length < PAGE_SIZE) break; // 실제 결과 소진
    if (start >= MAX_START) { truncated = true; break; } // API의 start 상한(1000) 도달

    start = Math.min(start + PAGE_SIZE, MAX_START);
  }

  return { total: reportedTotal, truncated };
}

/**
 * 기존 단어 목록에서 prefix로 시작하며 한 음절 더 긴 접두사들을 뽑는다.
 * (무작위 조합이 아닌, 실제 존재하는 접두사만 재귀 대상으로 삼기 위함)
 * @param {Iterable<string>} existingWords
 * @param {string} prefix
 * @returns {string[]}
 */
function getKnownExtensions(existingWords, prefix) {
  const nextLen = prefix.length + 1;
  const set = new Set();
  for (const w of existingWords) {
    if (w.length >= nextLen && w.startsWith(prefix)) set.add(w.slice(0, nextLen));
  }
  return [...set];
}

function loadProgress() {
  if (!fs.existsSync(PROGRESS_PATH)) return { done: new Set(), collected: new Set() };
  const raw = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
  return { done: new Set(raw.done || []), collected: new Set(raw.collected || []) };
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify({
    done: [...progress.done],
    collected: [...progress.collected],
  }));
}

/**
 * 접두사를 재귀적으로 순회하며 수집한다. 이미 완료된 접두사는 건너뛴다(재실행 재개).
 * @param {string} prefix
 * @param {number} depth
 * @param {Set<string>} existingWords 재귀 세분화용 기존 단어 인덱스
 * @param {{done: Set<string>, collected: Set<string>}} progress
 */
async function crawlPrefix(prefix, depth, existingWords, progress) {
  if (progress.done.has(prefix)) return;

  const { total, truncated } = await collectPrefix(prefix, progress.collected);
  console.log(`[woorimalsam] "${prefix}" (depth=${depth}) total=${total}${truncated ? ' → 세분화' : ''} | 누적 신규 후보 ${progress.collected.size}개`);

  if (truncated && depth < MAX_DEPTH) {
    const extensions = getKnownExtensions(existingWords, prefix);
    if (extensions.length > 0) {
      for (const ext of extensions) {
        await crawlPrefix(ext, depth + 1, existingWords, progress);
      }
    } else {
      console.log(`  ↳ "${prefix}": 세분화할 기존 접두사가 없어 상위 ${MAX_REACHABLE}건까지만 수집됨(한계 도달)`);
    }
  }

  progress.done.add(prefix);
  saveProgress(progress);
}

async function main() {
  const wordsData = JSON.parse(fs.readFileSync(WORDS_PATH, 'utf8'));
  const existingWords = new Set(wordsData.words);

  if (fs.existsSync(SUPPLEMENT_PATH)) {
    const supplement = JSON.parse(fs.readFileSync(SUPPLEMENT_PATH, 'utf8'));
    for (const [category, list] of Object.entries(supplement)) {
      if (category.startsWith('_') || !Array.isArray(list)) continue;
      for (const w of list) existingWords.add(String(w).trim());
    }
  }

  const seeds = new Set();
  for (const w of existingWords) {
    if (w.length >= 1) seeds.add(w[0]);
  }
  console.log(`[woorimalsam] 시드 접두사(1음절 시작 글자) ${seeds.size}개, 기존 단어 ${existingWords.size}개 기준 신규 단어만 수집합니다.`);

  const progress = loadProgress();
  console.log(`[woorimalsam] 진행 상황 로드: 완료된 접두사 ${progress.done.size}개, 누적 후보 ${progress.collected.size}개`);

  let seedIndex = 0;
  for (const seed of seeds) {
    seedIndex += 1;
    try {
      await crawlPrefix(seed, 1, existingWords, progress);
    } catch (err) {
      console.error(`[woorimalsam] "${seed}" 처리 중 오류로 중단: ${err.message}`);
      console.error(`[woorimalsam] 진행 상황은 저장되었습니다. 나중에 다시 실행하면 이어서 진행합니다. (시드 ${seedIndex}/${seeds.size})`);
      saveProgress(progress);
      process.exitCode = 1;
      return;
    }
  }

  // ── 신규 단어만 필터링해 결과 저장 ──
  const newWords = [...progress.collected]
    .filter((w) => HANGUL_RE.test(w) && w.length >= 2 && !existingWords.has(w))
    .sort();

  fs.writeFileSync(OUT_PATH, JSON.stringify({
    _comment: '우리말샘 오픈 API에서 수집한, 표준국어대사전(words.json)에 없는 신규 명사. build-wordlist.js가 words.json 생성 시 병합한다.',
    우리말샘_보강: newWords,
  }, null, 2), 'utf8');

  console.log(`[woorimalsam] 완료: 신규 단어 ${newWords.length}개 저장 → ${OUT_PATH}`);
  console.log(`[woorimalsam] npm run build-words 를 실행해 words.json에 반영하세요.`);
}

main();
