/**
 * @fileoverview 리치마작 화료 판정: 패 분해, 대기패, 향청수, 역·부수 평가와 점수 계산.
 *
 * 모든 함수는 순수 함수이며 서버·AI·테스트가 공유한다.
 * 규칙: 일본식 리치마작(4인), 쿠이탕·적도라 선택, 헤아림역만·끊어올림 만관 적용.
 */

import {
  KIND_COUNT, YAOCHUU_KINDS, isYaochuu, isHonor, isDragon, isWind, isTerminal, suitOf,
} from './tiles.js';

// ── 형태 판정 ───────────────────────────────────────────────

/**
 * counts에서 면자(순자·각자)만으로 모두 소진 가능한지 검사한다. counts는 임시 변경 후 복원된다.
 * @param {number[]} c 종류별 개수
 * @param {number} i 시작 종류
 * @returns {boolean} 가능 여부
 */
function canMakeSets(c, i) {
  while (i < KIND_COUNT && c[i] === 0) i++;
  if (i >= KIND_COUNT) return true;
  if (c[i] >= 3) {
    c[i] -= 3;
    const ok = canMakeSets(c, i);
    c[i] += 3;
    if (ok) return true;
  }
  if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--; c[i + 1]--; c[i + 2]--;
    const ok = canMakeSets(c, i);
    c[i]++; c[i + 1]++; c[i + 2]++;
    if (ok) return true;
  }
  return false;
}

/**
 * @param {number[]} counts 멘젠 부분 개수(합 3n+2)
 * @returns {boolean} 4면자 1雀頭(부로 제외) 형태 완성 여부
 */
export function hasStandardShape(counts) {
  const c = counts.slice();
  for (let p = 0; p < KIND_COUNT; p++) {
    if (c[p] >= 2) {
      c[p] -= 2;
      const ok = canMakeSets(c, 0);
      c[p] += 2;
      if (ok) return true;
    }
  }
  return false;
}

/** @param {number[]} c 개수 @returns {boolean} 치또이츠 형태 */
export function isChiitoi(c) {
  let pairs = 0;
  for (let i = 0; i < KIND_COUNT; i++) {
    if (c[i] === 2) pairs++;
    else if (c[i] !== 0) return false;
  }
  return pairs === 7;
}

/** @param {number[]} c 개수 @returns {boolean} 국사무쌍 형태 */
export function isKokushi(c) {
  let pair = 0;
  for (let i = 0; i < KIND_COUNT; i++) {
    if (isYaochuu(i)) {
      if (c[i] === 0 || c[i] > 2) return false;
      if (c[i] === 2) pair++;
    } else if (c[i] !== 0) return false;
  }
  return pair === 1;
}

/**
 * @param {number[]} counts 멘젠 부분 개수(합 3n+2)
 * @param {number} meldCount 부로 수
 * @returns {boolean} 어떤 형태로든 화료 형태인지
 */
export function isAgariShape(counts, meldCount = 0) {
  if (hasStandardShape(counts)) return true;
  if (meldCount === 0) return isChiitoi(counts) || isKokushi(counts);
  return false;
}

/**
 * 13장(3n+1)에서 화료가 되는 대기패 종류를 구한다.
 * @param {number[]} counts 멘젠 부분 개수
 * @param {number} meldCount 부로 수
 * @returns {number[]} 대기 종류 목록
 */
export function getWaits(counts, meldCount = 0) {
  const waits = [];
  const c = counts.slice();
  for (let k = 0; k < KIND_COUNT; k++) {
    if (c[k] >= 4) continue;
    c[k]++;
    if (isAgariShape(c, meldCount)) waits.push(k);
    c[k]--;
  }
  return waits;
}

// ── 향청수 ──────────────────────────────────────────────────

