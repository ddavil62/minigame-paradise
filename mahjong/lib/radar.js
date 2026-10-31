/**
 * @fileoverview 역 레이더: 공개 정보(내 손패·모두의 울음패·버림패·도라 표시패)만으로
 * 이미 갖춘 역과 노릴 만한 역을 짚는다. 상대의 손패는 쓰지 않는다(viewFor가 주는 뷰만 사용).
 *
 * 칩 {id, name, st, tip}. st: done(이미 갖춤) · likely(노려 볼 만함/의심됨) · danger(위험) · info(참고)
 */
import { kindOf, isRedId, isHonor, isYaochuu, isDragon, isWind, suitOf, kindNameKo } from './tiles.js';

const SUIT_KO = ['만', '통', '삭'];
const ORDER = { danger: 0, done: 1, likely: 2, info: 3 };
const MAX_CHIPS = 4;

/** 울음패 하나의 종류 목록과 모양(chi면 시작 종류) */
function meldShape(m) {
  const ks = m.tiles.map(kindOf);
  const chi = m.type === 'chi';
  return { chi, k: m.k, kinds: ks, start: chi ? Math.min(...ks) : null, open: m.type !== 'ankan' };
}

const meldHasYaochuu = (s) => s.kinds.some(isYaochuu);

/** 도라 개수(적도라 포함) */
function countDora(ids, doraKinds) {
  return ids.reduce((a, id) => a + (doraKinds.has(kindOf(id)) ? 1 : 0) + (isRedId(id) ? 1 : 0), 0);
}

function top(chips) {
  return chips.sort((a, b) => ORDER[a.st] - ORDER[b.st]).slice(0, MAX_CHIPS);
}

/** 울음(공개 정보)으로 본 한 사람의 역 후보. 손패는 모르므로 "노릴 만한" 수준으로만 말한다. */
function opponentChips(p, view, doraKinds) {
  const chips = [];
  const melds = p.melds.map(meldShape);
  const seatWind = 27 + p.wind;
  const roundWind = 27 + view.roundWind;
  const add = (id, name, st, tip) => chips.push({ id, name, st, tip });
  const kuitan = view.settings?.kuitan !== false;
  const open = melds.filter((m) => m.open);

  // 확정 역: 역패 울음/깡은 이미 역이 있다
  for (const m of melds) {
    if (m.chi) continue;
    if (isDragon(m.k)) add(`yh${m.k}`, `역패 ${kindNameKo(m.k)}`, 'done', `${kindNameKo(m.k)}을(를) 모았어요. 이미 역이 있어서 어떤 패로든 화료할 수 있어요.`);
    else if (m.k === seatWind && m.k === roundWind) add(`yh${m.k}`, `연풍패 ${kindNameKo(m.k)}`, 'done', '자풍이면서 장풍이라 2판이에요.');
    else if (m.k === seatWind) add(`yh${m.k}`, `자풍 ${kindNameKo(m.k)}`, 'done', '자풍 패를 모았어요. 이미 역이 있어요.');
    else if (m.k === roundWind) add(`yh${m.k}`, `장풍 ${kindNameKo(m.k)}`, 'done', '장풍 패를 모았어요. 이미 역이 있어요.');
  }

  const dragons = melds.filter((m) => !m.chi && isDragon(m.k)).length;
  if (dragons >= 2) add('dragons', dragons >= 3 ? '대삼원!' : '삼원패 주의', 'danger', dragons >= 3 ? '삼원패를 모두 모았어요. 역만이에요!' : '삼원패를 2종 모았어요. 남은 삼원패를 주면 소삼원·대삼원이 될 수 있어요.');
  const winds = melds.filter((m) => !m.chi && isWind(m.k)).length;
  if (winds >= 3) add('winds', '사희 주의', 'danger', '바람패를 3종 모았어요. 남은 바람패는 소사희·대사희 위험이 있어요.');

  const dora = countDora(p.melds.flatMap((m) => m.tiles), doraKinds);
  if (dora > 0) add('dora', `도라 ${dora}`, dora >= 3 ? 'danger' : 'info', `울음패에 도라가 ${dora}장 보여요. 점수가 높을 수 있어요.`);

  if (open.length === 0) return top(chips);

  // 물들이기: 울음이 모두 한 색(+자패)이고, 다른 색 패를 많이 버렸으면 의심한다
  const suitsUsed = new Set(melds.filter((m) => !isHonor(m.kinds[0])).map((m) => suitOf(m.kinds[0])));
  if (suitsUsed.size === 1) {
    const s = [...suitsUsed][0];
    const discards = p.discards.map((d) => kindOf(d.id));
    const same = discards.filter((k) => !isHonor(k) && suitOf(k) === s).length;
    const other = discards.filter((k) => !isHonor(k) && suitOf(k) !== s).length;
    const honorDisc = discards.filter(isHonor).length;
    if (open.length >= 2 || (other >= 4 && same <= 1)) {
      const pure = melds.every((m) => !isHonor(m.kinds[0])) && honorDisc >= 2;
      add('flush', `${pure ? '청일색' : '혼일색'}(${SUIT_KO[s]})`, 'likely', `울음이 ${SUIT_KO[s]}수${pure ? '뿐' : '와 자패'}예요. 다른 색을 많이 버렸다면 ${SUIT_KO[s]}수${pure ? '' : '·자패'}가 위험해요.`);
    }
  }

  const trip = melds.filter((m) => !m.chi);
  if (trip.length >= 2 && trip.length === melds.length) add('toitoi', '또이또이', 'likely', '울음이 전부 커쯔예요. 같은 패 3장(또는 2장)을 노려요.');

  const yaoDisc = p.discards.map((d) => kindOf(d.id)).filter(isYaochuu).length;
  if (kuitan && melds.every((m) => !meldHasYaochuu(m)) && yaoDisc >= 3) {
    add('tanyao', '탕야오', 'likely', '울음에 1·9·자패가 없고 1·9·자패를 일찍 버렸어요. 2~8 패가 위험해요.');
  }
  if (open.length >= 2 && melds.every(meldHasYaochuu)) add('chanta', '찬타', 'likely', '울음마다 1·9 또는 자패가 들어 있어요.');

  const chis = melds.filter((m) => m.chi);
  for (let n = 0; n <= 6; n++) {
    const suits = new Set(chis.filter((m) => m.start % 9 === n).map((m) => suitOf(m.start)));
    if (suits.size >= 2) { add('sanshoku', `삼색동순 ${n + 1}${n + 2}${n + 3}`, 'likely', `${n + 1}-${n + 2}-${n + 3} 순쯔를 두 색으로 울었어요. 남은 색의 같은 숫자가 위험해요.`); break; }
  }
  for (const s of [0, 1, 2]) {
    const st = new Set(chis.filter((m) => suitOf(m.start) === s).map((m) => m.start % 9));
    if ((st.has(0) && st.has(3)) || (st.has(3) && st.has(6)) || (st.has(0) && st.has(6))) { add('ittsu', `일기통관(${SUIT_KO[s]})`, 'likely', `${SUIT_KO[s]}수 123·456·789 중 두 개를 울었어요.`); break; }
  }
  const tripNums = {};
  for (const m of trip) if (!isHonor(m.k)) (tripNums[m.k % 9] ||= new Set()).add(suitOf(m.k));
  if (Object.values(tripNums).some((set) => set.size >= 2)) add('sanshoku-k', '삼색동각', 'likely', '같은 숫자 커쯔를 두 색으로 모았어요.');
  return top(chips);
}

