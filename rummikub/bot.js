/**
 * @fileoverview 루미큐브(Rummikub) 단순 AI 봇.
 *
 * 실행:
 *   node bot.js                        → ws://localhost:3011/ws?mode=bot 접속
 *   node bot.js --url ws://...         → 다른 서버 지정 가능
 *
 * 휴리스틱 (캐주얼 중급):
 *   - 첫 등판 안 했으면: 손에서 30점 이상 가능한 세트 조합을 백트래킹으로 탐색.
 *     - 모든 가능한 그룹/런 후보 생성(조커 포함 후보 포함) → 조합 중 점수 합 ≥ 30 + 길이 최소 ≥ 3 만족하는 것 선택.
 *     - 못 찾으면 END_TURN(변경 없음) → 서버가 더미 1장 자동 뽑기.
 *   - 첫 등판 완료 후:
 *      1) 손에서 가능한 모든 그룹/런 자동 등판 (그리디, 조커 포함).
 *      2) **보드 단순 확장(2026-06-10 추가)**: 손 타일이 보드 valid 런/그룹의 양 끝 또는 4번째 색에 들어가면 자동으로 붙인다.
 *      3) **보드 재구성(2026-06-10 한계 해소)**: 보드 valid 세트 1개를 분해해 손 타일과 합쳐 재조립 — 손이 더 줄어드는 경우만 채택.
 *         시간 제한 500ms, 깊이 제한(분해 1회 + 재조립). 실패해도 서버 END_TURN 검증에서 자동 롤백되므로 안전.
 *   - **조커 활용(2026-06-10 한계 해소)**: 손 조커는 그룹의 빈 색 / 런의 빈 슬롯을 메우는 후보로 자동 편입.
 *     조커 1장당 1번만 사용 가능(같은 후보 풀에서 중복 사용 방지). 그룹/런 valid는 game.js의 validateSet과 동일 룰.
 *   - 사람스러운 지연: 800~1500ms.
 *   - GAME_OVER 수신 시 자동 REMATCH 송신.
 */

import { WebSocket } from 'ws';

// ── 인자 파싱 ─────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const urlIdx = argv.indexOf('--url');
const BOT_URL = urlIdx >= 0 && argv[urlIdx + 1] ? argv[urlIdx + 1] : 'ws://localhost:3011/ws?mode=bot';

// 테스트용 import (실행 진입점이 아닌 경우 WS 연결 생략).
//   - import.meta.url과 process.argv[1]을 비교해 직접 실행 여부 판정.
const __isMain = (() => {
  try {
    const argv1 = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : '';
    const argvUrl = argv1 ? new URL(`file:///${argv1.replace(/^\/+/, '')}`).href : '';
    return import.meta.url === argvUrl;
  } catch { return true; }
})();

if (__isMain) {
  console.log(`[rummikub-bot] 서버에 접속 시도: ${BOT_URL}`);
}

// ── 상수 ──────────────────────────────────────────────────────────
const COLORS = ['red', 'blue', 'black', 'orange'];
const MIN_SET_LENGTH = 3;
const INITIAL_MELD_THRESHOLD = 30;

// ── 상태 ──────────────────────────────────────────────────────────
/** @type {'p1'|'p2'|null} */
let myId = null;
/** 마지막 처리 키 (currentTurn|turnNumber) — 중복 행동 방지. */
let lastActedFor = null;
/** 가장 최근 STATE. */
let lastState = null;
/** 행동 예약 타이머. */
let pendingActTimer = null;

// 테스트 import 시 WS 연결을 만들지 않는다.
const ws = __isMain ? new WebSocket(BOT_URL) : { readyState: 3, send: () => {}, close: () => {}, on: () => {} };

ws.on('open', () => {
  console.log('[rummikub-bot] 연결됨, JOIN 송신');
  send({ type: 'JOIN', playerName: 'AI 봇' });
});

ws.on('close', (code, reason) => {
  console.log(`[rummikub-bot] 연결 종료 (code=${code}, reason=${reason || '?'})`);
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('[rummikub-bot] 에러:', err.message);
});

ws.on('message', (data) => {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch { return; }
  switch (msg.type) {
    case 'JOINED':
      myId = msg.playerId;
      console.log(`[rummikub-bot] ${myId} 자리 점유 → READY 송신`);
      send({ type: 'READY' });
      break;
    case 'START':
      console.log('[rummikub-bot] 게임 시작');
      lastActedFor = null;
      break;
    case 'STATE':
      handleState(msg);
      break;
    case 'TURN_RESULT':
      // 정보성 — 무시 (STATE가 같이 broadcast됨).
      break;
    case 'GAME_OVER':
      console.log(`[rummikub-bot] 게임 종료: winner=${msg.winner}, reason=${msg.reason}`);
      setTimeout(() => { send({ type: 'REMATCH' }); }, 500);
      break;
    case 'OPPONENT_LEFT':
      console.log('[rummikub-bot] 상대 이탈 → 연결 종료');
      ws.close();
      break;
    case 'READY_STATUS':
    case 'REMATCH_STATUS':
      break;
    case 'ERROR':
      if (msg.message && msg.message.includes('가득')) {
        console.error('[rummikub-bot] 방이 가득 찼다. 봇은 빠진다.');
        ws.close();
      } else {
        console.warn('[rummikub-bot] 서버 에러:', msg.message);
        // 직전 액션 거절 → 다음 STATE에 재시도.
        lastActedFor = null;
        if (pendingActTimer) {
          clearTimeout(pendingActTimer);
          pendingActTimer = null;
        }
      }
      break;
    default:
      break;
  }
});

/**
 * STATE 메시지를 받아 본인 차례면 행동 예약.
 * @param {object} s
 */
