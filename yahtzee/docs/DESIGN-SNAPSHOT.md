# Yahtzee 화면 디자인 스냅샷

> Claude(Artifacts/Designer)에 통째로 붙여넣어 디자인 개선 피드백을 받기 위한 합본 문서.
> 게임 로직 / 네트워크 / 서버 코드는 의도적으로 제외했다. **시각 레이어 6개 파일만** 포함.

## 프로젝트 개요

- **Yahtzee (요트 다이스)** — LAN 1:1 턴 교대, 5다이스 + 13 카테고리 점수표 + 26턴 누적 점수 승부.
- "미니게임 천국" 패키지의 8번째 종목. 단독 실행 외에 통합 런처(`/yahtzee/...`)에서도 동작.
- 외부 이미지 에셋 **0개**. 다이스는 `<canvas>` 2D pip 패턴, 점수표는 HTML 테이블 + CSS 변수.

## 화면 구성

| 화면 | DOM | 설명 |
|---|---|---|
| 대기 화면 | `#screen-waiting` | 초대 URL 패널 + READY 버튼 + AI 진입 버튼 + 룰 요약 카드 |
| 게임 화면 | `#screen-game` | 다이스 5개(Canvas) + 굴리기 버튼 + 점수표(P1 ‖ 카테고리 ‖ P2) |
| 결과 오버레이 | `#screen-game-over` | 승/패/무 + 양쪽 총점 + 카테고리별 breakdown 테이블 + 재대결 |
| 공용 헤더 | `.game-header` | 타이틀 + status-bar(턴 정보) + score-bar(헤더 P1 vs P2 합계) + 로비 복귀 버튼 |
| 토스트 | `#toast` | 하단 중앙 인라인 알림 |

## 현재 디자인 톤

- **다크 테마**. 배경은 검청(`#0E1320`) + 상단에 보랏빛 라디얼 그라데이션.
- **액센트 컬러**: `#E84A5F` (yahtzee 카드 빨강) + `#F8B195` (살구색 보조).
- 패널 카드(`--panel: #1A2133`) + 보조 패널(`--panel-2: #232C42`) + 라인 컬러(`--line: #313B54`)로 계층 표현.
- 다이스 면은 라이트 배경(`#F5F5F5`) + 검정 pip. keep 상태는 빨강 외곽 글로우 + "유지" 뱃지.
- 점수표: 카테고리 좌측 label + 한 줄짜리 룰 힌트(`.cat-rule`). 현재 턴 컬럼은 위→아래 그라데이션으로 강조.
- 결과 오버레이: 빨강 외곽선 + 큰 36px 총점 + breakdown 테이블 스크롤.
- 폰트: 시스템 폰트 스택(`Segoe UI`, `Malgun Gothic`, `Apple SD Gothic Neo`).

## 디자인 개선 의도 (Claude 분석용)

다음 관점에서 피드백을 받고 싶다.

1. **시각 위계**: 게임 화면에서 "다이스 / 굴리기 버튼 / 점수표"의 시선 흐름이 자연스러운지.
2. **점수표 가독성**: 13개 카테고리 + 보너스 3행 + 총점 행이 한 화면에 빽빽한데 스캔이 쉬운지.
3. **다이스 표현**: 단순 Canvas pip + keep 글로우만으로 "굴렸다 / 유지중 / 클릭 가능"의 상태가 충분히 변별되는지.
4. **대기 화면 정보 밀도**: 초대 URL / READY / AI 진입 / 룰 요약이 한 카드에 묶여 있는데 우선순위가 분명한지.
5. **컬러 톤**: 다크 + 빨강 액센트 조합이 "정통 보드게임" 느낌인지 / 더 모던하게 갈 여지가 있는지.
6. **반응형 / 모바일**: 720px 이하에서 다이스 56px, 점수표 13px로 축소만 하고 레이아웃은 그대로. 모바일 별도 고려가 필요한지.

다음 6개 파일은 **원본 그대로 (생략 없음)** 포함한다.

---

## 파일 경로: `public/index.html`

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>요트 다이스 - LAN 1:1</title>
  <link rel="stylesheet" href="css/style.css" />
</head>
<body>
  <header class="game-header">
    <h1>🎲 요트 다이스</h1>
    <div class="status-bar">
      <span id="player-label">접속 중...</span>
      <span class="status-divider">|</span>
      <span id="status-msg">서버 연결 중</span>
      <span class="status-divider">|</span>
      <span>턴: <span id="turn-label">-</span>/26</span>
    </div>
    <div class="score-bar">
      <span class="score-bar-side">
        <span class="score-bar-name" id="hdr-p1-name">P1</span>
        <span class="score-bar-total" id="hdr-p1-total">0</span>
      </span>
      <span class="score-bar-vs">vs</span>
      <span class="score-bar-side">
        <span class="score-bar-total" id="hdr-p2-total">0</span>
        <span class="score-bar-name" id="hdr-p2-name">P2</span>
      </span>
    </div>
    <button id="btn-back-to-lobby" class="btn-back-to-lobby" type="button">← 게임 선택</button>
  </header>

  <!-- 대기 화면 -->
  <section id="screen-waiting" class="screen screen-waiting">
    <div class="waiting-card">
      <div class="waiting-title">상대방을 기다리는 중...</div>
      <div id="invite-panel" class="invite-panel hidden">
        <div class="invite-label">친구에게 이 주소를 알려주세요</div>
        <div class="invite-url-row">
          <code id="invite-url" class="invite-url">http://...</code>
          <button id="copy-url-btn" class="copy-btn" type="button">주소 복사</button>
        </div>
        <div class="invite-hint">친구 PC 브라우저에 붙여넣으면 자동 입장됩니다.</div>
      </div>

      <!-- READY 버튼 -->
      <div id="ready-panel" class="ready-panel hidden">
        <div class="ready-status">
          <span>P1: <span id="p1-ready-mark" class="ready-mark">대기</span></span>
          <span class="ready-divider">/</span>
          <span>P2: <span id="p2-ready-mark" class="ready-mark">대기</span></span>
        </div>
        <button id="ready-btn" class="primary-btn ready-btn" type="button">준비 완료</button>
        <div class="ready-hint">양쪽 모두 준비를 누르면 게임이 시작됩니다.</div>

        <!--
          AI 진입 패널: 사람 1명만 있을 때(p1 단독) 표시.
          상대를 기다리지 않고 즉시 봇과 시작할 수 있는 명시적 진입점.
          클릭 시 ?mode=ai로 새로고침 → server.js가 봇 자식 프로세스 자동 spawn.
        -->
        <div id="ai-panel" class="ai-panel hidden">
          <div class="ai-divider"><span>또는</span></div>
          <button id="btn-start-ai" class="btn-start-ai" type="button">🤖 AI랑 시작</button>
          <div class="ai-hint">상대 없이 즉시 AI와 1:1 대전</div>
        </div>
      </div>

      <!-- 룰 요약 -->
      <div class="rules-summary">
        <h3>요트 다이스 규칙 요약</h3>
        <ul>
          <li>1턴 = <strong>최대 3번 굴림</strong>. 유지할 다이스를 클릭(keep)하고 나머지만 다시 굴림.</li>
          <li>1턴 마무리 시 <strong>13 카테고리 중 1개</strong> 선택해서 점수 기록 (이미 쓴 칸은 사용 불가).</li>
          <li>각자 13턴 = 총 26턴 후 점수 합산.</li>
          <li><strong>상단 합 63 이상 → +35 보너스</strong>.</li>
          <li><strong>야츠 50점 기록 후 추가 야츠 → +100점</strong> 누적.</li>
        </ul>
      </div>
    </div>
  </section>

  <!-- 게임 화면 -->
  <main id="screen-game" class="screen screen-game hidden">
    <!-- 다이스 영역 -->
    <section class="zone zone-dice">
      <div class="zone-title">
        <span>다이스</span>
        <span class="roll-count">굴림 <span id="roll-count">0</span>/3</span>
      </div>
      <div id="dice-area" class="dice-area"></div>
      <div class="action-row">
        <button id="btn-roll" class="primary-btn btn-roll" type="button">주사위 굴리기</button>
        <span id="action-hint" class="action-hint">상대 턴입니다. 잠시 기다려 주세요.</span>
      </div>
    </section>

    <!-- 점수표 (P1 / 카테고리 / P2) -->
    <section class="zone zone-scoreboard">
      <table class="scoreboard">
        <thead>
          <tr>
            <th class="col-p1" id="tbl-p1-name">P1</th>
            <th class="col-cat">카테고리</th>
            <th class="col-p2" id="tbl-p2-name">P2</th>
          </tr>
        </thead>
        <tbody id="scoreboard-body"></tbody>
        <tfoot>
          <tr class="subtotal-row">
            <td class="col-p1" id="p1-upper-sum">0</td>
            <td class="col-cat">상단 합 (보너스 조건: ≥63)</td>
            <td class="col-p2" id="p2-upper-sum">0</td>
          </tr>
          <tr class="subtotal-row">
            <td class="col-p1" id="p1-upper-bonus">0</td>
            <td class="col-cat">상단 보너스 (+35)</td>
            <td class="col-p2" id="p2-upper-bonus">0</td>
          </tr>
          <tr class="subtotal-row">
            <td class="col-p1" id="p1-yahtzee-bonus">0</td>
            <td class="col-cat">추가 야츠 보너스</td>
            <td class="col-p2" id="p2-yahtzee-bonus">0</td>
          </tr>
          <tr class="total-row">
            <td class="col-p1" id="p1-total">0</td>
            <td class="col-cat"><strong>총점</strong></td>
            <td class="col-p2" id="p2-total">0</td>
          </tr>
        </tfoot>
      </table>
    </section>
  </main>

  <!-- 게임 종료 오버레이 -->
  <div id="screen-game-over" class="result-overlay hidden">
    <div class="result-card">
      <div id="result-outcome" class="result-outcome">결과</div>
      <div class="result-scores">
        <div class="result-side">
          <div class="result-name" id="result-p1-name">P1</div>
          <div class="result-total" id="result-p1-total">0</div>
        </div>
        <div class="result-vs">vs</div>
        <div class="result-side">
          <div class="result-name" id="result-p2-name">P2</div>
          <div class="result-total" id="result-p2-total">0</div>
        </div>
      </div>
      <div id="result-breakdown" class="result-breakdown"></div>
      <button id="rematch-btn" class="primary-btn rematch-btn" type="button">재대결</button>
      <button id="btn-return-lobby" class="return-lobby-btn" type="button">← 다른 종목</button>
      <div class="result-hint">상대도 재대결을 누르면 새 게임이 시작됩니다.</div>
    </div>
  </div>

  <!-- 토스트 -->
  <div id="toast" class="toast" role="status" aria-live="polite"></div>

  <script type="module" src="js/main.js"></script>
