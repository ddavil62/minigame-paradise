import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const BASE = 'http://localhost:3015';
const SS = 'C:/antigravity/minigame-paradise/starlight-mail-tower/tests/screenshots';
async function measure() {
  await mkdir(SS, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const R = {};

  // === VP1: 1024x576 (primary fix target) ===
  {
    const ctxA = await browser.newContext({ viewport: { width: 1024, height: 576 } });
    const ctxB = await browser.newContext({ viewport: { width: 1024, height: 576 } });
    const pA = await ctxA.newPage();
    const pB = await ctxB.newPage();
    await Promise.all([pA.goto(BASE + '/?name=ADR3A'), pB.goto(BASE + '/?name=ADR3B')]);
    await pA.waitForSelector('#ready-overlay:not([hidden])', { timeout: 15000 });
    R.vp1024 = await pA.evaluate(() => {
      const card = document.querySelector('.ready-card');
      const list = document.querySelector('.level-list');
      const rb = document.querySelector('#ready-button');
      const ab = document.querySelector('#ai-start-button');
      const ey = card ? card.querySelector('.eyebrow') : null;
      const cb = card ? card.getBoundingClientRect() : null;
      const eb = ey ? ey.getBoundingClientRect() : null;
      const cs = card ? getComputedStyle(card) : null;
      return {
        overflowY: cs ? cs.overflowY : null,
        justifyContent: cs ? cs.justifyContent : null,
        scrollTop: card ? card.scrollTop : null,
        scrollHeight: card ? card.scrollHeight : null,
        clientHeight: card ? card.clientHeight : null,
        cardTop: cb ? Math.round(cb.top) : null,
        cardW: cb ? Math.round(cb.width) : null,
        cardH: cb ? Math.round(cb.height) : null,
        eyebrowTop: eb ? Math.round(eb.top) : null,
        eyebrowInCard: (eb && cb) ? eb.top >= cb.top - 1 : false,
        colCount: list ? getComputedStyle(list).gridTemplateColumns.split(' ').length : 0,
        cardCount: list ? list.querySelectorAll('.level-card').length : 0,
        rbExists: !!rb,
        abExists: !!ab,
      };
    });
    // scroll to bottom
    R.vp1024scroll = await pA.evaluate(() => {
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
    await pA.screenshot({ path: SS + '/ad3-r3-1024x576-scrollbottom.png' });
    await pA.evaluate(() => { document.querySelector('.ready-card').scrollTop = 0; });
    await pA.screenshot({ path: SS + '/ad3-r3-1024x576-scrolltop0.png' });
    await ctxA.close(); await ctxB.close();
  }

  // === VP2: 521x576 (boundary: MQ min-width:521 applies) ===
  {
    const ctx = await browser.newContext({ viewport: { width: 521, height: 576 } });
    const p = await ctx.newPage();
    await p.goto(BASE + '/?name=ADR3C');
    await p.waitForSelector('#ready-overlay', { timeout: 15000 });
    R.vp521 = await p.evaluate(() => {
      const card = document.querySelector('.ready-card');
      const list = document.querySelector('.level-list');
      const cs = card ? getComputedStyle(card) : null;
      return {
        overflowY: cs ? cs.overflowY : null,
        justifyContent: cs ? cs.justifyContent : null,
        scrollHeight: card ? card.scrollHeight : null,
        clientHeight: card ? card.clientHeight : null,
        cardW: card ? Math.round(card.getBoundingClientRect().width) : null,
        colCount: list ? getComputedStyle(list).gridTemplateColumns.split(' ').length : 0,
      };
    });
    await p.screenshot({ path: SS + '/ad3-r3-521x576.png' });
    await ctx.close();
  }

  // === VP3: 520x576 (boundary: max-width:520 applies, different MQ) ===
  {
    const ctx = await browser.newContext({ viewport: { width: 520, height: 576 } });
    const p = await ctx.newPage();
    await p.goto(BASE + '/?name=ADR3D');
    await p.waitForSelector('#ready-overlay', { timeout: 15000 });
    R.vp520 = await p.evaluate(() => {
      const card = document.querySelector('.ready-card');
      const list = document.querySelector('.level-list');
      const cs = card ? getComputedStyle(card) : null;
      return {
        overflowY: cs ? cs.overflowY : null,
        justifyContent: cs ? cs.justifyContent : null,
        scrollHeight: card ? card.scrollHeight : null,
        clientHeight: card ? card.clientHeight : null,
        cardW: card ? Math.round(card.getBoundingClientRect().width) : null,
        colCount: list ? getComputedStyle(list).gridTemplateColumns.split(' ').length : 0,
      };
    });
    await p.screenshot({ path: SS + '/ad3-r3-520x576.png' });
    await ctx.close();
  }

  // === VP4: 1280x720 (regression — game shell) ===
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const p = await ctx.newPage();
    await p.goto(BASE + '/?name=ADR3E');
    await p.waitForSelector('#game-shell', { timeout: 10000 });
    R.vp1280 = await p.evaluate(() => {
      const shell = document.querySelector('#game-shell');
      const topbar = document.querySelector('#topbar');
      const pv = document.querySelector('#play-viewport');
      const bbar = document.querySelector('#bottombar');
      const canvas = document.querySelector('#game-canvas');
      const pvBox = pv ? pv.getBoundingClientRect() : null;
      const cBox = canvas ? canvas.getBoundingClientRect() : null;
      const tbBox = topbar ? topbar.getBoundingClientRect() : null;
      const bbBox = bbar ? bbar.getBoundingClientRect() : null;
      return {
        shellRows: shell ? getComputedStyle(shell).gridTemplateRows : null,
        topbarH: tbBox ? Math.round(tbBox.height) : null,
        pvH: pvBox ? Math.round(pvBox.height) : null,
        bbarH: bbBox ? Math.round(bbBox.height) : null,
        gap: (pvBox && tbBox) ? Math.round(pvBox.top - tbBox.bottom) : null,
        canvasW: cBox ? Math.round(cBox.width) : null,
        canvasH: cBox ? Math.round(cBox.height) : null,
        pvW: pvBox ? Math.round(pvBox.width) : null,
        pvFill: (cBox && pvBox) ? Math.round(Math.abs(cBox.width - pvBox.width)) : null,
        objectFit: canvas ? getComputedStyle(canvas).objectFit : null,
        intrinsicW: canvas ? canvas.width : null,
        intrinsicH: canvas ? canvas.height : null,
      };
    });
    await p.screenshot({ path: SS + '/ad3-r3-1280x720.png' });
    await ctx.close();
  }

  await browser.close();
  console.log(JSON.stringify(R, null, 2));
}
measure().catch(e => { console.error(e.message); process.exit(1); });