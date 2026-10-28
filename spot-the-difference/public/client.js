import { createSpotAudio } from './audio.js';

const audio = createSpotAudio();
const params = new URLSearchParams(location.search);
const matchId = params.get('matchId') || 'local-prototype';
const role = params.get('role') || '';
const name = params.get('name') || sessionStorage.getItem('minigames:nickname') || '플레이어';
const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const basePath = location.pathname.split('/').filter(Boolean)[0] || 'spot-the-difference';
const ws = new WebSocket(`${protocol}//${location.host}/${basePath}/ws?matchId=${encodeURIComponent(matchId)}&role=${encodeURIComponent(role)}`);

const elements = {
  timer: document.querySelector('#timer'), misses: document.querySelector('#misses'), status: document.querySelector('#connection-status'),
  players: document.querySelector('#players'), progress: document.querySelector('#progress'), progressLabel: document.querySelector('#progress-label'),
  hint: document.querySelector('#hint-button'), hintCount: document.querySelector('#hint-count'), result: document.querySelector('#result'),
  resultIcon: document.querySelector('#result-icon'), resultTitle: document.querySelector('#result-title'), resultCopy: document.querySelector('#result-copy'), toast: document.querySelector('#toast'),
  celebration: document.querySelector('#celebration'),
  imageA: document.querySelector('#image-a'), imageB: document.querySelector('#image-b'),
  stageSelect: document.querySelector('#stage-select'), stageList: document.querySelector('#stage-list'), stageWait: document.querySelector('#stage-wait'),
  stageCopy: document.querySelector('#stage-select-copy'), randomStage: document.querySelector('#random-stage-button'),
  difficultyOptions: document.querySelector('#difficulty-options'),
  activeRule: document.querySelector('#active-rule'),
  mission: document.querySelector('#mission'), board: document.querySelector('#board'), gameHelp: document.querySelector('#game-help'),
  stageButton: document.querySelector('#stage-button'), nextStageButton: document.querySelector('#next-stage-button'),
  resultRandomStageButton: document.querySelector('#result-random-stage-button'),
  audioToggle: document.querySelector('#audio-toggle'),
  stageReportButton: document.querySelector('#stage-report-button'), resultReportButton: document.querySelector('#result-report-button'),
  stageReportGuide: document.querySelector('#stage-report-guide'), stageReportCancel: document.querySelector('#stage-report-cancel'),
  stageReportDialog: document.querySelector('#stage-report-dialog'), stageReportLocation: document.querySelector('#stage-report-location'),
  stageReportNote: document.querySelector('#stage-report-note'), stageReportReselect: document.querySelector('#stage-report-reselect'),
  stageReportSubmit: document.querySelector('#stage-report-submit'),
};

