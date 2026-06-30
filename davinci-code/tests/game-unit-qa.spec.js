/**
 * @fileoverview 다빈치 코드 플러스 game.js 단위 테스트.
 * 서버 불필요 -- game.js를 직접 import하여 로직 검증.
 */

import { test, expect } from '@playwright/test';
import { createGame, guess, continueDecision, selfReveal, placeJoker, snapshotForPlayer, COLORS, VALUES } from '../game.js';

// ── 덱 생성 검증 ──────────────────────────────────────────────────

test.describe('덱 생성', () => {
  test('G-01: 전체 39장 생성 (red 13 + yellow 13 + blue 13)', () => {
    const g = createGame();
    // 덱 + p1 손(4) + p2 손(4) + p1 조커(1) + p2 조커(1) = 39
    const totalCards = g.deck.length
      + g.hands.p1.length
      + g.hands.p2.length
      + (g.unplacedJokers.p1 ? 1 : 0)
      + (g.unplacedJokers.p2 ? 1 : 0);
    expect(totalCards).toBe(39);
  });

  test('G-02: 각 색상별 13장 확인 (숫자 12 + 조커 1)', () => {
    const g = createGame();
    const allCards = [
      ...g.deck,
      ...g.hands.p1,
      ...g.hands.p2,
      ...(g.unplacedJokers.p1 ? [g.unplacedJokers.p1] : []),
      ...(g.unplacedJokers.p2 ? [g.unplacedJokers.p2] : []),
    ];

    for (const color of COLORS) {
      const colorCards = allCards.filter(c => c.color === color);
      expect(colorCards.length).toBe(13);
      const jokers = colorCards.filter(c => c.isJoker);
      expect(jokers.length).toBe(1);
      const numerics = colorCards.filter(c => !c.isJoker);
      expect(numerics.length).toBe(12);
      // 숫자 0~11 완비
      const vals = numerics.map(c => c.value).sort((a, b) => a - b);
      expect(vals).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    }
  });

  test('G-03: COLORS 상수가 red, yellow, blue 3개', () => {
    expect(COLORS).toEqual(['red', 'yellow', 'blue']);
  });

  test('G-04: VALUES 상수가 0~11 범위', () => {
    expect(VALUES).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});

// ── 손패 배분 + 정렬 검증 ──────────────────────────────────────────

test.describe('손패 배분 및 정렬', () => {
  test('G-05: 각 플레이어 숫자 카드 4장 배분', () => {
    const g = createGame();
    expect(g.hands.p1.length).toBe(4);
    expect(g.hands.p2.length).toBe(4);
    // 모든 카드가 숫자 카드(조커 아님)
    expect(g.hands.p1.every(c => !c.isJoker)).toBe(true);
    expect(g.hands.p2.every(c => !c.isJoker)).toBe(true);
  });

  test('G-06: 손패가 오름차순 정렬 (동점 red < yellow < blue)', () => {
    // 여러 번 반복하여 정렬 검증
    for (let trial = 0; trial < 20; trial++) {
      const g = createGame();
      for (const pid of ['p1', 'p2']) {
        const hand = g.hands[pid];
        for (let i = 1; i < hand.length; i++) {
          const prev = hand[i - 1];
          const curr = hand[i];
          if (prev.value === curr.value) {
            const colorOrder = { red: 0, yellow: 1, blue: 2 };
            expect(colorOrder[prev.color]).toBeLessThan(colorOrder[curr.color]);
          } else {
            expect(prev.value).toBeLessThan(curr.value);
          }
        }
      }
    }
  });

  test('G-07: 각 플레이어에 조커 1장 분리 보관', () => {
    const g = createGame();
    expect(g.unplacedJokers.p1).not.toBeNull();
    expect(g.unplacedJokers.p1.isJoker).toBe(true);
    expect(g.unplacedJokers.p1.value).toBeNull();
    expect(g.unplacedJokers.p2).not.toBeNull();
    expect(g.unplacedJokers.p2.isJoker).toBe(true);
    expect(g.unplacedJokers.p2.value).toBeNull();
  });

  test('G-08: p1, p2 조커가 서로 다른 카드', () => {
    const g = createGame();
    expect(g.unplacedJokers.p1.id).not.toBe(g.unplacedJokers.p2.id);
  });
});

// ── 초기 상태 검증 ──────────────────────────────────────────────────

test.describe('초기 게임 상태', () => {
  test('G-09: 시작 phase = awaiting_joker_placement', () => {
    const g = createGame();
    expect(g.phase).toBe('awaiting_joker_placement');
  });

  test('G-10: jokerPlaced 초기값 = {p1:false, p2:false}', () => {
    const g = createGame();
    expect(g.jokerPlaced).toEqual({ p1: false, p2: false });
  });

  test('G-11: pendingDrawn 초기값 = null', () => {
    const g = createGame();
    expect(g.pendingDrawn).toBeNull();
  });

  test('G-12: winner 초기값 = null', () => {
    const g = createGame();
    expect(g.winner).toBeNull();
  });

  test('G-13: firstTurn 파라미터 동작 확인', () => {
    const g1 = createGame('p1');
    expect(g1.turn).toBe('p1');
    const g2 = createGame('p2');
    expect(g2.turn).toBe('p2');
  });
});

// ── 조커 배치 (placeJoker) 검증 ────────────────────────────────────

test.describe('조커 배치 (placeJoker)', () => {
  test('G-14: insertAfter=-1 (맨 앞) 배치', () => {
    const g = createGame();
    const jokerColor = g.unplacedJokers.p1.color;
    const result = placeJoker(g, 'p1', -1);
    expect(result.ok).toBe(true);
    expect(g.hands.p1[0].isJoker).toBe(true);
    expect(g.hands.p1[0].color).toBe(jokerColor);
    expect(g.hands.p1.length).toBe(5);
    expect(g.jokerPlaced.p1).toBe(true);
    expect(g.unplacedJokers.p1).toBeNull();
  });

  test('G-15: insertAfter=마지막 (맨 뒤) 배치', () => {
    const g = createGame();
    const handLen = g.hands.p1.length; // 4
    const result = placeJoker(g, 'p1', handLen - 1); // insertAfter=3 -> index 4
    expect(result.ok).toBe(true);
    expect(g.hands.p1[handLen].isJoker).toBe(true);
    expect(g.hands.p1.length).toBe(5);
  });

  test('G-16: 중간 위치 배치', () => {
    const g = createGame();
    const result = placeJoker(g, 'p1', 1); // 1번 카드 뒤 (index 2)
    expect(result.ok).toBe(true);
    expect(g.hands.p1[2].isJoker).toBe(true);
    expect(g.hands.p1.length).toBe(5);
  });

  test('G-17: 양쪽 배치 완료 시 phase = awaiting_guess + pendingDrawn 세팅', () => {
    const g = createGame();
    placeJoker(g, 'p1', 0);
    const r2 = placeJoker(g, 'p2', 0);
    expect(r2.ok).toBe(true);
    expect(r2.bothPlaced).toBe(true);
    expect(g.phase).toBe('awaiting_guess');
    expect(g.pendingDrawn).not.toBeNull();
  });

  test('G-18: 한쪽만 배치 시 phase 유지 + bothPlaced=false', () => {
    const g = createGame();
    const r = placeJoker(g, 'p1', 0);
    expect(r.ok).toBe(true);
    expect(r.bothPlaced).toBe(false);
    expect(g.phase).toBe('awaiting_joker_placement');
  });

  test('G-19: 이미 배치한 플레이어 재배치 시 에러', () => {
    const g = createGame();
    placeJoker(g, 'p1', 0);
    const r = placeJoker(g, 'p1', 1);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('이미');
  });

  test('G-20: 잘못된 페이즈에서 배치 시 에러', () => {
    const g = createGame();
    placeJoker(g, 'p1', 0);
    placeJoker(g, 'p2', 0);
    // 이제 phase = awaiting_guess
    const r = placeJoker(g, 'p1', 0);
    expect(r.ok).toBe(false);
  });

  test('G-21: insertAfter 범위 밖 (음수 < -1) 에러', () => {
    const g = createGame();
    const r = placeJoker(g, 'p1', -2);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('잘못된 배치 위치');
  });

  test('G-22: insertAfter 범위 밖 (hand.length 이상) 에러', () => {
    const g = createGame();
    const handLen = g.hands.p1.length;
    const r = placeJoker(g, 'p1', handLen); // 정확히 hand.length -> 1 초과
    expect(r.ok).toBe(false);
    expect(r.error).toContain('잘못된 배치 위치');
  });

  test('G-23: insertAfter 비정수 (소수) 에러', () => {
    const g = createGame();
    const r = placeJoker(g, 'p1', 1.5);
    expect(r.ok).toBe(false);
  });

  test('G-24: 배치 후 조커 위치가 sortHand에 의해 변경되지 않음', () => {
    // 여러 번 반복
    for (let trial = 0; trial < 10; trial++) {
      const g = createGame();
      // 맨 앞에 배치
      placeJoker(g, 'p1', -1);
      expect(g.hands.p1[0].isJoker).toBe(true);

      // 상대도 배치 -> 게임 시작 -> 카드 뽑기
      placeJoker(g, 'p2', 0);

      // p1 손패에서 조커가 여전히 0번 위치인지
      expect(g.hands.p1[0].isJoker).toBe(true);
    }
  });
});

// ── 조커 추측 검증 ──────────────────────────────────────────────────

test.describe('조커 추측', () => {
  /** 게임을 조커 배치 완료 후 awaiting_guess 상태로 진행 */
  function setupGame() {
    const g = createGame('p1');
    placeJoker(g, 'p1', 0);
    placeJoker(g, 'p2', 0);
    return g;
  }

  test('G-25: 조커 추측(value=null) 정답 -- 상대 해당 슬롯이 isJoker', () => {
    const g = setupGame();
    // p2 손패에서 조커 위치 찾기
    const jokerSlot = g.hands.p2.findIndex(c => c.isJoker);
    expect(jokerSlot).toBeGreaterThanOrEqual(0);

    const result = guess(g, 'p1', jokerSlot, null);
    expect(result.ok).toBe(true);
    expect(result.correct).toBe(true);
    expect(g.hands.p2[jokerSlot].revealed).toBe(true);
  });

  test('G-26: 조커 추측(value=null) 오답 -- 상대 해당 슬롯이 숫자 카드', () => {
    const g = setupGame();
    // p2 손패에서 숫자 카드 위치 찾기
    const numSlot = g.hands.p2.findIndex(c => !c.isJoker);
    expect(numSlot).toBeGreaterThanOrEqual(0);

    const result = guess(g, 'p1', numSlot, null);
    expect(result.ok).toBe(true);
    expect(result.correct).toBe(false);
  });

  test('G-27: 숫자 추측으로 조커 슬롯 공략 -- 오답', () => {
    const g = setupGame();
    const jokerSlot = g.hands.p2.findIndex(c => c.isJoker);

    // 조커 슬롯에 숫자 5를 추측 -> 오답
    const result = guess(g, 'p1', jokerSlot, 5);
    expect(result.ok).toBe(true);
    expect(result.correct).toBe(false);
  });

  test('G-28: value=null 유효성 검사 통과 (숫자 범위 검사 면제)', () => {
    const g = setupGame();
    // null은 범위 검사에 걸리지 않아야 함
    const result = guess(g, 'p1', 0, null);
    expect(result.ok).toBe(true);
    // correct 여부는 상대 카드에 따라 다름
  });

  test('G-29: 숫자 추측 유효성 검사 (범위 밖 12) 에러', () => {
    const g = setupGame();
    const result = guess(g, 'p1', 0, 12);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('0~11');
  });

  test('G-30: 숫자 추측 유효성 검사 (음수 -1) 에러', () => {
    const g = setupGame();
    const result = guess(g, 'p1', 0, -1);
    expect(result.ok).toBe(false);
  });

  test('G-31: lastGuess에 조커 추측 value=null 기록', () => {
    const g = setupGame();
    guess(g, 'p1', 0, null);
    expect(g.lastGuess.value).toBeNull();
  });
});

// ── 숫자 추측 + 계속/멈춤 + 자기 카드 공개 회귀 테스트 ──────────────

test.describe('기존 기능 회귀 테스트', () => {
  function setupGame() {
    const g = createGame('p1');
    placeJoker(g, 'p1', 0);
    placeJoker(g, 'p2', 0);
    return g;
  }

  test('G-32: 숫자 추측 정답 -> awaiting_continue_decision', () => {
    const g = setupGame();
    // p2 손패에서 숫자 카드 찾기
    const numSlot = g.hands.p2.findIndex(c => !c.isJoker);
    const targetValue = g.hands.p2[numSlot].value;

    const result = guess(g, 'p1', numSlot, targetValue);
    expect(result.ok).toBe(true);
    expect(result.correct).toBe(true);
    expect(g.phase).toBe('awaiting_continue_decision');
  });

  test('G-33: 계속 선택(continue) -> awaiting_guess', () => {
    const g = setupGame();
    const numSlot = g.hands.p2.findIndex(c => !c.isJoker);
    const targetValue = g.hands.p2[numSlot].value;
    guess(g, 'p1', numSlot, targetValue);

    const result = continueDecision(g, 'p1', 'continue');
    expect(result.ok).toBe(true);
    expect(g.phase).toBe('awaiting_guess');
  });

  test('G-34: 멈춤 선택(stop) -> 턴 교대 + awaiting_guess', () => {
    const g = setupGame();
    const numSlot = g.hands.p2.findIndex(c => !c.isJoker);
    const targetValue = g.hands.p2[numSlot].value;
    guess(g, 'p1', numSlot, targetValue);

    const result = continueDecision(g, 'p1', 'stop');
    expect(result.ok).toBe(true);
    expect(g.turn).toBe('p2');
    expect(g.phase).toBe('awaiting_guess');
  });

  test('G-35: 추측 실패 -> 뽑은 카드 공개 + 턴 교대', () => {
    const g = setupGame();
    const numSlot = g.hands.p2.findIndex(c => !c.isJoker);
    const wrongValue = (g.hands.p2[numSlot].value + 1) % 12;

    const pendingBefore = g.pendingDrawn;
    const result = guess(g, 'p1', numSlot, wrongValue);
    expect(result.ok).toBe(true);
    expect(result.correct).toBe(false);
    expect(g.turn).toBe('p2');
  });

  test('G-36: 이미 공개된 카드 추측 시 에러', () => {
    const g = setupGame();
    const numSlot = g.hands.p2.findIndex(c => !c.isJoker);
    const targetValue = g.hands.p2[numSlot].value;
    guess(g, 'p1', numSlot, targetValue);
    continueDecision(g, 'p1', 'continue');

    // 이미 공개된 슬롯 다시 추측
    const r = guess(g, 'p1', numSlot, targetValue);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('이미 공개');
  });

  test('G-37: 잘못된 턴에서 추측 시 에러', () => {
    const g = setupGame();
    // p2가 p1 턴에 추측 시도
    const r = guess(g, 'p2', 0, 0);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('턴');
  });
});

// ── 스냅샷 검증 ────────────────────────────────────────────────────

test.describe('스냅샷 (snapshotForPlayer)', () => {
  test('G-38: 조커 배치 전 yourUnplacedJoker 포함', () => {
    const g = createGame();
    const snap = snapshotForPlayer(g, 'p1');
    expect(snap.yourUnplacedJoker).not.toBeNull();
    expect(snap.yourUnplacedJoker.isJoker).toBe(true);
    expect(['red', 'yellow', 'blue']).toContain(snap.yourUnplacedJoker.color);
  });

  test('G-39: 조커 배치 후 yourUnplacedJoker = null', () => {
    const g = createGame();
    placeJoker(g, 'p1', 0);
    const snap = snapshotForPlayer(g, 'p1');
    expect(snap.yourUnplacedJoker).toBeNull();
  });

  test('G-40: oppHand 미공개 카드의 isJoker는 false로 마스킹', () => {
    const g = createGame();
    placeJoker(g, 'p1', 0);
    placeJoker(g, 'p2', 0);
    const snap = snapshotForPlayer(g, 'p1');
    // 미공개 상대 카드의 isJoker는 false여야 함 (정보 누출 방지)
    const jokerInOpp = snap.oppHand.some(c => c.isJoker);
    expect(jokerInOpp).toBe(false);
  });

  test('G-41: 상대 미공개 카드 value 가림 (null)', () => {
    const g = createGame();
    placeJoker(g, 'p1', 0);
    placeJoker(g, 'p2', 0);
    const snap = snapshotForPlayer(g, 'p1');
    for (const c of snap.oppHand) {
      if (!c.revealed) {
        expect(c.value).toBeNull();
      }
    }
  });

  test('G-42: 자기 카드 value 항상 노출', () => {
    const g = createGame();
    placeJoker(g, 'p1', 0);
    placeJoker(g, 'p2', 0);
    const snap = snapshotForPlayer(g, 'p1');
    for (const c of snap.yourHand) {
      if (!c.isJoker) {
        expect(c.value).not.toBeNull();
        expect(typeof c.value).toBe('number');
      }
    }
  });

  test('G-43: jokerPlaced 필드 포함', () => {
    const g = createGame();
    const snap = snapshotForPlayer(g, 'p1');
    expect(snap.jokerPlaced).toBeDefined();
    expect(snap.jokerPlaced.p1).toBe(false);
    expect(snap.jokerPlaced.p2).toBe(false);
  });

  test('G-44: phase 필드에 awaiting_joker_placement 포함', () => {
    const g = createGame();
    const snap = snapshotForPlayer(g, 'p1');
    expect(snap.phase).toBe('awaiting_joker_placement');
  });

  test('G-45: 공개된 조커 카드의 oppHand 표현 (value=null, revealed=true, isJoker=true)', () => {
    const g = createGame();
    placeJoker(g, 'p1', 0);
    placeJoker(g, 'p2', 0);
    // p1이 p2의 조커를 맞춤
    const jokerSlot = g.hands.p2.findIndex(c => c.isJoker);
    guess(g, 'p1', jokerSlot, null);

    const snap = snapshotForPlayer(g, 'p1');
    const revealedJoker = snap.oppHand[jokerSlot];
    expect(revealedJoker.revealed).toBe(true);
    expect(revealedJoker.isJoker).toBe(true);
    expect(revealedJoker.value).toBeNull();
  });
});

// ── 승리 조건 검증 ──────────────────────────────────────────────────

test.describe('승리 조건', () => {
  test('G-46: 상대 전원 공개 시 승리', () => {
    const g = createGame('p1');
    placeJoker(g, 'p1', 0);
    placeJoker(g, 'p2', 0);

    // p1이 p2의 모든 카드를 맞춤 (순서대로)
    let lastResult;
    for (let i = 0; i < g.hands.p2.length; i++) {
      const card = g.hands.p2[i];
      if (card.revealed) continue;
      const val = card.isJoker ? null : card.value;
      lastResult = guess(g, 'p1', i, val);
      if (lastResult.win) break;
      if (lastResult.correct && g.phase === 'awaiting_continue_decision') {
        continueDecision(g, 'p1', 'continue');
      }
    }
    expect(g.phase).toBe('won');
    expect(g.winner).toBe('p1');
  });
});

// ── 조커 위치 보존 (sortHand 안정성) ────────────────────────────────

test.describe('sortHand 조커 위치 보존', () => {
  test('G-47: 카드 추가 후 조커 위치 불변', () => {
    const g = createGame('p1');
    // p1 조커를 index 2에 배치
    placeJoker(g, 'p1', 1); // insertAfter=1 -> index 2
    expect(g.hands.p1[2].isJoker).toBe(true);

    placeJoker(g, 'p2', 0);

    // p1이 추측 실패하면 뽑은 카드가 손에 추가됨
    // 이때 조커 위치가 유지되는지 확인
    const jokerIdBefore = g.hands.p1[2].id;

    // 일부러 틀린 추측
    const wrongSlot = g.hands.p2.findIndex(c => !c.isJoker && !c.revealed);
    if (wrongSlot >= 0) {
      const wrongVal = (g.hands.p2[wrongSlot].value + 1) % 12;
      guess(g, 'p1', wrongSlot, wrongVal);

      // 손패에서 조커가 여전히 존재하는지
      const jokerInHand = g.hands.p1.find(c => c.id === jokerIdBefore);
      expect(jokerInHand).toBeDefined();
      expect(jokerInHand.isJoker).toBe(true);
    }
  });
});

// ── 엣지케이스 ──────────────────────────────────────────────────────

test.describe('엣지케이스', () => {
  test('G-48: createGame 반복 호출 시 독립 상태', () => {
    const g1 = createGame();
    const g2 = createGame();
    expect(g1.deck).not.toBe(g2.deck);
    expect(g1.hands.p1).not.toBe(g2.hands.p1);
  });

  test('G-49: 조커 배치 전 추측 시도 시 에러', () => {
    const g = createGame();
    const r = guess(g, 'p1', 0, 5);
    expect(r.ok).toBe(false);
  });

  test('G-50: 조커 배치 전 계속/멈춤 시도 시 에러', () => {
    const g = createGame();
    const r = continueDecision(g, 'p1', 'continue');
    expect(r.ok).toBe(false);
  });

  test('G-51: 조커 배치 전 selfReveal 시도 시 에러', () => {
    const g = createGame();
    const r = selfReveal(g, 'p1', 0);
    expect(r.ok).toBe(false);
  });

  test('G-52: 모든 덱 카드 ID가 유니크', () => {
    const g = createGame();
    const allCards = [
      ...g.deck,
      ...g.hands.p1,
      ...g.hands.p2,
      ...(g.unplacedJokers.p1 ? [g.unplacedJokers.p1] : []),
      ...(g.unplacedJokers.p2 ? [g.unplacedJokers.p2] : []),
    ];
    const ids = allCards.map(c => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(39);
  });

  test('G-53: 조커 ID 형식 확인 (r-joker, y-joker, b-joker)', () => {
    const g = createGame();
    const allCards = [
      ...g.deck,
      ...g.hands.p1,
      ...g.hands.p2,
      ...(g.unplacedJokers.p1 ? [g.unplacedJokers.p1] : []),
      ...(g.unplacedJokers.p2 ? [g.unplacedJokers.p2] : []),
    ];
    const jokers = allCards.filter(c => c.isJoker);
    const jokerIds = jokers.map(c => c.id).sort();
    expect(jokerIds).toEqual(['b-joker', 'r-joker', 'y-joker']);
  });
});
