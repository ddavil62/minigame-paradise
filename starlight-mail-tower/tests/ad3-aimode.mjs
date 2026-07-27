import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const BASE = 'http://localhost:3015';
const SS = 'C:/antigravity/minigame-paradise/starlight-mail-tower/tests/screenshots';
async function measure() {
  await mkdir(SS, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const R = {};

  // AI mode: triggers bot spawn, gets level cards
  {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 576 } });
    const p = await ctx.newPage();
    await p.goto(BASE + '/?name=ADR3AI&mode=ai&fresh=1');
    // wait for ready-overlay with level cards
    await p.waitForSelector('#ready-overlay:not([hidden])', { timeout: 20000 });
    // wait a bit for bot to connect and levels to appear
    await new Promise(r => setTimeout(r, 3000));
    R.aiMode = await p.evaluate(() => {
      const card = document.querySelector('.ready-card');
      const list = document.querySelector('.level-list');
      const rb = document.querySelector('#ready-button');
      const ab = document.querySelector('#ai-start-button');
      const cb = card ? card.getBoundingClientRect() : null;
      const cs = card ? getComputedStyle(card) : null;
      const levelCards = list ? list.querySelectorAll('.level-card') : [];
      return {
        overflowY: cs ? cs.overflowY : null,
        justifyContent: cs ? cs.justifyContent : null,
        scrollTop: card ? card.scrollTop : null,
        scrollHeight: card ? card.scrollHeight : null,
        clientHeight: card ? card.clientHeight : null,
        cardH: cb ? Math.round(cb.height) : null,
        cardW: cb ? Math.round(cb.width) : null,
        colCount: list ? getComputedStyle(list).gridTemplateColumns.split(' ').length : 0,
        cardCount: levelCards.length,
        rbExists: !!rb,
        abExists: !!ab,
      };
    });
    // scroll to bottom
    R.aiModeScroll = await p.evaluate(() => {
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
    await p.screenshot({ path: SS + '/ad3-r3-1024x576-aimode-scrollbottom.png' });
    await p.evaluate(() => { document.querySelector('.ready-card').scrollTop = 0; });
    await p.screenshot({ path: SS + '/ad3-r3-1024x576-aimode-scrolltop0.png' });
    await ctx.close();
  }

  await browser.close();
  console.log(JSON.stringify(R, null, 2));
}
measure().catch(e => { console.error(e.message); process.exit(1); });