let playerId = null;
let lastState = null;
let toastTimer = null;
let resultTimer = null;
let celebrationTimer = null;
let lastCursorSentAt = 0;
let activeCursorImage = null;
let stageCatalog = [];
let canSelectStage = false;
let selectedRuleType = 'classic';
let ruleTypes = [];
let audioPhaseKey = '';
let audioScene = 'library';
let stageReportMode = false;
let pendingStageReport = null;
let restoreResultAfterReport = false;
const CURSOR_INTERVAL_MS = 50;
const WIN_SCENE_HOLD_MS = 3_000;
const COMPLETED_STORAGE_KEY = 'spot-the-difference:completed-stages';
const DIFFICULTY_OPTIONS = [
  { value: 'easy', ruleType: 'relaxed', label: '쉬움', icon: '🌱' },
  { value: 'normal', ruleType: 'classic', label: '보통', icon: '✨' },
  { value: 'hard', ruleType: 'speed', label: '어려움', icon: '🔥' },
];
const STAGE_COLLECTIONS = [
  {
    id: 'moonlight-mystery',
    eyebrow: 'MOONLIGHT MYSTERY',
    title: '달빛 미스터리',
    description: '어두운 밤, 작은 빛과 마법 소품 사이의 차이를 살펴보세요.',
  },
  {
    id: 'world-adventure',
    eyebrow: 'WORLD ADVENTURE',
    title: '세계 탐험',
    description: '하늘과 바다, 정글과 기계 도시를 오가는 모험 스테이지예요.',
  },
  {
    id: 'seasonal-stories',
    eyebrow: 'SEASONAL STORIES',
    title: '사계절 이야기',
    description: '봄비부터 눈 내리는 겨울까지 계절마다 다른 색을 찾아보세요.',
  },
  {
    id: 'style-lab',
    eyebrow: 'STYLE LAB',
    title: '스타일 실험실',
    description: '익숙한 이야기책을 벗어나 완전히 다른 그림체를 만나는 특별 전시예요.',
  },
  {
    id: 'japanese-comics',
    eyebrow: 'JAPANESE COMICS',
    title: '일본 코믹스',
    description: '선명한 펜선과 영화 같은 장면 속에서 섬세한 차이를 찾아보세요.',
  },
  {
    id: 'wonder-park',
    eyebrow: 'WONDER PARK',
    title: '별빛 원더파크',
    description: '꿈처럼 반짝이는 놀이공원을 거닐며 숨은 차이를 찾아보세요.',
  },
  {
    id: 'goblin-night-village',
    eyebrow: 'KOREAN FOLKLORE FANTASY',
    title: '도깨비 마을의 밤',
    description: '달빛 아래 펼쳐지는 신비하고 익살스러운 다섯 이야기를 만나보세요.',
  },
  {
    id: 'tiny-things-city',
    eyebrow: 'MINIATURE ADVENTURE',
    title: '조그만 것들의 대도시',
    description: '일상용품 사이에 숨은 손바닥만 한 도시를 탐험해보세요.',
  },
  {
    id: 'animal-detectives',
    eyebrow: 'ANIMAL MYSTERY',
    title: '동물 탐정단 사건일지',
    description: '다섯 사건을 따라가며 유쾌한 동물 탐정단과 수상한 단서를 찾아보세요.',
  },
  {
    id: 'cat-detective-agency',
    eyebrow: 'COZY ANIMAL MYSTERY',
    title: '고양이 탐정단',
    description: '비 내리는 동물 도시에서 고양이 탐정과 함께 수상한 단서를 찾아보세요.',
  },
  {
    id: 'magic-delivery-office',
    eyebrow: 'MAGICAL POSTAL ADVENTURE',
    title: '마법 배달부의 하루',
    description: '하늘과 바다, 숲까지 이어지는 마법 우편망에서 특별한 소포를 배달해보세요.',
  },
  {
    id: 'toy-kingdom',
    eyebrow: 'TOY KINGDOM ADVENTURE',
    title: '장난감 왕국 대모험',
    description: '아이가 잠든 뒤 깨어난 나무·천·주석 장난감들의 작은 왕국을 여행해보세요.',
  },
  {
    id: 'dragon-academy',
    eyebrow: 'DRAGON ACADEMY ADVENTURE',
    title: '꼬마 용 마법학교 대모험',
    description: '구름 위 마법학교에서 아기 용과 견습생들이 함께 배우는 신기한 수업을 만나보세요.',
  },
];
// 공개 런처가 스테이지 카탈로그 확장 이전에 시작된 경우, 핫리로드된
// 스테이지 데이터에는 collectionId가 있어도 구버전 요약 함수가 이를
// WebSocket 메시지에서 누락할 수 있다. 서버를 재시작하지 않아도 현재
// 공개 경기가 선택 메뉴를 복구하도록 게시 스테이지 ID를 그룹에 매핑한다.
const LEGACY_STAGE_COLLECTION_BY_ID = {
  'night-market-01': 'moonlight-mystery',
  'moonlit-greenhouse-01': 'moonlight-mystery',
  'enchanted-library-01': 'moonlight-mystery',
  'moonlit-clockwork-shop-01': 'moonlight-mystery',
  'moonlit-puppet-theater-01': 'moonlight-mystery',
  'coral-observatory-01': 'world-adventure',
  'skyship-workshop-01': 'world-adventure',
  'clockwork-station-01': 'world-adventure',
  'jungle-treehouse-01': 'world-adventure',
  'starlit-desert-ruins-01': 'world-adventure',
  'snowy-toyshop-01': 'seasonal-stories',
  'seaside-bakery-01': 'seasonal-stories',
  'autumn-alchemy-kitchen-01': 'seasonal-stories',
  'spring-rain-umbrella-shop-01': 'seasonal-stories',
  'firefly-summer-camp-01': 'seasonal-stories',
  'retro-comic-robot-garage-01': 'style-lab',
  'retro-comic-space-diner-02': 'style-lab',
  'retro-comic-monster-tv-studio-03': 'style-lab',
  'retro-comic-alien-laundromat-04': 'style-lab',
  'retro-comic-moon-barbershop-05': 'style-lab',
  'japanese-comics-manga-studio-01': 'japanese-comics',
  'japanese-comics-seaside-platform-02': 'japanese-comics',
  'japanese-comics-rooftop-observatory-03': 'japanese-comics',
  'japanese-comics-summer-festival-04': 'japanese-comics',
  'japanese-comics-glasshouse-atelier-05': 'japanese-comics',
  'wonder-park-dream-gate-01': 'wonder-park',
  'wonder-park-carousel-garden-02': 'wonder-park',
  'goblin-night-moon-rabbit-mill-01': 'goblin-night-village',
  'goblin-night-snack-stall-02': 'goblin-night-village',
  'goblin-night-mask-workshop-03': 'goblin-night-village',
  'goblin-night-moon-ferry-dock-04': 'goblin-night-village',
  'goblin-night-cloud-garden-05': 'goblin-night-village',
  'tiny-things-teacup-harbor-01': 'tiny-things-city',
  'animal-detectives-museum-01': 'animal-detectives',
  'cat-detective-rainy-office-01': 'cat-detective-agency',
  'cat-detective-moonlit-museum-02': 'cat-detective-agency',
  'cat-detective-foggy-platform-03': 'cat-detective-agency',
  'cat-detective-stormy-harbor-04': 'cat-detective-agency',
  'cat-detective-midnight-theater-05': 'cat-detective-agency',
  'magic-delivery-starlight-post-01': 'magic-delivery-office',
  'magic-delivery-broom-workshop-02': 'magic-delivery-office',
  'toy-kingdom-block-castle-01': 'toy-kingdom',
};
function loadCompletedStages() {
  try {
    const stored = JSON.parse(localStorage.getItem(COMPLETED_STORAGE_KEY) || '[]');
    return new Set(Array.isArray(stored) ? stored.filter((stageId) => typeof stageId === 'string') : []);
  } catch {
    return new Set();
  }
}