/** @param {number[]} counts 개수 @param {number} fixed 부로 수 @returns {number} 일반형 향청수 */
function shantenRegular(counts, fixed) {
  const c = counts.slice();
  let best = 8;
  let mentsu = fixed;
  let taatsu = 0;
  let pair = 0;
  const dfs = (start) => {
    let i = start;
    while (i < KIND_COUNT && c[i] === 0) i++;
    if (i >= KIND_COUNT) {
      let t = taatsu;
      if (mentsu + t > 4) t = 4 - mentsu;
      const s = 8 - 2 * mentsu - t - pair;
      if (s < best) best = s;
      return;
    }
    if (c[i] >= 3) { c[i] -= 3; mentsu++; dfs(i); mentsu--; c[i] += 3; }
    if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--; c[i + 1]--; c[i + 2]--; mentsu++;
      dfs(i);
      mentsu--; c[i]++; c[i + 1]++; c[i + 2]++;
    }
    if (c[i] >= 2) {
      c[i] -= 2;
      if (!pair) { pair = 1; dfs(i); pair = 0; }
      taatsu++; dfs(i); taatsu--;
      c[i] += 2;
    }
    if (i < 27 && i % 9 <= 7 && c[i + 1] > 0) {
      c[i]--; c[i + 1]--; taatsu++;
      dfs(i);
      taatsu--; c[i]++; c[i + 1]++;
    }
    if (i < 27 && i % 9 <= 6 && c[i + 2] > 0) {
      c[i]--; c[i + 2]--; taatsu++;
      dfs(i);
      taatsu--; c[i]++; c[i + 2]++;
    }
    c[i]--;
    dfs(i);
    c[i]++;
  };
  dfs(0);
  return best;
}

/**
 * 향청수를 구한다(-1이면 화료 형태, 0이면 텐파이).
 * @param {number[]} counts 멘젠 부분 개수
 * @param {number} meldCount 부로 수
 * @returns {number} 향청수
 */
export function shanten(counts, meldCount = 0) {
  let s = shantenRegular(counts, meldCount);
  if (meldCount === 0) {
    let pairs = 0;
    let kinds = 0;
    for (let i = 0; i < KIND_COUNT; i++) {
      if (counts[i] >= 1) kinds++;
      if (counts[i] >= 2) pairs++;
    }
    s = Math.min(s, 6 - pairs + Math.max(0, 7 - kinds));
    let types = 0;
    let hasPair = 0;
    for (const k of YAOCHUU_KINDS) {
      if (counts[k] >= 1) types++;
      if (counts[k] >= 2) hasPair = 1;
    }
    s = Math.min(s, 13 - types - hasPair);
  }
  return s;
}

// ── 분해 ────────────────────────────────────────────────────

/**
 * 멘젠 부분을 (머리 + 면자들)로 가능한 모든 방식으로 분해한다.
 * @param {number[]} counts 개수
 * @returns {{pair:number, sets:{t:'seq'|'tri', k:number}[]}[]} 분해 목록
 */
export function decompose(counts) {
  const c = counts.slice();
  const results = [];
  const sets = [];
  const walk = (start, pair) => {
    let i = start;
    while (i < KIND_COUNT && c[i] === 0) i++;
    if (i >= KIND_COUNT) { results.push({ pair, sets: sets.slice() }); return; }
    if (c[i] >= 3) {
      c[i] -= 3; sets.push({ t: 'tri', k: i });
      walk(i, pair);
      sets.pop(); c[i] += 3;
    }
    if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--; c[i + 1]--; c[i + 2]--; sets.push({ t: 'seq', k: i });
      walk(i, pair);
      sets.pop(); c[i]++; c[i + 1]++; c[i + 2]++;
    }
  };
  for (let p = 0; p < KIND_COUNT; p++) {
    if (c[p] >= 2) {
      c[p] -= 2;
      walk(0, p);
      c[p] += 2;
    }
  }
  return results;
}

// ── 점수 ────────────────────────────────────────────────────

/** @param {number} n 점수 @returns {number} 100 단위 올림 */
const ceil100 = (n) => Math.ceil(n / 100) * 100;

