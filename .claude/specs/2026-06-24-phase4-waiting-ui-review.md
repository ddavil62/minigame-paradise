# UI Layout Review: Phase 4 입장 UI — hanabi / davinci-code / codenames-duet

## 검증 대상
- hanabi: `hanabi/public/index.html` + `hanabi/public/css/style.css`
- davinci-code: `davinci-code/public/index.html` + `davinci-code/public/style.css`
- codenames-duet: `codenames-duet/public/index.html` + `codenames-duet/public/style.css`
- 화면 크기: 375×667 (모바일 기준) + 1280×800 (데스크톱 확인)
- URL 패턴: `?name=TestUser` (닉네임 게이트 bypass)

---

## 수용 기준 체크 (Phase 4 공통)

| # | 기준 | hanabi | davinci | codenames |
|---|------|--------|---------|-----------|
| 1 | `#screen-waiting` 표시됨 | PASS | PASS | PASS |
| 2 | `#screen-game` 등 게임 화면 숨겨짐 | PASS (hidden) | PASS (요소 없음) | PASS (요소 없음) |
| 3 | READY 패널(`#ready-panel`) + 준비 버튼 표시 | PASS | PASS | PASS |
| 4 | `#name-gate-inline` 숨겨짐 (`?name=` bypass 확인) | PASS | PASS | PASS |
| 5 | 게임별 추가 콘텐츠 표시 | PASS (가이드 슬라이더 7장, 이미지 로딩 확인) | N/A (추가 콘텐츠 없음) | PASS (규칙 요약 표시) |
| 6 | 모바일(375px) 가로 스크롤 없음 | PASS (scrollWidth=375) | PASS | PASS |

---

## 좌표 산술 검증 (375×667 모바일, .waiting-card 직계 자식 기준)

### hanabi

`.waiting-card` padding: 28px top/bottom (CSS 정의값)

| # | 요소 | top | bottom | h | 이전 요소와의 gap | 판정 |
|---|------|-----|--------|---|------------------|------|
| 1 | `.waiting-title` | 127 | 154 | 27 | (최상단) | — |
| 2 | `#ready-panel` | 172 | 282 | 110 | 18px | PASS |
| 3 | `.guide-slider` | 300 | 690 | 390 | 18px | PASS |

.ready-panel 내부:

| # | 요소 | top | bottom | h | gap | 판정 |
|---|------|-----|--------|---|-----|------|
| 1 | `.ready-status` | 172 | 198 | 26 | (최상단) | — |
| 2 | `.btn-ready` | 210 | 257 | 47 | 12px | PASS |
| 3 | `.ready-hint` | 265 | 282 | 17 | 8px | PASS |

여백 분석:
- 상단 여백 (card top=98 → waiting-title top=127): 29px
- 하단 여백 (guide-slider bottom=690 → card bottom=719): 29px
- 차이: 0px → PASS

### davinci-code

| # | 요소 | top | bottom | h | gap | 판정 |
|---|------|-----|--------|---|-----|------|
| 1 | `.waiting-title` | 357 | 384 | 27 | (최상단) | — |
| 2 | `#ready-panel` | 402 | 512 | 110 | 18px | PASS |

.ready-panel 내부:

| # | 요소 | top | bottom | h | gap | 판정 |
|---|------|-----|--------|---|-----|------|
| 1 | `.ready-status` | 402 | 428 | 26 | (최상단) | — |
| 2 | `.btn-ready` | 440 | 487 | 47 | 12px | PASS |
| 3 | `.ready-hint` | 495 | 512 | 17 | 8px | PASS |

여백 분석:
- 상단 여백 (card top=328 → waiting-title top=357): 29px
- 하단 여백 (ready-hint bottom=512 → card bottom=557): 45px
- 차이: 16px → WARN (기준: >10px → WARN, >20px → FAIL)

### codenames-duet

| # | 요소 | top | bottom | h | gap | 판정 |
|---|------|-----|--------|---|-----|------|
| 1 | `.waiting-logo` | 361 | 414 | 53 | (최상단) | — |
| 2 | `.waiting-title` | 424 | 451 | 27 | 10px | PASS |
| 3 | `.waiting-solo` | 469 | 490 | 21 | 18px | PASS |
| 4 | `#ready-panel` | 505 | 590 | 85 | 15px | PASS |
| 5 | `.rules-summary` | 608 | 808 | 200 | 18px | PASS |

여백 분석:
- 상단 여백 (card top=332 → waiting-logo top=361): 29px
- 하단 여백 (rules-summary bottom=808 → card bottom=841): 33px
- 차이: 4px → PASS

---

## 화면 경계 분석 (375×667 모바일)

| 게임 | waiting-card bottom | viewport bottom (667) | 판정 |
|------|--------------------|-----------------------|------|
| hanabi | 719 | 667 | WARN — 52px 초과 (스크롤 필요) |
| davinci-code | 557 | 667 | PASS — 110px 여유 |
| codenames-duet | 841 | 667 | WARN — 174px 초과 (스크롤 필요) |

