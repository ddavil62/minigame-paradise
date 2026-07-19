/**
 * @fileoverview 레벨별 최단 완주 기록을 원자적으로 저장하고 손상 파일을 안전하게 복구한다.
 */

import fs from 'node:fs';
import path from 'node:path';
import { LEVEL_IDS } from '../shared/levels.js';

/**
 * 기록 저장소를 생성한다.
 * @param {string} filePath JSON 파일 경로
 * @returns {{getAll:Function,update:Function}}
 */
export function createRecordStore(filePath) {
  let records = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (parsed && typeof parsed === 'object') records = Object.fromEntries(Object.entries(parsed).filter(([id, value]) => LEVEL_IDS.includes(id) && Number.isFinite(value) && value > 0));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      try { fs.renameSync(filePath, `${filePath}.corrupt-${Date.now()}`); } catch { /* 복구 실패는 빈 기록으로 계속 진행한다. */ }
    }
  }
  /** @returns {object} */
  function getAll() { return { ...records }; }
  /** @param {string} levelId 레벨 ID @param {number} elapsedMs 완주 시간 @returns {{updated:boolean,bestMs:number|null}} */
  function update(levelId, elapsedMs) {
    if (!LEVEL_IDS.includes(levelId) || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return { updated: false, bestMs: records[levelId] ?? null };
    const rounded = Math.round(elapsedMs);
    if (records[levelId] && records[levelId] <= rounded) return { updated: false, bestMs: records[levelId] };
    records[levelId] = rounded;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, filePath);
    return { updated: true, bestMs: rounded };
  }
  return { getAll, update };
}
