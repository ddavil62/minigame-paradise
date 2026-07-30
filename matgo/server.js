/**
 * @fileoverview WebSocket + 정적 파일 서버. LAN 환경에서 2인 맞고 대전을 중계한다.
 *
 * 아키텍처: 서버 권위 게임 상태
 * - 모든 룰 판정은 game.js가 처리, 클라이언트는 입력 + 시점별 스냅샷만 받음
 * - 의존성 최소화: Node 내장 http + ws
 * - 안정성: 30초 heartbeat, 좀비 슬롯 청소, 자동 좀비 정리
 *
 * 통합 라우터 지원:
 *   - `createApp()`을 export하여 launcher가 단일 포트(3000)에서 라우팅할 수 있게 한다.
 *   - 단독 실행 (`node server.js [--port N]`)도 그대로 지원.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  createGame, startRound, nextRoundStarter, playCard, chooseFloor, goStop, shakeDecision, bomb, selectKkeutType,
  playCardSteps, chooseFloorSteps, bombSteps, selectKkeutTypeSteps,
  sangtongSteps, bonusFlipSteps,
  snapshotForPlayer, matchLogContext,
} from './game.js';
import { MatchLogger } from './match-log.js';

// ── 경로 + 설정 ───────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

// ── 정적 파일 서빙 (public/) ─────────────────────────────────────
/** MIME 매핑. */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

/**
 * 맞고 게임 앱 인스턴스를 생성한다.
 * 모든 룸 상태(players/game)는 closure로 격리되어 다른 게임과 공유되지 않는다.
 *
 * @param {object} [opts]
 * @param {() => string} [opts.getBotUrl]
 * @param {MatchLogger} [opts.matchLogger] 테스트 또는 통합 런타임에서 주입할 로거.
 * @param {string} [opts.logDirectory] 기본 매치 로그 디렉터리 재정의.
 *   봇이 접속할 WS URL을 반환하는 함수 (mode=ai 사용자 진입 시 호출).
 *   launcher 통합 모드에서는 launcher가 `ws://localhost:{PORT}/matgo/ws?mode=bot` 를 넘기고,
 *   standalone 모드에서는 listen 포트로 자동 구성.
 * @returns {{ handleHttp: Function, handleUpgrade: Function, flushLogs: Function, close: Function }}
 */
