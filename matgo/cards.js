/**
 * @fileoverview 한국 표준 화투 48장 정의.
 *
 * 카드 객체 구조:
 *   { id, month, type, subtype?, name }
 *
 * type: 'gwang'(광) | 'tti'(띠) | 'kkeut'(끗) | 'pi'(피)
 * subtype:
 *   - 광:  'bigwang' (12월 비광만)
 *   - 띠:  'hong'(홍단) | 'cheong'(청단) | 'cho'(초단) | 'bi'(비단, 12월만)
 *   - 끗:  'godori' (2/4/8월의 끗만)
 *   - 피:  'ssangpi' (9/11/12월에 1장씩)
 *
 * 분포 (스펙 검증 표 그대로):
 *   광 5장 : 1, 3, 8, 11, 12
 *   끗 9장 : 2, 4, 5, 6, 7, 8, 9, 10, 12
 *   띠 10장: 1(홍), 2(홍), 3(홍), 4(초), 5(초), 6(청), 7(초), 9(청), 10(청), 12(비)
 *   피 24장: 나머지 (쌍피 3장: 9월, 11월, 12월 — 일반 피 21장)
 */

// ── 월별 카드 정의 (스펙 표 그대로 — 절대 변형 금지) ───────────
/**
 * 월별 4장 명세. 각 항목은 [type, subtype?]을 의미한다.
 * 항목 순서는 시각적/디버깅 편의일 뿐 게임 룰엔 영향 없음.
 */
const MONTH_SPEC = {
  1:  { name: '송학',   slots: [['gwang'],          ['tti', 'hong'],   ['pi'],              ['pi']]               },
  2:  { name: '매조',   slots: [['kkeut', 'godori'],['tti', 'hong'],   ['pi'],              ['pi']]               },
  3:  { name: '벚꽃',   slots: [['gwang'],          ['tti', 'hong'],   ['pi'],              ['pi']]               },
  4:  { name: '흑싸리', slots: [['kkeut', 'godori'],['tti', 'cho'],    ['pi'],              ['pi']]               },
  5:  { name: '난초',   slots: [['kkeut'],          ['tti', 'cho'],    ['pi'],              ['pi']]               },
  6:  { name: '모란',   slots: [['kkeut'],          ['tti', 'cheong'], ['pi'],              ['pi']]               },
  7:  { name: '홍싸리', slots: [['kkeut'],          ['tti', 'cho'],    ['pi'],              ['pi']]               },
  8:  { name: '공산',   slots: [['gwang'],          ['kkeut', 'godori'], ['pi'],            ['pi']]               },
  9:  { name: '국화',   slots: [['kkeut'],          ['tti', 'cheong'], ['pi'],              ['pi']]               },
  10: { name: '단풍',   slots: [['kkeut'],          ['tti', 'cheong'], ['pi'],              ['pi']]               },
  11: { name: '오동',   slots: [['gwang'],          ['pi', 'ssangpi'], ['pi'],              ['pi']]               },
  12: { name: '비',     slots: [['gwang', 'bigwang'],['kkeut'],        ['tti', 'bi'],       ['pi', 'ssangpi']]    },
};

/**
 * type/subtype을 한국어 짧은 라벨로 변환.
 * @param {string} type
 * @param {string|undefined} subtype
 * @returns {string}
 */
function typeLabel(type, subtype) {
  if (type === 'gwang')   return subtype === 'bigwang' ? '비광' : '광';
  if (type === 'tti') {
    if (subtype === 'hong')   return '홍단';
    if (subtype === 'cheong') return '청단';
    if (subtype === 'cho')    return '초단';
    if (subtype === 'bi')     return '비단';
    return '띠';
  }
  if (type === 'kkeut')   return subtype === 'godori' ? '고도리' : '끗';
  if (type === 'pi')      return subtype === 'ssangpi' ? '쌍피' : '피';
  return '?';
}

/**
 * 표준 화투 48장 카드 배열을 생성한다.
 *
 * id 규칙: m{MM}_{type}{서브픽스}
 *   - 같은 월 같은 type이 2장이면 _a, _b 로 구분.
 *   - 예: m01_gwang, m01_tti_hong, m01_pi_a, m01_pi_b
 *
 * @returns {Card[]} 48장 카드 배열
 */