/**
 * 기본점을 구한다.
 * @param {number} han 판수(역만 제외)
 * @param {number} fu 부수
 * @param {number} yakuman 역만 배수(0이면 일반)
 * @returns {number} 기본점
 */
export function basePoints(han, fu, yakuman = 0) {
  if (yakuman > 0) return 8000 * yakuman;
  if (han >= 13) return 8000;
  if (han >= 11) return 6000;
  if (han >= 8) return 4000;
  if (han >= 6) return 3000;
  if (han >= 5) return 2000;
  const base = fu * 2 ** (han + 2);
  return base >= 1920 ? 2000 : base;
}

/** @returns {string|null} 한도 이름 */
export function limitName(han, fu, yakuman = 0) {
  if (yakuman > 0) return yakuman >= 2 ? `${yakuman}배 역만` : '역만';
  if (han >= 13) return '헤아림 역만';
  if (han >= 11) return '삼배만';
  if (han >= 8) return '배만';
  if (han >= 6) return '하네만';
  if (basePoints(han, fu) >= 2000) return '만관';
  return null;
}

/**
 * 화료 점수 지불 내역을 계산한다(본장·공탁 제외).
 * @param {number} base 기본점
 * @param {boolean} dealer 화료자가 친인지
 * @param {boolean} tsumo 쯔모 여부
 * @returns {{total:number, ron?:number, dealerPay?:number, childPay?:number, allPay?:number}} 지불 내역
 */
export function paymentOf(base, dealer, tsumo) {
  if (!tsumo) {
    const ron = ceil100(base * (dealer ? 6 : 4));
    return { total: ron, ron };
  }
  if (dealer) {
    const allPay = ceil100(base * 2);
    return { total: allPay * 3, allPay };
  }
  const dealerPay = ceil100(base * 2);
  const childPay = ceil100(base);
  return { total: dealerPay + childPay * 2, dealerPay, childPay };
}

// ── 역 평가 ─────────────────────────────────────────────────

const GREEN_KINDS = new Set([19, 20, 21, 23, 25, 32]);
const CHUUREN_BASE = [3, 1, 1, 1, 1, 1, 1, 1, 3];

/**
 * 부로를 포함한 전체 패 개수를 만든다.
 * @param {number[]} counts 멘젠 부분
 * @param {{type:string,k:number}[]} melds 부로
 * @returns {number[]} 전체 개수
 */
function allCounts(counts, melds) {
  const all = counts.slice();
  for (const m of melds) {
    if (m.type === 'chi') { all[m.k]++; all[m.k + 1]++; all[m.k + 2]++; }
    else if (m.type === 'pon') all[m.k] += 3;
    else all[m.k] += 4;
  }
  return all;
}

/**
 * 개수 배열을 종류 목록(중복 포함)으로 펼친다. 역의 관련 패(hl) 표기에 쓴다.
 * @param {number[]} counts 종류별 개수
 * @returns {number[]} 종류 목록
 */
function expandKinds(counts) {
  const out = [];
  counts.forEach((n, k) => { for (let i = 0; i < n; i++) out.push(k); });
  return out;
}

/** @param {{t:string,k:number}[]} groups 면자 목록 @returns {number[]} 면자를 이루는 종류 목록 */
function groupKinds(groups) {
  const out = [];
  for (const g of groups) {
    if (g.t === 'seq') out.push(g.k, g.k + 1, g.k + 2);
    else for (let i = 0; i < (g.t === 'kan' ? 4 : 3); i++) out.push(g.k);
  }
  return out;
}

/**
 * 전체 패 구성에서 성립하는 일반 역(형태 무관)을 추가한다.
 * @returns {void}
 */
