import { test, expect } from '@playwright/test';

test('debug AI game start', async ({ page }) => {
  page.on('console', msg => console.log('[BROWSER]', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('[ERROR]', err.message));

  // Go directly to mode=ai URL
  await page.goto('http://localhost:3000/venezia/?mode=ai');
  await page.waitForTimeout(1000);

  // Fill name and click AI button
  const nameInput = page.locator('#input-name');
  await nameInput.fill('QA');

  // Click the AI button
  await page.click('#btn-ai');

  // Wait longer for game to start
  await page.waitForTimeout(12000);

  // Check what screen is active
  const waiting = await page.locator('#screen-waiting').getAttribute('class');
  const game = await page.locator('#screen-game').getAttribute('class');
  const result = await page.locator('#screen-result').getAttribute('class');
  console.log('Screens:', { waiting, game, result });

  // Check waiting status
  const waitingStatusClass = await page.locator('#waiting-status').getAttribute('class');
  const waitingText = await page.locator('#waiting-status').textContent();
  console.log('Waiting status class:', waitingStatusClass);
  console.log('Waiting status text:', waitingText);
});