const completedStages = loadCompletedStages();

function send(payload) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 1800);
}

function updateAudioToggle() {
  const muted = audio.isMuted();
  elements.audioToggle.setAttribute('aria-pressed', String(muted));
  elements.audioToggle.setAttribute('aria-label', muted ? 'BGM과 효과음 켜기' : 'BGM과 효과음 끄기');
  elements.audioToggle.textContent = muted ? '🔇 음소거' : '🔊 소리';
}

function setAudioScene(scene) {
  audioScene = scene;
  audio.startMusic(scene);
}

function stopWinCelebration() {
  clearTimeout(celebrationTimer);
  celebrationTimer = null;
  elements.celebration.replaceChildren();
  elements.celebration.classList.add('hidden');
  elements.board.classList.remove('celebrating');
}

function startWinCelebration() {
  stopWinCelebration();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#ffd56a', '#49c9be', '#ff766c', '#fff4d6'];
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 36; index += 1) {
    const particle = document.createElement('i');
    particle.className = `confetti confetti--${index % 3}`;
    particle.style.setProperty('--x', `${2 + Math.random() * 96}%`);
    particle.style.setProperty('--drift', `${-70 + Math.random() * 140}px`);
    particle.style.setProperty('--delay', `${Math.random() * 0.65}s`);
    particle.style.setProperty('--duration', `${1.8 + Math.random() * 1.15}s`);
    particle.style.setProperty('--size', `${6 + Math.random() * 7}px`);
    particle.style.setProperty('--color', colors[index % colors.length]);
    fragment.appendChild(particle);
  }
  elements.celebration.appendChild(fragment);
  elements.celebration.classList.remove('hidden');
  elements.board.classList.add('celebrating');
  celebrationTimer = setTimeout(stopWinCelebration, WIN_SCENE_HOLD_MS);
}

