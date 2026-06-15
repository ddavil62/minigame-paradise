/**
 * @fileoverview Yutnori WebSocket 서버 + 정적 파일 서빙.
 *
 * 아키텍처: **서버 권위 (Server Authoritative)**
 * - 윷가락 던지기 결과는 서버에서 결정한다 (클라이언트 부정 방지)
 * - 말 이동/잡기/업기 판정도 모두 서버. 클라이언트는 입력 전달 + 상태 렌더링만.
 * - 매 액션 후 `STATE` 메시지로 전체 게임 상태를 양쪽에 broadcast 한다.
 *
 * 보드 모델: 칸 인덱스 0~28 (총 29칸).
 *  - 0~19: 외곽 사각형 (시계 반대 방향 진행: 0=시작점, 5=우상 모서리, 10=좌상 모서리, 15=좌하 모서리, 20=출구 = 0과 동일 취급)
 *  - 우상 모서리에서 진입 가능한 지름길: 21,22 → 24(중앙) → 25,26 → 좌하 출구로 합류
 *  - 우하(=시작점에서 5번째? 본 구현에선 외곽 동선 단순화로 모서리 4개를 [0(=좌하 시작), 5, 10, 15]로 둠)
 *
 * 단순화: 정확한 한국 전통 룰을 100% 재현하기보다 친구와 LAN으로 즐기는 데 충분한 수준으로 구현.
 */

import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { spawn } from 'child_process';
import fs from 'fs';

// ── 경로 ──────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

// ── 윷 결과 상수 ─────────────────────────────────────────────────
// 결과명 → 이동 칸 수
// 백도(빽도): 윷가락 4개 중 1개에 마크가 있어, 그 가락만 단독으로 뒷면이면 1칸 뒤로 이동.
const YUT_STEPS = {
  backdo: -1,
  do: 1,
  gae: 2,
  geol: 3,
  yut: 4,
  mo: 5,
};
const YUT_NAMES_KO = {
  backdo: '백도',
  do: '도',
  gae: '개',
  geol: '걸',
  yut: '윷',
  mo: '모',
};

/**
 * 마크된 가락의 인덱스 (4개 중 0번을 백도 가락으로 사용).
 * 클라이언트도 동일한 인덱스를 마크로 렌더링한다.
 */
const MARKED_STICK_INDEX = 0;

/**
 * 윷가락 4개를 던진 결과를 반환한다.
 * 각 가락은 50% 확률로 앞/뒤. 앞 개수에 따라 결과 결정.
 *
 * 한국 표준 윷놀이 정통 룰 (평평면 = 앞면 = fronts):
 *   fronts=0 → 모(5칸 + 보너스)
 *   fronts=1 → 도(1칸).  그 1개 평평면이 마크된 가락이면 백도(-1칸)
 *   fronts=2 → 개(2칸)
 *   fronts=3 → 걸(3칸)
 *   fronts=4 → 윷(4칸 + 보너스)
 *
 * 핵심 직관: 평평한 면 개수 = 이동 칸 수 (도=1, 개=2, 걸=3, 윷=4). 모만 예외(0→5).
 * 백도 확률: 1/16 = 6.25% (도 4/16 중 마크 가락이 평평면인 1/4).
 *
 * @returns {{ sticks: number[], result: string, steps: number, bonus: boolean, markedIndex: number }}
 *   sticks: 4개 가락의 앞(1=평평)/뒤(0=둥근) 배열
 *   result: 'backdo'|'do'|'gae'|'geol'|'yut'|'mo'
 *   steps: 이동 칸 수 (백도는 -1)
 *   bonus: 윷/모 보너스 턴 여부 (백도는 보너스 없음)
 *   markedIndex: 마크된 가락의 인덱스 (클라 렌더링용)
 */
export function throwYutSticks() {
  // sticks[i] = 1 → 앞면(평평한 면, isFront=true), 0 → 뒷면(둥근 면).
  const sticks = [0, 0, 0, 0].map(() => (Math.random() < 0.5 ? 1 : 0));
  const fronts = sticks.reduce((a, b) => a + b, 0);
  let result;
  switch (fronts) {
    case 0: result = 'mo'; break;    // 평평 0 / 둥근 4 → 모 (5칸 + 보너스)
    case 1:                          // 평평 1 / 둥근 3 → 도(1칸) 또는 백도(-1칸)
      if (sticks[MARKED_STICK_INDEX] === 1) {
        // 유일한 평평면이 마크 가락이면 백도 (도가 마크 가락에서 발동된 케이스)
        result = 'backdo';
      } else {
        result = 'do';
      }
      break;
    case 2: result = 'gae'; break;   // 평평 2 / 둥근 2 → 개 (2칸)
    case 3: result = 'geol'; break;  // 평평 3 / 둥근 1 → 걸 (3칸)
    case 4: result = 'yut'; break;   // 평평 4 / 둥근 0 → 윷 (4칸 + 보너스)
    default: result = 'do';
  }
  return {
    sticks,
    result,
    steps: YUT_STEPS[result],
    bonus: result === 'yut' || result === 'mo',
    markedIndex: MARKED_STICK_INDEX,
  };
}

// ── 보드 경로 정의 (서버 권위 — 클라이언트와 동일하게 board.js에도 복제) ───
//
// 칸 인덱스 매핑 (29칸 + 골인 상태):
//   외곽 (시작=0, 시계방향 진행):
//     0  = 시작점 (좌하 모서리, 출발 = 다시 여기로 돌아오면 완주)
//     1~4 = 좌측 변
//     5  = 좌상 모서리 (지름길A 진입 가능 → 21)
//     6~9 = 상단 변
//     10 = 우상 모서리 (지름길B 진입 가능 → 26)
//     11~14 = 우측 변
//     15 = 우하 모서리 (외곽만, 지름길 없음 — 한국 윷놀이는 모서리 2곳에 지름길 분기)
//     16~19 = 하단 변 → 19 다음 외곽 진행 시 0(=완주)
//   지름길A (좌상 → 중앙 → 우하 출구):
//     21, 22, 23(중앙), → 외곽 15로 합류 (지름길A 끝)
//   지름길B (우상 → 중앙 → 좌하 출구):
//     26, 27, 23(중앙 공유), → 외곽 0(완주 직전 19 위치로 합류해도 되지만,
//     단순화를 위해 중앙에서 좌하 시작점 0으로 직접 합류)
//
// 단순화 결정:
//   - 중앙(23)에서 분기: 합류처 두 곳 중 선택 (UI 모달).
//   - 모서리(5, 10)에 **정확히** 멈춘 다음 턴에 이동하면 자동으로 지름길로 진입.
//   - 모서리를 그냥 지나가는 경우는 지름길 미사용 (정통 룰에 부합).
//
// 본 구현의 NEXT_PATH 함수는 (현재칸, 모드) → 다음칸들의 시퀀스를 반환한다.
//
// 칸 좌표 (클라 렌더링용)는 board.js에서 정의. 서버는 인덱스/연결만 다룬다.
//
// 완주 처리: 칸 -1 = 아직 출발 전, 칸 인덱스가 GOAL(=99)이면 완주.

/** 완주 상태를 나타내는 가상 칸 인덱스. */
const GOAL = 99;
/** 아직 출발 안 한 말의 칸 인덱스. */
const HOME = -1;

/**
 * 모서리(5/10) 분기에서 지름길 진입을 의미하는 branchChoice인지 판정한다.
 * 단독 'shortcut' 외에 복합값 'shortcut-top'/'shortcut-bottom'도 지름길 진입으로 본다.
 * @param {string|null} branchChoice
 * @returns {boolean}
 */
function isShortcutChoice(branchChoice) {
  return branchChoice === 'shortcut'
    || branchChoice === 'shortcut-top'
    || branchChoice === 'shortcut-bottom';
}

/**
 * 중앙(23) 출구 결정 시 centerExitB(아래쪽 출구)인지 판정한다.
 * 'bottom' 또는 복합값 '...-bottom'으로 끝나면 centerExitB.
 * @param {string|null} branchChoice
 * @returns {boolean}
 */
