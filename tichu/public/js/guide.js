/**
 * @fileoverview 룰 가이드 오버레이(헤더 `#btn-guide`). 요소를 한 번만 만들어 두고 `render()`마다 `attach()`로 무대에 다시 붙이므로
 * 열린 상태·탭이 재렌더에도 유지된다. 열려 있어도 타이머는 멈추지 않고, 오버레이가 아래 화면의 클릭을 막는다.
 * 규칙 수치(타이머·점수 등)가 바뀌면 이 문구도 함께 고친다.
 */
import { cardsHtml } from './cardview.js';
import { idOf } from '../lib/cards.js';

const ids = (s) => s.split(' ').map(idOf);

const TABS = [
  ['flow', '기본 흐름', () => `
    <p class="lead">티추는 <b>맞은편 사람과 한 팀</b>이 되는 2:2 카드 게임이에요. 손에 든 카드를 <b>가장 먼저 다 내는 것</b>이 목표예요.</p>
    <ol>
      <li><b>8장을 받고 그랜드 티추 선택</b> — 처음 8장만 보고 "내가 1등으로 나간다"고 크게 선언할지 정해요(±200점). 안 해도 돼요.</li>
      <li><b>6장을 더 받고 카드 교환</b> — 14장 중 3장을 골라 <b>왼쪽 상대 · 파트너 · 오른쪽 상대</b>에게 한 장씩 줘요. 파트너에게는 좋은 카드, 상대에게는 약한 카드를 줘요.</li>
      <li><b>참새(1)를 가진 사람이 먼저</b> — 아무 조합이나 내면 시계 방향으로 돌아가요. 앞 사람보다 <b>같은 종류로 더 높게</b> 내거나 패스해요.</li>
      <li><b>모두 패스하면 낸 사람이 트릭을 가져가고</b> 다시 선이 돼요. 가져간 카드의 점수가 팀 점수가 돼요.</li>
      <li><b>먼저 카드를 다 낸 사람이 1등</b>이에요. 3명이 나가거나 같은 팀이 1·2등으로 나가면 라운드가 끝나요.</li>
    </ol>
    <p class="note">목표 점수(500/1000)를 먼저 넘긴 팀이 이겨요. <b>티추</b>는 첫 카드를 내기 전에 부를 수 있어요(성공 +100 / 실패 −100).</p>`],
  ['combo', '낼 수 있는 조합', () => `
    <table class="gt">
      <tr><td>싱글</td><td>카드 한 장</td><td class="cs">${cardsHtml(ids('Kj'), 'sm')}</td></tr>
      <tr><td>페어</td><td>같은 숫자 두 장</td><td class="cs">${cardsHtml(ids('8j 8s'), 'sm')}</td></tr>
      <tr><td>트리플</td><td>같은 숫자 세 장</td><td class="cs">${cardsHtml(ids('5j 5s 5p'), 'sm')}</td></tr>
      <tr><td>풀하우스</td><td>트리플 + 페어(트리플 숫자로 비교)</td><td class="cs">${cardsHtml(ids('Qj Qs Qp 4j 4s'), 'xs')}</td></tr>
      <tr><td>스트레이트</td><td>이어지는 숫자 5장 이상</td><td class="cs">${cardsHtml(ids('3j 4s 5p 6t 7j'), 'xs')}</td></tr>
      <tr><td>연속 페어</td><td>이어지는 페어 2쌍 이상</td><td class="cs">${cardsHtml(ids('5j 5s 6p 6t'), 'xs')}</td></tr>
      <tr><td>폭탄</td><td>같은 숫자 네 장, 또는 같은 무늬 스트레이트 5장 이상</td><td class="cs">${cardsHtml(ids('9j 9s 9p 9t'), 'xs')}</td></tr>
    </table>
    <p class="note">앞 사람과 <b>같은 종류·같은 장수</b>로만 이길 수 있어요(스트레이트는 길이도 같아야 해요). <b>폭탄은 내 차례가 아니어도</b>, 무엇 위에든 낼 수 있어요. 폭탄끼리는 네 장 &lt; 무늬 스트레이트, 길고 높은 쪽이 이겨요.</p>`],
  ['special', '특수 카드 4장', () => `
    <table class="gt">
      <tr><td class="cs">${cardsHtml(ids('MJ'), 'sm')}</td><td><b>참새 (1)</b> — 가장 낮은 카드. 스트레이트에 1로 들어가요. 이 카드를 낼 때 <b>소원</b>(숫자 하나)을 빌 수 있어요. 소원 숫자를 낼 수 있는 다음 사람은 꼭 그 숫자를 내야 해요. 가진 사람이 첫 선이에요.</td></tr>
      <tr><td class="cs">${cardsHtml(ids('DOG'), 'sm')}</td><td><b>개</b> — 선일 때만 낼 수 있고, <b>파트너에게 선을 넘겨요</b>. 이길 수도 질 수도 없는 카드라 0점이에요.</td></tr>
      <tr><td class="cs">${cardsHtml(ids('PHX'), 'sm')}</td><td><b>봉황 (−25점)</b> — 조합에서 <b>아무 숫자 대신</b> 쓸 수 있어요(폭탄 제외). 싱글로 내면 앞 카드보다 0.5 높아요(선이면 1.5, 용은 못 이겨요).</td></tr>
      <tr><td class="cs">${cardsHtml(ids('DRG'), 'sm')}</td><td><b>용 (+25점)</b> — 가장 높은 싱글(폭탄만 이겨요). 용으로 이긴 트릭은 <b>상대 팀 한 명에게 줘야</b> 해요.</td></tr>
    </table>`],
  ['score', '점수', () => `
    <table class="gt">
      <tr><td>카드 점수</td><td>5 = 5점 · 10 = 10점 · K = 10점 · 용 +25 · 봉황 −25 (한 라운드 합계 100점)</td></tr>
      <tr><td>1등 · 꼴찌</td><td>꼴찌가 딴 카드는 <b>1등에게</b>, 꼴찌의 남은 손패 점수는 <b>상대 팀에게</b> 가요.</td></tr>
      <tr><td>원투 피니시</td><td>같은 팀이 1·2등이면 카드 점수 대신 <b>200점</b>을 받고 라운드가 바로 끝나요.</td></tr>
      <tr><td>티추 콜</td><td>첫 카드를 내기 전에 선언. <b>내가 1등으로 나가면</b> +100, 아니면 −100. 파트너가 1등이어도 실패예요.</td></tr>
      <tr><td>그랜드 티추</td><td>처음 8장만 보고 선언. 성공 +200 / 실패 −200.</td></tr>
    </table>
    <p class="note">시간 제한: 낼 차례 25초 + 대국 전체 여유 30초. 지나면 자동으로 진행해요.</p>`],
];