function handleState(s) {
  lastState = s;
  if (!myId) return;
  if (s.phase !== 'playing') return;
  if (s.currentTurn !== myId) {
    if (pendingActTimer) {
      clearTimeout(pendingActTimer);
      pendingActTimer = null;
    }
    return;
  }

  const key = `${s.currentTurn}|${s.turnNumber}`;
  if (key === lastActedFor) return;
  lastActedFor = key;

  if (pendingActTimer) {
    clearTimeout(pendingActTimer);
    pendingActTimer = null;
  }

  const delay = 800 + Math.floor(Math.random() * 700);
  pendingActTimer = setTimeout(() => {
    pendingActTimer = null;
    const cur = lastState;
    if (!cur || cur.phase !== 'playing' || cur.currentTurn !== myId) return;
    actTurn(cur);
  }, delay);
}

/**
 * 본인 턴 행동 — 손 분석 → 가능한 세트 등판 → 보드 재조합 → END_TURN.
 * @param {object} s
 */
function actTurn(s) {
  const handIds = s.myHand || [];
  const handTiles = handIds.map((id) => s.tileDict[id]).filter(Boolean);
  const alreadyPlayed = !!(s.played && s.played[myId]);

  // 가능한 세트 후보 모두 탐색 (그룹 + 런).
  const sets = findBestSetCombination(handTiles, alreadyPlayed ? 0 : INITIAL_MELD_THRESHOLD);

  if (sets.length === 0) {
    // 등판 후라면 보드 재조합만이라도 시도.
    if (alreadyPlayed) {
      const extensions = findBoardExtensions(s, new Set());
      if (extensions.length > 0) {
        console.log(`[rummikub-bot] 새 세트 없음, 보드 확장 ${extensions.length}건 시도`);
        applyBoardExtensions(extensions, 0);
        return;
      }
    }
    console.log('[rummikub-bot] 낼 세트 없음 → END_TURN (더미 뽑기)');
    send({ type: 'END_TURN' });
    return;
  }

  // 발견한 세트 sequentially 적용:
  //  - NEW_SET (서버가 setId 발급) → STATE 수신 후 마지막 추가된 set에 타일 이동.
  // 단순화: 각 NEW_SET 후 STATE 응답을 기다리지 않고 연속 송신 — 서버는 순서대로 처리하므로
  // 마지막 nextSetSeq를 클라가 추적하기 어려움. 대신 매 NEW_SET 후 짧은 await로 STATE 수신.
  // 단, 본 단순 구현은 별도의 await 메커니즘 없이 setTimeout으로 비동기 처리.
  // 사용된 손 타일 ID를 추적해 보드 재조합 단계에서 중복 사용을 피한다.
  const usedHandIds = new Set();
  for (const setTiles of sets) {
    for (const t of setTiles) usedHandIds.add(t.id);
  }
  applySetsSequentially(sets, 0, usedHandIds, alreadyPlayed);
}

/**
 * 세트 배열을 순차적으로 보드에 등판 후, 가능하면 보드 재조합, 최종 END_TURN.
 * @param {Array<Array<object>>} sets 각 세트의 타일 객체 배열
 * @param {number} idx 현재 적용 인덱스
 * @param {Set<string>} usedHandIds 이미 새 세트로 보낸 손 타일 ID
 * @param {boolean} alreadyPlayed 이 턴 시작 시 첫 등판 완료 여부
 */
function applySetsSequentially(sets, idx, usedHandIds, alreadyPlayed) {
  if (idx >= sets.length) {
    // 등판 후라면 추가로 보드 확장/재구성 시도.
    // 첫 등판 턴(alreadyPlayed=false)에는 보드가 비어있을 가능성이 높지만 그래도 안전하게 시도.
    setTimeout(() => {
      const s = lastState;
      if (!s) { send({ type: 'END_TURN' }); return; }
      // 단순 확장 먼저 (가벼움).
      const extensions = findBoardExtensions(s, usedHandIds || new Set());
      if (extensions.length > 0) {
        console.log(`[rummikub-bot] 보드 확장 ${extensions.length}건 시도`);
        applyBoardExtensions(extensions, 0);
        return;
      }
      // 깊은 재구성 시도 (등판 후 + 손 줄일 여지 있을 때만, 500ms 시간 제한).
      if (alreadyPlayed || (s.played && s.played[myId])) {
        const recon = findBoardReconstruction(s, usedHandIds || new Set());
        if (recon && recon.actions.length > 0) {
          console.log(`[rummikub-bot] 보드 재구성 ${recon.actions.length}수 시도 (손 -${recon.handReduction}장)`);
          applyReconstruction(recon.actions, 0);
          return;
        }
      }
      console.log('[rummikub-bot] 모든 세트 등판 완료 → END_TURN');
      send({ type: 'END_TURN' });
    }, 300);
    return;
  }
  // 1) NEW_SET 송신.
  send({ type: 'NEW_SET' });
  // 2) 200ms 후 STATE 갱신을 기다리고 그 세트(=가장 큰 setId)에 타일들을 이동.
  setTimeout(() => {
    const s = lastState;
    if (!s || !s.board || s.board.length === 0) {
      // STATE가 아직 안 왔거나 보드 비어있음 → 다음으로 진행 시도.
      setTimeout(() => applySetsSequentially(sets, idx + 1, usedHandIds, alreadyPlayed), 200);
      return;
    }
    // 방금 NEW_SET이 추가한 빈 세트 찾기 (마지막의 빈 세트).
    const emptySet = [...s.board].reverse().find((bs) => bs.tiles.length === 0);
    if (!emptySet) {
      console.warn('[rummikub-bot] 빈 세트 찾을 수 없음, 다음 세트로 진행');
      setTimeout(() => applySetsSequentially(sets, idx + 1, usedHandIds, alreadyPlayed), 200);
      return;
    }
    const setId = emptySet.id;
    const tilesToPlace = sets[idx];
    // 각 타일을 손→세트로 순차 이동.
    tilesToPlace.forEach((tile, i) => {
      setTimeout(() => {
        send({
          type: 'MOVE_TILE',
          from: { kind: 'hand', tileId: tile.id },
          to: { kind: 'set', setId, index: i },
        });
      }, 50 + i * 30);
    });
    // 세트 다 옮기고 다음 세트로.
    const totalDelay = 50 + tilesToPlace.length * 30 + 200;
    setTimeout(() => applySetsSequentially(sets, idx + 1, usedHandIds, alreadyPlayed), totalDelay);
  }, 250);
}

