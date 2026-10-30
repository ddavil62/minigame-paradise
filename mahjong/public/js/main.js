/**
 * @fileoverview 마작 클라이언트: 접속, 방 설정, 대국 화면, 결과 화면.
 *
 * 서버 권위 모델이라 이 파일은 상태를 그리고 행동 의도(ACT)만 보낸다.
 * 프로토콜: C→S JOIN은 쿼리(key,name)로 대체, CONFIG/START/ACT/ASSIST/REMATCH/LEAVE.
 *           S→C JOINED/ROOM/STATE/ERROR. 자세한 계약은 mahjong/CLAUDE.md 참고.
 */
import { tileHtml, backHtml, sideHtml, codeOf, codeOfKind, kindName, esc } from './tiles.js';
import { createSounds } from './sounds.js';
import { createFx } from './fx.js';
import { createGuide } from './guide.js';
import { YAKU_INFO, TERM_INFO, limitInfo } from './yaku-info.js';

const WIND_KANJI = ['東', '南', '西', '北'];
const WIND_KO = ['동', '남', '서', '북'];
const AI_CHAR = { 주작: '雀', 백호: '虎', 현무: '武', 청룡: '龍' };
const LEVEL_KO = { easy: '쉬움', normal: '보통', hard: '어려움' };
const DRAW_REASON = {
  exhaustive: '유국', kyuushu: '구종구패', suufon: '사풍연타', suucha: '사가립직', suukan: '사깡산료', sanchahou: '삼가화',
};
const OVER_REASON = { tobi: '누군가 0점 미만이 되어 대국이 끝났어요.', all_last: '마지막 국에서 친이 1위로 마쳤어요.', end: '정해진 국을 모두 마쳤어요.' };

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const sounds = createSounds();
const fx = createFx(stage);
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
  recvAt: 0,
  offset: 0,
  selected: null,
  riichiMode: false,
  showNames: store.get('mahjong:names') === '1',
  assist: store.get('mahjong:assist') === '1',
  connected: false,
  toast: '',
  busy: false,
  kanPick: false,
  stageW: 1200, // 무대 폭(fit()이 창 비율에 맞춰 갱신)
  anims: [], // 재렌더로 끊기지 않게 이어서 재생하는 짧은 연출 {at, ttl, run(elapsed)}
  shown: null, // 결과/종료 화면 연출을 이미 시작한 키
  resFocus: null, // 결과 화면에서 강조 중인 역 '화료자:역' (재렌더에도 유지)
  resTip: null, // 결과 화면에서 펼친 ⓘ 설명 키
};