/**
 * @param {HTMLElement} stage 무대
 * @param {{onToggle?:(open:boolean)=>void}} [o] 열림 상태가 바뀔 때 호출
 * @returns {{attach:()=>void, toggle:()=>void, isOpen:()=>boolean}} 가이드
 */
export function createGuide(stage, o = {}) {
  const el = document.createElement('div');
  el.className = 'guide hidden';
  let tab = 'flow';
  let open = false;

  function paint() {
    const cur = TABS.find((t) => t[0] === tab) || TABS[0];
    el.innerHTML = `<div class="gbox"><div class="ghead"><h2>📖 티추 룰 가이드</h2><button class="gx" data-g="close" aria-label="닫기">✕</button></div>
      <div class="gtabs">${TABS.map(([k, name]) => `<button class="${k === tab ? 'on' : ''}" data-g="tab" data-k="${k}">${name}</button>`).join('')}</div>
      <div class="gbody">${cur[2]()}</div></div>`;
  }

  function set(next) {
    open = next;
    el.classList.toggle('hidden', !open);
    if (open) paint();
    o.onToggle?.(open);
  }

  el.addEventListener('click', (e) => {
    const t = e.target;
    if (t === el) { set(false); return; }
    const b = t.closest('[data-g]');
    if (!b) return;
    if (b.dataset.g === 'close') set(false);
    else if (b.dataset.g === 'tab') { tab = b.dataset.k; paint(); }
  });
  document.addEventListener('keydown', (e) => { if (open && e.key === 'Escape') set(false); });

  return {
    attach() { if (el.parentNode !== stage) stage.appendChild(el); },
    toggle() { set(!open); },
    isOpen: () => open,
  };
}