function isBottomExit(branchChoice) {
  return typeof branchChoice === 'string' && branchChoice.endsWith('bottom');
}

/**
 * 현재 칸에서 steps만큼 이동했을 때 도착하는 칸 인덱스를 계산한다.
 * 지름길 진입 여부는 fromCell에 진입할 때 결정되며, 본 함수는 한 번의 이동 결과만 반환.
 *
 * @param {number} fromCell  현재 칸 (HOME, 0~28, 또는 중앙23)
 * @param {number} steps     이동 칸 수 (1~5)
 * @param {string|null} branchChoice  분기 선택값. null이면 분기 결정이 필요한 상태로 반환한다.
 *   - 모서리(5/10) 분기: 'outer'(외곽 유지) | 'shortcut'(지름길 진입)
 *   - 중앙(23) 분기: 'top'(centerExitA) | 'bottom'(centerExitB)
 *   - 복합(모서리 지름길 진입 + 그 이동이 중앙을 통과해 중앙 출구까지 동시 결정):
 *     'shortcut-top' | 'shortcut-bottom'. 모서리에 멈춘 말이 윷/모로 지름길을 타고
 *     중앙을 통과할 때, 1차 모서리 선택('shortcut')과 2차 중앙 선택('top'/'bottom')을
 *     한 값으로 합성하여 재호출하는 데 사용한다 (CHOOSE_PATH 2차 응답 합성).
 * @returns {{ toCell: number, awaitingBranch: boolean, passedStart: boolean }}
 *
 *   toCell: 도착 칸 (GOAL 가능)
 *   awaitingBranch: 중앙에서 분기 결정이 필요하면 true → 클라가 CHOOSE_PATH로 응답
 *   passedStart: 시작점(0)을 통과하거나 도착하여 완주했는지
 */
export function computeNextCell(fromCell, steps, branchChoice = null) {
  // 백도(-1): 한 칸 뒤로. HOME 말은 호출자에서 사전 차단됨.
  // 규칙(단순화):
  //  - 외곽 칸에서 백도 → 이전 외곽 칸 (단, cell 0이면 그대로 0 유지: 출발선 뒤로 못 감)
  //  - 지름길 안에서 백도 → 지름길 진입 모서리로 되돌아감 (5 또는 10)
  //    · 21 → 5,   22 → 21
  //    · 26 → 10,  27 → 26
  //  - 중앙(23) 백도 → 마지막 통과 칸을 알 수 없으므로 22로 통일 (지름길A 경로 기준).
  //    (한국 정통 룰에도 명확한 정의 없음 — 친구 대전 단순화)
  if (steps === -1) {
    if (fromCell === HOME || fromCell === GOAL) {
      return { toCell: fromCell, awaitingBranch: false, passedStart: false };
    }
    if (fromCell === 0) {
      // 출발선 뒤로는 못 감 → 그대로 유지
      return { toCell: 0, awaitingBranch: false, passedStart: false };
    }
    if (fromCell >= 1 && fromCell <= 19) {
      return { toCell: fromCell - 1, awaitingBranch: false, passedStart: false };
    }
    if (fromCell === 21) return { toCell: 5, awaitingBranch: false, passedStart: false };
    if (fromCell === 22) return { toCell: 21, awaitingBranch: false, passedStart: false };
    if (fromCell === 26) return { toCell: 10, awaitingBranch: false, passedStart: false };
    if (fromCell === 27) return { toCell: 26, awaitingBranch: false, passedStart: false };
    if (fromCell === 23) return { toCell: 22, awaitingBranch: false, passedStart: false };
    // FIX-3 (§9-2): centerExitB 중간 칸 백도 복귀 — 25 → 24, 24 → 23.
    if (fromCell === 25) return { toCell: 24, awaitingBranch: false, passedStart: false };
    if (fromCell === 24) return { toCell: 23, awaitingBranch: false, passedStart: false };
    return { toCell: fromCell, awaitingBranch: false, passedStart: false };
  }

  // 정통 룰: HOME(출발점) → 첫 던지기에서 출발 칸은 카운트하지 않는다.
  // advanceOneCell의 -1 → 1 매핑이 이를 처리. 즉 HOME에서 도 → 칸 1, 걸 → 칸 3.
  let current = fromCell === HOME ? -1 : fromCell;

  // 본 구현의 외곽 진행 방향: 0 → 1 → 2 → ... → 19 → 0(완주)
  // 모서리 5(좌상), 10(우상)에 **정확히** 멈춘 다음 턴 이동은 지름길 분기 가능.
  // 본 함수는 단순화를 위해: 모서리에 멈춘 직후 다음 이동이라면 자동으로 지름길 진입.
  // (옵션 분기는 한국 정통 룰이지만 LAN 친구 대전에서는 자동 진입이 더 빠름)

  // 지름길 칸 목록 (인덱스):
  //   A (좌상 5 → 중앙 23 → 우하 합류):  [21, 22, 23] 그 다음 -> 외곽 15
  //   B (우상 10 → 중앙 23 → 좌하 합류): [26, 27, 23] 그 다음 -> 외곽 0(=완주)
  //   참고: 중앙 23 도달 시 awaitingBranch 트리거 (양쪽 출구 선택 가능)

  // 진행 시퀀스 빌드: 한 칸씩 advance하며 분기 처리.
  let cell = current;
  let pathContext = 'outer'; // 'outer' | 'shortcutA' | 'shortcutB' | 'centerExitA' | 'centerExitB'
  let passedStart = false;

  // 시작 칸 결정
  if (cell === -1) {
    // 출발선에서 이동 → 첫 칸은 0
    cell = -1; // advance 루프에서 첫 단계에서 0으로 진입
  } else if (cell === 5) {
    // FIX-2 (§10-2, §13-1 해소): 좌상 모서리에 멈춰 있었음 — 외곽/지름길 선택 분기.
    // branchChoice가 없으면 분기 선택 요청(awaitingBranch)을 반환하고 piece는 이동하지 않는다.
    // 'shortcut' → 지름길A 진입, 'outer'(그 외) → 외곽 유지.
    if (!branchChoice) {
      return { toCell: 5, awaitingBranch: true, passedStart: false };
    }
    // 모서리 지름길 판정: 'shortcut' 또는 복합값 'shortcut-top'/'shortcut-bottom' → 지름길A.
    // 'outer'(그 외) → 외곽 유지.
    pathContext = isShortcutChoice(branchChoice) ? 'shortcutA' : 'outer';
  } else if (cell === 10) {
    // FIX-2 (§10-2, §13-1 해소): 우상 모서리 — 외곽/지름길B 선택 분기.
    if (!branchChoice) {
      return { toCell: 10, awaitingBranch: true, passedStart: false };
    }
    pathContext = isShortcutChoice(branchChoice) ? 'shortcutB' : 'outer';
  } else if (cell >= 21 && cell <= 22) {
    pathContext = 'shortcutA';
  } else if (cell >= 26 && cell <= 27) {
    pathContext = 'shortcutB';
  } else if (cell === 24 || cell === 25) {
    // FIX-3 (§10-4, §13-2 해소): centerExitB 중간 칸에서 출발 — 잔여 steps 소진.
    pathContext = 'centerExitB';
  } else if (cell === 23) {
    // 중앙에서 출발 — branchChoice 필요
    if (!branchChoice) {
      return { toCell: 23, awaitingBranch: true, passedStart: false };
    }
    pathContext = isBottomExit(branchChoice) ? 'centerExitB' : 'centerExitA';
  }

  // 한 칸씩 진행
  for (let i = 0; i < steps; i++) {
    cell = advanceOneCell(cell, pathContext);
    // pathContext 갱신: 모서리/중앙에 도달했는지 체크
    if (cell === 23) {
      // 중앙 도달 — 다음 칸 분기 필요 (남은 스텝이 있을 때만).
      // FIX-2: 중앙 출구는 중앙 선택값('top'|'bottom')으로 결정된다. 모서리 단독 선택('outer'|'shortcut')은
      // 중앙 출구 정보가 없으므로, 그 값으로 진입한 이동이 중앙에 잔여 steps 있이 도달하면 중앙 분기를 새로 대기시킨다.
      // 복합값('shortcut-top'|'shortcut-bottom')은 중앙 출구 정보를 이미 포함하므로 재대기 없이 즉시 출구로 진행한다.
      const isCenterChoice =
        branchChoice === 'top' || branchChoice === 'bottom'
        || branchChoice === 'shortcut-top' || branchChoice === 'shortcut-bottom';
      if (i < steps - 1 && !isCenterChoice) {
        return { toCell: 23, awaitingBranch: true, passedStart: false };
      }
      if (isCenterChoice) {
        pathContext = isBottomExit(branchChoice) ? 'centerExitB' : 'centerExitA';
      }
    } else if (cell === GOAL) {
      passedStart = true;
      return { toCell: GOAL, awaitingBranch: false, passedStart: true };
    }
  }
  return { toCell: cell, awaitingBranch: false, passedStart };
}