/**
 * 보드 확장 액션 배열을 순차 적용.
 * @param {Array<{setId: string, index: number, tileId: string}>} extensions
 * @param {number} idx
 */
function applyBoardExtensions(extensions, idx) {
  if (idx >= extensions.length) {
    setTimeout(() => send({ type: 'END_TURN' }), 200);
    return;
  }
  const ext = extensions[idx];
  send({
    type: 'MOVE_TILE',
    from: { kind: 'hand', tileId: ext.tileId },
    to: { kind: 'set', setId: ext.setId, index: ext.index },
  });
  setTimeout(() => applyBoardExtensions(extensions, idx + 1), 120);
}

/**
 * 보드 재구성 액션 시퀀스를 순차 적용.
 * 액션 종류:
 *   - { kind: 'move_set_to_set', fromSetId, tileId, toSetId, index } : 보드 → 보드
 *   - { kind: 'move_hand_to_set', tileId, toSetId, index } : 손 → 기존 보드 세트
 *   - { kind: 'new_set_with_tiles', tiles: [{ source: 'hand'|'set', setId?, tileId }] } : 새 세트 만들고 타일 채우기
 * @param {Array<object>} actions
 * @param {number} idx
 */
function applyReconstruction(actions, idx) {
  if (idx >= actions.length) {
    setTimeout(() => send({ type: 'END_TURN' }), 250);
    return;
  }
  const a = actions[idx];
  if (a.kind === 'move_set_to_set') {
    send({
      type: 'MOVE_TILE',
      from: { kind: 'set', setId: a.fromSetId, tileId: a.tileId },
      to: { kind: 'set', setId: a.toSetId, index: a.index },
    });
    setTimeout(() => applyReconstruction(actions, idx + 1), 120);
  } else if (a.kind === 'move_hand_to_set') {
    send({
      type: 'MOVE_TILE',
      from: { kind: 'hand', tileId: a.tileId },
      to: { kind: 'set', setId: a.toSetId, index: a.index },
    });
    setTimeout(() => applyReconstruction(actions, idx + 1), 120);
  } else if (a.kind === 'new_set_with_tiles') {
    // 새 세트 1개 생성 후 STATE 갱신 대기 → 마지막 빈 세트에 타일 채우기.
    send({ type: 'NEW_SET' });
    setTimeout(() => {
      const s = lastState;
      if (!s || !s.board) {
        setTimeout(() => applyReconstruction(actions, idx + 1), 200);
        return;
      }
      const emptySet = [...s.board].reverse().find((bs) => bs.tiles.length === 0);
      if (!emptySet) {
        console.warn('[rummikub-bot:recon] 빈 세트 없음, 다음 액션으로');
        setTimeout(() => applyReconstruction(actions, idx + 1), 200);
        return;
      }
      const setId = emptySet.id;
      a.tiles.forEach((t, i) => {
        setTimeout(() => {
          if (t.source === 'hand') {
            send({
              type: 'MOVE_TILE',
              from: { kind: 'hand', tileId: t.tileId },
              to: { kind: 'set', setId, index: i },
            });
          } else {
            send({
              type: 'MOVE_TILE',
              from: { kind: 'set', setId: t.setId, tileId: t.tileId },
              to: { kind: 'set', setId, index: i },
            });
          }
        }, 50 + i * 40);
      });
      const totalDelay = 50 + a.tiles.length * 40 + 200;
      setTimeout(() => applyReconstruction(actions, idx + 1), totalDelay);
    }, 250);
  } else {
    // 알 수 없는 액션 — 건너뜀.
    setTimeout(() => applyReconstruction(actions, idx + 1), 50);
  }
}

/**
 * 보드 세트 1개를 분해 → 손 타일과 합쳐 새 세트 1개 만들기 →
 * 분해 후 남은 세트도 valid + 새 세트도 valid + 손이 줄어드는 경우만 채택.
 *
 * 깊이 제한: 분해 1회 + 재조립 1개. 시간 제한: 500ms.
 * 결과: { actions: Array, handReduction: number } 또는 null.
 *
 * 가지치기:
 *   - 조커 포함 세트는 분해 시도 제외 (회수 흐름이 복잡 — 안전 회피).
 *   - 분해는 그룹/런 각 1장만 분리 (길이가 3 초과인 세트만).
 *
 * @param {object} state 현재 STATE
 * @param {Set<string>} usedHandIds 이미 사용된 손 타일 ID (이 턴에 새 세트로 보낸 타일)
 * @returns {{ actions: Array, handReduction: number }|null}
 */
