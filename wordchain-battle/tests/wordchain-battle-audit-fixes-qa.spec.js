/**
 * @fileoverview 통합 감사 후속 수정의 상태 경쟁, 경로 격리, 서버 권위 이벤트를 공격 검증한다.
 */
import { test, expect } from '@playwright/test';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

/** 임의 포트에 실제 HTTP/WS 서버를 연다. */
async function startServer() {
  const app = createApp({ hostUrl: '' });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

/** 메시지 이력과 타입별 대기 큐를 갖는 테스트 클라이언트를 연다. */
async function openClient(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const queue = [];
  const seen = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    seen.push(message);
    const waiterIndex = waiters.findIndex((waiter) => waiter.type === message.type);
    if (waiterIndex >= 0) waiters.splice(waiterIndex, 1)[0].resolve(message);
    else queue.push(message);
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return {
    seen,
    send(payload) { ws.send(JSON.stringify(payload)); },
    wait(type, timeout = 8_000) {
      const queuedIndex = queue.findIndex((message) => message.type === type);
      if (queuedIndex >= 0) return Promise.resolve(queue.splice(queuedIndex, 1)[0]);
      return new Promise((resolve, reject) => {
        let waiter;
        const timer = setTimeout(() => {
          const waiterIndex = waiters.indexOf(waiter);
          if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
          reject(new Error(`${type} 대기 시간 초과`));
        }, timeout);
        waiter = { type, resolve: (message) => { clearTimeout(timer); resolve(message); } };
        waiters.push(waiter);
      });
    },
    close() { ws.close(); },
  };
}

/** HTTP 클라이언트의 URL 정규화를 거치지 않고 지정 경로를 요청한다. */
async function requestRawPath(port, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: requestPath }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

/** 통합 런처 테스트용 빈 포트를 찾는다. */
async function findFreePort() {
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/** 통합 런처가 실제 요청을 받을 때까지 짧게 폴링한다. */
async function waitForLauncher(port, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`통합 런처 조기 종료: ${child.exitCode}`);
    try {
      if ((await requestRawPath(port, '/wordchain-battle/')).status === 200) return;
    } catch (_) {
      // listen 이전의 연결 거절은 정상적인 준비 상태다.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('통합 런처 시작 시간 초과');
}

/** 지정 끝 글자에서 이어지는 사용하지 않은 장문 체인을 찾는다. */
test.describe('카운트다운 세대 격리', () => {
  test('반복 이탈 뒤 마지막 JOIN부터 3초 후 PLAYING을 한 번만 방송한다', async () => {
    const { server, port } = await startServer();
    const p1 = await openClient(port);
    let p2 = await openClient(port);
    try {
      await p1.wait('JOINED');
      await p2.wait('JOINED');
      p1.send({ type: 'JOIN', name: '고정 플레이어' });
      p2.send({ type: 'JOIN', name: '이탈 0' });
      await p1.wait('GAME_START');
      await p2.wait('GAME_START');

      // 여러 stale timeout의 만료 시점을 서로 가깝게 만들어 세대 검사가 모두 막는지 확인한다.
      for (let cycle = 1; cycle <= 3; cycle += 1) {
        await new Promise((resolve) => setTimeout(resolve, 180));
        p2.close();
        await p1.wait('OPPONENT_LEFT');
        p2 = await openClient(port);
        await p2.wait('JOINED');
        p2.send({ type: 'JOIN', name: `이탈 ${cycle}` });
        await p1.wait('GAME_START');
        await p2.wait('GAME_START');
      }

      const finalCountdownAt = Date.now();
      await expect(p2.wait('PLAYING', 2_700)).rejects.toThrow('시간 초과');
      await p2.wait('PLAYING', 800);
      expect(Date.now() - finalCountdownAt).toBeGreaterThanOrEqual(2_800);
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(p1.seen.filter((message) => message.type === 'PLAYING')).toHaveLength(1);
      expect(p2.seen.filter((message) => message.type === 'PLAYING')).toHaveLength(1);
    } finally {
      p1.close();
      p2.close();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
test.describe('정적 경로 우회 공격', () => {
  const traversalPaths = [
    '/assets/../server.js',
    '/assets/%2e%2e/server.js',
    '/assets/.%2e/server.js',
    '/assets/%2e./server.js',
    '/assets/%2E%2E%2Fserver.js',
    '/assets/%2e%2e%5cserver.js',
    '/assets/..\\server.js',
    '/assets/foo/../../server.js',
    '/assets/%00../server.js',
    '/assets/%252e%252e/server.js',
    '/assets/%252e%252e%252fserver.js',
    '/assets/%c0%ae%c0%ae/server.js',
  ];

  /** 정상 파일과 모든 공격 변형을 한 서버 진입점에서 검증한다. */
  async function assertPathIsolation(port, prefix = '') {
    expect((await requestRawPath(port, `${prefix}/`)).status).toBe(200);
    expect((await requestRawPath(port, `${prefix}/js/main.js`)).status).toBe(200);
    expect((await requestRawPath(port, `${prefix}/assets/key-art.svg`)).status).toBe(200);
    for (const attackPath of traversalPaths) {
      const response = await requestRawPath(port, `${prefix}${attackPath}`);
      expect([400, 403, 404], `${attackPath} status`).toContain(response.status);
      expect(response.body, `${attackPath} body`).not.toContain('@fileoverview');
      expect(response.body, `${attackPath} body`).not.toContain('createApp(opts');
    }
  }

  test('단독 서버가 NUL·역슬래시·이중 인코딩까지 루트 밖으로 전달하지 않는다', async () => {
    const { server, port } = await startServer();
    try {
      await assertPathIsolation(port);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('통합 런처가 동일한 공격 변형을 미니게임 루트 밖으로 전달하지 않는다', async () => {
    const port = await findFreePort();
    const child = spawn(process.execPath, ['launcher/server.js', '--port', String(port)], {
      cwd: new URL('../..', import.meta.url),
      stdio: 'ignore',
    });
    try {
      await waitForLauncher(port, child);
      await assertPathIsolation(port, '/wordchain-battle');
    } finally {
      child.kill();
      await new Promise((resolve) => child.once('exit', resolve));
    }
  });
});
