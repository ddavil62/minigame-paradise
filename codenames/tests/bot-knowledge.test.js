/**
 * @fileoverview 코드네임 봇 정적 태그맵(bot-knowledge.js) 단위 검증.
 *
 * 실행: node codenames/tests/bot-knowledge.test.js   (네트워크 0, 격리 불필요)
 *
 * 검증 범위:
 *   [A] 커버리지 — WORDS 590단어 100% 매핑(미매핑 0, 빈 태그 0, words.js 동기)
 *   [B] 헬퍼 정확성 — wordsForTag / tagsForWord / commonTags / allTags 역색인 정합
 *   [C] 암살자 회피 sanity — tagsForWord 교차검사(스파이마스터가 쓸 회피 로직의 토대)
 */

import { WORDS } from '../words.js';
import {
  TAG_MAP, wordsForTag, tagsForWord, commonTags, allTags,
} from '../bot-knowledge.js';

// ── 미니 러너 ──────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];
function assert(cond, label) {
  if (cond) { passed += 1; console.log(`  PASS  ${label}`); }
  else { failed += 1; failures.push(label); console.log(`  FAIL  ${label}`); }
}

// ════════════════════════════════════════════════════════════════
// [A] 커버리지 (AC-7: 미매핑 0)
// ════════════════════════════════════════════════════════════════
{
  console.log('\n[A] 커버리지 — WORDS 590단어 100%');

  assert(WORDS.length === 590, `WORDS 길이 590 (실제 ${WORDS.length})`);
  assert(new Set(WORDS).size === WORDS.length, 'WORDS 중복 단어 0');

  // 미매핑(TAG_MAP에 없거나 빈 태그) 단어 수집.
  const unmapped = [];
  const emptyTag = [];
  for (const w of WORDS) {
    if (!(w in TAG_MAP)) { unmapped.push(w); continue; }
    if (!Array.isArray(TAG_MAP[w]) || TAG_MAP[w].length === 0) emptyTag.push(w);
  }
  assert(unmapped.length === 0, `미매핑 단어 0건 (실제 ${unmapped.length}: ${unmapped.slice(0, 10).join(',')})`);
  assert(emptyTag.length === 0, `빈 태그 배열 0건 (실제 ${emptyTag.length}: ${emptyTag.slice(0, 10).join(',')})`);

  // 역방향: TAG_MAP 키가 WORDS에 없는 유령 단어(words.js와 비동기) 검출.
  const wordSet = new Set(WORDS);
  const ghost = Object.keys(TAG_MAP).filter((w) => !wordSet.has(w));
  assert(ghost.length === 0, `TAG_MAP 유령 키(WORDS에 없음) 0건 (실제 ${ghost.length}: ${ghost.slice(0, 10).join(',')})`);

  assert(Object.keys(TAG_MAP).length === 590, `TAG_MAP 키 수 590 (실제 ${Object.keys(TAG_MAP).length})`);

  // 모든 태그가 비어있지 않은 문자열인지.
  let badTagEntry = 0;
  for (const [w, tags] of Object.entries(TAG_MAP)) {
    if (!Array.isArray(tags)) { badTagEntry++; continue; }
    if (tags.some((t) => typeof t !== 'string' || t.length === 0)) badTagEntry++;
    // 단어 자체 태그 중복(같은 태그 2번)도 검출.
    if (new Set(tags).size !== tags.length) badTagEntry++;
  }
  assert(badTagEntry === 0, `태그 배열 무결성(문자열·비빈·중복없음) 0 위반 (실제 ${badTagEntry})`);

  // 태그 개수 분포 sanity — 스펙 "보통 3~7개". 극단값(8+ 또는 1개)은 경고만.
  const sizes = WORDS.map((w) => tagsForWord(w).length);
  const min = Math.min(...sizes); const max = Math.max(...sizes);
  const avg = (sizes.reduce((a, b) => a + b, 0) / sizes.length).toFixed(2);
  console.log(`  INFO  태그 개수 분포: min=${min} max=${max} avg=${avg}`);
  assert(min >= 1, `최소 태그 개수 >= 1 (실제 ${min})`);
}