function resetResultPresentation() {
  clearTimeout(resultTimer);
  resultTimer = null;
  elements.result.classList.add('hidden');
  elements.result.classList.remove('result--win', 'result--lost');
  delete elements.result.dataset.stageId;
  stopWinCelebration();
}

function showStageSelection() {
  audioPhaseKey = '';
  setAudioScene('library');
  elements.stageSelect.classList.remove('hidden');
  elements.mission.classList.add('hidden');
  elements.board.classList.add('hidden');
  elements.gameHelp.classList.add('hidden');
  elements.result.classList.add('hidden');
}

function showGame() {
  elements.stageSelect.classList.add('hidden');
  elements.mission.classList.remove('hidden');
  elements.board.classList.remove('hidden');
  elements.gameHelp.classList.remove('hidden');
}

function clearStageReportMarker() {
  document.querySelectorAll('.stage-report-marker').forEach((marker) => marker.remove());
}

function restoreResultIfNeeded() {
  if (restoreResultAfterReport && lastState && (lastState.phase === 'won' || lastState.phase === 'lost')) {
    elements.result.classList.remove('hidden');
  }
  restoreResultAfterReport = false;
}

function cancelStageReport({ restoreResult = true } = {}) {
  stageReportMode = false;
  pendingStageReport = null;
  elements.board.classList.remove('report-selecting');
  elements.stageReportGuide.classList.add('hidden');
  elements.stageReportDialog.classList.add('hidden');
  elements.stageReportNote.value = '';
  clearStageReportMarker();
  if (restoreResult) restoreResultIfNeeded();
}

function beginStageReport() {
  if (!lastState?.puzzle) {
    showToast('플레이 중인 스테이지가 없어요.');
    return;
  }
  cancelStageReport({ restoreResult: false });
  restoreResultAfterReport = !elements.result.classList.contains('hidden');
  elements.result.classList.add('hidden');
  stageReportMode = true;
  elements.board.classList.add('report-selecting');
  elements.stageReportGuide.classList.remove('hidden');
  showToast('판정되지 않은 차이를 그림에서 눌러 주세요.');
}

function selectStageReportLocation(image, x, y) {
  stageReportMode = false;
  elements.board.classList.remove('report-selecting');
  elements.stageReportGuide.classList.add('hidden');
  clearStageReportMarker();
  const stage = document.querySelector(`.picture[data-image="${image}"] .image-stage`);
  const marker = document.createElement('span');
  marker.className = 'stage-report-marker';
  marker.style.left = `${x * 100}%`;
  marker.style.top = `${y * 100}%`;
  stage.appendChild(marker);
  pendingStageReport = { image, x, y };
  elements.stageReportLocation.textContent = `${lastState.puzzle.title} · 그림 ${image.toUpperCase()} · 선택 위치 ${Math.round(x * 100)}%, ${Math.round(y * 100)}%`;
  elements.stageReportDialog.classList.remove('hidden');
  elements.stageReportNote.focus();
}

