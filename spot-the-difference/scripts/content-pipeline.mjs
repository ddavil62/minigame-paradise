import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  combineReview,
  publishCandidate,
  readJson,
  validateCandidate,
  writeJsonAtomic,
} from '../pipeline/content-pipeline.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidatesRoot = path.join(projectRoot, 'content', 'candidates');
const catalogPath = path.join(projectRoot, 'content', 'published', 'stages.json');
const assetsDir = path.join(projectRoot, 'assets', 'puzzles');
const imageModel = process.env.SPOT_IMAGE_MODEL || 'gpt-image-2';
const reviewModel = process.env.SPOT_REVIEW_MODEL || 'gpt-5.6-luna';
const reloadUrl = process.env.SPOT_RELOAD_URL
  || 'http://127.0.0.1:3000/spot-the-difference/admin/reload-stages';

async function reloadRunningServer() {
  try {
    const response = await fetch(reloadUrl, { method: 'POST', signal: AbortSignal.timeout(2_000) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true) throw new Error(payload.error || `HTTP ${response.status}`);
    console.log(`[reload] 실행 서버에 ${payload.count}개 스테이지 반영`);
  } catch (error) {
    console.warn(`[reload] 실행 서버 갱신 생략: ${error.message}`);
  }
}

function parseArguments(tokens) {
  const args = { _: [] };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) { args._.push(token); continue; }
    const [rawKey, inlineValue] = token.slice(2).split('=', 2);
    if (inlineValue !== undefined) args[rawKey] = inlineValue;
    else if (tokens[index + 1] && !tokens[index + 1].startsWith('--')) args[rawKey] = tokens[++index];
    else args[rawKey] = true;
  }
  return args;
}

function requireApiKey() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY가 필요합니다. 로컬 검수는 --local 옵션으로 실행하세요.');
  return process.env.OPENAI_API_KEY;
}

async function openAiRequest(url, options) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(url, options);
    if (response.ok) return response.json();
    const body = await response.text();
    const requestId = response.headers.get('x-request-id');
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 3) {
      throw new Error(`OpenAI API ${response.status}${requestId ? ` (${requestId})` : ''}: ${body.slice(0, 800)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
  }
  throw new Error('OpenAI API 요청에 실패했습니다.');
}

async function generateImage(prompt) {
  const result = await openAiRequest('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${requireApiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: imageModel, prompt, size: '1536x1024', quality: 'medium', output_format: 'png' }),
  });
  if (!result.data?.[0]?.b64_json) throw new Error('이미지 생성 응답에 b64_json이 없습니다.');
  return Buffer.from(result.data[0].b64_json, 'base64');
}

async function editImage(sourcePath, prompt) {
  const form = new FormData();
  form.append('model', imageModel);
  form.append('image[]', new Blob([readFileSync(sourcePath)], { type: 'image/png' }), 'image-a.png');
  form.append('prompt', prompt);
  form.append('size', '1536x1024');
  form.append('quality', 'medium');
  form.append('output_format', 'png');
  const result = await openAiRequest('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${requireApiKey()}` },
    body: form,
  });
  if (!result.data?.[0]?.b64_json) throw new Error('이미지 편집 응답에 b64_json이 없습니다.');
  return Buffer.from(result.data[0].b64_json, 'base64');
}

function basePrompt(brief) {
  return [
    'Create image A for a premium cooperative spot-the-difference game.',
    'Landscape 3:2 composition, fixed camera, richly detailed but visually readable.',
    `Theme: ${brief.theme}. Scene: ${brief.scene}.`,
    `Art direction: ${brief.style || 'warm cinematic storybook illustration with clean silhouettes'}.`,
    'Do not include text, letters, numbers, logos, signatures, borders, split screens, or watermarks.',
    'Keep important objects away from the outer 3% safe margin.',
  ].join('\n');
}

function editPrompt(brief, retryPrompt = '') {
  return [
    `Create image B by editing this image for a spot-the-difference puzzle with exactly ${brief.differenceCount} differences.`,
    'Preserve the camera, crop, characters, composition, lighting, palette, texture, and every unedited detail exactly.',
    `Make exactly ${brief.differenceCount} localized, clearly visible object-level changes distributed across the scene.`,
    'Use changes such as one object color, a small accessory, count, direction, or missing object. Avoid global color or lighting changes.',
    'Do not add text, letters, numbers, logos, signatures, borders, split screens, or watermarks.',
    brief.changeGuidance ? `Requested change guidance: ${brief.changeGuidance}` : '',
    retryPrompt ? `Correct the previous quality issues: ${retryPrompt}` : '',
  ].filter(Boolean).join('\n');
}