// ════════════════════════════════════════════════════════════════
// [B] 헬퍼 정확성
// ════════════════════════════════════════════════════════════════
{
  console.log('\n[B] 헬퍼 정확성');

  // tagsForWord — 미존재 단어는 빈 배열.
  assert(tagsForWord('존재하지않는단어XYZ').length === 0, 'tagsForWord 미존재 단어 → 빈 배열');
  assert(Array.isArray(tagsForWord('강아지')) && tagsForWord('강아지').includes('동물'), 'tagsForWord("강아지") 동물 포함');

  // wordsForTag — 역색인 정합: wordsForTag(T)의 모든 단어가 실제로 T를 태그로 가짐.
  const tags = allTags().map((x) => x.tag);
  let reverseOk = true; let reverseCount = 0;
  for (const t of tags) {
    for (const w of wordsForTag(t)) {
      reverseCount++;
      if (!tagsForWord(w).includes(t)) { reverseOk = false; break; }
    }
    if (!reverseOk) break;
  }
  assert(reverseOk, `wordsForTag↔tagsForWord 역색인 정합 (${reverseCount}쌍 교차검증)`);

  // 완전성: 모든 (word, tag) 쌍이 역색인에 존재.
  let forwardOk = true; let pairCount = 0;
  for (const [w, ts] of Object.entries(TAG_MAP)) {
    for (const t of ts) {
      pairCount++;
      if (!wordsForTag(t).includes(w)) { forwardOk = false; break; }
    }
    if (!forwardOk) break;
  }
  assert(forwardOk, `tagsForWord→wordsForTag 완전성 (${pairCount}쌍)`);

  assert(wordsForTag('존재하지않는태그XYZ').length === 0, 'wordsForTag 미존재 태그 → 빈 배열');

  // commonTags — 공유 빈도 정렬.
  const ct = commonTags(['강아지', '고양이', '호랑이']);
  assert(Array.isArray(ct) && ct.length > 0, 'commonTags 배열 반환');
  // 동물 태그는 3마리 모두 공유 → count 3, 최상위.
  const animal = ct.find((c) => c.tag === '동물');
  assert(animal && animal.count === 3, `commonTags 동물 count=3 (실제 ${animal ? animal.count : 'none'})`);
  // 정렬 내림차순.
  let sortedDesc = true;
  for (let i = 1; i < ct.length; i++) if (ct[i].count > ct[i - 1].count) sortedDesc = false;
  assert(sortedDesc, 'commonTags count 내림차순 정렬');
  // 빈 입력 → 빈 배열.
  assert(commonTags([]).length === 0, 'commonTags([]) → 빈 배열');
  // 단일 단어 → 그 단어 태그 전부 count=1.
  const single = commonTags(['강아지']);
  assert(single.every((c) => c.count === 1) && single.length === tagsForWord('강아지').length,
    'commonTags 단일 단어 → 모든 태그 count=1');

  // allTags — 중복 없는 태그 통계, count = wordsForTag 길이.
  const at = allTags();
  const atTagSet = new Set(at.map((x) => x.tag));
  assert(atTagSet.size === at.length, 'allTags 태그 중복 없음');
  let countMatch = true;
  for (const { tag, count } of at) if (wordsForTag(tag).length !== count) { countMatch = false; break; }
  assert(countMatch, 'allTags count === wordsForTag 길이');
  console.log(`  INFO  전체 고유 태그 수: ${at.length}`);
}

// ════════════════════════════════════════════════════════════════
// [C] 암살자 회피 sanity (스파이마스터 회피 로직 토대)
// ════════════════════════════════════════════════════════════════
{
  console.log('\n[C] 암살자 회피 sanity');

  // 스파이마스터 회피의 핵심: 위험 단어(암살자/상대)의 태그 집합과
  // 교집합 없는 태그를 자기팀 단어에서 찾는다. 실제 보드 100판을 시뮬레이션해
  // "위험 회피 후에도 ≥2 커버 태그 또는 ≥1 폴백 태그가 거의 항상 존재"하는지 본다.
  function pick(pool, n) {
    const copy = pool.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, n);
  }

  let noClueAtAll = 0; // 위험 회피 후 단서 후보(커버≥1)조차 0인 판 수
  let no2Cover = 0; // ≥2 커버 태그가 없는 판 수
  const TRIALS = 300;
  for (let it = 0; it < TRIALS; it++) {
    const board = pick(WORDS, 25);
    const myWords = board.slice(0, 9); // 임의 9개를 자기팀으로 가정
    const dangerWords = board.slice(9, 18); // 임의 8개를 상대(위험)로 가정 + 암살자 1
    const dangerTags = new Set();
    for (const w of dangerWords) for (const t of tagsForWord(w)) dangerTags.add(t);
    const ct = commonTags(myWords).filter((c) => !dangerTags.has(c.tag));
    const has2 = ct.some((c) => c.count >= 2);
    const has1 = ct.length > 0;
    if (!has2) no2Cover++;
    if (!has1) noClueAtAll++;
  }
  console.log(`  INFO  ${TRIALS}판 중 위험회피후 ≥2커버 없음=${no2Cover}, 후보 전무=${noClueAtAll}`);
  // 폴백(1:1)이 있으므로 "후보 전무"는 매우 드물어야 한다(봇이 매 턴 행동 가능).
  assert(noClueAtAll <= TRIALS * 0.02, `위험회피후 단서 후보 전무 판 ≤2% (실제 ${(noClueAtAll / TRIALS * 100).toFixed(1)}%)`);

  // 교차검사: 임의 단어쌍의 commonTags가 두 단어 tagsForWord의 실제 교집합과 일치.
  let intersectOk = true;
  for (let it = 0; it < 200; it++) {
    const [a, b] = pick(WORDS, 2);
    const ta = new Set(tagsForWord(a));
    const real = tagsForWord(b).filter((t) => ta.has(t));
    const viaCommon = commonTags([a, b]).filter((c) => c.count === 2).map((c) => c.tag);
    if (new Set(real).size !== new Set(viaCommon).size
        || !real.every((t) => viaCommon.includes(t))) { intersectOk = false; break; }
  }
  assert(intersectOk, 'commonTags(count=2) === tagsForWord 실제 교집합 (200쌍)');
}

// ── 결과 ────────────────────────────────────────────────────────────
console.log(`\n총: ${passed + failed}건  PASS: ${passed}  FAIL: ${failed}`);
if (failed > 0) {
  console.log('실패 목록:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
} else {
  console.log('ALL PASS');
}
