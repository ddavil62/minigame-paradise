/**
 * @fileoverview 다섯 레벨을 좌표 대입이나 테스트 전용 진행 없이 실제 입력과 30Hz 물리로 완주한다.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { LEVELS, validateLevel } from '../shared/levels.js';
import { runPhysicalPlaythrough } from './helpers/physical-playthrough.js';

test('물리 완주 드라이버는 강제 진행 API를 포함하지 않는다', () => {
  const source = fs.readFileSync(new URL('./helpers/physical-playthrough.js', import.meta.url), 'utf8');
  const forbidden = ['advance' + 'ModuleForTesting', 'trigger' + 'FinishForTesting', '/__test/' + 'advance', '/__test/' + 'finish', 'Object.assign(simulation.players'];
  forbidden.forEach((token) => assert.equal(source.includes(token), false, token));
});

for (const level of LEVELS) {
  test(`${level.id}는 INPUT과 30Hz 물리만으로 부스트 8회와 결승을 완주한다`, () => {
    const result = runPhysicalPlaythrough(level.id);
    assert.equal(result.simulation.phase, 'result');
    assert.equal(result.simulation.checkpointId, 8);
    assert.equal(result.simulation.falls, 0);
    assert.equal(result.boosts.length, level.modules.filter((module) => module.boostRequired).length);
    assert.equal(new Set(result.boosts.map((event) => event.eventId)).size, result.boosts.length);
    assert.equal(result.events.filter((event) => event.kind === 'GAME_COMPLETED').length, 1);
    assert.equal(validateLevel(level).ok, true, validateLevel(level).errors.join(','));
  });
}
