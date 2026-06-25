# UI Layout Review: 윷놀이 N인 확장 (Phase 1-B)

## 검증 대상
- 파일: `yutnori/public/js/ui.js`, `yutnori/public/js/main.js`, `yutnori/public/index.html`, `yutnori/public/css/style.css`
- 스크린샷: `C:/antigravity/ad3-yutnori-3player-wait.png` (2인 대기 화면 — 아래 참고)
- 화면 크기: 1280×720 (스크린샷 실측)

### 스크린샷 상태 정정

제공된 스크린샷은 **3인 대기 화면이 아닌 2인 대기 화면**(P1 혼자 입장, P2 아직 미입장 상태)입니다.
보드 중앙에 "준비" + "AI랑 시작" 버튼이 표시되고 있으며 하단에 "P1 대기 P2 대기" 패널이 보입니다.
실제 3~4인 동시 접속 상태의 스크린샷이 존재하지 않으므로 검수는 **정적 코드 분석 + 2인 대기 화면 스크린샷 병행**으로 진행합니다.

---

## 스타일 가이드 기준 (기존 에셋 기반)

| 항목 | 기준 |
|------|------|
| 팔레트 | `--p1: #c0392b` (단청 빨강) / `--p2: #1a6fad` (전통 청색) / CSS :root 등록 |
| 색상 상수 | `style.css :root` 변수만 사용. HEX 직접 사용 금지 |
| 말 크기 (보드) | 일반 칸 r=13px, 큰 칸(모서리/중앙) r=16px |
| 말 크기 (HOME) | r=10px |
| 선 두께 | strokeStyle `rgba(0,0,0,0.5)`, lineWidth 1.5px |
| 준비 상태 패널 | `#ready-status` — HTML 고정 슬롯 P1/P2 2개 |
| 전체 레이아웃 | 2단 grid: `1fr 320px` (1100px↑), 반응형 280px/세로스택 |

---

## 검증 항목 및 결과

### 검증 A: 좌표 산술 — HOME 영역 N인 오프셋

`ui.js` L379:
```javascript
const HOME_Y_OFFSETS = { p1: -36, p2: -18, p3: 0, p4: 18 };
```

각 플레이어 HOME 말 그리기: `drawPiece(ctx, baseX + k * 16, baseY, 10, ...)`

| 요소 | Y (상대) | r | 상단 | 하단 | 이전 간격 | 판정 |
|------|----------|---|------|------|-----------|------|
| P1 말 묶음 | homeY - 36 | 10 | homeY-46 | homeY-26 | (top) | — |
| P2 말 묶음 | homeY - 18 | 10 | homeY-28 | homeY-8  | -26→-28: 2px | WARN (4px 미만) |
| P3 말 묶음 | homeY + 0  | 10 | homeY-10 | homeY+10 | -8→-10: 2px | WARN |
| P4 말 묶음 | homeY + 18 | 10 | homeY+8  | homeY+28 | +10→+8: -2px → **겹침** | FAIL |

P3 하단(homeY+10) > P4 상단(homeY+8) → **2px 겹침**

**추가: HOME 말 가로 겹침 계산**

`drawPiece(ctx, baseX + k * 16, baseY, r=10, ...)`

- k=0: 우측 경계 = baseX+10
- k=1: 좌측 경계 = baseX+16-10 = baseX+6
- 겹침 = 10 - 6 = **4px 가로 겹침 (전 플레이어 공통)**

결론: 4인 HOME 영역에서 P3-P4 수직 2px 겹침 + 전 플레이어 말 가로 4px 겹침 동시 발생.

---

### 검증 B: 좌표 산술 — 보드 말 오프셋 4방향

`ui.js` L396:
```javascript
const PIECE_OFFSETS = {
  p1: { x: -6, y: -4 }, p2: { x: 6, y: -4 },
  p3: { x: -6, y: 8 },  p4: { x: 6, y: 8 }
};
```

일반 칸 r=13px, 최소 비겹침 거리 = r + r = 26px.

| 쌍 | dx | dy | 거리 | 최소거리 | 겹침 | 판정 |
|----|----|----|------|---------|------|------|
| P1↔P2 | 12 | 0  | 12px | 26px | 14px | FAIL |
| P1↔P3 | 0  | 12 | 12px | 26px | 14px | FAIL |
| P1↔P4 | 12 | 12 | 17px | 26px | 9px  | FAIL |
| P2↔P3 | 12 | 12 | 17px | 26px | 9px  | FAIL |
| P2↔P4 | 0  | 12 | 12px | 26px | 14px | FAIL |
| P3↔P4 | 12 | 0  | 12px | 26px | 14px | FAIL |

4인 동일 칸 상황에서 **모든 말 쌍이 기하학적으로 겹침**. 단, 색상이 다른 플레이어를 구별하는 의도이므로 완전 분리가 아닌 "겹쳐도 색으로 구분" 설계일 수 있음. 그러나 r=13 말이 12px 간격으로 배치되면 각 말의 약 54%가 인접 말에 가려져 **1,2 라벨 판독 불가** 문제 발생.

