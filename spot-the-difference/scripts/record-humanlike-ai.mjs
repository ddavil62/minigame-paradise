/**
 * 내부 테스트 전용: 실제 WebSocket 경기에 두 브라우저 AI를 접속시키고,
 * 망설임/재탐색/오답을 포함한 사람다운 플레이를 1280x720 영상으로 녹화한다.
 * 제품 UI나 런처에는 이 모드를 노출하지 않는다.
 */
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { createApp } from '../server.js';

const projectRoot = path.resolve(import.meta.dirname, '..');
const outputDir = path.join(projectRoot, 'tests', 'videos');
const webmPath = path.join(outputDir, 'humanlike-ai-demo-1280x720.webm');
const mp4Path = path.join(outputDir, 'humanlike-ai-demo-1280x720.mp4');
const posterPath = path.join(outputDir, 'humanlike-ai-demo-poster.png');
await fs.mkdir(outputDir, { recursive: true });

let randomState = 0x51f15e;
function random() {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return randomState / 0x1_0000_0000;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const currentPosition = new WeakMap();

async function installRecorderOverlay(page) {
  await page.evaluate(() => {
    const badge = document.createElement('div');
    badge.id = 'internal-ai-badge';
    badge.innerHTML = '<strong>INTERNAL AI PLAYTEST</strong><span>사람처럼 탐색하는 AI 2명</span>';
    Object.assign(badge.style, {
      position: 'fixed', top: '12px', left: '50%', zIndex: '40', transform: 'translateX(-50%)',
      display: 'grid', gap: '1px', padding: '7px 14px', border: '1px solid #ffffff30', borderRadius: '12px',
      background: '#03131de8', color: '#fff4d6', textAlign: 'center', font: '700 11px system-ui',
      letterSpacing: '.08em', boxShadow: '0 8px 24px #0008', pointerEvents: 'none'
    });
    badge.querySelector('span').style.cssText = 'color:#49c9be;font-size:10px;letter-spacing:0';
    document.body.appendChild(badge);

    const thought = document.createElement('div');
    thought.id = 'internal-ai-thought';
    Object.assign(thought.style, {
      position: 'fixed', left: '20px', bottom: '18px', zIndex: '40', maxWidth: '430px', padding: '9px 14px',
      border: '1px solid #ffffff26', borderRadius: '14px', background: '#03131de8', color: '#fff4d6',
      font: '800 13px system-ui', boxShadow: '0 8px 24px #0008', opacity: '0', transition: 'opacity .2s ease',
      pointerEvents: 'none'
    });
    document.body.appendChild(thought);

    window.__internalAiThought = (text) => {
      thought.textContent = text;
      thought.style.opacity = text ? '1' : '0';
    };
    window.__internalAiCursor = (image, x, y) => {
      const layer = document.querySelector(`.picture[data-image="${image}"] .cursors`);
      if (!layer) return;
      let cursor = document.querySelector('.demo-self-cursor');
      if (cursor && cursor.parentElement !== layer) { cursor.remove(); cursor = null; }
      if (!cursor) {
        cursor = document.createElement('span');
        cursor.className = 'remote-cursor p1 demo-self-cursor';
        const label = document.createElement('span');
        label.className = 'remote-cursor-label';
        label.textContent = 'AI 나침반';
        cursor.appendChild(label);
        layer.appendChild(cursor);
      } else if (cursor.dataset.x && cursor.dataset.y) {
        const trail = document.createElement('span');
        trail.className = 'cursor-trail p1';
        trail.style.left = `${Number(cursor.dataset.x) * 100}%`;
        trail.style.top = `${Number(cursor.dataset.y) * 100}%`;
        layer.insertBefore(trail, cursor);
        setTimeout(() => trail.remove(), 700);
      }
      cursor.dataset.x = String(x);
      cursor.dataset.y = String(y);
      cursor.style.left = `${x * 100}%`;
      cursor.style.top = `${y * 100}%`;
    };
  });
}

async function thought(page, text, holdMs = 500) {
  await page.evaluate((value) => window.__internalAiThought?.(value), text);
  await delay(holdMs);
}

async function moveHuman(page, image, target, options = {}) {
  const durationMs = options.durationMs ?? 1_500;
  const dwellMs = options.dwellMs ?? 350;
  const start = currentPosition.get(page) || { image, x: 0.5, y: 0.5 };
  const stage = page.locator(`.picture[data-image="${image}"] .image-stage`);
  const box = await stage.boundingBox();
  if (!box) throw new Error(`image ${image} stage is not visible`);
  const steps = Math.max(8, Math.round(durationMs / 85));
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const eased = t * t * (3 - 2 * t);
    const wobble = Math.sin(t * Math.PI * 2.4) * (1 - t) * 0.018;
    const noiseX = (random() - 0.5) * 0.008;
    const noiseY = (random() - 0.5) * 0.008;
    const x = Math.max(0.015, Math.min(0.985, start.x + (target.x - start.x) * eased + wobble + noiseX));
    const y = Math.max(0.02, Math.min(0.98, start.y + (target.y - start.y) * eased - wobble * 0.55 + noiseY));
    await page.mouse.move(box.x + box.width * x, box.y + box.height * y);
    if (page.__isRecorder) await page.evaluate(([side, px, py]) => window.__internalAiCursor?.(side, px, py), [image, x, y]);
    await delay(65 + Math.round(random() * 45));
  }
  currentPosition.set(page, { image, ...target });
  await delay(dwellMs + Math.round(random() * 250));
}