function findBoardReconstruction(state, usedHandIds) {
  const startTime = Date.now();
  const TIME_LIMIT_MS = 500;

  const handIds = (state.myHand || []).filter((id) => !usedHandIds.has(id));
  const handTiles = handIds.map((id) => state.tileDict ? state.tileDict[id] : null).filter(Boolean);
  if (handTiles.length === 0) return null;

  // 보드 세트 객체 풀.
  const boardSets = (state.board || []).map((bs) => ({
    id: bs.id,
    tiles: (bs.tiles || []).map((tid) => state.tileDict ? state.tileDict[tid] : null).filter(Boolean),
  })).filter((bs) => bs.tiles.length >= 3 && !bs.tiles.some((t) => t.kind === 'joker'));

  if (boardSets.length === 0) return null;

  let best = null;

  outer: for (const bs of boardSets) {
    if (Date.now() - startTime > TIME_LIMIT_MS) break;
    // 세트 타입 판정.
    const tiles = bs.tiles;
    const isGroup = tiles.every((t) => t.kind === 'num') &&
      tiles.every((t) => t.number === tiles[0].number);

    // 분리 후보 인덱스 결정.
    //   그룹: 어느 위치도 가능 (남은 길이 ≥ 3).
    //   런: 양 끝만 (남은 길이 ≥ 3).
    const splitIndices = [];
    if (isGroup) {
      if (tiles.length >= 4) {
        for (let i = 0; i < tiles.length; i++) splitIndices.push(i);
      } else if (tiles.length === 3) {
        // 3장 그룹은 분리 시 남은 2장 → invalid. 분리 불가.
      }
    } else {
      // 런으로 가정 (조커 제외 위에서 필터됨).
      if (tiles.length >= 4) {
        splitIndices.push(0);
        splitIndices.push(tiles.length - 1);
      }
    }

    for (const splitIdx of splitIndices) {
      if (Date.now() - startTime > TIME_LIMIT_MS) break outer;
      const splitTile = tiles[splitIdx];
      const remaining = tiles.filter((_, i) => i !== splitIdx);
      // 남은 세트 valid 검사.
      if (!isValidSet(remaining)) continue;

      // 분리된 타일 + 손 타일 풀로 새 세트 1개 만들기.
      const pool = [splitTile, ...handTiles];
      const newSet = findBestNewSet(pool, splitTile, startTime, TIME_LIMIT_MS);
      if (!newSet) continue;

      // 손이 얼마나 줄어드는지 = 새 세트에 들어간 손 타일 수.
      const handTileInNew = newSet.tiles.filter((t) => handTiles.some((h) => h.id === t.id)).length;
      // 손 줄어드는 조합만 채택. 단순 확장(findBoardExtensions)이 못 잡는 케이스가 핵심이므로
      // 최소 1장 이상 손이 줄어들면 OK.
      if (handTileInNew < 1) continue;

      const candidate = { boardSet: bs, splitTile, newSet, handReduction: handTileInNew };
      if (!best || handTileInNew > best.handReduction) {
        best = candidate;
      }
    }
  }

  if (!best) return null;

  // 액션 시퀀스로 변환.
  //   1) 새 세트 생성(NEW_SET) + 분리 타일을 그 세트로 이동 + 손 타일들도 그 세트로 이동.
  //      → 분리 타일은 원래 보드 세트에서 빠지면서 자연스럽게 남은 세트가 됨.
  const newSetTileSources = best.newSet.tiles.map((t) => {
    if (t.id === best.splitTile.id) {
      return { source: 'set', setId: best.boardSet.id, tileId: t.id };
    }
    return { source: 'hand', tileId: t.id };
  });
  const actions = [
    { kind: 'new_set_with_tiles', tiles: newSetTileSources },
  ];

  return { actions, handReduction: best.handReduction };
}

/**
 * 타일 풀에서 splitTile을 반드시 포함하는 valid 세트 1개를 찾는다.
 * (분리된 타일을 활용하지 못하면 분해 의미 없음).
 *
 * 단순화: 그룹/런 둘 다 시도, 가장 손 타일을 많이 흡수하는 결과 채택.
 * 조커 1장까지 허용(손에 조커 있을 때).
 *
 * @param {Array<object>} pool 모든 후보 타일(splitTile + 손 타일 전체)
 * @param {object} splitTile 반드시 포함되어야 하는 타일
 * @param {number} startTime
 * @param {number} timeLimit
 * @returns {{ tiles: Array<object>, type: string, score: number }|null}
 */
function findBestNewSet(pool, splitTile, startTime, timeLimit) {
  if (splitTile.kind !== 'num') return null;
  const poolNums = pool.filter((t) => t.kind === 'num');
  const poolJokers = pool.filter((t) => t.kind === 'joker');
  let best = null;

  // ── 그룹 시도: 같은 숫자 + 다른 색 ──
  const sameNumber = poolNums.filter((t) => t.number === splitTile.number);
  // splitTile 포함 + 색 중복 없는 3~4장 조합.
  const colorMap = new Map();
  for (const t of sameNumber) {
    if (!colorMap.has(t.color)) colorMap.set(t.color, t);
  }
  // splitTile은 무조건 포함되도록 colorMap에 우선 등록.
  colorMap.set(splitTile.color, splitTile);
  const distinctSameNum = [...colorMap.values()];
  if (distinctSameNum.length >= 3) {
    // 3장, 4장 시도.
    const sets3 = distinctSameNum.length === 3
      ? [distinctSameNum]
      : enumerateSubsets(distinctSameNum, 3, splitTile);
    const sets4 = distinctSameNum.length === 4 ? [distinctSameNum] : [];
    for (const arr of [...sets3, ...sets4]) {
      if (Date.now() - startTime > timeLimit) break;
      if (!arr.some((t) => t.id === splitTile.id)) continue;
      if (isValidSet(arr)) {
        const score = arr.length * splitTile.number;
        if (!best || score > best.score) {
          best = { tiles: arr, type: 'group', score };
        }
      }
    }
  }
  // 조커 활용 그룹: splitTile.number 같은 다른 색 1~2장 + 조커.
  if (poolJokers.length >= 1 && distinctSameNum.length >= 2) {
    const j1 = poolJokers[0];
    const base = distinctSameNum.slice(0, 2);
    if (base.some((t) => t.id === splitTile.id) || distinctSameNum.length >= 2) {
      // splitTile 반드시 포함되게 base 구성.
      const withSplit = distinctSameNum.filter((t) => t.id === splitTile.id);
      const others = distinctSameNum.filter((t) => t.id !== splitTile.id);
      if (withSplit.length === 1 && others.length >= 1) {
        const cand = [...withSplit, others[0], j1];
        if (isValidSet(cand)) {
          const score = cand.length * splitTile.number;
          if (!best || score > best.score) best = { tiles: cand, type: 'group', score };
        }
        if (others.length >= 2) {
          const cand4 = [...withSplit, others[0], others[1], j1];
          if (isValidSet(cand4)) {
            const score = cand4.length * splitTile.number;
            if (!best || score > best.score) best = { tiles: cand4, type: 'group', score };
          }
        }
      }
    }
  }

  // ── 런 시도: 같은 색 + 연속 숫자 ──
  if (Date.now() - startTime <= timeLimit) {
    const sameColor = poolNums.filter((t) => t.color === splitTile.color);
    // 숫자별 첫 타일.
    const byNum = new Map();
    for (const t of sameColor) {
      if (!byNum.has(t.number)) byNum.set(t.number, t);
    }
    byNum.set(splitTile.number, splitTile);
    const numsSorted = [...byNum.keys()].sort((a, b) => a - b);
    // splitTile.number 주변의 길이 3~5 모든 연속 시퀀스 시도.
    const sn = splitTile.number;
    for (let len = 3; len <= 5; len++) {
      if (Date.now() - startTime > timeLimit) break;
      for (let start = Math.max(1, sn - len + 1); start <= Math.min(13 - len + 1, sn); start++) {
        const slots = [];
        let needJoker = 0;
        let valid = true;
        for (let v = start; v < start + len; v++) {
          if (byNum.has(v)) {
            slots.push(byNum.get(v));
          } else {
            if (poolJokers.length > needJoker) {
              slots.push(poolJokers[needJoker]);
              needJoker += 1;
            } else {
              valid = false;
              break;
            }
          }
        }
        if (!valid) continue;
        if (!slots.some((t) => t.id === splitTile.id)) continue;
        if (!isValidSet(slots)) continue;
        let score = 0;
        for (let v = start; v < start + len; v++) score += v;
        if (!best || score > best.score) {
          best = { tiles: slots, type: 'run', score };
        }
      }
    }
  }

  return best;
}

