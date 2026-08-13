/**
 * @fileoverview 서버가 발급한 일회성 토큰으로 참여하는 사천성 보통 난이도 WebSocket AI 봇.
 */
import { WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';
import { chooseAiItem, chooseLegalPair, planAiDelay } from './lib/ai.js';
import { createPrng, deriveSeed } from './lib/prng.js';

export class AiController {
  /** @param {{url:string,random?:()=>number,setTimer?:typeof setTimeout,clearTimer?:typeof clearTimeout}} options 설정 */
  constructor(options) { this.url = options.url; this.random = options.random || Math.random; this.setTimer = options.setTimer || setTimeout; this.clearTimer = options.clearTimer || clearTimeout; this.socket = null; this.snapshot = null; this.timer = null; this.pending = false; this.paused = false; this.ordinal = 0; this.lastMatchId = null; this.rematchMatchId = null; this.lastInventoryLength = 0; this.lastBoardRevision = 0; this.disruptionSignature = ''; this.disruptionActions = 0; this.resolvedDeadlockId = null; }
  /** @returns {void} 연결을 시작한다. */
  connect() { this.socket = new WebSocket(this.url); this.socket.on('message', (data) => this.onMessage(data)); this.socket.on('close', () => this.dispose()); }
  /** @param {object} payload 메시지 @returns {void} */
  send(payload) { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ ...payload, requestId: `ai-${Date.now()}-${++this.ordinal}` })); }
  /** @param {Buffer|string} raw 원문 @returns {void} */
  onMessage(raw) {
    let message; try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.type === 'JOINED') { this.send({ type: 'READY' }); return; }
    if (message.type === 'CONNECTION_STATE') { this.paused = message.opponentConnected === false; if (!this.paused) this.schedule(); else this.cancelTimer(); return; }
    if (message.type === 'PAIR_ACCEPTED' || message.type === 'PAIR_REJECTED' || message.type === 'ITEM_RESOLVED') this.pending = false;
    if (message.type === 'START' || message.type === 'STATE_SYNC') { this.snapshot = message.snapshot; this.handleSnapshot(message.type === 'START'); }
  }
  /** @param {boolean} first 새 경기 여부 @returns {void} */
  handleSnapshot(first) {
    if (!this.snapshot) return;
    if (this.snapshot.matchId !== this.lastMatchId) { this.lastMatchId = this.snapshot.matchId; this.rematchMatchId = null; this.pending = false; this.ordinal = 0; this.random = createPrng(deriveSeed(this.snapshot.matchSeed, 'normal-ai')); this.lastInventoryLength = this.snapshot.me.inventory.length; this.lastBoardRevision = this.snapshot.me.board?.revision || 0; this.disruptionSignature = ''; this.disruptionActions = 0; this.resolvedDeadlockId = null; }
    if (this.snapshot.phase === 'result') { if (this.rematchMatchId !== this.snapshot.matchId) { this.cancelTimer(); this.rematchMatchId = this.snapshot.matchId; const matchId = this.snapshot.matchId; this.timer = this.setTimer(() => { this.timer = null; this.send({ type: 'REMATCH', matchId }); }, 550); } return; }
    if (this.snapshot.phase === 'playing' || this.snapshot.phase === 'countdown') {
      const deadlock = this.snapshot.me.deadlock;
      if (deadlock) {
        if (deadlock.phase === 'choice' && this.resolvedDeadlockId !== deadlock.deadlockId) {
          this.resolvedDeadlockId = deadlock.deadlockId; this.cancelTimer();
          const matchId = this.snapshot.matchId; const deadlockId = deadlock.deadlockId;
          this.timer = this.setTimer(() => { this.timer = null; this.send({ type: 'DEADLOCK_DECISION', matchId, deadlockId, action: 'shuffle' }); }, 300 + Math.floor(this.random() * 350));
        }
        return;
      }
      const disruptive = (this.snapshot.me.effects || []).filter((effect) => ['flip', 'fog'].includes(effect.itemId)).map((effect) => effect.effectId).sort().join('|');
      const disruptionChanged = disruptive && disruptive !== this.disruptionSignature; if (disruptionChanged) this.disruptionActions = 1 + Math.floor(this.random() * 2); this.disruptionSignature = disruptive;
      const inventoryLength = this.snapshot.me.inventory.length; const boardRevision = this.snapshot.me.board?.revision || 0;
      const itemOpportunity = inventoryLength > 0 && (inventoryLength > this.lastInventoryLength || boardRevision > this.lastBoardRevision || disruptionChanged);
      this.lastInventoryLength = inventoryLength; this.lastBoardRevision = boardRevision;
      if (itemOpportunity && !first) this.schedule('item', true); else this.schedule(first ? 'first' : 'pair');
    }
  }
  /** @param {'first'|'pair'|'item'} [kind='pair'] 템포 종류 @param {boolean} [replace=false] 기존 예약 교체 여부 @returns {void} */
  schedule(kind = 'pair', replace = false) {
    if (replace && !this.pending) this.cancelTimer();
    if (this.timer || this.pending || this.paused || !this.snapshot || this.snapshot.phase === 'result') return;
    const notBefore = Math.max(0, (this.snapshot.startedAt || 0) - Date.now()); const plan = planAiDelay(kind, this.snapshot, this.random, this.disruptionActions > 0);
    this.timer = this.setTimer(() => { this.timer = null; this.act(kind); }, notBefore + plan.delay);
  }
  /** @param {'first'|'pair'|'item'} kind 예약 종류 @returns {void} 최신 스냅샷에서 행동 하나를 요청한다. */
  act(kind) {
    const state = this.snapshot; if (!state || state.phase !== 'playing' || this.paused || this.pending || state.me.deadlock) { this.schedule(); return; }
    if (kind === 'item') { const item = chooseAiItem(state, { actionOrdinal: this.ordinal }, this.random); if (item) { this.pending = true; this.send({ type: 'USE_ITEM', matchId: state.matchId, slotId: item.slotId, inventoryRevision: state.me.inventoryRevision }); return; } }
    const pair = chooseLegalPair(state, this.random); if (!pair) { this.schedule(); return; }
    if (this.disruptionActions > 0) this.disruptionActions -= 1;
    this.pending = true; this.send({ type: 'MATCH_PAIR', matchId: state.matchId, boardRevision: state.me.board.revision, tileAId: pair.a.tileId, tileBId: pair.b.tileId });
  }
  /** @returns {void} 예약만 취소한다. */ cancelTimer() { if (this.timer) this.clearTimer(this.timer); this.timer = null; }
  /** @returns {void} 타이머와 연결을 정리한다. */ dispose() { this.cancelTimer(); this.pending = false; if (this.socket?.readyState === WebSocket.OPEN) this.socket.close(); this.socket = null; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--url'); const url = index >= 0 ? process.argv[index + 1] : null;
  if (!url) { process.exitCode = 2; } else { const controller = new AiController({ url }); controller.connect(); for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { controller.dispose(); process.exit(0); }); }
}