function normalizeBrief(brief, idOverride) {
  const id = idOverride || brief.id;
  if (!id) throw new Error('브리프에 id가 필요합니다.');
  const differenceCount = Number(brief.differenceCount ?? 5);
  return {
    ...brief,
    id,
    differenceCount,
    title: brief.title || id,
    description: brief.description || `${brief.theme} 테마의 틀린그림찾기`,
    difficulty: brief.difficulty || '보통',
  };
}

function prepareCandidate(briefPath, idOverride, provider = 'codex-subscription-imagegen') {
  const brief = normalizeBrief(readJson(path.resolve(briefPath)), idOverride);
  const candidateDir = path.join(candidatesRoot, brief.id);
  if (existsSync(candidateDir)) throw new Error(`후보 폴더가 이미 존재합니다: ${brief.id}`);
  mkdirSync(candidateDir, { recursive: true });
  const promptA = basePrompt(brief);
  const promptB = editPrompt(brief);
  const manifest = {
    schemaVersion: 1,
    id: brief.id,
    status: 'awaiting-subscription-generation',
    title: brief.title,
    description: brief.description,
    theme: brief.theme,
    collectionId: brief.collectionId,
    stageType: brief.stageType,
    difficulty: brief.difficulty,
    imageA: 'image-a.png',
    imageB: 'image-b.png',
    durationMs: brief.durationMs ?? 90_000,
    missPenaltyMs: brief.missPenaltyMs ?? 5_000,
    hintPenaltyMs: brief.hintPenaltyMs ?? 10_000,
    maxHints: brief.maxHints ?? 2,
    differenceTarget: brief.differenceCount,
    differences: [],
    generation: {
      provider,
      model: provider === 'openai-api' ? imageModel : 'built-in-imagegen',
      attempt: 1,
      promptA, promptB, createdAt: new Date().toISOString(),
    },
  };
  writeJsonAtomic(path.join(candidateDir, 'candidate.json'), manifest);
  writeFileSync(path.join(candidateDir, 'prompt-a.txt'), `${promptA}\n`, 'utf8');
  writeFileSync(path.join(candidateDir, 'prompt-b.txt'), `${promptB}\n`, 'utf8');
  return { brief, candidateDir, manifest };
}

async function createCandidate(briefPath, idOverride) {
  const { brief, candidateDir, manifest } = prepareCandidate(briefPath, idOverride, 'openai-api');
  writeJsonAtomic(path.join(candidateDir, 'candidate.json'), { ...manifest, status: 'generating-api' });
  console.log(`[generate] ${brief.id}: image A`);
  writeFileSync(path.join(candidateDir, 'image-a.png'), await generateImage(promptA));
  console.log(`[generate] ${brief.id}: image B`);
  writeFileSync(path.join(candidateDir, 'image-b.png'), await editImage(path.join(candidateDir, 'image-a.png'), promptB));
  writeJsonAtomic(path.join(candidateDir, 'candidate.json'), { ...manifest, status: 'candidate' });
  return candidateDir;
}

function finalizeSubscriptionCandidate(candidateDir, differencesPath, options = {}) {
  const manifestPath = path.join(candidateDir, 'candidate.json');
  const manifest = readJson(manifestPath);
  if (!differencesPath) throw new Error('--differences JSON 경로가 필요합니다.');
  const rawDifferences = readJson(path.resolve(differencesPath));
  const differences = Array.isArray(rawDifferences) ? rawDifferences : rawDifferences.differences;
  if (!Array.isArray(differences)) throw new Error('differences 파일은 배열 또는 differences 배열을 포함한 객체여야 합니다.');
  const completedManifest = { ...manifest, status: 'candidate', differences };
  writeJsonAtomic(manifestPath, completedManifest);
  const deterministic = validateCandidate(candidateDir, completedManifest);
  const review = {
    decision: deterministic.decision,
    qualityScore: options.qualityScore ? Number(options.qualityScore) : null,
    difficulty: options.difficulty || manifest.difficulty,
    reasons: [...deterministic.errors, ...deterministic.warnings],
    retryPrompt: '',
    differences,
    deterministic,
    reviewer: 'codex-subscription-imagegen',
    reviewedAt: new Date().toISOString(),
  };
  writeJsonAtomic(path.join(candidateDir, 'review.json'), review);
  return review;
}

function imageDataUrl(filePath) {
  const extension = path.extname(filePath).slice(1).replace('jpg', 'jpeg');
  return `data:image/${extension};base64,${readFileSync(filePath).toString('base64')}`;
}

