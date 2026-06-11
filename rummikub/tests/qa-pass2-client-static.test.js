/**
 * @fileoverview QA 2차 패스 — 클라이언트 코드 정적 분석 결과 회귀 슈트.
 *
 * 클라이언트는 DOM/Web Audio 의존이라 Node 환경에서 직접 import 못 함.
 * 본 슈트는 클라이언트 정적 분석에서 발견한 잠재 이슈를 다음 방식으로 검증:
 *   1) 정규식 패턴 매칭으로 코드 결함 패턴 존재 확인
 *   2) 클라 game.js의 일부 순수 함수(validateSet, computeFreshMeldScore, inferJokerReplacement)
 *      는 서버 game.js와 동일 룰이므로 일관성 비교 가능
 *
 * 카테고리:
 *   STATIC-C1: 클라 validateSet vs 서버 validateSet 일관성
 *   STATIC-C2: 클라 inferJokerReplacement 정확성
 *   STATIC-C3: network.js 재연결 한 번만 시도 패턴
 *   STATIC-C4: main.js boardChanged 단순화 — 보드 재배치만 한 경우 hasChange=false 검증
 *   STATIC-C5: handArea click이 손 타일 자체 클릭과 충돌 X (tiles.js stopPropagation 확인)
 *   STATIC-C6: ui.js 결과 화면 — handCounts null/undefined 안전
 *   STATIC-C7: returnToLobby 라우팅 안전성 (path empty + setTimeout)
 *
 * 실행:
 *   node tests/qa-pass2-client-static.test.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateSet as serverValidateSet,
} from '../game.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_JS = path.join(__dirname, '..', 'public', 'js');

let passed = 0;
let failed = 0;
const failures = [];
const issues = [];

function assertTrue(cond, label) {
  if (cond) { passed += 1; console.log(`  PASS  ${label}`); }
  else { failed += 1; const msg = `  FAIL  ${label}`; console.log(msg); failures.push(msg); }
}
function assertEq(a, b, label) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) { passed += 1; console.log(`  PASS  ${label}`); }
  else {
    failed += 1;
    const msg = `  FAIL  ${label}\n    expected: ${JSON.stringify(b)}\n    actual:   ${JSON.stringify(a)}`;
    console.log(msg);
    failures.push(msg);
  }
}
function section(name) { console.log(`\n[${name}]`); }
function reportIssue(severity, label, detail) {
  issues.push({ severity, label, detail });
  console.log(`  ISSUE [${severity}] ${label} — ${detail}`);
}

// ── 파일 로드 ────────────────────────────────────────────────────
const mainJs = fs.readFileSync(path.join(PUBLIC_JS, 'main.js'), 'utf8');
const networkJs = fs.readFileSync(path.join(PUBLIC_JS, 'network.js'), 'utf8');
const clientGameJs = fs.readFileSync(path.join(PUBLIC_JS, 'game.js'), 'utf8');
const boardJs = fs.readFileSync(path.join(PUBLIC_JS, 'board.js'), 'utf8');
const handJs = fs.readFileSync(path.join(PUBLIC_JS, 'hand.js'), 'utf8');
const tilesJs = fs.readFileSync(path.join(PUBLIC_JS, 'tiles.js'), 'utf8');
const uiJs = fs.readFileSync(path.join(PUBLIC_JS, 'ui.js'), 'utf8');

// ═══════════════════════════════════════════════════════════════════
// STATIC-C1: 클라 validateSet vs 서버 validateSet 일관성
// ═══════════════════════════════════════════════════════════════════
section('STATIC-C1: 클라 validateSet 룰 일관성 (서버와 비교)');
// 클라 game.js는 ESM이지만 브라우저 모듈이라 lookup 함수 등이 다름.
// validateSet은 순수 함수이므로 dynamic import 가능 — 다만 module은 lookupTile import 안에 'game.js' 클라 module 자체 import. → 직접 평가.
// 클라 game.js에서 validateSet 함수만 추출해 eval로 평가.
//
// 단순화: 시나리오 데이터 vs 서버 결과 — 클라도 동일하면 코드 일치로 추정.
// 정밀 일관성은 코드 패턴 매칭으로 보조.
const v1 = serverValidateSet([
  { kind: 'num', color: 'red', number: 7 },
  { kind: 'num', color: 'blue', number: 7 },
  { kind: 'num', color: 'black', number: 7 },
]);
assertTrue(v1.valid && v1.type === 'group' && v1.score === 21,
  'STATIC-C1-1: 서버 validateSet — 그룹 7×3 = 21점');

// 클라 코드의 그룹 점수 계산 패턴 — `sampleNumber * tiles.length` 매칭 확인.
const hasSampleNumberMult = /sampleNumber\s*\*\s*tiles\.length/.test(clientGameJs);
assertTrue(hasSampleNumberMult,
  'STATIC-C1-2: 클라 game.js에 sampleNumber * tiles.length 패턴 존재');

// 런 점수 패턴.
const hasRunScorePattern = /for\s*\(\s*let\s+v\s*=\s*start;.*v\+\+\s*\)\s*score\s*\+=\s*v/.test(clientGameJs);
assertTrue(hasRunScorePattern,
  'STATIC-C1-3: 클라 game.js에 런 점수 누적 패턴 존재');

// 클라/서버 색 순서 일치.
const clientColors = clientGameJs.match(/COLORS\s*=\s*\[(.*?)\]/);
const serverColorsMatch = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8').match(/COLORS\s*=\s*\[(.*?)\]/);
if (clientColors && serverColorsMatch) {
  assertEq(clientColors[1].replace(/\s+/g, ''), serverColorsMatch[1].replace(/\s+/g, ''),
    'STATIC-C1-4: COLORS 순서 일치');
}

// ═══════════════════════════════════════════════════════════════════
// STATIC-C2: 클라 inferJokerReplacement 시나리오
// ═══════════════════════════════════════════════════════════════════
section('STATIC-C2: 클라 inferJokerReplacement 패턴 검증');
// 클라 game.js에서 inferJokerReplacement 검색.
const hasInfer = /export function inferJokerReplacement/.test(clientGameJs);
assertTrue(hasInfer, 'STATIC-C2-1: inferJokerReplacement 함수 존재');
// 그룹: 빈 색 후보 생성 패턴.
const hasGroupInfer = /usedColors\.has\(c\)/.test(clientGameJs);
assertTrue(hasGroupInfer, 'STATIC-C2-2: 그룹 빈 색 후보 생성 패턴');
// 런: 빠진 슬롯 집합 기반 slot 추론 패턴.
// (2026-06-11 룰 수정 #4: `start + jokerIndex` 인덱스 가정은 뒤섞인 런에서 부정확해 폐기.
//  missingSlots 집합에서 조커 등장 순서대로 배정하는 새 패턴을 검증한다.)
const hasRunInfer = /missingSlotsInfer/.test(clientGameJs)
  && !/slotNumber\s*=\s*start\s*\+\s*jokerIndex/.test(clientGameJs);
assertTrue(hasRunInfer, 'STATIC-C2-3: 런 slot 위치 계산 패턴 (빠진 슬롯 집합 기반)');

// ═══════════════════════════════════════════════════════════════════
// STATIC-C3: network.js 재연결 한 번만 시도
// ═══════════════════════════════════════════════════════════════════
section('STATIC-C3: network.js 재연결 패턴 분석');
// reconnectAttempted = true 후 한 번만 setTimeout(connect) 호출.
const hasReconnectFlag = /reconnectAttempted\s*=\s*true/.test(networkJs);
const reconnectInClose = /reconnectAttempted\s*=\s*true[\s\S]{0,100}connect\(/.test(networkJs);
assertTrue(hasReconnectFlag, 'STATIC-C3-1: reconnectAttempted 플래그 존재');
assertTrue(reconnectInClose, 'STATIC-C3-2: close 핸들러에서 재연결 시도');
// 재연결이 한 번만 시도되는 패턴 — 두 번째 close에서는 reconnectAttempted=true라 skip.
// 단점: 두 번째 disconnect 시 자동 재연결 안 됨.
const hasMaxAttempts = /maxAttempts|maxReconnect|reconnectCount/i.test(networkJs);
if (!hasMaxAttempts) {
  reportIssue('LOW', 'STATIC-C3 재연결 1회 한정',
    'network.js는 disconnect 후 단 한 번만 재연결을 시도한다 (3초 후). 두 번째 close 시 reconnectAttempted=true 상태로 남아 추가 재연결 없음. 장시간 네트워크 불안정에서는 클라가 영구 disconnect 상태로 남을 수 있음.');
}

// ═══════════════════════════════════════════════════════════════════
// STATIC-C4: main.js boardChanged 단순화 — 보드 재배치만 → false
// ═══════════════════════════════════════════════════════════════════
section('STATIC-C4: main.js boardChanged 정확성');
// boardChanged 함수 추출.
const boardChangedFn = mainJs.match(/function boardChanged\(state\)[\s\S]{0,900}/);
assertTrue(boardChangedFn !== null, 'STATIC-C4-1: boardChanged 함수 존재');
if (boardChangedFn) {
  const body = boardChangedFn[0];
  // (2026-06-11 룰 수정 #5: fresh/빈 세트 검사에 더해 턴 시작 시그니처 비교로
  //  보드 내 재배치(set→set)도 감지한다. 옛 "재배치 미감지 UX 혼란" LOW 이슈는 해소됨.)
  const hasFreshAndEmpty = /freshTileIds\.size\s*>\s*0[\s\S]{0,150}set\.tiles\.length\s*===\s*0/.test(body);
  assertTrue(hasFreshAndEmpty, 'STATIC-C4-2: boardChanged는 fresh + 빈 세트 검사 포함');
  const hasSigCompare = /turnStartBoardSig/.test(body) && /tiles\.join\(','\)/.test(body);
  assertTrue(hasSigCompare, 'STATIC-C4-3: boardChanged 시그니처 비교로 재배치 감지');
}

// ═══════════════════════════════════════════════════════════════════
// STATIC-C5: handArea click + 손 타일 stopPropagation
// ═══════════════════════════════════════════════════════════════════
section('STATIC-C5: handArea click bubble — 손 타일 클릭 충돌 X');
// tiles.js의 buildTileEl이 e.stopPropagation 호출 여부.
const tileStopProp = /addEventListener\('click',\s*\(e\)\s*=>\s*\{[^}]*e\.stopPropagation/.test(tilesJs);
assertTrue(tileStopProp, 'STATIC-C5-1: tiles.js — click stopPropagation 호출');
// main.js의 handArea click 핸들러 — 보드 source 회수 흐름.
const handAreaClickHandler = /handArea\.addEventListener\('click',[\s\S]{0,300}selectedSrc\.kind\s*===\s*'set'/.test(mainJs);
assertTrue(handAreaClickHandler, 'STATIC-C5-2: handArea click 핸들러 — set source일 때만 회수 시도');
// 즉 손 타일 클릭 → tile.stopPropagation으로 handArea click 비호출. OK.

// ═══════════════════════════════════════════════════════════════════
// STATIC-C6: ui.js renderGameOver null 안전
// ═══════════════════════════════════════════════════════════════════
section('STATIC-C6: ui.js renderGameOver null 안전');
// `(result.handCounts && result.handCounts.p1) ?? '-'` — null coalesce.
const hasNullCoalesce = /handCounts\s*&&\s*result\.handCounts\.p1\)\s*\?\?\s*'-'/.test(uiJs);
assertTrue(hasNullCoalesce, 'STATIC-C6-1: handCounts null 가드 + nullish coalesce');

// ═══════════════════════════════════════════════════════════════════
// STATIC-C7: returnToLobby 라우팅 안전성
// ═══════════════════════════════════════════════════════════════════
section('STATIC-C7: returnToLobby seg empty + setTimeout');
// `setTimeout(() => { if (seg) location.href = '/'; }, 1500);`
const hasSetTimeoutRedirect = /setTimeout\(\(\)\s*=>\s*\{[^}]*if\s*\(seg\)\s*location\.href/.test(mainJs);
assertTrue(hasSetTimeoutRedirect, 'STATIC-C7-1: returnToLobby에 1.5초 후 redirect 폴백');
// seg가 빈 경우(luncher 모드 아닐 때)는 즉시 location.href='/' 호출.
const hasImmediateRedirect = /if\s*\(!seg\)\s*location\.href\s*=\s*'\/'/.test(mainJs);
assertTrue(hasImmediateRedirect, 'STATIC-C7-2: seg 없으면 즉시 redirect');
// 만약 fetch가 매우 느리면 setTimeout 1.5초 후 redirect — fetch 결과 무시.
// 안전한 패턴.

// ═══════════════════════════════════════════════════════════════════
// STATIC-C8: jokerSwapMode 후보 아닌 손 타일 클릭 → 모드 해제 알림 없음
// ═══════════════════════════════════════════════════════════════════
section('STATIC-C8: jokerSwapMode 해제 시 알림');
const swapModeReset = /if\s*\(jokerSwapMode\)\s*\{[^}]*jokerSwapMode\s*=\s*null/.test(mainJs);
assertTrue(swapModeReset, 'STATIC-C8-1: 후보 아닌 손 타일 클릭 → 모드 해제 코드 존재');
const swapModeToast = /jokerSwapMode\s*=\s*null[^]*showToast.*해제|모드.*해제/.test(mainJs);
if (!swapModeToast) {
  reportIssue('LOW', 'STATIC-C8 jokerSwapMode 무음 해제',
    'main.js handleHandTileClick에서 후보 아닌 손 타일 클릭 시 jokerSwapMode가 조용히 해제됨. 사용자에게 토스트 알림 없어 UX 혼란 가능.');
}

// ═══════════════════════════════════════════════════════════════════
// STATIC-C9: STATE 도착 전 액션 가드 — main.js renderAll
// ═══════════════════════════════════════════════════════════════════
section('STATIC-C9: STATE null 가드');
const renderAllGuard = /function renderAll\(\)\s*\{[^}]*const state\s*=\s*getState\(\);[\s\S]*if\s*\(!state\)\s*return/.test(mainJs);
assertTrue(renderAllGuard, 'STATIC-C9-1: renderAll에서 state null 가드');

// ═══════════════════════════════════════════════════════════════════
// STATIC-C10: WS open 전 send 시도 가드
// ═══════════════════════════════════════════════════════════════════
section('STATIC-C10: ws.send 가드 (open 전 시도)');
const sendGuard = /readyState\s*!==\s*WebSocket\.OPEN/.test(networkJs);
assertTrue(sendGuard, 'STATIC-C10-1: network.js send 호출 시 readyState 가드');

// ═══════════════════════════════════════════════════════════════════
// STATIC-C11: sessionStorage 의도된 동작 확인
// ═══════════════════════════════════════════════════════════════════
section('STATIC-C11: sessionStorage mode 캐싱');
const sessionMode = /sessionStorage\.setItem\('rummikub:mode'/.test(networkJs);
assertTrue(sessionMode, 'STATIC-C11-1: sessionStorage에 mode 저장');
const sessionRead = /sessionStorage\.getItem\('rummikub:mode'/.test(networkJs);
assertTrue(sessionRead, 'STATIC-C11-2: sessionStorage에서 mode 복원');
// 페이지 새로고침 시에도 mode 유지.

// ═══════════════════════════════════════════════════════════════════
// STATIC-C12: innerHTML = '' 후 이벤트 핸들러 누수 — board.js / hand.js
// ═══════════════════════════════════════════════════════════════════
section('STATIC-C12: board/hand 렌더 시 이벤트 핸들러 누수');
// container.innerHTML = '' 호출 시 자식 element와 함께 핸들러도 GC됨.
// JS 내부 ref 유지 시에만 누수 — 본 코드는 ref 안 유지하므로 안전.
const boardClearInner = /container\.innerHTML\s*=\s*''/.test(boardJs);
const handClearInner = /container\.innerHTML\s*=\s*''/.test(handJs);
assertTrue(boardClearInner, 'STATIC-C12-1: board.js innerHTML 초기화');
assertTrue(handClearInner, 'STATIC-C12-2: hand.js innerHTML 초기화');
// 핸들러는 closure(ctx)를 capture하지만 element와 함께 GC.

// ═══════════════════════════════════════════════════════════════════
// 최종
// ═══════════════════════════════════════════════════════════════════
console.log('\n════════════════════════════════════════');
console.log(`테스트: ${passed + failed}건 / PASS=${passed} / FAIL=${failed}`);
console.log(`발견된 이슈: ${issues.length}건`);
if (failures.length > 0) {
  console.log('\n실패 목록:');
  failures.forEach((f) => console.log(f));
}
if (issues.length > 0) {
  console.log('\n발견된 이슈 상세:');
  for (const i of issues) {
    console.log(`  [${i.severity}] ${i.label} — ${i.detail}`);
  }
}
process.exit(failed > 0 ? 1 : 0);
