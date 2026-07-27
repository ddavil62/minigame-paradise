import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const BASE = 'http://localhost:3015';
const SS = 'C:/antigravity/minigame-paradise/starlight-mail-tower/tests/screenshots';
async function measure() {
  await mkdir(SS, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const R = {};

  // Two-tab: 1024x576 with 17 level cards
  {
    const ctxA = await browser.newContext({ viewport: { width: 1024, height: 576 } });
    const ctxB = await browser.newContext({ viewport: { width: 1024, height: 576 } });
    const pA = await ctxA.newPage();
    const pB = await ctxB.newPage();
    await Promise.all([pA.goto(BASE + '/?name=ADR3A'), pB.goto(BASE + '/?name=ADR3B')]);
    await pA.waitForSelector('#ready-overlay:not([hidden])', { timeout: 15000 });
    await new Promise(r => setTimeout(r, 1500));
    R.vp1024_cards = await pA.evaluate(() => {
      const card = document.querySelector('.ready-card');
      const list = document.querySelector('.level-list');
      const rb = document.querySelector('#ready-button');
      const ab = document.querySelector('#ai-start-button');
      const cb = card ? card.getBoundingClientRect() : null;
      const cs = card ? getComputedStyle(card) : null;
      const cols = list ? getComputedStyle(list).gridTemplateColumns.split(' ').length : 0;
      return {
        overflowY: cs ? cs.overflowY : null,
        justifyContent: cs ? cs.justifyContent : null,
        scrollTop: card ? card.scrollTop : null,
        scrollHeight: card ? card.scrollHeight : null,
        clientHeight: card ? card.clientHeight : null,
        cardH: cb ? Math.round(cb.height) : null,
        cardW: cb ? Math.round(cb.width) : null,
        colCount: cols,
        cardCount: list ? list.querySelectorAll('.level-card').length : 0,
        rbExists: !!rb,
        abExists: !!ab,
      };
    });
    R.vp1024_scroll = await pA.evaluate(() => {
      const card = document.querySelector('.ready-card');
      const rb = document.querySelector('#ready-button');
      const ab = document.querySelector('#ai-start-button');
      card.scrollTop = card.scrollHeight;
      const cb = card.getBoundingClientRect();
      const rbBox = rb ? rb.getBoundingClientRect() : null;
      const abBox = ab ? ab.getBoundingClientRect() : null;
      return {
        scrollTop: card.scrollTop,
        scrollHeight: card.scrollHeight,
        clientHeight: card.clientHeight,
        needsScroll: card.scrollHeight > card.clientHeight,
        readyBtnOk: rbBox ? (rbBox.top >= cb.top - 1 && rbBox.bottom <= cb.bottom + 2) : false,
        aiBtnOk: abBox ? (abBox.top >= cb.top - 1 && abBox.bottom <= cb.bottom + 2) : false,
        readyBtnBottom: rbBox ? Math.round(rbBox.bottom) : null,
        cardBottom: Math.round(cb.bottom),
      };
    });
    await pA.screenshot({ path: SS + '/ad3-r3-1024x576-2tab-scrollbottom.png' });
    await pA.evaluate(() => { document.querySelector('.ready-card').scrollTop = 0; });
    await pA.screenshot({ path: SS + '/ad3-r3-1024x576-2tab-scrolltop0.png' });

    // Within same 2-tab context, also check eyebrow visibility at scroll top
    R.vp1024_eyebrow = await pA.evaluate(() => {
      const card = document.querySelector('.ready-card');
      const ey = card ? card.querySelector('.eyebrow') : null;
      const cb = card ? card.getBoundingClientRect() : null;
      const eb = ey ? ey.getBoundingClientRect() : null;
      return {
        eyebrowTop: eb ? Math.round(eb.top) : null,
        eyebrowInCard: (eb && cb) ? eb.top >= cb.top - 1 : false,
        eyebrowVisible: eb ? eb.top >= 0 && eb.bottom <= window.innerHeight : false,
      };
    });
    await ctxA.close(); await ctxB.close();
  }

  await browser.close();
  console.log(JSON.stringify(R, null, 2));
}
measure().catch(e => { console.error(e.message); process.exit(1); });