---

### 검증 C: CSS 색상 상수 미등록

`style.css :root`에 `--p3`, `--p4` 없음. `ui.js`에서 `'#27ae60'`, `'#8e44ad'` 직접 HEX 사용.

기존 P1/P2 패턴:
```css
--p1: #c0392b;  /* style.css :root */
--p2: #1a6fad;
```

신규 P3/P4:
```javascript
p3: '#27ae60',  /* ui.js 하드코딩 — CSS 변수 미등록 */
p4: '#8e44ad',
```

규칙: 색상 상수는 CSS `:root` 변수로 등록해야 함(기존 P1/P2 패턴). **FAIL**

---

### 검증 D: 대기 화면 준비 상태 표시 — N인 미지원

`index.html` L30~31:
```html
<span class="ready-slot">P1 <span id="ready-mark-p1">대기</span></span>
<span class="ready-slot">P2 <span id="ready-mark-p2">대기</span></span>
```

P3/P4 슬롯 없음. `showReadyStatus(p1Ready, p2Ready)` 함수가 2인 고정 파라미터.

스크린샷에서 "P1 대기 P2 대기"만 표시 — 3인 이상 접속 시 P3/P4 준비 상태 미표시. **FAIL**

---

### 검증 E: GOAL 영역 Y-오프셋 범위 검증

`ui.js` L407:
```javascript
const GOAL_Y_OFFSETS = { p1: -8, p2: 8, p3: 22, p4: 36 };
const baseX = goal.x + 60;
```

말 r=8px, 각 행 높이 16px.

| 플레이어 | Y (상대) | 상단 | 하단 | 간격 | 판정 |
|----------|----------|------|------|------|------|
| P1 | goalY-8 | goalY-16 | goalY+0 | (top) | — |
| P2 | goalY+8 | goalY+0  | goalY+16 | 0px → 밀착 | WARN |
| P3 | goalY+22 | goalY+14 | goalY+30 | -2px → **겹침** | FAIL |
| P4 | goalY+36 | goalY+28 | goalY+44 | -2px → **겹침** | FAIL |

P2 하단(goalY+16) > P3 상단(goalY+14) → 2px 겹침.
P3 하단(goalY+30) > P4 상단(goalY+28) → 2px 겹침.

---

### 검증 F: P3/P4 색상 대비 — 기존 P1/P2와의 충돌 위험