function extractOutputText(response) {
  if (typeof response.output_text === 'string') return response.output_text;
  for (const item of response.output || []) {
    for (const content of item.content || []) if (content.type === 'output_text') return content.text;
  }
  throw new Error('AI 검수 응답에서 output_text를 찾지 못했습니다.');
}

const reviewSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    decision: { type: 'string', enum: ['approve', 'retry', 'reject'] },
    qualityScore: { type: 'integer' },
    difficulty: { type: 'string', enum: ['쉬움', '보통', '어려움'] },
    reasons: { type: 'array', items: { type: 'string' } },
    retryPrompt: { type: 'string' },
    differences: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          zones: {
            type: 'object', additionalProperties: false,
            properties: {
              a: { $ref: '#/$defs/zone' }, b: { $ref: '#/$defs/zone' },
            }, required: ['a', 'b'],
          },
        }, required: ['id', 'label', 'zones'],
      },
    },
  },
  required: ['decision', 'qualityScore', 'difficulty', 'reasons', 'retryPrompt', 'differences'],
  $defs: {
    zone: {
      type: 'object', additionalProperties: false,
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        w: { type: 'number' },
        h: { type: 'number' },
      }, required: ['x', 'y', 'w', 'h'],
    },
  },
};

async function requestAiReview(candidateDir, manifest) {
  const prompt = [
    'You are the final autonomous QA gate for a cooperative spot-the-difference game.',
    `Compare image A and B. The target is exactly ${manifest.differenceTarget} intentional localized differences.`,
    'Approve only when the composition and style are consistent, differences are unambiguous and well distributed, and there are no accidental changes, text artifacts, watermarks, or broken anatomy.',
    'Return every actual difference. zone coordinates are normalized x,y,w,h boxes for each corresponding image.',
    'Use short kebab-case ids and concise Korean labels. If retrying, give an actionable English image-edit prompt in retryPrompt.',
    'Reject only when the concept is fundamentally unusable; use retry for correctable generation problems.',
  ].join('\n');
  const response = await openAiRequest('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${requireApiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: reviewModel,
      input: [{ role: 'user', content: [
        { type: 'input_text', text: prompt },
        { type: 'input_image', image_url: imageDataUrl(path.join(candidateDir, manifest.imageA)), detail: 'original' },
        { type: 'input_image', image_url: imageDataUrl(path.join(candidateDir, manifest.imageB)), detail: 'original' },
      ] }],
      text: { format: { type: 'json_schema', name: 'spot_difference_review', strict: true, schema: reviewSchema } },
    }),
  });
  return JSON.parse(extractOutputText(response));
}

async function reviewCandidate(candidateDir, localOnly = false) {
  const manifestPath = path.join(candidateDir, 'candidate.json');
  let manifest = readJson(manifestPath);
  let aiReview = null;
  if (!localOnly) {
    console.log(`[review] ${manifest.id}: ${reviewModel}`);
    aiReview = await requestAiReview(candidateDir, manifest);
    manifest = { ...manifest, differences: aiReview.differences };
    writeJsonAtomic(manifestPath, manifest);
  }
  const deterministic = validateCandidate(candidateDir, manifest);
  const decision = localOnly ? deterministic.decision : combineReview(manifest, aiReview, deterministic);
  const review = {
    decision,
    qualityScore: aiReview?.qualityScore ?? null,
    difficulty: aiReview?.difficulty ?? manifest.difficulty,
    reasons: [...(aiReview?.reasons || []), ...deterministic.errors, ...deterministic.warnings],
    retryPrompt: aiReview?.retryPrompt || '',
    differences: manifest.differences,
    deterministic,
    reviewer: localOnly ? 'local-validator' : reviewModel,
    reviewedAt: new Date().toISOString(),
  };
  writeJsonAtomic(path.join(candidateDir, 'review.json'), review);
  console.log(`[review] ${manifest.id}: ${decision}`);
  return review;
}

async function retryCandidate(candidateDir, retryPrompt) {
  const manifestPath = path.join(candidateDir, 'candidate.json');
  const manifest = readJson(manifestPath);
  const nextAttempt = (manifest.generation?.attempt || 1) + 1;
  const oldReviewPath = path.join(candidateDir, 'review.json');
  if (existsSync(oldReviewPath)) writeJsonAtomic(path.join(candidateDir, `review-attempt-${nextAttempt - 1}.json`), readJson(oldReviewPath));
  const promptB = `${manifest.generation.promptB}\n${retryPrompt ? `Additional correction: ${retryPrompt}` : ''}`;
  console.log(`[retry] ${manifest.id}: image B attempt ${nextAttempt}`);
  writeFileSync(path.join(candidateDir, manifest.imageB), await editImage(path.join(candidateDir, manifest.imageA), promptB));
  writeJsonAtomic(manifestPath, {
    ...manifest,
    status: 'candidate',
    differences: [],
    generation: { ...manifest.generation, attempt: nextAttempt, promptB, updatedAt: new Date().toISOString() },
  });
}

