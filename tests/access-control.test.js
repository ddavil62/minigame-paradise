import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createAccessController } from '../launcher/access-control.js';

async function withServer(controller, run) {
  const server = http.createServer((req, res) => {
    if (controller.handleHttp(req, res)) return;
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('protected');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

function form(password, next = '/', remember = false) {
  return new URLSearchParams({ password, next, ...(remember ? { remember: '1' } : {}) }).toString();
}

function sessionCookie(response) {
  return response.headers.get('set-cookie')?.split(';')[0] || '';
}

test('비밀번호가 없으면 기존 LAN 요청을 그대로 통과시킨다', async () => {
  const controller = createAccessController({ password: '' });
  assert.equal(controller.enabled, false);
  await withServer(controller, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/matgo/`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'protected');
  });
});

test('미인증 요청을 로그인으로 보내고 올바른 비밀번호로 세션을 발급한다', async () => {
  const controller = createAccessController({ password: 'correct horse battery staple' });
  await withServer(controller, async (baseUrl) => {
    const denied = await fetch(`${baseUrl}/matgo/?mode=ai`, { redirect: 'manual' });
    assert.equal(denied.status, 303);
    assert.equal(denied.headers.get('location'), '/_auth/login?next=%2Fmatgo%2F%3Fmode%3Dai');

    const login = await fetch(`${baseUrl}/_auth/login`, {
      method: 'POST',
      body: form('correct horse battery staple', '/matgo/?mode=ai'),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    });
    assert.equal(login.status, 303);
    assert.equal(login.headers.get('location'), '/matgo/?mode=ai');
    assert.match(login.headers.get('set-cookie') || '', /HttpOnly/);
    assert.match(login.headers.get('set-cookie') || '', /SameSite=Strict/);

    const allowed = await fetch(`${baseUrl}/matgo/?mode=ai`, {
      headers: { Cookie: sessionCookie(login) },
    });
    assert.equal(allowed.status, 200);
    assert.equal(await allowed.text(), 'protected');
  });
});

test('위조되거나 만료된 세션은 거부한다', async () => {
  let clock = 1_000_000;
  const controller = createAccessController({
    password: 'secret',
    sessionTtlMs: 1_000,
    now: () => clock,
    randomBytes: (length) => Buffer.alloc(length, 7),
  });
  const token = controller.issueSession();
  assert.equal(controller.verifySession(token), true);
  assert.equal(controller.verifySession(`${token.slice(0, -1)}x`), false);
  clock += 1_001;
  assert.equal(controller.verifySession(token), false);
});

test('기억하기를 선택하면 HTTPS 전용 30일 쿠키를 발급한다', async () => {
  const controller = createAccessController({ password: 'secret' });
  await withServer(controller, async (baseUrl) => {
    const login = await fetch(`${baseUrl}/_auth/login`, {
      method: 'POST',
      body: form('secret', '/', true),
      headers: { 'X-Forwarded-Proto': 'https' },
      redirect: 'manual',
    });
    const cookie = login.headers.get('set-cookie') || '';
    assert.match(cookie, /Max-Age=2592000/);
    assert.match(cookie, /Secure/);
  });
});

test('외부에서 알 수 없는 내부 토큰만 AI WebSocket 우회에 사용할 수 있다', () => {
  const controller = createAccessController({
    password: 'secret',
    randomBytes: (length) => Buffer.alloc(length, 9),
  });
  const makeRequest = (url) => ({ url, headers: {}, socket: { remoteAddress: '127.0.0.1' } });
  assert.equal(controller.isAuthorized(makeRequest('/matgo/ws?mode=bot')), false);
  assert.equal(controller.isAuthorized(makeRequest(`/matgo/ws?mode=bot&_internal=${controller.internalToken}`)), true);
});

test('브라우저 WebSocket은 로그인 쿠키와 같은 호스트 Origin을 모두 요구한다', () => {
  const controller = createAccessController({ password: 'secret' });
  const token = controller.issueSession();
  const request = {
    url: '/lobby/ws?gameId=matgo',
    headers: {
      cookie: `minigame_session=${token}`,
      host: 'games.example.test',
      origin: 'https://games.example.test',
    },
  };
  assert.equal(controller.isWebSocketAuthorized(request), true);
  request.headers.origin = 'https://attacker.example';
  assert.equal(controller.isWebSocketAuthorized(request), false);
});

test('presence identity is stable per valid login session without exposing the token', () => {
  const controller = createAccessController({ password: 'secret' });
  const firstToken = controller.issueSession();
  const secondToken = controller.issueSession();
  const request = (token) => ({
    url: '/presence/ws',
    headers: { cookie: `minigame_session=${token}` },
  });
  const first = controller.getSessionFingerprint(request(firstToken));
  assert.equal(first, controller.getSessionFingerprint(request(firstToken)));
  assert.notEqual(first, controller.getSessionFingerprint(request(secondToken)));
  assert.equal(controller.getSessionFingerprint(request('invalid')), null);
  assert.equal(first.includes(firstToken), false);
});

test('연속 로그인 실패를 제한하고 Retry-After를 반환한다', async () => {
  let clock = 10_000;
  const controller = createAccessController({
    password: 'secret',
    maxFailures: 2,
    blockMs: 60_000,
    now: () => clock,
  });
  await withServer(controller, async (baseUrl) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const failed = await fetch(`${baseUrl}/_auth/login`, {
        method: 'POST',
        body: form('wrong'),
      });
      assert.equal(failed.status, 401);
    }
    const blocked = await fetch(`${baseUrl}/_auth/login`, {
      method: 'POST',
      body: form('secret'),
    });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('retry-after'), '60');

    clock += 60_001;
    const recovered = await fetch(`${baseUrl}/_auth/login`, {
      method: 'POST',
      body: form('secret'),
      redirect: 'manual',
    });
    assert.equal(recovered.status, 303);
  });
});
