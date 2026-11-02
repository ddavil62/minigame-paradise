/**
 * @fileoverview 티추 클라이언트: 접속, 방 설정, 그랜드 티추·카드 교환·플레이·결과·종료 화면.
 *
 * 서버 권위 모델이라 이 파일은 상태를 그리고 행동 의도(ACT)만 보낸다. 낼 수 있는 조합의 판정은
 * 서버와 같은 `lib/combos.js`를 불러와 버튼 활성화·도우미 칩에만 쓴다(최종 판정은 항상 서버).
 * 프로토콜: C→S CONFIG/START/ACT/REMATCH/LEAVE/PAUSE/RESUME, S→C JOINED/ROOM/STATE/ERROR. 계약은 tichu/CLAUDE.md 참고.
 */
import { cardHtml, backHtml, cardsHtml, esc } from './cardview.js';
import { createSounds } from './sounds.js';
import { createFx } from './fx.js';
import { createGuide } from './guide.js';
import { rankOf, rankLabel, isMJ, isPhx, pointsOf, SUIT_NAMES, SUIT_KEYS } from '../lib/cards.js';
import { interpretations, pickCombo, enumeratePlays, phoenixChoices, label, beats, samePhx } from '../lib/combos.js';

const AI_CHAR = { 주작: '雀', 백호: '虎', 현무: '武', 청룡: '龍' };
const LEVEL_KO = { easy: '쉬움', normal: '보통', hard: '어려움' };
const POS = ['me', 'left', 'top', 'right'];
const TYPE_KO = { single: '싱글', pair: '페어', triple: '트리플', fullhouse: '풀하우스', straight: '스트레이트', pairseq: '연속 페어' };
const STAGE_W = 1200;
const STAGE_H = 760;

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const sounds = createSounds();
const fx = createFx(stage);
if (new URLSearchParams(location.search).get('auto')) window.__fx = fx; // 테스트 전용: 연출을 직접 띄워 본다
const guide = createGuide(stage, { onToggle: (open) => $('btn-guide').classList.toggle('on', open) });

const params = new URLSearchParams(location.search);
const store = {
  get(k, d = '') { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* noop */ } },
};
const session = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* noop */ } },
};

const S = {
  ws: null,
  seat: -1,
  room: null,
  st: null,
  offset: 0, // 서버 시계 − 내 시계
  sel: [], // 고른 카드 id
  phxAs: null, // 봉황이 대신할 숫자(애매할 때 고른 값)
  picks: [null, null, null], // 교환 슬롯(왼쪽·파트너·오른쪽 순으로 벌 수만큼씩)
  wish: null, // 참새를 낼 때 소원을 고르는 중이면 {ids, as}
  assist: store.get('tichu:assist') === '1',
  count: store.get('tichu:count') === '1', // 카드 카운팅 패널(나만 보여요)
  leaveAsk: false,
  winRender: 0,
  lastTurnKey: '',
  tickSec: -1,
};

// ── 접속 ────────────────────────────────────────────────────
function playerKey() {
  let k = session.get('tichu:key');
  if (!k) { k = `k${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`; session.set('tichu:key', k); }
  return k;
}
function playerName() {
  return params.get('name') || store.get('minigames:nickname') || '플레이어';
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const seg = location.pathname.split('/').filter(Boolean)[0] || 'tichu';
  const url = `${proto}://${location.host}/${seg}/ws?key=${encodeURIComponent(playerKey())}&name=${encodeURIComponent(playerName())}${params.get('role') ? `&role=${encodeURIComponent(params.get('role'))}` : ''}${params.get('room') ? `&room=${encodeURIComponent(params.get('room'))}` : ''}`;
  const ws = new WebSocket(url);
  S.ws = ws;
  ws.addEventListener('open', () => { $('conn').classList.add('hidden'); });
  ws.addEventListener('message', (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    onMessage(m);
  });
  ws.addEventListener('close', (e) => {
    if (e.code === 1000 && (e.reason === 'LEAVE' || e.reason === 'room_full' || e.reason === 'in_progress')) return;
    if (e.code === 4000) { showToast('다른 창에서 접속해 이 창은 연결이 끊겼어요.'); return; }
    $('conn').classList.remove('hidden');
    setTimeout(connect, 1500);
  });
}

function send(msg) {
  if (S.ws && S.ws.readyState === WebSocket.OPEN) S.ws.send(JSON.stringify(msg));
}

function act(action) {
  S.sel = [];
  S.phxAs = null;
  S.wish = null;
  send({ type: 'ACT', action });
}

function onMessage(m) {
  switch (m.type) {
    case 'JOINED':
      S.seat = m.seat;
      break;
    case 'ROOM':
      S.room = m;
      if (m.phase === 'lobby') { S.st = null; S.sel = []; S.picks = emptyPicks(); S.wish = null; }
      render();
      break;
    case 'STATE': {
      const prev = S.st?.view;
      S.st = m;
      S.offset = m.serverNow - Date.now();
      const v = m.view;
      S.sel = S.sel.filter((id) => v.hand.includes(id));
      if (v.phase !== 'exchange') S.picks = emptyPicks();
      else S.picks = Array.from({ length: 3 * decksOf() }, (_, i) => (S.picks[i] != null && v.hand.includes(S.picks[i]) ? S.picks[i] : null));
      if (!(v.legal && v.legal.kind === 'turn')) S.wish = null;
      render();
      playEvents(m.events || [], v);
      trackMyTurn(prev, v);
      if (params.get('auto')) autoPlay(v);
      break;
    }
    case 'ERROR':
      if (m.code === 'room_full' || m.code === 'in_progress') {
        stage.innerHTML = `<div class="connecting">${esc(m.message || '입장할 수 없어요.')}</div>`;
      } else {
        sounds.play('error');
        showToast(m.message || '지금은 할 수 없는 행동이에요.');
      }
      break;
    default: break;
  }
}

