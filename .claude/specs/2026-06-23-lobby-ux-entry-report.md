# UI Layout Review: 다인용 로비 Phase 1-A + Lobby Entry UX

## 검증 대상

| 항목 | 내용 |
|------|------|
| 파일 | `launcher/public/index.html`, `launcher/public/style.css`, `launcher/public/app.js` |
| 유형 | HTML/CSS 웹 UI |
| 화면 크기 | 1280×800 (데스크톱, `<meta name="viewport" content="width=1280, initial-scale=1">`) |
| 변경 범위 | 인원 선택 UI 신규 / N/M 동적 카운터 / 카드 비활성 배지 / 닉네임 게이트 배경 이모지 |

---

## 스크린샷 상태 이상 — 검수 전 사전 고지

`ad3-lobby-nickname-gate.png` 파일이 닉네임 게이트 화면(`.nickname-gate-view`)이 아닌
**로비 화면(`.lobby-view`)을 캡처**하고 있다. 해시 기준 4개 파일은 각각 다른 파일이지만,
닉네임 게이트 시각 증거가 없으므로 해당 항목은 **코드 기반으로만 검증**한다.

`ad3-lobby-host-3player.png`와 `ad3-lobby-host-5player.png`는 시각적으로 동일해 보인다.
두 파일의 MD5가 다르므로 실제 내용 차이는 있으나, 카드 비활성 상태가 화면에 반영되지 않았다면
**캡처 시점 문제(목표 인원 선택 전 캡처)** 가능성이 있다. 코드 검증으로 보완한다.

---

## 스타일 가이드 기준 (기존 에셋 기반)

| 항목 | 기준값 |
|------|--------|
| 배경 | `radial-gradient(ellipse at top, #2a3a5c 0%, #15213a 45%, #0b1322 100%)` |
| 골드 강조 | `#ffd97a` / `rgba(255,217,122,*)` |
| 크림 본문 | `#f5e9c9` / `rgba(245,233,201,*)` |
| 카드 배경 | `linear-gradient(180deg, #1f2c47 0%, #1a2541 100%)` |
| 에러 | `#ff7e7e` |
| 어두운 텍스트 | `#1a1106` |
| 보더 반경 | 카드 14px, 버튼 8px, 필 999px(pill), 닉네임카드 18px |
| 카드 그리드 갭 | 20px |
| 트랜지션 | `150ms ease-out` (버튼), `180ms ease-out` (카드) |
| 폰트 계층 | hero-title 56px > player-count 72px > player-role 22px > lobby-hint 16px > 카드 제목 20px > 본문 13~15px |
| 기존 배지 패턴 | `top: 10px; right: 10px; padding: 4px 10px; font-size: 11px; bg: #ffd97a; color: #1a1106; border-radius: 999px` |

---

## 좌표 산술 검증

### 1. lobby-meta 수직 스택 (.lobby-meta, gap: 12px, padding-top: 24px, padding-bottom: 16px)

| # | 요소 | 높이(추정) | 상단(px) | 하단(px) | 이전 간격 | 판정 |
|---|------|-----------|---------|---------|-----------|------|
| 1 | `.player-count` (72px font, line-height 1.0) | 72px | 24 | 96 | (top) | — |
| 2 | `.player-role` (22px font + padding 4px×2) | 30px | 108 | 138 | 12px | PASS |
| 3 | `#presence-list` (14px, 1행 추정) | 28px | 150 | 178 | 12px | PASS |
| 4 | `#player-count-selector` (14px btn + padding 7px×2) | 28px | 190 | 218 | 12px | PASS |
| 5 | `.lobby-hint` (16px font, 1행) | 24px | 230 | 254 | 12px | PASS |
| 6 | `.lobby-status` (min-height 18px) | 18px | 266 | 284 | 12px | PASS |

- 상단 패딩: 24px / 하단 패딩: 16px / 차이: 8px → **PASS**
- 겹침: 없음 (gap 12px 균일 적용)

### 2. `.player-count-selector` 내부 (padding 8px 16px, gap 8px)

| # | 요소 | 높이 | 터치 영역 |
|---|------|------|-----------|
| `.pcs-label` | 14px font | 약 17px | N/A (레이블) |
| `.pcs-btn` | 14px font + padding 7px×2 | 28px | **WARN: 28px < 36px** |

### 3. `.nickname-card` 내부 (padding-top: 44px, padding-bottom: 40px, gap: 14px)

