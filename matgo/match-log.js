/**
 * @fileoverview 맞고 매치 생명주기와 판별 가능한 규칙 이벤트를 순서 보장 JSONL로 저장한다.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const DEFAULT_RETENTION_DAYS = 14;
const DEFAULT_RETENTION_COUNT = 20;
const SAFE_STRING_LIMIT = 256;

/**
 * 로그 payload에서 개인정보성 키와 과도한 자유 텍스트를 제거한다.
 *
 * @param {unknown} value
 * @param {string} [key='']
 * @returns {unknown}
 */
function sanitizeValue(value, key = '') {
  if (/^(name|ip|address|socket|ws|raw|stack)$/i.test(key)) return undefined;
  if (typeof value === 'string') return value.slice(0, SAFE_STRING_LIMIT);
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeValue(item)).filter(
      (item) => item !== undefined,
    );
  }
  if (value && typeof value === 'object') {
    const clean = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      const sanitized = sanitizeValue(childValue, childKey);
      if (sanitized !== undefined) clean[childKey] = sanitized;
    }
    return clean;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  return undefined;
}

/**
 * 날짜별 JSONL 파일에 단일 append 큐로 이벤트를 기록하는 매치 로거.
 */
export class MatchLogger {
  /**
   * @param {object} options
   * @param {string} options.directory
   * @param {number} [options.maxFileBytes]
   * @param {number} [options.maxTotalBytes]
   * @param {number} [options.retentionDays]
   * @param {number} [options.retentionCount]
   * @param {() => Date} [options.now]
   * @param {typeof fs.appendFile} [options.appendFile]
   * @param {{warn:Function}} [options.stderr]
   */
  constructor(options) {
    this.directory = options.directory;
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
    this.retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
    this.retentionCount = options.retentionCount ?? DEFAULT_RETENTION_COUNT;
    this.now = options.now || (() => new Date());
    this.appendFile = options.appendFile || fs.appendFile.bind(fs);
    this.stderr = options.stderr || console;
    this.matchId = null;
    this.roundId = null;
    this.seq = 0;
    this.activePath = null;
    this.activeDate = null;
    this.activeSize = 0;
    this.queue = Promise.resolve();
  }

  /**
   * 새 매치 문맥을 열고 MATCH_START를 기록한다.
   *
   * @param {object} [payload]
   * @returns {string} 생성된 matchId
   */
  startMatch(payload = {}) {
    this.matchId = randomUUID();
    this.roundId = null;
    this.seq = 0;
    this.log('MATCH_START', { actor: 'system', payload });
    return this.matchId;
  }

  /**
   * 현재 매치의 새 라운드 문맥을 열고 ROUND_START를 기록한다.
   *
   * @param {object} [payload]
   * @returns {string} 생성된 roundId
   */
  startRound(payload = {}) {
    if (!this.matchId) this.startMatch();
    this.roundId = randomUUID();
    this.log('ROUND_START', { actor: 'system', payload });
    return this.roundId;
  }

  /**
   * 현재 매치 종료 이벤트를 기록한다.
   *
   * @param {'completed'|'interrupted'|'error'} outcome
   * @param {object} [payload]
   * @returns {Promise<boolean>}
   */
  endMatch(outcome, payload = {}) {
    return this.log('MATCH_END', {
      actor: 'system',
      payload: { outcome, ...payload },
    });
  }