/**
 * 한 칸 전진 헬퍼.
 *
 * @param {number} cell           현재 칸 인덱스 (또는 -1 = HOME)
 * @param {string} pathContext    'outer' | 'shortcutA' | 'shortcutB' | 'centerExitA' | 'centerExitB'
 * @returns {number} 다음 칸 인덱스 (GOAL 가능)
 */
function advanceOneCell(cell, pathContext) {
  if (pathContext === 'outer') {
    // 정통 룰: HOME(출발점) → 첫 던지기에서 출발 칸은 카운트하지 않는다.
    // 즉 HOME에서 도(1) → 칸 1, 걸(3) → 칸 3. 출발 칸 자체(칸 0)는 "지나가는 칸"으로 처리.
    if (cell === -1) return 1;        // HOME → 출발선 통과 + 첫 칸 카운트 = 칸 1
    if (cell >= 1 && cell < 19) return cell + 1;
    if (cell === 19) return GOAL;
    if (cell === 0) return 1;         // 안전망: 칸 0(출발선)에 있으면 다음은 칸 1
    return GOAL;
  }
  if (pathContext === 'shortcutA') {
    // 5 → 21 → 22 → 23(중앙) → centerExit 결정 필요
    if (cell === 5) return 21;
    if (cell === 21) return 22;
    if (cell === 22) return 23;
    if (cell === 23) return 23; // 분기 미결정 — 호출부에서 처리
    return GOAL;
  }
  if (pathContext === 'shortcutB') {
    // 10 → 26 → 27 → 23(중앙)
    if (cell === 10) return 26;
    if (cell === 26) return 27;
    if (cell === 27) return 23;
    if (cell === 23) return 23;
    return GOAL;
  }
  if (pathContext === 'centerExitA') {
    // 중앙 → 외곽 15(우하 출구) → 16 → 17 → 18 → 19 → GOAL
    if (cell === 23) return 15;
    if (cell >= 15 && cell < 19) return cell + 1;
    if (cell === 19) return GOAL;
    return GOAL;
  }
  if (pathContext === 'centerExitB') {
    // FIX-3 (§10-4, §13-2 해소): 중앙(23) → 24 → 25 → GOAL (날밭 2칸 거쳐 완주).
    // 정통 룰의 중앙~좌하 출발점 사이 중간 칸 2개(24/25)를 거쳐 잔여 steps를 소진한다.
    if (cell === 23) return 24;
    if (cell === 24) return 25;
    if (cell === 25) return GOAL;
    if (cell === GOAL) return GOAL; // 이미 완주 — 잔여 steps 안전 흡수
    return GOAL;
  }
  return cell;
}

// ──────────────────────────────────────────────────────────────
// createApp(): launcher 통합 라우터용 앱 인스턴스를 생성한다.
// 모든 룸 상태(players/game)는 closure 내부에 보관되어 다른 게임과 격리된다.
// 옵션:
//   - opts.hostUrl: JOINED 메시지에 포함될 친구 안내용 URL. 통합 라우터에서 launcher가
//     공급한다. 미지정 시 빈 문자열.
// ──────────────────────────────────────────────────────────────
/**
 * 윷놀이 게임 앱 인스턴스를 생성한다.
 * @param {{ hostUrl?: string, getBotUrl?: () => (string|null) }} [opts]
 *   - getBotUrl(): mode=ai 사용자 진입 시 봇이 접속할 WS URL을 반환한다.
 *     null 반환 시 봇 spawn을 스킵한다. 미지정 시 항상 null(봇 비활성).
 * @returns {{ handleHttp: Function, handleUpgrade: Function, setHostUrl: Function }}
 *   - setHostUrl(url): 부트스트랩 이후 LAN URL이 결정되면 갱신.
 */