async function wander(page, image, points, thoughtPage, line) {
  if (line) await thought(thoughtPage, line, 250);
  for (const point of points) {
    await moveHuman(page, image, point, { durationMs: 900 + Math.round(random() * 650), dwellMs: 180 + Math.round(random() * 500) });
  }
}

async function clickHuman(page, image, point, options = {}) {
  await moveHuman(page, image, point, { durationMs: options.durationMs ?? 1_600, dwellMs: options.dwellMs ?? 650 });
  const box = await page.locator(`.picture[data-image="${image}"] .image-stage`).boundingBox();
  await page.mouse.down();
  await delay(80 + Math.round(random() * 90));
  await page.mouse.up();
  await delay(650 + Math.round(random() * 450));
  currentPosition.set(page, { image, ...point });
  return box;
}

const app = createApp();
app.prepareMatch('internal-ai-demo');
const server = http.createServer(app.handleHttp);
server.on('upgrade', app.handleUpgrade);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const browser = await chromium.launch({ headless: true });
const recorderContext = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: outputDir, size: { width: 1280, height: 720 } },
});
const partnerContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const recorder = await recorderContext.newPage();
recorder.__isRecorder = true;
const partner = await partnerContext.newPage();
partner.__isRecorder = false;
const video = recorder.video();