function showToast(text) {
  const old = document.querySelector('.err-toast');
  if (old) old.remove();
  const el = document.createElement('div');
  el.className = 'err-toast';
  el.textContent = text;
  stage.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

/** 테스트 전용(`?auto=1`): 단순 전략으로 자동 진행해 화면을 빠르게 확인한다. */
function autoPlay(v) {
  const legal = v.legal;
  if (!legal) return;
  const go = (a) => setTimeout(() => send({ type: 'ACT', action: a }), 60);
  if (legal.kind === 'grand') go({ type: 'grand', on: false });
  else if (legal.kind === 'exchange') go({ type: 'exchange', give: v.hand.slice(0, 3 * decksOf()) });
  else if (legal.kind === 'review') go({ type: 'next' });
  else if (legal.kind === 'ack') setTimeout(() => send({ type: 'ACT', action: { type: 'next' } }), Math.max(1500, Number(params.get('auto')) * 5));
  else if (legal.kind === 'gift') go({ type: 'gift', to: legal.options[0] });
  else if (legal.kind === 'turn') {
    const plays = enumeratePlays(v.hand, v.trick.top).filter((c) => !c.bomb && c.type !== 'dog');
    let pick = plays.sort((a, b) => a.rank - b.rank || a.n - b.n)[0];
    if (legal.wish) pick = plays.find((c) => c.ids.some((id) => !isPhx(id) && rankOf(id) === legal.wish)) || pick;
    if (pick && !(v.trick.top && !legal.wish && v.trick.topSeat === (S.seat + 2) % 4)) {
      const a = { type: 'play', ids: pick.ids };
      if (pick.phx && pick.ids.length > 1) a.as = pick.phx;
      if (!v.wishUsed && pick.ids.some(isMJ)) a.wish = 9;
      const wait = Math.max(0, v.openAt - (Date.now() + S.offset)) + 80;
      setTimeout(() => send({ type: 'ACT', action: a }), wait);
    } else if (legal.canPass) {
      const wait = Math.max(0, v.openAt - (Date.now() + S.offset)) + 80;
      setTimeout(() => send({ type: 'ACT', action: { type: 'pass' } }), wait);
    } else if (plays[0]) go({ type: 'play', ids: plays[0].ids });
  }
}

// ── 공통 계산 ───────────────────────────────────────────────
/** 지금 방의 벌 수(1 또는 2). 2벌이면 28장·교환 6장·점수 2배다. */
const decksOf = () => S.st?.view?.settings?.decks || S.room?.settings?.decks || 1;
const emptyPicks = () => Array(3 * decksOf()).fill(null);
const phxText = (p) => (Array.isArray(p) ? p.map(rankLabel).join('·') : rankLabel(p));
const phxJson = (p) => JSON.stringify(p);

const relOf = (seat) => (seat - S.seat + 4) % 4;
const teamOf = (seat) => seat % 2;
const isUs = (seat) => teamOf(seat) === teamOf(S.seat);
const nowMs = () => Date.now() + S.offset;

function seatInfo(seat) { return S.st?.seats?.[seat] || S.room?.seats?.[seat] || { name: '', type: 'empty' }; }
const nameOf = (seat) => seatInfo(seat).name || `자리${seat + 1}`;
function avatarChar(info) { return AI_CHAR[info.name] || (info.name || '?').slice(0, 1); }
function roleOf(seat) { return seat === S.seat ? '우리 팀' : relOf(seat) === 2 ? '파트너' : '상대 팀'; }
const needText = (top) => (top.bomb ? '더 강한 폭탄' : `더 높은 ${TYPE_KO[top.type] || ''}`);
const comboLabel = (c) => `${label(c)}${c.phx && c.ids.length > 1 && c.ids.some(isPhx) ? ` (봉황=${phxText(c.phx)})` : ''}`;

/** 내가 고른 카드의 해석: {combo, shape, mine, choices} */
function selInfo(v) {
  const ids = S.sel;
  if (!ids.length || !v.legal) return null;
  const mine = v.legal.kind === 'turn';
  const top = v.trick.top;
  const choices = phoenixChoices(ids, top);
  const as = S.phxAs !== null && choices.some((c) => samePhx(c, S.phxAs)) ? S.phxAs : undefined;
  const combo = pickCombo(ids, top, { as, outOfTurn: !mine });
  const shape = interpretations(ids, null)[0] || null;
  return { combo, shape, mine, choices, as: combo && combo.phx && ids.length > 1 ? combo.phx : undefined };
}

// ── 화면: 방 설정 ───────────────────────────────────────────
function renderLobby() {
  const r = S.room;
  if (!r) { stage.innerHTML = '<div class="connecting">접속 중…</div>'; return; }
  const me = r.me;
  const set = r.settings;
  const humans = r.seats.filter((s) => s.type === 'human');
  const seatBox = (cls, seat) => {
    const s = r.seats[seat];
    const rel = relOf(seat);
    const us = isUs(seat);
    const team = us ? 't-us' : 't-them';
    let av;
    let body;
    if (s.type === 'human') {
      const isMe = seat === me;
      av = `<div class="av">${esc(avatarChar(s))}</div>`;
      body = `<b>${esc(s.name)} ${isMe ? '<em class="tg you">YOU</em>' : '<em class="tg hu">친구</em>'}${s.host ? ' <em class="tg ai">방장</em>' : ''}</b>
        <small>${rel === 2 ? '파트너' : us ? '우리 팀' : '상대 팀'} · ${s.connected ? '접속 중' : '연결 끊김'}</small>`;
    } else {
      av = `<div class="av">${s.type === 'ai' ? esc(avatarChar(s)) : '🤖'}</div>`;
      body = `<b>${s.type === 'ai' ? esc(s.name) : 'AI'} <em class="tg ai">AI</em></b><small>${rel === 2 ? '파트너' : '상대 팀'} · ${LEVEL_KO[set.aiLevel]} AI가 앉아요</small>`;
    }
    return `<div class="sseat ${cls} ${team}${seat === me ? ' me' : ''}">${av}<div>${body}</div></div>`;
  };
  const posCls = { 0: 'ss-bottom', 1: 'ss-left', 2: 'ss-top', 3: 'ss-right' };
  const seats = [0, 1, 2, 3].map((seat) => seatBox(posCls[relOf(seat)], seat)).join('');
  const seg = (key, options) => `<div class="mini">${options.map(([val, t]) => `<i${r.isHost ? ` data-cfg="${key}" data-val="${val}"` : ''} class="${set[key] === val ? 'on' : ''}">${t}</i>`).join('')}</div>`;
  const toggle = (key) => `<button class="toggle${set[key] ? '' : ' off'}" ${r.isHost ? `data-cfg="${key}" data-val="${set[key] ? 'off' : 'on'}" data-bool="1"` : 'disabled'}></button>`;
  const note = humans.length === 1
    ? '친구가 들어오면 마주 보는 자리에 앉아 파트너가 돼요. 혼자 시작하면 AI 3명과 해요.'
    : `사람 ${humans.length}명 + AI ${4 - humans.length}명으로 시작해요.${humans.length === 2 ? ' 두 사람은 마주 보는 파트너예요.' : ''}`;
  stage.innerHTML = `<div id="content"><div class="setup"><div>
    <h1>티추 방 설정 <small>4인 · 2:2 팀전</small></h1><p class="lead">${note}</p>
    <div class="sboard"><div class="link v"><span>파트너 · 같은 팀</span></div><div class="link h"><span>파트너 · 같은 팀</span></div>${seats}</div></div>
    <div class="sside"><h3>규칙</h3>
      <div class="opt"><span>카드 벌 수<small>${set.decks === 2 ? '더블 티추: 112장 · 28장씩 · 점수 2배' : '표준 티추: 56장 · 14장씩'}</small></span>${seg('decks', [[1, '1벌'], [2, '2벌(더블)']])}</div>
      <div class="opt"><span>목표 점수</span>${seg('target', set.decks === 2 ? [[1000, '1000'], [2000, '2000']] : [[500, '500'], [1000, '1000']])}</div>
      <div class="opt"><span>그랜드 티추<small>처음 ${8 * set.decks}장만 보고 ±${200 * set.decks}</small></span>${toggle('grand')}</div>
      <div class="opt"><span>폭탄 끼어들기 대기<small>낸 뒤 폭탄을 낼 시간</small></span>${seg('bombWindowMs', [[0, '없음'], [1000, '1초'], [2000, '2초'], [3000, '3초']])}</div>
      <div class="opt"><span>AI 난이도</span>${seg('aiLevel', [['easy', '쉬움'], ['normal', '보통'], ['hard', '어려움']])}</div>
      <div class="opt"><span>낼 수 있는 조합 도우미<small>초보용 칩 표시(나만 보여요)</small></span><button class="toggle${S.assist ? '' : ' off'}" data-local="assist"></button></div>
      <div class="rule-note">생각 시간 25초 + 여유 30초(대국 전체). 시간이 지나면 자동으로 진행해요.</div>
      ${r.isHost
        ? `<button class="start" data-do="start">게임 시작<small>${humans.length === 1 ? 'AI 3명과 시작' : `AI ${4 - humans.length}명이 빈자리를 채워요`}</small></button>`
        : '<div class="waiting-note">방장이 게임을 시작하길 기다리는 중이에요…</div>'}
    </div></div></div>`;
}

// ── 화면: 대국 ──────────────────────────────────────────────
function scoreHtml(v) {
  const us = teamOf(S.seat);
  const them = 1 - us;
  const t = v.settings.target;
  const row = (cls, name, val) => `<div class="row ${cls}"><b>${name}</b><div class="bar"><i style="width:${Math.max(0, Math.min(100, (val / t) * 100))}%"></i></div><span>${val}</span></div>`;
  const live = v.phase === 'play';
  const rest = 100 * v.settings.decks - v.wonPts[0] - v.wonPts[1];
  const round = live
    ? `<div class="rnd"><span>이번 라운드</span><b class="us">${v.wonPts[us]}</b><em>:</em><b class="them">${v.wonPts[them]}</b></div><small>남은 점수 ${rest} · 카드 점수 기준</small>`
    : '';
  return `<div class="score">${row('us', '우리 팀', v.scores[us])}${row('them', '상대 팀', v.scores[them])}<small>목표 ${t}점 · 라운드 ${v.round}</small>${round}</div>`;
}

/** 카드 카운팅: 모든 카드를 나온 것(흐림) · 내 손패(금색) · 아직 안 보인 것(진하게)으로 보여 준다. 공개 정보와 내 손패만 쓴다. */
function countHtml(v) {
  if (!S.count || v.phase !== 'play') return '';
  const decks = v.settings.decks;
  const played = new Set(v.played);
  const mine = new Set(v.hand);
  const unseen = 56 * decks - played.size - mine.size; // 다른 세 사람이 들고 있는 카드
  const cell = (base, head, cls) => {
    const ids = Array.from({ length: decks }, (_, d) => base + 56 * d);
    const st = ids.map((id) => (played.has(id) ? 'p' : mine.has(id) ? 'm' : 'u'));
    const left = st.filter((x) => x === 'u').length;
    const has = st.includes('m');
    const pts = pointsOf(base) !== 0 ? ' pt' : '';
    return `<div class="cc ${cls}${pts}${has ? ' mine' : ''}${left === 0 && !has ? ' gone' : ''}"><b>${head}</b><span>${st.map((x) => `<i class="${x}"></i>`).join('')}</span></div>`;
  };
  const suits = SUIT_KEYS.map((key, s) => {
    const cells = Array.from({ length: 13 }, (_, r) => cell(s * 13 + r, rankLabel(r + 2), `su-${key}`)).join('');
    return `<div class="crow"><em class="su-${key}"><svg><use href="#sym-${key}"/></svg>${SUIT_NAMES[s]}</em>${cells}</div>`;
  }).join('');
  const special = [[53, '참새', 'spc'], [52, '개', 'spc'], [54, '봉황', 'spc'], [55, '용', 'spc']].map(([b, n, c]) => cell(b, n, c)).join('');
  return `<div class="cpanel"><div class="chead"><b>카드 카운팅</b><span>나온 카드 <b>${played.size}</b> · 내 손패 <b>${mine.size}</b> · 상대 쪽 <b>${unseen}</b>장</span><button type="button" data-do="count" aria-label="닫기">✕</button></div><div class="caxis"><span>약함</span><i></i><span>강함</span></div>${suits}<div class="crow sp"><em>특수</em>${special}</div><div class="clegend"><i class="u"></i>아직 안 나옴 <i class="m"></i>내 손패(금색 테두리) <i class="p"></i>나옴 <i class="g"></i>점수 카드<em>무늬(옥·검·탑·별)는 강약이 같아요</em></div></div>`;
}

function rinfoHtml(v) {
  const bits = [];
  if (v.wish) bits.push(`<span class="wishb">소원 <b>${rankLabel(v.wish)}</b></span>`);
  bits.push(`<span>카드 점수 합 <b>${100 * v.settings.decks}</b></span>`);
  return `<div class="rinfo">${bits.join('')}</div>`;
}

function plateHtml(rel, v) {
  const seat = (S.seat + rel) % 4;
  const info = seatInfo(seat);
  const us = isUs(seat);
  const call = v.calls[seat];
  const place = v.out.indexOf(seat);
  const turn = v.pending?.type === 'turn' && v.pending.seat === seat && place < 0;
  let tag = '<em class="tg hu">사람</em>';
  if (seat === S.seat) tag = '<em class="tg you">YOU</em>';
  else if (info.type === 'ai') tag = '<em class="tg ai">AI</em>';
  const badges = [];
  if (call) badges.push(`<em class="bd ${call === 'grand' ? 'grand' : ''}">${call === 'grand' ? `그랜드 ${200 * v.settings.decks}` : `티추 ${100 * v.settings.decks}`}</em>`);
  if (place >= 0) badges.push(`<em class="bd ${place === 0 ? 'out' : 'stat'}">${place + 1}등</em>`);
  if (info.away) badges.push('<em class="bd stat">자리 비움</em>');
  let sub;
  if (place >= 0) sub = `<b>${place + 1}등</b>으로 나갔어요`;
  else if (v.phase === 'grand') sub = v.grandDone?.[seat] ? '<b>✓ 선택 완료</b>' : '<b>선택 중…</b>';
  else if (v.phase === 'exchange') sub = v.exchangeDone?.[seat] ? '<b>✓ 교환 선택 완료</b>' : '<b>카드 고르는 중…</b>';
  else if (v.pending?.type === 'review') sub = v.ackDone?.[seat] ? '<b>✓ 확인 완료</b>' : '<b>받은 카드 확인 중…</b>';
  else sub = `<b>${v.counts[seat]}</b>장 · ${roleOf(seat)}`;
  const timer = (S.st.timers || []).some((t) => t.seat === seat) ? '<div class="tm"><i style="width:0%"></i></div>' : '';
  const away = info.type === 'human' && !info.connected ? ' dc' : '';
  return `<div class="plate pl-${POS[rel]} t-${us ? 'us' : 'them'}${turn ? ' turn' : ''}${away}" data-seat="${seat}"><div class="av">${esc(avatarChar(info))}</div><div><div class="nm">${esc(info.name)} ${tag}${badges.join('')}</div><div class="sub">${sub}</div></div>${timer}</div>`;
}

/** 상대 손패: 이름판 쪽을 축으로 펼친 부채꼴. 겹침 간격(STEP)과 호(ARC)는 CSS 변수로 카드마다 계산한다. */
function backsHtml(v) {
  let h = '';
  for (const rel of [1, 2, 3]) {
    const seat = (S.seat + rel) % 4;
    const total = v.counts[seat];
    const n = Math.min(v.settings.decks === 2 ? 20 : 14, total);
    if (!n) continue;
    const pos = POS[rel];
    const mid = (n - 1) / 2;
    const step = Math.min(rel === 2 ? 24 : 18, (rel === 2 ? 300 : 228) / Math.max(1, n - 1)); // 장수가 많아도 좌우 열이 이름판·버튼과 겹치지 않게
    const cards = Array.from({ length: n }, (_, j) => {
      const d = j - mid;
      const along = d * step;
      const bow = 0.32 * d * d; // 가운데가 가장 멀리 나오는 호
      const a = 2.4;
      let x; let y; let r;
      if (pos === 'top') { x = along; y = -bow; r = -d * a; }
      else if (pos === 'left') { x = -bow; y = along; r = -90 + d * a; }
      else { x = bow; y = along; r = 90 - d * a; }
      return backHtml('op', '', `--x:${x.toFixed(1)}px;--y:${y.toFixed(1)}px;--r:${r.toFixed(2)}deg;z-index:${j}`);
    }).join('');
    const low = total <= 3 ? ' low' : '';
    h += `<div class="bk bk-${pos}">${cards}<span class="cnt${low}">${total}</span></div>`;
  }
  return h;
}

function zoneHtml(v) {
  const me = S.seat;
  if (v.phase === 'grand') {
    return `<div class="zone"><div class="ring"></div><div class="tinfo"><b>그랜드 티추</b><small>처음 ${8 * v.settings.decks}장만 보고 1등으로 나간다고 선언할지 정해요<br>모두 정하면 ${6 * v.settings.decks}장을 더 받아요</small></div></div>`;
  }
  if (v.phase === 'exchange') return exchangeHtml(v);
  const top = v.trick.top;
  const last = new Map();
  for (const p of v.trick.plays) last.set(p.seat, p);
  let plays = '';
  for (const [seat, p] of last) {
    const rel = relOf(seat);
    const latest = seat === v.trick.topSeat;
    plays += `<div class="play pp-${POS[rel]}${latest ? ' latest' : ''}${S.freshSeat === seat && latest ? ' fresh' : ''}"><div class="cs">${cardsHtml(p.ids, 'sm')}</div><div class="lb">${esc(nameOf(seat))} · ${esc(comboLabel(p))}</div></div>`;
  }
  for (const seat of v.trick.passed) {
    if (last.has(seat) && seat === v.trick.topSeat) continue;
    plays += `<div class="passtag pp-${POS[relOf(seat)]}">${esc(nameOf(seat))} 패스</div>`;
  }
  let info;
  if (!top) {
    const lead = v.pending?.type === 'turn' ? v.pending.seat : -1;
    info = lead === me ? '<b>내가 선이에요</b><small>무엇이든 낼 수 있어요<br>(참새를 가졌다면 소원도 빌 수 있어요)</small>'
      : lead >= 0 ? `<b>${esc(nameOf(lead))}님이 선</b><small>새 트릭이 시작돼요</small>` : '';
  } else {
    const mine = v.legal?.kind === 'turn';
    info = `<b>이 트릭 ${v.trick.points}점</b><small>${mine ? `이기려면 <u>${esc(needText(top))}</u>가 필요해요${top.bomb ? '' : '<br>(폭탄은 언제든 낼 수 있어요)'}` : `${esc(nameOf(v.trick.topSeat))}의 ${esc(label(top))}`}</small>`;
  }
  return `<div class="zone"><div class="ring"></div>${plays}${info ? `<div class="tinfo">${info}</div>` : ''}</div>`;
}

function exchangeHtml(v) {
  const per = v.settings.decks; // 한 사람에게 보내는 장수(1벌 1장, 2벌 2장)
  const slotDefs = [['to-left', 1], ['to-top', 2], ['to-right', 3]];
  const firstEmpty = S.picks.indexOf(null);
  const slots = slotDefs.map(([cls, rel], g) => {
    const seat = (S.seat + rel) % 4;
    const boxes = Array.from({ length: per }, (_, j) => {
      const i = g * per + j;
      const id = S.picks[i];
      return id != null
        ? `<div class="box fill" data-slot="${i}">${cardHtml(id, { size: 'md', data: false })}</div>`
        : `<div class="box${firstEmpty === i ? ' next' : ''}">＋</div>`;
    }).join('');
    return `<div class="slot ${cls}${per > 1 ? ' multi' : ''}"><div class="boxes">${boxes}</div><span class="to">${esc(nameOf(seat))}${rel === 2 ? '(파트너)' : ''}에게</span></div>`;
  }).join('');
  const done = v.exchangeDone?.[S.seat];
  const filled = S.picks.filter((x) => x != null).length;
  const total = 3 * per;
  const msg = done
    ? '내 선택은 끝났어요. 다른 사람을 기다려요…'
    : `카드를 한 장씩 눌러 ${total}칸을 채워요 (${filled}/${total})${per > 1 ? `<br>한 사람에게 ${per}장씩 보내요` : ''}<br><b style="color:var(--accent)">파트너에게는 도움이 될 카드, 상대에게는 약한 카드</b>를 보내요. 서로 동시에 교환해요.`;
  return `<div class="slots">${slots}<div class="msg">${msg}</div></div>`;
}

/** 손패 부채꼴: 장수가 많으면(2벌 28장) 카드를 줄이고 간격을 좁혀 화면 폭 안에 넣는다. */
function handLayout(n) {
  const R = 1300; // 부채 반지름(CSS transform-origin과 같다)
  const big = n <= 16;
  const cw = big ? 78 : 62;
  const span = big ? 800 : 740; // 가장 바깥 카드 중심 사이 폭
  const step = Math.min(big ? 56 : 40, n > 1 ? span / (n - 1) : 0);
  return { cw, ch: Math.round(cw * 1.436), deg: (step / R) * (180 / Math.PI) };
}

function handHtml(v) {
  let ids = v.hand;
  const exch = v.phase === 'exchange';
  if (exch) ids = ids.filter((id) => !S.picks.includes(id));
  const mid = (ids.length - 1) / 2;
  const lay = handLayout(ids.length);
  const received = new Set(v.phase === 'play' && !v.started ? v.received.map((r) => r.id) : []);
  const playable = assistPlayable(v);
  const cards = ids.map((id, i) => {
    const sel = S.sel.includes(id);
    const dim = playable && !playable.has(id);
    return cardHtml(id, { size: 'md', cls: `${sel ? 'sel' : ''} ${dim ? 'dim' : ''} ${received.has(id) ? 'recv' : ''}`, style: `--a:${((i - mid) * lay.deg).toFixed(2)}deg;z-index:${i}` });
  }).join('');
  const mine = v.legal?.kind === 'turn';
  return `<div class="hand fan${mine ? ' my-turn' : ''}" style="--hw:${lay.cw}px;--hh:${lay.ch}px">${cards}</div>`;
}

/** 도우미가 켜져 있고 내 차례면 낼 수 있는 조합에 들어가는 카드 id 집합(없으면 null). */
function assistPlayable(v) {
  if (!S.assist || v.legal?.kind !== 'turn') return null;
  const set = new Set();
  for (const c of availablePlays(v)) for (const id of c.ids) set.add(id);
  return set;
}

function availablePlays(v) {
  let plays = enumeratePlays(v.hand, v.trick.top);
  if (v.legal?.wish) plays = plays.filter((c) => c.ids.some((id) => !isPhx(id) && rankOf(id) === v.legal.wish));
  return plays;
}

function waitLeft(v) {
  if (v.legal?.kind !== 'turn' || !v.trick.top) return 0;
  return Math.max(0, v.openAt - nowMs());
}

function stripHtml(v) {
  const legal = v.legal;
  const parts = [];
  if (v.phase === 'grand' || v.phase === 'exchange') return '';
  if (v.phase === 'play') {
    const info = selInfo(v);
    const wait = waitLeft(v);
    if (!legal) parts.push(v.out.includes(S.seat) ? '<span class="ok">나갔어요! 나머지 경기를 지켜봐요</span>' : '<span class="lab">잠시만요…</span>');
    else if (info) parts.push(selText(v, info));
    else if (S.assist && legal.kind === 'turn') parts.push(chipsHtml(v));
    else if (legal.kind === 'turn') parts.push(legal.lead ? '<b>내가 선이에요</b> · 카드를 골라 내요' : `<b>내 차례예요</b> · ${esc(needText(v.trick.top))}를 내거나 패스해요`);
    else if (legal.kind === 'wait') parts.push(`<span class="lab">${esc(nameOf(v.pending?.seat ?? 0))}님 차례예요${legal.canBomb ? ' · <b>폭탄을 낼 수 있어요!</b>' : ''}</span>`);
    if (legal?.kind === 'turn' && legal.wish) parts.push(`<span class="warn">소원 <b>${rankLabel(legal.wish)}</b>을 낼 수 있으면 꼭 내야 해요</span>`);
    if (wait > 0) parts.push(`<span class="warn">폭탄 대기 <span data-wait>${(wait / 1000).toFixed(1)}</span>초</span>`);
    if (info && info.choices.length > 1) parts.push(`<span class="lab">봉황 =</span>${info.choices.map((c) => `<span class="chip${samePhx(info.combo?.phx ?? null, c) ? ' on' : ''}" data-phx='${phxJson(c)}'>${phxText(c)}</span>`).join('')}`);
  }
  return parts.length ? `<div class="strip">${parts.join('')}</div>` : '';
}

function selText(v, info) {
  const { combo, shape, mine } = info;
  const top = v.trick.top;
  const w = v.legal?.wish;
  if (combo) {
    if (!mine && !combo.bomb) return '<span class="warn">내 차례가 아니에요 (폭탄만 낼 수 있어요)</span>';
    if (w && !combo.ids.some((id) => !isPhx(id) && rankOf(id) === w)) return `<span class="warn">소원 ${rankLabel(w)}이 들어간 조합을 내야 해요</span>`;
    return `선택: <b>${esc(comboLabel(combo))}</b> <span class="ok">✓ ${top ? `${esc(nameOf(v.trick.topSeat))}의 ${esc(label(top))}보다 ${combo.bomb && !top.bomb ? '강한 폭탄이에요' : '높아요'}` : '선으로 낼 수 있어요'}</span>`;
  }
  if (shape) {
    if (!mine) return `선택: <b>${esc(label(shape))}</b> <span class="warn">· 폭탄이 아니면 내 차례에 내요</span>`;
    return `선택: <b>${esc(label(shape))}</b> <span class="warn">✗ ${top ? `지금은 ${esc(needText(top))}만 낼 수 있어요` : '낼 수 없는 조합이에요'}</span>`;
  }
  return `<span class="warn">✗ 이런 조합은 없어요 <span class="lab">(싱글·페어·트리플·풀하우스·스트레이트·연속 페어·폭탄)</span></span>`;
}

function chipsHtml(v) {
  const plays = availablePlays(v).filter((c) => c.type !== 'dog' || !v.legal.wish);
  if (!plays.length) return '<span class="warn">낼 수 있는 조합이 없어요. 패스해요</span>';
  const byLow = plays.slice().sort((a, b) => a.rank - b.rank || a.n - b.n);
  const shown = byLow.slice(0, 7);
  return `<span class="lab">낼 수 있는 조합</span>${shown.map((c) => `<span class="chip" data-chip="${c.ids.join(',')}" data-as='${c.phx && c.ids.length > 1 ? phxJson(c.phx) : ''}'>${esc(label(c))}${c.phx && c.ids.length > 1 ? ' <small>봉황</small>' : ''}</span>`).join('')}${byLow.length > shown.length ? `<span class="lab">외 ${byLow.length - shown.length}</span>` : ''}`;
}

function actionsHtml(v) {
  const legal = v.legal;
  if (!legal || v.phase === 'grand') return '';
  const btns = [];
  if ((legal.kind === 'turn' || legal.kind === 'wait' || legal.kind === 'exchange' || legal.kind === 'exchangeDone') && legal.canTichu) {
    btns.push(`<button class="b tichu" data-do="tichu">티추 부르기<small>성공 +${100 * v.settings.decks} · 실패 −${100 * v.settings.decks}</small></button>`);
  }
  if (legal.kind === 'exchange') {
    const ok = S.picks.every((x) => x != null);
    btns.push(`<button class="b go" data-do="exchange"${ok ? '' : ' disabled'}>교환 확정<small>${ok ? '이대로 보내요' : `${S.picks.filter((x) => x == null).length}장 더 골라요`}</small></button>`);
  } else if (legal.kind === 'turn') {
    const info = selInfo(v);
    const wait = waitLeft(v);
    const w = legal.wish;
    const okCombo = info?.combo && (!w || info.combo.ids.some((id) => !isPhx(id) && rankOf(id) === w));
    if (legal.canPass) btns.push(`<button class="b" data-do="pass"${wait > 0 ? ' disabled' : ''}>패스${wait > 0 ? `<small><span data-wait>${(wait / 1000).toFixed(1)}</span>초 뒤</small>` : ''}</button>`);
    const canPlay = okCombo && (wait <= 0 || info.combo.bomb);
    btns.push(`<button class="b go" data-do="play"${canPlay ? '' : ' disabled'}>${info?.combo?.bomb ? '폭탄!' : '내기'}<small>${info?.combo ? esc(comboLabel(info.combo)) : '카드를 골라요'}</small></button>`);
  } else if (legal.kind === 'wait' && legal.canBomb) {
    const info = selInfo(v);
    btns.push(`<button class="b go bombbtn" data-do="play"${info?.combo?.bomb ? '' : ' disabled'}>폭탄 내기!<small>${info?.combo?.bomb ? esc(comboLabel(info.combo)) : '폭탄 카드를 골라요'}</small></button>`);
  }
  return btns.length ? `<div class="acts">${btns.join('')}</div>` : '';
}

/** 교환 결과 확인 창: 상대별로 내가 준 카드와 받은 카드를 보여 준다. 전원이 확인하거나 시간이 지나면 시작한다. */
function reviewHtml(v) {
  const rows = [2, 1, 3].map((rel) => {
    const seat = (S.seat + rel) % 4;
    const gave = v.given.filter((g) => g.to === seat).map((g) => g.id);
    const got = v.received.filter((r) => r.from === seat).map((r) => r.id);
    const role = rel === 2 ? '파트너' : rel === 1 ? '왼쪽 상대' : '오른쪽 상대';
    return `<div class="xrow ${isUs(seat) ? 'us' : 'them'}"><b>${role}<small>${esc(nameOf(seat))}</small></b><div class="xc gave">${cardsHtml(gave, 'sm')}</div><i>⇄</i><div class="xc got">${cardsHtml(got, 'sm')}</div></div>`;
  }).join('');
  const mine = v.legal?.kind === 'review';
  const acks = v.ackDone ? v.ackDone.filter(Boolean).length : 0;
  const btn = mine
    ? '<button class="b go" data-do="review-ok">확인 · 시작<small>모두 누르면 바로 시작해요</small></button>'
    : `<button class="b" disabled>다른 사람을 기다려요 (${acks}/4)</button>`;
  const tichu = v.legal?.canTichu ? `<button class="b tichu" data-do="tichu">티추 부르기<small>성공 +${100 * v.settings.decks} · 실패 −${100 * v.settings.decks}</small></button>` : '';
  return `<div class="scrim"></div><div class="modal xchg"><h2>교환 결과 <em>— 받은 카드를 확인해요</em></h2>
    <div class="xhead"><span></span><span>내가 준 카드</span><span></span><span>내가 받은 카드</span></div>${rows}
    <p class="xfoot">받은 카드는 시작 후 손패에서 <b>'받음'</b> 표시가 붙어요 · <span data-rv></span></p>
    <div class="btns">${tichu}${btn}</div></div>`;
}

function modalHtml(v) {
  const legal = v.legal;
  if (v.pending?.type === 'review') return reviewHtml(v);
  if (v.phase === 'grand' && legal?.kind === 'grand') {
    const d = v.settings.decks;
    return `<div class="scrim upper"></div><div class="modal high"><h2>그랜드 티추를 <em>부를까요?</em></h2><p>지금 보이는 <b>처음 ${8 * d}장</b>만 보고, 내가 이번 라운드에 <b>1등으로 나간다</b>고 선언해요.<br>성공하면 <b>+${200 * d}점</b>, 실패하면 <b>−${200 * d}점</b>이에요.<br><small style="font-weight:600">패스해도 ${6 * d}장을 더 받은 뒤 일반 티추(±${100 * d}점)를 부를 수 있어요.</small></p><div class="btns"><button class="b" data-do="grand-no">패스하고 ${6 * d}장 받기</button><button class="b go" data-do="grand-yes">그랜드 티추!<small>±${200 * d}점</small></button></div></div>`;
  }
  if (S.wish) {
    const ranks = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    return `<div class="scrim"></div><div class="modal"><h2>참새를 냈어요 — <em>소원</em>을 빌어요</h2><p>소원으로 정한 숫자를 <b>낼 수 있는 다음 사람</b>은 반드시 그 숫자를 내야 해요. 소원이 이뤄지면 끝나요. 빌지 않아도 돼요.</p>
      <div class="wish">${ranks.map((r) => `<button data-wish="${r}">${rankLabel(r)}</button>`).join('')}<button class="none" data-wish="0">소원 없음</button></div>
      <div class="btns"><button class="b" data-do="wish-cancel">취소</button></div></div>`;
  }
  if (legal?.kind === 'gift') {
    const pile = v.trick.points;
    const opts = legal.options.map((seat) => `<button data-gift="${seat}"><span class="av">${esc(avatarChar(seatInfo(seat)))}</span><span><b>${esc(nameOf(seat))}</b><small>남은 카드 ${v.counts[seat]}장${v.counts[seat] <= 3 ? ' · 곧 나갈 수 있어요' : ''}</small></span></button>`).join('');
    return `<div class="scrim"></div><div class="modal"><h2><em>용</em>으로 트릭을 가져왔어요</h2><p>용으로 이긴 트릭은 <b>상대 팀 한 명에게 줘야</b> 해요. 점수 카드가 들어 있으니 신중하게 골라요.<br>이 트릭의 점수: <b style="color:var(--accent)">${pile}점</b></p><div class="gift">${opts}</div></div>`;
  }
  if (v.phase === 'roundEnd' && v.result) return resultHtml(v);
  if (v.phase === 'over' && v.final) return finalHtml(v);
  return '';
}

function resultHtml(v) {
  const r = v.result;
  const us = teamOf(S.seat);
  const them = 1 - us;
  const col = (t) => (t === us ? 0 : 1);
  const placeNames = ['1등', '2등', '3등', '4등'];
  const fin = r.order.map((seat, i) => `<div class="${isUs(seat) ? 'us' : 'them'}"><b>${placeNames[i]}</b>${esc(nameOf(seat))}</div>`).join('');
  const money = (n) => `<td class="${n > 0 ? 'pos' : n < 0 ? 'neg' : ''}">${n > 0 ? '+' : ''}${n}</td>`;
  const cardRow = r.oneTwo
    ? `<tr><td>원투 피니시 (카드 점수 대신)</td>${money(r.cardPts[us])}${money(r.cardPts[them])}</tr>`
    : `<tr><td>카드 점수</td>${money(r.cardPts[us])}${money(r.cardPts[them])}</tr>`;
  const tichuRows = r.tichu.map((t) => {
    const val = (t.call === 'grand' ? 200 : 100) * v.settings.decks * (t.ok ? 1 : -1);
    const mineSide = teamOf(t.seat) === us;
    return `<tr><td>${esc(nameOf(t.seat))} ${t.call === 'grand' ? '그랜드 티추' : '티추'} ${t.ok ? '성공' : '실패'}</td>${mineSide ? `${money(val)}<td></td>` : `<td></td>${money(val)}`}</tr>`;
  }).join('');
  const prev = [r.scores[0] - r.total[0], r.scores[1] - r.total[1]];
  const head = r.oneTwo ? `라운드 ${r.round} 결과 <em>— 원투 피니시!</em>` : `라운드 ${r.round} 결과 <em>— ${esc(nameOf(r.order[0]))} 1등</em>`;
  const foot = r.oneTwo
    ? `같은 팀이 1·2등으로 나가서 카드 점수 대신 <b style="color:var(--accent)">${200 * v.settings.decks}점</b>이에요.`
    : `꼴찌(${esc(nameOf(r.lastSeat))})가 딴 카드는 1등에게, 남은 손패(${r.lastHand.length}장)는 상대 팀에게 가요.`;
  const acks = v.ackDone ? v.ackDone.filter(Boolean).length : 0;
  const btn = v.legal?.kind === 'ack'
    ? `<button class="b go" data-do="next">${r.over ? '결과 보기' : '다음 라운드'}<small>모두 누르면 ${r.over ? '끝나요' : '시작해요'}</small></button>`
    : `<button class="b" disabled>다른 사람을 기다려요 (${acks}/4)</button>`;
  return `<div class="scrim"></div><div class="modal result"><h2>${head}</h2>
    <div class="fin">${fin}</div>
    <table><tr><th></th><th class="us">우리 팀</th><th class="them">상대 팀</th></tr>
      ${cardRow}${tichuRows}
      <tr class="tot"><td>이번 라운드</td>${money(r.total[us])}${money(r.total[them])}</tr>
      <tr><td>누적 점수</td><td>${prev[us]} → <b>${r.scores[us]}</b></td><td>${prev[them]} → <b>${r.scores[them]}</b></td></tr></table>
    <div class="foot">${foot}</div><div class="btns">${btn}</div></div>`;
}

function finalHtml(v) {
  const f = v.final;
  const us = teamOf(S.seat);
  const won = f.winner === us;
  const host = !!S.room?.isHost;
  const names = (t) => [0, 1, 2, 3].filter((s) => teamOf(s) === t).map(nameOf).join(' · ');
  const buttons = host
    ? '<button class="b go" data-do="rematch">다시 하기<small>방 설정으로 돌아가요</small></button><button class="b" data-do="leave">홈으로 나가기</button>'
    : (S.leaveAsk
      ? '<button class="b go" data-do="stay">계속 기다리기<small>방장이 다시 하기를 누를 수 있어요</small></button><button class="b" data-do="leave">그래도 나가기</button>'
      : '<button class="b" disabled>방장 대기 중…</button><button class="b" data-do="leave-ask">홈으로 나가기</button>');
  return `<div class="scrim"></div><div class="modal result final"><h2>${won ? '🎉 우리 팀 승리!' : '아쉽게 졌어요'} <em>— ${f.rounds}라운드</em></h2>
    <div class="fin"><div class="us"><b>우리 팀 ${f.scores[us]}점${won ? ' · 승' : ''}</b>${esc(names(us))}</div><div class="them"><b>상대 팀 ${f.scores[1 - us]}점${won ? '' : ' · 승'}</b>${esc(names(1 - us))}</div></div>
    <div class="btns">${buttons}</div></div>`;
}

function pauseHtml(p) {
  const sec = Math.floor((nowMs() - p.at) / 1000);
  return `<div class="pause"><div class="pbox"><h2>⏸ 일시정지</h2><p><b>${esc(p.name)}</b>님이 멈췄어요 (<span id="pause-clock">${fmtClock(sec * 1000)}</span>)<br>누구든 다시 시작할 수 있어요</p><button class="b go" data-do="resume">▶ 다시 시작</button></div></div>`;
}
const fmtClock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

function renderGame() {
  const v = S.st.view;
  const order = [2, 1, 3, 0];
  stage.innerHTML = `<div id="content">${scoreHtml(v)}${rinfoHtml(v)}${order.map((rel) => plateHtml(rel, v)).join('')}${backsHtml(v)}${zoneHtml(v)}${handHtml(v)}${countHtml(v)}${stripHtml(v)}${actionsHtml(v)}${modalHtml(v)}${S.st.pause ? pauseHtml(S.st.pause) : ''}</div>`;
  updateTimers();
}

let waitTimer = null;
function render() {
  if (S.st && S.room && S.room.phase !== 'lobby') renderGame();
  else renderLobby();
  fx.attach();
  guide.attach();
  $('btn-assist').classList.toggle('on', S.assist);
  paintCount();
  paintPause();
  clearTimeout(waitTimer);
  const v = S.st?.view;
  const wait = v ? waitLeft(v) : 0;
  if (wait > 0) waitTimer = setTimeout(render, wait + 30); // 폭탄 대기가 끝나면 버튼을 다시 켠다
}

/** 헤더 카운팅 버튼: 대국 중에만 보인다. */
function paintCount() {
  const btn = $('btn-count');
  const playing = !!S.st && !!S.room && S.room.phase !== 'lobby' && S.st.view.phase === 'play';
  btn.classList.toggle('hidden', !playing);
  btn.classList.toggle('on', S.count);
}

/** 헤더 일시정지 버튼: 대국 중에만 보이고, 멈춘 동안은 '재개'로 바뀐다. */
function paintPause() {
  const btn = $('btn-pause');
  const st = S.st;
  const visible = !!st && !!S.room && S.room.phase !== 'lobby' && st.view.phase !== 'over';
  btn.classList.toggle('hidden', !visible);
  if (!visible) return;
  const paused = !!st.pause;
  btn.classList.toggle('on', paused);
  btn.textContent = paused ? '▶ 재개' : '⏸ 일시정지';
}

// ── 타이머 ──────────────────────────────────────────────────
function updateTimers() {
  const st = S.st;
  if (!st) return;
  const now = st.pause ? st.pause.at + S.offset : nowMs();
  for (const t of st.timers || []) {
    const el = stage.querySelector(`.plate[data-seat="${t.seat}"] .tm i`);
    const left = Math.max(0, t.deadline - now);
    if (el) el.style.width = `${Math.min(100, (left / t.total) * 100)}%`;
    if (t.seat === S.seat && !st.pause) {
      const sec = Math.ceil(left / 1000);
      const plate = stage.querySelector(`.plate[data-seat="${t.seat}"] .sub`);
      if (plate && st.view.pending?.type === 'turn') plate.innerHTML = `<b>내 차례</b> · ${sec}초`;
      if (st.view.pending?.type === 'review') {
        for (const el of stage.querySelectorAll('[data-rv]')) el.textContent = `${sec}초 뒤 자동으로 시작해요`;
      } else if (sec <= 5 && sec > 0 && sec !== S.tickSec) { S.tickSec = sec; sounds.play('tick'); }
    }
  }
  if (st.view && !st.pause) {
    const left = waitLeft(st.view);
    for (const el of stage.querySelectorAll('[data-wait]')) el.textContent = (left / 1000).toFixed(1);
  }
  const clock = stage.querySelector('#pause-clock');
  if (clock && st.pause) clock.textContent = fmtClock(nowMs() - st.pause.at);
}
setInterval(updateTimers, 100);

// ── 연출·효과음 ──────────────────────────────────────────────
function trackMyTurn(prev, v) {
  const key = v.legal?.kind === 'turn' ? `${v.round}|${v.trick.plays.length}|${v.trick.passed.length}` : '';
  if (key && key !== S.lastTurnKey && v.phase === 'play') {
    sounds.play('turn');
    fx.banner('내 차례', { cls: 'info', ms: 650 });
  }
  S.lastTurnKey = key;
}

/** 좌석이 앉은 방향의 화면 오프셋(px). 특수 카드 연출이 낸 사람 쪽에서 날아오고 개는 받는 사람 쪽으로 빠지게 한다. */
function fromVec(seat) {
  const rel = ((seat ?? S.seat) - S.seat + 4) % 4;
  return [[0, 300], [-380, 0], [0, -240], [380, 0]][rel];
}

function playEvents(events, v) {
  let sparrowShown = false; // 참새 연출이 소원 문구를 같이 보여 주면 소원 배너는 생략한다
  for (const e of events) {
    const who = e.seat !== undefined ? nameOf(e.seat) : '';
    switch (e.t) {
      case 'deal': sounds.play('deal'); break;
      case 'dealrest': sounds.play('deal'); fx.banner(`${6 * v.settings.decks}장을 더 받았어요`, { cls: 'info', ms: 1100 }); break;
      case 'exchanged': sounds.play('deal'); fx.banner('카드 교환 완료', { cls: 'info', ms: 1000 }); break;
      case 'start': fx.banner(e.seat === S.seat ? '내가 참새를 가졌어요 — 선!' : `${who}님이 참새를 가졌어요`, { cls: 'info', ms: 1300 }); break;
      case 'play': {
        S.freshSeat = e.seat;
        const c = e.combo;
        const from = fromVec(e.seat);
        if (c.bomb) { sounds.play('bomb'); fx.flash('#ff7a50'); fx.shake(12); fx.banner('폭탄!', { cls: 'bomb', sub: `${who} · ${label(c)}`, ms: 1500 }); }
        else if (c.type === 'single' && c.rank === 15) {
          sounds.play('dragon'); fx.flash('#ffcf4a'); fx.shake(7);
          fx.special('drg', { card: cardHtml(c.ids[0], { size: 'xl', data: false }), name: '용!', sub: who, from, ms: 1600 });
        } else if (c.type === 'single' && isPhx(c.ids[0])) {
          sounds.play('phoenix'); fx.flash('#ff8a5a');
          fx.special('phx', { card: cardHtml(c.ids[0], { size: 'xl', data: false }), name: '봉황', sub: who, from, ms: 1500 });
        } else if (c.type === 'single' && isMJ(c.ids[0])) {
          sounds.play('sparrow');
          const w = events.find((x) => x.t === 'wish');
          sparrowShown = true;
          fx.special('spr', { card: cardHtml(c.ids[0], { size: 'xl', data: false }), name: '참새', sub: `${who}${w ? ` · 소원: ${rankLabel(w.rank)}` : ''}`, from, ms: 1200 });
        } else if (c.type === 'dog') { sounds.play('dog'); }
        else sounds.play('play', c.n);
        break;
      }
      case 'pass': sounds.play('pass'); break;
      case 'dog': {
        fx.special('dog', { card: cardHtml(52, { size: 'xl', data: false }), name: '개', sub: `${who} → ${nameOf(e.to)}님에게 선을 넘겨요`, from: fromVec(e.seat), to: fromVec(e.to), ms: 1700 });
        break;
      }
      case 'call':
        sounds.play(e.call === 'grand' ? 'grand' : 'call');
        fx.flash(e.call === 'grand' ? '#ffcf4a' : '#ff7a68');
        fx.banner(e.call === 'grand' ? '그랜드 티추!' : '티추!', { cls: e.call === 'grand' ? 'grand' : 'call', sub: who, ms: 1500 });
        break;
      case 'wish': if (!sparrowShown) fx.banner(`소원: ${rankLabel(e.rank)}`, { cls: 'info', sub: who, ms: 1500 }); break;
      case 'wishdone': fx.banner('소원이 이뤄졌어요', { cls: 'info', ms: 900 }); break;
      case 'trickwin':
        sounds.play('trick');
        if (e.points >= 20 || e.points <= -20) fx.banner(`${who}님이 ${e.points}점 트릭을 가져갔어요`, { cls: 'info', ms: 1300 });
        break;
      case 'dragon': fx.banner('용이 이겼어요', { cls: 'dragon', sub: '상대 팀에게 트릭을 줘야 해요', ms: 1400 }); break;
      case 'gift': showToast(`${who}님이 ${nameOf(e.to)}님에게 용 트릭(${e.points}점)을 줬어요`); break;
      case 'out':
        sounds.play('out');
        fx.banner(`${who} ${e.place}등!`, { cls: 'info', sub: e.place === 1 ? '가장 먼저 나갔어요' : '', ms: 1300 });
        break;
      case 'round': sounds.play(isUs(S.st.view.result?.order?.[0] ?? 0) ? 'win' : 'lose'); break;
      case 'over': sounds.play(e.winner === teamOf(S.seat) ? 'win' : 'lose'); fx.flash('#ffe27a'); break;
      case 'pause': case 'resume': break;
      default: break;
    }
  }
  if (events.some((e) => e.t === 'play')) setTimeout(() => { S.freshSeat = null; }, 600);
}

// ── 입력 ────────────────────────────────────────────────────
function onCard(id) {
  const v = S.st?.view;
  if (!v) return;
  sounds.unlock();
  if (v.phase === 'exchange') {
    if (v.legal?.kind !== 'exchange') return;
    const at = S.picks.indexOf(id);
    if (at >= 0) S.picks[at] = null;
    else {
      const free = S.picks.indexOf(null);
      if (free < 0) return;
      S.picks[free] = id;
    }
    sounds.play('select');
    render();
    return;
  }
  if (v.phase !== 'play' || !v.legal) return;
  S.sel = S.sel.includes(id) ? S.sel.filter((x) => x !== id) : [...S.sel, id];
  S.phxAs = null;
  sounds.play('select');
  render();
}

function doPlay(v) {
  const info = selInfo(v);
  if (!info?.combo) return;
  const a = { type: 'play', ids: info.combo.ids };
  if (info.as !== undefined) a.as = info.as;
  if (!v.wishUsed && info.combo.ids.some(isMJ)) { // 소원은 처음 낸 참새로만 빌 수 있다
    S.wish = { a };
    render();
    return;
  }
  act(a);
}

function onAction(btn) {
  const v = S.st?.view;
  sounds.unlock();
  switch (btn.dataset.do) {
    case 'start': send({ type: 'START' }); break;
    case 'grand-yes': act({ type: 'grand', on: true }); break;
    case 'grand-no': act({ type: 'grand', on: false }); break;
    case 'tichu': act({ type: 'tichu' }); break;
    case 'exchange': if (S.picks.every((x) => x != null)) act({ type: 'exchange', give: S.picks.slice() }); break;
    case 'play': if (v) doPlay(v); break;
    case 'pass': act({ type: 'pass' }); break;
    case 'wish-cancel': S.wish = null; render(); break;
    case 'next': case 'review-ok': act({ type: 'next' }); break;
    case 'count': toggleCount(); break;
    case 'resume': send({ type: 'RESUME' }); break;
    case 'rematch': send({ type: 'REMATCH' }); break;
    case 'leave': leave(); break;
    case 'leave-ask': S.leaveAsk = true; render(); break;
    case 'stay': S.leaveAsk = false; render(); break;
    default: break;
  }
}

stage.addEventListener('click', (e) => {
  const t = e.target;
  const btn = t.closest('[data-do]');
  if (btn && !btn.disabled) { onAction(btn); return; }
  const cfg = t.closest('[data-cfg]');
  if (cfg && S.room?.isHost) {
    const key = cfg.dataset.cfg;
    let val = cfg.dataset.val;
    if (cfg.dataset.bool) val = val === 'on';
    else if (/^\d+$/.test(val)) val = Number(val);
    send({ type: 'CONFIG', settings: { [key]: val } });
    return;
  }
  const local = t.closest('[data-local]');
  if (local) { toggleAssist(); return; }
  const wishBtn = t.closest('[data-wish]');
  if (wishBtn && S.wish) {
    const a = { ...S.wish.a };
    const w = Number(wishBtn.dataset.wish);
    if (w >= 2) a.wish = w;
    act(a);
    return;
  }
  const gift = t.closest('[data-gift]');
  if (gift) { act({ type: 'gift', to: Number(gift.dataset.gift) }); return; }
  const slot = t.closest('[data-slot]');
  if (slot) { S.picks[Number(slot.dataset.slot)] = null; sounds.play('select'); render(); return; }
  const phx = t.closest('[data-phx]');
  if (phx) { S.phxAs = JSON.parse(phx.dataset.phx); render(); return; }
  const chip = t.closest('[data-chip]');
  if (chip) {
    S.sel = chip.dataset.chip.split(',').map(Number);
    S.phxAs = chip.dataset.as ? JSON.parse(chip.dataset.as) : null;
    sounds.play('select');
    render();
    return;
  }
  const card = t.closest('.hand .card[data-id]');
  if (card) onCard(Number(card.dataset.id));
});

function toggleCount() {
  S.count = !S.count;
  store.set('tichu:count', S.count ? '1' : '0');
  render();
}

function toggleAssist() {
  S.assist = !S.assist;
  store.set('tichu:assist', S.assist ? '1' : '0');
  render();
}

function leave() {
  send({ type: 'LEAVE' });
  location.href = '/';
}

// 종료 화면에서 게스트가 헤더의 나가기를 눌러도 같은 확인을 거친다(방장의 다시 하기를 놓치지 않게).
$('btn-back').addEventListener('click', () => {
  const v = S.st?.view;
  if (v?.phase === 'over' && v.final && !S.room?.isHost && !S.leaveAsk) { S.leaveAsk = true; render(); return; }
  leave();
});
$('btn-guide').addEventListener('click', () => guide.toggle());
$('btn-pause').addEventListener('click', () => send({ type: S.st?.pause ? 'RESUME' : 'PAUSE' }));
$('btn-assist').addEventListener('click', toggleAssist);
$('btn-count').addEventListener('click', toggleCount);
// P 키로 일시정지/재개(입력창에 글자를 치는 중이면 무시)
document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() !== 'p' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '') || e.target?.isContentEditable) return;
  const btn = $('btn-pause');
  if (!btn.classList.contains('hidden')) btn.click();
});
// C 키로 카드 카운팅 패널 열기/닫기
document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() !== 'c' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '') || e.target?.isContentEditable) return;
  const btn = $('btn-count');
  if (!btn.classList.contains('hidden')) btn.click();
});
const soundBtn = $('btn-sound');
const paintSound = () => { soundBtn.classList.toggle('on', !sounds.isMuted()); soundBtn.textContent = sounds.isMuted() ? '🔇 효과음 꺼짐' : '🔊 효과음'; };
paintSound();
soundBtn.addEventListener('click', () => { sounds.setMuted(!sounds.isMuted()); paintSound(); sounds.unlock(); });

// ── 화면 비율 맞춤 ────────────────────────────────────────
function fit() {
  const outer = $('fit');
  const inner = $('fit-inner');
  const availW = Math.max(200, outer.clientWidth - 48);
  const header = document.querySelector('.game-header').offsetHeight + 40;
  const availH = Math.max(150, window.innerHeight - header);
  const scale = Math.max(0.2, Math.min(availW / STAGE_W, availH / STAGE_H, 3));
  stage.style.transform = `scale(${scale})`;
  inner.style.width = `${STAGE_W * scale}px`;
  inner.style.height = `${STAGE_H * scale}px`;
  inner.style.margin = '0 auto';
}
window.addEventListener('resize', fit);
fit();

connect();