export function createApp(opts = {}) {
  // closure 변수: standalone listen 이후 setHostUrl로 갱신 가능.
  let HOST_URL = typeof opts.hostUrl === 'string' ? opts.hostUrl : '';
  // mode=ai 사용자가 들어왔을 때 봇이 접속할 WS URL 공급 함수.
  const getBotUrl = typeof opts.getBotUrl === 'function' ? opts.getBotUrl : (() => null);

  // ── express 앱 (정적 서빙) ────────────────────────────────────
  const expressApp = express();

  // ── 테스트 전용 엔드포인트 ───────────────────────────────────
  // POST /test/inject: 게임 상태를 직접 주입한다 (Playwright E2E/WS 테스트용).
  // 요청 바디(JSON)에서 다음 필드를 선택적으로 주입한다:
  //   started, currentTurn, pendingResults, awaitingBranchAt,
  //   awaitingBranchResult, capturedBonus, winner,
  //   pieces: { p1: [{cell,stack,done}, ...], p2: [...] }
  expressApp.post('/test/inject', express.json(), (req, res) => {
    const cfg = req.body || {};
    if (cfg.started !== undefined) game.started = Boolean(cfg.started);
    if (cfg.currentTurn !== undefined) game.currentTurn = cfg.currentTurn;
    if (cfg.pendingResults !== undefined) {
      game.pendingResults = Array.isArray(cfg.pendingResults) ? cfg.pendingResults.slice() : [];
    }
    if (cfg.awaitingBranchAt !== undefined) game.awaitingBranchAt = cfg.awaitingBranchAt;
    if (cfg.awaitingBranchResult !== undefined) game.awaitingBranchResult = cfg.awaitingBranchResult;
    if (cfg.awaitingBranchType !== undefined) game.awaitingBranchType = cfg.awaitingBranchType; // FIX-2
    if (cfg.capturedBonus !== undefined) game.capturedBonus = Boolean(cfg.capturedBonus);
    if (cfg.winner !== undefined) {
      game.winner = cfg.winner;
      if (cfg.winner) game.started = false;
    }
    if (cfg.pieces) {
      for (const pid of ['p1', 'p2']) {
        if (!Array.isArray(cfg.pieces[pid])) continue;
        const p = players.find((pl) => pl.id === pid);
        if (!p) continue;
        p.pieces = cfg.pieces[pid].map((pc) => ({
          cell: typeof pc.cell === 'number' ? pc.cell : HOME,
          stack: typeof pc.stack === 'number' ? pc.stack : 1,
          done: typeof pc.done === 'boolean' ? pc.done : false,
        }));
      }
    }
    broadcastState();
    if (cfg.winner) {
      broadcastAll({ type: 'GAME_OVER', winner: cfg.winner });
    }
    res.json({ ok: true });
  });

  expressApp.use(express.static(PUBLIC_DIR));

  // ── WSS (noServer 모드) ───────────────────────────────────────
  const wss = new WebSocketServer({ noServer: true });

  // ── 봇 자식 프로세스 관리 (mode=ai 사용자가 들어왔을 때 자동 spawn) ───
  /** @type {import('child_process').ChildProcess|null} */
  let botChild = null;

  /**
   * 봇 자식 프로세스를 spawn한다. 이미 실행 중이면 무시.
   * bot.js가 없거나 getBotUrl이 null을 반환하면 경고 출력 후 스킵.
   */
  function spawnBotChild() {
    const botPath = path.join(__dirname, 'bot.js');
    if (!fs.existsSync(botPath)) {
      console.warn('[yutnori] bot.js 없음 — 봇 spawn 스킵');
      return;
    }
    if (botChild && botChild.exitCode === null) {
      console.log('[yutnori] 봇 이미 실행 중');
      return;
    }
    const url = getBotUrl();
    if (!url) {
      console.warn('[yutnori] getBotUrl이 null 반환 — 봇 spawn 스킵');
      return;
    }
    console.log(`[yutnori] 봇 spawn: ${url}`);
    botChild = spawn(process.execPath, [botPath, '--url', url], {
      detached: false,
      stdio: 'ignore',
      env: process.env, // YUTNORI_BOT_DELAY_* 등 환경변수 전파 (테스트 속도 조정용)
    });
    botChild.on('exit', (code) => {
      console.log(`[yutnori] 봇 종료 (code=${code})`);
      botChild = null;
    });
  }

  /**
   * 봇 자식 프로세스를 종료한다. mode=ai 사용자가 끊어졌을 때 호출.
   */
  function killBotChild() {
    if (botChild && botChild.exitCode === null) {
      console.log('[yutnori] 봇 종료 요청');
      botChild.kill();
      botChild = null;
    }
  }

// ── 게임 상태 ────────────────────────────────────────────────────
/**
 * @typedef {Object} Piece
 * @property {number} cell       현재 칸 (HOME=-1, 0~28, GOAL=99)
 * @property {number} stack      같이 업힌 말 개수 (1=단독, 2이상=업힘 묶음의 대표)
 *                                업힌 말의 cell은 동일하게 갱신되므로 별도 추적 불필요.
 * @property {boolean} done      완주 여부
 */

/**
 * @typedef {Object} PlayerState
 * @property {string} id          'p1' | 'p2'
 * @property {string} name
 * @property {Piece[]} pieces     4개의 말
 * @property {boolean} ready
 * @property {boolean} rematchReady
 * @property {import('ws').WebSocket} ws
 */

/** @type {PlayerState[]} */
let players = [];

/**
 * 게임 진행 상태.
 * @type {{
 *   started: boolean,
 *   currentTurn: string|null,    // 'p1'|'p2'|null
 *   pendingResults: string[],    // 현재 턴 플레이어가 누적한 윷 결과 큐 (예: ['yut','do'])
 *   awaitingBranchAt: number|null,  // 분기 선택 대기 중인 piece index (null이면 대기 없음)
 *   awaitingBranchResult: string|null, // 분기 시 적용할 결과 (큐에서 차감 대기)
 *   winner: string|null,
 * }}
 */
let game = {
  started: false,
  currentTurn: null,
  pendingResults: [],
  awaitingBranchAt: null,
  awaitingBranchResult: null,
  // FIX-2: 분기 대기 유형. 'center'(중앙 23 분기) | 'corner'(모서리 5/10 분기) | null.
  // 클라이언트가 동일 onBranchRequest 핸들러에서 모달 버튼 텍스트를 구분하는 데 사용.
  awaitingBranchType: null,
  winner: null,
  // 잡기 보너스 권리 플래그 (룰북 §6-2, §13-11).
  // true면 큐가 비어도 추가 THROW_YUT 1회 허용. THROW 후 즉시 false로 소진.
  capturedBonus: false,
};

/**
 * 룸 초기화 (재대결 진입 또는 신규 시작 시).
 */
function resetGame() {
  for (const p of players) {
    p.pieces = [createPiece(), createPiece(), createPiece(), createPiece()];
    p.rematchReady = false;
  }
  game.started = true;
  game.currentTurn = 'p1';
  game.pendingResults = [];
  game.awaitingBranchAt = null;
  game.awaitingBranchResult = null;
  game.awaitingBranchType = null; // FIX-2: 분기 유형 초기화
  game.winner = null;
  // §13-11: 이전 게임의 capturedBonus 잔류 방지 (REMATCH 경계 케이스).
  game.capturedBonus = false;
}

function createPiece() {
  return { cell: HOME, stack: 1, done: false };
}

/**
 * 전체 룸을 신규 상태로 (READY 풀림). 재대결 끝나고 새 매칭용.
 */
function softResetRoom() {
  for (const p of players) {
    p.ready = false;
    p.rematchReady = false;
    p.pieces = [createPiece(), createPiece(), createPiece(), createPiece()];
  }
  game = {
    started: false,
    currentTurn: null,
    pendingResults: [],
    awaitingBranchAt: null,
    awaitingBranchResult: null,
    awaitingBranchType: null, // FIX-2: 분기 유형 초기화
    winner: null,
    // §13-11: 룸 전체 리셋 시 capturedBonus도 초기화 (잔류 방지).
    capturedBonus: false,
  };
}

/**
 * 모든 플레이어에게 현재 게임 전체 상태를 broadcast 한다.
 */
function broadcastState() {
  const payload = {
    type: 'STATE',
    started: game.started,
    currentTurn: game.currentTurn,
    pendingResults: game.pendingResults.slice(),
    awaitingBranchAt: game.awaitingBranchAt,
    awaitingBranchResult: game.awaitingBranchResult,
    awaitingBranchType: game.awaitingBranchType, // FIX-2: 분기 유형 전달
    // 잡기 보너스 권리. true면 큐가 비어도 추가 THROW_YUT가 가능하다.
    // 봇이 자체 추적 없이 STATE에서만 읽어 던지기 가능 여부를 판단하도록 노출(후방 호환 필드 추가).
    capturedBonus: game.capturedBonus === true,
    winner: game.winner,
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      pieces: p.pieces.map((piece) => ({
        cell: piece.cell,
        stack: piece.stack,
        done: piece.done,
      })),
    })),
  };
  broadcastAll(payload);
}

function broadcastAll(payload) {
  const msg = JSON.stringify(payload);
  for (const p of players) {
    if (p.ws.readyState === 1) p.ws.send(msg);
  }
}

function sendTo(player, payload) {
  if (player && player.ws.readyState === 1) {
    player.ws.send(JSON.stringify(payload));
  }
}

/**
 * 현재 턴 플레이어 객체를 반환한다.
 * @returns {PlayerState|null}
 */
function currentPlayer() {
  return players.find((p) => p.id === game.currentTurn) || null;
}

/**
 * 다음 플레이어로 턴 넘김.
 */
function passTurn() {
  game.currentTurn = game.currentTurn === 'p1' ? 'p2' : 'p1';
  game.pendingResults = [];
  game.awaitingBranchAt = null;
  game.awaitingBranchResult = null;
  game.awaitingBranchType = null; // FIX-2: 턴 종료 시 분기 유형 초기화
}

/**
 * 잡기/업기 처리 + 승리 판정. piece 이동 후 호출.
 * @param {PlayerState} mover  이동시킨 플레이어
 * @param {number} pieceIdx    이동한 말 인덱스
 * @returns {{ captured: boolean, finished: boolean }}
 *   captured: 상대 말을 잡았는지 (보너스 턴)
 *   finished: 이 플레이어가 모든 말 완주하여 승리했는지
 */