try {
  await Promise.all([
    recorder.goto(`http://127.0.0.1:${port}/?matchId=internal-ai-demo&role=p1&name=${encodeURIComponent('AI 나침반')}`, { waitUntil: 'networkidle' }),
    partner.goto(`http://127.0.0.1:${port}/?matchId=internal-ai-demo&role=p2&name=${encodeURIComponent('AI 반딧불')}`, { waitUntil: 'networkidle' }),
  ]);
  await recorder.locator('.stage-card[data-stage-id="night-market-01"]').click();
  await Promise.all([
    recorder.waitForFunction(() => document.querySelectorAll('.player').length === 2 && [...document.images].every((image) => image.complete)),
    partner.waitForFunction(() => document.querySelectorAll('.player').length === 2 && [...document.images].every((image) => image.complete)),
  ]);
  await installRecorderOverlay(recorder);
  await thought(recorder, '두 AI가 장면 전체를 천천히 훑어봅니다…', 900);

  await Promise.all([
    wander(recorder, 'a', [{ x: .18, y: .68 }, { x: .39, y: .48 }, { x: .61, y: .31 }], recorder, ''),
    wander(partner, 'b', [{ x: .82, y: .70 }, { x: .69, y: .39 }, { x: .48, y: .62 }], recorder, ''),
  ]);

  await thought(recorder, 'AI 반딧불: 중앙 손수레가 조금 수상한데…', 350);
  await clickHuman(partner, 'b', { x: .54, y: .58 }, { durationMs: 1_900, dwellMs: 1_000 });
  await thought(recorder, '아니었네요. 다시 비교해 봅니다.', 850);

  await wander(partner, 'b', [{ x: .73, y: .32 }, { x: .88, y: .18 }, { x: .80, y: .28 }], recorder, 'AI 반딧불: 위쪽 등불 색이… 잠깐만.');
  await clickHuman(partner, 'b', { x: .8875, y: .1575 }, { durationMs: 1_500, dwellMs: 1_250 });

  await thought(recorder, 'AI 나침반: 왼쪽을 한 번 더 볼게요.', 350);
  await wander(recorder, 'a', [{ x: .22, y: .44 }, { x: .11, y: .31 }, { x: .18, y: .22 }], recorder, '');
  await clickHuman(recorder, 'a', { x: .0775, y: .2575 }, { durationMs: 1_650, dwellMs: 1_050 });

  await thought(recorder, '둘이 잠시 막혔습니다. 힌트로 위치만 확인해 봅니다.', 1_050);
  await recorder.locator('#hint-button').click();
  await recorder.waitForFunction(() => document.querySelectorAll('.picture[data-image="a"] .marker').length === 3);
  const hintedPosition = await recorder.locator('.picture[data-image="a"] .hint-marker').evaluate((marker) => ({
    x: Number.parseFloat(marker.style.left) / 100,
    y: Number.parseFloat(marker.style.top) / 100,
  }));
  await thought(recorder, '청록색 ? 핀이 위치만 알려줍니다. 아직 정답으로 처리되지는 않았습니다.', 1_300);
  await recorder.screenshot({ path: posterPath });
  await clickHuman(recorder, 'a', hintedPosition, { durationMs: 1_650, dwellMs: 1_250 });
  await recorder.waitForFunction(() => document.querySelectorAll('.hint-marker').length === 0);
  await thought(recorder, '표시된 곳을 직접 누르자 ? 핀이 사라지고 O 정답 마커로 바뀝니다.', 1_350);
  const foundAfterHint = await recorder.locator('.picture[data-image="a"] .marker:not(.hint-marker)').evaluateAll((markers) => markers.map((marker) => marker.title));

  await Promise.all([
    wander(recorder, 'b', [{ x: .37, y: .75 }, { x: .59, y: .57 }], recorder, ''),
    wander(partner, 'a', [{ x: .63, y: .21 }, { x: .51, y: .15 }, { x: .43, y: .20 }], recorder, ''),
  ]);
  if (!foundAfterHint.includes('시계 위 장식')) {
    await thought(recorder, 'AI 반딧불: 시계 위 장식 모양이 다르네요.', 450);
    await clickHuman(partner, 'a', { x: .5075, y: .097 }, { durationMs: 1_800, dwellMs: 1_350 });
  }

  if (!foundAfterHint.includes('고양이 목도리')) {
    await thought(recorder, 'AI 나침반: 고양이 주변도 천천히 비교…', 400);
    await wander(recorder, 'b', [{ x: .31, y: .76 }, { x: .23, y: .86 }, { x: .12, y: .79 }, { x: .20, y: .89 }], recorder, '');
    await clickHuman(recorder, 'b', { x: .1575, y: .855 }, { durationMs: 1_500, dwellMs: 1_300 });
  }

  if (!foundAfterHint.includes('자전거 바구니')) {
    await thought(recorder, '마지막 하나. 자전거 쪽을 다시 확인합니다.', 550);
    await wander(partner, 'a', [{ x: .83, y: .78 }, { x: .69, y: .74 }, { x: .77, y: .57 }, { x: .64, y: .63 }], recorder, '');
    await clickHuman(partner, 'a', { x: .7275, y: .61 }, { durationMs: 2_200, dwellMs: 1_500 });
  }

  await recorder.waitForFunction(() => !document.querySelector('#result')?.classList.contains('hidden'));
  await recorder.evaluate(() => window.__internalAiThought?.('두 AI가 5개를 모두 찾았습니다!'));
  await delay(3_500);
} finally {
  await partner.close().catch(() => {});
  await recorder.close().catch(() => {});
  await partnerContext.close().catch(() => {});
  await recorderContext.close().catch(() => {});
  await browser.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}

const temporaryVideo = await video.path();
await fs.rm(webmPath, { force: true });
await fs.rename(temporaryVideo, webmPath);

const ffmpeg = spawnSync('ffmpeg', [
  '-y', '-i', webmPath, '-c:v', 'libx264', '-preset', 'medium', '-crf', '22',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4Path,
], { encoding: 'utf8' });
if (ffmpeg.status !== 0) {
  process.stderr.write(ffmpeg.stderr || 'ffmpeg conversion failed\n');
  process.exitCode = 1;
} else {
  process.stdout.write(`${mp4Path}\n${webmPath}\n${posterPath}\n`);
}