| 색상 | HEX | 배경(#e8d5a8 원목) 대비 | 판정 |
|------|-----|----------------------|------|
| P1 빨강 | #c0392b | 충분 (강렬한 원색) | PASS |
| P2 파랑 | #1a6fad | 충분 (한국 전통 청색) | PASS |
| P3 초록 | #27ae60 | 중간 (채도 적당) | PASS |
| P4 보라 | #8e44ad | 중간 (채도 적당) | PASS |

4색 모두 명확히 구별 가능한 원색 계열. P3-P4는 기존 한지·원목 팔레트(`#d4812a`, `#c0392b`)와 무관한 색이나, 말 색상이므로 배경과의 구별이 우선 기준. **색상 선택 자체는 PASS**.

---

### 검증 G: 2인 대기 화면 레이아웃 (스크린샷 직접 확인)

스크린샷 실측:

| 요소 | 위치 | 겹침 여부 | 판정 |
|------|------|-----------|------|
| 헤더 "나 (P1, 빨강)" | 정상 위치 | 없음 | PASS |
| 보드 "준비" 버튼 | 보드 중앙 | 없음 | PASS |
| "또는" 구분선 | 준비 버튼 아래 | 없음 | PASS |
| "AI랑 시작" 버튼 | 구분선 아래 | 없음 | PASS |
| "P1 대기 P2 대기" 패널 | 보드 하단 | 없음 | PASS |
| 우측 패널 "나의 말" | 빨강 4개 dot | 겹침 없음 | PASS |
| 우측 패널 "상대의 말" | 파랑 4개 dot | 겹침 없음 | PASS |
| 폰트 계층 (헤더>패널라벨>본문) | Jua 24px > Jua 12px > Dodum 13px | 정상 | PASS |

---

## 불일치 상세

### FAIL 항목

**[F-1] P3/P4 CSS 색상 변수 미등록** — 기준: CSS `:root`에 `--p3`/`--p4` 변수 등록 필수(P1/P2 패턴). 신규 값: `ui.js` HEX 직접 사용.
수정 방법: `style.css :root`에 `--p3: #27ae60;` `--p4: #8e44ad;` `--p3-light: rgba(39,174,96,0.55);` `--p4-light: rgba(142,68,173,0.55);` 추가. `ui.js` `PLAYER_COLOR` 및 `PLAYER_COLOR_DIM`은 Canvas API가 CSS var()를 직접 참조 불가이므로 현행 HEX 유지가 불가피하나, CSS 변수와 값을 1:1 일치시켜야 함(ui.js 주석에 "style.css :root --p3/--p4와 동기화" 명기).

**[F-2] HOME 영역 P3-P4 수직 2px 겹침** — `HOME_Y_OFFSETS { p3: 0, p4: 18 }`. P3 하단 = homeY+10, P4 상단 = homeY+8. 겹침 2px.
수정 방법: `p4: 18`을 `p4: 22`로 변경(P3 하단 homeY+10, P4 상단 homeY+12, 간격 2px 확보). 또는 `p3: 0, p4: 24`(4px 여백).

**[F-3] HOME 말 가로 4px 겹침** — `baseX + k * 16`, r=10. 겹침 = 2r - 16 = 4px.
수정 방법: 간격을 `k * 20`으로 변경(2r=20, 겹침 0px). 4개 말 총 폭 = 60px. homeCoord 근처 공간 확인 필요.

**[F-4] GOAL 영역 P2-P3, P3-P4 겹침** — `GOAL_Y_OFFSETS { p1: -8, p2: 8, p3: 22, p4: 36 }`. r=8, 간격 14px < 2r=16px.
수정 방법: `p3: 24, p4: 40`으로 변경(P2 하단 goalY+16, P3 상단 goalY+16, 간격 0px → 밀착). 완전 분리: `p3: 26, p4: 42`(간격 2px).

**[F-5] 준비 상태 HTML 구조 N인 미지원** — `index.html` `#ready-status`에 P3/P4 슬롯 없음. `showReadyStatus(p1Ready, p2Ready)` 2인 고정.
수정 방법: 아래 두 가지 선택지 중 하나.
  - (A) HTML에 P3/P4 슬롯 추가 + `showReadyStatus(players)` 배열 파라미터로 변경(현재 2인 하위 호환 필요).
  - (B) 현재 2인 구조 유지 + 3~4인은 상태 메시지(`#status-msg`)로만 표시(임시 해결, 구조 변경 최소).

---

### WARN 항목

**[W-1] 보드 말 4방향 오프셋 기하학적 겹침** — 4인 동일 칸 시 모든 쌍이 기하학적으로 겹침(최대 14px). r=13 기준. 색상 구별 의도이나 "2" 등 업힘 라벨이 인접 말에 가려질 수 있음. 수정 권장: 오프셋 범위를 `±10, ±10`에서 `±14, ±14`로 확대(P1:{x:-14,y:-14}, P2:{x:14,y:-14}, P3:{x:-14,y:14}, P4:{x:14,y:14} — 중심 거리 ≈19.8px, 여전히 r=13 겹침이나 약 9px로 완화). 완전 분리는 캔버스 좌표계 내 칸 크기 대비 어려움.

**[W-2] `renderPieceStatus` 상대 패널 단일 플레이어 표시** — N인에서 "가장 진행도 높은 상대"의 완주 수만 표시. P3/P4 개별 완주 진행도 미표시. 레이아웃 붕괴는 아니나 정보 밀도 부족. 별도 패널 추가 권장(별도 작업으로 분리 가능).

---

## 최종 판정

**REVISE**

FAIL 5건, WARN 2건. 스크린샷에서 2인 대기 화면 기본 레이아웃은 이상 없으나, N인 확장을 위한 신규 코드(`HOME_Y_OFFSETS`, `GOAL_Y_OFFSETS`, `PIECE_OFFSETS`, CSS 변수, HTML 준비 상태)에 정량적 겹침 오류가 다수 존재합니다.

---

## REVISE 수정 지시 (우선순위 순)

| 우선순위 | FAIL | 수정 내용 |
|----------|------|-----------|
| CRITICAL | F-5 | `index.html` `#ready-status`에 P3/P4 슬롯 추가. `ui.js showReadyStatus` 배열 파라미터로 확장. |
| HIGH | F-1 | `style.css :root`에 `--p3: #27ae60;` `--p4: #8e44ad;` `--p3-light`, `--p4-light` 추가. `ui.js` 주석에 동기화 명기. |
| HIGH | F-2 | `HOME_Y_OFFSETS` `p4: 18` → `p4: 24` 변경(P3-P4 간격 4px 확보). |
| HIGH | F-4 | `GOAL_Y_OFFSETS` `p3: 22, p4: 36` → `p3: 26, p4: 42` 변경(P2-P3, P3-P4 각 2px 간격 확보). |
| MEDIUM | F-3 | HOME 말 가로 간격 `k * 16` → `k * 20` 변경(가로 겹침 4px 해소). |

WARN W-1(보드 오프셋 겹침)은 캔버스 좌표 한계로 완전 해소 어려움 — CRITICAL/HIGH 수정 후 재검수 시 재평가.

WARN W-2(상대 패널 N인 정보 밀도)는 별도 Feature로 분리 권장.

---

## 스크린샷 메모

제공 스크린샷 `ad3-yutnori-3player-wait.png`는 실제 3인 대기 상태가 아닌 2인 대기 상태입니다.
REVISE 수정 완료 후 **3인 이상 실제 접속 상태**의 스크린샷을 추가로 촬영하여 재검수를 요청해야 합니다.
특히 보드에서 동일 칸에 3~4인 말이 모인 상황, HOME 4인 동시 대기 상황을 시각적으로 확인해야 합니다.
