/**
 * @fileoverview 베네치아 타이핑 배틀 Canvas 렌더링 — 단어 낙하 애니메이션.
 *
 * Canvas 크기 480x400, requestAnimationFrame 루프.
 * 단어 낙하: y = (elapsed / LIFETIME) * CANVAS_HEIGHT (8초에 화면 전체 통과).
 * 난이도별 색상: 초급=하늘색, 중급=주황색, 고급=빨간색.
 * 현재 입력 접두사 매칭 단어 하이라이트.
 */

// ── 상수 ────────────────────────────────────────────────────────
const CANVAS_W = 480;
const CANVAS_H = 400;
/** 단어 낙하 수명(ms) — game.js WORD_LIFETIME_MS와 동일. */
const WORD_LIFETIME_MS = 8000;

/**
 * CSS 변수를 읽어 Canvas 렌더링 색상으로 사용한다.
 * DOMContentLoaded 이후 호출되므로 :root 변수가 확정된 상태.
 */
function loadColorsFromCSS() {
  const style = getComputedStyle(document.documentElement);
  return {
    easy: style.getPropertyValue('--word-easy').trim() || '#85C1E9',
    medium: style.getPropertyValue('--word-medium').trim() || '#F39C12',
    hard: style.getPropertyValue('--word-hard').trim() || '#E74C3C',
    target: style.getPropertyValue('--word-target').trim() || '#F9E27A',
    targetBg: 'rgba(249, 226, 122, 0.3)',
  };
}

/** 난이도별 색상 — CSS 변수 기반 (초기화 시점에 읽음). */
let COLORS = null;
/** 폰트. */
const FONT = 'bold 18px "Noto Sans KR", "Malgun Gothic", sans-serif';

/**
 * 렌더러 인스턴스를 생성한다.
 * @param {HTMLCanvasElement} canvas
 * @returns {object} 렌더러 컨트롤러
 */
