import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const BASE = 'http://localhost:3015';
const SS = 'C:/antigravity/minigame-paradise/starlight-mail-tower/tests/screenshots';
async function go() {
  await mkdir(SS, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const R = {};
  const ctx1 = await browser.newContext({ viewport: { width: 1024, height: 576 } });
  const p1 = await ctx1.newPage();
  await p1.goto(BASE + '/?name=Solo');
  await p1.waitForSelector('#ready-overlay', { timeout: 8000 });
  R.css1024 = await p1.evaluate(() => {
    const card = document.querySelector('.ready-card');
    const ey = card ? card.querySelector('.eyebrow') : null;
    const list = document.querySelector('.level-list');
    const cb = card ? card.getBoundingClientRect() : null;
    const eb = ey ? ey.getBoundingClientRect() : null;
    return {
      overflowY: card ? getComputedStyle(card).overflowY : null,
      justifyContent: card ? getComputedStyle(card).justifyContent : null,
      scrollTop: card ? card.scrollTop : null,
      scrollHeight: card ? card.scrollHeight : null,
      clientHeight: card ? card.clientHeight : null,
      cardTop: cb ? Math.round(cb.top) : null,
      cardW: cb ? Math.round(cb.width) : null,
      eyebrowTop: eb ? Math.round(eb.top) : null,
      eyebrowInCard: (eb && cb) ? eb.top >= cb.top - 1 : false,
      colCount: list ? getComputedStyle(list).gridTemplateColumns.split(' ').length : 0,
      cardCount: list ? list.querySelectorAll('.level-card').length : 0,
      listWidth: list ? Math.round(list.getBoundingClientRect().width) : 0,
    };
  });
  R.scroll1024 = await p1.evaluate(() => {
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
      readyBtnOk: rbBox ? (rbBox.top >= cb.top - 1 && rbBox.bottom <= cb.bottom + 2) : false,
      aiBtnOk: abBox ? (abBox.top >= cb.top - 1 && abBox.bottom <= cb.bottom + 2) : false,
      readyBtnBottom: rbBox ? Math.round(rbBox.bottom) : null,
      cardBottom: Math.round(cb.bottom),
    };
  });
  await p1.screenshot({ path: SS + '/ad3-r3-1024x576-scrollbottom.png' });
  await p1.evaluate(() => { document.querySelector('.ready-card').scrollTop = 0; });
  await p1.screenshot({ path: SS + '/ad3-r3-1024x576-scrolltop0.png' });
  await ctx1.close();
