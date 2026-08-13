import { test, expect } from '@playwright/test';

const publicUrl = process.env.TEST_PUBLIC_URL;
const password = process.env.TEST_PASSWORD;

test('password gate, lobby invite, friends and chat', async ({ page, context, browser }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: publicUrl });
  await page.goto('/');

  await expect(page).toHaveTitle('미니게임 천국 · 로그인');
  await expect(page.getByLabel('이 브라우저에서 30일간 기억')).toBeChecked();
  if (testInfo.project.name === 'desktop-chromium') {
    await page.screenshot({ path: 'tests/screenshots/public-auth-login.png', fullPage: true });
  }

  await page.getByLabel('접속 비밀번호').fill(password);
  await page.getByRole('button', { name: '입장하기' }).click();
  await expect(page.getByPlaceholder('닉네임 (최대 12자)')).toBeVisible();

  await page.getByPlaceholder('닉네임 (최대 12자)').fill('테스터');
  await page.locator('#nickname-gate').getByRole('button', { name: '입장하기' }).click();

  const invitePanel = page.locator('#invite-panel');
  await expect(invitePanel).toBeVisible();
  await expect(page.locator('#invite-url')).toHaveValue(publicUrl);
  await expect(page.getByText('HTTPS로 안전하게 연결됩니다.')).toBeVisible();

  const presenceFab = page.locator('#pw-fab');
  const presencePanel = page.locator('#pw-panel');
  const bugFab = page.locator('#bw-fab');
  await expect(presenceFab).toBeVisible();
  await expect(bugFab).toBeVisible();
  await expect(presencePanel).toBeHidden();
  await expect(presenceFab).toHaveAttribute('aria-expanded', 'false');

  const presenceBox = await presenceFab.boundingBox();
  const bugBox = await bugFab.boundingBox();
  expect(presenceBox).not.toBeNull();
  expect(bugBox).not.toBeNull();
  expect(Math.abs(presenceBox.y - bugBox.y)).toBeLessThanOrEqual(2);
  expect(presenceBox.x + presenceBox.width).toBeLessThanOrEqual(bugBox.x);

  await presenceFab.click();
  await expect(presencePanel).toBeVisible();
  await expect(presenceFab).toHaveAttribute('aria-expanded', 'true');
  const selfUser = page.locator('.pw-user-self');
  await expect(selfUser).toHaveCount(1);
  await expect(selfUser.getByText('테스터', { exact: true })).toBeVisible();
  await expect(selfUser.getByText('로비', { exact: true })).toBeVisible();

  if (testInfo.project.name === 'desktop-chromium') {
    const gamePage = await context.newPage();
    await gamePage.goto('/matgo/?name=테스터');
    await expect(selfUser.getByText('맞고 · 플레이 중', { exact: true })).toBeVisible();
    await gamePage.close();
    await expect(selfUser.getByText('로비', { exact: true })).toBeVisible();
  }

  await bugFab.click();
  await expect(presencePanel).toBeHidden();
  await expect(page.locator('#bw-panel')).toBeVisible();
  await presenceFab.click();
  await expect(page.locator('#bw-panel')).toBeHidden();
  await expect(presencePanel).toBeVisible();

  const suffix = testInfo.project.name === 'desktop-chromium' ? 'desktop' : 'mobile';
  await page.screenshot({ path: `tests/screenshots/presence-popup-${suffix}.png` });

  const friendName = testInfo.project.name === 'desktop-chromium' ? '친구QA' : '친구모바일';
  const friendContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: testInfo.project.use.viewport,
  });
  const friendPage = await friendContext.newPage();
  await friendPage.goto(publicUrl);
  await friendPage.getByLabel('접속 비밀번호').fill(password);
  await friendPage.getByRole('button', { name: '입장하기' }).click();
  await friendPage.getByPlaceholder('닉네임 (최대 12자)').fill(friendName);
  await friendPage.locator('#nickname-gate').getByRole('button', { name: '입장하기' }).click();

  await page.getByRole('button', { name: new RegExp(`${friendName}에게 메시지 보내기`) }).click();
  await expect(page.locator('#pw-chat-view')).toBeVisible();
  await page.locator('#pw-chat-input').fill('점심시간 게임 어때?');
  await page.locator('#pw-chat-form').getByRole('button', { name: '전송' }).click();

  await expect(friendPage.locator('#pw-fab-unread')).toHaveText('1');
  await expect(friendPage.locator('#pw-fab')).toHaveClass(/pw-fab-alerting/);
  await friendPage.screenshot({ path: `tests/screenshots/chat-alert-${suffix}.png` });
  await friendPage.locator('#pw-fab').click();
  await friendPage.getByRole('button', { name: /테스터에게 메시지 보내기/ }).click();
  await expect(friendPage.locator('#pw-fab')).not.toHaveClass(/pw-fab-alerting/);
  await expect(friendPage.locator('.pw-message-theirs').getByText('점심시간 게임 어때?')).toBeVisible();
  await friendPage.locator('#pw-chat-input').fill('좋아, 로비에서 만나!');
  await friendPage.locator('#pw-chat-form').getByRole('button', { name: '전송' }).click();
  await expect(page.locator('.pw-message-theirs').getByText('좋아, 로비에서 만나!')).toBeVisible();
  await page.locator('#pw-chat-view').locator('[data-pw-close]').click();
  await friendPage.locator('#pw-chat-input').fill('게임 중에도 바로 보여?');
  await friendPage.locator('#pw-chat-form').getByRole('button', { name: '전송' }).click();
  await expect(page.locator('#pw-fab-unread')).toHaveText('1');
  await page.locator('#pw-fab').click();
  await expect(page.locator('#pw-chat-view')).toBeVisible();
  await expect(page.locator('.pw-message-theirs').getByText('게임 중에도 바로 보여?')).toBeVisible();
  await expect(page.locator('#pw-fab-unread')).toBeHidden();
  await page.screenshot({ path: `tests/screenshots/chat-popup-${suffix}.png` });

  await page.getByRole('button', { name: '주소 복사' }).click();
  await expect(page.getByText('초대 주소를 복사했어요.')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(publicUrl);

  await page.screenshot({ path: `tests/screenshots/public-invite-${suffix}.png`, fullPage: true });
  await page.goto(`${publicUrl}/tetris-battle/?name=테스터`);
  await expect(page.locator('#pw-fab')).toBeVisible();
  await page.locator('#pw-fab').click();
  await expect(page.locator('#pw-chat-view')).toBeVisible();
  await expect(page.locator('#pw-chat-name')).toHaveText(friendName);
  await expect(page.locator('.pw-message-theirs').getByText('게임 중에도 바로 보여?')).toBeVisible();
  await friendContext.close();
});
