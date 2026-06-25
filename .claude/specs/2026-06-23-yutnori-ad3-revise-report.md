# Implementation Report: Yutnori Phase 1-B AD3 REVISE (5 Findings)

## 작업 요약
AD 모드 3 검수에서 지적된 5건(F-1~F-5)의 CSS 변수 미등록, HOME/GOAL 말 겹침, 준비 상태 N인 미지원을 수정했다.

## 변경된 파일
| 파일 경로 | 작업 유형 | 변경 내용 |
|---|---|---|
| `yutnori/public/css/style.css` | 수정 | F-1: `:root`에 `--p3`, `--p4`, `--p3-light`, `--p4-light` CSS 변수 4개 추가 |
| `yutnori/public/js/ui.js` | 수정 | F-2: `HOME_Y_OFFSETS.p4` 18 -> 24 (수직 4px 간격 확보) |
| `yutnori/public/js/ui.js` | 수정 | F-3: HOME 말 가로 간격 `k * 16` -> `k * 20` (4px 추가 확보) |
| `yutnori/public/js/ui.js` | 수정 | F-4: `GOAL_Y_OFFSETS` p3: 22->26, p4: 36->42 (P2-P3 간 4px, P3-P4 간 4px 확보) |
| `yutnori/public/js/ui.js` | 수정 | F-5: `showReadyStatus` 배열 파라미터 확장 (기존 2인 `(p1Ready, p2Ready)` 하위 호환 유지) |
| `yutnori/public/index.html` | 수정 | F-5: `#ready-status`에 P3/P4 슬롯 DOM 추가 (`#ready-mark-p3`, `#ready-mark-p4`) |

## 스펙 대비 구현 상태
- [x] F-1 (HIGH): P3/P4 CSS 변수 등록 + JS 상수 동기화 확인
- [x] F-2 (HIGH): HOME P3-P4 수직 겹침 해소 (p4: 18 -> 24)
- [x] F-3 (MEDIUM): HOME 말 가로 겹침 해소 (k*16 -> k*20)
- [x] F-4 (HIGH): GOAL P2-P3, P3-P4 겹침 해소 (p3: 22->26, p4: 36->42)
- [x] F-5 (CRITICAL): 준비 상태 HTML N인 지원 + showReadyStatus 배열 파라미터 확장

## 빌드/린트 결과
- 빌드: PASS (바닐라 JS, 별도 빌드 없음)
- 린트: PASS (구문 오류 없음)

## 회귀 테스트 결과
- 서버리스 회귀: **342/342 PASS** (49.5s)
- 포함: yut.unit 104 + ws.scenarios + rulebook-c1~c19 + qa-defect2 + qa-rulefix-edge + redesign-hittest-qa (HT-BUGB 포함)

## Art Director 후속 조치
- visual_change: ui
- AD 모드 2 필요 여부: 아니오 -- 에셋 생성/교체 없음
- AD 모드 3 필요 여부: 예 -- REVISE 수정 결과를 AD3가 재검수해야 함 (HOME/GOAL 말 간격, P3/P4 준비 슬롯 레이아웃)

## 알려진 이슈
- 없음

## QA 참고사항
- `showReadyStatus` 하위 호환: `main.js`의 기존 2인 호출 `showReadyStatus(true, false)` 등은 변경 없이 동작함 (내부에서 배열로 변환)
- P3/P4 슬롯은 DOM에 항상 존재하지만, 현재 서버가 2인(p1/p2)만 운영하므로 P3/P4는 항상 "대기" 표시
- CSS 변수 `--p3`/`--p4`는 현재 Canvas에서 직접 사용하지 않음 (JS `PLAYER_COLOR` 상수와 값 동기화만 확보). 향후 DOM 요소에서 `var(--p3)` 등으로 참조 가능