  /**
   * 한 이벤트를 순번이 고정된 append 큐에 추가한다.
   *
   * @param {string} event
   * @param {object} [context]
   * @returns {Promise<boolean>} 기록 성공 여부
   */
  log(event, context = {}) {
    if (!this.matchId && event !== 'MATCH_START') return Promise.resolve(false);
    const timestamp = this.now();
    const entry = {
      schemaVersion: 1,
      ts: timestamp.toISOString(),
      seq: ++this.seq,
      matchId: this.matchId,
      roundId: context.roundId ?? this.roundId,
      turnId: context.turnId ?? null,
      batchId: context.batchId ?? null,
      event,
      actor: context.actor || 'system',
      stateVersion: context.stateVersion ?? null,
      phase: context.phase ?? null,
      payload: sanitizeValue(context.payload || {}),
    };
    const task = this.queue.then(() => this.#append(entry, timestamp));
    // 쓰기 실패도 큐를 끊지 않아 다음 게임 이벤트가 계속 진행되게 한다.
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }

  /**
   * 현재 append 큐가 모두 끝날 때까지 기다린다.
   *
   * @returns {Promise<void>}
   */
  async flush() {
    await this.queue;
  }

  /**
   * 보존 기간·최신 파일 수·전체 크기 제한을 적용한다.
   *
   * @returns {Promise<void>}
   */
  async prune() {
    let names;
    try {
      names = await fs.readdir(this.directory);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      this.#warn('로그 디렉터리 조회 실패', error);
      return;
    }
    const files = [];
    for (const name of names.filter((item) => /^matgo-\d{4}-\d{2}-\d{2}(?:\.\d+)?\.jsonl$/.test(item))) {
      const filePath = path.join(this.directory, name);
      try {
        const stat = await fs.stat(filePath);
        files.push({ path: filePath, mtimeMs: stat.mtimeMs, size: stat.size });
      } catch (error) {
        this.#warn('로그 파일 상태 조회 실패', error);
      }
    }
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const cutoff = this.now().getTime() - this.retentionDays * 24 * 60 * 60 * 1000;
    const newest = new Set(files.slice(0, this.retentionCount).map((file) => file.path));
    const removed = new Set();

    // 14일 이내 또는 최신 20개 중 하나라도 만족하면 우선 보존한다.
    for (const file of files) {
      if (file.path === this.activePath) continue;
      if (file.mtimeMs >= cutoff || newest.has(file.path)) continue;
      try {
        await fs.unlink(file.path);
        removed.add(file.path);
      } catch (error) {
        this.#warn('만료 로그 삭제 실패', error);
      }
    }

    let total = files.filter((file) => !removed.has(file.path)).reduce(
      (sum, file) => sum + file.size,
      0,
    );
    // 총 200MiB 상한은 보존 조건보다 우선하되 활성 파일은 절대 삭제하지 않는다.
    for (const file of [...files].reverse()) {
      if (total <= this.maxTotalBytes) break;
      if (removed.has(file.path) || file.path === this.activePath) continue;
      try {
        await fs.unlink(file.path);
        removed.add(file.path);
        total -= file.size;
      } catch (error) {
        this.#warn('용량 상한 로그 삭제 실패', error);
      }
    }
  }

  /**
   * JSONL 한 줄을 실제 파일에 기록한다.
   *
   * @param {object} entry
   * @param {Date} timestamp
   * @returns {Promise<boolean>}
   * @private
   */
  async #append(entry, timestamp) {
    try {
      await fs.mkdir(this.directory, { recursive: true });
      const line = `${JSON.stringify(entry)}\n`;
      await this.#selectActiveFile(timestamp, Buffer.byteLength(line));
      await this.appendFile(this.activePath, line, 'utf8');
      this.activeSize += Buffer.byteLength(line);
      await this.prune();
      return true;
    } catch (error) {
      this.#warn('매치 로그 쓰기 실패 — 게임은 계속 진행', error);
      return false;
    }
  }

  /**
   * 날짜와 10MiB 상한에 맞는 활성 파일을 선택한다.
   *
   * @param {Date} timestamp
   * @param {number} nextBytes
   * @returns {Promise<void>}
   * @private
   */
  async #selectActiveFile(timestamp, nextBytes) {
    const date = timestamp.toISOString().slice(0, 10);
    if (this.activeDate !== date) {
      this.activeDate = date;
      this.activePath = null;
      this.activeSize = 0;
    }
    if (this.activePath && this.activeSize + nextBytes <= this.maxFileBytes) return;

    const names = await fs.readdir(this.directory);
    const expression = new RegExp(`^matgo-${date.replaceAll('-', '\\-')}(?:\\.(\\d+))?\\.jsonl$`);
    const candidates = names
      .map((name) => ({ name, match: expression.exec(name) }))
      .filter((item) => item.match)
      .sort((a, b) => Number(a.match[1] || 0) - Number(b.match[1] || 0));
    let index = candidates.length > 0
      ? Number(candidates.at(-1).match[1] || 0)
      : 0;
    let candidatePath = path.join(
      this.directory,
      `matgo-${date}${index === 0 ? '' : `.${index}`}.jsonl`,
    );
    let size = 0;
    try {
      size = (await fs.stat(candidatePath)).size;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (size > 0 && size + nextBytes > this.maxFileBytes) {
      index += 1;
      candidatePath = path.join(this.directory, `matgo-${date}.${index}.jsonl`);
      size = 0;
    }
    this.activePath = candidatePath;
    this.activeSize = size;
  }

  /**
   * 민감한 상세 없이 stderr 경고를 남긴다.
   *
   * @param {string} message
   * @param {Error} error
   * @returns {void}
   * @private
   */
  #warn(message, error) {
    this.stderr.warn(`[matgo-log] ${message}: ${error?.code || error?.message || 'unknown'}`);
  }
}