/**
 * 배열에서 크기 k의 부분집합을 모두 생성하되, mustInclude는 반드시 포함시킨다.
 * @param {Array<object>} arr
 * @param {number} k
 * @param {object} mustInclude
 * @returns {Array<Array<object>>}
 */
function enumerateSubsets(arr, k, mustInclude) {
  const others = arr.filter((t) => t.id !== mustInclude.id);
  const out = [];
  function recurse(idx, picked) {
    if (picked.length === k - 1) {
      out.push([mustInclude, ...picked]);
      return;
    }
    if (idx >= others.length) return;
    if (others.length - idx < k - 1 - picked.length) return;
    picked.push(others[idx]);
    recurse(idx + 1, picked);
    picked.pop();
    recurse(idx + 1, picked);
  }
  recurse(0, []);
  return out;
}

/**
 * 타일 배열이 valid 세트(그룹 또는 런)인지 검증. game.js validateSet와 동일 룰을 봇 내부에서 재현.
 * (네트워크/모듈 import 비용 회피 — 봇은 단독 프로세스.)
 *
 * @param {Array<object>} tiles
 * @returns {boolean}
 */
function isValidSet(tiles) {
  if (!Array.isArray(tiles) || tiles.length < MIN_SET_LENGTH || tiles.length > 13) return false;
  const jokers = tiles.filter((t) => t && t.kind === 'joker');
  const nums = tiles.filter((t) => t && t.kind === 'num');
  if (jokers.length + nums.length !== tiles.length) return false;
  if (jokers.length > 2) return false;
  if (nums.length === 0) return false;

  // 그룹 검증: 같은 숫자, 색 중복 없음, 길이 ≤ 4.
  const sampleNumber = nums[0].number;
  const allSameNumber = nums.every((t) => t.number === sampleNumber);
  if (allSameNumber) {
    if (tiles.length >= MIN_SET_LENGTH && tiles.length <= 4) {
      const colorSet = new Set(nums.map((t) => t.color));
      if (colorSet.size === nums.length) return true;
    }
    // 색 중복 → 그룹 invalid. 단일 숫자라 런도 불가.
    return false;
  }

  // 런 검증: 같은 색, 연속 숫자, 길이 ≤ 13.
  const sampleColor = nums[0].color;
  if (!nums.every((t) => t.color === sampleColor)) return false;
  const numSet = new Set(nums.map((t) => t.number));
  if (numSet.size !== nums.length) return false;
  const minN = Math.min(...nums.map((t) => t.number));
  const maxN = Math.max(...nums.map((t) => t.number));
  if (maxN - minN + 1 > tiles.length) return false;
  const startMin = Math.max(1, maxN - tiles.length + 1);
  const startMax = Math.min(minN, 13 - tiles.length + 1);
  if (startMin > startMax) return false;
  for (let start = startMin; start <= startMax; start++) {
    const end = start + tiles.length - 1;
    let ok = true;
    for (const n of nums) {
      if (n.number < start || n.number > end) { ok = false; break; }
    }
    if (!ok) continue;
    const missing = tiles.length - nums.length;
    if (missing === jokers.length) return true;
  }
  return false;
}

/**
 * 보드의 valid 런/그룹에 손 타일이 즉시 붙는 케이스를 모두 찾는다.
 *
 * 깊이:
 *   - 런: 양 끝(앞/뒤)에 손 타일이 정확히 연속되면 붙임. 색 일치 + 숫자 시작-1 또는 끝+1.
 *   - 그룹: 길이 3이면 4번째 색 + 같은 숫자 타일을 추가.
 *
 * 사용한 손 타일은 한 번만 사용 가능(usedHandIds로 추적).
 *
 * @param {object} state 현재 STATE
 * @param {Set<string>} usedHandIds 이미 다른 액션에 사용된 손 타일 ID
 * @returns {Array<{setId: string, index: number, tileId: string}>}
 */
