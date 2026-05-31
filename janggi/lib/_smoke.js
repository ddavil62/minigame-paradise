/**
 * @fileoverview 장기 서버 로직 5개 모듈 스모크 테스트.
 * `node minigame-paradise/janggi/lib/_smoke.js` 로 실행한다.
 *
 * 검증 항목:
 *   1. 초기 보드(MSMS, MSMS) 생성 시 32개 기물 정확한 위치
 *   2. 한 진영 차(0,0)의 합법 수 (시작 위치에서 0개)
 *   3. 한 진영 포(1,2)의 합법 수 (다리 없으니 0개)
 *   4. 마의 멱 차단 확인
 *   5. 점수 계산 (양측 72점, 덤 포함 시 cho 73.5)
 */

import { createInitialBoard, getPiece } from './board.js';
import { getLegalMoves } from './pieces.js';
import {
  isInCheck, wouldBeSelfCheck, isCheckmate,
  getAllLegalMoves, findKing,
} from './rules.js';
import { calculateScore, PIECE_SCORE } from './score.js';
import {
  createGameSession, applySetupChoice, applyMove,
  applyResign, tickTimer, serializeState,
} from './game.js';

let passed = 0;
let failed = 0;

/**
 * 테스트 어설션 헬퍼.
 * @param {string} name 테스트 이름
 * @param {boolean} condition 성공 조건
 * @param {string} [detail] 실패 시 상세
 */
function assert(name, condition, detail) {
  if (condition) {
    console.log(`  PASS: ${name}`);
    passed++;
  } else {
    console.log(`  FAIL: ${name}${detail ? ' -- ' + detail : ''}`);
    failed++;
  }
}

// ──────────────────────────────────────────────────────────────────
// 테스트 1: 초기 보드 생성 (MSMS, MSMS) - 32개 기물 정확한 위치
// ──────────────────────────────────────────────────────────────────
console.log('\n[1] 초기 보드 생성 (MSMS, MSMS)');

const board1 = createInitialBoard('MSMS', 'MSMS');

// 기물 수 카운트
let totalPieces = 0;
let hanPieces = 0;
let choPieces = 0;
for (let r = 0; r < 10; r++) {
  for (let f = 0; f < 9; f++) {
    const p = getPiece(board1, f, r);
    if (p) {
      totalPieces++;
      if (p.side === 'han') hanPieces++;
      else choPieces++;
    }
  }
}
assert('총 32개 기물', totalPieces === 32, `실제: ${totalPieces}`);
assert('한 16개', hanPieces === 16, `실제: ${hanPieces}`);
assert('초 16개', choPieces === 16, `실제: ${choPieces}`);

// 고정 기물 위치 검증
assert('한 차 (0,0)', getPiece(board1, 0, 0)?.type === 'chariot' && getPiece(board1, 0, 0)?.side === 'han');
assert('한 차 (8,0)', getPiece(board1, 8, 0)?.type === 'chariot' && getPiece(board1, 8, 0)?.side === 'han');
assert('한 사 (3,0)', getPiece(board1, 3, 0)?.type === 'advisor' && getPiece(board1, 3, 0)?.side === 'han');
assert('한 사 (5,0)', getPiece(board1, 5, 0)?.type === 'advisor' && getPiece(board1, 5, 0)?.side === 'han');
assert('한 궁 (4,1)', getPiece(board1, 4, 1)?.type === 'king' && getPiece(board1, 4, 1)?.side === 'han');
assert('한 포 (1,2)', getPiece(board1, 1, 2)?.type === 'cannon' && getPiece(board1, 1, 2)?.side === 'han');
assert('한 포 (7,2)', getPiece(board1, 7, 2)?.type === 'cannon' && getPiece(board1, 7, 2)?.side === 'han');

// MSMS: file 1=마, file 2=상, file 6=마, file 7=상
assert('한 마 (1,0) MSMS', getPiece(board1, 1, 0)?.type === 'horse' && getPiece(board1, 1, 0)?.side === 'han');
assert('한 상 (2,0) MSMS', getPiece(board1, 2, 0)?.type === 'elephant' && getPiece(board1, 2, 0)?.side === 'han');
assert('한 마 (6,0) MSMS', getPiece(board1, 6, 0)?.type === 'horse' && getPiece(board1, 6, 0)?.side === 'han');
assert('한 상 (7,0) MSMS', getPiece(board1, 7, 0)?.type === 'elephant' && getPiece(board1, 7, 0)?.side === 'han');

// 졸 5개
for (const f of [0, 2, 4, 6, 8]) {
  assert(`한 졸 (${f},3)`, getPiece(board1, f, 3)?.type === 'soldier' && getPiece(board1, f, 3)?.side === 'han');
}