async function submitStageReport() {
  if (!pendingStageReport || !lastState?.puzzle) return;
  const { image, x, y } = pendingStageReport;
  const note = elements.stageReportNote.value.trim();
  const puzzle = lastState.puzzle;
  const text = [
    '[틀린그림찾기 판정 누락]',
    `스테이지: ${puzzle.title} (${puzzle.id})`,
    `선택 위치: 그림 ${image.toUpperCase()} / x=${x.toFixed(4)}, y=${y.toFixed(4)}`,
    `등록된 정답 수: ${puzzle.total}`,
    note ? `추가 설명: ${note}` : '',
  ].filter(Boolean).join('\n');

  elements.stageReportSubmit.disabled = true;
  try {
    const response = await fetch('/bug-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        gameId: 'spot-the-difference',
        timestamp: new Date().toISOString(),
        screenSize: { w: screen.width, h: screen.height },
        url: location.href,
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    cancelStageReport();
    showToast('위치와 스테이지 정보가 함께 신고됐어요.');
  } catch (error) {
    console.error('[stage-report] submit failed:', error.message);
    showToast('신고를 보내지 못했어요. 잠시 후 다시 시도해 주세요.');
  } finally {
    elements.stageReportSubmit.disabled = false;
  }
}

function renderStageSelection(message) {
  stageCatalog = (message.stages || []).map((stage) => ({
    ...stage,
    collectionId: stage.collectionId || LEGACY_STAGE_COLLECTION_BY_ID[stage.id] || 'world-adventure',
  }));
  canSelectStage = message.canSelect === true;
  ruleTypes = Array.isArray(message.ruleTypes) ? message.ruleTypes : [];
  selectedRuleType = message.selectedRuleType || selectedRuleType;
  showStageSelection();
  renderDifficultySelector();
  renderStageList();
}

function renderDifficultySelector() {
  elements.difficultyOptions.innerHTML = '';
  for (const difficulty of DIFFICULTY_OPTIONS) {
    const rule = ruleTypes.find((candidate) => candidate.type === difficulty.ruleType);
    if (!rule) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'difficulty-option';
    button.dataset.difficulty = difficulty.value;
    button.dataset.ruleType = difficulty.ruleType;
    button.disabled = !canSelectStage;
    button.setAttribute('aria-pressed', String(difficulty.ruleType === selectedRuleType));
    button.innerHTML = `<span class="difficulty-icon" aria-hidden="true">${difficulty.icon}</span><span class="difficulty-copy"><strong>${difficulty.label}</strong><small>${Math.round(rule.durationMs / 1000)}초 · 오답 -${Math.round(rule.missPenaltyMs / 1000)}초 · 힌트 ${rule.maxHints}회</small></span>`;
    button.addEventListener('click', () => {
      if (!canSelectStage || difficulty.ruleType === selectedRuleType) return;
      audio.play('select');
      selectedRuleType = difficulty.ruleType;
      renderDifficultySelector();
      send({ type: 'SET_DIFFICULTY', ruleType: difficulty.ruleType });
    });
    elements.difficultyOptions.appendChild(button);
  }
}

function renderStageList() {
  elements.stageList.innerHTML = '';
  elements.stageWait.classList.toggle('hidden', canSelectStage);
  elements.randomStage.disabled = !canSelectStage || stageCatalog.length === 0;
  elements.stageCopy.textContent = canSelectStage
    ? '스테이지를 직접 고르거나 완료하지 않은 그림을 랜덤으로 시작하세요.'
    : '방장이 고른 스테이지가 두 플레이어에게 함께 시작됩니다.';

  for (const collection of STAGE_COLLECTIONS) {
    const collectionStages = stageCatalog.filter((stage) => stage.collectionId === collection.id);
    if (!collectionStages.length) continue;
    const completedCount = collectionStages.filter((stage) => completedStages.has(stage.id)).length;
    const section = document.createElement('section');
    section.className = 'stage-collection';
    section.dataset.collectionId = collection.id;

    const heading = document.createElement('div');
    heading.className = 'stage-collection-heading';
    const copy = document.createElement('div');
    copy.innerHTML = `<p class="stage-collection-eyebrow">${collection.eyebrow}</p><h3>${collection.title}</h3><p>${collection.description}</p>`;
    const progress = document.createElement('span');
    progress.className = 'stage-collection-progress';
    progress.textContent = `${completedCount} / ${collectionStages.length} 완료`;
    heading.append(copy, progress);

    const grid = document.createElement('div');
    grid.className = 'stage-grid';
    for (const stage of collectionStages) grid.appendChild(createStageCard(stage));
    section.append(heading, grid);
    elements.stageList.appendChild(section);
  }
}

function createStageCard(stage) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'stage-card';
    card.disabled = !canSelectStage;
    card.dataset.stageId = stage.id;

    const preview = document.createElement('span');
    preview.className = 'stage-card-preview';
    preview.style.backgroundImage = `url("${stage.imageA}")`;

    const badges = document.createElement('span');
    badges.className = 'stage-card-badges';
    if (completedStages.has(stage.id)) {
      const completed = document.createElement('span');
      completed.className = 'stage-badge completed';
      completed.textContent = '완료';
      badges.appendChild(completed);
    }

    const body = document.createElement('span');
    body.className = 'stage-card-body';
    const title = document.createElement('span');
    title.className = 'stage-card-title';
    title.textContent = stage.title;
    const meta = document.createElement('span');
    meta.className = 'stage-card-meta';
    meta.textContent = stage.theme;
    body.append(title, meta);
    card.append(preview, badges, body);
    card.addEventListener('click', () => {
      audio.play('select');
      send({ type: 'SELECT_STAGE', stageId: stage.id });
    });
    return card;
}