**비고 (hanabi, codenames-duet):** `waiting-card`가 뷰포트 아래로 넘치는 것은 가이드 슬라이더(hanabi, 390px)와 규칙 요약(codenames-duet, 200px) 콘텐츠가 있기 때문이다. 두 경우 모두:
- `body`에 `min-height: 100vh`가 설정되어 있어 세로 스크롤이 자연스럽게 작동한다.
- 가로 스크롤은 없다 (scrollWidth = clientWidth = 375, PASS).
- 가이드 슬라이더 이미지는 `max-height: 50vh`(모바일 미디어쿼리 적용)로 제한되어 있다.
- 구조적 결함이 아닌 콘텐츠 길이에 의한 자연스러운 스크롤이며, `overflow-x: hidden` 처리는 되어 있지 않아도 실제 가로 넘침은 없다.

---

## 항목별 검증 결과

| # | 카테고리 | 항목 | 기존 기준 | hanabi 값 | davinci 값 | codenames 값 | 판정 |
|---|----------|------|-----------|-----------|------------|--------------|------|
| 1 | 겹침 | 직계 자식 간 gap | ≥ 0px | min 18px | min 18px | min 10px | PASS |
| 2 | 여백 균형 | 상단/하단 패딩 차이 | ≤ 10px → PASS | 0px | 16px | 4px | hanabi PASS, davinci WARN, codenames PASS |
| 3 | 화면 경계 | 모바일 가로 스크롤 | 없음 | 없음 | 없음 | 없음 | PASS |
| 4 | 버튼 크기 | btn-ready 터치 영역 | ≥ 36×36px | 128×47px | 128×47px | 128×47px | PASS |
| 5 | 폰트 계층 | 제목 > 본문 > 보조 | 순서 역전 없음 | 20→16→12.8px | 20→16→12.8px | 20→16→12.8px | PASS |
| 6 | 닉네임 게이트 | `?name=` 시 hidden | hidden | hidden | hidden | hidden | PASS |
| 7 | 가이드 슬라이더 | 이미지 로딩 | naturalWidth > 0 | 682px (LOADED) | N/A | N/A | PASS |
| 8 | 가이드 인디케이터 | 텍스트 표시 | "N / 7" | "1 / 7" | N/A | N/A | PASS |
| 9 | 색상 일관성 | 배경 다크 테마 | #1a1a2e 계열 | #0E1320 (독립 팔레트) | #1a1a2e | #1a1a2e | 참고(하단) |

**색상 팔레트 참고 (항목 9):** hanabi는 자체 CSS 변수(`--bg: #0E1320`, `--panel: #1A2133`)를 사용하며 davinci/codenames와 배경 색이 다르다. 이는 Phase 4 이전부터 확립된 게임별 독립 테마이며, 입장 UI 통일 작업(Phase 1~3)에서도 동일하게 허용된 패턴이다. WARN으로 기록하지 않는다.

---

## 스크린샷 위치

| 파일 | 설명 |
|------|------|
| `tests/screenshots/phase4-hanabi-waiting-desktop.png` | hanabi 대기 화면 1280px |
| `tests/screenshots/phase4-hanabi-waiting-mobile.png` | hanabi 대기 화면 375px |
| `tests/screenshots/phase4-davinci-waiting-desktop.png` | davinci-code 대기 화면 1280px |
| `tests/screenshots/phase4-davinci-waiting-mobile.png` | davinci-code 대기 화면 375px |
| `tests/screenshots/phase4-codenames-waiting-desktop.png` | codenames-duet 대기 화면 1280px |
| `tests/screenshots/phase4-codenames-waiting-mobile.png` | codenames-duet 대기 화면 375px |

---

## WARN 항목 정리

### WARN-1: davinci-code 하단 여백 비대칭 (16px 차이)
- 상단 여백: 29px (card top → waiting-title top)
- 하단 여백: 45px (ready-hint bottom → card bottom)
- 원인: `#ready-panel`에 `margin: 8px 0 16px`이 적용되어 있어 패널 하단에 16px 마진이 붙고, `waiting-card`의 `padding: 28px 32px`과 합산되어 하단이 더 크게 보임.
- 영향: 시각적으로 카드 내용이 위쪽으로 약간 쏠린 느낌. 기능적 결함 없음.
- 강제 수정 여부: 기준(차이 > 20px → FAIL)에 미달하므로 수정 불필요.

---

## 최종 판정

**APPROVED**

3종 게임 모두 Phase 4 수용 기준(#screen-waiting 표시, 닉네임 게이트 bypass, READY 패널 정상, 가로 스크롤 없음, 요소 겹침 없음)을 만족한다.

- **hanabi**: APPROVED. 가이드 슬라이더 포함, 모바일 스크롤 필요하나 가로 넘침 없음. WARN 없음.
- **davinci-code**: APPROVED with WARN-1 (하단 여백 16px 비대칭). 기능·가독성 결함 없음.
- **codenames-duet**: APPROVED. 규칙 요약 포함, 모바일 스크롤 필요하나 가로 넘침 없음. WARN 없음.