function candidateDirectories() {
  if (!existsSync(candidatesRoot)) return [];
  return readdirSync(candidatesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(candidatesRoot, entry.name, 'candidate.json')))
    .map((entry) => path.join(candidatesRoot, entry.name));
}

function resolveCandidate(id) {
  const candidateDir = path.join(candidatesRoot, id);
  if (!existsSync(path.join(candidateDir, 'candidate.json'))) throw new Error(`후보를 찾을 수 없습니다: ${id}`);
  return candidateDir;
}

async function main() {
  const [command = 'list', ...tokens] = process.argv.slice(2);
  const args = parseArguments(tokens);
  if (command === 'prepare') {
    if (!args.brief) throw new Error('--brief 경로가 필요합니다.');
    const { candidateDir, manifest } = prepareCandidate(args.brief, args.id);
    console.log(`[prepare] ${manifest.id}: ${path.relative(projectRoot, candidateDir)}`);
    console.log('Codex 내장 imagegen으로 prompt-a.txt를 생성한 뒤, image A를 편집 대상으로 prompt-b.txt를 적용하세요.');
    return;
  }
  if (command === 'finalize') {
    const candidateDir = resolveCandidate(args._[0]);
    const review = finalizeSubscriptionCandidate(candidateDir, args.differences, {
      qualityScore: args['quality-score'], difficulty: args.difficulty,
    });
    console.log(`[finalize] ${args._[0]}: ${review.decision}`);
    if (args.publish && review.decision === 'approve') {
      const stage = publishCandidate({ candidateDir, catalogPath, assetsDir });
      console.log(`[publish] ${stage.id}: ${stage.title}`);
      await reloadRunningServer();
    }
    return;
  }
  if (command === 'generate') {
    if (!args.brief) throw new Error('--brief 경로가 필요합니다.');
    const dir = await createCandidate(args.brief, args.id);
    console.log(`생성 완료: ${path.relative(projectRoot, dir)}`);
    return;
  }
  if (command === 'review') {
    const directories = args.all ? candidateDirectories() : [resolveCandidate(args._[0])];
    for (const directory of directories) await reviewCandidate(directory, Boolean(args.local));
    return;
  }
  if (command === 'publish') {
    const directories = args['all-approved']
      ? candidateDirectories().filter((dir) => existsSync(path.join(dir, 'review.json')) && readJson(path.join(dir, 'review.json')).decision === 'approve')
      : [resolveCandidate(args._[0])];
    for (const candidateDir of directories) {
      const stage = publishCandidate({ candidateDir, catalogPath, assetsDir, replace: Boolean(args.replace) });
      console.log(`[publish] ${stage.id}: ${stage.title}`);
    }
    if (directories.length) await reloadRunningServer();
    return;
  }
  if (command === 'run') {
    if (!args.brief) throw new Error('--brief 경로가 필요합니다.');
    const maximumAttempts = Math.max(1, Number(args['max-attempts'] || 3));
    const candidateDir = await createCandidate(args.brief, args.id);
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      const review = await reviewCandidate(candidateDir, false);
      if (review.decision === 'approve') {
        const stage = publishCandidate({ candidateDir, catalogPath, assetsDir });
        console.log(`[done] ${stage.id} 자동 게시 완료`);
        await reloadRunningServer();
        return;
      }
      if (review.decision === 'reject' || attempt === maximumAttempts) {
        console.log(`[stop] ${readJson(path.join(candidateDir, 'candidate.json')).id}: ${review.decision}`);
        return;
      }
      await retryCandidate(candidateDir, review.retryPrompt);
    }
    return;
  }
  if (command === 'list') {
    const catalog = readJson(catalogPath);
    console.log(`published: ${catalog.length}`);
    for (const directory of candidateDirectories()) {
      const manifest = readJson(path.join(directory, 'candidate.json'));
      const reviewPath = path.join(directory, 'review.json');
      const decision = existsSync(reviewPath) ? readJson(reviewPath).decision : 'unreviewed';
      console.log(`${manifest.id}\t${manifest.status}\t${decision}`);
    }
    return;
  }
  throw new Error(`알 수 없는 명령입니다: ${command}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
