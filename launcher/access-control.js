import crypto from 'node:crypto';

const COOKIE_NAME = 'minigame_session';
const LOGIN_PATH = '/_auth/login';
const LOGOUT_PATH = '/_auth/logout';
const MAX_LOGIN_BODY_BYTES = 8 * 1024;

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function parseCookies(header = '') {
  const cookies = new Map();
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) cookies.set(name, value);
  }
  return cookies;
}

function safeEqual(left, right) {
  const leftDigest = crypto.createHash('sha256').update(left).digest();
  const rightDigest = crypto.createHash('sha256').update(right).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function normalizeNext(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  if (raw.startsWith(LOGIN_PATH) || raw.startsWith(LOGOUT_PATH)) return '/';
  return raw;
}

function requestPath(req) {
  try {
    return new URL(req.url || '/', 'http://localhost').pathname;
  } catch {
    return '/';
  }
}

function loginPage({ error = '', next = '/' } = {}) {
  const errorMarkup = error
    ? `<p class="error" role="alert">${escapeHtml(error)}</p>`
    : '<p class="hint">허가된 사람만 접속할 수 있어요.</p>';
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>미니게임 천국 · 로그인</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, -apple-system, "Noto Sans KR", sans-serif; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; background: radial-gradient(circle at top, #293b78, #111529 55%); color: #f7f8ff; }
    main { width: min(100%, 390px); padding: 34px 28px; border: 1px solid #ffffff26; border-radius: 24px; background: #151b35e8; box-shadow: 0 24px 80px #0008; }
    .badge { display: inline-block; padding: 6px 10px; border-radius: 999px; background: #8b5cf633; color: #d8c7ff; font-size: 13px; font-weight: 700; }
    h1 { margin: 18px 0 8px; font-size: 29px; letter-spacing: -0.04em; }
    p { margin: 0 0 22px; color: #bdc6e6; line-height: 1.55; }
    .error { color: #ffb6b6; }
    label { display: block; margin-bottom: 8px; font-size: 14px; font-weight: 700; }
    input { width: 100%; min-height: 50px; padding: 0 15px; border: 1px solid #ffffff30; border-radius: 13px; background: #0c1125; color: white; font: inherit; outline: none; }
    input:focus { border-color: #a78bfa; box-shadow: 0 0 0 3px #8b5cf633; }
    .remember { display: flex; align-items: center; gap: 9px; margin-top: 13px; color: #cbd2eb; font-size: 14px; font-weight: 600; cursor: pointer; }
    .remember input { width: 18px; min-height: 18px; margin: 0; padding: 0; accent-color: #8b5cf6; }
    button { width: 100%; min-height: 50px; margin-top: 14px; border: 0; border-radius: 13px; background: linear-gradient(135deg, #8b5cf6, #6366f1); color: white; font: inherit; font-weight: 800; cursor: pointer; }
    button:hover { filter: brightness(1.08); }
  </style>
</head>
<body>
  <main>
    <span class="badge">PRIVATE ARCADE</span>
    <h1>미니게임 천국</h1>
    ${errorMarkup}
    <form method="post" action="${LOGIN_PATH}">
      <input type="hidden" name="next" value="${escapeHtml(normalizeNext(next))}">
      <label for="password">접속 비밀번호</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
      <label class="remember"><input name="remember" type="checkbox" value="1" checked> 이 브라우저에서 30일간 기억</label>
      <button type="submit">입장하기</button>
    </form>
  </main>
</body>
</html>`;
}

function sendHtml(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  res.end(body);
}

function redirect(res, location, cookie) {
  const headers = {
    Location: location,
    'Cache-Control': 'no-store',
    'Content-Length': '0',
  };
  if (cookie) headers['Set-Cookie'] = cookie;
  res.writeHead(303, headers);
  res.end();
}

/**
 * 환경변수 기반의 런처 공통 인증 계층을 만든다.
 * 비밀번호가 없으면 기존 LAN 동작을 유지하기 위해 완전히 비활성화된다.
 */
export function createAccessController({
  password = process.env.MINIGAME_PASSWORD || '',
  sessionSecret = process.env.MINIGAME_SESSION_SECRET || '',
  sessionTtlMs = 12 * 60 * 60 * 1000,
  rememberTtlMs = 30 * 24 * 60 * 60 * 1000,
  maxFailures = 5,
  blockMs = 15 * 60 * 1000,
  now = () => Date.now(),
  randomBytes = crypto.randomBytes,
} = {}) {
  const enabled = password.length > 0;
  const signingKey = crypto.createHash('sha256')
    .update(sessionSecret || `minigame-password:${password}`)
    .digest();
  const internalToken = randomBytes(32).toString('base64url');
  const attempts = new Map();

  function sign(value) {
    return crypto.createHmac('sha256', signingKey).update(value).digest('base64url');
  }

  function issueSession(ttlMs = sessionTtlMs) {
    const payload = `${now() + ttlMs}.${randomBytes(18).toString('base64url')}`;
    return `${payload}.${sign(payload)}`;
  }

  function verifySession(token) {
    if (typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const payload = `${parts[0]}.${parts[1]}`;
    if (!safeEqual(parts[2], sign(payload))) return false;
    const expiresAt = Number(parts[0]);
    return Number.isSafeInteger(expiresAt) && expiresAt > now();
  }

  function isInternalRequest(req) {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      return safeEqual(url.searchParams.get('_internal') || '', internalToken);
    } catch {
      return false;
    }
  }

  function isAuthorized(req) {
    if (!enabled || isInternalRequest(req)) return true;
    const token = parseCookies(req.headers.cookie).get(COOKIE_NAME);
    return verifySession(token);
  }

  function getSessionFingerprint(req) {
    if (!enabled || isInternalRequest(req)) return null;
    const token = parseCookies(req.headers.cookie).get(COOKIE_NAME);
    if (!verifySession(token)) return null;
    return crypto.createHash('sha256')
      .update(`minigame-presence:${token}`)
      .digest('base64url')
      .slice(0, 16);
  }

  function isWebSocketAuthorized(req) {
    if (!isAuthorized(req)) return false;
    if (!enabled || isInternalRequest(req) || !req.headers.origin) return true;
    try {
      const origin = new URL(req.headers.origin);
      return origin.host === req.headers.host;
    } catch {
      return false;
    }
  }

  function sourceKey(req) {
    const remoteAddress = req.socket?.remoteAddress || '';
    const isLoopbackProxy = remoteAddress === '127.0.0.1'
      || remoteAddress === '::1'
      || remoteAddress === '::ffff:127.0.0.1';
    if (isLoopbackProxy) {
      const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (forwardedFor) return forwardedFor;
    }
    return req.socket?.remoteAddress || 'unknown';
  }

  function rateState(req) {
    const key = sourceKey(req);
    const current = attempts.get(key);
    if (!current) return { key, blocked: false };
    if (current.blockedUntil > now()) return { key, blocked: true };
    if (current.blockedUntil || now() - current.firstFailure > blockMs) attempts.delete(key);
    return { key, blocked: false };
  }

  function registerFailure(key) {
    const current = attempts.get(key);
    const entry = current && now() - current.firstFailure <= blockMs
      ? current
      : { failures: 0, firstFailure: now(), blockedUntil: 0 };
    entry.failures += 1;
    if (entry.failures >= maxFailures) entry.blockedUntil = now() + blockMs;
    attempts.set(key, entry);
  }

  function secureCookie(req) {
    const forced = process.env.MINIGAME_COOKIE_SECURE;
    if (forced === '1' || forced === 'true') return true;
    if (forced === '0' || forced === 'false') return false;
    return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  }

  function sessionCookie(req, value, maxAgeSeconds) {
    const parts = [
      `${COOKIE_NAME}=${value}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      secureCookie(req) ? 'Secure' : '',
    ].filter(Boolean);
    if (Number.isFinite(maxAgeSeconds)) parts.push(`Max-Age=${maxAgeSeconds}`);
    return parts.join('; ');
  }

  function readLogin(req, res) {
    let body = '';
    let bytes = 0;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_LOGIN_BODY_BYTES) {
        res.writeHead(413, { 'Content-Length': '0', Connection: 'close' });
        res.end();
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      const params = new URLSearchParams(body);
      const next = normalizeNext(params.get('next'));
      const state = rateState(req);
      if (state.blocked) {
        res.setHeader('Retry-After', String(Math.ceil(blockMs / 1000)));
        sendHtml(res, 429, loginPage({ error: '로그인 시도가 너무 많아요. 잠시 뒤 다시 시도해 주세요.', next }));
        return;
      }
      if (!safeEqual(params.get('password') || '', password)) {
        registerFailure(state.key);
        sendHtml(res, 401, loginPage({ error: '비밀번호가 맞지 않습니다.', next }));
        return;
      }
      attempts.delete(state.key);
      const remember = params.get('remember') === '1';
      const ttlMs = remember ? rememberTtlMs : sessionTtlMs;
      redirect(res, next, sessionCookie(req, issueSession(ttlMs), remember ? Math.floor(ttlMs / 1000) : null));
    });
  }

  /**
   * 요청을 처리했으면 true를 반환한다. 인증된 일반 요청은 false로 원래 라우터에 넘긴다.
   */
  function handleHttp(req, res) {
    if (!enabled) return false;
    const path = requestPath(req);
    if (path === LOGIN_PATH && req.method === 'GET') {
      const url = new URL(req.url || LOGIN_PATH, 'http://localhost');
      sendHtml(res, 200, loginPage({ next: url.searchParams.get('next') }));
      return true;
    }
    if (path === LOGIN_PATH && req.method === 'POST') {
      readLogin(req, res);
      return true;
    }
    if (path === LOGOUT_PATH && req.method === 'POST') {
      redirect(res, LOGIN_PATH, sessionCookie(req, '', 0));
      return true;
    }
    if (isAuthorized(req)) return false;

    if (req.method === 'GET' || req.method === 'HEAD') {
      const next = normalizeNext(req.url || '/');
      redirect(res, `${LOGIN_PATH}?next=${encodeURIComponent(next)}`);
    } else {
      res.writeHead(401, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ error: 'authentication required' }));
    }
    return true;
  }

  return {
    enabled,
    internalToken,
    getSessionFingerprint,
    handleHttp,
    isAuthorized,
    isWebSocketAuthorized,
    issueSession,
    verifySession,
  };
}
