import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGame, snapshot } from '../game.js';
import { DEFAULT_STAGE, getStage, publishedStageSummaries, readPublishedStages } from '../stages.js';

test('스테이지 카탈로그는 완전히 검증된 뒤에만 로드된다', (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'spot-stages-'));
  const catalogPath = path.join(directory, 'stages.json');
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const validStage = {
    id: 'reload-test-01', status: 'published', title: '리로드 테스트', imageA: 'a.png', imageB: 'b.png',
    collectionId: 'test-collection', stageType: 'classic',
    durationMs: 60_000, differences: [{ id: 'one', zones: { a: {}, b: {} } }],
  };
  writeFileSync(catalogPath, JSON.stringify([validStage]));
  assert.equal(readPublishedStages(catalogPath)[0].id, 'reload-test-01');

  writeFileSync(catalogPath, JSON.stringify([validStage, validStage]));
  assert.throws(() => readPublishedStages(catalogPath), /duplicate published stage id/);
});

test('게시된 스테이지 카탈로그는 게임에 필요한 공개 메타데이터를 제공한다', () => {
  const stages = publishedStageSummaries();
  assert.equal(stages.length, 65);
  assert.equal(getStage('japanese-comics-snowy-onsen-05'), null);
  assert.equal(getStage('japanese-comics-glasshouse-atelier-05')?.title, '봄빛 유리온실 화실');
  assert.equal(getStage('wonder-park-dream-gate-01')?.title, '꿈빛 입장 광장');
  assert.equal(getStage('wonder-park-carousel-garden-02')?.title, '햇살 회전목마 정원');
  assert.equal(getStage('wonder-park-candy-parade-03')?.title, '캔디 퍼레이드 거리');
  assert.equal(getStage('wonder-park-moonboat-lagoon-04')?.title, '노을빛 문보트 라군');
  assert.equal(getStage('goblin-night-moon-rabbit-mill-01')?.title, '달토끼 떡방앗간');
  assert.equal(getStage('goblin-night-snack-stall-02')?.title, '도깨비 야식 포장마차');
  assert.equal(getStage('goblin-night-mask-workshop-03')?.title, '달빛 도깨비 탈 공방');
  assert.equal(getStage('goblin-night-moon-ferry-dock-04')?.title, '달빛 도깨비 나룻터');
  assert.equal(getStage('goblin-night-cloud-garden-05')?.title, '산신령의 구름 정원');
  assert.equal(getStage('tiny-things-teacup-harbor-01')?.title, '찻잔 항구');
  assert.equal(getStage('tiny-things-thread-station-02')?.title, '실타래 기차역');
  assert.equal(getStage('tiny-things-button-garden-03')?.title, '단추꽃 정원');
  assert.equal(getStage('tiny-things-planter-jungle-04')?.title, '화분 정글 탐험대');
  assert.equal(getStage('cat-detective-rainy-office-01')?.title, '빗소리 고양이 탐정 사무소');
  assert.equal(getStage('cat-detective-moonlit-museum-02')?.title, '달빛 박물관 잠입 수사');
  assert.equal(getStage('cat-detective-foggy-platform-03')?.title, '안개 기차역의 수하물 추적');
  assert.equal(getStage('animal-detectives-snow-train-03')?.title, '설원 특급열차의 식당칸');
  assert.equal(getStage('animal-detectives-masquerade-04')?.title, '가면무도회 저택의 단서');
  assert.equal(getStage('animal-detectives-moonlit-lighthouse-05')?.title, '달빛 등대의 마지막 신호');
  assert.equal(getStage('magic-delivery-starlight-post-01')?.title, '별빛 중앙우체국의 아침');
  assert.equal(getStage('magic-delivery-dragon-peak-05')?.title, '용의 산 정상 특별 배송');
  assert.equal(getStage('magic-delivery-broom-workshop-02')?.title, '빗자루 택배 정비소');
  assert.equal(getStage('magic-delivery-cloud-airship-dock-03')?.title, '구름섬 비행선 우편 선착장');
  assert.equal(getStage('magic-delivery-moonlit-canal-boat-04')?.title, '달빛 운하 우편선');
  assert.equal(getStage('toy-kingdom-block-castle-01')?.title, '블록 왕국 성문');
  assert.equal(getStage('dragon-academy-potion-lab-03')?.title, '별빛 물약 실험 수업');
  for (const id of [
    'cat-detective-rainy-office-01',
    'cat-detective-moonlit-museum-02',
    'cat-detective-foggy-platform-03',
    'cat-detective-stormy-harbor-04',
    'cat-detective-midnight-theater-05',
    'magic-delivery-starlight-post-01',
    'magic-delivery-broom-workshop-02',
    'magic-delivery-cloud-airship-dock-03',
    'magic-delivery-moonlit-canal-boat-04',
    'magic-delivery-dragon-peak-05',
  ]) {
    const stage = getStage(id);
    assert.equal(stage?.difficulty, '어려움');
    assert.equal(stage?.differences.length, 5);
  }
  assert.equal(getStage('dragon-academy-potion-lab-03')?.stageType, 'speed');
  assert.equal(getStage('dragon-academy-potion-lab-03')?.difficulty, '어려움');
  assert.equal(getStage('dragon-academy-potion-lab-03')?.durationMs, 75_000);
  assert.equal(getStage('dragon-academy-potion-lab-03')?.maxHints, 1);
  assert.equal(getStage('dragon-academy-potion-lab-03')?.imageB, 'assets/puzzles/dragon-academy-potion-lab-03-b-balanced.png');
  assert.equal(getStage('dragon-academy-moon-observatory-04')?.title, '달빛 천문탑 관측 수업');
  assert.equal(getStage('dragon-academy-starlight-graduation-05')?.title, '별구름 졸업 축제');
  assert.equal(getStage('toy-kingdom-windup-train-station-02')?.title, '태엽 기차역');
  assert.equal(getStage('toy-kingdom-music-box-plaza-03')?.title, '오르골 광장');
  assert.equal(getStage('toy-kingdom-patchwork-dragon-bridge-04')?.title, '봉제 용 다리');
  assert.equal(getStage('toy-kingdom-star-crown-palace-05')?.title, '별왕관 궁전');
  for (const [id, expectedDifferenceId] of [
    ['toy-kingdom-block-castle-01', 'missing-middle-castle-crenellation'],
    ['toy-kingdom-windup-train-station-02', 'shorter-station-clock-hand'],
    ['toy-kingdom-music-box-plaza-03', 'missing-middle-brass-bell-clapper'],
    ['toy-kingdom-patchwork-dragon-bridge-04', 'missing-middle-lantern-cap'],
    ['toy-kingdom-star-crown-palace-05', 'shorter-middle-star-lantern-point'],
  ]) {
    const stage = getStage(id);
    assert.equal(stage?.difficulty, '어려움');
    assert.equal(stage?.differences.length, 5);
    assert.ok(stage?.differences.some((difference) => difference.id === expectedDifferenceId));
  }
  assert.equal(
    getStage('dragon-academy-moon-observatory-04')?.differences[0].id,
    'shorter-dragon-neckerchief-tail',
  );
  assert.equal(getStage('dragon-academy-hatchery-classroom-01')?.title, '아기 용 부화 교실');
  assert.equal(getStage('dragon-academy-cloud-flight-class-02')?.title, '구름 운동장 비행 수업');
  assert.deepEqual(stages.find((stage) => stage.id === 'night-market-01'), {
    id: 'night-market-01',
    title: '달빛 야시장',
    description: '등불이 빛나는 야시장에서 다섯 가지 차이를 찾아보세요.',
    theme: '야시장',
    collectionId: 'moonlight-mystery',
    stageType: 'speed',
    difficulty: '어려움',
    imageA: 'assets/puzzles/night-market-a.webp',
    total: 5,
    durationMs: 75_000,
  });
  assert.deepEqual(stages.find((stage) => stage.id === 'moonlit-greenhouse-01'), {
    id: 'moonlit-greenhouse-01',
    title: '달빛 온실',
    description: '달빛이 스며드는 신비한 온실에서 다섯 가지 차이를 찾아보세요.',
    theme: '마법 온실',
    collectionId: 'moonlight-mystery',
    stageType: 'relaxed',
    difficulty: '쉬움',
    imageA: 'assets/puzzles/moonlit-greenhouse-01-a.png',
    total: 5,
    durationMs: 120_000,
  });
  assert.deepEqual(stages.find((stage) => stage.id === 'moonlit-clockwork-shop-01'), {
    id: 'moonlit-clockwork-shop-01',
    title: '달빛 시계공방',
    description: '달빛 아래 잠든 마법 시계공방에서 다섯 가지 차이를 찾아보세요.',
    theme: '마법 시계공방',
    collectionId: 'moonlight-mystery',
    stageType: 'classic',
    difficulty: '보통',
    imageA: 'assets/puzzles/moonlit-clockwork-shop-01-a.png',
    total: 5,
    durationMs: 90_000,
  });
  assert.deepEqual(stages.find((stage) => stage.id === 'moonlit-puppet-theater-01'), {
    id: 'moonlit-puppet-theater-01',
    title: '달빛 인형극장',
    description: '달빛 막이 오른 마법 인형극장에서 다섯 가지 차이를 찾아보세요.',
    theme: '마법 인형극장',
    collectionId: 'moonlight-mystery',
    stageType: 'classic',
    difficulty: '어려움',
    imageA: 'assets/puzzles/moonlit-puppet-theater-01-a.png',
    total: 5,
    durationMs: 90_000,
  });
  assert.deepEqual(stages.find((stage) => stage.id === 'jungle-treehouse-01'), {
    id: 'jungle-treehouse-01',
    title: '초록빛 정글 나무집',
    description: '신비한 정글 나무집에서 다섯 가지 차이를 찾아보세요.',
    theme: '정글 나무집',
    collectionId: 'world-adventure',
    stageType: 'classic',
    difficulty: '보통',
    imageA: 'assets/puzzles/jungle-treehouse-01-a.png',
    total: 5,
    durationMs: 90_000,
  });
  assert.deepEqual(stages.find((stage) => stage.id === 'starlit-desert-ruins-01'), {
    id: 'starlit-desert-ruins-01',
    title: '별빛 사막 유적',
    description: '별이 쏟아지는 사막의 고대 관측 유적에서 다섯 가지 차이를 찾아보세요.',
    theme: '사막 천문 유적',
    collectionId: 'world-adventure',
    stageType: 'classic',
    difficulty: '보통',
    imageA: 'assets/puzzles/starlit-desert-ruins-01-a.png',
    total: 5,
    durationMs: 90_000,
  });
  assert.deepEqual(stages.find((stage) => stage.id === 'firefly-summer-camp-01'), {
    id: 'firefly-summer-camp-01',
    title: '반딧불 여름 캠핑장',
    description: '반딧불이 춤추는 여름밤 숲속 캠핑장에서 다섯 가지 차이를 찾아보세요.',
    theme: '여름밤 숲속 캠핑',
    collectionId: 'seasonal-stories',
    stageType: 'classic',
    difficulty: '보통',
    imageA: 'assets/puzzles/firefly-summer-camp-01-a.png',
    total: 5,
    durationMs: 90_000,
  });
  assert.deepEqual(stages.find((stage) => stage.id === 'autumn-alchemy-kitchen-01'), {
    id: 'autumn-alchemy-kitchen-01',
    title: '단풍빛 연금술 부엌',
    description: '가을 향기 가득한 연금술 부엌에서 다섯 가지 차이를 찾아보세요.',
    theme: '가을 연금술 부엌',
    collectionId: 'seasonal-stories',
    stageType: 'classic',
    difficulty: '보통',
    imageA: 'assets/puzzles/autumn-alchemy-kitchen-01-a.png',
    total: 5,
    durationMs: 90_000,
  });
  assert.deepEqual(stages.find((stage) => stage.id === 'spring-rain-umbrella-shop-01'), {
    id: 'spring-rain-umbrella-shop-01',
    title: '봄비 우산 수리점',
    description: '봄비가 내리는 아늑한 우산 수리점에서 다섯 가지 차이를 찾아보세요.',
    theme: '봄비 우산 수리점',
    collectionId: 'seasonal-stories',
    stageType: 'relaxed',
    difficulty: '쉬움',
    imageA: 'assets/puzzles/spring-rain-umbrella-shop-01-a.png',
    total: 5,
    durationMs: 120_000,
  });
  assert.deepEqual(stages.find((stage) => stage.id === 'retro-comic-robot-garage-01'), {
    id: 'retro-comic-robot-garage-01',
    title: '팝! 로봇 정비소',
    description: '강렬한 망점과 잉크선으로 그린 복고풍 로봇 정비소에서 다섯 가지 차이를 찾아보세요.',
    theme: '레트로 만화 로봇 정비소',
    collectionId: 'style-lab',
    stageType: 'classic',
    difficulty: '보통',
    imageA: 'assets/puzzles/retro-comic-robot-garage-01-a.png',
    total: 5,
    durationMs: 90_000,
  });
  assert.deepEqual(stages.find((stage) => stage.id === 'retro-comic-space-diner-02'), {
    id: 'retro-comic-space-diner-02',
    title: '팝! 우주 배달 식당',
    description: '강렬한 망점과 잉크선으로 그린 복고풍 우주 식당에서 다섯 가지 차이를 찾아보세요.',
    theme: '레트로 만화 우주 배달 식당',
    collectionId: 'style-lab',
    stageType: 'classic',
    difficulty: '보통',
    imageA: 'assets/puzzles/retro-comic-space-diner-02-a.png',
    total: 5,
    durationMs: 90_000,
  });
  assert.deepEqual(stages.find((stage) => stage.id === 'retro-comic-monster-tv-studio-03'), {
    id: 'retro-comic-monster-tv-studio-03',
    title: '팝! 괴물 TV 스튜디오',
    description: '강렬한 망점과 잉크선으로 그린 복고풍 괴물 방송국에서 다섯 가지 차이를 찾아보세요.',
    theme: '레트로 만화 괴물 TV 스튜디오',
    collectionId: 'style-lab',
    stageType: 'classic',
    difficulty: '보통',
    imageA: 'assets/puzzles/retro-comic-monster-tv-studio-03-a.png',
    total: 5,
    durationMs: 90_000,
  });
  assert.deepEqual(stages.find((stage) => stage.id === 'retro-comic-alien-laundromat-04'), {
    id: 'retro-comic-alien-laundromat-04',
    title: '팝! 외계인 세탁소',
    description: '강렬한 망점과 잉크선으로 그린 복고풍 우주 세탁소에서 다섯 가지 차이를 찾아보세요.',
    theme: '레트로 만화 외계인 세탁소',
    collectionId: 'style-lab',
    stageType: 'classic',
    difficulty: '보통',
    imageA: 'assets/puzzles/retro-comic-alien-laundromat-04-a.png',
    total: 5,
    durationMs: 90_000,
  });
  assert.deepEqual(stages.find((stage) => stage.id === 'retro-comic-moon-barbershop-05'), {
    id: 'retro-comic-moon-barbershop-05',
    title: '팝! 달 기지 이발소',
    description: '강렬한 망점과 잉크선으로 그린 복고풍 달 기지 이발소에서 다섯 가지 차이를 찾아보세요.',
    theme: '레트로 만화 달 기지 이발소',
    collectionId: 'style-lab',
    stageType: 'classic',
    difficulty: '보통',
    imageA: 'assets/puzzles/retro-comic-moon-barbershop-05-a.png',
    total: 5,
    durationMs: 90_000,
  });
  assert.deepEqual(stages.find((stage) => stage.id === 'japanese-comics-manga-studio-01'), {
    id: 'japanese-comics-manga-studio-01',
    title: '빗소리 만화 작업실',
    description: '마감 전야의 만화가 작업실에서 섬세한 차이를 찾아보세요.',
    theme: '비 오는 밤의 만화 작업실',
    collectionId: 'japanese-comics',
    stageType: 'classic',
    difficulty: '보통',
    imageA: 'assets/puzzles/japanese-comics-manga-studio-01-a.png',
    total: 5,
    durationMs: 90_000,
  });
  assert.deepEqual(stages.find((stage) => stage.id === 'japanese-comics-seaside-platform-02'), {
    id: 'japanese-comics-seaside-platform-02',
    title: '노을빛 해변 승강장',
    description: '바닷바람이 스치는 작은 승강장의 영화 같은 순간에서 다섯 가지 차이를 찾아보세요.',
    theme: '노을빛 해변 열차 승강장',
    collectionId: 'japanese-comics',
    stageType: 'classic',
    difficulty: '보통',
    imageA: 'assets/puzzles/japanese-comics-seaside-platform-02-a.png',
    total: 5,
    durationMs: 90_000,
  });
  assert.deepEqual(stages.find((stage) => stage.id === 'japanese-comics-rooftop-observatory-03'), {
    id: 'japanese-comics-rooftop-observatory-03',
    title: '별빛 옥상 관측회',
    description: '도시의 불빛 위로 별이 떠오르는 옥상 관측회에서 다섯 가지 차이를 찾아보세요.',
    theme: '푸른 저녁의 옥상 천문 관측회',
    collectionId: 'japanese-comics',
    stageType: 'classic',
    difficulty: '보통',
    imageA: 'assets/puzzles/japanese-comics-rooftop-observatory-03-a.png',
    total: 5,
    durationMs: 90_000,
  });
  assert.deepEqual(stages.find((stage) => stage.id === 'japanese-comics-summer-festival-04'), {
    id: 'japanese-comics-summer-festival-04',
    title: '초롱빛 여름 축제',
    description: '초롱불이 반짝이는 여름밤 신사 축제에서 다섯 가지 차이를 찾아보세요.',
    theme: '여름밤 신사 축제 산책길',
    collectionId: 'japanese-comics',
    stageType: 'classic',
    difficulty: '보통',
    imageA: 'assets/puzzles/japanese-comics-summer-festival-04-a.png',
    total: 5,
    durationMs: 90_000,
  });
  assert.equal(getStage('missing-stage'), null);
});

test('게임 인스턴스는 선택한 게시 스테이지에 고정된다', () => {
  const now = 10_000;
  const game = createGame(now, DEFAULT_STAGE.id);
  assert.equal(game.puzzle.id, DEFAULT_STAGE.id);
  assert.equal(snapshot(game, now).puzzle.id, DEFAULT_STAGE.id);
  assert.throws(() => createGame(now, 'missing-stage'), /unknown published stage/);
});
