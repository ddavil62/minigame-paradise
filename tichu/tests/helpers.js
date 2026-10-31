/**
 * @fileoverview 테스트 공용: AI 4명이 한 대국을 끝까지 진행하는 드라이버.
 */
import { TichuGame } from '../lib/game.js';
import { decide, fallbackAction } from '../lib/ai.js';
import { seededRng } from '../lib/cards.js';

/**
 * @param {number} seed 시드
 * @param {{settings?:object, levels?:string[], maxSteps?:number, onStep?:Function}} [opts] 옵션
 * @returns {{game:TichuGame, steps:number}} 결과
 */
export function playFullMatch(seed, opts = {}) {
  const rng = seededRng(seed);
  const game = new TichuGame({ settings: { bombWindowMs: 0, ...(opts.settings || {}) }, rng, now: () => 0 });
  const levels = opts.levels || ['normal', 'normal', 'normal', 'normal'];
  game.start();
  let steps = 0;
  const max = opts.maxSteps || 100000;
  while (game.pending && steps < max) {
    const seat = game.waitingSeats()[0];
    const view = game.viewFor(seat);
    let action = decide(view, { level: levels[seat], rng });
    let res = game.act(seat, action);
    if (!res.ok) {
      const fb = fallbackAction(view);
      throw new Error(`seed ${seed} step ${steps}: seat ${seat} ${JSON.stringify(action)} 거절 ${res.error} (fallback ${JSON.stringify(fb)})`);
    }
    if (opts.onStep) opts.onStep(game, seat, action);
    steps++;
  }
  if (game.pending) throw new Error(`seed ${seed}: 대국이 ${max}스텝 안에 끝나지 않음`);
  return { game, steps };
}
