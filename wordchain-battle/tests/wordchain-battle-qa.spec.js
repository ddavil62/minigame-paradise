/**
 * @fileoverview 끝말잇기 배틀의 순수 로직, WebSocket 프로토콜, 2인 UI를 공격적으로 검증한다.
 */
import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import {
  createGame, submitWord, applyTimerExpiry, isGameOver,
} from '../game.js';
import { matchesStartChar, buildGarbageCandidates, loadWords } from '../words.js';
import { createApp } from '../server.js';

const dictionary = loadWords();
const candidates = buildGarbageCandidates(50);
const words = JSON.parse(fs.readFileSync(new URL('../data/words.json', import.meta.url), 'utf8')).words;

/** 사용 가능한 두 단어짜리 동일 초성 묶음을 찾는다. */
function sameInitialWords(count = 12) {
  const groups = new Map();
  for (const word of words) {
    const key = word[0];
    const group = groups.get(key) || [];
    group.push(word);
    groups.set(key, group);
    if (group.length >= count) return group;
  }
  throw new Error('테스트 단어 묶음을 찾지 못했다.');
}

/** 지정한 끝 글자와 다른 초성의 사전 단어를 찾는다. */
function wrongStartWord(required) {
  return words.find((word) => !matchesStartChar(word[0], required));
}

/** 지정 초성에서 이어지는 5글자 이상 단어 체인을 찾는다. */
function longChain(required, count) {
  const result = [];
  let current = required;
  for (let index = 0; index < count; index += 1) {
    const next = words.find((word) => word.length >= 5 && matchesStartChar(word[0], current) && !result.includes(word));
    if (!next) throw new Error(`${current} 장문 체인을 찾지 못했다.`);
    result.push(next);
    current = next.at(-1);
  }
  return result;
}

/** 메시지 큐를 갖는 테스트 WebSocket을 생성한다. */
async function openClient(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const queue = [];
  const seen = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    seen.push(msg);
    const index = waiters.findIndex((waiter) => waiter.type === msg.type);
    if (index >= 0) waiters.splice(index, 1)[0].resolve(msg);
    else queue.push(msg);
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return {
    ws,
    seen,
    send(payload) { ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload)); },
    wait(type, timeout = 8_000) {
      const index = queue.findIndex((msg) => msg.type === type);
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        let waiter;
        const timer = setTimeout(() => {
          // 만료된 대기자가 이후 메시지를 가로채지 않도록 큐에서도 제거한다.
          const waiterIndex = waiters.indexOf(waiter);
          if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
          reject(new Error(`${type} 대기 시간 초과`));
        }, timeout);
        waiter = { type, resolve: (msg) => { clearTimeout(timer); resolve(msg); } };
        waiters.push(waiter);
      });
    },
    close() { ws.close(); },
  };
}

/**
 * 원문 경로를 정규화하지 않고 HTTP 서버에 요청한다.
 * @param {number} port 대상 포트
 * @param {string} requestPath 원본 요청 경로
 * @returns {Promise<{status: number, contentType: string, body: string}>} HTTP 응답
 */
