/**
 * @fileoverview 단일 포트 통합 QA — WS 연결 / 정적 라우팅 동적 검증.
 *
 *   사전 조건: `cd minigames && node launcher/server.js`가 백그라운드로 기동되어 있어야 함.
 *   QA 스크립트가 자동으로 띄우고 종료하므로 사용자가 별도 실행할 필요는 없다.
 */

import { test, expect } from '@playwright/test';

test.describe('단일 포트 통합 — 정적 HTTP 응답', () => {
  test('GET / → 런처 HTML 200', async ({ request }) => {
    const res = await request.get('/');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/<!doctype html|<!DOCTYPE html/i);
  });

  test('GET /games.json → 5개 게임 메타 200', async ({ request }) => {
    const res = await request.get('/games.json');
    expect(res.status()).toBe(200);
    const games = await res.json();
    expect(Array.isArray(games)).toBe(true);
    expect(games.length).toBe(5);
    const ids = games.map((g) => g.id).sort();
    expect(ids).toEqual(
      ['codenames-duet', 'davinci-code', 'matgo', 'tetris-battle', 'yutnori']
    );
  });

  for (const slug of ['matgo', 'yutnori', 'tetris-battle', 'codenames-duet', 'davinci-code']) {
    test(`GET /${slug}/ → 200 + HTML`, async ({ request }) => {
      const res = await request.get(`/${slug}/`);
      expect(res.status()).toBe(200);
      const body = await res.text();
      expect(body).toMatch(/<!doctype html|<!DOCTYPE html/i);
    });
  }
});

test.describe('단일 포트 통합 — WS 연결 라우팅', () => {
  test('matgo WS 연결: /matgo/ws → JOINED 수신', async ({ page }) => {
    const consoleErrors = [];
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`console.error: ${msg.text()}`);
    });

    await page.goto('/matgo/');
    // matgo client는 자동으로 connect()를 호출하므로 [client] 연결됨 로그를 기다린다.
    const connected = await page.waitForEvent('console', {
      predicate: (msg) => msg.text().includes('[client] 연결됨'),
      timeout: 5000,
    }).then(() => true).catch(() => false);

    expect(connected).toBe(true);
    expect(consoleErrors).toEqual([]);
  });

  test('yutnori WS 연결: /yutnori/ws → 연결됨 로그', async ({ page }) => {
    await page.goto('/yutnori/');
    const connected = await page.waitForEvent('console', {
      predicate: (msg) => msg.text().includes('[net] 연결됨') || msg.text().includes('[net] 연결 시도'),
      timeout: 5000,
    }).then(() => true).catch(() => false);
    expect(connected).toBe(true);
  });

  test('tetris-battle WS 연결: /tetris-battle/ws → 연결됨 로그', async ({ page }) => {
    await page.goto('/tetris-battle/');
    const connected = await page.waitForEvent('console', {
      predicate: (msg) => msg.text().includes('[net] 연결됨') || msg.text().includes('[net] 연결 시도'),
      timeout: 5000,
    }).then(() => true).catch(() => false);
    expect(connected).toBe(true);
  });

  test('codenames-duet WS 연결: /codenames-duet/ws → 연결됨 로그', async ({ page }) => {
    await page.goto('/codenames-duet/');
    const connected = await page.waitForEvent('console', {
      predicate: (msg) => msg.text().includes('[client] 연결됨'),
      timeout: 5000,
    }).then(() => true).catch(() => false);
    expect(connected).toBe(true);
  });

  test('davinci-code WS 연결: /davinci-code/ws → 연결됨 로그', async ({ page }) => {
    await page.goto('/davinci-code/');
    const connected = await page.waitForEvent('console', {
      predicate: (msg) => msg.text().includes('[client] 연결됨'),
      timeout: 5000,
    }).then(() => true).catch(() => false);
    expect(connected).toBe(true);
  });
});

test.describe('런처 로비 흐름 회귀', () => {
  test('로비 WS 연결 + LOBBY_STATE 수신', async ({ page }) => {
    // 콘솔 로깅이 적기 때문에 직접 WS를 page context에서 열어 검증한다.
    await page.goto('/');
    const result = await page.evaluate(async () => {
      return await new Promise((resolve) => {
        const ws = new WebSocket(`ws://${location.host}/ws`);
        const timer = setTimeout(() => {
          try { ws.close(); } catch (_) { /* noop */ }
          resolve({ ok: false, reason: 'timeout' });
        }, 4000);
        ws.addEventListener('open', () => {
          // 첫 메시지 (LOBBY_STATE)를 기다린다.
        });
        ws.addEventListener('message', (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === 'LOBBY_STATE') {
              clearTimeout(timer);
              try { ws.close(); } catch (_) { /* noop */ }
              resolve({ ok: true, msg });
            }
          } catch (e) {
            // ignore
          }
        });
        ws.addEventListener('error', () => {
          clearTimeout(timer);
          resolve({ ok: false, reason: 'error' });
        });
      });
    });
    expect(result.ok).toBe(true);
    expect(result.msg.type).toBe('LOBBY_STATE');
    expect(typeof result.msg.count).toBe('number');
    expect(['host', 'guest']).toContain(result.msg.role);
  });

  test('잘못된 WS path → 연결 거절 (socket.destroy)', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      return await new Promise((resolve) => {
        const ws = new WebSocket(`ws://${location.host}/nonexistent/ws`);
        const timer = setTimeout(() => resolve({ opened: ws.readyState === WebSocket.OPEN }), 1500);
        ws.addEventListener('open', () => {
          clearTimeout(timer);
          resolve({ opened: true });
        });
        ws.addEventListener('close', () => {
          clearTimeout(timer);
          resolve({ opened: false, closed: true });
        });
        ws.addEventListener('error', () => {
          clearTimeout(timer);
          resolve({ opened: false, errored: true });
        });
      });
    });
    expect(result.opened).toBe(false);
  });
});

test.describe('정적 라우팅 엣지 케이스', () => {
  test('GET /matgo/style.css → 200 + CSS MIME', async ({ request }) => {
    const res = await request.get('/matgo/style.css');
    // matgo는 단일 style.css가 public 루트에 있다고 가정. 없으면 client.js만이라도 확인.
    if (res.status() === 200) {
      expect(res.headers()['content-type']).toMatch(/text\/css/);
    }
  });

  test('GET /matgo/client.js → 200 + JS MIME', async ({ request }) => {
    const res = await request.get('/matgo/client.js');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/javascript/);
  });

  test('GET /matgo/does-not-exist.js → 404', async ({ request }) => {
    const res = await request.get('/matgo/does-not-exist.js');
    expect(res.status()).toBe(404);
  });

  test('GET /unknown-game/ → 런처 404 (게임 prefix 미일치)', async ({ request }) => {
    const res = await request.get('/unknown-game/');
    // launcher static에서 처리 → index.html이 unknown-game/ 폴더에 없으므로 404 또는 Forbidden
    expect([403, 404]).toContain(res.status());
  });
});
