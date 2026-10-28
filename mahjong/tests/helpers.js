/**
 * @fileoverview 테스트 공용: AI 4명이 한 대국을 끝까지 진행하는 드라이버.
 */
import { MahjongGame } from '../lib/game.js';
import { decide } from '../lib/ai.js';
import { seededRng } from '../lib/tiles.js';

/**
 * @param {number} seed 시드
 * @param {{settings?:object, levels?:string[], maxSteps?:number, onStep?:Function}} [opts] 옵션
 * @returns {{game:MahjongGame, steps:number, hands:number}} 결과
 */
export function playFullMatch(seed, opts = {}) {
  const rng = seededRng(seed);
  const game = new MahjongGame({ settings: opts.settings, rng });
  const levels = opts.levels || ['normal', 'normal', 'normal', 'normal'];
  game.start();
  let steps = 0;
  const max = opts.maxSteps || 200000;
  while (game.pending && steps < max) {
    const p = game.pending;
    let seats;
    if (p.type === 'turn') seats = [p.seat];
    else if (p.type === 'reaction') seats = Object.keys(p.eligible).map(Number).filter((s) => !p.responses[s]);
    else seats = [0, 1, 2, 3].filter((s) => !p.acks.has(s));
    const s = seats[0];
    const view = game.viewFor(s);
    const action = decide(view, { level: levels[s], rng });
    const res = game.act(s, action);
    if (!res.ok) throw new Error(`seed ${seed} step ${steps}: seat ${s} action ${JSON.stringify(action)} rejected ${res.error}`);
    if (opts.onStep) opts.onStep(game, s, action);
    steps++;
  }
  if (game.pending) throw new Error(`seed ${seed}: 대국이 ${max}스텝 안에 끝나지 않음`);
  return { game, steps, hands: game.handNo };
}
