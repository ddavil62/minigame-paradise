/**
 * @fileoverview 룰 가이드: 헤더 버튼으로 여는 5개 탭 안내 오버레이.
 *
 * 무대는 STATE마다 innerHTML이 갈아엎어지므로 가이드 요소는 한 번만 만들어 두고
 * 열려 있는 동안 재렌더 직후 `attach()`로 다시 붙인다(탭·스크롤 상태가 DOM에 그대로 남는다).
 * 대국 진행(타이머)은 멈추지 않는다.
 */
import { tileHtml } from './tiles.js';

const split = (s) => s.trim().split(/\s+/);
/** 패 코드 목록 → 패 HTML. '|'는 간격, winIdx는 빛나는(마지막으로 들어온) 패 */
const row = (codes, size = 't-meld', winIdx = -1) => codes
  .map((c, i) => (c === '|' ? '<span class="gap"></span>' : tileHtml(c, size, i === winIdx ? 'win' : '')))
  .join('');

const GOAL_SETS = [['2m 3m 4m', '슌쯔 · 연속 3장'], ['5p 6p 7p', '슌쯔'], ['3s 3s 3s', '커쯔 · 같은 패 3장'], ['6s 7s 8s', '슌쯔'], ['5p 5p', '머리 · 같은 패 2장']];
const SUITS = [
  ['만수 1~9', '1m 2m 3m 4m 5m 6m 7m 8m 9m'],
  ['통수 1~9', '1p 2p 3p 4p 5p 6p 7p 8p 9p'],
  ['삭수 1~9', '1s 2s 3s 4s 5s 6s 7s 8s 9s'],
  ['자패', '1z 2z 3z 4z | 5z 6z 7z'],
];
// 역 카드: 마지막 패 = 화료패. tag: closed(문전만) / open(울어도 OK)
const YAKU = [
  { n: '리치', h: '1판', tag: 'closed', star: true, d: '울지 않고 텐파이에서 "리치" 선언. 가장 쉽고 확실한 역이에요.', t: '1m 2m 3m | 4p 5p 6p | 7s 8s 9s | 1z 1z | 3s 4s 5s' },
  { n: '멘젠쯔모', h: '1판', tag: 'closed', d: '울지 않은 채로 내가 뽑은 패로 완성(쯔모)하면 붙어요.', t: '3m 4m 5m | 3p 4p 5p | 6p 7p 8p | 2s 2s | 9s 9s 9s' },
  { n: '탕야오', h: '1판', tag: 'open', star: true, d: '2~8 숫자패만 사용. 1·9와 자패가 하나도 없으면 돼요.', t: '2m 3m 4m | 5p 6p 7p | 3s 3s 3s | 5p 5p | 6s 7s 8s' },
  { n: '역패', h: '1판', tag: 'open', d: '백·발·중 3장, 또는 이번 판 바람·내 바람 3장. 세트마다 1판.', t: '1m 2m 3m | 4p 5p 6p | 7s 8s 9s | 1p 1p | 7z 7z 7z' },
  { n: '핑후', h: '1판', tag: 'closed', d: '슌쯔 4개 + 역패가 아닌 머리, 양쪽 어느 패로도 완성되는 대기.', t: '2m 3m 4m | 4m 5m 6m | 6p 7p 8p | 8p 8p | 3s 4s 5s' },
  { n: '치또이츠', h: '2판', tag: 'closed', d: '서로 다른 머리(같은 패 2장) 7쌍. 몸통이 없어도 돼요.', t: '1m 1m | 3m 3m | 5p 5p | 7p 7p | 2s 2s | 1z 1z | 6s 6s' },
  { n: '또이또이', h: '2판', tag: 'open', d: '몸통 4개가 전부 커쯔(같은 패 3장). 퐁을 많이 하면 노리기 좋아요.', t: '2m 2m 2m | 7p 7p 7p | 3z 3z 3z | 9m 9m | 4s 4s 4s' },
  { n: '혼일색', h: '3판', tag: 'open', d: '한 종류 숫자패 + 자패만. 울면 2판이 돼요.', t: '1p 2p 3p | 4p 5p 6p | 5z 5z 5z | 4z 4z | 7p 8p 9p' },
];
// 울기 예시: 마지막(빛나는) 패 = 남이 버려서 가져온 패
const CALLS = [
  ['퐁', '3s 3s 3s', 2, '같은 패 2장 + 남이 버린 1장. 누가 버려도 돼요.'],
  ['치', '3m 4m 5m', 0, '연속 3장 중 1장을 바로 앞 사람(왼쪽)이 버린 패로.'],
  ['깡', '9p 9p 9p 9p', 3, '같은 패 3장 + 버린 1장. 내 손의 4장(암깡)은 울기가 아니에요.'],
];
const callsHtml = CALLS.map(([n, c, w, d]) => `<div class="call"><div class="call-head"><em>${n}</em><div class="tiles">${row(split(c), 't-meldo', w)}</div></div><small>${d}</small></div>`).join('');
const DORA_EX =[['3m', '4m'], ['9p', '1p'], ['4z', '1z'], ['7z', '5z']];

