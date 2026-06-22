# UI Layout Review: 테트리스 배틀 AI 봇 — 대기 화면 "🤖 AI랑 시작" 버튼

## 검증 대상

- tetris-battle/public/index.html (대기 화면 AI 진입 영역)
- tetris-battle/public/css/style.css (AI 버튼/패널 스타일)
- tetris-battle/public/js/main.js (AI 패널 토글 + `?mode=ai` 재접속)
- 참고 기준: 봇 보유 게임 3종의 공통 AI 버튼 컴포넌트 패턴
  - minigames/omok/public/{index.html,css/style.css,js/main.js}
  - minigames/yahtzee/public/{index.html,css/style.css,js/main.js}
  - minigames/yutnori/public/{index.html,css/style.css,js/main.js}
- visual_change: ui (UI 레이아웃 검수 — AD 모드3)
- 화면 기준: 1280 폭 데스크톱 (Playwright 캡처)

---

## 공통 AI 버튼 컴포넌트 패턴 (omok/yahtzee/yutnori 기준)

| 항목 | 공통 기준값 |
|------|------------|
| 버튼 id | `btn-start-ai` |
| 버튼 class | `btn-start-ai` |
| 래퍼 | `#ai-panel.ai-panel`(미노출 시 `.hidden`) |
| 구분선 | `.ai-divider` — `<span>또는</span>` 좌우 라인 |
| 보조 안내 | `.ai-hint` — "상대 없이 즉시 AI와 1:1 대전" |
| AI 강조색 | CSS 변수로 관리(`--accent-ai` 류) — 하드코딩 금지 |
| UX 패턴 | 메인 진입점(준비/매칭)과 AI 진입점을 "또는"으로 분리 |
| 토글 조건 | 본인(p1) + 대기(waiting) + 현재 모드 ≠ ai 일 때 노출 |
| 동작 | 클릭 시 `?mode=ai` 쿼리로 재접속 |

---

## 1차 검수 → REVISE (FAIL 3 + WARN 4)

| # | 카테고리 | 항목 | 공통 기준 | 테트리스 1차 값 | 판정 |
|---|----------|------|-----------|----------------|------|
| 1 | 네이밍 | 버튼 id/class | `btn-start-ai` | `ai-start-btn` (반전) | FAIL-1 |
| 2 | 구조 | `#ai-panel` 래퍼 | 보유 | 없음 | FAIL-2 |
| 3 | 구조 | `.ai-divider`("또는") | 보유 | 없음 | FAIL-2 |
| 4 | 구조 | `.ai-hint` 안내문 | 보유 | 없음 | FAIL-2 / WARN-2 |
| 5 | 색상 | AI 강조색 | CSS 변수 | `#2ecc71` 하드코딩 | FAIL-3 |
| 6 | 타이포 | letter-spacing | `.primary-btn` 2px | 1px | WARN-1 |
| 7 | 형태 | border-radius | 스튜디오 AI 버튼 10~12px | 4px | WARN-3 |
| 8 | 인터랙션 | hover 방식 | filter:brightness | translateY | WARN-4 |

### FAIL 상세

#### FAIL-1. 버튼 id/class가 공통 네이밍의 반전형

- 현재: id/class `ai-start-btn`
- 공통: 3종(omok/yahtzee/yutnori) 모두 `id="btn-start-ai"` / `class="btn-start-ai"`
- 영향: 공통 컴포넌트 셀렉터/스타일 재사용 불가, 런처 차원의 패턴 정합 깨짐
- 수정: index.html · style.css · main.js 3파일에서 `btn-start-ai`로 통일

#### FAIL-2. AI 진입 영역 래퍼/구분선/안내문 누락

- 현재: 준비 버튼 옆에 단독 AI 버튼만 존재
- 공통: `#ai-panel.ai-panel` 래퍼 + `.ai-divider`(`<span>또는</span>`) + `.ai-hint`("상대 없이 즉시 AI와 1:1 대전")
- 영향: 메인 진입점과 AI 진입점을 "또는"으로 분리하는 공통 UX 패턴 미적용 → 시각적 위계/맥락 부재
- 수정: ready 버튼 아래에 ai-panel 구조 추가, main.js를 ai-panel 토글(p1 + waiting + mode≠ai)로 교체

#### FAIL-3. AI 버튼 배경색 하드코딩