export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;

  // CSS 변수로부터 색상 초기화
  if (!COLORS) {
    COLORS = loadColorsFromCSS();
  }

  /** @type {Array<{ id: string, text: string, difficulty: string, x: number, spawnedAt: number }>} */
  let activeWords = [];
  /** 현재 입력 중인 텍스트 (접두사 매칭용). */
  let currentInput = '';
  /** 레거시 단어의 spawnedAt 위치 계산을 위한 로컬 게임 시작 시각. */
  let gameStartedAt = 0;
  /** 서버가 확정한 누적 낙하 시계와 수신 시점 앵커. */
  let fallClockAnchor = { fallClockMs: 0, localUpdatedAt: Date.now(), fallSpeedMultiplier: 1 };
  /** 현재 타겟 단어 ID. */
  let targetWordId = null;
  /** 애니메이션 프레임 핸들. */
  let rafHandle = null;

  /**
   * 활성 단어 목록을 갱신한다.
   * @param {Array} words
   */
  function setWords(words) {
    activeWords = words || [];
  }

  /**
   * 단어를 추가한다.
   * @param {object} word
   */
  function addWord(word) {
    // 중복 방지
    if (!activeWords.find((w) => w.id === word.id)) {
      activeWords.push(word);
    }
  }

  /**
   * 단어를 제거한다.
   * @param {string} wordId
   */
  function removeWord(wordId) {
    activeWords = activeWords.filter((w) => w.id !== wordId);
  }

  /**
   * 만료된 단어들을 제거한다.
   * @param {string[]} wordIds
   */
  function removeWords(wordIds) {
    const set = new Set(wordIds);
    activeWords = activeWords.filter((w) => !set.has(w.id));
  }

  /**
   * 현재 입력 텍스트를 설정한다 (타겟 하이라이트용).
   * @param {string} text
   */
  function setInput(text) {
    currentInput = text;
    // 접두사 매칭 타겟 결정
    targetWordId = null;
    if (text.length > 0) {
      // 가장 긴 공통 접두사를 가진 단어를 타겟으로
      let bestMatch = null;
      for (const w of activeWords) {
        if (w.text.startsWith(text)) {
          if (!bestMatch || w.text.length < bestMatch.text.length) {
            bestMatch = w;
          }
        }
      }
      if (bestMatch) targetWordId = bestMatch.id;
    }
  }

  /**
   * 게임 시작 시각을 설정한다.
   * @param {number} startedAt
   */
  function setGameStartedAt(startedAt) {
    gameStartedAt = startedAt;
    fallClockAnchor = { fallClockMs: 0, localUpdatedAt: startedAt, fallSpeedMultiplier: 1 };
  }

  /**
   * 서버 권위 누적 낙하 시계 앵커를 갱신한다.
   * @param {{fallClockMs:number, fallSpeedMultiplier:number}} clock 서버 시계 스냅샷
   */
  function setFallClock(clock) {
    if (!clock || !Number.isFinite(clock.fallClockMs)) return;
    fallClockAnchor = {
      fallClockMs: clock.fallClockMs,
      localUpdatedAt: Date.now(),
      fallSpeedMultiplier: Number.isFinite(clock.fallSpeedMultiplier) ? clock.fallSpeedMultiplier : 1,
    };
  }

  /**
   * 현재 타겟 단어를 반환한다.
   * @returns {object|null}
   */
  function getTargetWord() {
    if (!targetWordId) return null;
    return activeWords.find((w) => w.id === targetWordId) || null;
  }

  /**
   * 매 프레임 렌더링.
   */
  function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    const now = Date.now() - gameStartedAt;
    const estimatedFallClock = fallClockAnchor.fallClockMs
      + (Date.now() - fallClockAnchor.localUpdatedAt) * fallClockAnchor.fallSpeedMultiplier;

    for (const word of activeWords) {
      const elapsed = Number.isFinite(word.spawnedAtFallClock)
        ? estimatedFallClock - word.spawnedAtFallClock
        : now - word.spawnedAt;
      const progress = Math.min(elapsed / WORD_LIFETIME_MS, 1.0);
      const x = word.x * (CANVAS_W - 80) + 20; // 좌우 여백 20px
      const y = progress * (CANVAS_H - 30) + 15;

      const isTarget = word.id === targetWordId;
      const color = COLORS[word.difficulty] || COLORS.easy;

      // 소멸 임박 시 투명도 감소 — fillText 이전에 설정
      if (progress > 0.8) {
        const alpha = 1 - (progress - 0.8) / 0.2;
        ctx.globalAlpha = alpha;
      }

      // 타겟 단어: 배경 박스
      if (isTarget) {
        ctx.font = FONT;
        const metrics = ctx.measureText(word.text);
        const boxW = metrics.width + 16;
        const boxH = 28;
        ctx.fillStyle = COLORS.targetBg;
        ctx.fillRect(x - 8, y - 20, boxW, boxH);
        ctx.strokeStyle = COLORS.target;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 8, y - 20, boxW, boxH);
      }

      // 단어 텍스트
      ctx.font = FONT;
      ctx.fillStyle = isTarget ? COLORS.target : color;
      ctx.textBaseline = 'middle';
      ctx.fillText(word.text, x, y - 5);

      // fillText 이후 투명도 복원
      ctx.globalAlpha = 1;
    }

    rafHandle = requestAnimationFrame(draw);
  }

  /**
   * 렌더링 루프를 시작한다.
   */
  function start() {
    if (rafHandle) return;
    draw();
  }

  /**
   * 렌더링 루프를 정지한다.
   */
  function stop() {
    if (rafHandle) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
  }

  /**
   * 캔버스를 초기화한다.
   */
  function clear() {
    activeWords = [];
    currentInput = '';
    targetWordId = null;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  }

  return {
    setWords,
    addWord,
    removeWord,
    removeWords,
    setInput,
    setGameStartedAt,
    setFallClock,
    getTargetWord,
    start,
    stop,
    clear,
  };
}