function addCommonYaku(ctx, menzen, all, out) {
  const { tsumo } = ctx;
  if (ctx.riichi === 2) out.push({ name: '더블리치', han: 2 });
  else if (ctx.riichi === 1) out.push({ name: '리치', han: 1 });
  if (ctx.riichi && ctx.ippatsu) out.push({ name: '일발', han: 1 });
  if (menzen && tsumo) out.push({ name: '멘젠쯔모', han: 1 });
  if (tsumo && ctx.rinshan) out.push({ name: '영상개화', han: 1 });
  else if (tsumo && ctx.haitei) out.push({ name: '해저로월', han: 1 });
  if (!tsumo && ctx.chankan) out.push({ name: '창깡', han: 1 });
  else if (!tsumo && ctx.houtei) out.push({ name: '하저로어', han: 1 });

  let simple = true;
  let hasHonor = false;
  let allYaochuu = true;
  const suits = new Set();
  for (let k = 0; k < KIND_COUNT; k++) {
    if (!all[k]) continue;
    if (isYaochuu(k)) simple = false; else allYaochuu = false;
    if (isHonor(k)) hasHonor = true; else suits.add(suitOf(k));
  }
  const hl = expandKinds(all);
  if (simple && (menzen || ctx.rules.kuitan)) out.push({ name: '탕야오', han: 1, hl });
  if (suits.size === 1) {
    if (hasHonor) out.push({ name: '혼일색', han: menzen ? 3 : 2, hl });
    else out.push({ name: '청일색', han: menzen ? 6 : 5, hl });
  }
  if (allYaochuu && hasHonor && suits.size >= 1) out.push({ name: '혼노두', han: 2, hl });
}

/**
 * 전체 패 구성으로 판단되는 역만을 추가한다(형태 무관).
 * @returns {void}
 */
function addCommonYakuman(ctx, all, out) {
  let allHonor = true;
  let allTerm = true;
  let allGreen = true;
  for (let k = 0; k < KIND_COUNT; k++) {
    if (!all[k]) continue;
    if (!isHonor(k)) allHonor = false;
    if (!isTerminal(k)) allTerm = false;
    if (!GREEN_KINDS.has(k)) allGreen = false;
  }
  const hl = expandKinds(all);
  if (allHonor) out.push({ name: '자일색', yakuman: 1, hl });
  if (allTerm) out.push({ name: '청노두', yakuman: 1, hl });
  if (allGreen) out.push({ name: '녹일색', yakuman: 1, hl });
  if (ctx.tenhou) out.push({ name: '천화', yakuman: 1 });
  if (ctx.chiihou) out.push({ name: '지화', yakuman: 1 });
}

/** @param {{han:number,fu:number,yakuman:number}} r @returns {number} 비교 키 */
function scoreKey(r) {
  return basePoints(r.han, r.fu, r.yakuman) * 1000 + r.han * 10 + r.fu / 10;
}

/**
 * 대기 형태 해석 목록을 만든다(화료 패가 어느 면자·머리를 완성했는지).
 * @returns {{group:'pair'|number, wait:string}[]}
 */
function waitInterpretations(d, winKind) {
  const list = [];
  if (d.pair === winKind) list.push({ group: 'pair', wait: 'tanki' });
  const seen = new Set();
  d.sets.forEach((s, i) => {
    const key = `${s.t}:${s.k}`;
    if (seen.has(key)) return;
    if (s.t === 'tri' && s.k === winKind) {
      seen.add(key);
      list.push({ group: i, wait: 'shanpon' });
    } else if (s.t === 'seq' && winKind >= s.k && winKind <= s.k + 2) {
      seen.add(key);
      let wait = 'ryanmen';
      if (winKind === s.k + 1) wait = 'kanchan';
      else if (winKind === s.k && s.k % 9 === 6) wait = 'penchan';
      else if (winKind === s.k + 2 && s.k % 9 === 0) wait = 'penchan';
      list.push({ group: i, wait });
    }
  });
  return list;
}