function renderMarkers(found, hinted = []) {
  for (const image of ['a', 'b']) {
    const layer = document.querySelector(`.picture[data-image="${image}"] .markers`);
    layer.innerHTML = '';
    for (const difference of found) {
      const marker = document.createElement('span');
      marker.className = 'marker';
      marker.style.left = `${difference.centers[image].x * 100}%`;
      marker.style.top = `${difference.centers[image].y * 100}%`;
      marker.title = difference.label;
      layer.appendChild(marker);
    }
    for (const difference of hinted) {
      const marker = document.createElement('span');
      marker.className = 'marker hint-marker';
      marker.style.left = `${difference.centers[image].x * 100}%`;
      marker.style.top = `${difference.centers[image].y * 100}%`;
      marker.title = '힌트 위치 — 이곳을 눌러 확인하세요';
      marker.setAttribute('aria-label', '힌트 위치');
      layer.appendChild(marker);
    }
  }
}

function renderState(state) {
  lastState = state;
  canSelectStage = state.canSelectStage === true;
  for (const button of [elements.stageButton, elements.nextStageButton, elements.resultRandomStageButton]) {
    button.disabled = !canSelectStage;
    button.title = canSelectStage ? '' : '방장만 다른 스테이지로 이동할 수 있어요.';
  }
  showGame();
  if (elements.board.dataset.stageId !== state.puzzle.id) {
    elements.imageA.src = state.puzzle.imageA;
    elements.imageB.src = state.puzzle.imageB;
    elements.board.dataset.stageId = state.puzzle.id;
  }
  const seconds = Math.ceil(state.remainingMs / 1000);
  elements.timer.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  elements.misses.textContent = String(state.misses);
  elements.progress.innerHTML = '';
  for (let index = 0; index < state.puzzle.total; index += 1) {
    const dot = document.createElement('span');
    dot.className = `progress-dot${index < state.found.length ? ' found' : ''}`;
    elements.progress.appendChild(dot);
  }
  elements.progressLabel.textContent = `${state.found.length} / ${state.puzzle.total}`;
  elements.activeRule.textContent = state.rule ? `${state.rule.icon} ${state.rule.label}` : '';
  elements.activeRule.title = state.rule
    ? `${Math.round(state.rule.durationMs / 1000)}초 · 오답 -${Math.round(state.rule.missPenaltyMs / 1000)}초 · 힌트 ${state.rule.maxHints}회`
    : '';
  elements.hintCount.textContent = String(Math.max(0, state.maxHints - state.hintsUsed));
  elements.hint.disabled = state.phase !== 'playing' || state.hintsUsed >= state.maxHints;
  elements.players.innerHTML = '';
  for (const player of state.players || []) {
    const badge = document.createElement('span');
    badge.className = `player ${player.id}`;
    badge.textContent = `${player.name}${player.id === playerId ? ' (나)' : ''}`;
    elements.players.appendChild(badge);
  }
  elements.status.textContent = (state.players?.length || 0) > 1 ? '둘이 함께 찾는 중!' : '혼자 플레이 중';
  renderMarkers(state.found, state.hinted);

  const nextAudioPhaseKey = `${state.puzzle.id}:${state.phase}`;
  if (audioPhaseKey !== nextAudioPhaseKey) {
    audioPhaseKey = nextAudioPhaseKey;
    if (state.phase === 'playing') setAudioScene('play');
    if (state.phase === 'won') { audio.play('win'); setAudioScene('celebration'); }
    if (state.phase === 'lost') { audio.play('lost'); setAudioScene('result'); }
  }

  if (state.phase === 'won' && !completedStages.has(state.puzzle.id)) {
    completedStages.add(state.puzzle.id);
    localStorage.setItem(COMPLETED_STORAGE_KEY, JSON.stringify([...completedStages]));
  }

  if (state.phase === 'won' || state.phase === 'lost') {
    const won = state.phase === 'won';
    elements.resultIcon.textContent = won ? '✨' : '⌛';
    elements.resultTitle.textContent = won ? '모두 찾았어요!' : '시간이 끝났어요';
    elements.resultCopy.textContent = won ? `틀린 부분 ${state.puzzle.total}개를 모두 발견했어요. 오답 ${state.misses}회!` : `정답 ${state.found.length}/${state.puzzle.total}개를 발견했어요. 표시된 정답을 함께 확인해 보세요.`;
    elements.result.classList.toggle('result--win', won);
    elements.result.classList.toggle('result--lost', !won);
    elements.result.setAttribute('role', won ? 'region' : 'dialog');
    if (won) elements.result.removeAttribute('aria-modal');
    else elements.result.setAttribute('aria-modal', 'true');
    if (!won) {
      clearTimeout(resultTimer);
      resultTimer = null;
      elements.result.classList.remove('hidden');
    } else if (elements.result.dataset.stageId !== state.puzzle.id) {
      elements.result.dataset.stageId = state.puzzle.id;
      elements.result.classList.add('hidden');
      startWinCelebration();
      showToast('모두 찾았어요! 완성된 장면을 잠시 감상해 보세요.');
      resultTimer = setTimeout(() => {
        elements.result.classList.remove('hidden');
        resultTimer = null;
      }, WIN_SCENE_HOLD_MS);
    }
  } else {
    resetResultPresentation();
  }
}