- 현재: `background: #2ecc71;` 하드코딩
- 공통: `--accent-ai` 등 CSS 변수로 관리
- 영향: 테마/색상 일괄 관리 불가, 색상 상수 정책 위반
- 수정: `:root`에 `--accent-ai` 정의 후 `background: var(--accent-ai)` 참조

### WARN 상세

- **WARN-1**: `.primary-btn`은 letter-spacing 2px인데 AI 버튼은 1px. → 2px로 통일 권장.
- **WARN-2**: ai-hint 부재(FAIL-2와 연동, 함께 해소).
- **WARN-3**: border-radius 4px. 스튜디오 AI 버튼은 10~12px이나 **테트리스 네온 테마 4px 허용·비강제**.
- **WARN-4**: hover translateY 방식. 타 게임은 filter:brightness이나 **테트리스 테마 유지·비강제**.

---

## 수정 반영 (Coder)

| 지시 | 적용 내용 | 대상 파일 |
|------|-----------|-----------|
| FAIL-1 | id/class를 `btn-start-ai`로 정합 | index.html · style.css · main.js |
| FAIL-2 | `#ai-panel.ai-panel.hidden` 래퍼 + `.ai-divider`("또는") + `.ai-hint`("상대 없이 즉시 AI와 1:1 대전")를 ready 버튼 아래에 추가, main.js를 ai-panel 토글(p1+waiting+mode≠ai)로 교체 | index.html · main.js |
| FAIL-3 | `:root`에 `--accent-ai: #2ecc71` 추가 + `background: var(--accent-ai)` | style.css |
| WARN-1 | letter-spacing 2px 적용 | style.css |
| WARN-3/4 | 테트리스 네온 테마 유지(비강제 허용) | — |

---

## 2차 재검수 → APPROVED

| # | 항목 | 1차 | 2차 확인 | 판정 |
|---|------|-----|----------|------|
| 1 | 버튼 id/class `btn-start-ai` | FAIL-1 | index.html·style.css·main.js 3파일 정합 확인 | PASS |
| 2 | `#ai-panel` 래퍼 | FAIL-2 | `#ai-panel.ai-panel.hidden` 존재 확인 | PASS |
| 3 | `.ai-divider`("또는") | FAIL-2 | "──── 또는 ────" 구분선 렌더 확인 | PASS |
| 4 | `.ai-hint` 안내문 | FAIL-2 | "상대 없이 즉시 AI와 1:1 대전" 표시 확인 | PASS |
| 5 | AI 강조색 CSS 변수 | FAIL-3 | `--accent-ai` 정의 + `var(--accent-ai)` 참조 확인 | PASS |
| 6 | letter-spacing 2px | WARN-1 | 2px 적용 확인 | PASS |
| 7 | 토글 조건 | — | p1+waiting+mode≠ai 조건 동작 확인 | PASS |
| 8 | 동작 | — | 버튼 클릭 시 `?mode=ai` 재접속 확인 | PASS |

### Playwright 스크린샷 검증 (1280 폭)

- 수직 순서: 준비 버튼 → "──── 또는 ────" 구분선 → 녹색 "🤖 AI랑 시작" 버튼 → 힌트 텍스트
- 요소 겹침 0px (overlap 없음)
- omok 공통 구조와 **구조적 패턴 완전 일치** — 색만 테트리스 네온 테마에 적응(`#2ECC71`, 허용 범위)

### 잔여 WARN (비강제 허용)

- **WARN-3** border-radius 4px: 테트리스 자체 네온 테마 우선 → 비강제 허용.
- **WARN-4** hover translateY: 테트리스 자체 테마 우선 → 비강제 허용.

---

## 최종 판정

**APPROVED**

1차 검수에서 FAIL 3건(네이밍 반전 / ai-panel 구조 누락 / 색상 하드코딩) + WARN 4건으로 REVISE 지시.
Coder가 FAIL-1/2/3 전부 해소(index.html·style.css·main.js 정합, ai-panel 구조 추가, `--accent-ai` 변수화) 및 WARN-1(letter-spacing 2px) 반영.
2차 재검수에서 3종 공통 AI 버튼 컴포넌트 패턴과 구조적 완전 일치 확인(색상만 테트리스 네온 테마 적응, 허용), Playwright 1280폭 스크린샷에서 배치 순서·겹침 0px·`?mode=ai` 동작 검증 완료.
잔여 WARN-3(border-radius 4px) / WARN-4(hover translateY)는 테트리스 자체 네온 테마 우선으로 비강제 허용.

→ AD 모드3 게이트 통과. QA 진행 가능.