</body>
</html>
```

---

## 파일 경로: `public/css/style.css`

```css
/**
 * @fileoverview 요트 다이스 클라이언트 스타일.
 *
 * 외부 이미지 에셋 없이 CSS/HTML/Canvas만으로 다이스·점수표를 표현한다(hanabi 패턴).
 * 다이스 5개는 Canvas 2D로 1~6 점 패턴을 그린다.
 * 다크 테마. games.json의 yahtzee color(#E84A5F)를 accent로 사용.
 */

/* ── 색상 변수 ─────────────────────────────────────────────── */
:root {
  --bg:        #0E1320;
  --panel:     #1A2133;
  --panel-2:   #232C42;
  --line:      #313B54;
  --text:      #E8ECF5;
  --text-dim:  #93A0BD;
  --accent:    #E84A5F;          /* yahtzee 카드 색 */
  --accent-2:  #F8B195;
  --good:      #27AE60;
  --warn:      #F1C40F;
  --bad:       #E74C3C;
  --dice-bg:   #F5F5F5;
  --dice-pip:  #1A1A1A;
  --dice-keep: #E84A5F;          /* keep 강조 테두리 */
  --row-hover: rgba(232, 74, 95, 0.08);
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  height: 100%;
}

body {
  background:
    radial-gradient(1200px 600px at 50% -10%, #2a1c2a 0%, transparent 60%),
    var(--bg);
  color: var(--text);
  font-family: 'Segoe UI', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

/* ── 헤더 ───────────────────────────────────────────────────── */
.game-header {
  position: relative;
  padding: 10px 16px 12px;
  background: linear-gradient(90deg, #1f1828, #2a1c30);
  border-bottom: 1px solid var(--line);
  text-align: center;
}
.game-header h1 {
  margin: 0;
  font-size: 22px;
  letter-spacing: 1px;
}
.status-bar {
  margin-top: 6px;
  font-size: 13px;
  color: var(--text-dim);
}
.status-divider { margin: 0 8px; opacity: 0.4; }

.score-bar {
  margin-top: 8px;
  display: inline-flex;
  align-items: center;
  gap: 16px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 6px 20px;
  font-size: 14px;
}
.score-bar-side {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.score-bar-name {
  color: var(--text-dim);
  font-size: 13px;
}
.score-bar-total {
  font-size: 18px;
  font-weight: 700;
  color: var(--accent);
}
.score-bar-vs {
  color: var(--text-dim);
  font-size: 12px;
}

.btn-back-to-lobby {
  position: absolute;
  top: 12px;
  left: 12px;
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
}
.btn-back-to-lobby:hover { background: var(--panel); }

/* ── 화면 전환 ───────────────────────────────────────────────── */
.screen { padding: 16px; }
.hidden { display: none !important; }

/* ── 대기 화면 ──────────────────────────────────────────────── */
.screen-waiting {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding-top: 40px;
}
.waiting-card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 24px;
  max-width: 600px;
  width: 100%;
  text-align: center;
}
.waiting-title {
  font-size: 18px;
  margin-bottom: 16px;
  color: var(--text);
}

.invite-panel {
  background: var(--panel-2);
  border-radius: 8px;
  padding: 14px;
  margin-bottom: 16px;
}
.invite-label {
  font-size: 13px;
  color: var(--text-dim);
  margin-bottom: 8px;
}
.invite-url-row {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
}
.invite-url {
  background: var(--bg);
  border: 1px solid var(--line);
  padding: 6px 10px;
  border-radius: 6px;
  font-family: monospace;
  color: var(--accent-2);
}
.copy-btn {
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 6px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
}
.copy-btn:hover { filter: brightness(1.1); }
.invite-hint {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 8px;
}

.ready-panel {
  margin-top: 16px;
  margin-bottom: 16px;
}
.ready-status {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-bottom: 12px;
  color: var(--text-dim);
}
.ready-mark {
  color: var(--text-dim);
  font-weight: 600;
}
.ready-mark.ready {
  color: var(--good);
}
.ready-divider { color: var(--text-dim); opacity: 0.4; }
.ready-btn {
  padding: 10px 28px;
  font-size: 15px;
}
.ready-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ready-hint {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 8px;
}

/* ── AI 진입 패널 ─────────────────────────────────────────────
   사람 1명 단독 대기 상황에서 "AI랑 시작" 버튼을 명시적으로 노출.
   기본 진입(준비 완료)과 시각적으로 구분하기 위해 액센트-2(연주황)를
   사용하고, 구분선("또는")으로 두 선택지를 분리한다.
*/
.ai-panel {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.ai-panel.hidden { display: none; }
.ai-divider {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 8px;
  color: var(--text-dim);
  font-size: 11px;
  margin: 4px 0 6px;
}
.ai-divider::before,
.ai-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--line, rgba(255, 255, 255, 0.08));
  opacity: 0.5;
}
.btn-start-ai {
  background: var(--accent-2);
  color: #1a1f2e;
  border: none;
  padding: 10px 24px;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  letter-spacing: 0.3px;
  transition: filter 0.1s, transform 0.05s, box-shadow 0.1s;
  box-shadow: 0 1px 4px rgba(248, 177, 149, 0.25);
}
.btn-start-ai:hover:not(:disabled) {
  filter: brightness(1.08);
  box-shadow: 0 2px 8px rgba(248, 177, 149, 0.4);
}
.btn-start-ai:active:not(:disabled) { transform: translateY(1px); }
.btn-start-ai:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ai-hint {
  font-size: 11px;
  color: var(--text-dim);
  margin-top: 2px;
}

.rules-summary {
  text-align: left;
  background: var(--panel-2);
  border-radius: 8px;
  padding: 14px 18px;
  margin-top: 16px;
}
.rules-summary h3 {
  margin: 0 0 8px;
  font-size: 14px;
  color: var(--accent-2);
}
.rules-summary ul {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  color: var(--text-dim);
  line-height: 1.7;
}
.rules-summary strong { color: var(--text); }

/* ── 공용 버튼 ──────────────────────────────────────────────── */
.primary-btn {
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 8px;
  padding: 8px 18px;
  font-size: 14px;
  cursor: pointer;
  font-weight: 600;
  transition: filter 0.1s, transform 0.05s;
}
.primary-btn:hover:not(:disabled) { filter: brightness(1.1); }
.primary-btn:active:not(:disabled) { transform: translateY(1px); }
.primary-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── 게임 화면 ──────────────────────────────────────────────── */
.screen-game {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
  max-width: 1000px;
  margin: 0 auto;
  width: 100%;
}

.zone {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 14px;
}
.zone-title {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 14px;
  color: var(--text-dim);
  margin-bottom: 10px;
  border-bottom: 1px solid var(--line);
  padding-bottom: 6px;
}
.roll-count {
  font-weight: 700;
  color: var(--accent-2);
  font-size: 13px;
}

/* ── 다이스 영역 ────────────────────────────────────────────── */
.dice-area {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin: 12px 0;
  min-height: 80px;
  align-items: center;
}
.die {
  width: 72px;
  height: 72px;
  background: var(--dice-bg);
  border-radius: 12px;
  border: 3px solid transparent;
  position: relative;
  cursor: not-allowed;
  transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.4);
}
.die canvas {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 9px;
}
.die.unrolled {
  background: var(--panel-2);
  border-color: var(--line);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
  font-size: 28px;
  font-weight: 700;
}
.die.unrolled::after {
  content: '?';
}
.die.selectable {
  cursor: pointer;
}
.die.selectable:hover:not(.kept) {
  transform: translateY(-3px);
  box-shadow: 0 6px 14px rgba(232, 74, 95, 0.35);
}
.die.kept {
  border-color: var(--dice-keep);
  box-shadow: 0 0 14px rgba(232, 74, 95, 0.5), 0 4px 8px rgba(0, 0, 0, 0.4);
  transform: translateY(-3px);
}
.die.kept::before {
  content: '유지';
  position: absolute;
  top: -10px;
  right: -6px;
  background: var(--dice-keep);
  color: white;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 999px;
  font-weight: 700;
  letter-spacing: 1px;
}

.action-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-top: 8px;
}
.btn-roll {
  min-width: 160px;
  padding: 10px 20px;
  font-size: 15px;
}
.action-hint {
  font-size: 13px;
  color: var(--text-dim);
}