/** 월 번호 → 영문 월명 (Wikimedia 파일명 매핑용). */
const MONTH_EN = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * 카드 id/type/subtype에서 Wikimedia SVG 파일명을 결정한다.
 * @param {number} month
 * @param {string} type
 * @param {string|undefined} subtype
 * @param {number} piIndex - 일반 피 인덱스 (1 또는 2). pi 타입에만 사용.
 * @returns {string}
 */
function svgFileFor(month, type, subtype, piIndex) {
  const m = MONTH_EN[month];
  if (type === 'gwang') return `Hwatu_${m}_gwang.svg`;
  if (type === 'tti')   return `Hwatu_${m}_tti.svg`;
  if (type === 'kkeut') {
    // 9월 끗(술잔)은 yul_ssang_pi 단일 파일로 통합되어 있음
    if (month === 9) return `Hwatu_September_yul_ssang_pi.svg`;
    return `Hwatu_${m}_yul.svg`;
  }
  if (type === 'pi' && subtype === 'ssangpi') {
    // 9월 술잔은 끗 슬롯에만 존재 (한국 표준) — 여기 분기는 11월/12월 쌍피만
    return `Hwatu_${m}_ssang_pi.svg`;
  }
  if (type === 'pi') return `Hwatu_${m}_pi_${piIndex}.svg`;
  return '';
}

export function buildDeck() {
  /** @type {Card[]} */
  const deck = [];
  for (let month = 1; month <= 12; month++) {
    const spec = MONTH_SPEC[month];
    // 같은 type 카운트 (id 충돌 회피용)
    const typeCount = {};
    for (const [type] of spec.slots) {
      typeCount[type] = (typeCount[type] || 0) + 1;
    }
    const typeSeen = {};
    let piIndex = 0; // 월별 일반 피(서브타입 ssangpi 제외) 인덱스: 1, 2
    for (const [type, subtype] of spec.slots) {
      typeSeen[type] = (typeSeen[type] || 0) + 1;
      const mm = String(month).padStart(2, '0');
      // id 구성: 같은 type이 여러 장이면 a/b 접미, 단일이면 접미 없음 (단 subtype 있으면 subtype 사용).
      let suffix = '';
      if (subtype) {
        suffix = `_${subtype}`;
      } else if (typeCount[type] > 1) {
        suffix = `_${String.fromCharCode(96 + typeSeen[type])}`; // a, b, ...
      }
      const id = `m${mm}_${type}${suffix}`;
      const name = `${month}월 ${spec.name} ${typeLabel(type, subtype)}`;
      if (type === 'pi' && subtype !== 'ssangpi') piIndex += 1;
      // Wikimedia SVG 파일명 (CC-BY-SA 4.0, Mliu92)
      const imageFile = svgFileFor(month, type, subtype, piIndex);
      const imagePath = `assets/cards-svg/${imageFile}`;
      /** @typedef {{ id:string, month:number, type:string, subtype?:string, name:string, imagePath:string }} Card */
      deck.push({ id, month, type, ...(subtype ? { subtype } : {}), name, imagePath });
    }
  }
  return deck;
}

/**
 * Fisher-Yates 셔플 (in-place).
 * @template T
 * @param {T[]} arr
 * @returns {T[]} 같은 배열 (편의용 반환)
 */
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 디버그/검증용 — 카드 분포 통계.
 * @param {Card[]} deck
 * @returns {{ total:number, byType:object, byMonth:object }}
 */
export function deckStats(deck) {
  const byType = { gwang: 0, tti: 0, kkeut: 0, pi: 0, ssangpi: 0, bigwang: 0, godori: 0 };
  const byMonth = {};
  for (const c of deck) {
    byType[c.type] = (byType[c.type] || 0) + 1;
    if (c.subtype) byType[c.subtype] = (byType[c.subtype] || 0) + 1;
    byMonth[c.month] = (byMonth[c.month] || 0) + 1;
  }
  return { total: deck.length, byType, byMonth };
}