/** @returns {{han:number,fu:number,yaku:object[],yakuman:number,shape:string}|null} */
function evalStandard(ctx, d, interp, melds, menzen, all) {
  const { tsumo, seatWind, roundWind } = ctx;
  const groups = melds.map((m) => {
    if (m.type === 'chi') return { t: 'seq', k: m.k, open: true };
    if (m.type === 'pon') return { t: 'tri', k: m.k, open: true };
    return { t: 'kan', k: m.k, open: m.type !== 'ankan' };
  });
  d.sets.forEach((s, i) => {
    const open = s.t === 'tri' && interp.group === i && !tsumo;
    groups.push({ t: s.t, k: s.k, open });
  });
  const pair = d.pair;
  const seqs = groups.filter((g) => g.t === 'seq');
  const trips = groups.filter((g) => g.t !== 'seq');
  const kans = groups.filter((g) => g.t === 'kan');
  const concealedTrips = trips.filter((g) => !g.open).length;

  // 역만
  const ym = [];
  const allHl = expandKinds(all);
  if (menzen && concealedTrips === 4) ym.push({ name: '스안커', yakuman: interp.wait === 'tanki' ? 2 : 1, hl: allHl });
  const dragonGroups = trips.filter((g) => isDragon(g.k));
  const dragonTrips = dragonGroups.length;
  if (dragonTrips === 3) ym.push({ name: '대삼원', yakuman: 1, hl: groupKinds(dragonGroups) });
  const windGroups = trips.filter((g) => isWind(g.k));
  const windTrips = windGroups.length;
  if (windTrips === 4) ym.push({ name: '대사희', yakuman: 2, hl: groupKinds(windGroups) });
  else if (windTrips === 3 && isWind(pair)) ym.push({ name: '소사희', yakuman: 1, hl: [...groupKinds(windGroups), pair, pair] });
  if (kans.length === 4) ym.push({ name: '스깡쯔', yakuman: 1, hl: groupKinds(kans) });
  if (melds.length === 0 && suitOf(pair) < 3) {
    // 구련보등: 멘젠 한 가지 색 3111111113 + 1장
    const base = suitOf(pair) * 9;
    let sum = 0;
    for (let n = 0; n < 9; n++) sum += all[base + n];
    if (sum === 14 && CHUUREN_BASE.every((v, n) => all[base + n] >= v)) {
      const pure = CHUUREN_BASE.every((v, n) => all[base + n] - (n === ctx.winKind - base ? 1 : 0) === v);
      ym.push({ name: pure ? '순정구련보등' : '구련보등', yakuman: pure ? 2 : 1, hl: allHl });
    }
  }
  addCommonYakuman(ctx, all, ym);
  if (ym.length > 0) {
    const n = ym.reduce((a, y) => a + y.yakuman, 0);
    return { han: 0, fu: 0, yaku: ym, yakuman: n, shape: 'standard', layout: { pair, sets: d.sets, win: interp.group } };
  }

  const y = [];
  addCommonYaku(ctx, menzen, all, y);

  // 핑후
  const pairYakuhai = isDragon(pair) || pair === seatWind || pair === roundWind;
  const isPinfu = menzen && seqs.length === 4 && !pairYakuhai && interp.wait === 'ryanmen';
  if (isPinfu) y.push({ name: '핑후', han: 1, hl: expandKinds(all) });

  // 페코
  if (menzen) {
    const seqCount = {};
    for (const g of seqs) seqCount[g.k] = (seqCount[g.k] || 0) + 1;
    const pairs = Object.values(seqCount).reduce((a, n) => a + Math.floor(n / 2), 0);
    const dupSeqs = Object.entries(seqCount).flatMap(([k, n]) => Array(Math.floor(n / 2) * 2).fill({ t: 'seq', k: +k }));
    if (pairs >= 2) y.push({ name: '량페코', han: 3, hl: groupKinds(dupSeqs) });
    else if (pairs === 1) y.push({ name: '이페코', han: 1, hl: groupKinds(dupSeqs) });
  }
  // 삼색동순 / 일기통관
  const seqKinds = new Set(seqs.map((g) => g.k));
  for (let n = 0; n < 7; n++) {
    if (seqKinds.has(n) && seqKinds.has(9 + n) && seqKinds.has(18 + n)) {
      y.push({ name: '삼색동순', han: menzen ? 2 : 1, hl: groupKinds([n, 9 + n, 18 + n].map((k) => ({ t: 'seq', k }))) });
      break;
    }
  }
  for (let s = 0; s < 3; s++) {
    if (seqKinds.has(s * 9) && seqKinds.has(s * 9 + 3) && seqKinds.has(s * 9 + 6)) {
      y.push({ name: '일기통관', han: menzen ? 2 : 1, hl: groupKinds([0, 3, 6].map((k) => ({ t: 'seq', k: s * 9 + k }))) });
      break;
    }
  }
  // 찬타 / 준찬타
  if (seqs.length > 0) {
    const hasHonor = isHonor(pair) || trips.some((g) => isHonor(g.k));
    const allTerm = isYaochuu(pair)
      && trips.every((g) => isYaochuu(g.k))
      && seqs.every((g) => g.k % 9 === 0 || g.k % 9 === 6);
    if (allTerm) {
      if (hasHonor) y.push({ name: '찬타', han: menzen ? 2 : 1, hl: allHl });
      else y.push({ name: '준찬타', han: menzen ? 3 : 2, hl: allHl });
    }
  }
  if (seqs.length === 0) y.push({ name: '또이또이', han: 2, hl: allHl });
  if (concealedTrips === 3) y.push({ name: '산안커', han: 2, hl: groupKinds(trips.filter((g) => !g.open)) });
  for (let n = 0; n < 9; n++) {
    const has = (s) => trips.some((g) => g.k === s * 9 + n);
    if (has(0) && has(1) && has(2)) { y.push({ name: '삼색동각', han: 2, hl: groupKinds([0, 1, 2].map((s) => ({ t: 'tri', k: s * 9 + n }))) }); break; }
  }
  if (kans.length === 3) y.push({ name: '산깡쯔', han: 2, hl: groupKinds(kans) });
  if (dragonTrips === 2 && isDragon(pair)) y.push({ name: '소삼원', han: 2, hl: [...groupKinds(dragonGroups), pair, pair] });
  const hakuNames = { 31: '역패 백', 32: '역패 발', 33: '역패 중' };
  for (const g of trips) {
    if (isDragon(g.k)) y.push({ name: hakuNames[g.k], han: 1, hl: groupKinds([g]) });
    if (g.k === roundWind) y.push({ name: '장풍패', han: 1, hl: groupKinds([g]) });
    if (g.k === seatWind) y.push({ name: '자풍패', han: 1, hl: groupKinds([g]) });
  }

  // 부수
  let fu;
  if (isPinfu) fu = tsumo ? 20 : 30;
  else {
    fu = 20;
    if (menzen && !tsumo) fu += 10;
    if (tsumo) fu += 2;
    for (const g of trips) {
      let f = isYaochuu(g.k) ? (g.open ? 4 : 8) : (g.open ? 2 : 4);
      if (g.t === 'kan') f *= 4;
      fu += f;
    }
    if (isDragon(pair)) fu += 2;
    if (pair === seatWind) fu += 2;
    if (pair === roundWind) fu += 2;
    if (interp.wait === 'kanchan' || interp.wait === 'penchan' || interp.wait === 'tanki') fu += 2;
    fu = Math.ceil(fu / 10) * 10;
    if (!menzen) fu = Math.max(30, fu);
  }
  const han = y.reduce((a, v) => a + v.han, 0);
  return { han, fu, yaku: y, yakuman: 0, shape: 'standard', layout: { pair, sets: d.sets, win: interp.group } };
}