function findBoardExtensions(state, usedHandIds) {
  const out = [];
  const handIds = state.myHand || [];
  const handLocalUsed = new Set();
  // 손 타일 인덱싱(색+숫자 → tileId).
  const handByKey = new Map(); // 'color|number' → tileId[]
  for (const id of handIds) {
    if (usedHandIds.has(id)) continue;
    const t = state.tileDict ? state.tileDict[id] : null;
    if (!t || t.kind !== 'num') continue;
    const key = `${t.color}|${t.number}`;
    if (!handByKey.has(key)) handByKey.set(key, []);
    handByKey.get(key).push(id);
  }

  for (const set of state.board || []) {
    const tileIds = set.tiles || [];
    if (tileIds.length < 3) continue;
    const tiles = tileIds.map((id) => state.tileDict ? state.tileDict[id] : null);
    if (tiles.some((t) => !t)) continue;
    // 조커 포함 세트는 건너뜀(추가 위치 추론 복잡 — 안전 회피).
    if (tiles.some((t) => t.kind === 'joker')) continue;
    // 타입 추론.
    const nums = tiles.filter((t) => t.kind === 'num');
    const sampleNumber = nums[0].number;
    const allSameNumber = nums.every((t) => t.number === sampleNumber);
    if (allSameNumber) {
      // 그룹.
      if (tiles.length < 3 || tiles.length >= 4) continue; // 이미 4장이면 추가 불가.
      const usedColors = new Set(nums.map((t) => t.color));
      const COLORS_LOCAL = ['red', 'blue', 'black', 'orange'];
      for (const c of COLORS_LOCAL) {
        if (usedColors.has(c)) continue;
        const key = `${c}|${sampleNumber}`;
        const cands = handByKey.get(key);
        if (!cands) continue;
        // 사용 가능한 첫 타일.
        const tileId = cands.find((id) => !handLocalUsed.has(id));
        if (!tileId) continue;
        out.push({ setId: set.id, index: tileIds.length, tileId });
        handLocalUsed.add(tileId);
        break; // 한 세트에 1장만 추가.
      }
    } else {
      // 런. 같은 색 + 연속 검증.
      const sampleColor = nums[0].color;
      const allSameColor = nums.every((t) => t.color === sampleColor);
      if (!allSameColor) continue;
      const numbers = nums.map((t) => t.number).sort((a, b) => a - b);
      // 정렬된 set.tiles 순서와 일치한다고 가정 (등판 후 사람도 정렬 유지 보장은 없지만 휴리스틱).
      const minN = numbers[0];
      const maxN = numbers[numbers.length - 1];
      // 시퀀스 연속 여부.
      let contiguous = true;
      for (let i = 1; i < numbers.length; i++) {
        if (numbers[i] !== numbers[i - 1] + 1) { contiguous = false; break; }
      }
      if (!contiguous) continue;
      // 앞 끝에 minN-1 추가 가능?
      if (minN - 1 >= 1) {
        const key = `${sampleColor}|${minN - 1}`;
        const cands = handByKey.get(key);
        if (cands) {
          const tileId = cands.find((id) => !handLocalUsed.has(id));
          if (tileId) {
            // 보드 set.tiles 순서상 minN이 어디 있는지 찾아 그 앞 index에 삽입.
            const minIdx = tileIds.indexOf(nums.find((t) => t.number === minN).id);
            out.push({ setId: set.id, index: Math.max(0, minIdx), tileId });
            handLocalUsed.add(tileId);
          }
        }
      }
      // 뒤 끝에 maxN+1 추가 가능?
      if (maxN + 1 <= 13) {
        const key = `${sampleColor}|${maxN + 1}`;
        const cands = handByKey.get(key);
        if (cands) {
          const tileId = cands.find((id) => !handLocalUsed.has(id));
          if (tileId) {
            const maxIdx = tileIds.indexOf(nums.find((t) => t.number === maxN).id);
            out.push({ setId: set.id, index: maxIdx + 1, tileId });
            handLocalUsed.add(tileId);
          }
        }
      }
    }
  }
  return out;
}

/**
 * 손 타일 배열에서 가능한 세트 조합을 탐색한다.
 * 첫 등판 미완료라면 점수 합 ≥ targetThreshold 만족하는 최대 세트 조합을 반환.
 * 이미 등판했으면 가능한 모든 세트를 그리디하게 채택.
 *
 * @param {Array<object>} handTiles
 * @param {number} targetThreshold 0이면 등판 후, 30이면 첫 등판.
 * @returns {Array<Array<object>>} 발견한 세트들의 타일 배열 (각 세트의 type 무관)
 */
function findBestSetCombination(handTiles, targetThreshold) {
  // 가능한 모든 세트 후보 생성: 그룹 + 런.
  const candidates = enumerateCandidateSets(handTiles);
  if (candidates.length === 0) return [];

  // 그리디: 점수 큰 순으로 정렬, 중복 타일 없이 채택.
  candidates.sort((a, b) => b.score - a.score);

  // 첫 등판이면 30점 이상 조합 백트래킹 탐색.
  if (targetThreshold > 0) {
    const best = backtrackInitialMeld(candidates, targetThreshold);
    if (best) return best.map((c) => c.tiles);
    return []; // 30점 조합 못 찾음.
  }

  // 등판 후 그리디.
  const used = new Set();
  const picked = [];
  for (const c of candidates) {
    if (c.tiles.some((t) => used.has(t.id))) continue;
    for (const t of c.tiles) used.add(t.id);
    picked.push(c.tiles);
  }
  return picked;
}

/**
 * 첫 등판 30점 이상 조합을 백트래킹 탐색.
 * 후보 N개 중 부분집합 선택 — 타일 중복 없이 점수 합 ≥ target.
 * 시간 제약: 후보가 너무 많으면 상위 12개만 사용(타임아웃 방지).
 *
 * @param {Array<{score: number, tiles: Array<object>}>} candidates 점수 내림차순 정렬됨
 * @param {number} target 최소 점수
 * @returns {Array<{score: number, tiles: Array<object>}>|null} 만족 조합 또는 null
 */
function backtrackInitialMeld(candidates, target) {
  const limited = candidates.slice(0, 12);
  let best = null;
  function recurse(idx, picked, usedIds, score) {
    if (best) return; // 첫 만족 조합에서 종료(점수 큰 순이라 합리적).
    if (score >= target) {
      best = picked.slice();
      return;
    }
    if (idx >= limited.length) return;
    // 후보 idx 채택.
    const c = limited[idx];
    let conflict = false;
    for (const t of c.tiles) {
      if (usedIds.has(t.id)) { conflict = true; break; }
    }
    if (!conflict) {
      for (const t of c.tiles) usedIds.add(t.id);
      picked.push(c);
      recurse(idx + 1, picked, usedIds, score + c.score);
      picked.pop();
      for (const t of c.tiles) usedIds.delete(t.id);
    }
    if (best) return;
    // 채택 안 함.
    recurse(idx + 1, picked, usedIds, score);
  }
  recurse(0, [], new Set(), 0);
  return best;
}

