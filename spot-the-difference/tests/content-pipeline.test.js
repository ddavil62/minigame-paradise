import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { publishCandidate, validateCandidate } from '../pipeline/content-pipeline.js';

function fakePng(width = 1536, height = 1024, variant = 0) {
  const buffer = Buffer.alloc(32);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buffer, 0);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  buffer[31] = variant;
  return buffer;
}

function differences() {
  return Array.from({ length: 5 }, (_, index) => ({
    id: `difference-${index + 1}`,
    label: `차이 ${index + 1}`,
    zones: {
      a: { x: 0.05 + index * 0.15, y: 0.2, w: 0.06, h: 0.08 },
      b: { x: 0.05 + index * 0.15, y: 0.2, w: 0.06, h: 0.08 },
    },
  }));
}

function makeCandidate({ sameImages = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'spot-pipeline-'));
  const candidateDir = path.join(root, 'candidate');
  mkdirSync(candidateDir);
  writeFileSync(path.join(candidateDir, 'image-a.png'), fakePng(1536, 1024, 1));
  writeFileSync(path.join(candidateDir, 'image-b.png'), fakePng(1536, 1024, sameImages ? 1 : 2));
  const manifest = {
    schemaVersion: 1,
    id: 'test-stage-01', status: 'candidate', title: '테스트', description: '테스트 스테이지', theme: '테스트',
    collectionId: 'moonlight-mystery', stageType: 'classic',
    difficulty: '보통', imageA: 'image-a.png', imageB: 'image-b.png', differenceTarget: 5,
    durationMs: 90000, missPenaltyMs: 5000, hintPenaltyMs: 10000, maxHints: 2,
    differences: differences(),
  };
  writeFileSync(path.join(candidateDir, 'candidate.json'), JSON.stringify(manifest));
  return { root, candidateDir, manifest };
}

test('완성된 후보는 로컬 품질 검증을 통과한다', () => {
  const { candidateDir, manifest } = makeCandidate();
  const result = validateCandidate(candidateDir, manifest);
  assert.equal(result.decision, 'approve');
  assert.deepEqual(result.errors, []);
});

test('동일한 두 이미지는 재생성 대상으로 분류한다', () => {
  const { candidateDir, manifest } = makeCandidate({ sameImages: true });
  const result = validateCandidate(candidateDir, manifest);
  assert.equal(result.decision, 'retry');
  assert.match(result.errors.join(' '), /완전히 동일/);
});

test('후보 폴더를 벗어나는 이미지 경로는 반려한다', () => {
  const { candidateDir, manifest } = makeCandidate();
  const result = validateCandidate(candidateDir, { ...manifest, imageA: '../outside.png' });
  assert.equal(result.decision, 'reject');
  assert.match(result.errors.join(' '), /후보 폴더 밖/);
});

test('승인 후보를 에셋과 JSON 카탈로그에 게시한다', () => {
  const { root, candidateDir } = makeCandidate();
  writeFileSync(path.join(candidateDir, 'review.json'), JSON.stringify({ decision: 'approve', difficulty: '보통' }));
  const catalogPath = path.join(root, 'published', 'stages.json');
  const assetsDir = path.join(root, 'assets', 'puzzles');
  mkdirSync(path.dirname(catalogPath), { recursive: true });
  writeFileSync(catalogPath, '[]');
  const stage = publishCandidate({ candidateDir, catalogPath, assetsDir });
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  assert.equal(stage.id, 'test-stage-01');
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].differences.length, 5);
  assert.equal(catalog[0].collectionId, 'moonlight-mystery');
  assert.equal(catalog[0].stageType, 'classic');
  assert.equal(readFileSync(path.join(assetsDir, 'test-stage-01-a.png'))[31], 1);
});
