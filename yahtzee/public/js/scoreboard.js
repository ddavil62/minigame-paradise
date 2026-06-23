/**
 * @fileoverview 점수표 UI — 13 카테고리 표 렌더링 + 카테고리 선택 핸들링.
 *
 * [우드 리디자인] 열 순서를 P1·카테고리·P2 → 카테고리·P1·P2 로 변경.
 * 두 플레이어 점수가 바로 옆에 붙어 비교가 쉽다. 클래스명/로직은 기존과 동일.
 *
 * 각 카테고리 행에 P1/P2 칸 표시:
 *   - 이미 점수 기록된 칸 → 점수 숫자 (recorded)
 *   - 비어있고 본인 칸 + 본인 턴 + 1회 이상 굴림 → 미리보기 점수 (preview, 클릭 가능)
 *   - 비어있고 본인 턴이 아니거나 굴리지 않음 → 빈 칸 (empty)
 */

import {
  UPPER_CATEGORIES,
  LOWER_CATEGORIES,
  CATEGORY_LABEL,
  CATEGORY_RULE,
  calcCategoryScore,
} from './game.js';

/**
 * 단일 점수 셀(td) 생성.
 * @param {object} opts
 * @returns {HTMLTableCellElement}
 */
function makeScoreCell(opts) {
  const td = document.createElement('td');
  td.className = 'col-' + opts.pid + ' score-cell';
  td.dataset.category = opts.category;
  td.dataset.pid = opts.pid;

  if (opts.recorded !== null && opts.recorded !== undefined) {
    td.classList.add('recorded');
    td.textContent = String(opts.recorded);
  } else if (opts.canPreview) {
    td.classList.add('preview');
    if (opts.previewScore === 0) td.classList.add('preview-zero');
    td.textContent = String(opts.previewScore);
    if (opts.canClick) {
      td.title = '클릭해서 이 카테고리에 기록 (점수: ' + opts.previewScore + ')';
      td.addEventListener('click', () => opts.onClick && opts.onClick(opts.category));
    }
  } else {
    td.classList.add('empty');
    td.textContent = '·';
  }
  return td;
}

/**
 * 카테고리 행(tr) 생성. 순서: 카테고리 → P1 → P2 → ... → PN.
 * N인 확장: ctx.playerIds 배열로 동적 열 생성.
 */
function makeCategoryRow(category, ctx) {
  const tr = document.createElement('tr');
  tr.dataset.category = category;

  // 카테고리 라벨 셀
  const catCell = document.createElement('td');
  catCell.className = 'col-cat';
  const labelDiv = document.createElement('div');
  labelDiv.className = 'cat-label';
  labelDiv.textContent = CATEGORY_LABEL[category] || category;
  catCell.appendChild(labelDiv);
  const ruleDiv = document.createElement('div');
  ruleDiv.className = 'cat-rule';
  ruleDiv.textContent = CATEGORY_RULE[category] || '';
  catCell.appendChild(ruleDiv);
  tr.appendChild(catCell);

  // N인 동적 점수 셀 생성
  const pids = ctx.playerIds || ['p1', 'p2'];
  for (const pid of pids) {
    const sheet = ctx.sheets[pid] || {};
    const cell = makeScoreCell({
      pid,
      category,
      recorded: sheet[category],
      canPreview: ctx.myId === pid && ctx.canSelectCategory && sheet[category] === null,
      previewScore: calcCategoryScore(ctx.dice, category),
      canClick: ctx.myId === pid && ctx.canSelectCategory && sheet[category] === null,
      onClick: ctx.onCategoryClick,
    });
    tr.appendChild(cell);
  }

  return tr;
}

/**
 * 섹션 헤더 행(상단/하단 구분). N인 확장으로 colSpan 동적 결정.
 * @param {string} label
 * @param {number} [colCount] 전체 열 수 (기본 3 = 카테고리 + P1 + P2)
 */
function makeSectionRow(label, colCount) {
  const tr = document.createElement('tr');
  tr.className = 'section-divider';
  const td = document.createElement('td');
  td.colSpan = colCount || 3;
  td.textContent = label;
  tr.appendChild(td);
  return tr;
}

/**
 * 점수표 본문을 렌더한다.
 * N인 확장: ctx.playerIds가 있으면 동적 열 생성.
 */
export function renderScoreboard(tbody, ctx) {
  tbody.innerHTML = '';

  ctx.canSelectCategory =
    ctx.phase === 'playing' &&
    ctx.myId !== null &&
    ctx.currentTurn === ctx.myId &&
    ctx.rollCount >= 1;

  // N3: 컵 애니메이션 진행 중이면 미리보기 억제. main.js가 canPreview=false를 전달한다.
  // canPreview가 undefined인 경우(구 호출부 호환)에는 true로 간주하여 기존 동작 보존.
  const allowPreview = ctx.canPreview !== false;
  ctx.canSelectCategory = ctx.canSelectCategory && allowPreview;

  // 전체 열 수: 카테고리 1 + 플레이어 N
  const pids = ctx.playerIds || ['p1', 'p2'];
  const colCount = 1 + pids.length;

  tbody.appendChild(makeSectionRow('Upper Section · 1~6', colCount));
  for (const cat of UPPER_CATEGORIES) {
    tbody.appendChild(makeCategoryRow(cat, ctx));
  }
  tbody.appendChild(makeSectionRow('Lower Section', colCount));
  for (const cat of LOWER_CATEGORIES) {
    tbody.appendChild(makeCategoryRow(cat, ctx));
  }
}
