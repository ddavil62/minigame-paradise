import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, guess } from '../game.js';

const reports = [
  { report: 81, stageId: 'dragon-academy-hatchery-classroom-01', x: 0.8509, y: 0.1969, differenceId: 'silver-middle-stoppers' },
  { report: 82, stageId: 'dragon-academy-hatchery-classroom-01', x: 0.5131, y: 0.2882, differenceId: 'round-middle-egg-gem' },
  { report: 83, stageId: 'dragon-academy-cloud-flight-class-02', x: 0.1766, y: 0.3386, differenceId: 'turquoise-owl-clasp' },
  { report: 84, stageId: 'dragon-academy-cloud-flight-class-02', x: 0.7111, y: 0.5813, differenceId: 'silver-blue-dragon-horns' },
  { report: 85, stageId: 'dragon-academy-cloud-flight-class-02', x: 0.4781, y: 0.3542, differenceId: 'ivory-red-dragon-horn-tip' },
  { report: 86, stageId: 'dragon-academy-potion-lab-03', x: 0.9053, y: 0.8085, differenceId: 'triangular-spellbook-clasp' },
  { report: 87, stageId: 'dragon-academy-potion-lab-03', x: 0.5001, y: 0.2959, differenceId: 'silver-crescent-badge' },
  { report: 88, stageId: 'dragon-academy-potion-lab-03', x: 0.1960, y: 0.1930, differenceId: 'purple-potion-cork' },
  { report: 89, stageId: 'dragon-academy-potion-lab-03', x: 0.7551, y: 0.3309, differenceId: 'blue-right-scale-crystal' },
  { report: 90, stageId: 'dragon-academy-potion-lab-03', x: 0.2050, y: 0.7794, differenceId: 'four-point-cauldron-star' },
];

const falsePositiveReports = [
  { report: 91, stageId: 'toy-kingdom-block-castle-01', image: 'b', x: 0.4367, y: 0.6124 },
  { report: 92, stageId: 'toy-kingdom-windup-train-station-02', image: 'a', x: 0.4183, y: 0.2144 },
  { report: 93, stageId: 'toy-kingdom-music-box-plaza-03', image: 'a', x: 0.2022, y: 0.4978 },
  { report: 94, stageId: 'toy-kingdom-music-box-plaza-03', image: 'b', x: 0.4755, y: 0.4940 },
  { report: 95, stageId: 'toy-kingdom-star-crown-palace-05', image: 'b', x: 0.3280, y: 0.6182 },
];

const retainedTargets = [
  { stageId: 'toy-kingdom-block-castle-01', x: 0.34, y: 0.60, differenceId: 'missing-elephant-saddle-stud' },
  { stageId: 'toy-kingdom-windup-train-station-02', x: 0.365, y: 0.17, differenceId: 'coral-chimney-bird-beak' },
  { stageId: 'toy-kingdom-music-box-plaza-03', x: 0.18, y: 0.445, differenceId: 'missing-elephant-ear-stitch' },
  { stageId: 'toy-kingdom-music-box-plaza-03', x: 0.49, y: 0.535, differenceId: 'missing-ballerina-skirt-bead' },
  { stageId: 'toy-kingdom-star-crown-palace-05', x: 0.315, y: 0.585, differenceId: 'missing-lion-bow-stitch' },
];

const latestReports = [
  { report: 96, stageId: 'toy-kingdom-block-castle-01', image: 'b', x: 0.3862, y: 0.6007, differenceId: 'missing-elephant-saddle-stud' },
  { report: 97, stageId: 'toy-kingdom-music-box-plaza-03', image: 'a', x: 0.1918, y: 0.4435, differenceId: 'missing-elephant-ear-stitch' },
  { report: 98, stageId: 'toy-kingdom-music-box-plaza-03', image: 'a', x: 0.4973, y: 0.5347, differenceId: 'missing-ballerina-skirt-bead' },
  { report: 99, stageId: 'toy-kingdom-star-crown-palace-05', image: 'a', x: 0.3096, y: 0.5930, differenceId: 'missing-lion-bow-stitch' },
  { report: 100, stageId: 'magic-delivery-broom-workshop-02', image: 'b', x: 0.1727, y: 0.3988, differenceId: 'square-toolbox-handle' },
  { report: 101, stageId: 'magic-delivery-broom-workshop-02', image: 'b', x: 0.7448, y: 0.7638, differenceId: 'bat-wing-delivery-bag' },
  { report: 102, stageId: 'magic-delivery-broom-workshop-02', image: 'b', x: 0.4626, y: 0.3755, differenceId: 'green-mechanic-goggles' },
  { report: 103, stageId: 'magic-delivery-cloud-airship-dock-03', image: 'b', x: 0.4639, y: 0.4998, differenceId: 'green-otter-scarf' },
];

for (const report of latestReports) {
  test(`latest report #${report.report} is accepted at the submitted coordinate`, () => {
    const game = createGame(1_000, report.stageId);
    const result = guess(game, {
      image: report.image,
      x: report.x,
      y: report.y,
      playerId: 'report-regression',
    }, 1_000);

    assert.equal(result.kind, 'found');
    assert.equal(result.difference.id, report.differenceId);
  });
}

for (const report of reports) {
  test(`판정 누락 신고 #${report.report} 좌표를 정답으로 판정한다`, () => {
    const game = createGame(1_000, report.stageId);
    const result = guess(game, {
      image: 'b',
      x: report.x,
      y: report.y,
      playerId: 'report-regression',
    }, 1_000);

    assert.equal(result.kind, 'found');
    assert.equal(result.difference.id, report.differenceId);
  });
}

for (const report of falsePositiveReports) {
  test(`false-positive report #${report.report} is no longer accepted as a difference`, () => {
    const game = createGame(1_000, report.stageId);
    const result = guess(game, {
      image: report.image,
      x: report.x,
      y: report.y,
      playerId: 'report-regression',
    }, 1_000);

    assert.equal(result.kind, 'miss');
  });
}

for (const target of retainedTargets) {
  test(`${target.differenceId} keeps a focused tappable area`, () => {
    const game = createGame(1_000, target.stageId);
    const result = guess(game, {
      image: 'b',
      x: target.x,
      y: target.y,
      playerId: 'report-regression',
    }, 1_000);

    assert.equal(result.kind, 'found');
    assert.equal(result.difference.id, target.differenceId);
  });
}