/**
 * 화료 손을 평가해 역·판·부를 구한다.
 * @param {object} ctx 평가 문맥
 * @param {number[]} ctx.counts 멘젠 부분 개수(화료 패 포함)
 * @param {{type:'chi'|'pon'|'minkan'|'ankan'|'kakan', k:number}[]} [ctx.melds] 부로(chi는 k가 가장 낮은 패)
 * @param {number} ctx.winKind 화료 패 종류
 * @param {boolean} ctx.tsumo 쯔모 여부
 * @param {number} ctx.seatWind 자풍 종류(27~30)
 * @param {number} ctx.roundWind 장풍 종류(27~30)
 * @param {0|1|2} [ctx.riichi] 리치 상태
 * @param {boolean} [ctx.ippatsu] 일발
 * @param {boolean} [ctx.haitei] 해저
 * @param {boolean} [ctx.houtei] 하저
 * @param {boolean} [ctx.rinshan] 영상개화
 * @param {boolean} [ctx.chankan] 창깡
 * @param {boolean} [ctx.tenhou] 천화
 * @param {boolean} [ctx.chiihou] 지화
 * @param {number} [ctx.dora] 도라 수
 * @param {number} [ctx.ura] 뒷도라 수
 * @param {number} [ctx.aka] 적도라 수
 * @param {{kuitan:boolean}} [ctx.rules] 규칙
 * @returns {{han:number,fu:number,yaku:{name:string,han?:number,yakuman?:number}[],yakuman:number,shape:string}|null} 평가 결과, 역 없음이면 null
 */