/**
 * 손 타일에서 가능한 모든 그룹/런 세트 후보를 열거한다.
 * 각 후보는 { score, type, tiles } 객체. tiles는 룰에 맞게 정렬된 상태.
 *
 * 조커 활용(2026-06-10 한계 해소):
 *   - 손에 조커가 있으면 그룹/런 빈 자리를 조커로 채우는 후보를 추가한다.
 *   - 조커 1장당 1번만 사용 가능(같은 후보 안에서 중복 사용 방지).
 *   - 조커 후보 점수는 game.js의 validateSet과 동일하게 "대체한 타일의 숫자"로 계산.
 *
 * @param {Array<object>} handTiles
 * @returns {Array<{score: number, type: string, tiles: Array<object>, usesJokerIds?: Array<string>}>}
 */
function enumerateCandidateSets(handTiles) {
  const nums = handTiles.filter((t) => t.kind === 'num');
  const jokers = handTiles.filter((t) => t.kind === 'joker');
  const out = [];

  // ── 그룹 후보: 숫자별로 색이 다른 타일 모음 (3장 / 4장) ──
  const byNumber = new Map();
  for (const t of nums) {
    if (!byNumber.has(t.number)) byNumber.set(t.number, []);
    byNumber.get(t.number).push(t);
  }
  for (const [num, tiles] of byNumber) {
    // 색별 최소 1장만 (중복 같은 색은 그룹에 한 번만 쓸 수 있음 — 다른 copy도 사용 가능하나 그룹 내 색 중복 X).
    const byColor = new Map();
    for (const t of tiles) {
      if (!byColor.has(t.color)) byColor.set(t.color, t);
    }
    const distinct = [...byColor.values()];
    if (distinct.length >= MIN_SET_LENGTH) {
      // 3장 그룹: distinct 중 3장 조합 모두.
      // 4장 그룹: distinct 모두.
      if (distinct.length === 3) {
        out.push({ score: num * 3, type: 'group', tiles: distinct.slice() });
      } else if (distinct.length === 4) {
        // 3장 4개 조합 + 4장 1개. 점수 큰 4장 그룹 + 3장 부분도 모두.
        out.push({ score: num * 4, type: 'group', tiles: distinct.slice() });
        for (let skip = 0; skip < 4; skip++) {
          const subset = distinct.filter((_, i) => i !== skip);
          out.push({ score: num * 3, type: 'group', tiles: subset });
        }
      }
    }
    // 조커 활용: distinct가 2장이면 조커 1장 추가로 3장 그룹.
    //          distinct가 3장이면 조커 1장 추가로 4장 그룹.
    //          distinct가 2장 + 조커 2장이면 4장 그룹도 가능(2색 + 조커 2).
    if (jokers.length >= 1 && distinct.length === 2) {
      const j1 = jokers[0];
      out.push({
        score: num * 3,
        type: 'group',
        tiles: [...distinct, j1],
        usesJokerIds: [j1.id],
      });
      // 조커 2장: 2색 + 조커 2 → 4장 그룹.
      if (jokers.length >= 2) {
        const j2 = jokers[1];
        out.push({
          score: num * 4,
          type: 'group',
          tiles: [...distinct, j1, j2],
          usesJokerIds: [j1.id, j2.id],
        });
      }
    }
    if (jokers.length >= 1 && distinct.length === 3) {
      const j1 = jokers[0];
      out.push({
        score: num * 4,
        type: 'group',
        tiles: [...distinct, j1],
        usesJokerIds: [j1.id],
      });
    }
  }

  // ── 런 후보: 색별로 연속 숫자 시퀀스(길이 3~13) ──
  const byColor = new Map();
  for (const t of nums) {
    if (!byColor.has(t.color)) byColor.set(t.color, []);
    byColor.get(t.color).push(t);
  }
  for (const [color, tiles] of byColor) {
    // 숫자별로 첫 한 장만 사용(같은 숫자 중복 런 X).
    const byNum = new Map();
    for (const t of tiles) {
      if (!byNum.has(t.number)) byNum.set(t.number, t);
    }
    const sortedNums = [...byNum.keys()].sort((a, b) => a - b);
    // 연속 구간 탐색.
    let i = 0;
    while (i < sortedNums.length) {
      let j = i;
      while (j + 1 < sortedNums.length && sortedNums[j + 1] === sortedNums[j] + 1) j++;
      const runLen = j - i + 1;
      if (runLen >= MIN_SET_LENGTH) {
        // 모든 길이 3~runLen의 부분 시퀀스 등록.
        for (let len = MIN_SET_LENGTH; len <= runLen; len++) {
          for (let start = i; start + len - 1 <= j; start++) {
            const segTiles = [];
            let score = 0;
            for (let k = start; k < start + len; k++) {
              const n = sortedNums[k];
              segTiles.push(byNum.get(n));
              score += n;
            }
            out.push({ score, type: 'run', tiles: segTiles });
          }
        }
      }
      i = j + 1;
    }
    // 조커 활용: 같은 색 2장 + 조커 → 길이 3 런.
    //          빈 슬롯이 조커로 채워질 수 있는 모든 케이스.
    //   - 양 끝 확장 (예: red 4,5 + 조커 → [3,4,5] 또는 [4,5,6])
    //   - 사이 빈 자리 (예: red 4,6 + 조커 → [4,J,6])
    if (jokers.length >= 1) {
      enumerateRunsWithJoker(color, byNum, jokers, out);
    }
  }

  return out;
}