function resolveLanding(mover, pieceIdx) {
  const piece = mover.pieces[pieceIdx];
  let captured = false;

  if (piece.done || piece.cell === HOME || piece.cell === GOAL) {
    // 완주 또는 출발 전이면 충돌 없음
  } else {
    // 같은 칸에 다른 말이 있는가?
    // 1) 자기 말 → 업기 (해당 칸의 모든 자기 말 묶음을 piece로 합침)
    // 2) 상대 말 → 잡기 (상대 말 전부 HOME으로 + 보너스)
    const opp = players.find((p) => p.id !== mover.id);
    if (opp) {
      let oppCaught = 0;
      for (let i = 0; i < opp.pieces.length; i++) {
        const op = opp.pieces[i];
        if (!op.done && op.cell === piece.cell) {
          oppCaught += op.stack;
          op.cell = HOME;
          op.stack = 1; // 잡혀 흩어짐 — 업혀 있던 말도 전부 HOME으로
        }
      }
      if (oppCaught > 0) {
        captured = true;
      }
    }
    // 자기 말 업기
    for (let i = 0; i < mover.pieces.length; i++) {
      if (i === pieceIdx) continue;
      const mp = mover.pieces[i];
      if (!mp.done && mp.cell === piece.cell) {
        // 합치기: mp를 piece에 흡수. mp는 "없는 셈"으로 처리하기 위해 cell을 -2(흡수됨) 표시 대신
        // 단순화: mp.stack을 piece.stack에 더하고 mp는 같은 셀에 그대로 두되 stack=0으로 둠 → 렌더링 시 0은 표시 X.
        // 하지만 추후 이동 시 stack=0 말이 따라다녀야 함. 더 단순한 방법: mp를 piece에 흡수하고
        // 두 말의 위치를 동일하게 유지하면서 stack만 piece에 합치고, mp.stack=0으로 두면 다음 이동 시
        // 사용 불가(0) 처리. 또는 mp.done=false인 채로 "follower" 표시.
        //
        // 더 단순한 접근: piece와 mp는 별도 객체로 두고 stack은 각자 유지하되, 같은 cell에 있으면
        // 항상 함께 이동한다고 가정 (이동 시 같은 cell의 자기 말을 한꺼번에 옮김).
        // 이 방식으로 변경 → mp.stack은 그대로, 이동 시 묶음 처리.
        // → 본 함수에서는 별도 처리 불필요. (movePiece에서 같은 cell 자기 말 함께 이동)
      }
    }
  }

  // 승리 판정
  const allDone = mover.pieces.every((p) => p.done);
  return { captured, finished: allDone };
}

/**
 * 이동 가능한 말 인덱스 목록을 반환한다 (현재 플레이어 + 선택한 결과 기준).
 * 백도는 출발한 말(HOME 아닌)만 사용 가능.
 *
 * @param {PlayerState} player
 * @param {string} resultName 'backdo'|'do'|'gae'|...
 * @returns {number[]}
 */
function getMovablePieces(player, resultName) {
  const steps = YUT_STEPS[resultName];
  if (steps === undefined) return [];
  const result = [];
  for (let i = 0; i < player.pieces.length; i++) {
    const piece = player.pieces[i];
    if (piece.done) continue;
    if (piece.stack === 0) continue; // 흡수된 말 (현재 모델에선 발생 안 함)
    // 백도: HOME 말은 뒤로 갈 수 없음
    if (resultName === 'backdo' && piece.cell === HOME) continue;
    result.push(i);
  }
  return result;
}

/**
 * 선택된 말을 이동시키고 충돌 처리 및 결과 반환.
 * @param {PlayerState} mover
 * @param {number} pieceIdx
 * @param {string} resultName
 * @param {string|null} branchChoice 'top'|'bottom'|null
 * @returns {{
 *   ok: boolean,
 *   awaitingBranch?: boolean,
 *   captured?: boolean,
 *   finished?: boolean,
 *   movedTo?: number,
 *   error?: string
 * }}
 */
function movePiece(mover, pieceIdx, resultName, branchChoice = null) {
  const piece = mover.pieces[pieceIdx];
  if (!piece || piece.done) return { ok: false, error: '이미 완주한 말' };
  const steps = YUT_STEPS[resultName];
  if (steps === undefined) return { ok: false, error: '알 수 없는 결과' };

  // 백도는 출발한 말만 사용 가능
  if (resultName === 'backdo' && piece.cell === HOME) {
    return { ok: false, error: '백도는 출발한 말에만 사용할 수 있습니다.' };
  }

  const res = computeNextCell(piece.cell, steps, branchChoice);
  if (res.awaitingBranch) {
    // 분기 결정 대기 — 임시로 piece를 중앙(23)에 올려두고 분기 선택 후 잔여 이동.
    // 본 구현은 중앙 도달 = 단일 이동의 종료점으로 다루지 않고, "분기 선택 요청"을 클라에 보내고
    // CHOOSE_PATH 응답을 받아서 computeNextCell을 재호출한다.
    // → piece는 아직 이동시키지 않은 상태로 두고 awaitingBranch 상태만 기록.
    return { ok: true, awaitingBranch: true };
  }

  // 같은 cell에 있던 자기 말(업힌 묶음)을 함께 이동시킨다.
  const startCell = piece.cell;
  const groupIndices = [pieceIdx];
  if (startCell !== HOME && startCell !== GOAL) {
    for (let i = 0; i < mover.pieces.length; i++) {
      if (i === pieceIdx) continue;
      const mp = mover.pieces[i];
      if (!mp.done && mp.cell === startCell) {
        groupIndices.push(i);
      }
    }
  }

  // 이동 적용
  for (const idx of groupIndices) {
    const mp = mover.pieces[idx];
    mp.cell = res.toCell;
    if (res.toCell === GOAL) {
      mp.done = true;
    }
  }

  // 충돌 처리 (잡기). 업기는 다음 이동 시 group으로 묶이므로 별도 적용 X.
  const { captured, finished } = resolveLanding(mover, pieceIdx);

  return {
    ok: true,
    awaitingBranch: false,
    captured,
    finished,
    movedTo: res.toCell,
  };
}