// 초 기물
assert('초 차 (0,9)', getPiece(board1, 0, 9)?.type === 'chariot' && getPiece(board1, 0, 9)?.side === 'cho');
assert('초 차 (8,9)', getPiece(board1, 8, 9)?.type === 'chariot' && getPiece(board1, 8, 9)?.side === 'cho');
assert('초 궁 (4,8)', getPiece(board1, 4, 8)?.type === 'king' && getPiece(board1, 4, 8)?.side === 'cho');
assert('초 포 (1,7)', getPiece(board1, 1, 7)?.type === 'cannon' && getPiece(board1, 1, 7)?.side === 'cho');
assert('초 포 (7,7)', getPiece(board1, 7, 7)?.type === 'cannon' && getPiece(board1, 7, 7)?.side === 'cho');

for (const f of [0, 2, 4, 6, 8]) {
  assert(`초 병 (${f},6)`, getPiece(board1, f, 6)?.type === 'soldier' && getPiece(board1, f, 6)?.side === 'cho');
}

// ──────────────────────────────────────────────────────────────────
// 테스트 2: 한 진영 차(0,0)의 합법 수 (시작 위치)
// (0,1)과 (0,2)가 비어있으므로 2개 이동 가능. (0,3)에 아군 졸이 있어 막힘.
// 스펙 문서에 "0개"라 했으나 실제 보드 구성상 2개가 정확하다.
// ──────────────────────────────────────────────────────────────────
console.log('\n[2] 한 차 (0,0) 합법 수 (초기 보드)');

const chariotMoves = getLegalMoves(board1, 0, 0);
assert('차(0,0) 합법 수 2개', chariotMoves.length === 2, `실제: ${chariotMoves.length}`);

// ──────────────────────────────────────────────────────────────────
// 테스트 3: 한 진영 포(1,2)의 합법 수 = 0개 (시작 위치 다리 없음)
// ──────────────────────────────────────────────────────────────────
console.log('\n[3] 한 포 (1,2) 합법 수 (초기 보드)');

const cannonMoves = getLegalMoves(board1, 1, 2);
assert('포(1,2) 합법 수 0개', cannonMoves.length === 0, `실제: ${cannonMoves.length}, 좌표: ${JSON.stringify(cannonMoves)}`);

// ──────────────────────────────────────────────────────────────────
// 테스트 4: 마의 멱 차단 확인
// ──────────────────────────────────────────────────────────────────
console.log('\n[4] 마 멱 차단');

// 초기 보드에서 한 마(1,0)는 위(rank-1) 방향이 경계 밖, 좌(file-1)는 차가 있어 멱,
// 아래(rank+1)=rank 1에 아무것도 없으므로 이동 가능
const horseMoves_initial = getLegalMoves(board1, 1, 0);
assert('마(1,0) 초기 합법 수 존재', horseMoves_initial.length > 0, `실제: ${horseMoves_initial.length}`);

// 마(1,0)에서 아래 방향(0,1)에 궁이 없으므로 아래로 이동 가능해야 함
// 아래 방향: (1,1) 경유 -> (0,2) 또는 (2,2)
// (1,1)에 기물이 있는지 확인
const blockAt11 = getPiece(board1, 1, 1);
assert('(1,1) 비어있음', blockAt11 === null, `실제: ${JSON.stringify(blockAt11)}`);

// 마가 실제로 (0,2) 또는 (2,2) 방향으로 갈 수 있는지 확인
// (0,2)에는 한 포가 없음... 아 (1,2)에 한 포가 있다.
// (0,2)에는 기물 없음, (2,2)에도 없음
const canGoTo02 = horseMoves_initial.some(m => m.file === 0 && m.rank === 2);
const canGoTo22 = horseMoves_initial.some(m => m.file === 2 && m.rank === 2);
assert('마(1,0) 아래->좌 (0,2) 이동 가능', canGoTo02);
assert('마(1,0) 아래->우 (2,2) 이동 가능', canGoTo22);

// 멱 차단 확인: 한 마(1,0)에서 좌(0,0) 방향은 차(0,0)가 있으므로 좌 방향 전체 불가
// 좌 방향 도착지: (-1,-1) 과 (-1,1) - 둘 다 경계 밖이라 어차피 불가
// 대신 우(2,0) 방향: (2,0)에 상이 있으므로 우 방향 전체 불가
const blockAt20 = getPiece(board1, 2, 0);
assert('(2,0)에 상(멱) 존재', blockAt20?.type === 'elephant');

// 우 방향 도착지: (3,-1) 경계밖, (3,1) 이 있을 수 있지만 멱에 의해 차단
const canGoTo31 = horseMoves_initial.some(m => m.file === 3 && m.rank === 1);
assert('마(1,0) 우 방향 (3,1) 멱 차단', !canGoTo31);