const goalHtml = GOAL_SETS.map(([c, l], i) => `<div class="goal-set${i === 4 ? ' head' : ''}"><div class="tiles">${row(split(c), 't-res')}</div><em>${l}</em></div>`).join('');
const suitsHtml = SUITS.map(([n, c]) => `<span>${n}</span><div class="tiles">${row(split(c), 't-meldo')}</div>`).join('')
  + '<span></span><span style="font-weight:700">동·남·서·북(바람) | 백·발·중(삼원패) — 자패는 연속 3장을 만들 수 없어요</span>';
const yakuHtml = YAKU.map((y) => {
  const codes = split(y.t);
  return `<div class="yk${y.star ? ' star' : ''}"><div class="yk-head"><h4>${y.n}</h4><span class="han">${y.h}</span><span class="tag ${y.tag}">${y.tag === 'closed' ? '문전만' : '울어도 OK'}</span></div><p>${y.d}</p><div class="tiles">${row(codes, 't-meldo', codes.length - 1)}</div></div>`;
}).join('');
const doraHtml = DORA_EX.map(([a, b]) => `<div>${tileHtml(a, 't-meld')}→${tileHtml(b, 't-meld', 'win')}</div>`).join('');

const TABS = [['flow', '기본 흐름'], ['buttons', '버튼 설명'], ['yaku', '자주 나오는 역'], ['score', '점수·용어'], ['call', '울기']];