function showPing(image, x, y, kind, owner) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const stage = document.querySelector(`.picture[data-image="${image}"] .image-stage`);
  const ping = document.createElement('span');
  ping.className = `ping ${owner || ''} ${kind === 'miss' ? 'miss' : ''}`;
  if (kind === 'miss') {
    ping.textContent = '×';
    ping.setAttribute('aria-label', '오답 위치');
  }
  ping.style.left = `${x * 100}%`;
  ping.style.top = `${y * 100}%`;
  stage.appendChild(ping);
  setTimeout(() => ping.remove(), kind === 'miss' ? 1_450 : 900);
}

function clearRemoteCursor(owner = null) {
  const selector = owner ? `.remote-cursor[data-player-id="${owner}"]` : '.remote-cursor';
  for (const cursor of document.querySelectorAll(selector)) cursor.remove();
  if (!owner) {
    for (const trail of document.querySelectorAll('.cursor-trail')) trail.remove();
  }
}

function renderRemoteCursor(message) {
  if (message.playerId === playerId) return;
  const layer = document.querySelector(`.picture[data-image="${message.image}"] .cursors`);
  if (!layer) return;

  let cursor = document.querySelector(`.remote-cursor[data-player-id="${message.playerId}"]`);
  if (cursor && cursor.parentElement !== layer) {
    cursor.remove();
    cursor = null;
  }
  if (!cursor) {
    cursor = document.createElement('span');
    cursor.className = `remote-cursor ${message.playerId}`;
    cursor.dataset.playerId = message.playerId;
    const label = document.createElement('span');
    label.className = 'remote-cursor-label';
    label.textContent = lastState?.players?.find((player) => player.id === message.playerId)?.name || '파트너';
    cursor.appendChild(label);
    layer.appendChild(cursor);
  } else if (cursor.dataset.x && cursor.dataset.y) {
    const trail = document.createElement('span');
    trail.className = `cursor-trail ${message.playerId}`;
    trail.style.left = `${Number(cursor.dataset.x) * 100}%`;
    trail.style.top = `${Number(cursor.dataset.y) * 100}%`;
    layer.insertBefore(trail, cursor);
    setTimeout(() => trail.remove(), 700);
  }

  cursor.dataset.x = String(message.x);
  cursor.dataset.y = String(message.y);
  cursor.style.left = `${message.x * 100}%`;
  cursor.style.top = `${message.y * 100}%`;
}