// ── WebSocket 핸들러 ─────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  // URL 쿼리에서 mode 파싱 (launcher가 mode=ai|bot|human 전달).
  //   - 'ai'  : 사람 사용자가 AI 대전을 원함 → 서버가 봇 자식 프로세스 spawn.
  //   - 'bot' : spawn된 봇 본인 접속.
  //   - 그 외 : 일반 사람 대전.
  const reqUrlObj = new URL(req.url || '/', 'http://localhost');
  const wsMode = reqUrlObj.searchParams.get('mode') || 'human';
  const isBot = wsMode === 'bot';

  if (players.length >= 2) {
    ws.send(JSON.stringify({ type: 'ERROR', message: 'Room is full' }));
    ws.close();
    console.log('[server] 연결 거절: 룸 정원 초과');
    return;
  }

  // FIX-1: 미사용 ID를 배정 (재입장 데드락 방지).
  // p1이 disconnect 후 재접속 시 players에는 p2만 남아 있으므로
  // players.length === 0 ? 'p1' : 'p2' 방식은 'p2'를 중복 배정해 게임이 잠긴다.
  // 현재 players 배열에 'p1'이 없으면 'p1', 있으면 'p2'를 배정한다.
  const usedIds = new Set(players.map((p) => p.id));
  const playerId = !usedIds.has('p1') ? 'p1' : 'p2';
  /** @type {PlayerState} */
  const player = {
    id: playerId,
    name: '',
    pieces: [createPiece(), createPiece(), createPiece(), createPiece()],
    ready: false,
    rematchReady: false,
    ws,
  };
  players.push(player);
  console.log(`[server] ${playerId} 연결됨 (현재 인원: ${players.length}/2, mode=${wsMode})`);

  // mode=ai 사용자가 혼자 들어왔다 → 봇 자동 spawn (자기 자식 프로세스).
  // 봇이 connect하면 두 번째 슬롯을 차지하고 JOIN/READY로 게임을 시작한다.
  // 약간의 지연: 사용자 클라이언트가 JOIN/READY를 먼저 보낼 여유 확보.
  if (wsMode === 'ai' && !isBot && players.length === 1) {
    setTimeout(() => spawnBotChild(), 200);
  }

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      console.warn('[server] JSON 파싱 실패:', data.toString());
      return;
    }

    switch (msg.type) {
      case 'JOIN': {
        player.name = (msg.playerName || playerId).toString().slice(0, 32);
        sendTo(player, {
          type: 'JOINED',
          playerId: player.id,
          waiting: players.length < 2,
          hostUrl: HOST_URL,
        });
        // 두 명 다 들어오면 알림용 STATE도 broadcast (대기 화면에서 상대 입장 즉시 반영)
        if (players.length === 2) {
          broadcastState();
        }
        break;
      }

      case 'READY': {
        player.ready = true;
        console.log(`[server] ${player.id} READY`);
        if (players.length === 2 && players.every((p) => p.ready)) {
          console.log('[server] 양쪽 READY → 게임 시작');
          resetGame();
          broadcastAll({ type: 'START', countdown: 3 });
          broadcastState();
        }
        break;
      }

      case 'THROW_YUT': {
        // 권위 처리: 현재 턴 + 던질 자격(빈 큐 또는 직전 결과가 yut/mo)인지 확인
        if (!game.started || game.winner) {
          sendTo(player, { type: 'ERROR', message: '게임이 진행 중이 아닙니다.' });
          break;
        }
        if (game.currentTurn !== player.id) {
          sendTo(player, { type: 'ERROR', message: '지금은 당신의 턴이 아닙니다.' });
          break;
        }
        if (game.awaitingBranchAt !== null) {
          sendTo(player, { type: 'ERROR', message: '분기 선택 후 던지세요.' });
          break;
        }
        // pendingResults에 결과가 남아 있으면 → 보너스 던지기 자격 필요
        // (마지막 결과가 yut/mo가 아니면 우선 말을 움직여야 함)
        if (game.pendingResults.length > 0) {
          const last = game.pendingResults[game.pendingResults.length - 1];
          if (last !== 'yut' && last !== 'mo') {
            sendTo(player, { type: 'ERROR', message: '먼저 결과를 사용하여 말을 옮기세요.' });
            break;
          }
        }
        const thrown = throwYutSticks();
        // §13-11 + FIX-4 (§6): 잡기 보너스 권리(capturedBonus)는 "한 턴 안 단 한 번"만 추가 THROW 보장.
        // FIX-4: capturedBonus 소진은 "큐가 비어 있어 capturedBonus 권리로 진입한 던지기"일 때만 1회 수행한다.
        //   - 큐가 비어 있고 capturedBonus=true → 이 던지기는 capturedBonus 권리로 진입한 것 → 소진.
        //   - 큐에 yut/mo가 남아 진입한 던지기(보너스 던지기 권리)에서는 capturedBonus를 보존한다.
        //     (보너스 권리가 윷/모 던지기 권리에 의해 부당하게 소진되는 것을 방지)
        // 이 처리가 없으면 잡기 → 보너스 THROW(do 등) → MOVE 후에도 capturedBonus=true가 남아
        // 큐가 비어도 hasBonus=true로 평가되어 턴이 결정적으로 잠긴다 (QA-D2-001/002 재현).
        const enteredViaCapturedBonus =
          game.pendingResults.length === 0 && game.capturedBonus === true;
        if (enteredViaCapturedBonus) {
          game.capturedBonus = false;
        }
        // 백도인데 출발한 말이 하나도 없으면 자동 폐기 (큐에 넣지 않음).
        // 사용자에게 결과는 알려주되, 사용 불가하므로 다음 던지기/턴 종료로 진행한다.
        const canUseBackdo = thrown.result !== 'backdo'
          || player.pieces.some((p) => !p.done && p.cell !== HOME);
        if (canUseBackdo) {
          game.pendingResults.push(thrown.result);
        }
        console.log(`[server] ${player.id} 던지기: ${YUT_NAMES_KO[thrown.result]} (sticks=${thrown.sticks.join('')})${canUseBackdo ? '' : ' [백도 사용 불가 — 자동 폐기]'}`);
        broadcastAll({
          type: 'YUT_RESULT',
          by: player.id,
          sticks: thrown.sticks,
          result: thrown.result,
          steps: thrown.steps,
          bonus: thrown.bonus,
          markedIndex: thrown.markedIndex,
          discarded: !canUseBackdo,
        });
        // 백도가 자동 폐기됐고, 보너스도 없고, 큐도 비었으면 턴 종료
        if (!canUseBackdo) {
          const lastResultDiscard = game.pendingResults.length > 0
            ? game.pendingResults[game.pendingResults.length - 1]
            : null;
          const hasBonusDiscard = game.capturedBonus === true
            || lastResultDiscard === 'yut' || lastResultDiscard === 'mo';
          if (game.pendingResults.length === 0 && !hasBonusDiscard) {
            passTurn();
            game.capturedBonus = false;
          }
        }
        broadcastState();
        break;
      }

      case 'MOVE_PIECE': {
        if (!game.started || game.winner) break;
        if (game.currentTurn !== player.id) {
          sendTo(player, { type: 'ERROR', message: '지금은 당신의 턴이 아닙니다.' });
          break;
        }
        if (game.awaitingBranchAt !== null) {
          sendTo(player, { type: 'ERROR', message: '분기 선택을 먼저 해주세요.' });
          break;
        }
        const pieceIdx = Number.isInteger(msg.pieceIndex) ? msg.pieceIndex : -1;
        const useResult = typeof msg.useResult === 'string' ? msg.useResult : null;
        if (pieceIdx < 0 || pieceIdx > 3) {
          sendTo(player, { type: 'ERROR', message: '잘못된 말 인덱스' });
          break;
        }
        // 사용 결과는 pendingResults 큐 안에 있어야 함
        const queueIdx = game.pendingResults.indexOf(useResult);
        if (queueIdx < 0) {
          sendTo(player, { type: 'ERROR', message: '사용할 수 없는 결과입니다.' });
          break;
        }
        const piece = player.pieces[pieceIdx];
        if (!piece || piece.done) {
          sendTo(player, { type: 'ERROR', message: '완주한 말은 옮길 수 없습니다.' });
          break;
        }
        const moveRes = movePiece(player, pieceIdx, useResult, null);
        if (!moveRes.ok) {
          sendTo(player, { type: 'ERROR', message: moveRes.error || '이동 실패' });
          break;
        }
        if (moveRes.awaitingBranch) {
          // 분기 대기. pendingResults는 차감하지 않고 awaiting 표시.
          game.awaitingBranchAt = pieceIdx;
          game.awaitingBranchResult = useResult;
          // FIX-2: 분기 유형 판별 — 출발 칸(아직 이동 전이므로 piece.cell이 fromCell)이
          // 모서리(5/10)면 'corner', 그 외(중앙 23)면 'center'.
          const branchFromCell = player.pieces[pieceIdx].cell;
          game.awaitingBranchType =
            branchFromCell === 5 || branchFromCell === 10 ? 'corner' : 'center';
          broadcastAll({
            type: 'BRANCH_REQUEST',
            pieceIndex: pieceIdx,
            playerId: player.id,
            branchType: game.awaitingBranchType, // FIX-2
          });
          broadcastState();
          break;
        }
        // 결과 큐에서 차감
        game.pendingResults.splice(queueIdx, 1);

        // §6-1 / §13-12: 윷·모로 잡으면 잡기 보너스와 윷/모 자체 보너스(추가 던지기)는
        // 중복되지 않는다 (한 행위 최대 1회). 윷/모를 던진 것 자체가 이미 추가 던지기 권리를
        // 부여하므로, 그 윷/모로 잡아도 capturedBonus를 부여하지 않는다(중복 차단).
        // 도/개/걸로 잡기는 자체 보너스가 없으므로 capturedBonus를 +1 유지한다.
        if (moveRes.captured && useResult !== 'yut' && useResult !== 'mo') {
          // 잡기 보너스: 던질 권한 1회 부여 → pendingResults에 별도 표식 없이, 큐가 비어도
          // 추가 THROW 허용. 단순화를 위해 pendingResults가 비어 있을 때 currentPlayer가
          // 동일 + 마지막 결과 없음이면 보너스로 던질 수 있게 한다.
          // 구현: 보너스 토큰 대신 pendingResults에 'mo' 같은 가짜 결과를 넣지 않고,
          // "마지막 결과가 yut/mo가 아니면 던지기 불가"를 우회하기 위해 임시로 boolean 플래그 사용.
          // → game.capturedBonus = true. THROW_YUT 진입 시 이 플래그가 true면 큐 비어있어도 허용.
          game.capturedBonus = true;
        }

        if (moveRes.finished) {
          game.winner = player.id;
          game.started = false;
          broadcastAll({ type: 'GAME_OVER', winner: player.id });
          broadcastState();
          break;
        }

        // 턴 종료 판단
        // - pendingResults에 남은 결과가 있으면 같은 턴 진행 (말 더 옮길 수 있음)
        // - 큐가 비었고, 마지막 결과가 yut/mo였거나 잡기 보너스가 있다면 보너스 던지기 가능
        // - 둘 다 아니면 턴 종료
        const lastIdx = game.pendingResults.length - 1;
        const lastResult = lastIdx >= 0 ? game.pendingResults[lastIdx] : null;
        const hasBonus = game.capturedBonus === true || lastResult === 'yut' || lastResult === 'mo';
        if (game.pendingResults.length === 0 && !hasBonus) {
          passTurn();
          // capturedBonus 리셋 — 다음 턴에 잔류하면 상대 차례에 추가 던지기 권리가
          // 잘못 전달되어 턴 흐름이 꼬인다. (룰북 §13-7 capturedBonus 누락 케이스)
          game.capturedBonus = false;
        }
        broadcastState();
        break;
      }

      case 'CHOOSE_PATH': {
        if (!game.started || game.winner) break;
        if (game.currentTurn !== player.id) break;
        if (game.awaitingBranchAt === null) break;
        // FIX-2: 'outer'|'shortcut'(모서리 분기) 신규 값 우선 처리.
        // 기존 'top'|'bottom'(중앙 분기)은 그대로 유지하여 회귀 위험 차단.
        let choice;
        if (msg.pathChoice === 'outer') choice = 'outer';
        else if (msg.pathChoice === 'shortcut') choice = 'shortcut';
        else choice = msg.pathIndex === 1 || msg.pathChoice === 'bottom' ? 'bottom' : 'top';
        const pieceIdx = game.awaitingBranchAt;
        const useResult = game.awaitingBranchResult;

        // FIX-2 중첩 분기 보정: 모서리(5/10)에 멈춘 말이 중앙 분기('top'/'bottom')를 기다리는 경우는
        // 1차에서 이미 'shortcut'(지름길)을 선택해 중앙에 도달한 상태뿐이다 (외곽 선택은 중앙에 닿지 못함).
        // 이때 수신한 'top'/'bottom'을 모서리 지름길 선택과 합성하여 'shortcut-top'/'shortcut-bottom'으로
        // 변환해야 한다. 그래야 computeNextCell이 모서리에서 지름길로 진입한 뒤 중앙 출구까지 한 번에 결정한다.
        // (별도 상태 필드 없이 piece의 현재 cell로 판별 — 모서리에서 중앙 분기 대기 = shortcut 진입 확정)
        const branchPiece = player.pieces[pieceIdx];
        if (
          branchPiece
          && (branchPiece.cell === 5 || branchPiece.cell === 10)
          && (choice === 'top' || choice === 'bottom')
        ) {
          choice = 'shortcut-' + choice;
        }

        game.awaitingBranchAt = null;
        game.awaitingBranchResult = null;
        game.awaitingBranchType = null; // FIX-2: 분기 응답 후 유형 초기화

        const moveRes = movePiece(player, pieceIdx, useResult, choice);
        if (!moveRes.ok) {
          sendTo(player, { type: 'ERROR', message: moveRes.error || '분기 이동 실패' });
          broadcastState();
          break;
        }
        // FIX-2 중첩 분기 재무장: 모서리 지름길 진입 이동이 잔여 steps를 남긴 채 중앙(23)을 통과하면
        // computeNextCell이 awaitingBranch=true를 반환한다 (예: 모서리5 + 윷4 + shortcut → 중앙 도달).
        // 이때 큐를 차감하지 말고 중앙 분기를 새로 대기시킨 뒤 BRANCH_REQUEST(center)를 재발송한다.
        // (MOVE_PIECE 핸들러의 분기 대기 패턴과 동일)
        if (moveRes.awaitingBranch) {
          game.awaitingBranchAt = pieceIdx;
          game.awaitingBranchResult = useResult;
          game.awaitingBranchType = 'center';
          broadcastAll({
            type: 'BRANCH_REQUEST',
            pieceIndex: pieceIdx,
            playerId: player.id,
            branchType: 'center',
          });
          broadcastState();
          break;
        }
        // 결과 큐 차감
        const queueIdx = game.pendingResults.indexOf(useResult);
        if (queueIdx >= 0) game.pendingResults.splice(queueIdx, 1);

        // §6-1 / §13-12: 윷·모로 잡으면 잡기 보너스와 윷/모 자체 보너스는 중복 불가.
        // useResult는 분기 대기 시점에 game.awaitingBranchResult로 확정된 값(L1011).
        // 윷/모로 잡아도 capturedBonus 미부여(중복 차단), 도/개/걸로 잡기는 +1 유지.
        if (moveRes.captured && useResult !== 'yut' && useResult !== 'mo') {
          game.capturedBonus = true;
        }

        if (moveRes.finished) {
          game.winner = player.id;
          game.started = false;
          broadcastAll({ type: 'GAME_OVER', winner: player.id });
          broadcastState();
          break;
        }
        const lastIdx2 = game.pendingResults.length - 1;
        const lastResult2 = lastIdx2 >= 0 ? game.pendingResults[lastIdx2] : null;
        const hasBonus2 = game.capturedBonus === true || lastResult2 === 'yut' || lastResult2 === 'mo';
        if (game.pendingResults.length === 0 && !hasBonus2) {
          passTurn();
          game.capturedBonus = false;
        }
        broadcastState();
        break;
      }

      case 'REMATCH': {
        player.rematchReady = true;
        broadcastAll({
          type: 'REMATCH_STATUS',
          p1Ready: players.find((p) => p.id === 'p1')?.rematchReady || false,
          p2Ready: players.find((p) => p.id === 'p2')?.rematchReady || false,
        });
        if (players.length === 2 && players.every((p) => p.rematchReady)) {
          console.log('[server] 양쪽 REMATCH → 새 게임');
          resetGame();
          broadcastAll({ type: 'START', countdown: 3 });
          broadcastState();
        }
        break;
      }

      default:
        console.warn(`[server] 알 수 없는 메시지 타입: ${msg.type}`);
    }
  });

  ws.on('close', () => {
    console.log(`[server] ${player.id} 연결 해제 (mode=${wsMode})`);
    // 사람(mode=ai)이 끊긴 경우: 봇 자식 프로세스도 같이 종료.
    // 새 사용자가 다시 들어오면 새 봇이 spawn된다.
    if (wsMode === 'ai' && !isBot) {
      killBotChild();
    }
    players = players.filter((p) => p.id !== player.id);
    if (players.length > 0) {
      const remainingId = players[0].id;
      broadcastAll({
        type: 'GAME_OVER',
        winner: remainingId,
        reason: 'disconnect',
      });
      softResetRoom();
      broadcastState();
    } else {
      // 두 명 다 나간 경우 클린업
      softResetRoom();
    }
  });

  ws.on('error', (err) => {
    console.error(`[yutnori] ${player.id} WS 에러:`, err.message);
  });
});

  // ── HTTP 핸들러 (express 미들웨어 위임) ─────────────────────
  /**
   * 정적 파일 응답 핸들러. express의 정적 미들웨어가 처리.
   * launcher가 path prefix를 제거한 req.url을 전달한다 (예: '/css/style.css').
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  function handleHttp(req, res) {
    expressApp(req, res, () => {
      // express가 처리 못 한 경우 (404)
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    });
  }

  /**
   * HTTP upgrade 이벤트를 WS로 전달한다 (noServer 모드).
   * @param {http.IncomingMessage} req
   * @param {import('net').Socket} socket
   * @param {Buffer} head
   */
  function handleUpgrade(req, socket, head) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  }

  /**
   * standalone listen 이후 LAN URL이 결정되면 호출. JOINED 메시지에 포함된다.
   * @param {string} url
   */
  function setHostUrl(url) {
    HOST_URL = typeof url === 'string' ? url : '';
  }

  return { handleHttp, handleUpgrade, setHostUrl };
}