/**
 * 한 색의 숫자 타일들 + 조커로 만들 수 있는 런 후보를 열거해 out에 push한다.
 *
 * 전략:
 *   - 같은 색 숫자 2장 + 조커 1장 = 길이 3 런 후보.
 *     (양 끝/사이 모든 배치를 시도하되 valid한 슬롯만 채택)
 *   - 같은 색 숫자 3장 + 조커 1장 = 길이 4 런 후보 (연속 3장 + 양 끝 1자리 조커 또는
 *     비연속 + 사이 조커).
 *   - 같은 색 숫자 ≥ 2장 + 조커 2장 = 길이 4~5 런 후보 (이 케이스는 단순화 — 길이 3 위주로 충분).
 *
 * 점수는 game.js validateSet와 동일하게 슬롯 숫자 합산.
 *
 * @param {string} color
 * @param {Map<number, object>} byNum 숫자 → 타일 객체
 * @param {Array<object>} jokers 손 조커 배열 (최대 2장)
 * @param {Array} out
 */
function enumerateRunsWithJoker(color, byNum, jokers, out) {
  const nums = [...byNum.keys()].sort((a, b) => a - b);
  if (nums.length < 2) return;
  const j1 = jokers[0];

  // ── 패턴 A: 숫자 2장 + 조커 1장 (길이 3) ──
  //   숫자 2장의 차이가 1~2 사이일 때만 가능.
  //   차이 1 (예: 4,5): 앞 확장 [3,4,5] (start=4-1) or 뒤 확장 [4,5,6] (start=4)
  //   차이 2 (예: 4,6): 사이 [4,J,6] (start=4)
  for (let a = 0; a < nums.length; a++) {
    for (let b = a + 1; b < nums.length; b++) {
      const n1 = nums[a];
      const n2 = nums[b];
      const t1 = byNum.get(n1);
      const t2 = byNum.get(n2);
      const diff = n2 - n1;
      if (diff === 1) {
        // 앞 확장 [n1-1, n1, n2] (n1≥2)
        if (n1 - 1 >= 1) {
          const start = n1 - 1;
          const score = start + n1 + n2;
          out.push({
            score, type: 'run',
            tiles: [j1, t1, t2], // 조커가 시작
            usesJokerIds: [j1.id],
          });
        }
        // 뒤 확장 [n1, n2, n2+1]
        if (n2 + 1 <= 13) {
          const score = n1 + n2 + (n2 + 1);
          out.push({
            score, type: 'run',
            tiles: [t1, t2, j1],
            usesJokerIds: [j1.id],
          });
        }
      } else if (diff === 2) {
        // 사이 [n1, J, n2]
        const score = n1 + (n1 + 1) + n2;
        out.push({
          score, type: 'run',
          tiles: [t1, j1, t2],
          usesJokerIds: [j1.id],
        });
      }
    }
  }

  // ── 패턴 B: 조커 2장 + 숫자 2장 (길이 4) — 같은 색, 차이 1~3 ──
  if (jokers.length >= 2) {
    const j2 = jokers[1];
    for (let a = 0; a < nums.length; a++) {
      for (let b = a + 1; b < nums.length; b++) {
        const n1 = nums[a];
        const n2 = nums[b];
        const t1 = byNum.get(n1);
        const t2 = byNum.get(n2);
        const diff = n2 - n1;
        // 차이 1 (예: 4,5): 앞뒤 확장 [J,J,4,5] / [J,4,5,J] / [4,5,J,J]
        if (diff === 1) {
          // [n1-2, n1-1, n1, n2] (n1≥3)
          if (n1 - 2 >= 1) {
            const start = n1 - 2;
            const score = start + (start + 1) + n1 + n2;
            out.push({ score, type: 'run', tiles: [j1, j2, t1, t2], usesJokerIds: [j1.id, j2.id] });
          }
          // [n1-1, n1, n2, n2+1] (n1≥2, n2≤12)
          if (n1 - 1 >= 1 && n2 + 1 <= 13) {
            const score = (n1 - 1) + n1 + n2 + (n2 + 1);
            out.push({ score, type: 'run', tiles: [j1, t1, t2, j2], usesJokerIds: [j1.id, j2.id] });
          }
          // [n1, n2, n2+1, n2+2] (n2≤11)
          if (n2 + 2 <= 13) {
            const score = n1 + n2 + (n2 + 1) + (n2 + 2);
            out.push({ score, type: 'run', tiles: [t1, t2, j1, j2], usesJokerIds: [j1.id, j2.id] });
          }
        }
        // 차이 2: [n1, J, n2, n2+1] / [n1-1, n1, J, n2]
        if (diff === 2) {
          if (n2 + 1 <= 13) {
            const score = n1 + (n1 + 1) + n2 + (n2 + 1);
            out.push({ score, type: 'run', tiles: [t1, j1, t2, j2], usesJokerIds: [j1.id, j2.id] });
          }
          if (n1 - 1 >= 1) {
            const score = (n1 - 1) + n1 + (n1 + 1) + n2;
            out.push({ score, type: 'run', tiles: [j1, t1, j2, t2], usesJokerIds: [j1.id, j2.id] });
          }
        }
        // 차이 3: [n1, J, J, n2]
        if (diff === 3) {
          const score = n1 + (n1 + 1) + (n1 + 2) + n2;
          out.push({ score, type: 'run', tiles: [t1, j1, j2, t2], usesJokerIds: [j1.id, j2.id] });
        }
      }
    }
  }
}

/**
 * 서버에 JSON 메시지를 송신한다.
 * @param {object} msg
 */
function send(msg) {
  if (ws.readyState !== 1) {
    if (__isMain) {
      console.log(`[rummikub-bot:SEND] DROP (ws not open, readyState=${ws.readyState}) msg=${JSON.stringify(msg)}`);
    }
    return;
  }
  ws.send(JSON.stringify(msg));
}

// ── 테스트용 export ───────────────────────────────────────────
// 다른 모듈(예: smoke.test.js)이 import하면 WS 연결을 만들지 않고
// 휴리스틱 함수만 사용 가능하다.
export {
  enumerateCandidateSets,
  findBoardReconstruction,
  findBoardExtensions,
  findBestNewSet,
  isValidSet,
  findBestSetCombination,
};