/** 내 손(공개+내 정보)으로 본 역: 이미 갖춘 것과 가까운 것 */
function myChips(view, counts, vis, doraKinds) {
  const me = view.players[view.me];
  const chips = [];
  const add = (id, name, st, tip) => chips.push({ id, name, st, tip });
  const kuitan = view.settings?.kuitan !== false;
  const melds = me.melds.map(meldShape);
  const closed = melds.every((m) => !m.open);
  const seatWind = 27 + me.wind;
  const roundWind = 27 + view.roundWind;
  const meldIds = me.melds.flatMap((m) => m.tiles);
  const handIds = [...view.myHand, ...(view.myDrawn != null ? [view.myDrawn] : [])];
  const all = new Array(34).fill(0);
  for (const id of [...handIds, ...meldIds]) all[kindOf(id)]++;
  const total = all.reduce((a, b) => a + b, 0);

  // 역패
  for (const k of [31, 32, 33, 27, 28, 29, 30]) {
    if (!(isDragon(k) || k === seatWind || k === roundWind)) continue;
    const label = isDragon(k) ? '역패' : k === seatWind && k === roundWind ? '연풍패' : k === seatWind ? '자풍' : '장풍';
    const inMeld = melds.some((m) => !m.chi && m.k === k);
    if (inMeld || counts[k] >= 3) add(`yh${k}`, `${label} ${kindNameKo(k)}`, 'done', `${kindNameKo(k)} 커쯔가 있어서 이미 역이 있어요.`);
    else if (counts[k] === 2) {
      const left = Math.max(0, 4 - vis[k]);
      add(`yh${k}`, `${label} ${kindNameKo(k)} ${left}장`, left > 0 ? 'likely' : 'info', left > 0 ? `${kindNameKo(k)}가 2장 있어요. 퐁하거나 한 장 더 오면 역이 생겨요(안 보이는 패 ${left}장).` : `${kindNameKo(k)}는 남은 패가 없어서 역이 되기 어려워요.`);
    }
  }

  // 탕야오
  const yao = all.reduce((a, c, k) => a + (isYaochuu(k) ? c : 0), 0);
  if ((kuitan || closed) && total >= 11) {
    if (yao === 0) add('tanyao', '탕야오', 'done', '모든 패가 2~8이라 탕야오가 돼요.');
    else if (yao <= 2) add('tanyao', `탕야오 ${yao}장`, 'likely', `1·9·자패 ${yao}장만 바꾸면 탕야오예요.`);
  }

  // 물들이기
  const honors = all.slice(27).reduce((a, b) => a + b, 0);
  if (total >= 11) {
    for (const s of [0, 1, 2]) {
      const inSuit = all.slice(s * 9, s * 9 + 9).reduce((a, b) => a + b, 0);
      const off = total - inSuit - honors;
      if (off === 0) add('flush', `${honors === 0 ? '청일색' : '혼일색'}(${SUIT_KO[s]})`, 'done', `${SUIT_KO[s]}수${honors === 0 ? '만' : '와 자패로'} 모양이 갖춰졌어요.`);
      else if (off <= 3 && inSuit + honors >= 9) add('flush', `혼일색(${SUIT_KO[s]}) ${off}장`, 'likely', `다른 색 ${off}장만 정리하면 ${SUIT_KO[s]}수 혼일색이에요.`);
    }
  }

  // 치또이츠 / 또이또이
  const pairs = counts.filter((c) => c >= 2).length;
  if (closed && pairs >= 5) add('chiitoi', `치또이츠 ${pairs}쌍`, pairs >= 6 ? 'done' : 'likely', pairs >= 6 ? '한 장만 더 있으면 돼요(같은 패 4장은 한 쌍으로만 쳐요).' : '쌍이 5개예요. 쌍을 더 모아 봐요.');
  const triples = counts.filter((c) => c >= 3).length + melds.filter((m) => !m.chi).length;
  if (melds.every((m) => !m.chi) && triples >= 2 && triples + pairs >= 4) add('toitoi', `또이또이 ${triples}커쯔`, 'likely', '커쯔와 쌍이 많아요. 전부 커쯔로 만들면 또이또이예요.');

  // 일기통관 · 삼색동순(손 + 울음 기준의 대략적 근접도)
  for (const s of [0, 1, 2]) {
    const grp = [0, 3, 6].map((g) => [0, 1, 2].filter((i) => all[s * 9 + g + i] > 0).length);
    if (grp.every((c) => c >= 2) && grp.reduce((a, b) => a + b, 0) >= 7) add('ittsu', `일기통관(${SUIT_KO[s]})`, grp.every((c) => c === 3) ? 'done' : 'likely', `${SUIT_KO[s]}수 123·456·789가 거의 모였어요.`);
  }
  for (let n = 0; n <= 6; n++) {
    const have = [0, 1, 2].map((s) => [0, 1, 2].filter((i) => all[s * 9 + n + i] > 0).length);
    const full = have.filter((c) => c === 3).length;
    const part = have.filter((c) => c === 2).length;
    if (full === 3) { add('sanshoku', `삼색동순 ${n + 1}${n + 2}${n + 3}`, 'done', `${n + 1}-${n + 2}-${n + 3}가 세 색 모두 있어요.`); break; }
    if (full === 2 && part >= 1) { add('sanshoku', `삼색동순 ${n + 1}${n + 2}${n + 3}`, 'likely', `${n + 1}-${n + 2}-${n + 3}가 두 색에 있고 한 색에 2장 있어요.`); break; }
  }

  const dora = countDora([...handIds, ...meldIds], doraKinds);
  if (dora > 0) add('dora', `도라 ${dora}`, 'info', `내 패에 도라가 ${dora}장 있어요(적도라 포함).`);
  return top(chips);
}

/**
 * @param {object} view viewFor()가 주는 뷰
 * @param {number[]} counts 내 손(쯔모패 포함) 종류별 개수
 * @param {number[]} vis 보이는 패 종류별 개수
 * @param {Set<number>} doraKinds 도라 종류 집합
 * @returns {{me: object[], opp: Object<number, object[]>}}
 */
export function yakuRadar(view, counts, vis, doraKinds) {
  const opp = {};
  for (const p of view.players) if (p.seat !== view.me) opp[p.seat] = opponentChips(p, view, doraKinds);
  return { me: myChips(view, counts, vis, doraKinds), opp };
}