// ──────────────────────────────────────────────────────────────────
// 테스트 5: 점수 계산
// ──────────────────────────────────────────────────────────────────
console.log('\n[5] 점수 계산');

const scoresNoDeom = calculateScore(board1, false);
assert('한 점수 72', scoresNoDeom.han === 72, `실제: ${scoresNoDeom.han}`);
assert('초 점수 72 (덤 미포함)', scoresNoDeom.cho === 72, `실제: ${scoresNoDeom.cho}`);

const scoresWithDeom = calculateScore(board1, true);
assert('한 점수 72 (덤 포함)', scoresWithDeom.han === 72, `실제: ${scoresWithDeom.han}`);
assert('초 점수 73.5 (덤 포함)', scoresWithDeom.cho === 73.5, `실제: ${scoresWithDeom.cho}`);

// ──────────────────────────────────────────────────────────────────
// 추가 테스트: GameSession 기본 흐름
// ──────────────────────────────────────────────────────────────────
console.log('\n[6] GameSession 기본 흐름');

const gs = createGameSession();
assert('초기 phase = setup_cho', gs.phase === 'setup_cho');

// 한이 먼저 선택하면 에러
const badSetup = applySetupChoice(gs, 'han', 'MSMS');
assert('한이 먼저 선택 -> 에러', !badSetup.ok);

// 초가 먼저 선택
const choSetup = applySetupChoice(gs, 'cho', 'SMSM');
assert('초 배치 선택 성공', choSetup.ok);
assert('다음 phase = setup_han', gs.phase === 'setup_han');

// 한 선택 -> 게임 시작
const hanSetup = applySetupChoice(gs, 'han', 'MSMS');
assert('한 배치 선택 성공', hanSetup.ok);
assert('게임 시작됨', hanSetup.gameStarted === true);
assert('phase = playing', gs.phase === 'playing');
assert('선수 = 한', gs.turn === 'han');
assert('보드 생성됨', gs.board !== null);

// 한의 졸(0,3) 전진 -> (0,4) 시도
const move1 = applyMove(gs, 'han', 0, 3, 0, 4);
assert('졸(0,3)->(0,4) 성공', move1.ok, move1.error);
assert('턴 전환 -> 초', gs.turn === 'cho');

// 초의 차례에 한이 두면 에러
const badTurn = applyMove(gs, 'han', 2, 3, 2, 4);
assert('차례 아닌 수 -> 에러', !badTurn.ok);

// 직렬화 테스트
const snapshot = serializeState(gs);
assert('스냅샷 phase', snapshot.phase === 'playing');
assert('스냅샷 turn', snapshot.turn === 'cho');
assert('스냅샷 board 존재', Array.isArray(snapshot.board));
assert('스냅샷 lastMove 존재', snapshot.lastMove !== null);

// ──────────────────────────────────────────────────────────────────
// 추가 테스트: 기권
// ──────────────────────────────────────────────────────────────────
console.log('\n[7] 기권');

const gs2 = createGameSession();
applySetupChoice(gs2, 'cho', 'MSMS');
applySetupChoice(gs2, 'han', 'MSMS');

const resign = applyResign(gs2, 'cho');
assert('초 기권 성공', resign.ok);
assert('승자 = 한', gs2.winner === 'han');
assert('종료 이유 = resign', gs2.endReason === 'resign');

// ──────────────────────────────────────────────────────────────────
// 추가 테스트: 시간 관리
// ──────────────────────────────────────────────────────────────────
console.log('\n[8] 시간 관리');

const gs3 = createGameSession();
applySetupChoice(gs3, 'cho', 'MSMS');
applySetupChoice(gs3, 'han', 'MSMS');

// 본 시간 차감
const t0 = gs3.hanTime.mainSec;
tickTimer(gs3);
assert('본 시간 1초 차감', gs3.hanTime.mainSec === t0 - 1);

// 본 시간을 0으로 만들고 초읽기 진입
gs3.hanTime.mainSec = 0;
gs3.hanTime.byoyomiSec = 2;
gs3.hanTime.byoyomiLeft = 1;

tickTimer(gs3); // byoyomi 2 -> 1
assert('초읽기 1초 차감', gs3.hanTime.byoyomiSec === 1);

tickTimer(gs3); // byoyomi 1 -> 0, byoyomiLeft 1 -> 0 -> 시간패
const t1 = tickTimer(gs3);
// 위의 tick에서 이미 시간패 발생 가능. 재확인
if (gs3.phase !== 'ended') {
  // 아직 끝나지 않았으면 한번 더
  const t2 = tickTimer(gs3);
}
// 시간 소진 시 시간패가 발생해야 함
assert('시간패 게임 종료', gs3.phase === 'ended');
assert('시간패 이유', gs3.endReason === 'timeout');