function bodyHtml() {
  return `
  <section class="g-pane on" data-pane="flow">
    <div class="g-card">
      <h3>목표 — 14장으로 "몸통 4개 + 머리 1개"를 먼저 만들면 이겨요</h3>
      <div class="goal"><div class="goal-sets">${goalHtml}</div><div class="goal-eq"><b>4 + 1</b>완성하면<br>쯔모·론으로 화료!</div></div>
    </div>
    <div class="g-row two" style="margin-top:14px">
      <div class="g-card"><h3>패 종류</h3><div class="suit">${suitsHtml}</div></div>
      <div class="g-card">
        <h3>한 판은 이렇게 흘러가요</h3>
        <ol class="steps">
          <li><div>내 차례에 패를 1장 뽑아요<small>뽑은 패는 손패 오른쪽에 떨어져 놓여요.</small></div></li>
          <li><div>필요 없는 패 1장을 버려요<small>생각 시간 15초 + 대국 전체 여유 20초. 넘기면 방금 뽑은 패를 자동으로 버려요.</small></div></li>
          <li><div>남이 버린 패가 필요하면 가져올 수 있어요<small>퐁·치·깡으로 가져오면 "울기"예요(5번 탭). 10초 안에 골라요.</small></div></li>
          <li><div>누군가 화료하거나 패가 다 떨어지면 한 국이 끝나요<small>동풍전은 4국, 반장전은 8국을 해요.</small></div></li>
        </ol>
      </div>
    </div>
    <div class="g-tip"><span class="ic">⚠</span><span>모양이 완성돼도 <b>"역"이 1개 이상</b> 있어야 화료할 수 있어요. 처음엔 <b>울지 않고 리치</b>만 기억해도 충분해요.</span><button class="g-link" type="button" data-goto="yaku">3. 역 보기 →</button></div>
  </section>

  <section class="g-pane" data-pane="buttons">
    <div class="btn-wrap">
      <div>
        <div class="minimap"><div class="mm-center"></div><div class="mm-hand"></div><div class="mm-acts"><i></i><i></i><i></i></div><div class="mm-ring"></div><span class="mm-label">버튼이 뜨는 곳</span></div>
        <div class="side-notes">
          <div><b>할 수 있을 때만 떠요.</b> 화면에 없는 버튼은 지금 쓸 수 없는 거예요.</div>
          <div><b>빛나는 버튼</b>은 화료나 중요한 선택이에요.</div>
          <div><b>도우미</b>를 켜면 추천 버림과 대기패를 알려 줘요.</div>
        </div>
      </div>
      <div class="btn-grid">
        <div class="btn-card"><button class="act pulse" type="button" tabindex="-1">쯔모<small>화료!</small></button><p><b>내가 뽑은 패로 완성됐을 때</b>누르면 이겨요. 나머지 3명이 점수를 나눠 내요.</p></div>
        <div class="btn-card"><button class="act pulse" type="button" tabindex="-1">론<small>화료!</small></button><p><b>남이 버린 패로 완성될 때</b>버린 사람이 점수를 혼자 내요.</p></div>
        <div class="btn-card"><button class="act" type="button" tabindex="-1">리치</button><p><b>울지 않고 1장만 남았을 때</b>버릴 패를 고르고 "리치 확정". 1,000점을 걸고 역 1개 확보, 이후 손패는 고정돼요.</p></div>
        <div class="btn-card"><button class="act" type="button" tabindex="-1">퐁<small>3삭 ×3</small></button><p><b>버린 패와 같은 패가 2장 있을 때</b>누가 버렸든 가져와 3장 세트를 만들어요.</p></div>
        <div class="btn-card"><button class="act" type="button" tabindex="-1">치<small>3·4·5</small></button><p><b>바로 앞 사람(왼쪽)이 버렸을 때만</b>연속 3장을 만들어요.</p></div>
        <div class="btn-card"><button class="act" type="button" tabindex="-1">깡<small>4장</small></button><p><b>같은 패 4장</b>보충패를 1장 더 뽑고 도라가 늘어요. 암깡·가깡도 같은 원리예요.</p></div>
        <div class="btn-card"><button class="act ghost" type="button" tabindex="-1">버리기</button><p><b>패를 골랐을 때</b>패를 한 번 눌러 고르고 이 버튼, 또는 같은 패를 한 번 더 누르면 버려요.</p></div>
        <div class="btn-card"><button class="act ghost" type="button" tabindex="-1">패스</button><p><b>가져오지 않고 넘길 때</b>10초가 지나면 자동으로 패스돼요.</p></div>
        <div class="btn-card wide"><button class="act ghost" type="button" tabindex="-1">구종구패<small>유국 선언</small></button><p><b>첫 차례에 1·9·자패가 9종류 이상일 때</b>패가 너무 나쁘면 이번 국을 무르고 다시 나눠요. 안 눌러도 괜찮아요.</p></div>
      </div>
    </div>
    <div class="g-tip"><span class="ic">⚠</span><span>퐁·치·깡으로 <b>울면 리치를 할 수 없어요.</b> 역이 없으면 화료 버튼이 뜨지 않으니, 처음엔 울지 말고 리치를 노려 보세요.</span></div>
  </section>

  <section class="g-pane" data-pane="yaku">
    <p class="lead" style="margin-bottom:10px">역은 "이런 모양으로 이기면 점수를 준다"는 조건이에요. 하나 이상 있어야 화료할 수 있어요. <b style="color:var(--ui-text)">빛나는 패</b>가 마지막으로 들어온 패예요.</p>
    <div class="yaku-grid">${yakuHtml}</div>
    <p class="more"><b>문전</b> = 퐁·치·밝은 깡을 하지 않은 상태. 더 높은 역은 결과 화면의 <b>ⓘ</b>에 마우스를 올리거나 탭하면 설명이 나와요.</p>
  </section>

  <section class="g-pane" data-pane="call">
    <div class="g-card">
      <h3>울기 — 남이 버린 패를 가져와 몸통을 만드는 것</h3>
      <p class="lead" style="margin-bottom:10px">내가 뽑지 않고 남이 버린 패(빛나는 패)로 세트를 만들면 "울었다"고 해요. 울린 세트는 패를 눕혀 모두에게 보여 줘요.</p>
      <div class="calls">${callsHtml}</div>
    </div>
    <div class="g-row two" style="margin-top:14px">
      <div class="g-card">
        <h3>좋은 점</h3>
        <p>손패를 <b>빨리 완성</b>할 수 있어요. 탕야오·또이또이·역패처럼 울어도 되는 역으로 빠르게 이길 때 써요.</p>
      </div>
      <div class="g-card">
        <h3>잃는 것 — 문전이 깨져요</h3>
        <p><b>리치</b>를 할 수 없고, <b>멘젠쯔모·핑후</b>가 붙지 않아요. 혼일색 같은 역은 <b>1판 줄어요.</b></p>
      </div>
    </div>
    <div class="g-tip"><span class="ic">⚠</span><span>역이 없으면 화료할 수 없어요. 역이 확실하지 않으면 <b>울지 말고 리치</b>를 노리는 게 안전해요.</span><button class="g-link" type="button" data-goto="yaku">3. 역 보기 →</button></div>
  </section>

  <section class="g-pane" data-pane="score">
    <div class="score-wrap">
      <div class="g-card">
        <h3>판이 많을수록 점수가 커져요</h3>
        <table class="score">
          <thead><tr><th>판 수</th><th>자(子) 론</th><th>친(親) 론</th></tr></thead>
          <tbody>
            <tr><td><b>1판</b></td><td>1,000</td><td>1,500</td></tr>
            <tr><td><b>2판</b></td><td>2,000</td><td>2,900</td></tr>
            <tr><td><b>3판</b></td><td>3,900</td><td>5,800</td></tr>
            <tr class="limit"><td><b>4~5판</b> 만관</td><td>8,000</td><td>12,000</td></tr>
            <tr class="limit"><td><b>6~7판</b> 하네만</td><td>12,000</td><td>18,000</td></tr>
            <tr class="limit"><td><b>8~10판</b> 배만</td><td>16,000</td><td>24,000</td></tr>
            <tr class="limit"><td><b>11~12판</b> 삼배만</td><td>24,000</td><td>36,000</td></tr>
            <tr class="limit"><td><b>13판~</b> 역만</td><td>32,000</td><td>48,000</td></tr>
          </tbody>
        </table>
        <p class="score-note">1~3판은 30부 기준이에요(손 모양에 따라 조금 달라요). 친은 1.5배를 받아요.</p>
        <h3 style="margin-top:12px">대국이 끝나는 때</h3>
        <ul class="end-list">
          <li>동풍전 4국(반장전 8국)을 모두 마치면 종료</li>
          <li>누군가 0점 아래로 내려가면 즉시 종료</li>
          <li>끝났는데 1등이 30,000점 미만이면 최대 4국 연장</li>
          <li>친이 이기거나 텐파이면 친을 한 번 더 해요(본장 +300점)</li>
        </ul>
      </div>
      <div>
        <div class="g-card">
          <h3>도라 — 가지고 있으면 1장당 +1판</h3>
          <p class="lead">가운데 판에 앞면으로 놓인 패가 <b style="color:var(--ui-text)">도라 표시패</b>예요. 그 <b style="color:var(--ui-text)">다음 패</b>가 도라예요. 도라는 역이 아니라서 도라만으로는 화료할 수 없어요.</p>
          <div class="dora-ex">${doraHtml}</div>
        </div>
        <div class="g-card" style="margin-top:12px">
          <h3>자주 보는 말</h3>
          <dl class="terms">
            <div><dt>텐파이</dt><dd>1장만 오면 완성되는 상태</dd></div>
            <div><dt>향청</dt><dd>텐파이까지 남은 정도. 3향청 = 3장 더 바꿔야 해요(0이면 텐파이)</dd></div>
            <div><dt>후리텐</dt><dd>내가 버린 패로 완성되면 론은 못 해요(쯔모는 OK)</dd></div>
            <div><dt>울기</dt><dd>퐁·치·깡으로 남이 버린 패를 가져오는 것</dd></div>
            <div><dt>적도라</dt><dd>빨간 5. 1장당 +1판</dd></div>
            <div><dt>뒷도라</dt><dd>리치로 이기면 추가로 공개되는 도라</dd></div>
            <div><dt>현물</dt><dd>그 사람이 이미 버린 패. 그 사람에게는 안전해요</dd></div>
            <div><dt>유국</dt><dd>패가 다 떨어진 무승부. 텐파이 아닌 사람이 벌점</dd></div>
          </dl>
        </div>
      </div>
    </div>
  </section>`;
}