/* ── 점수표 ────────────────────────────────────────────────── */
.scoreboard {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
.scoreboard thead th {
  padding: 8px;
  background: var(--panel-2);
  font-weight: 700;
  border-bottom: 2px solid var(--line);
  color: var(--accent-2);
}
.scoreboard thead .col-cat {
  color: var(--text-dim);
}
.scoreboard tbody td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--line);
  text-align: center;
}
.scoreboard .col-cat {
  text-align: left;
  color: var(--text);
}
.scoreboard .col-cat .cat-rule {
  display: block;
  font-size: 11px;
  color: var(--text-dim);
  font-weight: 400;
  margin-top: 2px;
}
.scoreboard .col-p1, .scoreboard .col-p2 {
  width: 90px;
  font-weight: 600;
  cursor: default;
  position: relative;
}

/* 미기록 + 본인 + 현재 굴린 다이스로 클릭 가능한 칸 → 미리보기 점수 표시 */
.score-cell.preview {
  color: var(--text-dim);
  font-style: italic;
  cursor: pointer;
  transition: background 0.1s;
}
.score-cell.preview:hover {
  background: var(--row-hover);
  color: var(--accent);
}
.score-cell.preview.preview-zero {
  color: rgba(231, 76, 60, 0.45);
}
.score-cell.preview.preview-zero:hover {
  color: var(--bad);
}
.score-cell.recorded {
  color: var(--text);
  font-weight: 700;
}
.score-cell.empty {
  color: rgba(147, 160, 189, 0.25);
}

/* 카테고리 섹션 구분 (상단/하단) */
.scoreboard .section-divider td {
  background: var(--bg);
  color: var(--text-dim);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  padding: 4px 8px;
  border-bottom: 2px solid var(--accent);
}

.scoreboard tfoot td {
  padding: 6px 8px;
  text-align: center;
}
.scoreboard tfoot .col-cat {
  text-align: left;
  color: var(--text-dim);
  font-size: 13px;
}
.scoreboard tfoot .subtotal-row td {
  border-top: 1px solid var(--line);
  background: rgba(35, 44, 66, 0.5);
}
.scoreboard tfoot .total-row td {
  background: var(--panel-2);
  border-top: 2px solid var(--accent);
  font-size: 18px;
  font-weight: 700;
  padding: 10px 8px;
}
.scoreboard tfoot .total-row .col-p1,
.scoreboard tfoot .total-row .col-p2 {
  color: var(--accent);
}

/* 현재 턴 강조 */
.scoreboard.current-p1 thead .col-p1,
.scoreboard.current-p1 tfoot .col-p1 {
  background: linear-gradient(180deg, rgba(232, 74, 95, 0.18), transparent);
}
.scoreboard.current-p2 thead .col-p2,
.scoreboard.current-p2 tfoot .col-p2 {
  background: linear-gradient(180deg, rgba(232, 74, 95, 0.18), transparent);
}