// ── 호스트 IP 자동 감지 ──────────────────────────────────────────
const VIRTUAL_IF_PATTERNS = [
  /vEthernet/i, /VirtualBox/i, /VMware/i, /Hyper-?V/i, /WSL/i, /Loopback Pseudo/i,
];

function isVirtualInterface(name) {
  return VIRTUAL_IF_PATTERNS.some((re) => re.test(name));
}

function interfacePriority(name) {
  if (isVirtualInterface(name)) return 9;
  if (/wi-?fi|wireless|wlan|wlp/i.test(name)) return 0;
  if (/ethernet|이더넷|eth\d|enp/i.test(name)) return 1;
  return 2;
}

function getLanAddresses() {
  const nets = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        results.push({
          ip: net.address,
          ifname: name,
          virtual: isVirtualInterface(name),
        });
      }
    }
  }
  results.sort((a, b) => interfacePriority(a.ifname) - interfacePriority(b.ifname));
  return results;
}

// ──────────────────────────────────────────────────────────────
// 단독 실행 모드: `node server.js [--port N]`
//
// 테스트(`YUTNORI_NO_LISTEN=1`)에서는 listen을 스킵한다.
// launcher가 import하는 경우엔 isDirectExecution() 검사로 listen이 발생하지 않는다.
// ──────────────────────────────────────────────────────────────