// ── 접속 ────────────────────────────────────────────────────
function playerKey() {
  let k = session.get('mahjong:key');
  if (!k) { k = `k${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`; session.set('mahjong:key', k); }
  return k;
}
function playerName() {
  return params.get('name') || store.get('minigames:nickname') || '플레이어';
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const seg = location.pathname.split('/').filter(Boolean)[0] || 'mahjong';
  const url = `${proto}://${location.host}/${seg}/ws?key=${encodeURIComponent(playerKey())}&name=${encodeURIComponent(playerName())}${params.get('role') ? `&role=${encodeURIComponent(params.get('role'))}` : ''}`;
  const ws = new WebSocket(url);
  S.ws = ws;
  ws.addEventListener('open', () => {
    S.connected = true;
    $('conn').classList.add('hidden');
    if (S.assist) send({ type: 'ASSIST', on: true });
  });
  ws.addEventListener('message', (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    onMessage(m);
  });
  ws.addEventListener('close', (e) => {
    S.connected = false;
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
  S.busy = true;
  S.selected = null;
  S.riichiMode = false;
  S.kanPick = false;
  send({ type: 'ACT', action });
  setTimeout(() => { S.busy = false; }, 500);
}

function onMessage(m) {
  switch (m.type) {
    case 'JOINED':
      S.seat = m.seat;
      break;
    case 'ROOM':
      S.room = m;
      if (m.phase === 'lobby') { S.st = null; S.selected = null; S.riichiMode = false; }
      render();
      break;
    case 'STATE': {
      const prev = captureRects();
      S.st = m;
      S.recvAt = Date.now();
      S.offset = m.serverNow - Date.now();
      S.busy = false;
      if (!m.view.legal || m.view.legal.kind !== 'turn') { S.riichiMode = false; S.kanPick = false; }
      if (S.selected != null && !(m.view.myHand.includes(S.selected) || m.view.myDrawn === S.selected)) S.selected = null;
      render();
      playEvents(m.events || [], m.view, prev);
      if (params.get('auto')) autoPlay(m.view);
      break;
    }
    case 'ERROR':
      if (m.code === 'room_full' || m.code === 'in_progress') {
        stage.innerHTML = `<div class="connecting">${esc(m.message || '입장할 수 없어요.')}</div>`;
      } else {
        showToast(m.message || '할 수 없는 행동이에요.');
        sounds.play('error');
      }
      break;
    default:
      break;
  }
}

function showToast(text) {
  S.toast = text;
  const old = document.querySelector('.err-toast');
  if (old) old.remove();
  const el = document.createElement('div');
  el.className = 'err-toast';
  el.textContent = text;
  stage.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

/** 테스트 전용(`?auto=1`): 단순 전략으로 자동 진행해 결과·종료 화면과 울기 렌더링을 빠르게 확인한다. */
function autoPlay(v) {
  const l = v.legal;
  if (!l) return;
  const pick = () => {
    if (l.kind === 'ack') return { type: 'next' };
    if (l.kind === 'reaction') {
      if (l.ron) return { type: 'ron' };
      if (l.daiminkan) return { type: 'daiminkan' };
      if (l.pon) return { type: 'pon' };
      if (l.chi?.length) return { type: 'chi', ids: l.chi[0].ids };
      return { type: 'pass' };
    }
    if (l.tsumo) return { type: 'tsumo' };
    if (l.ankan.length) return { type: 'ankan', kind: l.ankan[0] };
    if (l.riichi.length && v.players[v.me].riichi === false) return { type: 'discard', id: l.riichi[l.riichi.length - 1], riichi: true };
    return { type: 'discard', id: v.myDrawn != null && l.discard.includes(v.myDrawn) ? v.myDrawn : l.discard[0] };
  };
  const base = Number(params.get('auto')) > 1 ? Number(params.get('auto')) : 40;
  setTimeout(() => { if (S.st?.view === v) act(pick()); }, l.kind === 'ack' ? Math.max(2200, base * 5) : base);
}

// ── 이벤트(효과음·콜아웃) ──────────────────────────────────
function relOf(seat, me = S.seat) { return (seat - me + 4) % 4; }

/** 재렌더 직전의 손패·상대 패 더미 위치(버린 패가 날아오는 출발점) */
function captureRects() {
  const hand = new Map();
  stage.querySelectorAll('.my-hand .tile[data-id]').forEach((t) => hand.set(+t.dataset.id, t.getBoundingClientRect()));
  const opp = {};
  [['.side-hand.right', 1], ['.top-hand', 2], ['.side-hand.left', 3]].forEach(([sel, rel]) => {
    const last = [...stage.querySelectorAll(`${sel} > .tile.back`)].pop();
    if (last) opp[rel] = last.getBoundingClientRect();
  });
  return { hand, opp };
}

const STAGE_H = 760;
const STAGE_MIN_W = 1200;
const STAGE_MAX_W = 1600;
const ACTION_SCALE = 1.25; // 퐁·치·깡·론 선택 버튼(.actions) 확대 배율. 5개가 한 줄로 내 연못과 안 겹치는 한계 근처
const BOARD_SCALE = 1.3; // 중앙 영역(.board) 확대 배율. 연못 3줄까지 겹치지 않는 한계 — 올리기 전에 연못 3줄 상태로 확인한다
/** 내 기준 상대 좌석(0=나,1=오른쪽,2=맞은편,3=왼쪽) 연출 중심. 무대 폭이 가변이고 판 중심(y=338)을 기준으로 확대되므로 매번 계산한다. */
function seatAnchor(rel) {
  const cx = S.stageW / 2;
  const cy = 338;
  const [ox, oy] = [[0, 210], [200, -8], [0, -142], [-200, -8]][rel];
  return [cx + ox * BOARD_SCALE, cy + oy * BOARD_SCALE];
}
const POND_ANGLE = [0, -90, 180, 90]; // 좌석별 연못 회전각
const CALL_STYLE = {
  pon: { text: '퐁!', color: '#ff9f43' }, chi: { text: '치!', color: '#4dabf7' },
  minkan: { text: '깡!', color: '#c77dff' }, ankan: { text: '깡!', color: '#c77dff' }, kakan: { text: '깡!', color: '#c77dff' },
};

/** 짧은 연출을 등록하고 즉시 시작한다. 재렌더 때는 resumeAnims가 이어서 재생한다. */
function addAnim(ttl, run) {
  S.anims.push({ at: performance.now(), ttl, run });
  run(0);
}

function resumeAnims() {
  const now = performance.now();
  S.anims = S.anims.filter((a) => now - a.at < a.ttl);
  for (const a of S.anims) a.run(now - a.at);
}

/** 좌석 → 연출 위치(내 시점 기준) */
function anchorOf(seat) { return seatAnchor(relOf(seat)); }

function dealIn(elapsed) {
  const from = [{ transform: 'translateY(-200px) rotate(-14deg) scale(.5)', opacity: 0 }, { transform: 'none', opacity: 1 }];
  fx.stagger([...stage.querySelectorAll('.my-hand > .tile')], from, { step: 45, dur: 420, elapsed });
  const back = [{ transform: 'scale(.2) translateY(30px)', opacity: 0 }, { transform: 'none', opacity: 1 }];
  fx.stagger([...stage.querySelectorAll('.top-hand > .tile, .side-hand > .tile')], back, { step: 25, dur: 320, delay: 250, elapsed });
}

function drawIn(elapsed) {
  const t = stage.querySelector('.my-hand > .tile.drawn');
  if (t) fx.stagger([t], [{ transform: 'translate(70px,-90px) scale(1.35) rotate(8deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { dur: 280, elapsed });
}

function doraPop(index, elapsed) {
  const t = stage.querySelectorAll('.dora-row > .tile')[index];
  if (!t) return;
  fx.stagger([t], [
    { transform: 'scale(0) rotate(-200deg)', filter: 'brightness(3)', opacity: 0 },
    { transform: 'scale(2.2) rotate(10deg)', filter: 'brightness(2)', opacity: 1, offset: 0.55 },
    { transform: 'scale(1)', filter: 'brightness(1)', opacity: 1 },
  ], { dur: 650, elapsed });
}

function riichiStick(rel, elapsed) {
  const t = stage.querySelector(`.layer.s${rel} .stick`);
  if (t) fx.stagger([t], [{ transform: 'translateY(-70px) scaleX(.2)', opacity: 0 }, { transform: 'none', opacity: 1 }], { dur: 380, elapsed });
}

/** 결과/종료 화면 등장: 화료 연출 뒤에 팝업이 뜨고 역·점수가 차례로 나온다 */
function overlayIn(elapsed, { late = 0, final = false } = {}) {
  const ov = stage.querySelector('.overlay');
  if (!ov) return;
  const base = late;
  fx.stagger([ov], [{ opacity: 0 }, { opacity: 1 }], { dur: 300, delay: base, easing: 'ease-out', elapsed });
  const box = ov.querySelector('.result');
  if (box) fx.stagger([box], [{ transform: 'scale(.6) translateY(60px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { dur: 520, delay: base, easing: 'cubic-bezier(.2,1.35,.4,1)', elapsed });
  const heads = ov.querySelectorAll('.res-head .limit, .res-head h2');
  fx.stagger([...heads], [{ transform: 'scale(3.2) rotate(-14deg)', opacity: 0 }, { transform: 'scale(1) rotate(0)', opacity: 1 }], { dur: 420, delay: base + 250, step: 220, easing: 'cubic-bezier(.2,1.6,.4,1)', elapsed });
  fx.stagger([...ov.querySelectorAll('.yaku > .yrow, .yaku > .yaku-title')], [{ transform: 'translateX(-40px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { dur: 320, delay: base + 600, step: 90, easing: 'ease-out', elapsed });
  fx.stagger([...ov.querySelectorAll('.total, .tenpai-row')], [{ transform: 'scale(.6)', opacity: 0 }, { transform: 'none', opacity: 1 }], { dur: 380, delay: base + 900, step: 120, elapsed });
  fx.stagger([...ov.querySelectorAll('.delta, .rank-row')], [{ transform: 'translateX(60px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { dur: 380, delay: base + (final ? 350 : 1000), step: final ? 260 : 140, easing: 'cubic-bezier(.2,1.2,.4,1)', elapsed });
  ov.querySelectorAll('.delta .plus, .delta .minus').forEach((e, i) => {
    const sign = e.classList.contains('minus') ? '-' : '+';
    const abs = Math.abs(parseInt(e.textContent.replace(/[^\d-]/g, '') || '0', 10));
    fx.countUp(e, abs, (n) => `(${sign}${n.toLocaleString()})`, { delay: base + 1000 + i * 140, dur: 900, elapsed });
  });
}

/** 이벤트별 소리·비행·이펙트. 렌더가 끝난 뒤(새 DOM 기준)에 호출한다. */
function playEvents(events, view, prev) {
  for (const ev of events) {
    switch (ev.t) {
      case 'hand_start':
        sounds.play('deal');
        fx.banner(ev.label, { color: '#ffe27a', sub: ev.honba ? `${ev.honba}본장` : '', y: 330, dur: 1300 });
        addAnim(1500, dealIn);
        break;
      case 'discard': {
        const rel = relOf(ev.seat);
        const src = rel === 0 ? prev.hand.get(ev.id) : prev.opp[rel];
        const flying = fx.flyDiscard(ev.id, src, POND_ANGLE[rel], { riichi: ev.riichi, onLand: () => sounds.play('land') });
        if (!flying) sounds.play('discard');
        break;
      }
      case 'draw':
        if (ev.seat === S.seat) { sounds.play('draw'); addAnim(320, drawIn); }
        break;
      case 'dora': {
        sounds.play('dora');
        const idx = (ev.count || view.dora.length) - 1;
        addAnim(700, (el) => doraPop(idx, el));
        const t = stage.querySelectorAll('.dora-row > .tile')[idx];
        if (t) {
          const p = fx.toStage(t.getBoundingClientRect());
          fx.ring(p.x, p.y, { r: 50, color: '#ffe27a' });
          fx.sparks(p.x, p.y, { n: 12, dist: 60, size: 5 });
        }
        break;
      }
      case 'call': {
        const st = CALL_STYLE[ev.type];
        if (!st) break;
        const [x, y] = anchorOf(ev.seat);
        sounds.play('call');
        fx.flash(st.color, 0.22, 360);
        fx.pop(st.text, x, y, { color: st.color, size: 72 });
        fx.ring(x, y, { r: 120, color: st.color, width: 6 });
        fx.ring(x, y, { r: 80, color: '#fff', width: 3, delay: 90 });
        fx.sparks(x, y, { n: 16, dist: 120, size: 7, colors: [st.color, '#fff'] });
        fx.shake(4, 220);
        break;
      }
      case 'riichi': {
        const rel = relOf(ev.seat);
        const [x, y] = seatAnchor(rel);
        sounds.play('riichi');
        fx.flash('#ff3b2f', 0.3, 520);
        fx.banner(ev.double ? '더블 리치!' : '리치!', { color: '#ff6a5a', sub: seatInfo(ev.seat).name, y: 330, dur: 1200 });
        fx.ring(x, y, { r: 150, color: '#ff6a5a', width: 7 });
        fx.ring(x, y, { r: 100, color: '#ffe27a', width: 4, delay: 120 });
        fx.sparks(x, y, { n: 22, dist: 150, size: 7, colors: ['#ff6a5a', '#ffe27a', '#fff'] });
        fx.shake(7, 380);
        addAnim(450, (el) => riichiStick(rel, el));
        break;
      }
      case 'agari': {
        sounds.play('win');
        const n = ev.winners.length;
        const label = n > 1 ? `${n === 2 ? '더블' : '트리플'} 론!` : (ev.tsumo ? '쯔모!' : '론!');
        fx.flash('#fff', 0.7, 700);
        fx.banner(label, { color: '#ffd23f', sub: ev.winners.map((w) => seatInfo(w).name).join(' · '), y: 330, dur: 1500 });
        fx.shake(11, 520);
        ev.winners.forEach((w) => {
          const [x, y] = anchorOf(w);
          fx.ring(x, y, { r: 190, color: '#ffd23f', width: 8 });
          fx.ring(x, y, { r: 130, color: '#ff6a3d', width: 5, delay: 140 });
          fx.ring(x, y, { r: 80, color: '#fff', width: 3, delay: 260 });
          fx.confetti(x, y, { n: 46, up: 260, fall: 360 });
        });
        fx.confettiRain(36);
        break;
      }
      case 'ryuukyoku':
        sounds.play('over');
        fx.banner('유국', { color: '#9fb4ff', sub: DRAW_REASON[ev.reason] || '', y: 330, dur: 1400 });
        break;
      case 'game_over':
        sounds.play('over');
        fx.confettiRain(80);
        break;
      default: break;
    }
  }
}

// ── 공통 렌더 헬퍼 ─────────────────────────────────────────
const aka = () => !!S.st?.view?.settings?.aka;
const code = (id) => codeOf(id, aka());

function seatInfo(seat) { return S.st?.seats?.[seat] || S.room?.seats?.[seat] || { name: '', type: 'empty' }; }
function avatarChar(info) { return AI_CHAR[info.name] || (info.name || '?').slice(0, 1); }
function avatarClass(info, seat) { return info.type === 'ai' ? 'av-ai' : `av-${seat}`; }

function meldHtml(m, owner, size, withIds = false) {
  const rotCls = size === 't-meld' ? 'meld' : 'meldo';
  const attrs = (id) => (withIds ? { id } : {});
  const rot = (id, extra = '') => sideHtml(code(id), size, rotCls, extra, attrs(id));
  const up = (id) => tileHtml(code(id), size, '', '', attrs(id));
  if (m.type === 'ankan') {
    const [, b, c] = m.tiles;
    return `<div class="meld-g">${backHtml(size)}${up(b)}${up(c)}${backHtml(size)}</div>`;
  }
  const called = m.called;
  const rest = m.tiles.filter((id) => id !== called && !(m.type === 'kakan' && id === m.tiles[3]));
  const added = m.type === 'kakan' ? m.tiles[3] : null;
  const dir = (m.from - owner + 4) % 4; // 3 왼쪽, 2 맞은편, 1 오른쪽
  const parts = rest.map((id) => up(id));
  const calledHtml = added != null ? rot(called) + rot(added) : rot(called);
  let idx;
  if (m.type === 'chi' || dir === 3) idx = 0;
  else if (dir === 2) idx = 1;
  else idx = parts.length;
  parts.splice(idx, 0, calledHtml);
  return `<div class="meld-g">${parts.join('')}</div>`;
}

function visibleCounts(view) {
  const vis = new Array(34).fill(0);
  const add = (id) => { vis[id >> 2] += 1; };
  view.myHand.forEach(add);
  if (view.myDrawn != null) add(view.myDrawn);
  view.dora.forEach(add);
  for (const p of view.players) {
    p.discards.forEach((d) => { if (!d.called) add(d.id); });
    p.melds.forEach((m) => m.tiles.forEach(add));
  }
  return vis;
}

function miniTiles(kinds) {
  return `<span class="mini-tiles">${kinds.map((k) => tileHtml(codeOfKind(k), 't-mini')).join('')}</span>`;
}

// ── 방 설정 화면 ───────────────────────────────────────────
function renderLobby() {
  const r = S.room;
  if (!r) { stage.innerHTML = '<div class="connecting">접속 중…</div>'; return; }
  const me = r.me;
  const set = r.settings;
  const humans = r.seats.filter((s) => s.type === 'human');
  const pos = ['b', 'r', 't', 'l'];
  const seatCard = (seat) => {
    const s = r.seats[seat];
    const p = pos[relOf(seat, me)];
    const windKo = WIND_KO[seat];
    let body;
    let av;
    if (s.type === 'human') {
      const isMe = seat === me;
      av = `<div class="avatar ${avatarClass(s, seat)}">${esc(avatarChar(s))}<span class="wind">${WIND_KANJI[seat]}</span></div>`;
      body = `<div class="sname">${windKo}가 · ${esc(s.name)} ${isMe ? '<span class="badge me">YOU</span>' : '<span class="badge human">친구</span>'}${s.host ? ' <span class="badge ai">방장</span>' : ''}</div>
        <div class="ssub"><span class="${s.connected ? 'dot-online' : 'dot-offline'}"></span>${s.connected ? '접속 중' : '연결 끊김'}</div>`;
    } else {
      av = `<div class="avatar av-ai">${s.type === 'ai' ? esc(avatarChar(s)) : '🤖'}<span class="wind">${WIND_KANJI[seat]}</span></div>`;
      body = `<div class="sname">${windKo}가 · ${s.type === 'ai' ? esc(s.name) : 'AI'}</div><div class="ssub">${LEVEL_KO[set.aiLevel]} AI가 앉아요</div>`;
    }
    return `<div class="seat s-${p}${s.type === 'human' ? '' : ' empty'}">${av}<div>${body}</div></div>`;
  };
  const optRow = (label, key, options) => `<div class="rule">${label}<div class="opts">${options.map(([v, t]) => `<button class="opt${set[key] === v ? ' on' : ''}" data-cfg="${key}" data-val="${v}" ${r.isHost ? '' : 'disabled'}>${t}</button>`).join('')}</div></div>`;
  const toggleRow = (label, key) => `<div class="rule">${label}<button class="toggle${set[key] ? '' : ' off'}" data-cfg="${key}" data-val="${set[key] ? 'off' : 'on'}" data-bool="1" ${r.isHost ? '' : 'disabled'}></button></div>`;
  const note = humans.length === 1
    ? '친구가 들어오면 마주 보는 자리에 앉아요. 혼자 시작하면 AI 3명과 대국해요.'
    : `사람 ${humans.length}명 + AI ${4 - humans.length}명으로 시작해요.${humans.length === 2 ? ' 두 사람은 마주 보는 자리예요.' : ''}`;
  stage.innerHTML = `<div id="content"><div class="setup"><div>
    <h2>마작 방 설정<small>4인 일본식 리치마작</small></h2>
    <p class="lead">${note}</p>
    <div class="seat-map"><div class="mini-table"><span>${set.length === 'half' ? '반장전' : '동풍전'}<br><small style="font-size:11px">자리 배치</small></span></div>
      ${[0, 1, 2, 3].map(seatCard).join('')}
    </div></div>
    <div class="rules"><h3>규칙</h3>
      ${optRow('대국 길이', 'length', [['east', '동풍전'], ['half', '반장전']])}
      ${optRow('AI 난이도', 'aiLevel', [['easy', '쉬움'], ['normal', '보통'], ['hard', '어려움']])}
      ${toggleRow('적도라 (5만·5통·5삭 각 1장)', 'aka')}
      ${toggleRow('쿠이탕 (울고 탕야오)', 'kuitan')}
      <div class="rule">시작 점수 <b style="color:var(--accent)">25,000</b></div>
      <div class="rule">한글 패 이름 표시 <button class="toggle${S.showNames ? '' : ' off'}" data-local="names"></button></div>
      <div class="rule">대기패·안전패 도우미 <button class="toggle${S.assist ? '' : ' off'}" data-local="assist"></button></div>
      <div class="rule-note">생각 시간 15초 + 여유 20초(대국 전체). 시간이 지나면 자동으로 버려요.</div>
      ${r.isHost
        ? `<button class="start" data-do="start">대국 시작<small>${humans.length === 1 ? 'AI 3명과 시작' : `AI ${4 - humans.length}명이 빈자리를 채워요`}</small></button>`
        : '<div class="waiting-note">방장이 대국을 시작하길 기다리는 중이에요…</div>'}
    </div></div></div>`;
}

// ── 대국 화면 ──────────────────────────────────────────────
function plateHtml(seat, v, posCls) {
  const info = seatInfo(seat);
  const p = v.players[seat];
  const isMe = seat === v.me;
  const turn = v.waitingOn.includes(seat) && v.phase !== 'ack' && v.phase !== 'over';
  let badge = isMe ? '<span class="badge me">YOU</span>' : (info.type === 'human' ? '<span class="badge human">친구</span>' : '<span class="badge ai">AI</span>');
  if (p.riichi) badge += '<span class="badge riichi">리치</span>';
  if (isMe && v.furiten) badge += '<span class="badge furiten">후리텐</span>';
  if (info.away) badge += '<span class="badge away">자동</span>';
  let sub = `${p.score.toLocaleString()}점`;
  if (info.type === 'ai' && info.level) sub += ` · ${LEVEL_KO[info.level]}`;
  if (info.type === 'human' && !isMe) sub = `<span class="${info.connected ? 'dot-online' : 'dot-offline'}"></span>${info.connected ? '접속 중' : '끊김'} · ${sub}`;
  const timer = isMe && turn ? '<div class="timer" id="my-timer"><span>-</span></div>' : '';
  return `<div class="plate p-${posCls}${turn ? ' turn' : ''}${p.riichi ? ' riichi' : ''}${info.away ? ' away' : ''}">
    <div class="avatar ${avatarClass(info, seat)}">${esc(avatarChar(info))}<span class="wind">${WIND_KANJI[p.wind]}</span>${seat === v.dealer ? '<span class="dealer">親</span>' : ''}</div>
    <div><div class="name">${esc(info.name)}${badge}</div><div class="sub">${sub}</div></div>${timer}</div>`;
}

function pondHtml(p, v) {
  return p.discards.map((d) => {
    const isLast = v.lastDiscard && v.lastDiscard.id === d.id && (v.phase === 'reaction');
    const cls = `${isLast ? 'last' : ''}${d.called ? ' taken' : ''}`.trim();
    if (d.riichi) return sideHtml(code(d.id), 't-pond', cls, '', { id: d.id });
    return tileHtml(code(d.id), 't-pond', cls, '', { id: d.id });
  }).join('');
}

function handHtml(v, legal) {
  const hints = S.st.hints;
  const canAct = legal?.kind === 'turn';
  const riichiIds = canAct ? legal.riichi : [];
  const discardIds = canAct ? legal.discard : [];
  const best = new Set(hints?.best || []);
  const safe = new Set(hints?.safe || []);
  // 같은 종류가 여러 장이면 적도라가 아닌 패에 추천 태그를 붙인다.
  const isRed = (id) => id === 16 || id === 52 || id === 88;
  let bestId = null;
  if (S.assist && canAct && !S.riichiMode && best.size) {
    const ids = [...v.myHand, ...(v.myDrawn != null ? [v.myDrawn] : [])].filter((id) => best.has(id >> 2) && discardIds.includes(id));
    bestId = ids.find((id) => !isRed(id)) ?? ids[0] ?? null;
  }
  const mk = (id, extra = '') => {
    const k = id >> 2;
    let cls = `hand ${extra}`;
    let inner = '';
    if (S.selected === id) cls += ' lift';
    if (S.riichiMode) { if (!riichiIds.includes(id)) cls += ' dim'; }
    else if (canAct && !discardIds.includes(id)) cls += ' forbid';
    if (S.showNames) inner += `<span class="cap">${kindName(k)}</span>`;
    if (S.assist && canAct && !S.riichiMode) {
      if (id === bestId) inner += `<span class="tag best">${safe.has(k) ? '추천·안전' : '추천'}</span>`;
      else if (safe.has(k)) inner += '<span class="tag safe">안전</span>';
    } else if (S.assist && safe.has(k)) inner += '<span class="tag safe">안전</span>';
    return tileHtml(code(id), 't-hand', cls, inner, { id });
  };
  const tiles = v.myHand.map((id) => mk(id)).join('');
  const drawn = v.myDrawn != null ? mk(v.myDrawn, 'drawn') : '';
  const melds = v.players[v.me].melds.map((m) => meldHtml(m, v.me, 't-meld')).join('');
  return `<div class="my-hand${canAct ? ' can' : ''}">${tiles}${drawn}${melds ? `<div class="melds">${melds}</div>` : ''}</div>`;
}

function opponentHands(v) {
  let html = '';
  for (const p of v.players) {
    const rel = relOf(p.seat, v.me);
    if (rel === 0) continue;
    const backs = (cls, size) => Array.from({ length: p.handCount }, () => backHtml(size, cls)).join('')
      + (p.hasDrawn ? `<span class="drawn-gap"></span>${backHtml(size, cls)}` : '');
    const melds = p.melds.map((m) => meldHtml(m, p.seat, 't-meldo')).join('');
    if (rel === 2) html += `<div class="top-hand">${backs('', 't-top')}${melds ? `<div class="melds">${melds}</div>` : ''}</div>`;
    else html += `<div class="side-hand ${rel === 1 ? 'right' : 'left'}">${backs('side', 't-side')}${melds ? `<div class="melds">${melds}</div>` : ''}</div>`;
  }
  return html;
}

function boardHtml(v) {
  const activeTurn = v.phase === 'turn' ? v.turn : (v.phase === 'reaction' && v.lastDiscard ? v.lastDiscard.seat : -1);
  let html = '<div class="board"><div class="center-box"></div>';
  for (const p of v.players) {
    const rel = relOf(p.seat, v.me);
    html += `<div class="layer s${rel}${p.riichi ? ' riichi' : ''}">`;
    html += `<div class="seat-score"><span class="w">${WIND_KANJI[p.wind]}</span><span class="pt">${p.score.toLocaleString()}</span></div>`;
    if (p.seat === activeTurn) html += '<div class="turn-edge"></div>';
    html += '<div class="stick"></div>';
    html += `<div class="pond">${pondHtml(p, v)}</div></div>`;
  }
  const dora = Array.from({ length: 5 }, (_, i) => (i < v.dora.length ? tileHtml(code(v.dora[i]), 't-mini') : backHtml('t-mini'))).join('');
  html += `<div class="center-info"><div class="round">${WIND_KANJI[v.roundWind]} ${v.dealer + 1}局</div>
    <div class="round-sub">${v.honba}본장 · 공탁 ${v.kyotaku}</div><div class="dora-row">${dora}</div>
    <div class="wall-left">残 ${v.wallLeft}</div></div></div>`;
  return html;
}

/** 향청수 → 도우미 문구. 용어를 몰라도 "몇 단계 남았는지"가 보이게 풀어 쓴다 */
const shantenText = (n) => `텐파이까지 ${n}단계(${n}향청)`;

/** 대기패의 역 상태(ok·tsumo·none·partial) → 안내 문구. 문제없으면 '' */
function yakuText(status, fixable) {
  if (status === 'none') return fixable ? '지금은 역이 없어요. 리치하면 생겨요' : '⚠ 역이 없어서 이 대기로는 화료할 수 없어요';
  if (status === 'tsumo') return '쯔모로만 이길 수 있어요. 리치하면 론도 돼요';
  if (status === 'partial') return '⚠ 일부 대기는 역이 없어요';
  return '';
}
const warnSpan = (text) => (text ? `<span class="warn">${text}</span>` : '');
const dot = (parts) => parts.filter(Boolean).join(' · ');

/** 퐁·치를 했을 때 도우미가 알려 주는 변화(h.call) */
const CALL_WHY = {
  slower: '울면 오히려 멀어져요',
  same: '울어도 빨라지지 않고 문전만 깨져요',
  'yaku-gain': '지금은 역이 없는데 울면 역이 생겨요',
  'no-yaku': '울고 텐파이가 돼도 역이 없어서 화료할 수 없어요',
  'tenpai-yaku': '울면 역이 있는 텐파이가 돼요',
  'tsumo-only': '텐파이는 되지만 쯔모로만 이길 수 있어요',
  partial: '텐파이는 되지만 일부 대기는 역이 없어요',
  'yaku-sure': '빨라지고 역도 확실해요',
  'closed-no-yaku': '역이 보장되지 않아요. 문전을 지키고 리치하는 게 좋아요',
  'open-no-yaku': '빨라지지만 역이 보장되지 않아요',
};
const CALL_VERDICT = { yes: ['👍 울어요', 'go'], maybe: ['🤔 상황 봐서', 'maybe'], no: ['✋ 패스 추천', 'stop'] };

function callText(c) {
  const [label, cls] = CALL_VERDICT[c.advice] || [];
  const verdict = label ? `<b class="verdict ${cls}">${label}</b> ${esc(CALL_WHY[c.why] || '')}` : '';
  const speed = c.after < c.before
    ? (c.after === 0 ? '울면 텐파이가 돼요' : `울면 ${c.before}향청 → ${c.after}향청으로 빨라져요`)
    : c.after === c.before
      ? (c.before === 0 ? '이미 텐파이라 울어도 같아요' : '울어도 속도는 그대로예요')
      : '울면 오히려 멀어져요';
  return dot([verdict, speed, c.opens ? '문전이 깨져 리치를 못 해요' : '']);
}

const KAN_WHY = {
  worse: '깡하면 모양이 나빠져요',
  'riichi-keep': '대기가 그대로라 도라만 늘어요',
  'riichi-danger': '리치한 사람이 있어요. 새 도라가 상대에게도 유리할 수 있어요',
  'waits-drop': '깡하면 기다리는 패가 줄어요',
  ankan: '문전을 지킨 채 도라가 늘고 점수도 올라요',
  kakan: '도라가 늘고 점수가 올라요 (상대가 론하는 창깡만 조심해요)',
  'dai-yakuhai': '역패는 퐁으로도 충분해요. 깡하면 도라가 늘어 상대에게도 유리해요',
  'dai-open': '문전이 깨지고 상대 도라도 늘어요',
  'dai-opened': '이미 울었다면 도라는 늘지만 위험도 같이 커져요',
};
const KAN_VERDICT = { yes: ['👍 깡해요', 'go'], maybe: ['🤔 상황 봐서', 'maybe'], no: ['✋ 깡 비추천', 'stop'] };

function kanText(c, name = '') {
  const [label, cls] = KAN_VERDICT[c?.advice] || [];
  return label ? `${name ? `깡 <b>${esc(name)}</b> ` : '깡 '}<b class="verdict ${cls}">${label}</b> ${esc(KAN_WHY[c.why] || '')}` : '';
}

function hintStrip(v, legal) {
  const h = S.st.hints;
  const vis = visibleCounts(v);
  const remain = (kinds) => kinds.reduce((a, k) => a + Math.max(0, 4 - vis[k]), 0);
  const riichiNames = v.players.filter((p) => p.seat !== v.me && p.riichi).map((p) => seatInfo(p.seat).name).join(', ');
  const waitsText = (waits) => `대기 ${miniTiles(waits.map((w) => w.kind))} (안 보이는 패 ${waits.reduce((a, w) => a + w.remaining, 0)}장)`;
  if (S.riichiMode && legal?.kind === 'turn') {
    if (S.selected == null) return '<span class="k">리치</span>리치할 패를 골라요 (밝게 보이는 패)';
    const k = S.selected >> 2;
    const waits = legal.riichiWaits?.[k] || [];
    return `<span class="k">리치</span><b>${kindName(k)}</b> 버리고 리치하면 대기 ${miniTiles(waits)} (안 보이는 패 ${remain(waits)}장)`;
  }
  if (legal?.kind === 'reaction') {
    const tile = legal.tile;
    const who = `${esc(seatInfo(legal.from).name)}(${WIND_KO[v.players[legal.from].wind]}가)`;
    const label = legal.ron ? '론 가능' : legal.pon ? (legal.daiminkan ? '퐁·깡 가능' : '퐁 가능') : legal.chi ? '치 가능' : '깡 가능';
    const info = S.assist && h ? dot([h.call ? callText(h.call) : '', h.callKan ? kanText(h.callKan) : '', h.note ? `<b>${esc(h.note)}</b>` : '']) : '';
    return `<span class="k">${label}</span>${who}의 버림패 ${miniTiles([tile >> 2])}${info ? ` · ${info}` : ''}`;
  }
  if (!S.assist || !h) return '';
  if (legal?.kind === 'turn') {
    if (h.note && legal.tsumo) return `<span class="k">도우미</span><b>${esc(h.note)}</b>`;
    const bestK = h.best?.[0];
    const e = bestK != null ? h.discards[bestK] : null;
    const state = h.shanten === 0 ? '버리면 텐파이!' : h.shanten > 0 ? shantenText(h.shanten) : '';
    const lead = h.note ? warnSpan(esc(h.note)) : '';
    const kans = Object.entries(h.kan || {}).map(([k, c]) => kanText(c, kindName(+k)));
    if (!e) return `<span class="k">도우미</span>${dot([lead, state, ...kans])}`;
    let why = '';
    if (h.bestWhy === 'fold') why = `리치한 ${esc(riichiNames)}님이 있고 아직 멀어서, 이미 나온 안전패를 골랐어요`;
    else if (h.bestWhy === 'tenpai' && e.waits?.length) why = dot([waitsText(e.waits), warnSpan(yakuText(e.yaku, h.fixable))]);
    else if (e.u > 0) why = `도움 되는 패가 ${e.u}장 남아 있어요`;
    return `<span class="k">도우미</span>${dot([
      lead, state, `추천 버림 <b>${kindName(bestK)}</b>`, why,
      h.bestSavedDora ? '도라는 남겨 뒀어요' : '',
      h.bestRisky ? warnSpan(`⚠ 리치한 ${esc(riichiNames)}님에게 위험한 패예요`) : '',
      ...kans,
    ])}`;
  }
  if (h.waits?.length) {
    return `<span class="k">도우미</span>${dot(['텐파이!', waitsText(h.waits), warnSpan(yakuText(h.yaku, h.fixable))])}`;
  }
  if (typeof h.shanten === 'number') return `<span class="k">도우미</span>${shantenText(h.shanten)}`;
  return '';
}

function actionsHtml(v, legal) {
  if (!legal) return '';
  let btns = '';
  if (legal.kind === 'turn') {
    if (S.riichiMode) {
      btns += `<button class="act pulse" data-do="riichi-ok" ${S.selected == null ? 'disabled' : ''}>리치 확정<small>1,000점 공탁</small></button><button class="act ghost" data-do="riichi-cancel">취소</button>`;
    } else {
      if (legal.tsumo) btns += '<button class="act pulse" data-do="tsumo">쯔모<small>화료!</small></button>';
      if (legal.riichi.length) btns += '<button class="act" data-do="riichi">리치</button>';
      for (const k of legal.ankan) btns += `<button class="act" data-do="ankan" data-kind="${k}">암깡<small>${kindName(k)}</small></button>`;
      for (const id of legal.kakan) btns += `<button class="act" data-do="kakan" data-id="${id}">가깡<small>${kindName(id >> 2)}</small></button>`;
      if (legal.kyuushu) btns += '<button class="act ghost" data-do="kyuushu">구종구패<small>유국 선언</small></button>';
      if (S.selected != null) btns += '<button class="act ghost" data-do="discard">버리기</button>';
    }
  } else if (legal.kind === 'reaction') {
    if (legal.ron) btns += '<button class="act pulse" data-do="ron">론<small>화료!</small></button>';
    if (legal.pon) btns += `<button class="act${legal.ron ? '' : ' pulse'}" data-do="pon">퐁<small>${kindName(legal.tile >> 2)} ×3</small></button>`;
    if (legal.daiminkan) btns += '<button class="act" data-do="kan">깡<small>4장</small></button>';
    (legal.chi || []).forEach((c, i) => {
      const ks = [...c.ids, legal.tile].map((id) => id >> 2).sort((a, b) => a - b);
      btns += `<button class="act" data-do="chi" data-idx="${i}">치<small>${ks.map((k) => (k % 9) + 1).join('·')}</small></button>`;
    });
    btns += '<button class="act ghost" data-do="pass">패스</button>';
  }
  const many = (btns.match(/<button/g) || []).length >= 4 ? ' many' : '';
  return `<div class="actions${many}">${btns}</div>${legal.kind === 'reaction' ? '<div class="call-timer"><i id="call-bar"></i></div>' : ''}`;
}

function renderGame() {
  const v = S.st.view;
  const legal = v.phase === 'ack' || v.phase === 'over' ? null : v.legal;
  let html = '';
  html += opponentHands(v);
  html += boardHtml(v);
  const order = [[0, 'me'], [1, 'right'], [2, 'top'], [3, 'left']];
  for (const [rel, cls] of order) html += plateHtml((v.me + rel) % 4, v, cls);
  html += handHtml(v, legal);
  const strip = hintStrip(v, legal);
  if (strip) html += `<div class="strip">${strip}</div>`;
  html += actionsHtml(v, legal);
  if (S.assist && S.st.hints?.safe?.length) {
    const rp = v.players.filter((p) => p.seat !== v.me && p.riichi).map((p) => seatInfo(p.seat).name);
    if (rp.length) html += `<div class="legend"><b>${esc(rp.join(', '))}</b>님이 리치 중<br><span class="tag safe" style="position:static;display:inline-block;margin-right:4px;transform:none">안전</span> 리치한 사람이 이미 버린 패(현물)라서 론당하지 않아요</div>`;
  }
  if (v.phase === 'ack' && v.result) html += resultHtml(v);
  if (v.phase === 'over' && v.final) html += finalHtml(v);
  stage.innerHTML = `<div id="content">${html}</div>`;
  fx.attach();
  fx.rehide();
  const overKey = v.phase === 'ack' && v.result ? `r${v.handNo}` : (v.phase === 'over' && v.final ? 'final' : null);
  if (overKey && S.shown !== overKey) {
    S.shown = overKey;
    S.resFocus = null;
    S.resTip = null;
    const late = overKey === 'final' ? 700 : (v.result.kind === 'agari' ? 1250 : 350);
    S.anims.push({ at: performance.now(), ttl: late + 3500, run: (el) => overlayIn(el, { late, final: overKey === 'final' }) });
  }
  applyResUi();
  resumeAnims();
  updateTimers();
}

// ── 결과 / 종료 ────────────────────────────────────────────
/** ⓘ 버튼. key는 펼칠 설명(.tip[data-tipbox])과 짝이다. */
const infoBtn = (key, label) => `<button class="info" data-tip="${key}" aria-label="${esc(label)} 설명">ⓘ</button>`;
const tipBox = (key, text) => `<div class="tip" data-tipbox="${key}">${esc(text)}</div>`;

/** 역 한 줄. 줄에 올리면 관련 패(data-hl 패 id)가 강조되고 ⓘ를 올리면 설명이 펼쳐진다. */
function yakuRow(y, wi, i) {
  const key = `${wi}:${i}`;
  const info = YAKU_INFO[y.name];
  const han = y.yakuman ? `${y.yakuman >= 2 ? `${y.yakuman}배 ` : ''}역만` : `${y.han}판`;
  const ids = y.hl || [];
  // 구성 패는 항상 보여 준다. 손패 거의 전체(탕야오·핑후 등)는 패 대신 문구만 둔다.
  const tiles = ids.length > 0 && ids.length <= 10 ? `<span class="ytiles">${ids.map((id) => tileHtml(code(id), 't-mini')).join('')}</span>` : '';
  const brief = BONUS_YAKU.has(y.name) ? '' : (info?.match(/^.*?\.(?=\s|$)/)?.[0] || info || '');
  const sub = tiles || brief ? `<div class="ysub">${tiles}${brief ? `<span class="ytext">${esc(brief)}</span>` : ''}</div>` : '';
  return `<div class="yrow" data-yk="${key}" data-hl="${ids.join(',')}"><div class="yline"><span class="yn">${esc(y.name)}${info ? infoBtn(`y:${key}`, y.name) : ''}</span><span class="yh">${han}</span></div>${sub}${info ? tipBox(`y:${key}`, info) : ''}</div>`;
}

/** 역이 아니라 판수만 더하는 보너스. 결과창에서 족보와 따로 묶는다. */
const BONUS_YAKU = new Set(['도라', '적도라', '뒷도라']);

/** 결과 화면의 강조·설명 상태(S.resFocus/S.resTip)를 현재 DOM에 반영한다. 재렌더 후에도 호출한다. */
function applyResUi() {
  const box = stage.querySelector('.result');
  if (!box) return;
  box.querySelectorAll('.yrow').forEach((r) => r.classList.toggle('on', r.dataset.yk === S.resFocus));
  box.querySelectorAll('[data-tip], [data-tipbox]').forEach((el) => el.classList.toggle('open', (el.dataset.tip ?? el.dataset.tipbox) === S.resTip));
  box.querySelectorAll('.res-win').forEach((win) => {
    const row = S.resFocus ? win.querySelector(`.yrow[data-yk="${S.resFocus}"]`) : null;
    const ids = new Set((row?.dataset.hl || '').split(',').filter(Boolean).map(Number));
    const hand = win.querySelector('.res-hand');
    hand.classList.toggle('focus', ids.size > 0);
    hand.querySelectorAll('.tile[data-id]').forEach((t) => t.classList.toggle('hl', ids.has(+t.dataset.id)));
  });
}

function setResUi({ focus = S.resFocus, tip = S.resTip } = {}) {
  S.resFocus = focus;
  S.resTip = tip;
  applyResUi();
}

/**
 * 화료 손을 서버가 준 분해(w.layout)대로 묶음(순쯔·커쯔·머리/또이츠)으로 나눠 패 id를 배정한다.
 * 화료패는 자기가 완성한 묶음에 먼저 넣는다. 배정이 안 맞으면 null(평평한 손패로 대체).
 * @returns {{ids:number[], cap:string, cls:string}[]|null}
 */
function winGroups(w) {
  const L = w.layout;
  if (!L) return null;
  const pool = new Map();
  for (const id of [...w.concealed, w.winTile]) {
    const k = id >> 2;
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k).push(id);
  }
  const defs = L.pairs
    ? L.pairs.map((k) => ({ kinds: [k, k], cap: '또이츠', cls: 'pair', win: k === w.winTile >> 2 }))
    : [...L.sets.map((s, i) => (s.t === 'seq'
      ? { kinds: [s.k, s.k + 1, s.k + 2], cap: '순쯔', cls: 'seq', win: L.win === i }
      : { kinds: [s.k, s.k, s.k], cap: '커쯔', cls: 'tri', win: L.win === i })),
    { kinds: [L.pair, L.pair], cap: '머리', cls: 'pair', win: L.win === 'pair' }];
  let winSeen = false;
  for (const d of defs) { if (d.win && !winSeen) winSeen = true; else d.win = false; }
  const take = (k, prefer) => {
    const a = pool.get(k);
    if (!a?.length) return null;
    const i = prefer != null ? a.indexOf(prefer) : -1;
    return a.splice(i >= 0 ? i : 0, 1)[0];
  };
  // 화료패를 먼저 예약해 같은 종류 다른 패가 그 자리를 차지하지 않게 한다.
  for (const d of defs) {
    d.ids = [];
    if (d.win) d.ids.push(take(w.winTile >> 2, w.winTile));
  }
  for (const d of defs) {
    const rest = d.win ? [...d.kinds] : d.kinds.slice();
    if (d.win) rest.splice(rest.indexOf(w.winTile >> 2), 1);
    for (const k of rest) d.ids.push(take(k));
    if (d.ids.includes(null)) return null;
    d.ids.sort((a, b) => (a >> 2) - (b >> 2) || a - b);
  }
  return defs;
}

function resultHtml(v) {
  const r = v.result;
  const waiting = v.waitingOn.length;
  const mineDone = !v.legal;
  const deltaRows = [0, 1, 2, 3].map((s) => {
    const info = seatInfo(s);
    const d = r.deltas[s];
    return `<div class="delta${s === v.me ? ' mine' : ''}"><div class="avatar ${avatarClass(info, s)}">${esc(avatarChar(info))}</div>${esc(info.name)}
      <span class="v">${r.after[s].toLocaleString()} <span class="${d > 0 ? 'plus' : d < 0 ? 'minus' : ''}">(${d > 0 ? '+' : ''}${d.toLocaleString()})</span></span></div>`;
  }).join('');
  const nextBtn = mineDone
    ? `<span>다른 플레이어를 기다리는 중… (${waiting}명)</span>`
    : `<span>${waiting > 1 ? `${waiting}명 확인 대기` : '다 읽었으면 눌러 주세요'}</span><button class="act" data-do="next">다음 국 →</button>`;
  let body;
  if (r.kind === 'agari') {
    body = r.winners.map((w) => {
      const info = seatInfo(w.seat);
      const wi = r.winners.indexOf(w);
      const groups = winGroups(w);
      const tileOf = (id) => tileHtml(code(id), 't-res', id === w.winTile ? 'win' : '', '', { id });
      const concealed = groups
        ? groups.map((g) => `<div class="grp ${g.cls}"><div class="grp-tiles">${g.ids.map(tileOf).join('')}</div><div class="grp-cap">${g.cap}</div></div>`).join('')
        : w.concealed.map((id) => tileHtml(code(id), 't-res', '', '', { id })).join('');
      const shapeNote = !groups ? '' : w.layout.pairs
        ? '이긴 모양: 같은 패 2장짜리 7쌍 (치또이츠)'
        : `이긴 모양: 3장 묶음 4개 + 같은 패 2장(머리) 1개, 그리고 족보(역) 1개 이상${w.melds.length ? ' · 울린 패(오른쪽)도 묶음 1개로 세요' : ''}`;
      const melds = w.melds.map((m) => meldHtml({ ...m, called: m.tiles[0] }, w.seat, 't-meld', true)).join('');
      const rows = w.yaku.map((y, i) => ({ y, html: yakuRow(y, wi, i) }));
      const main = rows.filter((r) => !BONUS_YAKU.has(r.y.name)).map((r) => r.html).join('');
      const bonus = rows.filter((r) => BONUS_YAKU.has(r.y.name)).map((r) => r.html).join('');
      const yaku = `<div class="yaku-title">이긴 족보</div>${main}${bonus ? `<div class="yaku-title">보너스 <small>역은 아니고 판수만 더해져요</small></div>${bonus}` : ''}`;
      const total = w.yakuman ? `${w.limit}` : `${w.han}판 ${w.fu}부${w.limit ? ` · ${w.limit}` : ''}`;
      const first = w === r.winners[0];
      const scoreTip = w.yakuman ? limitInfo(w.limit) : `${TERM_INFO.score}${w.limit && limitInfo(w.limit) ? ` ${w.limit}: ${limitInfo(w.limit)}` : ''}`;
      const from = w.tsumo ? '쯔모' : `론 (${esc(seatInfo(w.from).name)})`;
      const isDealer = w.seat === v.dealer;
      return `<div class="res-win" data-w="${wi}">
        <div class="res-head"><h2>${w.tsumo ? '쯔모' : '론'}</h2><span>${esc(info.name)} (${WIND_KO[v.players[w.seat].wind]}가${isDealer ? ' · 친' : ''}) 화료 · ${from}${isDealer ? infoBtn(`dealer:${wi}`, '친') : ''}</span>${w.limit ? `<span class="limit">${w.limit}</span>` : ''}${isDealer ? tipBox(`dealer:${wi}`, TERM_INFO.dealer) : ''}</div>
        ${shapeNote ? `<div class="res-shape">${shapeNote}</div>` : ''}
        <div class="res-hand${groups ? ' grouped' : ''}">${concealed}${groups ? '' : tileHtml(code(w.winTile), 't-res', 'win', '', { id: w.winTile })}${melds ? `<div class="melds">${melds}</div>` : ''}</div>
        <div class="res-body"><div>
          <div class="res-dora"><div>도라 ${r.dora.map((id) => tileHtml(code(id), 't-mini')).join('')}</div>${w.riichi ? `<div>뒷도라 ${r.ura.map((id) => tileHtml(code(id), 't-mini')).join('')}</div>` : ''}</div>
          <div class="yaku">${yaku}</div>
          <div class="total">${total}${scoreTip ? infoBtn(`score:${wi}`, '판·부') : ''}${scoreTip ? tipBox(`score:${wi}`, scoreTip) : ''}<small>${w.points.toLocaleString()}점${r.sticks && first ? ` + 공탁 ${(r.sticks * 1000).toLocaleString()}점${infoBtn('sticks', '공탁')}` : ''}${r.honba && first ? ` (${r.honba}본장 포함)${infoBtn('honba', '본장')}` : ''}</small>${r.sticks && first ? tipBox('sticks', TERM_INFO.sticks) : ''}${r.honba && first ? tipBox('honba', TERM_INFO.honba) : ''}</div>
        </div>${w === r.winners[0] ? `<div class="deltas">${deltaRows}</div>` : '<div></div>'}</div></div>`;
    }).join('');
  } else {
    const rows = r.tenpai.map((t, s) => {
      const info = seatInfo(s);
      const h = r.hands[s];
      const tiles = h ? h.concealed.map((id) => tileHtml(code(id), 't-mini')).join('') : '';
      const melds = h ? h.melds.map((m) => meldHtml({ ...m, called: m.tiles[0] }, s, 't-meldo')).join('') : '';
      const label = r.reason === 'exhaustive' ? (r.nagashi[s] ? '유국만관' : t ? '텐파이' : '노텐') : '';
      return `<div class="tenpai-row"><span class="st${t ? '' : ' no'}">${label}</span><b style="min-width:70px">${esc(info.name)}</b><span class="mini-tiles" style="display:flex;gap:2px">${tiles}</span>${melds}</div>`;
    }).join('');
    body = `<div class="res-head"><h2>${DRAW_REASON[r.reason] || '유국'}</h2><span>${r.label}</span></div>
      <div class="res-body"><div><div class="tenpai-list">${rows}</div></div><div class="deltas">${deltaRows}</div></div>`;
  }
  return `<div class="overlay"><div class="result">${body}<div class="res-actions">${nextBtn}</div></div></div>`;
}

function finalHtml(v) {
  const f = v.final;
  const rows = f.ranking.map((r) => {
    const info = seatInfo(r.seat);
    return `<div class="rank-row${r.rank === 1 ? ' first' : ''}"><span class="no">${r.rank}</span>
      <div class="avatar ${avatarClass(info, r.seat)}">${esc(avatarChar(info))}</div>${esc(info.name)}${r.seat === v.me ? ' <span class="badge me">YOU</span>' : ''}
      <span class="pts">${r.score.toLocaleString()}</span><span class="d ${r.delta >= 0 ? 'plus' : 'minus'}" style="color:${r.delta >= 0 ? '#34d399' : '#f87171'}">${r.delta >= 0 ? '+' : ''}${r.delta.toLocaleString()}</span></div>`;
  }).join('');
  const isHost = S.room?.isHost;
  return `<div class="overlay"><div class="result" style="width:640px">
    <div class="res-head"><h2>대국 종료</h2><span>${OVER_REASON[f.reason] || ''}</span></div>
    <div class="rank-list">${rows}</div>
    <div class="res-actions"><button class="act ghost" data-do="leave">게임 선택</button>${isHost ? '<button class="act" data-do="rematch">다시 하기</button>' : '<span>방장이 다시 시작할 수 있어요</span>'}</div>
  </div></div>`;
}

// ── 타이머 ─────────────────────────────────────────────────
function updateTimers() {
  if (!S.st) return;
  const t = S.st.timers.find((x) => x.seat === S.seat);
  const timerEl = $('my-timer');
  const bar = $('call-bar');
  if (!t) return;
  const left = Math.max(0, t.deadline - (Date.now() + S.offset));
  const pct = Math.min(100, (left / t.total) * 100);
  if (timerEl) {
    timerEl.querySelector('span').textContent = Math.ceil(left / 1000);
    timerEl.style.background = `conic-gradient(var(--turn) ${pct}%, rgba(255,255,255,.12) 0)`;
    timerEl.classList.toggle('low', left < 5000);
  }
  if (bar) bar.style.width = `${pct}%`;
}
setInterval(updateTimers, 250);

// ── 렌더 진입 ──────────────────────────────────────────────
function render() {
  if (S.st && S.room && S.room.phase !== 'lobby') renderGame();
  else { renderLobby(); S.shown = null; S.anims = []; }
  fx.attach();
  guide.attach();
  document.getElementById('btn-assist').classList.toggle('on', S.assist);
  document.getElementById('btn-names').classList.toggle('on', S.showNames);
}

// ── 입력 ───────────────────────────────────────────────────
function toggleAssist() {
  S.assist = !S.assist;
  store.set('mahjong:assist', S.assist ? '1' : '0');
  send({ type: 'ASSIST', on: S.assist });
  render();
}
function toggleNames() {
  S.showNames = !S.showNames;
  store.set('mahjong:names', S.showNames ? '1' : '0');
  render();
}

// 결과 화면 설명: 마우스는 올리면 펼치고 벗어나면 접는다. 터치·키보드는 탭(클릭)으로 토글한다.
let lastPointer = 'mouse';
stage.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType; }, true);
stage.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse') return;
  const info = e.target.closest('.result .info[data-tip]');
  const row = e.target.closest('.result .yrow');
  if (!info && !row) return;
  setResUi({ focus: row ? row.dataset.yk : S.resFocus, tip: info ? info.dataset.tip : S.resTip });
});
stage.addEventListener('pointerout', (e) => {
  if (e.pointerType !== 'mouse') return;
  const from = e.target.closest('.result .info[data-tip], .result .yrow');
  if (!from) return;
  const row = from.closest('.yrow');
  const to = e.relatedTarget;
  if (row && !(to instanceof Element && row.contains(to))) setResUi({ focus: null, tip: S.resTip?.startsWith('y:') ? null : S.resTip });
  else if (!row && !(to instanceof Element && from.contains(to))) setResUi({ tip: null });
});

function onResultTap(e) {
  const info = e.target.closest('.result .info[data-tip]');
  const row = e.target.closest('.result .yrow');
  if (info) {
    const open = S.resTip !== info.dataset.tip;
    setResUi({ tip: open ? info.dataset.tip : null, focus: row ? (open ? row.dataset.yk : null) : S.resFocus });
    return true;
  }
  if (row) { setResUi({ focus: S.resFocus === row.dataset.yk ? null : row.dataset.yk }); return true; }
  if (e.target.closest('.result') && !e.target.closest('[data-do]') && (S.resFocus || S.resTip)) setResUi({ focus: null, tip: null });
  return false;
}

stage.addEventListener('click', (e) => {
  sounds.unlock();
  if ((lastPointer !== 'mouse' || e.detail === 0) && onResultTap(e)) return;
  const tile = e.target.closest('.tile.hand[data-id]');
  if (tile) { onTileClick(+tile.dataset.id); return; }
  const cfg = e.target.closest('[data-cfg]');
  if (cfg && S.room?.isHost) {
    const key = cfg.dataset.cfg;
    const val = cfg.dataset.bool ? cfg.dataset.val === 'on' : cfg.dataset.val;
    send({ type: 'CONFIG', settings: { [key]: val } });
    return;
  }
  const local = e.target.closest('[data-local]');
  if (local) { if (local.dataset.local === 'assist') toggleAssist(); else toggleNames(); return; }
  const btn = e.target.closest('[data-do]');
  if (btn && !btn.disabled) onAction(btn);
});

function onTileClick(id) {
  const v = S.st?.view;
  const legal = v?.legal;
  if (!legal || legal.kind !== 'turn' || S.busy || v.phase !== 'turn') return;
  if (S.riichiMode) {
    if (!legal.riichi.includes(id)) return;
    S.selected = S.selected === id ? null : id;
    sounds.play('draw');
    render();
    return;
  }
  if (!legal.discard.includes(id)) { showToast('지금은 이 패를 버릴 수 없어요.'); return; }
  if (S.selected === id) { act({ type: 'discard', id }); return; }
  S.selected = id;
  sounds.play('draw');
  render();
}

function onAction(btn) {
  const v = S.st?.view;
  const legal = v?.legal;
  switch (btn.dataset.do) {
    case 'start': send({ type: 'START' }); break;
    case 'tsumo': act({ type: 'tsumo' }); break;
    case 'ron': act({ type: 'ron' }); break;
    case 'pon': act({ type: 'pon' }); break;
    case 'kan': act({ type: 'daiminkan' }); break;
    case 'pass': act({ type: 'pass' }); break;
    case 'chi': act({ type: 'chi', ids: legal.chi[+btn.dataset.idx].ids }); break;
    case 'ankan': act({ type: 'ankan', kind: +btn.dataset.kind }); break;
    case 'kakan': act({ type: 'kakan', id: +btn.dataset.id }); break;
    case 'kyuushu': act({ type: 'kyuushu' }); break;
    case 'discard': if (S.selected != null) act({ type: 'discard', id: S.selected }); break;
    case 'riichi': S.riichiMode = true; S.selected = null; render(); break;
    case 'riichi-cancel': S.riichiMode = false; S.selected = null; render(); break;
    case 'riichi-ok': if (S.selected != null) act({ type: 'discard', id: S.selected, riichi: true }); break;
    case 'next': act({ type: 'next' }); break;
    case 'rematch': send({ type: 'REMATCH' }); break;
    case 'leave': leave(); break;
    default: break;
  }
}

function leave() {
  send({ type: 'LEAVE' });
  location.href = '/';
}

$('btn-back').addEventListener('click', leave);
$('btn-guide').addEventListener('click', () => guide.toggle());
$('btn-assist').addEventListener('click', toggleAssist);
$('btn-names').addEventListener('click', toggleNames);
const soundBtn = $('btn-sound');
soundBtn.textContent = sounds.isMuted() ? '🔇' : '🔊';
soundBtn.classList.toggle('on', !sounds.isMuted());
soundBtn.addEventListener('click', () => {
  sounds.setMuted(!sounds.isMuted());
  soundBtn.textContent = sounds.isMuted() ? '🔇' : '🔊';
  soundBtn.classList.toggle('on', !sounds.isMuted());
  sounds.unlock();
});
const bgmBtn = $('btn-bgm');
const paintBgm = () => { bgmBtn.classList.toggle('on', sounds.isBgm()); bgmBtn.textContent = sounds.isBgm() ? '🎵 BGM' : '🎵 BGM 꺼짐'; };
paintBgm();
bgmBtn.addEventListener('click', () => {
  sounds.setBgm(!sounds.isBgm());
  paintBgm();
  sounds.unlock();
});

// ── 화면 비율 맞춤 ────────────────────────────────────────
// 무대 높이는 760 고정, 폭은 창 비율에 맞춰 1200~1600으로 늘린다(가운데 기준 요소는 CSS --dx로 가운데 유지).
function fit() {
  const outer = $('fit');
  const inner = $('fit-inner');
  const availW = Math.max(200, outer.clientWidth - 48);
  const header = document.querySelector('.game-header').offsetHeight + 40;
  const availH = Math.max(150, window.innerHeight - header);
  const w = Math.round(Math.min(STAGE_MAX_W, Math.max(STAGE_MIN_W, STAGE_H * availW / availH)));
  const scale = Math.max(0.2, Math.min(availW / w, availH / STAGE_H, 3));
  S.stageW = w;
  stage.style.width = `${w}px`;
  stage.style.setProperty('--dx', `${(w - STAGE_MIN_W) / 2}px`);
  stage.style.setProperty('--board-scale', String(BOARD_SCALE));
  stage.style.setProperty('--act-scale', String(ACTION_SCALE));
  stage.style.setProperty('--stage-w', `${w}px`);
  stage.style.transform = `scale(${scale})`;
  inner.style.width = `${w * scale}px`;
  inner.style.height = `${STAGE_H * scale}px`;
  inner.style.margin = '0 auto';
}
window.addEventListener('resize', fit);
fit();

connect();