/* ── 결과 오버레이 ───────────────────────────────────────────── */
.result-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
}
.result-card {
  background: var(--panel);
  border: 2px solid var(--accent);
  border-radius: 16px;
  padding: 28px;
  max-width: 500px;
  width: 90%;
  text-align: center;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
}
.result-outcome {
  font-size: 28px;
  font-weight: 800;
  color: var(--accent);
  margin-bottom: 16px;
}
.result-scores {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 24px;
  margin-bottom: 16px;
}
.result-side {
  flex: 1;
}
.result-name {
  font-size: 13px;
  color: var(--text-dim);
  margin-bottom: 4px;
}
.result-total {
  font-size: 36px;
  font-weight: 800;
  color: var(--text);
}
.result-vs {
  color: var(--text-dim);
  font-size: 14px;
}
.result-side.winner .result-total {
  color: var(--accent);
}
.result-breakdown {
  text-align: left;
  background: var(--panel-2);
  border-radius: 8px;
  padding: 12px;
  margin: 16px 0;
  font-size: 12px;
  color: var(--text-dim);
  max-height: 280px;
  overflow-y: auto;
}
.result-breakdown table {
  width: 100%;
  border-collapse: collapse;
}
.result-breakdown td {
  padding: 3px 6px;
  border-bottom: 1px solid var(--line);
}
.result-breakdown .br-cat { color: var(--text); }
.result-breakdown .br-num { text-align: right; color: var(--accent-2); font-weight: 600; }
.rematch-btn {
  margin-top: 8px;
  padding: 10px 28px;
}
.return-lobby-btn {
  display: block;
  margin: 12px auto 0;
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 18px;
  cursor: pointer;
  font-size: 13px;
}
.return-lobby-btn:hover { background: var(--panel); }
.result-hint {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 12px;
}

/* ── 토스트 ────────────────────────────────────────────────── */
.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%) translateY(20px);
  background: var(--panel-2);
  color: var(--text);
  padding: 10px 18px;
  border-radius: 8px;
  border: 1px solid var(--line);
  font-size: 14px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s, transform 0.2s;
  z-index: 1000;
  max-width: 80%;
}
.toast.show {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
.toast.error {
  background: var(--bad);
  color: white;
}

/* ── 반응형 ───────────────────────────────────────────────── */
@media (max-width: 720px) {
  .die { width: 56px; height: 56px; }
  .die.unrolled { font-size: 22px; }
  .scoreboard { font-size: 13px; }
  .scoreboard .col-p1, .scoreboard .col-p2 { width: 70px; }
  .game-header h1 { font-size: 18px; }
  .score-bar-total { font-size: 16px; }
}
```

---

## 파일 경로: `public/js/dice.js`

```js
/**
 * @fileoverview 다이스 Canvas 렌더링 — 5개 다이스 1~6 점(pip) 패턴 그리기.
 *
 * - 1: 중앙 1개
 * - 2: 좌상단/우하단
 * - 3: 좌상단/중앙/우하단
 * - 4: 4개 모서리
 * - 5: 4개 모서리 + 중앙
 * - 6: 좌측 3개 + 우측 3개 (2x3)
 *
 * 면값 0(아직 안 굴림)은 die 요소 자체가 unrolled 클래스로 '?' 표시되므로 본 모듈은 그리지 않는다.
 */

import { DICE_COUNT } from './game.js';

const PIP_COLOR = '#1A1A1A';
const BG_COLOR  = '#F5F5F5';

/**
 * 1~6 면값별 점 좌표(0~1 비율). [x, y] 비율로 캔버스 크기에 맞춰 곱한다.
 */
const PIP_POSITIONS = {
  1: [[0.5, 0.5]],
  2: [[0.25, 0.25], [0.75, 0.75]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]],
  5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
  6: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.5], [0.75, 0.5], [0.25, 0.75], [0.75, 0.75]],
};

/**
 * 단일 다이스 면을 캔버스에 그린다.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number} face 1~6
 */
