import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
const SUPPORTED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function writeJsonAtomic(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, filePath);
}

function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2) return null;
    offset += segmentLength + 2;
  }
  return null;
}

function webpDimensions(buffer) {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
  const type = buffer.toString('ascii', 12, 16);
  if (type === 'VP8X') {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (type === 'VP8 ' && buffer.length >= 30) {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  if (type === 'VP8L' && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

export function inspectImage(filePath) {
  const buffer = readFileSync(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const dimensions = extension === '.png'
    ? pngDimensions(buffer)
    : extension === '.webp'
      ? webpDimensions(buffer)
      : jpegDimensions(buffer);
  return {
    bytes: buffer.length,
    hash: createHash('sha256').update(buffer).digest('hex'),
    ...dimensions,
  };
}

function resolveCandidateAsset(candidateDir, relativePath) {
  const root = path.resolve(candidateDir);
  const resolved = path.resolve(root, relativePath || '');
  const inside = resolved.startsWith(`${root}${path.sep}`);
  return { resolved, inside };
}

function validZone(zone) {
  if (!zone || !['x', 'y', 'w', 'h'].every((key) => Number.isFinite(zone[key]))) return false;
  return zone.x >= 0 && zone.y >= 0 && zone.w > 0 && zone.h > 0
    && zone.x + zone.w <= 1 && zone.y + zone.h <= 1;
}

export function validateCandidate(candidateDir, manifest) {
  const errors = [];
  const warnings = [];
  const images = {};

  if (!manifest || typeof manifest !== 'object') {
    return { decision: 'reject', errors: ['candidate.json이 유효한 객체가 아닙니다.'], warnings, images };
  }
  if (!ID_PATTERN.test(manifest.id || '')) errors.push('id는 3~64자의 영문 소문자, 숫자, 하이픈만 사용할 수 있습니다.');
  for (const key of ['title', 'description', 'theme', 'collectionId', 'stageType']) {
    if (typeof manifest[key] !== 'string' || !manifest[key].trim()) errors.push(`${key} 값이 필요합니다.`);
  }
  if (!Number.isInteger(manifest.differenceTarget) || manifest.differenceTarget < 3 || manifest.differenceTarget > 10) {
    errors.push('differenceTarget은 3~10 사이의 정수여야 합니다.');
  }

  for (const side of ['A', 'B']) {
    const asset = resolveCandidateAsset(candidateDir, manifest[`image${side}`]);
    if (!asset.inside) {
      errors.push(`image${side} 경로가 후보 폴더 밖을 가리킵니다.`);
      continue;
    }
    if (!SUPPORTED_EXTENSIONS.has(path.extname(asset.resolved).toLowerCase())) {
      errors.push(`image${side} 형식은 PNG, JPEG, WebP만 지원합니다.`);
      continue;
    }
    if (!existsSync(asset.resolved)) {
      errors.push(`image${side} 파일을 찾을 수 없습니다.`);
      continue;
    }
    try {
      images[side.toLowerCase()] = inspectImage(asset.resolved);
      const info = images[side.toLowerCase()];
      if (!info.width || !info.height) errors.push(`image${side} 크기를 읽을 수 없습니다.`);
      if (info.bytes > MAX_IMAGE_BYTES) errors.push(`image${side}가 50MB를 초과합니다.`);
    } catch {
      errors.push(`image${side} 파일을 읽을 수 없습니다.`);
    }
  }

  if (images.a?.width && images.b?.width) {
    if (images.a.width !== images.b.width || images.a.height !== images.b.height) errors.push('두 이미지의 크기가 같아야 합니다.');
    if (images.a.width < 1024 || images.a.height < 682) warnings.push('권장 해상도 1024×682 이상이 아닙니다.');
    if (images.a.width <= images.a.height) warnings.push('게임 화면에는 가로형 이미지가 적합합니다.');
    if (images.a.hash === images.b.hash) errors.push('두 이미지가 완전히 동일합니다.');
  }

  const differences = Array.isArray(manifest.differences) ? manifest.differences : [];
  if (differences.length !== manifest.differenceTarget) {
    errors.push(`검출된 차이 ${differences.length}개가 목표 ${manifest.differenceTarget}개와 다릅니다.`);
  }
  const differenceIds = new Set();
  for (const difference of differences) {
    if (!ID_PATTERN.test(difference?.id || '') || differenceIds.has(difference.id)) errors.push('차이점 id는 고유한 kebab-case여야 합니다.');
    differenceIds.add(difference?.id);
    if (typeof difference?.label !== 'string' || !difference.label.trim()) errors.push('모든 차이점에는 label이 필요합니다.');
    for (const side of ['a', 'b']) {
      const zone = difference?.zones?.[side];
      if (!validZone(zone)) {
        errors.push(`${difference?.id || 'unknown'}의 ${side} 영역 좌표가 유효하지 않습니다.`);
      } else if (zone.w * zone.h > 0.15) {
        warnings.push(`${difference.id}의 ${side} 영역이 너무 넓어 난도가 낮아질 수 있습니다.`);
      }
    }
  }

  const fatal = errors.some((message) => /경로|형식|찾을 수|읽을 수|id는 3|값이 필요|differenceTarget/.test(message));
  return {
    decision: fatal ? 'reject' : errors.length || warnings.length ? 'retry' : 'approve',
    errors,
    warnings,
    images,
  };
}

export function combineReview(manifest, aiReview, deterministicReview) {
  if (deterministicReview.decision === 'reject') return 'reject';
  if (deterministicReview.decision === 'retry') return 'retry';
  return ['approve', 'retry', 'reject'].includes(aiReview?.decision) ? aiReview.decision : 'retry';
}

export function publishCandidate({ candidateDir, catalogPath, assetsDir, replace = false }) {
  const manifestPath = path.join(candidateDir, 'candidate.json');
  const reviewPath = path.join(candidateDir, 'review.json');
  const manifest = readJson(manifestPath);
  const review = readJson(reviewPath);
  const validation = validateCandidate(candidateDir, manifest);
  if (review.decision !== 'approve' || validation.decision !== 'approve') {
    throw new Error(`승인된 후보만 게시할 수 있습니다. review=${review.decision}, validation=${validation.decision}`);
  }

  const catalog = existsSync(catalogPath) ? readJson(catalogPath) : [];
  const existingIndex = catalog.findIndex((stage) => stage.id === manifest.id);
  if (existingIndex >= 0 && !replace) throw new Error(`이미 게시된 id입니다: ${manifest.id}`);

  mkdirSync(assetsDir, { recursive: true });
  const extensionA = path.extname(manifest.imageA).toLowerCase();
  const extensionB = path.extname(manifest.imageB).toLowerCase();
  const outputNameA = `${manifest.id}-a${extensionA}`;
  const outputNameB = `${manifest.id}-b${extensionB}`;
  copyFileSync(path.join(candidateDir, manifest.imageA), path.join(assetsDir, outputNameA));
  copyFileSync(path.join(candidateDir, manifest.imageB), path.join(assetsDir, outputNameB));

  const stage = {
    id: manifest.id,
    status: 'published',
    title: manifest.title,
    description: manifest.description,
    theme: manifest.theme,
    collectionId: manifest.collectionId,
    stageType: manifest.stageType,
    difficulty: review.difficulty || manifest.difficulty || '보통',
    imageA: `assets/puzzles/${outputNameA}`,
    imageB: `assets/puzzles/${outputNameB}`,
    durationMs: manifest.durationMs ?? 90_000,
    missPenaltyMs: manifest.missPenaltyMs ?? 5_000,
    hintPenaltyMs: manifest.hintPenaltyMs ?? 10_000,
    maxHints: manifest.maxHints ?? 2,
    differences: manifest.differences,
  };
  if (existingIndex >= 0) catalog[existingIndex] = stage;
  else catalog.push(stage);
  writeJsonAtomic(catalogPath, catalog);
  writeJsonAtomic(manifestPath, { ...manifest, status: 'published', publishedAt: new Date().toISOString() });
  return stage;
}
