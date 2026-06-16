/**
 * @fileoverview 공통 버그리포트 위젯 QA — FAB/패널/토스트/제출/double-submit/빈입력 + 시각 검증.
 *   격리 포트 3092에 미리 기동된 런처를 대상으로 한다(사용자 3000 미접촉).
 *   POST /bug-report는 실제 bug-reports.jsonl에 append되므로 QA 종료 후 정리한다.
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3092';

test.describe('버그리포트 위젯 — 브라우저 인터랙션', () => {
  test('AC-5: FAB 표시 + 클릭 시 패널 펼침 + 외부 클릭 닫힘', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/matgo/`);

    const fab = page.locator('#bw-fab');
    await expect(fab).toBeVisible();
    await expect(fab).toHaveText('🐛');

    // 초기 패널 숨김
    await expect(page.locator('#bw-panel')).toBeHidden();

    // FAB 클릭 → 패널 표시
    await fab.click();
    await expect(page.locator('#bw-panel')).toBeVisible();
    // textarea 포커스
    await expect(page.locator('#bw-textarea')).toBeFocused();

    // 패널 외부(좌상단) 클릭 → 닫힘
    await page.mouse.click(20, 20);
    await expect(page.locator('#bw-panel')).toBeHidden();

    // 닫기 버튼으로도 닫힘
    await fab.click();
    await expect(page.locator('#bw-panel')).toBeVisible();
    await page.locator('#bw-close').click();
    await expect(page.locator('#bw-panel')).toBeHidden();

    expect(errors).toEqual([]);
  });

  test('AC-6/AC-7: 텍스트 제출 → 패널 접힘 + 토스트 + POST 발생', async ({ page }) => {
    let postCount = 0;
    let postBody = null;
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().endsWith('/bug-report')) {
        postCount += 1;
        postBody = req.postData();
      }
    });
    await page.goto(`${BASE}/omok/`);
    await page.locator('#bw-fab').click();
    await page.locator('#bw-textarea').fill('플레이라이트 제출 테스트 PW-SUBMIT');
    await page.locator('#bw-submit').click();

    // 토스트 표시
    await expect(page.locator('#bw-toast')).toBeVisible();
    await expect(page.locator('#bw-toast')).toHaveText('기록됨');
    // 패널 접힘
    await expect(page.locator('#bw-panel')).toBeHidden();

    expect(postCount).toBe(1);
    const parsed = JSON.parse(postBody);
    expect(parsed.text).toBe('플레이라이트 제출 테스트 PW-SUBMIT');
    expect(parsed.gameId).toBe('omok');
    expect(typeof parsed.timestamp).toBe('string');
    expect(parsed.screenSize).toHaveProperty('w');
    expect(parsed.url).toContain('/omok/');

    // 토스트 2초 후 사라짐
    await page.waitForTimeout(2200);
    await expect(page.locator('#bw-toast')).toBeHidden();
  });

  test('AC-8: 빈 텍스트(공백만) 제출 → POST 미발생', async ({ page }) => {
    let postCount = 0;
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().endsWith('/bug-report')) postCount += 1;
    });
    await page.goto(`${BASE}/yutnori/`);
    await page.locator('#bw-fab').click();
    await page.locator('#bw-textarea').fill('     ');
    await page.locator('#bw-submit').click();
    await page.waitForTimeout(500);
    expect(postCount).toBe(0);
    // 빈 입력이면 패널 유지(닫히지 않음)
    await expect(page.locator('#bw-panel')).toBeVisible();
  });

  test('AC-9: 제출 버튼 연속 더블클릭 → POST 1회만', async ({ page }) => {
    let postCount = 0;
    // 서버 응답을 잠시 지연시켜 disabled 가드를 강하게 검증
    await page.route('**/bug-report', async (route) => {
      postCount += 1;
      await new Promise((r) => setTimeout(r, 300));
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    await page.goto(`${BASE}/janggi/`);
    await page.locator('#bw-fab').click();
    await page.locator('#bw-textarea').fill('더블클릭 방지 테스트');
    const btn = page.locator('#bw-submit');
    // 빠른 2연타
    await btn.click();
    await btn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(800);
    expect(postCount).toBe(1);
  });

  test('AC-2: 게임 페이지에 위젯 스크립트 로드됨 (실제 로딩)', async ({ page }) => {
    let widgetJsLoaded = false;
    page.on('response', (r) => {
      if (r.url().endsWith('/bug-widget.js') && r.status() === 200) widgetJsLoaded = true;
    });
    await page.goto(`${BASE}/tetris-battle/`);
    await page.waitForTimeout(300);
    expect(widgetJsLoaded).toBe(true);
    await expect(page.locator('#bw-fab')).toBeVisible();
  });
});

test.describe('버그리포트 위젯 — 시각 검증', () => {
  test('FAB + 패널 펼침 스크린샷 (다크 배경 게임)', async ({ page }) => {
    await page.goto(`${BASE}/matgo/`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'tests/screenshots/bw-fab-matgo.png' });
    await page.locator('#bw-fab').click();
    await page.locator('#bw-textarea').fill('레이아웃 확인용 텍스트');
    await page.screenshot({ path: 'tests/screenshots/bw-panel-open.png' });
  });

  test('모바일 뷰포트 360px 렌더링', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto(`${BASE}/omok/`);
    await page.waitForTimeout(300);
    await page.locator('#bw-fab').click();
    await page.screenshot({ path: 'tests/screenshots/bw-mobile-360.png' });
    // 패널이 뷰포트 안에 들어오는지 (오른쪽 경계)
    const box = await page.locator('#bw-panel').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
  });
});