export function evaluateHand(rawCtx) {
  const ctx = { melds: [], riichi: 0, dora: 0, ura: 0, aka: 0, rules: { kuitan: true }, ...rawCtx };
  const { counts, melds } = ctx;
  const menzen = melds.every((m) => m.type === 'ankan');
  const all = allCounts(counts, melds);
  let best = null;
  const consider = (r) => {
    if (!r) return;
    if (r.yakuman === 0 && r.yaku.length === 0) return;
    r.key = scoreKey(r);
    if (!best || r.key > best.key) best = r;
  };

  if (melds.length === 0 && isKokushi(counts)) {
    const thirteen = counts[ctx.winKind] === 2;
    const ym = [{ name: thirteen ? '국사무쌍 13면' : '국사무쌍', yakuman: thirteen ? 2 : 1, hl: expandKinds(all) }];
    if (ctx.tenhou) ym.push({ name: '천화', yakuman: 1 });
    if (ctx.chiihou) ym.push({ name: '지화', yakuman: 1 });
    consider({ han: 0, fu: 0, yaku: ym, yakuman: ym.reduce((a, v) => a + v.yakuman, 0), shape: 'kokushi' });
  }

  if (melds.length === 0 && isChiitoi(counts)) {
    const chiitoiLayout = { pairs: counts.map((n, k) => (n === 2 ? k : -1)).filter((k) => k >= 0) };
    const ym = [];
    addCommonYakuman(ctx, all, ym);
    if (ym.length > 0) {
      consider({ han: 0, fu: 0, yaku: ym, yakuman: ym.reduce((a, v) => a + v.yakuman, 0), shape: 'chiitoi', layout: chiitoiLayout });
    } else {
      const y = [{ name: '치또이츠', han: 2, hl: expandKinds(all) }];
      addCommonYaku(ctx, true, all, y);
      consider({ han: y.reduce((a, v) => a + v.han, 0), fu: 25, yaku: y, yakuman: 0, shape: 'chiitoi', layout: chiitoiLayout });
    }
  }

  for (const d of decompose(counts)) {
    if (d.sets.length + melds.length !== 4) continue;
    for (const interp of waitInterpretations(d, ctx.winKind)) {
      consider(evalStandard(ctx, d, interp, melds, menzen, all));
    }
  }
  if (!best) return null;

  const result = { han: best.han, fu: best.fu, yaku: best.yaku.slice(), yakuman: best.yakuman, shape: best.shape, layout: best.layout || null };
  if (result.yakuman === 0) {
    if (ctx.dora > 0) { result.yaku.push({ name: '도라', han: ctx.dora }); result.han += ctx.dora; }
    if (ctx.aka > 0) { result.yaku.push({ name: '적도라', han: ctx.aka }); result.han += ctx.aka; }
    if (ctx.ura > 0) { result.yaku.push({ name: '뒷도라', han: ctx.ura }); result.han += ctx.ura; }
  }
  return result;
}