async function requestRawPath(port, requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: requestPath, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        contentType: res.headers['content-type'] || '',
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * 통합 런처 테스트에 사용할 비어 있는 포트를 예약 없이 조회한다.
 * @returns {Promise<number>} 비어 있는 로컬 포트
 */
async function findFreePort() {
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/**
 * 통합 런처 프로세스가 HTTP 요청을 받을 때까지 기다린다.
 * @param {number} port 통합 런처 포트
 * @param {import('node:child_process').ChildProcess} child 런처 프로세스
 * @returns {Promise<void>}
 */
async function waitForLauncher(port, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`통합 런처 조기 종료: ${child.exitCode}`);
    try {
      const response = await requestRawPath(port, '/wordchain-battle/');
      if (response.status === 200) return;
    } catch (_) {
      // 프로세스가 listen을 시작하기 전 연결 거절은 재시도한다.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('통합 런처 시작 시간 초과');
}

/** 임의 포트에 실제 HTTP/WS 서버를 연다. */
async function startServer() {
  const app = createApp({ hostUrl: '' });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

test.describe('순수 서버 로직', () => {
  test('유효/무효/중복/잘못된 시작과 게이지를 판정한다', () => {
    const game = createGame('A', 'B');
    game.phase = 'playing';
    const [first, second] = sameInitialWords(2);
    expect(submitWord(game, 'p1', 'abc', dictionary, candidates).reason).toBe('not_korean');
    expect(submitWord(game, 'p1', '가나다라마바사아자차카타파하하하', dictionary, candidates).reason).toBe('invalid');
    const accepted = submitWord(game, 'p1', first, dictionary, candidates);
    expect(accepted.ok).toBe(true);
    expect(submitWord(game, 'p2', first, dictionary, candidates).reason).toBe('duplicate');
    const wrong = wrongStartWord(first.at(-1));
    expect(submitWord(game, 'p1', wrong, dictionary, candidates).reason).toBe('wrong_start');
    expect(game.players.p1.gauge).toBeGreaterThan(0);
    expect(second).toBeTruthy();
  });

  test('두음법칙은 명세 방향만 허용해야 한다', () => {
    expect(matchesStartChar('나', '라')).toBe(true);
    expect(matchesStartChar('야', '랴')).toBe(true);
    // 역방향 적용은 표준 두음법칙과 명세의 변환표 방향에 어긋난다.
    expect(matchesStartChar('라', '나')).toBe(false);
    expect(matchesStartChar('랴', '야')).toBe(false);
  });

  test('가비지 공격, 강제 초성, HP 0 즉시 종료를 처리한다', () => {
    const game = createGame('A', 'B');
    game.phase = 'playing';
    const pool = sameInitialWords(12);
    for (let index = 0; index < 10; index += 1) {
      game.players.p1.gauge = 85;
      game.players.p1.lastSyllable = null;
      const result = submitWord(game, 'p1', pool[index], dictionary, candidates);
      expect(result.ok).toBe(true);
      expect(result.garbageFired).toBe(true);
      expect(result.garbageChar).toBeTruthy();
      expect(game.players.p2.forced).toBe(result.garbageChar);
    }
    expect(game.players.p2.hp).toBe(0);
    expect(isGameOver(game)).toMatchObject({ ended: true, winner: 'p1', loser: 'p2' });
  });

  test('가비지 대응 여부를 성공 결과에 기록하고 거부 시 forced를 보존한다', () => {
    const regularGame = createGame('A', 'B');
    regularGame.phase = 'playing';
    const regularWord = words[0];
    expect(submitWord(regularGame, 'p1', regularWord, dictionary, candidates).wasGarbage).toBe(false);

    const forcedGame = createGame('A', 'B');
    forcedGame.phase = 'playing';
    const forcedWord = words.find((word) => word !== regularWord);
    forcedGame.players.p1.forced = forcedWord[0];
    const rejected = wrongStartWord(forcedWord[0]);
    expect(submitWord(forcedGame, 'p1', rejected, dictionary, candidates).ok).toBe(false);
    expect(forcedGame.players.p1.forced).toBe(forcedWord[0]);
    expect(submitWord(forcedGame, 'p1', forcedWord, dictionary, candidates).wasGarbage).toBe(true);
    expect(forcedGame.players.p1.forced).toBeNull();
  });

  test('타임아웃 누적 피해가 음수 없이 HP 0에서 끝난다', () => {
    const game = createGame('A', 'B');
    for (let index = 0; index < 21; index += 1) applyTimerExpiry(game, 'p1');
    expect(game.players.p1.hp).toBe(0);
    expect(isGameOver(game).ended).toBe(true);
  });
});

test.describe('실제 WebSocket 프로토콜', () => {
  test('카운트다운 재접속은 새 3초 세대만 PLAYING으로 전환한다', async () => {
    const { server, port } = await startServer();
    const p1 = await openClient(port);
    let p2 = await openClient(port);
    try {
      await p1.wait('JOINED'); await p2.wait('JOINED');
      p1.send({ type: 'JOIN', name: 'A' });
      p2.send({ type: 'JOIN', name: 'B' });
      await p1.wait('GAME_START'); await p2.wait('GAME_START');
      await new Promise((resolve) => setTimeout(resolve, 500));
      p2.close();
      await p1.wait('OPPONENT_LEFT');

      p2 = await openClient(port);
      await p2.wait('JOINED');
      p2.send({ type: 'JOIN', name: 'B2' });
      await p1.wait('GAME_START');
      const restartedAt = Date.now();
      await p2.wait('GAME_START');
      await expect(p2.wait('PLAYING', 2_600)).rejects.toThrow('시간 초과');
      await p2.wait('PLAYING', 1_000);
      expect(Date.now() - restartedAt).toBeGreaterThanOrEqual(2_800);
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(p2.seen.filter((msg) => msg.type === 'PLAYING')).toHaveLength(1);
      expect(p1.seen.filter((msg) => msg.type === 'PLAYING')).toHaveLength(1);
    } finally {
      p1.close(); p2.close();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('두 플레이어가 모두 JOIN하기 전에는 게임을 시작하지 않는다', async () => {
    const { server, port } = await startServer();
    const p1 = await openClient(port);
    const p2 = await openClient(port);
    try {
      await p1.wait('JOINED');
      await p2.wait('JOINED');
      p1.send({ type: 'JOIN', name: '먼저 참가' });
      await expect(p1.wait('GAME_START', 400)).rejects.toThrow('대기 시간 초과');
      p2.send({ type: 'JOIN', name: '나중 참가' });
      await p1.wait('GAME_START');
      await p2.wait('GAME_START');
    } finally {
      p1.close(); p2.close();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('두 클라이언트, 연타, 비정상 메시지, 리매치를 서버 권위로 처리한다', async () => {
    const { server, port } = await startServer();
    const p1 = await openClient(port);
    const p2 = await openClient(port);
    try {
      await p1.wait('JOINED');
      await p2.wait('JOINED');
      p1.send('{broken json');
      p1.send({ hello: 'missing type' });
      p1.send({ type: 'WORD_SUBMIT', word: '가가' });
      expect((await p1.wait('ERROR')).type).toBe('ERROR');
      p1.send({ type: 'JOIN', name: '<script>alert(1)</script>' });
      p2.send({ type: 'JOIN', name: 'B' });
      await p1.wait('GAME_START');
      await p2.wait('GAME_START');
      await p1.wait('PLAYING');
      await p2.wait('PLAYING');

      const first = words[0];
      p1.send({ type: 'WORD_SUBMIT', word: first });
      p1.send({ type: 'WORD_SUBMIT', word: first });
      expect((await p1.wait('WORD_ACCEPTED')).word).toBe(first);
      expect((await p1.wait('WORD_REJECTED')).reason).toBe('duplicate');

      p1.send({ type: 'RESIGN' });
      expect((await p1.wait('GAME_OVER')).winner).toBe('p2');
      await p2.wait('GAME_OVER');
      p1.send({ type: 'REMATCH' });
      expect((await p1.wait('REMATCH_WAITING')).ready).toEqual(['p1']);
      p1.send({ type: 'REMATCH' });
      expect((await p1.wait('REMATCH_WAITING')).ready).toEqual(['p1']);
      p2.send({ type: 'REMATCH' });
      await p1.wait('REMATCH_START');
      await p2.wait('REMATCH_START');
      await p1.wait('GAME_START');
      await p2.wait('GAME_START');
    } finally {
      p1.close();
      p2.close();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('세 번째 접속은 정원 초과로 거절한다', async () => {
    const { server, port } = await startServer();
    const p1 = await openClient(port);
    const p2 = await openClient(port);
    const p3 = await openClient(port);
    try {
      expect((await p3.wait('ERROR')).type).toBe('ERROR');
    } finally {
      p1.close(); p2.close(); p3.close();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('실제 20초 타임아웃이 양쪽에 5 HP 피해를 방송한다', async () => {
    const { server, port } = await startServer();
    const p1 = await openClient(port);
    const p2 = await openClient(port);
    try {
      await p1.wait('JOINED'); await p2.wait('JOINED');
      p1.send({ type: 'JOIN', name: 'A' });
      p2.send({ type: 'JOIN', name: 'B' });
      await p1.wait('GAME_START'); await p2.wait('GAME_START');
      await p1.wait('PLAYING'); await p2.wait('PLAYING');
      // PLAYING 직후의 초기 스냅샷(HP 100)을 먼저 소비한다.
      await p1.wait('STATE');
      const expired = await p1.wait('TIMER_EXPIRED', 25_000);
      expect(expired).toMatchObject({ hpLoss: 5, newHp: 95 });
      const state = await p1.wait('STATE');
      expect(state.players.find((player) => player.id === expired.playerId).hp).toBe(95);
    } finally {
      p1.close(); p2.close();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

test.describe('정적 파일 경로 격리', () => {
  const escapePaths = [
    '/../server.js',
    '/%2e%2e/server.js',
    '/assets/../server.js',
    '/assets/%2e%2e/server.js',
    '/assets/%2E%2E%2Fserver.js',
    '/assets/%2e%2e%5cserver.js',
  ];

  test('단독 서버는 정상 파일만 제공하고 경로 이탈을 거부한다', async () => {
    const { server, port } = await startServer();
    try {
      expect((await requestRawPath(port, '/')).status).toBe(200);
      expect((await requestRawPath(port, '/js/main.js')).contentType).toContain('javascript');
      expect((await requestRawPath(port, '/assets/key-art.svg')).contentType).toContain('image/svg+xml');
      for (const requestPath of escapePaths) {
        const response = await requestRawPath(port, requestPath);
        expect([403, 404]).toContain(response.status);
        expect(response.body).not.toContain('@fileoverview');
      }
      expect((await requestRawPath(port, '/assets/%zz.svg')).status).toBe(400);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('통합 런처도 동일한 경로 이탈 요청을 게임 루트 밖으로 전달하지 않는다', async () => {
    const port = await findFreePort();
    const child = spawn(process.execPath, ['launcher/server.js', '--port', String(port)], {
      cwd: new URL('../..', import.meta.url),
      stdio: 'ignore',
    });
    try {
      await waitForLauncher(port, child);
      expect((await requestRawPath(port, '/wordchain-battle/')).status).toBe(200);
      expect((await requestRawPath(port, '/wordchain-battle/js/main.js')).status).toBe(200);
      expect((await requestRawPath(port, '/wordchain-battle/assets/key-art.svg')).status).toBe(200);
      for (const requestPath of escapePaths) {
        const response = await requestRawPath(port, `/wordchain-battle${requestPath}`);
        expect([403, 404]).toContain(response.status);
        expect(response.body).not.toContain('@fileoverview');
      }
      expect((await requestRawPath(port, '/wordchain-battle/assets/%zz.svg')).status).toBe(400);
    } finally {
      child.kill();
      await new Promise((resolve) => child.once('exit', resolve));
    }
  });
});

test('모바일 두 브라우저 동시 플레이 UI와 콘솔을 검증한다', async ({ browser }) => {
  const { server, port } = await startServer();
  const context1 = await browser.newContext({ viewport: { width: 360, height: 640 } });
  const context2 = await browser.newContext({ viewport: { width: 360, height: 640 } });
  const page1 = await context1.newPage();
  const page2 = await context2.newPage();
  const errors = [];
  for (const page of [page1, page2]) {
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  }
  try {
    await Promise.all([
      page1.goto(`http://127.0.0.1:${port}/?name=모바일1`),
      page2.goto(`http://127.0.0.1:${port}/?name=모바일2`),
    ]);
    await expect(page1.locator('#game-screen')).toHaveClass(/active/, { timeout: 8_000 });
    await expect(page2.locator('#game-screen')).toHaveClass(/active/, { timeout: 8_000 });
    await expect(page1.locator('#word-input')).toBeEnabled({ timeout: 8_000 });
    expect(await page1.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }))).toEqual({ w: 360, h: 640 });
    // 입력 활성화 직후의 동기 상태를 검사해 0.5초 race를 eventual assertion이 가리지 않게 한다.
    expect(await page1.locator('#countdown-overlay').getAttribute('class')).toContain('hidden');
    await page1.screenshot({ path: 'tests/screenshots/qa-mobile-overlay-race.png', fullPage: true });
    await page1.screenshot({ path: 'tests/screenshots/qa-mobile-two-player.png', fullPage: true });

    await page1.locator('#word-input').fill(words[0]);
    await page1.locator('#submit-btn').dblclick();
    await expect(page1.locator('#chain-me li')).toHaveCount(1);
    // 첫 클릭이 입력을 비우므로 두 번째 클릭은 서버 요청 없이 안전하게 무시된다.
    await expect(page1.locator('#feedback')).toHaveText('');
    await page1.screenshot({ path: 'tests/screenshots/qa-mobile-rapid-submit.png', fullPage: true });

    await page2.evaluate(() => {
      window.__qaHpMutations = [];
      const text = document.querySelector('#hp-text-me');
      const bar = document.querySelector('#hp-me');
      const record = () => window.__qaHpMutations.push({
        text: text ? text.textContent : null,
        width: bar ? bar.style.width : null,
      });
      record();
      new MutationObserver(record).observe(text, { childList: true, characterData: true, subtree: true });
      new MutationObserver(record).observe(bar, { attributes: true, attributeFilter: ['style', 'class'] });
    });

    const chain = longChain(words[0].at(-1), 2);
    for (const [index, word] of chain.entries()) {
      await page1.locator('#word-input').fill(word);
      await page1.locator('#submit-btn').click();
      await expect(page1.locator('#chain-me li')).toHaveCount(index + 2);
    }
    await expect(page2.locator('#garbage-popup')).not.toHaveClass(/hidden/);
    await expect(page2.locator('#hp-text-me')).toHaveText('90');
    const mobilePopupBox = await page2.locator('#garbage-popup').boundingBox();
    const mobileInputBox = await page2.locator('.input-area').boundingBox();
    expect(mobilePopupBox.y).toBeGreaterThanOrEqual(mobileInputBox.y + mobileInputBox.height + 4);
    expect(mobilePopupBox.y + mobilePopupBox.height).toBeLessThanOrEqual(640 - 4);
    expect(await page2.locator('#garbage-popup').evaluate((element) => (
      getComputedStyle(element).bottom
    ))).toBe('16px');
    const hpMutations = await page2.evaluate(() => window.__qaHpMutations);
    expect(hpMutations.length).toBeGreaterThan(0);
    expect(hpMutations.every(({ text, width }) => /^\d+$/.test(text) && /^\d+(?:\.\d+)?%$/.test(width))).toBe(true);
    const forcedLabel = await page2.locator('#start-char').textContent();
    const forcedChar = forcedLabel.replace(/^☄\s*/, '').trim();
    const usedInScenario = new Set([words[0], ...chain]);
    const garbageResponse = words.find((word) => (
      matchesStartChar(word[0], forcedChar) && !usedInScenario.has(word)
    ));
    expect(garbageResponse).toBeTruthy();
    await page2.locator('#word-input').fill(garbageResponse);
    await page2.locator('#submit-btn').click();
    await expect(page2.locator('#chain-me li').last()).toHaveClass(/garbage-word/);
    await expect(page1.locator('#chain-opp li').last()).toHaveClass(/garbage-word/);
    // fadeIn 첫 프레임의 낮은 opacity가 승인 캡처를 흐리지 않도록 전환 종료 후 기록한다.
    await page2.waitForTimeout(350);
    await page2.screenshot({ path: 'tests/screenshots/qa-mobile-garbage.png', fullPage: true });
    await page1.setViewportSize({ width: 800, height: 640 });
    expect(await page1.locator('#garbage-popup').evaluate((element) => (
      getComputedStyle(element).top
    ))).toBe('128px');
    await page1.screenshot({ path: 'tests/screenshots/qa-desktop-playing.png', fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await context1.close();
    await context2.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