ws.addEventListener('open', () => send({ type: 'JOIN', name }));
ws.addEventListener('close', () => { clearRemoteCursor(); elements.status.textContent = '연결이 끊겼어요. 로비에서 다시 입장해 주세요.'; });
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.type === 'JOINED') playerId = message.playerId;
  if (message.type === 'GAME_START') { clearRemoteCursor(); resetResultPresentation(); }
  if (message.type === 'STAGE_SELECTION') renderStageSelection(message);
  if (message.type === 'STATE') renderState(message);
  if (message.type === 'ERROR') showToast(message.message || '문제가 발생했어요.');
  if (message.type === 'CURSOR') renderRemoteCursor(message);
  if (message.type === 'CURSOR_LEAVE') clearRemoteCursor(message.playerId);
  if (message.type === 'PLAYER_LEFT') { clearRemoteCursor(message.playerId); showToast('함께하던 플레이어가 나갔어요.'); }
  if (message.type === 'FEEDBACK') {
    if (message.image) showPing(message.image, message.x, message.y, message.kind, message.playerId);
    if (message.kind === 'found') showToast(`찾았다! ${message.difference.label}`);
    if (message.kind === 'already') showToast('이미 찾은 곳이에요.');
    if (message.kind === 'miss') showToast(`아까워요! ${Math.round((lastState?.rule?.missPenaltyMs || 5_000) / 1000)}초 차감`);
    if (message.kind === 'hint') showToast('힌트 위치를 표시했어요. 표시된 곳을 눌러보세요!');
    if (message.kind === 'found') audio.play('found');
    if (message.kind === 'already') audio.play('already');
    if (message.kind === 'miss') audio.play('miss');
    if (message.kind === 'hint') audio.play('hint');
  }
});

for (const picture of document.querySelectorAll('.picture')) {
  const stage = picture.querySelector('.image-stage');
  stage.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch' || !lastState || lastState.phase !== 'playing') return;
    const now = performance.now();
    if (now - lastCursorSentAt < CURSOR_INTERVAL_MS) return;
    const rect = stage.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    lastCursorSentAt = now;
    activeCursorImage = picture.dataset.image;
    send({ type: 'CURSOR', image: activeCursorImage, x, y });
  });
  stage.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'touch' || activeCursorImage !== picture.dataset.image) return;
    activeCursorImage = null;
    send({ type: 'CURSOR_LEAVE' });
  });
  stage.addEventListener('pointerdown', (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    if (stageReportMode) {
      selectStageReportLocation(picture.dataset.image, x, y);
      return;
    }
    if (!lastState || lastState.phase !== 'playing') return;
    send({ type: 'GUESS', image: picture.dataset.image, x, y, clientActionId: crypto.randomUUID() });
  });
}

elements.hint.addEventListener('click', () => send({ type: 'HINT' }));
elements.randomStage.addEventListener('click', () => {
  if (!canSelectStage || !stageCatalog.length) return;
  audio.play('select');
  const incomplete = stageCatalog.filter((stage) => !completedStages.has(stage.id));
  const pool = incomplete.length ? incomplete : stageCatalog;
  const selected = pool[Math.floor(Math.random() * pool.length)];
  send({ type: 'SELECT_STAGE', stageId: selected.id });
});
document.querySelector('#restart-button').addEventListener('click', () => { audio.play('select'); send({ type: 'RESTART' }); });
elements.nextStageButton.addEventListener('click', () => { audio.play('select'); send({ type: 'NEXT_STAGE' }); });
elements.resultRandomStageButton.addEventListener('click', () => { audio.play('select'); send({ type: 'RANDOM_STAGE' }); });
elements.stageButton.addEventListener('click', () => { audio.play('select'); send({ type: 'BACK_TO_STAGES' }); });
document.querySelector('#lobby-button').addEventListener('click', () => { location.href = '/'; });
elements.audioToggle.addEventListener('click', () => {
  audio.toggleMuted();
  updateAudioToggle();
});
elements.stageReportButton.addEventListener('click', beginStageReport);
elements.resultReportButton.addEventListener('click', beginStageReport);
elements.stageReportCancel.addEventListener('click', () => cancelStageReport());
elements.stageReportReselect.addEventListener('click', beginStageReport);
elements.stageReportSubmit.addEventListener('click', submitStageReport);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && (stageReportMode || pendingStageReport)) cancelStageReport();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) audio.stopMusic();
  else audio.startMusic(audioScene);
});
updateAudioToggle();