export function createApp(opts = {}) {
  const getBotUrl = opts.getBotUrl || (() => null);
  const matchLogger = opts.matchLogger || new MatchLogger({
    directory: opts.logDirectory
      || process.env.MATGO_LOG_DIR
      || path.join(__dirname, 'logs', 'matches'),
  });
  // ── 룸 상태 (closure로 격리, 2인 1룸 고정) ──────────────────────
  /**
   * @typedef {Object} Player
   * @property {'p1'|'p2'} id
   * @property {import('ws').WebSocket} ws
   */

  /** @type {Player[]} */
  let players = [];
  /** @type {import('./game.js').GameState|null} */
  let game = null;
  /**
   * READY 선언한 playerId Set. 양쪽 모두 READY일 때만 게임 시작.
   * @type {Set<string>}
   */
  let readySet = new Set();
  let previousLoggedPhase = null;
  let loggedRoundEnd = false;
  let matchActive = false;
  const loggedBatchIds = new Set();

  /**
   * 현재 게임의 안전한 규칙 문맥과 함께 로그 이벤트를 비동기 큐에 추가한다.
   *
   * @param {string} event
   * @param {'p1'|'p2'|'system'} actor
   * @param {object} [payload]
   * @returns {void}
   */
  function logMatchEvent(event, actor, payload = {}) {
    if (!game || !matchActive) return;
    const context = matchLogContext(game);
    void matchLogger.log(event, {
      actor,
      turnId: context.turnId,
      batchId: context.batchId,
      stateVersion: context.stateVersion,
      phase: context.phase,
      payload,
    });
  }

  /**
   * 클라이언트 메시지에서 판별에 필요한 허용 필드만 추린다.
   *
   * @param {object} msg
   * @returns {object}
   */
  function safeInputPayload(msg) {
    const payload = { type: msg.type };
    for (const key of ['cardId', 'month', 'decision', 'choice', 'value']) {
      if (typeof msg[key] === 'string' || typeof msg[key] === 'number') payload[key] = msg[key];
    }
    return payload;
  }

  /**
   * broadcast 시점에 phase·정산 batch·점수 결과를 중복 없이 기록한다.
   *
   * @returns {void}
   */
  function logStateMilestones() {
    if (!game) return;
    const context = matchLogContext(game);
    if (previousLoggedPhase !== context.phase) {
      logMatchEvent('PHASE_CHANGED', 'system', {
        from: previousLoggedPhase,
        to: context.phase,
        turn: context.turn,
      });
      previousLoggedPhase = context.phase;
      if (new Set([
        'awaiting_floor_choice',
        'awaiting_kkeut_choice',
        'awaiting_go_stop',
        'awaiting_sangtong',
      ]).has(context.phase)) {
        logMatchEvent('CHOICE_REQUIRED', context.turn, {
          choiceType: context.phase,
        });
      }
    }
    if (context.settlement && !loggedBatchIds.has(context.settlement.batchId)) {
      loggedBatchIds.add(context.settlement.batchId);
      logMatchEvent('CAPTURE_SETTLED', context.settlement.actor, context.settlement);
    }
    if (context.roundResult && !loggedRoundEnd) {
      loggedRoundEnd = true;
      logMatchEvent('SCORE_EVALUATED', 'system', context.roundResult);
      logMatchEvent('ROUND_END', 'system', context.roundResult);
      if (game.gameOver && matchActive) {
        void matchLogger.endMatch('completed', {
          reasonCode: 'BALANCE_BELOW_ZERO',
          winner: context.roundResult.winner,
        });
        matchActive = false;
      }
    }
  }

  // ── 단계별 STATE 송신 (generator runner) ─────────────────────────
  // 단계 STATE는 즉시 생산하고, 실제 시각 간격은 클라이언트의 단일 fly 큐가 소유한다.
  // 서버가 고정 지연을 더하면 손 안착 뒤 더미 출발까지 불필요한 공백이 생긴다.
  const STEP_DELAY_MS = 0;
  // 단일 서버 단계가 다음 단계 또는 입력 대기로 전환되어야 하는 상한.
  const SERVER_STEP_TIMEOUT_MS = 2000;
  // 사용자 입력 대기 phase — 단계 시퀀스를 여기서 끊고 다음 메시지를 기다린다.
  // shake_decision은 2026-05-31에 제거 (흔들기는 클라이언트 모달이 카드 클릭 시점에 처리).
  // awaiting_sangtong은 라운드 시작 시 같은 월 4장 보유자 모달 대기.
  function isPauseForUserInput(phase) {
    return phase === 'awaiting_floor_choice'
        || phase === 'awaiting_kkeut_choice'
        || phase === 'awaiting_go_stop'
        || phase === 'awaiting_sangtong';
  }
  // 단계 진행 중이면 새 액션 메시지를 거부하는 락. fly 중 중복 입력 방지.
  let stepInProgress = false;
  let stepRecoveryCount = 0;
  let activeStepTimerCount = 0;
  let bonusFlipRequestCount = 0;
  let gameGeneration = 0;
  let runnerSequence = 0;
  let activeRunner = null;

  /**
   * 현재 runner를 취소하고 generator와 타이머를 정리한다.
   *
   * @param {string} reason
   * @returns {void}
   */
  function cancelActiveRunner(reason) {
    if (activeRunner) activeRunner.cancel(reason);
  }

  /**
   * 현재 게임 세대를 폐기해 이전 비동기 작업의 접근을 차단한다.
   *
   * @param {string} reason
   * @returns {void}
   */
  function invalidateGameGeneration(reason) {
    cancelActiveRunner(reason);
    gameGeneration++;
  }

  /**
   * 게임 인스턴스를 교체하면서 기존 세대 runner를 먼저 취소한다.
   *
   * @param {object|null} nextGame
   * @param {string} reason
   * @returns {void}
   */
  function replaceGame(nextGame, reason) {
    invalidateGameGeneration(reason);
    game = nextGame;
  }

  /**
   * 현재 단계의 broadcastState를 보류하고 다음 단계까지 결과를 본 뒤 통합 송신해야
   * 하는 케이스 판정.
   *
   * 뻑 형성: 단계 1(pair_from_hand)에서 손 카드+짝이 captured로 가지만, 단계 2(덱
   * 뒤집기)에서 같은 월이 또 나오면 captured에서 두 카드를 floor로 되돌리고 셋이
   * 누적된다. 단계 1을 송신해 버리면 클라이언트가 captured fly 애니메이션을 발동했다가
   * 단계 2에서 다시 floor로 빠져버려 어색하다. 단계 2 결과까지 본 뒤 한 번에 송신.
   *
   * 같은 이유로 choice_made(2매칭 후 사용자가 1장 선택)도 다음 단계에서 뻑이 형성될
   * 수 있으므로 보류.
   *
   * 'choice_made' 보류 — chooseFloorSteps 단계 1(바닥 선택 후 srcCard+chosen captured 이동)
   * 직후 브로드캐스트하면 클라가 srcCard를 fly 없이 즉시 captured에서 발견하여 순간이동
   * 현상이 발생한다. 단계 2(덱 뒤집기) 결과까지 포함한 통합 STATE 1회 송신으로 해결.
   *
   * @param {object} g 게임 상태
   * @returns {boolean}
   */
  function shouldDeferBroadcast(g, step) {
    if (!g || !g.lastAction) return false;
    // 마지막 단계('turn_finished')는 항상 broadcast.
    if (step && step.step === 'turn_finished') return false;
    const k = g.lastAction.kind;
    // 'kkeut_choice' 보류 — selectKkeutTypeSteps의 단계 1 시점에 phase가 여전히
    // 'awaiting_kkeut_choice'라서, broadcastState 직후 isPauseForUserInput true로
    // runSteps가 종료되어 단계 2(finishTurn)가 영영 호출되지 않는다.
    //
    // 'pair_from_hand' 보류 — 단계 1(손→captured)과 단계 2(덱 뒤집기)가 통합 STATE로
    // 송신되어 뻑(ppeok) 형성 시 client가 captured 도착 fly 후 floor 되돌리기 fly를
    // 발동하는 어색한 흐름을 방지. client는 통합 STATE 1회에 단계 분리 fly로 시각화.
    // 'choice_made' 추가 — chooseFloorSteps 단계 1(srcCard+chosen captured 이동)을
    // 단계 2(덱 뒤집기)까지 보류해 통합 STATE로 송신. 미보류 시 srcCard가 fly 없이
    // 즉시 captured에 등장하는 순간이동 버그 발생.
    return k === 'pair_from_hand' || k === 'kkeut_choice' || k === 'choice_made';
  }

  /**
   * game.js의 *Steps generator를 단계별로 소진하면서 각 단계 끝에 broadcastState
   * 호출 + STEP_DELAY 지연. 사용자 입력 대기 phase에 도달하면 즉시 반환.
   *
   * 단, shouldDeferBroadcast 케이스에서는 broadcastState를 건너뛰고 즉시 다음 단계로
   * 진행해 뻑 가능성을 확정한 뒤 통합 송신한다.
   *
   * @param {Iterator<{step?:string,error?:string}>} gen
   * @param {object} player  ERROR 메시지를 돌려줄 대상
   */
  function runSteps(gen, player) {
    const runnerGame = game;
    const runnerGeneration = gameGeneration;
    const runner = {
      id: ++runnerSequence,
      game: runnerGame,
      generation: runnerGeneration,
      cancel: () => {},
    };
    activeRunner = runner;
    stepInProgress = true;
    let released = false;
    let nextTimer = null;
    let watchdogTimer = null;

    /**
     * runner가 현재 게임 세대와 active lock을 모두 소유하는지 확인한다.
     *
     * @returns {boolean}
     */
    function isCurrentOwner() {
      return activeRunner === runner
        && game === runnerGame
        && gameGeneration === runnerGeneration;
    }

    /**
     * 현재 runner가 소유한 타이머 수를 진단 상태에 반영한다.
     *
     * @returns {void}
     */
    function updateTimerCount() {
      if (activeRunner === runner) {
        activeStepTimerCount = Number(nextTimer !== null) + Number(watchdogTimer !== null);
      }
    }

    /**
     * runner를 정확히 한 번 종료하고 모든 타이머와 입력 잠금을 정리한다.
     *
     * @returns {boolean} 이번 호출이 실제 종료를 수행했는지 여부
     */
    function release() {
      if (released) return false;
      released = true;
      if (nextTimer !== null) clearTimeout(nextTimer);
      if (watchdogTimer !== null) clearTimeout(watchdogTimer);
      nextTimer = null;
      watchdogTimer = null;
      if (activeRunner === runner) {
        activeRunner = null;
        activeStepTimerCount = 0;
        stepInProgress = false;
      }
      return true;
    }

    /**
     * 외부 게임 수명 경계에서 runner를 강제 취소한다.
     *
     * @param {string} reason
     * @returns {void}
     */
    runner.cancel = (reason) => {
      if (released) return;
      if (nextTimer !== null) clearTimeout(nextTimer);
      if (watchdogTimer !== null) clearTimeout(watchdogTimer);
      nextTimer = null;
      watchdogTimer = null;
      try {
        if (typeof gen.return === 'function') gen.return();
      } catch (error) {
        console.warn(`[matgo] runner 취소 중 generator 오류 (${reason}):`, error?.message || error);
      }
      release();
    };

    /**
     * 다음 generator 단계를 예약하고 2초 단계 상한을 함께 건다.
     * 사용자 선택 phase는 예약 전에 release되므로 상한 적용 대상이 아니다.
     *
     * @param {number} delayMs
     * @returns {void}
     */
    function scheduleNext(delayMs) {
      if (released || !isCurrentOwner()) {
        runner.cancel('stale-before-schedule');
        return;
      }
      if (nextTimer !== null) clearTimeout(nextTimer);
      if (watchdogTimer !== null) clearTimeout(watchdogTimer);
      nextTimer = setTimeout(() => {
        if (!isCurrentOwner()) {
          runner.cancel('stale-next-timer');
          return;
        }
        nextTimer = null;
        updateTimerCount();
        next();
      }, delayMs);
      watchdogTimer = setTimeout(() => {
        if (released || !isCurrentOwner()) {
          runner.cancel('stale-watchdog');
          return;
        }
        stepRecoveryCount++;
        console.warn(
          '[matgo] runSteps 단계 상한 복구 — phase=',
          runnerGame?.phase,
          'lastAction=',
          runnerGame?.lastAction?.kind,
        );
        try {
          if (typeof gen.return === 'function') gen.return();
        } catch (error) {
          console.warn('[matgo] generator 종료 중 오류:', error?.message || error);
        }
        logMatchEvent('STATE_RECOVERED', 'system', {
          reason: 'SERVER_STEP_TIMEOUT',
          recoveryCount: stepRecoveryCount,
        });
        release();
        if (game === runnerGame && gameGeneration === runnerGeneration) broadcastState();
      }, SERVER_STEP_TIMEOUT_MS);
      updateTimerCount();
    }

    function next() {
      if (released || !isCurrentOwner()) {
        runner.cancel('stale-before-next');
        return;
      }
      if (watchdogTimer !== null) {
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
        updateTimerCount();
      }
      try {
        const r = gen.next();
        if (r.done) {
          console.log(`[matgo:STEP] gen done — release (phase=${runnerGame?.phase} turn=${runnerGame?.turn} hands=p1:${runnerGame?.hands?.p1?.length}/p2:${runnerGame?.hands?.p2?.length} credit=${JSON.stringify(runnerGame?.bombDeckCredit)})`);
          release();
          // 안전망: generator 종료 후 STATE를 한 번 더 broadcast해서 봇/클라가
          // 최신 상태로 동기화되도록 한다. release 직후 stepInProgress=false이므로
          // 봇이 stepInProgress 거절로 stuck됐어도 이 STATE로 재시도 가능.
          if (game === runnerGame
              && gameGeneration === runnerGeneration
              && !isPauseForUserInput(runnerGame.phase)
              && runnerGame.phase !== 'round_end') {
            broadcastState();
          }
          return;
        }
        const step = r.value || {};
        if (step.error) {
          console.log(`[matgo:STEP] yield error="${step.error}" — release`);
          logMatchEvent('INPUT_REJECTED', player.id, {
            code: 'RULE_REJECTED',
            message: step.error,
          });
          release();
          sendTo(player, { type: 'ERROR', message: step.error });
          return;
        }
        const lastKind = runnerGame?.lastAction?.kind;
        const defer = shouldDeferBroadcast(runnerGame, step);
        logMatchEvent('ACTION_STEP', player.id, {
          step: step.step || 'unknown',
          cardId: step.card?.id || null,
          lastAction: lastKind || null,
          deferredBroadcast: defer,
        });
        console.log(`[matgo:STEP] yield step=${step.step} lastAction=${lastKind} phase=${runnerGame?.phase} turn=${runnerGame?.turn} defer=${defer}`);
        if (defer) {
          scheduleNext(0);
          return;
        }
        if (!isCurrentOwner()) {
          runner.cancel('stale-before-broadcast');
          return;
        }
        broadcastState();
        if (runnerGame.phase === 'round_end') {
          console.log(`[matgo:STEP] round_end → ROUND_END broadcast`);
          broadcastAll({ type: 'ROUND_END', result: runnerGame.roundResult });
          release();
          return;
        }
        if (isPauseForUserInput(runnerGame.phase)) {
          console.log(`[matgo:STEP] pause for user input (phase=${runnerGame.phase}) — release`);
          release();
          return;
        }
        // turn_finished는 이미 최종 STATE를 송신했으므로 추가 STEP_DELAY 없이 generator를
        // 즉시 닫아 입력 잠금을 해제한다. 마지막 800ms 지연이 #37 간헐 정체의 원인이었다.
        if (step.step === 'turn_finished') {
          scheduleNext(0);
          return;
        }
        scheduleNext(STEP_DELAY_MS);
      } catch (e) {
        console.error('[matgo] runSteps next 에러:', e);
        logMatchEvent('ERROR', 'system', {
          code: 'STEP_RUNNER_ERROR',
          message: e?.message || 'internal error',
          recovered: true,
        });
        release();
        sendTo(player, { type: 'ERROR', message: '내부 오류 — 다시 시도해주세요' });
      }
    }
    next();
  }

  /**
   * 상대 Player를 반환한다.
   * @param {Player} player
   * @returns {Player|undefined}
   */
  function otherPlayer(player) {
    return players.find((p) => p.id !== player.id);
  }

  /**
   * 각 플레이어에게 자신 관점의 READY_STATE를 개별 전송한다.
   * (myReady = 본인, opponentReady = 상대 기준)
   */
  function broadcastReadyState() {
    for (const p of players) {
      const other = otherPlayer(p);
      sendTo(p, {
        type: 'READY_STATE',
        myReady: readySet.has(p.id),
        opponentReady: other ? readySet.has(other.id) : false,
      });
    }
  }

  /**
   * 양쪽 모두 입장 + 양쪽 모두 READY일 때만 게임 시작한다.
   * (기존 "2인 JOIN 즉시 startRound()" 대체)
   */
  function maybeStartGame() {
    if (players.length === 2 && readySet.size === 2 && !game) {
      replaceGame(createGame('p1'), 'READY_NEW_GAME');
      matchLogger.startMatch({ mode: 'two-player' });
      matchLogger.startRound({ firstTurn: game.turn });
      matchActive = true;
      previousLoggedPhase = null;
      loggedRoundEnd = false;
      loggedBatchIds.clear();
      console.log('[matgo] 양쪽 READY 완료 → 새 게임 시작');
      broadcastAll({ type: 'GAME_START' });
      broadcastState();
    }
  }

  /**
   * 모든 플레이어에게 각자의 시점 스냅샷을 브로드캐스트.
   */
  function broadcastState() {
    if (!game) return;
    logStateMilestones();
    for (const p of players) {
      if (p.ws.readyState === 1) {
        p.ws.send(JSON.stringify(snapshotForPlayer(game, p.id)));
      }
    }
  }

  /**
   * 모든 플레이어에게 임의 페이로드 브로드캐스트.
   * @param {object} payload
   */
  function broadcastAll(payload) {
    const msg = JSON.stringify(payload);
    for (const p of players) {
      if (p.ws.readyState === 1) p.ws.send(msg);
    }
  }

  /**
   * 특정 플레이어에게 단일 메시지.
   * @param {Player} player
   * @param {object} payload
   */
  function sendTo(player, payload) {
    if (player && player.ws.readyState === 1) {
      player.ws.send(JSON.stringify(payload));
    }
  }

  // ── 봇 자식 프로세스 관리 (mode=ai 사용자가 들어왔을 때 자동 spawn) ────
  /** @type {import('child_process').ChildProcess|null} */
  let botChild = null;

  /**
   * 봇 자식 프로세스를 spawn한다. 이미 실행 중이면 무시.
   * bot.js가 없으면 경고 출력 후 스킵.
   */
  function spawnBotChild() {
    const botPath = path.join(__dirname, 'bot.js');
    if (!fs.existsSync(botPath)) {
      console.warn('[matgo] bot.js 없음 — 봇 spawn 스킵');
      return;
    }
    if (botChild && botChild.exitCode === null) {
      console.log('[matgo] 봇 이미 실행 중');
      return;
    }
    const url = getBotUrl();
    if (!url) {
      console.warn('[matgo] getBotUrl이 null 반환 — 봇 spawn 스킵');
      return;
    }
    console.log(`[matgo] 봇 spawn: ${url}`);
    // 봇 stdout/stderr를 부모(launcher) 콘솔로 inherit — 디버깅 (9월 술잔 멈춤 등 추적)
    botChild = spawn(process.execPath, [botPath, '--url', url], {
      detached: false,
      stdio: 'inherit',
    });
    botChild.on('exit', (code) => {
      console.log(`[matgo] 봇 종료 (code=${code})`);
      botChild = null;
    });
  }

  /**
   * 봇 자식 프로세스를 종료한다. mode=ai 사용자가 끊어졌을 때 호출.
   */
  function killBotChild() {
    if (botChild && botChild.exitCode === null) {
      console.log('[matgo] 봇 종료 요청');
      botChild.kill();
      botChild = null;
    }
  }

  // ── WebSocket 서버 (noServer 모드) ─────────────────────────────
  const wss = new WebSocketServer({ noServer: true });

  // ── WebSocket 핸들러 ──────────────────────────────────────────────
  wss.on('connection', (ws, req) => {
    // mode 추출: URL query에서. 사용자=ai|human, 봇=bot.
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const wsMode = urlObj.searchParams.get('mode') || 'human';
    const isBot = wsMode === 'bot';
    ws._mode = wsMode;
    ws._isBot = isBot;
    // 사람(비봇) 진입 시 죽은(좀비) 슬롯만 선제 정리 (살아있는 봇은 보존)
    if (!isBot) {
      const dead = players.filter((p) => p.ws.readyState !== WebSocket.OPEN);
      if (dead.length > 0) {
        for (const z of dead) { try { z.ws.terminate(); } catch (e) {} }
        players = players.filter((p) => p.ws.readyState === WebSocket.OPEN);
        console.log(`[matgo] 죽은(좀비) 슬롯 ${dead.length}개 선제 제거`);
        if (players.length === 0) replaceGame(null, 'ZOMBIE_CLEANUP');
      }
    }

    if (players.length >= 2) {
      ws.send(JSON.stringify({ type: 'ERROR', message: '방이 가득 찼다 (2/2)' }));
      ws.close();
      console.log('[matgo] 연결 거절: 룸 정원 초과');
      return;
    }

    // Heartbeat 상태 초기화
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    // 비어있는 슬롯 ID에 할당 — players.length 기반은 봇/사용자 재접속 시 ID 충돌 발생
    const playerId = players.find((p) => p.id === 'p1') ? 'p2' : 'p1';
    /** @type {Player} */
    // 봇은 JOIN을 보내지 않으므로 서버가 즉시 name='AI'를 부여한다.
    const player = { id: playerId, ws, name: isBot ? 'AI' : '(알 수 없음)' };
    players.push(player);
    console.log(`[matgo] ${playerId} 연결됨 (${players.length}/2)`);

    // JOINED 전송 — 상대가 이미 있으면 상대 이름 포함
    const existingOpp = otherPlayer(player);
    sendTo(player, {
      type: 'JOINED',
      playerId,
      waiting: players.length < 2,
      hasName: isBot,
      opponentName: (existingOpp && existingOpp.name && existingOpp.name !== '(알 수 없음)') ? existingOpp.name : undefined,
    });

    // 봇은 JOIN을 보내지 않으므로 connection 즉시 상대에게 알림
    if (isBot) {
      const human = otherPlayer(player);
      if (human) {
        sendTo(human, {
          type: 'JOINED',
          playerId: human.id,
          waiting: false,
          hasName: true,
          opponentName: 'AI',
        });
      }
      broadcastReadyState();
    }

    if (wsMode === 'ai' && !isBot && players.length === 1) {
      // mode=ai 사용자가 혼자 들어왔다 → 봇 자동 spawn (자기 자식 프로세스).
      // 봇이 connect하면 READY 게이트를 통해 게임 시작.
      // 약간의 지연: 사용자가 JOINED를 받기 전 봇이 먼저 와서 ID 충돌 가능성 회피.
      setTimeout(() => spawnBotChild(), 200);
    }

    // ── 메시지 라우터 ──
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (e) {
        console.warn('[matgo] JSON 파싱 실패:', data.toString());
        logMatchEvent('INPUT_REJECTED', player.id, {
          code: 'INVALID_JSON',
          message: 'JSON 파싱 실패',
        });
        return;
      }
      console.log(`[matgo:RECV] ${player.id}(isBot=${ws._mode === 'bot'}) ${JSON.stringify(msg)} (phase=${game?.phase} turn=${game?.turn} stepInProgress=${stepInProgress})`);

      // JSON.parse('null')은 null, 'true'/'0' 등은 원시값으로 정상 파싱된다.
      // 그 후 msg.type 접근 시 TypeError로 서버 프로세스가 죽으므로 객체+type 검증을 거친다. (P0-A fix)
      if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') {
        logMatchEvent('INPUT_REJECTED', player.id, {
          code: 'INVALID_MESSAGE',
          message: '잘못된 메시지 형식',
        });
        try {
          sendTo(player, { type: 'ERROR', message: '잘못된 메시지 형식입니다.' });
        } catch (e) { /* 송신 실패는 무시 */ }
        return;
      }
      if (game && !new Set(['JOIN', 'READY']).has(msg.type)) {
        logMatchEvent('PLAYER_INPUT', player.id, safeInputPayload(msg));
      }

      switch (msg.type) {
        case 'JOIN': {
          // 닉네임 전달. name 누락 시 '(알 수 없음)' 폴백(후방호환 — JOIN 미수신 smoke 무영향).
          const raw = typeof msg.name === 'string' ? msg.name.trim().slice(0, 12) : '';
          player.name = raw || '(알 수 없음)';
          console.log(`[matgo] JOIN: ${player.id} → "${player.name}"`);
          // 상대가 이미 있으면 상대에게 opponentName 포함 JOINED 재전송
          const other = otherPlayer(player);
          if (other) {
            sendTo(other, {
              type: 'JOINED',
              playerId: other.id,
              waiting: false,
              hasName: true,
              opponentName: player.name,
            });
          }
          broadcastReadyState();
          break;
        }

        case 'READY': {
          // 양방향 READY 게이트. 양쪽 READY 시에만 게임 시작.
          readySet.add(player.id);
          console.log(`[matgo] READY: ${player.id} (readySet.size=${readySet.size})`);
          broadcastReadyState();
          if (readySet.size === 2) {
            maybeStartGame();
          }
          break;
        }

        case 'PLAY_CARD': {
          if (!game) break;
          if (stepInProgress) {
            logMatchEvent('INPUT_REJECTED', player.id, { code: 'STEP_IN_PROGRESS', type: msg.type });
            sendTo(player, { type: 'ERROR', message: '단계 진행 중' }); break;
          }
          console.log(`[matgo] PLAY_CARD: ${player.id} → ${msg.cardId}`);
          runSteps(playCardSteps(game, player.id, msg.cardId), player);
          break;
        }

        case 'CHOOSE_FLOOR': {
          if (!game) break;
          if (stepInProgress) {
            logMatchEvent('INPUT_REJECTED', player.id, { code: 'STEP_IN_PROGRESS', type: msg.type });
            sendTo(player, { type: 'ERROR', message: '단계 진행 중' }); break;
          }
          console.log(`[matgo] CHOOSE_FLOOR: ${player.id} → ${msg.cardId}`);
          logMatchEvent('CHOICE_MADE', player.id, {
            choiceType: 'floor',
            cardId: msg.cardId,
          });
          runSteps(chooseFloorSteps(game, player.id, msg.cardId), player);
          break;
        }

        case 'GO_STOP': {
          if (!game) break;
          const r = goStop(game, player.id, msg.decision);
          if (!r.ok) {
            logMatchEvent('INPUT_REJECTED', player.id, { code: 'RULE_REJECTED', message: r.error });
            sendTo(player, { type: 'ERROR', message: r.error }); break;
          }
          console.log(`[matgo] GO_STOP: ${player.id} → ${msg.decision}`);
          logMatchEvent('CHOICE_MADE', player.id, {
            choiceType: 'go_stop',
            decision: msg.decision,
          });
          broadcastState();
          if (game.phase === 'round_end') {
            broadcastAll({ type: 'ROUND_END', result: game.roundResult });
          }
          break;
        }

        case 'SHAKE': {
          if (!game) break;
          // 흔들기는 클라이언트 모달에서 카드 클릭 시점에 결정한다. msg.month는 카드 월 (lastAction 기록용).
          const r = shakeDecision(game, player.id, msg.decision, msg.month);
          if (!r.ok) {
            logMatchEvent('INPUT_REJECTED', player.id, { code: 'RULE_REJECTED', message: r.error });
            sendTo(player, { type: 'ERROR', message: r.error }); break;
          }
          console.log(`[matgo] SHAKE: ${player.id} → ${msg.decision} (month=${msg.month})`);
          broadcastState();
          break;
        }

        case 'SELECT_SANGTONG': {
          if (!game) break;
          if (stepInProgress) {
            logMatchEvent('INPUT_REJECTED', player.id, { code: 'STEP_IN_PROGRESS', type: msg.type });
            sendTo(player, { type: 'ERROR', message: '단계 진행 중' }); break;
          }
          console.log(`[matgo] SELECT_SANGTONG: ${player.id} → ${msg.choice}`);
          logMatchEvent('CHOICE_MADE', player.id, {
            choiceType: 'sangtong',
            choice: msg.choice,
          });
          runSteps(sangtongSteps(game, player.id, msg.choice), player);
          break;
        }

        case 'SELECT_KKEUT_TYPE': {
          if (!game) break;
          if (stepInProgress) {
            logMatchEvent('INPUT_REJECTED', player.id, { code: 'STEP_IN_PROGRESS', type: msg.type });
            sendTo(player, { type: 'ERROR', message: '단계 진행 중' }); break;
          }
          console.log(`[matgo] SELECT_KKEUT_TYPE: ${player.id} → ${msg.choice}`);
          logMatchEvent('CHOICE_MADE', player.id, {
            choiceType: 'kkeut',
            choice: msg.choice,
          });
          runSteps(selectKkeutTypeSteps(game, player.id, msg.choice), player);
          break;
        }

        case 'BOMB': {
          if (!game) break;
          if (stepInProgress) {
            logMatchEvent('INPUT_REJECTED', player.id, { code: 'STEP_IN_PROGRESS', type: msg.type });
            sendTo(player, { type: 'ERROR', message: '단계 진행 중' }); break;
          }
          console.log(`[matgo] BOMB: ${player.id} → month=${msg.month}`);
          runSteps(bombSteps(game, player.id, msg.month), player);
          break;
        }

        case 'BONUS_FLIP': {
          bonusFlipRequestCount++;
          if (!game) break;
          if (stepInProgress) {
            logMatchEvent('INPUT_REJECTED', player.id, { code: 'STEP_IN_PROGRESS', type: msg.type });
            sendTo(player, { type: 'ERROR', message: '단계 진행 중' }); break;
          }
          console.log(`[matgo] BONUS_FLIP: ${player.id}`);
          runSteps(bonusFlipSteps(game, player.id), player);
          break;
        }

        case 'NEW_ROUND': {
          if (players.length < 2) {
            sendTo(player, { type: 'ERROR', message: '상대방이 없어 새 라운드를 시작할 수 없다' });
            break;
          }
          // 게임 종료(잔고 음수) 상태에서는 새 라운드 불가 — 새 게임으로만 진행 가능.
          if (game && game.gameOver) {
            sendTo(player, { type: 'ERROR', message: '게임이 종료되었다. 새 게임으로 시작해라.' });
            break;
          }
          if (!game) {
            replaceGame(createGame('p1'), 'NEW_ROUND_WITHOUT_GAME');
            matchLogger.startMatch({ mode: 'two-player' });
            matchActive = true;
          } else {
            // 직전 라운드 승자가 다음 판의 선공/딜러를 유지한다.
            const next = nextRoundStarter(game);
            invalidateGameGeneration('NEW_ROUND');
            startRound(game, next);
          }
          matchLogger.startRound({ firstTurn: game.turn });
          previousLoggedPhase = null;
          loggedRoundEnd = false;
          loggedBatchIds.clear();
          console.log('[matgo] NEW_ROUND → 새 라운드 시작');
          broadcastAll({ type: 'ROUND_START' });
          broadcastState();
          break;
        }

        case 'NEW_GAME': {
          if (players.length < 2) {
            sendTo(player, { type: 'ERROR', message: '상대방이 없어 새 게임을 시작할 수 없다' });
            break;
          }
          const nextFirst = nextRoundStarter(game);
          const perPoint = game?.perPoint ?? 100;
          if (matchActive) void matchLogger.endMatch('completed', { reasonCode: 'NEW_GAME' });
          replaceGame(createGame(nextFirst, { perPoint }), 'NEW_GAME');
          matchLogger.startMatch({ mode: 'two-player' });
          matchLogger.startRound({ firstTurn: game.turn });
          matchActive = true;
          previousLoggedPhase = null;
          loggedRoundEnd = false;
          loggedBatchIds.clear();
          console.log(`[matgo] NEW_GAME → 잔고 리셋 새 게임 (선공: ${nextFirst})`);
          broadcastAll({ type: 'GAME_START' });
          broadcastState();
          break;
        }

        case 'SET_PER_POINT': {
          if (!game) break;
          const v = parseInt(msg.value, 10);
          if (!Number.isInteger(v) || v < 1) {
            sendTo(player, { type: 'ERROR', message: '점당 금액은 1 이상의 정수' });
            break;
          }
          game.perPoint = v;
          console.log(`[matgo] SET_PER_POINT: ${v}`);
          broadcastState();
          break;
        }

        default:
          console.warn(`[matgo] 알 수 없는 메시지 타입: ${msg.type}`);
          logMatchEvent('INPUT_REJECTED', player.id, {
            code: 'UNKNOWN_INPUT_TYPE',
            type: msg.type,
          });
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`[matgo] ${player.id} 연결 해제 (mode=${ws._mode} code=${code} reason="${reason?.toString() || ''}" phase=${game?.phase} turn=${game?.turn})`);
      // reset/zombie 정리에서 이미 명단에서 빠진 소켓의 지연 close는 새 게임을 건드리면 안 된다.
      const wasRegistered = players.includes(player);
      const disconnectedName = player.name || '(알 수 없음)';
      if (wasRegistered && matchActive && game) {
        void matchLogger.endMatch('interrupted', {
          actor: player.id,
          reasonCode: 'PLAYER_LEFT',
          closeCode: code,
        });
        matchActive = false;
      }
      readySet.delete(player.id);
      players = players.filter((p) => p.id !== player.id);
      if (!wasRegistered) return;
      // 사람(mode=ai)이 끊긴 경우: 봇 자식 프로세스도 같이 종료.
      // 새 사용자가 다시 들어오면 새 봇이 spawn된다.
      if (!isBot) {
        // 봇 슬롯을 players에서 동기 제거 + ws.terminate() (SIGTERM 비동기 지연으로 OPEN 좀비 잔존 방지)
        const botSlot = players.find((p) => p.ws._isBot);
        if (botSlot) {
          players = players.filter((p) => !p.ws._isBot);
          try { botSlot.ws.terminate(); } catch (e) {}
        }
        killBotChild();
      }
      if (players.length === 0) {
        replaceGame(null, 'LAST_PLAYER_DISCONNECTED');
      } else {
        broadcastAll({
          type: 'OPPONENT_LEFT',
          name: disconnectedName,
          message: `${disconnectedName}님이 나갔습니다.`,
        });
        replaceGame(null, 'PLAYER_DISCONNECTED');
      }
    });

    ws.on('error', (err) => {
      console.error(`[matgo] ${player.id} WS 에러:`, err.message);
      logMatchEvent('ERROR', player.id, {
        code: 'WS_ERROR',
        message: err.message,
        recovered: true,
      });
    });
  });

  // ── Heartbeat: 30초마다 ping ────────────────────────────────────
  const HEARTBEAT_INTERVAL_MS = 30000;
  const heartbeatTimer = setInterval(() => {
    for (const p of [...players]) {
      if (p.ws.isAlive === false) {
        console.log(`[matgo] ${p.id} heartbeat 응답 없음 → 강제 종료`);
        p.ws.terminate();
        continue;
      }
      p.ws.isAlive = false;
      try { p.ws.ping(); } catch (e) { /* 이미 닫힌 ws — 다음 사이클에 정리됨 */ }
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => {
    clearInterval(heartbeatTimer);
    invalidateGameGeneration('SERVER_CLOSED');
    if (matchActive && game) {
      void matchLogger.endMatch('interrupted', { reasonCode: 'SERVER_SHUTDOWN' });
      matchActive = false;
    }
  });

  // ── HTTP 핸들러 (정적 파일 서빙) ──────────────────────────────
  /**
   * 정적 파일 응답 핸들러. public/ 외 경로는 차단 (디렉토리 탈출 방지).
   * req.url은 launcher가 path prefix를 제거한 뒤 전달한다 (예: '/style.css').
   * 단독 실행 시에도 동일한 경로 형식 (예: '/index.html').
   *
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  function handleHttp(req, res) {
    const reqUrl = req.url || '/';
    // query string은 무시하고 path만 추출. mode=ai 같은 쿼리가 붙어도 정상 매칭.
    const reqPath = reqUrl.split('?')[0] || '/';

    // ── 테스트 전용 엔드포인트: POST /test/inject ─────────────────────────────
    // 결정적 테스트를 위해 게임 상태(손패/바닥/덱)를 직접 주입한다.
    // 이 엔드포인트는 Playwright E2E 테스트에서만 사용한다 (LAN 전용 게임이므로 보안 위험 없음).
    if (req.method === 'POST' && reqPath === '/test/inject') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const cfg = JSON.parse(body);
          if (!game) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: '게임이 아직 시작되지 않음' }));
            return;
          }
          // 주입 가능 필드들 (undefined는 현재 값 유지)
          if (cfg.p1Hand   !== undefined) game.hands.p1    = cfg.p1Hand;
          if (cfg.p2Hand   !== undefined) game.hands.p2    = cfg.p2Hand;
          if (cfg.floor    !== undefined) game.floor        = cfg.floor;
          if (cfg.deck     !== undefined) game.deck         = cfg.deck;
          if (cfg.turn     !== undefined) game.turn         = cfg.turn;
          if (cfg.phase    !== undefined) game.phase        = cfg.phase;
          if (cfg.captured !== undefined) game.captured     = cfg.captured;
          if (cfg.goCount  !== undefined) game.goCount      = cfg.goCount;
          if (cfg.shaking  !== undefined) game.shaking      = cfg.shaking;
          if (cfg.bombDeckCredit !== undefined) game.bombDeckCredit = cfg.bombDeckCredit;
          if (cfg.pendingBombFlips !== undefined) game.pendingBombFlips = cfg.pendingBombFlips;
          if (cfg.bombResolvingPlayer !== undefined) {
            game.bombResolvingPlayer = cfg.bombResolvingPlayer;
          }
          if (cfg.kkeutAsSsangpi  !== undefined) game.kkeutAsSsangpi  = cfg.kkeutAsSsangpi;
          if (cfg.kkeutChoiceMade !== undefined) game.kkeutChoiceMade = cfg.kkeutChoiceMade;
          if (cfg.pendingSangtong !== undefined) game.pendingSangtong = cfg.pendingSangtong;
          if (cfg.ppeokCount !== undefined) game.ppeokCount = cfg.ppeokCount;
          if (cfg.firstPpeokBy !== undefined) game.firstPpeokBy = cfg.firstPpeokBy;
          if (cfg.roundResult !== undefined) game.roundResult = cfg.roundResult;
          // #64 테스트 지원 (2026-07-30): choice srcCard fly 출처 검증을 위해
          // choiceFloorSrcCardId(→pendingChoiceSrcCardId)와 lastAction을 직접
          // 주입할 수 있게 한다. 미지정 시 기존 동작(test_inject) 그대로 유지.
          game.pendingChoiceSrcCardId = cfg.choiceFloorSrcCardId !== undefined
            ? cfg.choiceFloorSrcCardId
            : null;
          // 항상 초기화 — 이전 대기 상태 잔류 방지
          game.ppeokFlags         = cfg.ppeokFlags || {};
          game.pendingFloorChoice = null;
          game.pendingCaptureBatch = null;
          game.pendingKkeutChoice = cfg.pendingKkeutChoice || null;
          game.lastAction         = cfg.lastAction !== undefined ? cfg.lastAction : { kind: 'test_inject' };
          broadcastState();
          // round_end 상태 주입 시 ROUND_END 이벤트도 발송
          if (game.phase === 'round_end' && game.roundResult) {
            broadcastAll({ type: 'ROUND_END', result: game.roundResult });
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    // ── 테스트 전용 엔드포인트: GET /test/status ───────────────────────────────
    // 단계 runner의 잠금·타이머가 정상 해제됐는지 결정론적으로 검증한다.
    if (req.method === 'GET' && reqPath === '/test/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        stepInProgress,
        activeStepTimerCount,
        gameGeneration,
        activeRunnerId: activeRunner?.id || null,
        activeRunnerGeneration: activeRunner?.generation ?? null,
        stepRecoveryCount,
        bonusFlipRequestCount,
        phase: game?.phase || null,
        turn: game?.turn || null,
        capturedCount: game
          ? { p1: game.captured.p1.length, p2: game.captured.p2.length }
          : { p1: 0, p2: 0 },
        pendingCaptureCount: game?.pendingCaptureBatch?.cards?.length || 0,
        pendingCaptureCardIds: game?.pendingCaptureBatch?.cards?.map((card) => card.id) || [],
        bombDeckCredit: { ...(game?.bombDeckCredit || { p1: 0, p2: 0 }) },
        settlementBatch: game?.turnAction?.steps?.find(
          (step) => step.type === 'SETTLE_CAPTURE_BATCH',
        ) || null,
        roundResult: game?.roundResult || null,
      }));
      return;
    }

    // ── 테스트 전용 엔드포인트: POST /test/reset ──────────────────────────────
    // 룸 상태를 강제 초기화한다 (테스트 전용, beforeEach에서 호출).
    // browser.close() 후 ws close 이벤트가 비동기로 처리되는 레이스를 제거하기 위해
    // game/players를 먼저 비운 뒤 활성 ws를 강제 close한다.
    // 프로덕션 요청에는 절대 도달하지 않는 경로 (LAN 전용 게임이므로 보안 위험 없음).
    if (req.method === 'POST' && reqPath === '/test/reset') {
      // 1단계: close 이벤트 재진입 방지 — game/players를 선제 초기화한다.
      //   close 핸들러는 players = players.filter(...) / game = null 을 수행하므로
      //   먼저 비워두면 이벤트가 발화해도 filter 대상이 없어 noop이 된다.
      replaceGame(null, 'TEST_RESET');
      const snapshot = players.slice(); // 강제 종료할 ws 목록 확보
      players = [];                     // 선제 초기화 (close 이벤트 재진입 시 splice 대상 없음)
      readySet.clear();

      // 2단계: 스냅샷의 ws를 강제 close. 이미 닫혔으면(readyState >= CLOSING) skip.
      for (const p of snapshot) {
        try {
          if (p.ws.readyState < 2) { // CONNECTING(0) or OPEN(1)
            p.ws.close();
          }
        } catch (e) { /* 이미 닫힌 ws — 무시 */ }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, reset: snapshot.length }));
      return;
    }

    const urlPath = (reqPath === '/' || reqPath === '') ? '/index.html' : reqPath;
    const safePath = path.normalize(urlPath).replace(/^([\\/])+/, '');
    const fullPath = path.join(PUBLIC_DIR, safePath);
    if (!fullPath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    fs.readFile(fullPath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      const ext = path.extname(fullPath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
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
   * 활성 러너를 먼저 취소한 뒤 WebSocket 서버를 닫는다.
   *
   * @returns {Promise<void>}
   */
  function closeApp() {
    invalidateGameGeneration('SERVER_CLOSE_REQUESTED');
    return new Promise((resolve) => wss.close(resolve));
  }

  return {
    handleHttp,
    handleUpgrade,
    flushLogs: () => matchLogger.flush(),
    close: closeApp,
  };
}

// ──────────────────────────────────────────────────────────────
// 단독 실행 모드: `node server.js [--port N]`
// import.meta.url과 process.argv[1]을 비교하여 직접 실행인지 판정한다.
// ──────────────────────────────────────────────────────────────

/**
 * 현재 모듈이 직접 실행되었는지 (vs launcher가 import) 판정한다.
 * 윈도우 경로 구분자 차이를 흡수.
 * @returns {boolean}
 */
function isDirectExecution() {
  if (!process.argv[1]) return false;
  const argvPath = process.argv[1].replace(/\\/g, '/');
  const metaPath = import.meta.url.replace('file:///', '').replace('file://', '');
  return metaPath === argvPath || metaPath.endsWith(argvPath);
}

if (isDirectExecution()) {
  const argv = process.argv.slice(2);
  const portFlagIndex = argv.indexOf('--port');
  const PORT = portFlagIndex >= 0 && argv[portFlagIndex + 1]
    ? parseInt(argv[portFlagIndex + 1], 10)
    : 3003;

  const app = createApp({
    // 단독 실행 시 봇 WS URL 제공 (mode=ai 사용자 진입 시 봇 자동 spawn 지원)
    getBotUrl: () => `ws://localhost:${PORT}/ws?mode=bot`,
  });
  const server = http.createServer(app.handleHttp);
  server.on('upgrade', app.handleUpgrade);

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
          results.push({ ip: net.address, ifname: name, virtual: isVirtualInterface(name) });
        }
      }
    }
    results.sort((a, b) => interfacePriority(a.ifname) - interfacePriority(b.ifname));
    return results;
  }

  // ── 콘솔 배너 ────────────────────────────────────────────────────
  function supportsAnsi() {
    if (process.env.NO_COLOR) return false;
    if (process.env.TERM === 'dumb') return false;
    if (!process.stdout || !process.stdout.isTTY) return false;
    return true;
  }

  const ANSI = supportsAnsi()
    ? { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', magenta: '\x1b[35m' }
    : { reset: '', bold: '', dim: '', cyan: '', green: '', yellow: '', magenta: '' };

  function padBoxLine(text, width) {
    const visible = text.replace(/\x1b\[[0-9;]*m/g, '');
    const padLen = Math.max(0, width - visible.length);
    return text + ' '.repeat(padLen);
  }

  function printBanner(port, lanIps) {
    const W = 60;
    const top   = `+${'-'.repeat(W)}+`;
    const sep   = `+${'-'.repeat(W)}+`;
    const empty = `|${' '.repeat(W)}|`;
    const line  = (s) => `|${padBoxLine(s, W)}|`;

    console.log('');
    console.log(ANSI.cyan + top + ANSI.reset);
    console.log(ANSI.cyan + line(`  ${ANSI.bold}MATGO (맞고)${ANSI.reset}${ANSI.cyan} - LAN 1:1 대전`) + ANSI.reset);
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
    console.log(ANSI.cyan + line(`  ${ANSI.dim}종료: Ctrl+C${ANSI.reset}`) + ANSI.reset);
    console.log(ANSI.cyan + top + ANSI.reset);
    console.log('');
  }

  // ── 서버 시작 ────────────────────────────────────────────────────
  server.on('error', (err) => {
    console.error('[matgo] HTTP 에러:', err.message);
    process.exit(1);
  });

  server.listen(PORT, '0.0.0.0', () => {
    const lanIps = getLanAddresses();
    printBanner(PORT, lanIps);
    console.log(ANSI.dim
      + ' Tip: 처음 실행 시 Windows Defender 방화벽 팝업이 뜨면 "개인 네트워크"에 체크 후 액세스 허용.'
      + ANSI.reset);
    console.log('');
  });
}