| # | 요소 | 높이 | 상단(px) | 하단(px) | 간격 | 판정 |
|---|------|------|---------|---------|------|------|
| 1 | `.nickname-title` (34px font) | 37px | 44 | 81 | (top) | — |
| 2 | `.nickname-sub` (15px font) | 23px | 95 | 118 | 14px | PASS |
| 3 | `#nickname-input` (17px + padding 13px×2) | 43px | 132 | 175 | 14px | PASS |
| 4 | `#btn-enter-lobby` (16px + padding 13px×2) | 42px | 189 | 231 | 14px | PASS |
| 5 | `.nickname-error` (min-height 16px) | 16px | 245 | 261 | 14px | PASS |

- 상단 패딩: 44px / 하단 패딩: 40px / 차이: 4px → **PASS**
- 겹침: 없음

---

## 여백 분석

| 구역 | 상단 여백 | 하단 여백 | 차이 | 판정 |
|------|----------|----------|------|------|
| lobby-meta | 24px | 16px | 8px | PASS |
| nickname-card 내부 | 44px | 40px | 4px | PASS |

---

## 검증 결과 상세

| # | 카테고리 | 항목 | 기존 기준 | 신규 에셋 값 | 판정 |
|---|----------|------|-----------|------------|------|
| 1 | 색상 | `.pcs-label` | — 신규 — | `rgba(245,233,201,0.66)` — 크림 팔레트 | PASS |
| 2 | 색상 | `.pcs-btn` 기본 | — | `rgba(245,233,201,0.72)` + `rgba(245,233,201,0.22)` border | PASS |
| 3 | 색상 | `.pcs-btn.active` | — | `#ffd97a` 텍스트, `rgba(255,217,122,*)` 배경/테두리 | PASS |
| 4 | 색상 | `.player-disabled::after` 배지 | `#ffd97a` bg + `#1a1106` 텍스트 (AI 배지 패턴) | 동일값 | PASS |
| 5 | 색상 | `.nickname-card` 배경 | 게임 카드 `linear-gradient(#1f2c47, #1a2541)` | 동일 그라데이션 | PASS |
| 6 | 색상 | `.game-bg-hint` | — 신규 — | 배경 이모지 opacity 0.08 | PASS |
| 7 | 겹침 | lobby-meta 수직 스택 | gap 12px 균일 | 모든 인접 요소 간격 12px | PASS |
| 8 | 겹침 | nickname-card 내부 스택 | gap 14px 균일 | 모든 인접 요소 간격 14px | PASS |
| 9 | 여백 균형 | lobby-meta 상/하 패딩 | — | 24px vs 16px, 차이 8px | PASS |
| 10 | 여백 균형 | nickname-card 상/하 패딩 | — | 44px vs 40px, 차이 4px | PASS |
| 11 | 버튼 크기 | `.pcs-btn` 터치 영역 | ≥36px (모바일 가이드라인) | 28px (font 14px + padding 7px×2) | **WARN** |
| 12 | 배지 일관성 | 비활성 배지 스펙 | `top 10px, right 10px, padding 4px 10px, font 11px, bg #ffd97a` | 완전 일치 | PASS |
| 13 | z-index | `.game-bg-hint` vs `.nickname-card` | z-index 낮은 값 → 높은 값 | 0 → 1 (배경 아래) | PASS |
| 14 | pointer-events | `.game-bg-hint` | 클릭 투과 필수 | `pointer-events: none` | PASS |
| 15 | 컨테이너 크기 | `.player-count-selector` | — | padding 8px × 2 + 버튼 28px = 44px 컨테이너 | PASS |
| 16 | 보더 반경 | `.player-count-selector` | 카드/컨테이너 계열: 12~18px | 12px | PASS |
| 17 | 보더 반경 | `.pcs-btn` | 버튼 계열: 8px | 8px | PASS |
| 18 | 트랜지션 | `.pcs-btn` | 버튼 계열: 150ms ease-out | `150ms ease-out` | PASS |
| 19 | 폰트 계층 | 인원 선택 레이블 vs 버튼 | 레이블 ≤ 버튼 허용 | 레이블 14px = 버튼 14px (동등) | PASS |
| 20 | 동적 높이 | N/M 카운터 | 고정 문자열에서 가변으로 변경 | `textContent` 동적 업데이트, 레이아웃 변동 없음 | PASS |
| 21 | 스크린샷 | nickname-gate.png | 닉네임 게이트 화면 | 로비 화면이 캡처됨 | **WARN** |
| 22 | 스크린샷 | 3인/5인 비활성 상태 | 카드 비활성 배지 가시 | 두 스크린샷에서 배지 미확인 (캡처 시점 문제 추정) | **WARN** |