/**
 * 현재 모듈이 직접 실행되었는지 (vs launcher가 import) 판정한다.
 * @returns {boolean}
 */
function isDirectExecution() {
  if (!process.argv[1]) return false;
  const argvPath = process.argv[1].replace(/\\/g, '/');
  const metaPath = import.meta.url.replace('file:///', '').replace('file://', '');
  return metaPath === argvPath || metaPath.endsWith(argvPath);
}

if (isDirectExecution() && !process.env.YUTNORI_NO_LISTEN) {
  const argv = process.argv.slice(2);
  const portFlagIndex = argv.indexOf('--port');
  const REQUESTED_PORT = portFlagIndex >= 0 && argv[portFlagIndex + 1]
    ? parseInt(argv[portFlagIndex + 1], 10)
    : 3004;
  let ACTUAL_PORT = REQUESTED_PORT;
  let HOST_URL = '';

  // ── ANSI 컬러 박스 ───────────────────────────────────────────
  function supportsAnsi() {
    if (process.env.NO_COLOR) return false;
    if (process.env.TERM === 'dumb') return false;
    if (!process.stdout || !process.stdout.isTTY) return false;
    return true;
  }
  const ANSI = supportsAnsi()
    ? {
        reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
        cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m',
        magenta: '\x1b[35m', red: '\x1b[31m',
      }
    : { reset: '', bold: '', dim: '', cyan: '', green: '', yellow: '', magenta: '', red: '' };

  function padBoxLine(text, width) {
    const visible = text.replace(/\x1b\[[0-9;]*m/g, '');
    const padLen = Math.max(0, width - visible.length);
    return text + ' '.repeat(padLen);
  }

  function printBanner(port, lanIps) {
    const W = 56;
    const top = `+${'-'.repeat(W)}+`;
    const sep = `+${'-'.repeat(W)}+`;
    const empty = `|${' '.repeat(W)}|`;
    const line = (s) => `|${padBoxLine(s, W)}|`;

    console.log('');
    console.log(ANSI.cyan + top + ANSI.reset);
    console.log(ANSI.cyan + line(`  ${ANSI.bold}YUTNORI${ANSI.reset}${ANSI.cyan} - LAN 1:1 윷놀이`) + ANSI.reset);
    console.log(ANSI.cyan + sep + ANSI.reset);
    console.log(ANSI.cyan + line(`  ${ANSI.yellow}호스트 PC 접속:${ANSI.reset}`) + ANSI.reset);
    console.log(ANSI.cyan + line(`    ${ANSI.green}http://localhost:${port}${ANSI.reset}`) + ANSI.reset);
    console.log(ANSI.cyan + empty + ANSI.reset);
    console.log(ANSI.cyan + line(`  ${ANSI.yellow}친구 PC 접속:${ANSI.reset}`) + ANSI.reset);
    if (lanIps.length > 0) {
      for (const entry of lanIps) {
        const tag = entry.virtual ? ANSI.dim + ' (가상)' + ANSI.reset : '';
        console.log(ANSI.cyan + line(`    ${ANSI.green}http://${entry.ip}:${port}${ANSI.reset}${tag}`) + ANSI.reset);
      }
    } else {
      console.log(ANSI.cyan + line(`    ${ANSI.dim}(LAN IP 미감지 — ipconfig로 확인)${ANSI.reset}`) + ANSI.reset);
    }
    console.log(ANSI.cyan + empty + ANSI.reset);
    console.log(ANSI.cyan + line(`  ${ANSI.dim}종료: Ctrl+C 또는 stop.bat${ANSI.reset}`) + ANSI.reset);
    if (port !== REQUESTED_PORT) {
      console.log(ANSI.cyan + line(`  ${ANSI.magenta}* 요청 포트 ${REQUESTED_PORT} 사용 중 → ${port}로 폴백${ANSI.reset}`) + ANSI.reset);
    }
    console.log(ANSI.cyan + top + ANSI.reset);
    console.log('');
  }

  // ── 서버 시작 (포트 충돌 시 자동 폴백) ─────────────────────
  const MAX_PORT_FALLBACK = 10;

  // standalone에서 사용할 createApp 인스턴스를 단일 생성하고, 포트 폴백 시 새 server만 갈아끼운다.
  // closure 변수 listeningPort를 getBotUrl이 참조한다 (포트 폴백 대응).
  let listeningPort = 0;
  const app = createApp({
    hostUrl: '',
    // mode=ai 사용자 진입 시 봇이 접속할 WS URL. 포트가 확정되기 전(0)이면 null 반환.
    getBotUrl: () => (listeningPort > 0
      ? `ws://localhost:${listeningPort}/ws?mode=bot`
      : null),
  });

  function startListening(port, attemptsLeft) {
    const server = http.createServer(app.handleHttp);
    server.on('upgrade', app.handleUpgrade);

    let handled = false;
    const onError = (err) => {
      if (handled) return;
      handled = true;
      server.removeListener('error', onError);
      if (err && err.code === 'EADDRINUSE' && attemptsLeft > 0) {
        console.log(`[yutnori] 포트 ${port} 사용 중. ${port + 1}로 재시도...`);
        setTimeout(() => startListening(port + 1, attemptsLeft - 1), 100);
        return;
      }
      console.error('[yutnori] listen 에러:', err && err.message ? err.message : err);
      process.exit(1);
    };
    server.once('error', onError);
    server.listen(port, () => {
      server.removeListener('error', onError);
      ACTUAL_PORT = port;
      listeningPort = port; // getBotUrl이 참조할 확정 포트.
      const lanIps = getLanAddresses();
      if (lanIps.length > 0) {
        HOST_URL = `http://${lanIps[0].ip}:${port}`;
      } else {
        HOST_URL = `http://localhost:${port}`;
      }
      app.setHostUrl(HOST_URL);
      printBanner(port, lanIps);
      console.log(ANSI.dim
        + ' Tip: 처음 실행 시 Windows Defender 방화벽 팝업이 뜨면 "개인 네트워크" 체크 후 액세스 허용.'
        + ANSI.reset);
      console.log('');
    });
  }

  startListening(REQUESTED_PORT, MAX_PORT_FALLBACK);
}
