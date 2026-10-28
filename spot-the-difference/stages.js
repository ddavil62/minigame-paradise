import { readFileSync } from 'node:fs';

const catalogUrl = new URL('./content/published/stages.json', import.meta.url);

function freezeStage(stage) {
  return Object.freeze({
    ...stage,
    differences: Object.freeze(stage.differences.map((difference) => Object.freeze(difference))),
  });
}

export function readPublishedStages(source = catalogUrl) {
  const parsed = JSON.parse(readFileSync(source, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('stages.json must contain an array');

  const published = parsed.filter((stage) => stage?.status === 'published');
  if (!published.length) throw new Error('stages.json has no published stages');

  const ids = new Set();
  for (const stage of published) {
    if (typeof stage.id !== 'string' || !stage.id.trim()) throw new Error('published stage id is required');
    if (ids.has(stage.id)) throw new Error(`duplicate published stage id: ${stage.id}`);
    if (typeof stage.title !== 'string' || !stage.title.trim()) throw new Error(`stage title is required: ${stage.id}`);
    if (typeof stage.collectionId !== 'string' || !stage.collectionId.trim()) throw new Error(`stage collectionId is required: ${stage.id}`);
    if (typeof stage.stageType !== 'string' || !stage.stageType.trim()) throw new Error(`stage stageType is required: ${stage.id}`);
    if (typeof stage.imageA !== 'string' || typeof stage.imageB !== 'string') throw new Error(`stage images are required: ${stage.id}`);
    if (!Array.isArray(stage.differences) || !stage.differences.length) throw new Error(`stage differences are required: ${stage.id}`);
    if (!Number.isFinite(stage.durationMs) || stage.durationMs <= 0) throw new Error(`stage durationMs is invalid: ${stage.id}`);
    ids.add(stage.id);
  }

  return Object.freeze(published.map(freezeStage));
}

export let PUBLISHED_STAGES = readPublishedStages();
export let DEFAULT_STAGE = PUBLISHED_STAGES[0];

export function reloadPublishedStages(source = catalogUrl) {
  const nextStages = readPublishedStages(source);
  PUBLISHED_STAGES = nextStages;
  DEFAULT_STAGE = nextStages[0];
  return {
    count: nextStages.length,
    defaultStageId: DEFAULT_STAGE.id,
    stageIds: nextStages.map((stage) => stage.id),
  };
}

export function getStage(stageId) {
  return PUBLISHED_STAGES.find((stage) => stage.id === stageId) || null;
}

export function stageSummary(stage) {
  return {
    id: stage.id,
    title: stage.title,
    description: stage.description,
    theme: stage.theme,
    collectionId: stage.collectionId,
    stageType: stage.stageType,
    difficulty: stage.difficulty,
    imageA: stage.imageA,
    total: stage.differences.length,
    durationMs: stage.durationMs,
  };
}

export function publishedStageSummaries() {
  return PUBLISHED_STAGES.map(stageSummary);
}