function drawDieFace(canvas, face) {
  // 해상도 보정: CSS 크기 × devicePixelRatio.
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(40, Math.round(rect.width * dpr));
  const h = Math.max(40, Math.round(rect.height * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  // 다이스 면 자체는 CSS background가 책임지지만, 캔버스 위에 약간의 양감을 더한다.
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, w, h);

  const pips = PIP_POSITIONS[face] || [];
  const r = Math.max(3, Math.min(w, h) * 0.09);
  ctx.fillStyle = PIP_COLOR;
  for (const [rx, ry] of pips) {
    const px = rx * w;
    const py = ry * h;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * 다이스 컨테이너 1개를 만든다(div + canvas).
 *
 * @returns {{ el: HTMLElement, canvas: HTMLCanvasElement }}
 */
function makeDieElement() {
  const el = document.createElement('div');
  el.className = 'die';
  const canvas = document.createElement('canvas');
  el.appendChild(canvas);
  return { el, canvas };
}

/**
 * 다이스 영역을 렌더한다.
 *
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {number[]} opts.dice 길이 5, 0=아직 안 굴림
 * @param {boolean[]} opts.keep 길이 5, true=유지
 * @param {boolean} opts.selectable 사용자가 keep 토글 가능한지(본인 턴 + rollCount 1~2)
 * @param {(index:number) => void} opts.onToggle keep 토글 콜백
 */
export function renderDice(container, opts) {
  const dice = opts.dice || [0, 0, 0, 0, 0];
  const keep = opts.keep || [false, false, false, false, false];
  const selectable = !!opts.selectable;
  container.innerHTML = '';

  for (let i = 0; i < DICE_COUNT; i++) {
    const { el, canvas } = makeDieElement();
    const face = dice[i];
    if (face >= 1 && face <= 6) {
      // 캔버스에 점 패턴을 그린다.
      // 캔버스가 DOM에 붙어야 getBoundingClientRect가 정확해지므로 우선 append 후 그린다.
      container.appendChild(el);
      // 비동기 layout 후 그리도록 한 프레임 양보(rect width 0 방지).
      requestAnimationFrame(() => drawDieFace(canvas, face));
    } else {
      // 아직 굴리지 않은 상태(rollCount=0): unrolled placeholder.
      el.classList.add('unrolled');
      // canvas는 비워둔다(unrolled CSS의 '?'가 표시).
      el.removeChild(canvas);
      container.appendChild(el);
    }
    if (keep[i]) el.classList.add('kept');
    if (selectable && face >= 1 && face <= 6) {
      el.classList.add('selectable');
      el.addEventListener('click', () => opts.onToggle && opts.onToggle(i));
    }
  }
}
```

---

## 파일 경로: `public/js/scoreboard.js`

```js
/**
 * @fileoverview 점수표 UI — 13 카테고리 표 렌더링 + 카테고리 선택 핸들링.
 *
 * 각 카테고리 행에 P1/P2 칸 표시:
 *   - 이미 점수 기록된 칸 → 점수 숫자 (recorded)
 *   - 비어있고 본인 칸 + 본인 턴 + 1회 이상 굴림 → 미리보기 점수 (preview, 클릭 가능)
 *   - 비어있고 본인 턴이 아니거나 굴리지 않음 → 빈 칸 (empty)
 */

import {
  UPPER_CATEGORIES,
  LOWER_CATEGORIES,
  ALL_CATEGORIES,
  CATEGORY_LABEL,
  CATEGORY_RULE,
  calcCategoryScore,
} from './game.js';

/**
 * 단일 점수 셀(td) 생성.
 *
 * @param {object} opts
 * @param {string} opts.pid 'p1'|'p2'
 * @param {string} opts.category
 * @param {number|null} opts.recorded 기록된 점수(null=미기록)
 * @param {boolean} opts.canPreview 미리보기 점수 표시 가능 여부
 * @param {number} opts.previewScore 미리보기 점수(canPreview일 때만 의미)
 * @param {boolean} opts.canClick 클릭 가능 여부(본인 + 비어있음 + 1회 이상 굴림)
 * @param {(cat:string) => void} opts.onClick
 * @returns {HTMLTableCellElement}
 */
function makeScoreCell(opts) {
  const td = document.createElement('td');
  td.className = 'col-' + opts.pid + ' score-cell';
  td.dataset.category = opts.category;
  td.dataset.pid = opts.pid;

  if (opts.recorded !== null && opts.recorded !== undefined) {
    td.classList.add('recorded');
    td.textContent = String(opts.recorded);
  } else if (opts.canPreview) {
    td.classList.add('preview');
    if (opts.previewScore === 0) td.classList.add('preview-zero');
    td.textContent = String(opts.previewScore);
    if (opts.canClick) {
      td.title = '클릭해서 이 카테고리에 기록 (점수: ' + opts.previewScore + ')';
      td.addEventListener('click', () => opts.onClick && opts.onClick(opts.category));
    }
  } else {
    td.classList.add('empty');
    td.textContent = '·';
  }
  return td;
}

/**
 * 카테고리 행(tr) 생성.
 *
 * @param {string} category
 * @param {object} ctx 렌더 컨텍스트
 * @returns {HTMLTableRowElement}
 */
function makeCategoryRow(category, ctx) {
  const tr = document.createElement('tr');
  tr.dataset.category = category;

  const p1Cell = makeScoreCell({
    pid: 'p1',
    category,
    recorded: ctx.sheets.p1[category],
    canPreview: ctx.myId === 'p1' && ctx.canSelectCategory && ctx.sheets.p1[category] === null,
    previewScore: calcCategoryScore(ctx.dice, category),
    canClick: ctx.myId === 'p1' && ctx.canSelectCategory && ctx.sheets.p1[category] === null,
    onClick: ctx.onCategoryClick,
  });

  const catCell = document.createElement('td');
  catCell.className = 'col-cat';
  const labelDiv = document.createElement('div');
  labelDiv.textContent = CATEGORY_LABEL[category] || category;
  catCell.appendChild(labelDiv);
  const ruleDiv = document.createElement('div');
  ruleDiv.className = 'cat-rule';
  ruleDiv.textContent = CATEGORY_RULE[category] || '';
  catCell.appendChild(ruleDiv);

  const p2Cell = makeScoreCell({
    pid: 'p2',
    category,
    recorded: ctx.sheets.p2[category],
    canPreview: ctx.myId === 'p2' && ctx.canSelectCategory && ctx.sheets.p2[category] === null,
    previewScore: calcCategoryScore(ctx.dice, category),
    canClick: ctx.myId === 'p2' && ctx.canSelectCategory && ctx.sheets.p2[category] === null,
    onClick: ctx.onCategoryClick,
  });

  tr.appendChild(p1Cell);
  tr.appendChild(catCell);
  tr.appendChild(p2Cell);
  return tr;
}

/**
 * 섹션 헤더 행(상단/하단 구분).
 *
 * @param {string} label
 * @returns {HTMLTableRowElement}
 */
function makeSectionRow(label) {
  const tr = document.createElement('tr');
  tr.className = 'section-divider';
  const td = document.createElement('td');
  td.colSpan = 3;
  td.textContent = label;
  tr.appendChild(td);
  return tr;
}

/**
 * 점수표 본문을 렌더한다.
 *
 * @param {HTMLTableSectionElement} tbody
 * @param {object} ctx
 * @param {string|null} ctx.myId 본인 ID('p1'|'p2'|null)
 * @param {string} ctx.currentTurn 현재 턴
 * @param {number} ctx.rollCount 현재 굴림 횟수(0~3)
 * @param {number[]} ctx.dice 현재 다이스
 * @param {{p1:object, p2:object}} ctx.sheets 양쪽 점수표
 * @param {string} ctx.phase 'playing'|'ended'
 * @param {(cat:string) => void} ctx.onCategoryClick
 */
export function renderScoreboard(tbody, ctx) {
  tbody.innerHTML = '';

  // 카테고리 선택 가능 조건: playing + 본인 턴 + rollCount >= 1.
  ctx.canSelectCategory =
    ctx.phase === 'playing' &&
    ctx.myId !== null &&
    ctx.currentTurn === ctx.myId &&
    ctx.rollCount >= 1;

  tbody.appendChild(makeSectionRow('Upper Section (1~6)'));
  for (const cat of UPPER_CATEGORIES) {
    tbody.appendChild(makeCategoryRow(cat, ctx));
  }
  tbody.appendChild(makeSectionRow('Lower Section'));
  for (const cat of LOWER_CATEGORIES) {
    tbody.appendChild(makeCategoryRow(cat, ctx));
  }
}
```

---

## 파일 경로: `public/js/ui.js`

```js
/**
 * @fileoverview HUD + 결과 화면 + 토스트.
 *
 * - 헤더 점수바(P1/P2 총점, 현재 턴 강조)
 * - 점수표 풋(상단합/보너스/야츠보너스/총점)
 * - 종료 오버레이(승/패/무, 카테고리별 breakdown)
 * - 토스트
 */

import { CATEGORY_LABEL, ALL_CATEGORIES } from './game.js';

/**
 * 헤더 점수바 + 턴 번호 + 점수표 풋을 갱신한다.
 *
 * @param {object} els DOM 참조
 * @param {object} state STATE 스냅샷
 * @param {string|null} myId
 */
export function renderHud(els, state, myId) {
  // 헤더 총점 + 이름.
  els.hdrP1Total.textContent = state.totals.p1;
  els.hdrP2Total.textContent = state.totals.p2;
  // 본인 이름에 (나) 표시.
  els.hdrP1Name.textContent = 'P1' + (myId === 'p1' ? ' (나)' : '');
  els.hdrP2Name.textContent = 'P2' + (myId === 'p2' ? ' (나)' : '');
  els.tblP1Name.textContent = 'P1' + (myId === 'p1' ? ' (나)' : '');
  els.tblP2Name.textContent = 'P2' + (myId === 'p2' ? ' (나)' : '');

  // 현재 턴.
  els.turnLabel.textContent = state.turnNumber;
  if (state.phase === 'playing') {
    const turnText = state.currentTurn === myId
      ? '내 턴'
      : (state.currentTurn === 'p1' ? 'P1 턴' : 'P2 턴');
    els.statusMsg.textContent = turnText;
  } else if (state.phase === 'ended') {
    els.statusMsg.textContent = '게임 종료';
  }

  // 점수표 풋: 상단합/보너스/야츠보너스/총점.
  els.p1UpperSum.textContent = state.upper.p1.sum;
  els.p2UpperSum.textContent = state.upper.p2.sum;
  els.p1UpperBonus.textContent = state.upper.p1.bonus;
  els.p2UpperBonus.textContent = state.upper.p2.bonus;
  els.p1YahtzeeBonus.textContent = state.yahtzeeBonus.p1;
  els.p2YahtzeeBonus.textContent = state.yahtzeeBonus.p2;
  els.p1Total.textContent = state.totals.p1;
  els.p2Total.textContent = state.totals.p2;

  // 점수표 컬럼 강조 (현재 턴).
  els.scoreboard.classList.remove('current-p1', 'current-p2');
  if (state.phase === 'playing') {
    els.scoreboard.classList.add('current-' + state.currentTurn);
  }

  // 굴림 횟수.
  els.rollCount.textContent = state.rollCount;
}

/**
 * 굴리기 버튼 + 액션 힌트 갱신.
 *
 * @param {object} els
 * @param {object} state
 * @param {string|null} myId
 */
export function renderActionBar(els, state, myId) {
  const myTurn = state.currentTurn === myId && state.phase === 'playing';
  const canRoll = myTurn && state.rollCount < 3;
  els.btnRoll.disabled = !canRoll;

  if (state.phase === 'ended') {
    els.actionHint.textContent = '게임이 종료되었습니다.';
    els.btnRoll.textContent = '주사위 굴리기';
    return;
  }
  if (!myTurn) {
    els.actionHint.textContent = '상대 턴입니다. 잠시 기다려 주세요.';
    els.btnRoll.textContent = '주사위 굴리기';
    return;
  }
  if (state.rollCount === 0) {
    els.btnRoll.textContent = '주사위 굴리기 (1/3)';
    els.actionHint.textContent = '내 턴: 주사위를 굴려 시작하세요.';
  } else if (state.rollCount < 3) {
    els.btnRoll.textContent = `다시 굴리기 (${state.rollCount + 1}/3)`;
    els.actionHint.textContent = '유지할 다이스를 클릭하고 다시 굴리거나, 점수표에서 카테고리를 선택하세요.';
  } else {
    els.btnRoll.textContent = '굴림 종료 (3/3)';
    els.actionHint.textContent = '굴림이 끝났습니다. 점수표에서 카테고리를 선택하세요.';
  }
}

/**
 * 종료 오버레이를 렌더한다.
 *
 * @param {object} els
 * @param {object} result { winner, p1Total, p2Total, breakdown }
 * @param {string|null} myId
 */
export function renderGameOver(els, result, myId) {
  let outcome;
  if (result.winner === 'draw') {
    outcome = '무승부';
  } else if (result.winner === myId) {
    outcome = '승리!';
  } else if (myId && result.winner) {
    outcome = '패배';
  } else {
    outcome = (result.winner === 'p1' ? 'P1' : 'P2') + ' 승리';
  }
  els.resultOutcome.textContent = outcome;
  els.resultP1Total.textContent = result.p1Total;
  els.resultP2Total.textContent = result.p2Total;
  els.resultP1Name.textContent = 'P1' + (myId === 'p1' ? ' (나)' : '');
  els.resultP2Name.textContent = 'P2' + (myId === 'p2' ? ' (나)' : '');

  // winner 클래스 토글.
  els.resultP1Side.classList.toggle('winner', result.winner === 'p1');
  els.resultP2Side.classList.toggle('winner', result.winner === 'p2');

  // breakdown 테이블.
  const br = result.breakdown || { p1: {}, p2: {} };
  let html = '<table><thead><tr><td></td><td class="br-num">P1</td><td class="br-num">P2</td></tr></thead><tbody>';
  for (const cat of ALL_CATEGORIES) {
    const p1v = (br.p1.sheet && br.p1.sheet[cat] !== null && br.p1.sheet[cat] !== undefined) ? br.p1.sheet[cat] : '-';
    const p2v = (br.p2.sheet && br.p2.sheet[cat] !== null && br.p2.sheet[cat] !== undefined) ? br.p2.sheet[cat] : '-';
    html += `<tr><td class="br-cat">${CATEGORY_LABEL[cat] || cat}</td>`;
    html += `<td class="br-num">${p1v}</td><td class="br-num">${p2v}</td></tr>`;
  }
  html += `<tr><td class="br-cat">상단 합</td><td class="br-num">${br.p1.upperSum || 0}</td><td class="br-num">${br.p2.upperSum || 0}</td></tr>`;
  html += `<tr><td class="br-cat">상단 보너스</td><td class="br-num">${br.p1.upperBonus || 0}</td><td class="br-num">${br.p2.upperBonus || 0}</td></tr>`;
  html += `<tr><td class="br-cat">추가 야츠 보너스</td><td class="br-num">${br.p1.yahtzeeBonus || 0}</td><td class="br-num">${br.p2.yahtzeeBonus || 0}</td></tr>`;
  html += `<tr><td class="br-cat"><strong>총점</strong></td><td class="br-num"><strong>${br.p1.total || result.p1Total}</strong></td><td class="br-num"><strong>${br.p2.total || result.p2Total}</strong></td></tr>`;
  html += '</tbody></table>';
  els.resultBreakdown.innerHTML = html;
}

/**
 * 토스트 표시.
 *
 * @param {HTMLElement} toastEl
 * @param {string} message
 * @param {'info'|'error'} [kind]
 */
let toastTimer = null;
export function showToast(toastEl, message, kind) {
  toastEl.textContent = message;
  toastEl.className = 'toast show' + (kind === 'error' ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, 2400);
}
```

---

## 파일 경로: `public/js/main.js`

```js
/**
 * @fileoverview 요트 다이스 클라이언트 진입점 — 모듈 조율.
 *
 * 흐름:
 *  1) DOM 준비 → Network 연결 → JOIN
 *  2) JOINED(waiting) → 대기 화면 + 초대 URL + READY 버튼 노출
 *  3) READY → 양쪽 READY 시 START → 게임 화면
 *  4) 내 턴: 굴리기 버튼 → DICE_ROLLED → keep 토글 → 다시 굴리기 → ... → 카테고리 선택
 *  5) 상대 턴: 모든 입력 비활성, "상대 턴" 표시
 *  6) GAME_OVER → 종료 오버레이(승/패/무, breakdown) + 재대결 / 다른 종목
 */

import { createNetwork } from './network.js';
import { setState, getState, DICE_COUNT, MAX_ROLLS_PER_TURN } from './game.js';
import { renderDice } from './dice.js';
import { renderScoreboard } from './scoreboard.js';
import { renderHud, renderActionBar, renderGameOver, showToast } from './ui.js';

document.addEventListener('DOMContentLoaded', () => {
  // ── DOM 참조 ────────────────────────────────────────────────
  const els = {
    screenWaiting: document.getElementById('screen-waiting'),
    screenGame: document.getElementById('screen-game'),
    screenGameOver: document.getElementById('screen-game-over'),
    playerLabel: document.getElementById('player-label'),
    statusMsg: document.getElementById('status-msg'),
    turnLabel: document.getElementById('turn-label'),
    hdrP1Name: document.getElementById('hdr-p1-name'),
    hdrP2Name: document.getElementById('hdr-p2-name'),
    hdrP1Total: document.getElementById('hdr-p1-total'),
    hdrP2Total: document.getElementById('hdr-p2-total'),
    tblP1Name: document.getElementById('tbl-p1-name'),
    tblP2Name: document.getElementById('tbl-p2-name'),
    invitePanel: document.getElementById('invite-panel'),
    inviteUrl: document.getElementById('invite-url'),
    copyUrlBtn: document.getElementById('copy-url-btn'),
    readyPanel: document.getElementById('ready-panel'),
    readyBtn: document.getElementById('ready-btn'),
    p1ReadyMark: document.getElementById('p1-ready-mark'),
    p2ReadyMark: document.getElementById('p2-ready-mark'),
    aiPanel: document.getElementById('ai-panel'),
    btnStartAi: document.getElementById('btn-start-ai'),

    diceArea: document.getElementById('dice-area'),
    rollCount: document.getElementById('roll-count'),
    btnRoll: document.getElementById('btn-roll'),
    actionHint: document.getElementById('action-hint'),
    scoreboard: document.querySelector('.scoreboard'),
    scoreboardBody: document.getElementById('scoreboard-body'),
    p1UpperSum: document.getElementById('p1-upper-sum'),
    p2UpperSum: document.getElementById('p2-upper-sum'),
    p1UpperBonus: document.getElementById('p1-upper-bonus'),
    p2UpperBonus: document.getElementById('p2-upper-bonus'),
    p1YahtzeeBonus: document.getElementById('p1-yahtzee-bonus'),
    p2YahtzeeBonus: document.getElementById('p2-yahtzee-bonus'),
    p1Total: document.getElementById('p1-total'),
    p2Total: document.getElementById('p2-total'),

    resultOutcome: document.getElementById('result-outcome'),
    resultP1Name: document.getElementById('result-p1-name'),
    resultP2Name: document.getElementById('result-p2-name'),
    resultP1Total: document.getElementById('result-p1-total'),
    resultP2Total: document.getElementById('result-p2-total'),
    resultP1Side: document.querySelectorAll('.result-side')[0],
    resultP2Side: document.querySelectorAll('.result-side')[1],
    resultBreakdown: document.getElementById('result-breakdown'),
    rematchBtn: document.getElementById('rematch-btn'),
    returnLobbyBtn: document.getElementById('btn-return-lobby'),
    backToLobbyBtn: document.getElementById('btn-back-to-lobby'),

    toast: document.getElementById('toast'),
  };

  // ── 상태 ────────────────────────────────────────────────────
  let myId = null;
  // keep 입력 누적 (다음 ROLL_DICE에 보낼 값). STATE 수신 시 서버 권위로 동기화.
  let pendingKeep = [false, false, false, false, false];

  // ── 화면 전환 ────────────────────────────────────────────────
  function showScreen(name) {
    els.screenWaiting.classList.toggle('hidden', name !== 'waiting');
    els.screenGame.classList.toggle('hidden', name !== 'game');
    if (name !== 'gameover') {
      els.screenGameOver.classList.add('hidden');
    }
  }

  // ── 네트워크 핸들러 ──────────────────────────────────────────
  const net = createNetwork({
    onOpen: () => {
      net.join('Player');
    },
    onJoined: ({ playerId, waiting, hostUrl }) => {
      myId = playerId;
      els.playerLabel.textContent = `${playerId === 'p1' ? 'P1 (호스트)' : 'P2 (게스트)'}`;
      els.statusMsg.textContent = waiting ? '상대방 대기 중' : '준비를 눌러주세요';

      // 초대 URL: 호스트(p1)에게만 의미. 단독 실행 + LAN 환경에서 hostUrl 표시.
      if (playerId === 'p1' && hostUrl) {
        els.inviteUrl.textContent = hostUrl;
        els.invitePanel.classList.remove('hidden');
      } else {
        els.invitePanel.classList.add('hidden');
      }
      // READY 패널 노출.
      els.readyPanel.classList.remove('hidden');
      // AI 진입 버튼: 현재 mode가 ai가 아니고(이미 ai면 봇이 곧 들어오므로 불필요)
      // 호스트(p1) + 단독 대기(waiting=true)일 때만 노출.
      // 게스트(p2)는 이미 누군가 만든 방에 들어온 상황이라 AI 모드 진입 의미 없음.
      const currentMode = new URLSearchParams(location.search).get('mode')
        || sessionStorage.getItem('yahtzee:mode')
        || 'human';
      if (playerId === 'p1' && waiting && currentMode !== 'ai') {
        els.aiPanel.classList.remove('hidden');
      } else {
        els.aiPanel.classList.add('hidden');
      }
      showScreen('waiting');
    },
    onReadyStatus: ({ p1Ready, p2Ready }) => {
      els.p1ReadyMark.textContent = p1Ready ? '✓ 준비' : '대기';
      els.p2ReadyMark.textContent = p2Ready ? '✓ 준비' : '대기';
      els.p1ReadyMark.classList.toggle('ready', p1Ready);
      els.p2ReadyMark.classList.toggle('ready', p2Ready);
    },
    onStart: () => {
      pendingKeep = [false, false, false, false, false];
      showScreen('game');
      els.screenGameOver.classList.add('hidden');
    },
    onDiceRolled: ({ by, dice, rollCount }) => {
      // 다이스가 굴려진 직후: 토스트로 피드백.
      // 본인 굴림: STATE도 곧 따라오므로 별도 처리 불필요. UX 가독성을 위해 토스트는 1회만.
      const who = by === myId ? '내' : (by === 'p1' ? 'P1' : 'P2');
      // STATE의 keep와 동기화하기 위해 본인 keep 입력을 초기화한다(서버 권위).
      // (다음 STATE 수신 시 pendingKeep = state.keep로 다시 맞춘다.)
      console.log(`[dice] ${who} 굴림 ${rollCount}/3: [${dice.join(',')}]`);
    },
    onCategoryScored: ({ by, category, scored, yahtzeeBonusAwarded }) => {
      const who = by === myId ? '나' : (by === 'p1' ? 'P1' : 'P2');
      let msg = `${who} → ${category}: ${scored}점`;
      if (yahtzeeBonusAwarded > 0) {
        msg += ` (+야츠 보너스 ${yahtzeeBonusAwarded})`;
      }
      showToast(els.toast, msg);
    },
    onState: (state) => {
      setState(state);
      // 서버의 keep를 본 클라이언트의 pendingKeep로 동기화.
      pendingKeep = (state.keep || []).slice();
      renderAll();
    },
    onGameOver: (result) => {
      renderGameOver(els, result, myId);
      els.screenGameOver.classList.remove('hidden');
    },
    onOpponentLeft: (message) => {
      showToast(els.toast, message, 'error');
      // 게임 중이면 다시 대기 화면으로.
      showScreen('waiting');
      els.screenGameOver.classList.add('hidden');
      els.statusMsg.textContent = '상대방 대기 중';
      // 새 사람이 와도 READY부터 다시 받아야 하므로 READY 마크 리셋.
      els.p1ReadyMark.textContent = '대기';
      els.p2ReadyMark.textContent = '대기';
      els.p1ReadyMark.classList.remove('ready');
      els.p2ReadyMark.classList.remove('ready');
      els.readyBtn.disabled = false;
      els.readyBtn.textContent = '준비 완료';
      // 상대 이탈 → 다시 단독 대기 상황. 현재 모드가 ai가 아니면 AI 옵션 재노출.
      const currentMode = new URLSearchParams(location.search).get('mode')
        || sessionStorage.getItem('yahtzee:mode')
        || 'human';
      if (myId === 'p1' && currentMode !== 'ai') {
        els.aiPanel.classList.remove('hidden');
        els.btnStartAi.disabled = false;
        els.btnStartAi.textContent = '🤖 AI랑 시작';
      }
    },
    onRematchStatus: ({ p1Ready, p2Ready }) => {
      const status = `재대결 대기: P1 ${p1Ready ? '✓' : '×'} / P2 ${p2Ready ? '✓' : '×'}`;
      showToast(els.toast, status);
    },
    onError: (message) => {
      showToast(els.toast, message, 'error');
    },
  });

  // ── 전체 렌더 ──────────────────────────────────────────────
  function renderAll() {
    const state = getState();
    if (!state) return;

    renderHud(els, state, myId);

    // 다이스: 본인 턴 + 0 < rollCount < MAX 일 때 keep 토글 가능.
    const myTurn = state.currentTurn === myId && state.phase === 'playing';
    const selectable = myTurn && state.rollCount >= 1 && state.rollCount < MAX_ROLLS_PER_TURN;
    const drawDice = () => {
      renderDice(els.diceArea, {
        dice: state.dice,
        keep: pendingKeep,
        selectable,
        onToggle: (i) => {
          pendingKeep[i] = !pendingKeep[i];
          // 다이스만 다시 그리면 충분(점수표 갱신은 불필요).
          drawDice();
        },
      });
    };
    drawDice();

    renderActionBar(els, state, myId);

    renderScoreboard(els.scoreboardBody, {
      myId,
      currentTurn: state.currentTurn,
      rollCount: state.rollCount,
      dice: state.dice,
      sheets: state.sheets,
      phase: state.phase,
      onCategoryClick: (cat) => {
        net.scoreCategory(cat);
      },
    });
  }

  // ── 버튼 이벤트 ──────────────────────────────────────────────
  els.readyBtn.addEventListener('click', () => {
    els.readyBtn.disabled = true;
    els.readyBtn.textContent = '준비 완료 ✓';
    net.sendReady();
  });

  // ── AI랑 시작 ─────────────────────────────────────────────
  // 클릭 시 ?mode=ai 쿼리로 새로고침 → network.js가 sessionStorage에 저장 +
  // WS URL에 mode=ai 부착하여 재접속 → server.js가 봇 자식 프로세스 자동 spawn.
  // (서버 무수정. 기존 mode=ai 진입 경로 그대로 활용.)
  els.btnStartAi.addEventListener('click', () => {
    els.btnStartAi.disabled = true;
    els.btnStartAi.textContent = '🤖 AI 호출 중...';
    // 현재 path는 그대로 두고 쿼리만 mode=ai로 교체.
    // launcher 모드(/yahtzee/...)와 단독 실행(/) 양쪽 모두 작동.
    const url = new URL(location.href);
    url.searchParams.set('mode', 'ai');
    location.href = url.toString();
  });

  els.btnRoll.addEventListener('click', () => {
    const state = getState();
    if (!state) return;
    // 1차 굴림은 keep 무시(서버에서 강제). 2/3차는 pendingKeep 전송.
    net.rollDice(pendingKeep.slice());
  });

  els.copyUrlBtn.addEventListener('click', async () => {
    const url = els.inviteUrl.textContent;
    try {
      await navigator.clipboard.writeText(url);
      showToast(els.toast, '초대 URL 복사 완료');
    } catch (e) {
      // execCommand 폴백.
      const range = document.createRange();
      range.selectNode(els.inviteUrl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      try {
        document.execCommand('copy');
        showToast(els.toast, '초대 URL 복사 완료');
      } catch (e2) {
        showToast(els.toast, '복사 실패 — 수동으로 복사하세요', 'error');
      }
      sel.removeAllRanges();
    }
  });

  els.rematchBtn.addEventListener('click', () => {
    els.rematchBtn.disabled = true;
    els.rematchBtn.textContent = '재대결 대기 중...';
    net.sendRematch();
  });

  // 런처 통합 모드: 다른 종목 / 게임 선택 → 로비로.
  function returnToLobby() {
    // /yahtzee/... 경로면 launcher가 활성. 단독 실행이면 같은 호스트 루트로.
    const seg = location.pathname.split('/').filter(Boolean)[0] || '';
    // launcher가 /lobby/return POST를 처리하면 양쪽 동시 복귀(RETURN_LOBBY broadcast).
    fetch('/lobby/return', { method: 'POST' })
      .catch(() => { /* noop */ })
      .finally(() => {
        // 단독 실행 시에는 POST가 404이므로 즉시 location 이동.
        if (!seg) {
          location.href = '/';
        }
        // launcher 모드면 RETURN_LOBBY broadcast 수신 후 launcher가 redirect 처리(이 페이지는 그냥 location.href 변경하지 않음).
        // 그러나 명시적 안전망: 1.5초 후에도 이동 안 되면 강제 이동.
        setTimeout(() => {
          if (seg) location.href = '/';
        }, 1500);
      });
  }
  els.returnLobbyBtn.addEventListener('click', returnToLobby);
  els.backToLobbyBtn.addEventListener('click', () => {
    if (confirm('정말 로비로 돌아가시겠습니까? 진행 중인 게임은 끝납니다.')) {
      returnToLobby();
    }
  });

  // ── launcher 로비 WS에서 RETURN_LOBBY broadcast 시 자동 redirect ──
  // launcher의 /ws WSS는 본 페이지에서 직접 구독하지 않으므로(게임 WS만 연결),
  // POST /lobby/return 호출 시 자체적으로 redirect는 setTimeout으로 처리한다.

  // ── 시작 ────────────────────────────────────────────────────
  net.connect();
  showScreen('waiting');
});
```

---

## 부가 정보

### 색상 팔레트 (CSS 변수)

| 변수 | 값 | 용도 |
|---|---|---|
| `--bg` | `#0E1320` | 페이지 배경 (검청) |
| `--panel` | `#1A2133` | 1차 카드/패널 배경 |
| `--panel-2` | `#232C42` | 2차 패널, 강조 행, 결과 breakdown |
| `--line` | `#313B54` | 보더/구분선 |
| `--text` | `#E8ECF5` | 본문 텍스트 |
| `--text-dim` | `#93A0BD` | 보조 텍스트, 힌트 |
| `--accent` | `#E84A5F` | 메인 액센트 (총점, primary 버튼, keep 글로우) |
| `--accent-2` | `#F8B195` | 보조 액센트 (룰 제목, 미리보기 점수, AI 버튼) |
| `--good` | `#27AE60` | READY 완료 |
| `--warn` | `#F1C40F` | (예약) |
| `--bad` | `#E74C3C` | 에러 토스트, 0점 미리보기 |
| `--dice-bg` | `#F5F5F5` | 다이스 면 배경 (라이트) |
| `--dice-pip` | `#1A1A1A` | 다이스 점(pip) |
| `--dice-keep` | `#E84A5F` | keep 외곽 + "유지" 뱃지 (= accent) |
| `--row-hover` | `rgba(232, 74, 95, 0.08)` | 점수표 행 hover |

### 외부 의존성

- **없음.** 바닐라 JavaScript + HTML5 Canvas + CSS만 사용. 프레임워크/아이콘 폰트/이미지 에셋 모두 0개.
- 시스템 폰트 스택: `'Segoe UI', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif`.

### 디자인 변경 시 주의사항

- **이 6개 파일만 변경하면 시각 디자인은 전부 바꿀 수 있다.** 로직 파일(`server.js`, `game.js`(루트와 `public/js/game.js` 양쪽), `network.js`, `bot.js`, `tests/*`)은 손대지 말 것.
- `public/js/game.js`는 클라이언트 상태 캐시 + 점수 미리보기 계산용으로 **로직** 파일이다. 본 합본에는 포함하지 않았다. 카테고리 라벨/룰 텍스트(`CATEGORY_LABEL`, `CATEGORY_RULE`)를 바꾸려면 그쪽도 함께 수정 필요.
- DOM ID(`#screen-waiting`, `#dice-area`, `#scoreboard-body`, `#btn-roll` 등)는 `main.js`가 `getElementById`로 잡아 쓰므로 **ID 변경 시 main.js 동기 수정 필수**. 클래스명은 자유롭게 바꿔도 됨 (단, `.die`, `.die.kept`, `.die.unrolled`, `.die.selectable`, `.score-cell.preview/recorded/empty`, `.section-divider`는 JS가 `classList.add/toggle`로 부여하므로 CSS에 반드시 동일 이름이 있어야 함).
- 다이스 pip 색/배경은 `public/js/dice.js`의 `PIP_COLOR`/`BG_COLOR` 상수에 직접 박혀 있다 (CSS 변수 미참조). 다이스 톤을 다크로 바꾸려면 `dice.js` 상수도 같이 수정.
- 게임 핵심 시각 식별자: **빨강 액센트(`#E84A5F`) = 액션/총점/현재 턴**, **살구색(`#F8B195`) = 보조 정보/룰 헤더**. 이 두 색은 다른 미니게임(matgo, janggi 등)과의 시각 구분 포인트라 임의 교체 비추천.