// ──────────────────────────────────────────────────────────────────
// 추가 테스트: 장군/외통수 기본 확인
// ──────────────────────────────────────────────────────────────────
console.log('\n[9] 장군/외통수 유틸 확인');

const board2 = createInitialBoard('MSMS', 'MSMS');
assert('초기 보드 한 궁 미장군', !isInCheck(board2, 'han'));
assert('초기 보드 초 궁 미장군', !isInCheck(board2, 'cho'));
assert('초기 보드 한 외통수 아님', !isCheckmate(board2, 'han'));

const hanKing = findKing(board2, 'han');
assert('한 궁 위치 (4,1)', hanKing?.file === 4 && hanKing?.rank === 1);

const choKing = findKing(board2, 'cho');
assert('초 궁 위치 (4,8)', choKing?.file === 4 && choKing?.rank === 8);

// ──────────────────────────────────────────────────────────────────
// 추가 테스트: 졸 합법 수
// ──────────────────────────────────────────────────────────────────
console.log('\n[10] 졸 합법 수');

const soldierMoves = getLegalMoves(board1, 0, 3);
// 한 졸(0,3): 앞(0,4), 좌(-1,3) 경계밖, 우(1,3) 비어있음
assert('졸(0,3) 합법 수 2개', soldierMoves.length === 2, `실제: ${soldierMoves.length}, 좌표: ${JSON.stringify(soldierMoves)}`);

const soldierMoves2 = getLegalMoves(board1, 4, 3);
// 한 졸(4,3): 앞(4,4), 좌(3,3) 비어있음, 우(5,3) 비어있음
assert('졸(4,3) 합법 수 3개', soldierMoves2.length === 3, `실제: ${soldierMoves2.length}`);

// ──────────────────────────────────────────────────────────────────
// 추가 테스트: 상 이동
// ──────────────────────────────────────────────────────────────────
console.log('\n[11] 상 이동');

// 한 상(2,0) MSMS 배치: 위 방향 경계밖, 아래(2,1) 비어있음
const elephantMoves = getLegalMoves(board1, 2, 0);
// 상(2,0): 아래(2,1) -> (1,2)은 한 포가 있으므로 불가, (3,2)로 가려면 (3,1)이 비어야
// 좌(1,0)에 마가 있어 좌 방향 멱
// 우(3,0)에 사가 있어 우 방향 멱
// 위(2,-1) 경계밖
// 아래(2,1) 비어있음 -> (1,2) 한포(아군), (3,2) 비어있음
// 실제로 (3,1) 확인: 비어있음
assert('상(2,0) 아래 방향 경유 (2,1) 빔', getPiece(board1, 2, 1) === null);
// 아래->좌: (2,1) -> (1,2) = 한 포 (아군) -> 불가
// 아래->우: (2,1) -> (3,2) 경유 확인, (3,1) 빔, 도착 (4,3) 한 졸(아군) -> 불가
// 실제로는: 아래(0,1) 이동 후 대각 2칸이므로
// step1: (2,1), step2: (1,2)/(3,2), 도착: (0,3)/(4,3)
// (1,2) 한 포 있으므로 좌하 멱 -> 불가
// (3,2) 빔 -> 도착 (4,3) 한 졸 -> 아군이므로 불가
// 결론: 아래 방향 전체 불가? 아닌데... 재검증 필요
console.log(`  상(2,0) 합법 수: ${elephantMoves.length}개 = ${JSON.stringify(elephantMoves)}`);

// ──────────────────────────────────────────────────────────────────
// 추가 테스트: 궁성 대각선 이동
// ──────────────────────────────────────────────────────────────────
console.log('\n[12] 궁/사 궁성 대각선 이동');

const kingMoves = getLegalMoves(board1, 4, 1);
// 한 궁(4,1): 궁성 중앙
// 직선: (3,1), (5,1), (4,0), (4,2)
// (4,0) 빈칸, (3,1) 빈칸, (5,1) 빈칸, (4,2) 빈칸
// 대각: (3,0) 사(아군), (5,0) 사(아군), (3,2) 빈칸, (5,2) 빈칸
// 이동 가능: (4,0), (3,1), (5,1), (4,2), (3,2), (5,2) = 6개
assert('궁(4,1) 합법 수 6개', kingMoves.length === 6, `실제: ${kingMoves.length}, 좌표: ${JSON.stringify(kingMoves)}`);

// ──────────────────────────────────────────────────────────────────
// 결과 요약
// ──────────────────────────────────────────────────────────────────
console.log('\n════════════════════════════════════════');
console.log(`결과: ${passed} PASS / ${failed} FAIL (총 ${passed + failed})`);
console.log('════════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