/**
 * 룰 가이드를 만든다. 요소는 한 번만 만들어 재사용한다.
 * @param {HTMLElement} stage 무대 요소(CSS 변수가 정의된 곳)
 * @param {{onToggle?:(open:boolean)=>void}} [opts] 열림 상태가 바뀔 때 호출
 * @returns {{open:()=>void, close:()=>void, toggle:()=>void, attach:()=>void, isOpen:()=>boolean}} 제어 핸들
 */
export function createGuide(stage, { onToggle } = {}) {
  let el = null;
  let opened = false;

  const build = () => {
    el = document.createElement('div');
    el.className = 'overlay guide-layer';
    el.id = 'guide-layer';
    el.innerHTML = `<div class="guide" role="dialog" aria-modal="true" aria-label="마작 룰 가이드">
      <div class="g-head"><h2>📖 룰 가이드</h2><span>처음이라면 1 → 2 순서로 보세요. 대국 중에도 열 수 있어요.</span><button class="g-close" type="button" data-gclose aria-label="닫기">✕</button></div>
      <div class="g-tabs" role="tablist">${TABS.map(([id, name], i) => `<button class="g-tab${i === 0 ? ' on' : ''}" type="button" role="tab" data-tab="${id}"><b>${i + 1}</b>${name}</button>`).join('')}</div>
      <div class="g-body">${bodyHtml()}</div>
    </div>`;
    el.addEventListener('click', (e) => {
      if (e.target === el || e.target.closest('[data-gclose]')) { close(); return; }
      const t = e.target.closest('[data-tab], [data-goto]');
      if (t) setTab(t.dataset.tab || t.dataset.goto);
    });
  };

  function setTab(id) {
    el.querySelectorAll('.g-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
    el.querySelectorAll('.g-pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === id));
    el.querySelector('.g-body').scrollTop = 0;
  }
  function attach() {
    if (opened && el && el.parentElement !== stage) stage.appendChild(el);
  }
  function open() {
    if (!el) build();
    opened = true;
    attach();
    onToggle?.(true);
  }
  function close() {
    opened = false;
    el?.remove();
    onToggle?.(false);
  }
  function toggle() { if (opened) close(); else open(); }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && opened) close(); });
  return { open, close, toggle, attach, isOpen: () => opened };
}