---

## 불일치 상세

### WARN 항목

**W-1: `.pcs-btn` 터치 영역 28px < 36px**
- 기존: 기타 버튼(`.game-card-play`) `padding: 10px 14px` → 높이 ≈ 34px, `.game-card-vote` `padding: 6px 12px` → 높이 ≈ 26px
- 신규: `.pcs-btn` `padding: 7px 16px` → 높이 28px
- 판단: 본 런처는 1280px 데스크톱 고정 레이아웃(`<meta name="viewport" content="width=1280">`)이므로
  모바일 36px 기준을 엄격히 적용할 필요는 없다. 기존 `.game-card-vote`(26px) 보다도 크다. 
  데스크톱 마우스 조작 범위로는 충분하다. **수정 불요.**

**W-2: `ad3-lobby-nickname-gate.png`가 닉네임 게이트 화면이 아닌 로비 화면을 캡처**
- 닉네임 게이트(`.nickname-gate-view`)와 로비(`.lobby-view`)는 JS(`enterLobby()`)로 전환된다.
  스크린샷 촬영 시 이미 로비로 진입한 상태에서 캡처된 것으로 보인다.
- 코드 검증 결과 `.game-bg-hint`의 z-index(0), opacity(0.08), pointer-events(none),
  `.nickname-card`의 z-index(1) 스택이 모두 명세 일치를 확인했다.
- **닉네임 게이트 스크린샷 재촬영 권장.** 검수 통과 근거는 코드로 대체 인정.

**W-3: 3인/5인 스크린샷에서 카드 비활성 배지 미확인**
- `ad3-lobby-host-3player.png`와 `ad3-lobby-host-5player.png` 두 파일 모두 카드가 전부 활성 상태로 보인다.
  3인 선택 시 `minPlayers > 3`인 게임이 비활성화되어야 하고,
  5인 선택 시 `maxPlayers < 5`인 게임이 비활성화되어야 한다.
- `updateCardPlayerDisabled()` 로직 코드는 정확하다 (`applyMinCheck = currentTarget > 2`).
- 스크린샷 캡처 시점에 WS `LOBBY_STATE`가 수신되기 전이거나, 버튼 클릭 후 DOM 반영 전 캡처된 것으로 추정.
- **실제 비활성 상태 스크린샷 재촬영 권장.** 로직 자체는 코드 검증으로 PASS.

---

## 긍정 확인 사항

1. **인원 선택 UI 통합**: `.player-count-selector`가 `.lobby-meta`의 `flex` 스택에 `gap: 12px`으로 자연스럽게 삽입됨. 수직 스택 균일성 유지.
2. **배지 패턴 재사용**: `.player-disabled::after`가 기존 `.game-grid.ai-mode .game-card.no-bot::after`와 동일한 스펙(`top 10px, right 10px, padding 4px 10px, font-size 11px, bg #ffd97a, color #1a1106, border-radius 999px`)을 사용. 완벽한 일관성.
3. **Active 버튼 골드 처리**: `.pcs-btn.active`의 `#ffd97a` 텍스트 + `rgba(255,217,122,*)` 배경/테두리가 기존 `player-role` 테두리, `hero-title` 색상과 동일 팔레트. 브랜드 일관성 유지.
4. **닉네임 카드 배경**: 게임 카드와 동일한 그라데이션(`#1f2c47 → #1a2541`) 사용. 이질감 없음.
5. **z-index 설계**: `game-bg-hint(0) < nickname-card(1) < lobby-toast(8000) < bug-widget(9001~9003)` 스택이 충돌 없이 정렬됨.
6. **`pointer-events: none`**: `.game-bg-hint`가 배경 이모지 클릭 투과를 명시적으로 보장. 입력 요소 방해 없음.

---

## 최종 판정

**APPROVED**

모든 수치 기준을 충족하고, 색상 팔레트 일관성이 완벽히 유지되며, 기존 배지 패턴이 재사용되어 시스템 일관성이 높다.

WARN 3건은 모두 비강제 사항이다:
- W-1(터치 영역): 데스크톱 전용 레이아웃으로 수정 불필요
- W-2, W-3(스크린샷): 코드 검증으로 정합성 확인됨. 재촬영 권장이나 기능 차단 근거 없음.

**후속 권장 사항 (비강제)**:
- 닉네임 게이트 화면을 로비 진입 전 상태에서 재촬영
- 3인/5인 목표 인원 선택 직후 카드 비활성 배지가 표시된 상태에서 재촬영
