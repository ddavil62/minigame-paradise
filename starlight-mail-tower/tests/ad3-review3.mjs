import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = 'http://localhost:3015';
const SS = 'C:/antigravity/minigame-paradise/starlight-mail-tower/tests/screenshots';

async function twoTab(browser, vp) {
  const ctxA = await browser.newContext({ viewport: vp });
  const ctxB = await browser.newContext({ viewport: vp });
  const pA = await ctxA.newPage();
  const pB = await ctxB.newPage();
  await Promise.all([pA.goto(BASE + '/?name=ADR3A'), pB.goto(BASE + '/?name=ADR3B')]);
  await pA.waitForSelector('#ready-overlay:not([hidden])', { timeout: 10000 });
  return { pA, pB, ctxA, ctxB };
}

async function run() {
  await mkdir(SS, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = []; let passed = 0, failed = 0;
  function chk(label, cond, actual, expected) {
    results.push({ label, ok: cond, actual, expected });
    if (cond) { passed++; console.log('PASS: ' + label); }
    else { failed++; console.log('FAIL: ' + label + ' | actual=' + actual + ' expected=' + expected); }
  }


  // === A. 1024x576 ===
  console.log('
=== A. 1024x576 ===');
  const { pA, pB, ctxA, ctxB } = await twoTab(browser, { width: 1024, height: 576 });

  const a1 = await pA.evaluate(() => {
    const card = document.querySelector(".ready-card");
    const eyebrow = card.querySelector(".eyebrow");
    const cardBox = card.getBoundingClientRect();
    const eyeBox = eyebrow ? eyebrow.getBoundingClientRect() : null;
    return {
      scrollTop: card.scrollTop, overflowY: getComputedStyle(card).overflowY,
      justifyContent: getComputedStyle(card).justifyContent,
      scrollHeight: card.scrollHeight, clientHeight: card.clientHeight,
      cardTop: Math.round(cardBox.top),
      eyebrowTop: eyeBox ? Math.round(eyeBox.top) : null,
      eyebrowInCard: eyeBox ? eyeBox.top >= cardBox.top - 1 : false,
    };
  });
  console.log('A1:', JSON.stringify(a1));
  chk('A1-1 overflow-y:auto', a1.overflowY === 'auto', a1.overflowY, 'auto');
  chk('A1-2 scrollTop=0', a1.scrollTop === 0, a1.scrollTop, 0);
  chk('A1-3 eyebrow>=cardTop', a1.eyebrowInCard, a1.eyebrowTop, '>='+a1.cardTop);
  chk('A1-4 eyebrow>=0', a1.eyebrowTop >= 0, a1.eyebrowTop, '>=0');
  chk('A1-5 justify-content:flex-start', a1.justifyContent === 'flex-start', a1.justifyContent, 'flex-start');
  await pA.screenshot({ path: SS + '/ad3-r3-1024x576-scrolltop0.png' });
  const a2 = await pA.evaluate(() => {
    const card = document.querySelector('.ready-card');
    const rb = document.querySelector('#ready-button');
    const ab = document.querySelector('#ai-start-button');
    card.scrollTop = card.scrollHeight;
    const cb = card.getBoundingClientRect();
    const rbBox = rb ? rb.getBoundingClientRect() : null;
    const abBox = ab ? ab.getBoundingClientRect() : null;
    return {
      scrollTop: card.scrollTop, scrollHeight: card.scrollHeight, clientHeight: card.clientHeight,
      needsScroll: card.scrollHeight > card.clientHeight,
      readyBtnOk: rbBox ? rbBox.top >= cb.top - 1 && rbBox.bottom <= cb.bottom + 2 : false,
      aiBtnOk: abBox ? abBox.top >= cb.top - 1 && abBox.bottom <= cb.bottom + 2 : false,
      readyBtnBottom: rbBox ? Math.round(rbBox.bottom) : null,
      cardBottom: Math.round(cb.bottom),
    };
  });
  console.log('A2:', JSON.stringify(a2));
  chk('A2-1 scroll works', a2.needsScroll ? a2.scrollTop > 0 : true, a2.scrollTop, a2.needsScroll ? '>0' : 'N/A');
  chk('A2-2 readyBtn reachable', a2.readyBtnOk, a2.readyBtnOk, true);
  chk('A2-3 aiBtn reachable', a2.aiBtnOk, a2.aiBtnOk, true);
  await pA.screenshot({ path: SS + '/ad3-r3-1024x576-scrollbottom.png' });
  const a3 = await pA.evaluate(() => {
    const list = document.querySelector('.level-list');
    const cards = Array.from(list.querySelectorAll('.level-card'));
    const cols = getComputedStyle(list).gridTemplateColumns.split(' ').length;
    return {
      colCount: cols, cardCount: cards.length,
      gridCols: getComputedStyle(list).gridTemplateColumns.substring(0,100),
      listWidth: Math.round(list.getBoundingClientRect().width),
      firstCardW: cards[0] ? Math.round(cards[0].getBoundingClientRect().width) : null,
    };
  });
  console.log('A3:', JSON.stringify(a3));
  chk('A3-1 17cards', a3.cardCount === 17, a3.cardCount, 17);
  chk('A3-2 cols 3-5', a3.colCount >= 3 && a3.colCount <= 5, a3.colCount, '3-5');

  const a4 = await pA.evaluate(() => {
    const card = document.querySelector('.ready-card');
    const ov = document.querySelector('#ready-overlay');
    const cb = card.getBoundingClientRect(); const ob = ov.getBoundingClientRect();
    return { cardRight: Math.round(cb.right), overlayRight: Math.round(ob.right), exceeds: cb.right > ob.right + 2 };
  });
  console.log('A4:', JSON.stringify(a4));
  chk('A4 card within overlay', !a4.exceeds, a4.cardRight, '<='+a4.overlayRight);
  await ctxA.close(); await ctxB.close();