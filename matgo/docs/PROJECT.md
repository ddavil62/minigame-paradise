# 맞고 (Matgo) — LAN 1:1 대전 기획서

> 최종 업데이트: 2026-06-20

## 프로젝트 개요

같은 LAN에 접속한 두 PC가 브라우저로 즐기는 2인 고스톱(맞고). Node.js + WebSocket 기반의 권위적 서버(룰 100% 서버 판정), 클라이언트는 렌더링·입력 송신만 담당. 한국 고스톱 담요 톤의 UI(2026-05-28부터 v8 시안 적용).

## 기술 스택

| 항목 | 기술 |
|------|------|
| 런타임 | Node.js 18+ |
| 통신 | WebSocket (`ws`) |
| 클라이언트 | 바닐라 JS + HTML + CSS (프레임워크 없음) |
| 테스트 | Playwright (1280×800 Chromium 비주얼 리그레션) |
| 정적 자산 | SVG 화투 48장 (`public/assets/cards-svg/`) + PNG 폴백 (`public/assets/cards/`). **조커 2장**(2026-06-03)은 이미지 없이 CSS 전용 시각화(`.joker-card`) |

## 아키텍처

### 디렉토리 구조

```
matgo/
├── server.js        # WebSocket 서버 + 방 매칭 + heartbeat
├── game.js          # 게임 상태/페이즈/룰 흐름 (권위적)
├── cards.js         # 화투 48장 + 조커 2장 정의 (총 50장) + 셔플
├── score.js         # 점수·고/박/배수 계산
├── bot.js           # 단일 클라이언트 테스트용 봇
├── smoke-test.js    # 비-Playwright 라운드트립 스모크
├── public/
│   ├── index.html   # 3×3 grid DOM (v8 시안 이식)
│   ├── style.css    # 펠트 톤 + 변수 시스템 + 카드/모달/토스트
│   ├── client.js    # WebSocket 라우터·렌더·입력 송신
│   └── assets/
│       ├── cards/       # PNG 폴백
│       └── cards-svg/   # SVG 메인 자산
├── tests/           # Playwright 스펙 (v8-qa.spec.js, v8-visual.spec.js)
└── docs/            # 본 폴더
```

### 핵심 모듈

| 모듈 | 파일 | 역할 |
|---|---|---|
| 서버 | `server.js` | WebSocket 수락, 방(2인) 매칭, heartbeat 30s, 좀비 슬롯 청소 |
| 게임 상태기 | `game.js` | 페이즈 전이(`awaiting_play` / `awaiting_floor_choice` / `awaiting_go_stop` / `awaiting_kkeut_choice` / `awaiting_sangtong`), 룰 검증, STATE 브로드캐스트. `shake_decision` phase는 2026-05-31 제거(클라이언트 모달로 이전) |
| 카드 | `cards.js` | 50장 카드 정의(화투 48 + 조커 2, 2026-06-03) + 셔플 + 손/바닥/덱 분배 |
| 점수 | `score.js` | 광·끗·띠·피 카운트, 고도리/단/박/고 배수, 흔들기 ×2 |
| 봇 | `bot.js` | 자동 입력으로 단일 클라이언트 라운드트립 검증 |
| 클라이언트 | `public/client.js` | STATE 수신 → DOM 갱신, 카드 클릭 → 송신, fly 애니메이션 보간 |

## UI 디자인 (v8 톤)

### 디자인 토큰 (`:root` CSS 변수)

| 카테고리 | 변수 | 값 | 용도 |
|---|---|---|---|
| 배경 | `--bg-deep` | `#061a12` | 페이지 최외곽 |
| 배경 | `--bg-base` | `#0d2a1c` | 본문 베이스 |
| 배경 | `--bg-panel` | `#143828` | 메타 패널·모달 본체 |
| 배경 | `--bg-card` | `#1a4634` | 카드 안쪽 |
| 펠트 | `--felt-mid` | `#1f5238` | 바닥 담요 톤 |
| 펠트 | `--felt-edge` | `#0c2a18` | vignette 가장자리 |
| 골드 | `--gold` | `#d4af37` | 메인 액센트 |
| 골드 | `--gold-soft` | `#f5deb3` | 타이틀 텍스트 |
| 골드 | `--gold-hi` | `#ffd166` | 강조 점수·하이라이트 |
| 적색 | `--red-hot` | `#ff6b6b` | 폭탄·경고 |
| 적색 | `--red-deep` | `#b01818` | 고 버튼 |
| 그린 | `--green-go` | `#74e89c` | 진행 OK 표시 |

### 레이아웃 (1280×800 단일 화면 fit)

`<main class="play-area">`는 3×3 CSS Grid:

- `grid-template-columns: 6.5fr 3.5fr 270px`
- `grid-template-rows: minmax(0,1fr) minmax(0,2fr) minmax(0,1fr)`
- `gap: 8px`, `padding: 8px 12px`

| Row | Col1 (먹은 패) | Col2 (손패) | Col3 (프로필/메타) |
|-----|----|----|----|
| 1 | `opp-captured-zone` | `opp-hand-zone` | `opp-profile-zone` |
| 2 | `floor-zone` (col span 2) | (위 셀이 점유) | `meta-panel` |
| 3 | `my-captured-zone` | `my-hand-zone` | `my-profile-zone` |

하단 고정 `section.action-panel` (50px) — 흔들기/폭탄 패널 호스트. **고/스톱 버튼은 floor 중앙의 `#go-stop-overlay` (132×68 대형 버튼)로 이전**됐다.

### 카드

- 기본 크기 60×85px, `border-radius: 6px`, **회전 없음** (이전 ±5도 임의 회전 제거)
- `.card .month-tag { display: none }` — 월 표시 숨김 (이미지에 이미 포함)
- `.card .dual-badge { display: none }` — 쌍피/끗 dual 배지 숨김
- `.card.hybrid-9` (9월 술잔) — `outline: 1.5px dashed var(--gold-hi)` 점선만 유지
- 손패 hover: `transform: translateY(-6px) + gold glow`

### 손패 컨테이너 (`#opp-hand-cards`, `#my-hand-cards`)

5×2 grid slot (`max-width: 320px`, 가운데 정렬). 빈 슬롯 점 표시 없음.

### 먹은 패 컨테이너 (`opp-captured-zone`, `my-captured-zone`)

내부 2×3 grid (`grid-template-columns: 4fr 6fr 10fr`):
- 좌상단: `.captured-summary` (광/끗/띠/피 카운트 4줄)
- 광·끗·띠·피 4그룹 각각 `.captured-group > .card-stack` (카드를 음수 margin으로 fan 표시)
- 임계 도달 시 `.scored` 클래스 토글 → 골드 글로우

## 바닥 카드 배치 (허니콤 12슬롯)

`client.js`의 `FLOOR_SLOTS` 상수가 덱(중앙) 기준 12개 절대좌표 슬롯을 정의한다.

- 내층 6슬롯: 반경 `R = 150px`, 정육각형 꼭짓점 6개
- 외층 6슬롯: 반경 `2R`, 정육각형 꼭짓점 6개
- `h = R · √3 / 2`로 6각형 세로 보간

`applyFloorSlot(el, idx)` 함수가 `el.style.left/top`을 `calc(50% + dx) / calc(50% + dy)`로 설정. `idx % FLOOR_SLOTS.length`로 모듈러 인덱싱(13장 이상 발생 시 슬롯 재사용, 실제 게임 범위 8~12장이라 항상 1대1).

`renderFloor`는 매 STATE 수신마다 floor-cards를 다시 그리되 `.deck-card` / `.floor-mission` / `#go-stop-overlay` 3개 영구 자식은 보존한다.

## 게임 진입점 (변경 없음)

| 카테고리 | 식별자 | 위치 |
|---|---|---|
| 메시지 핸들러 | `JOINED` / `GAME_START` / `ROUND_START` / `STATE` / `ROUND_END` / `OPPONENT_LEFT` / `ERROR` | `client.js handleMessage` |
| 송신 함수 | `sendPlay` / `sendChooseFloor` / `sendGoStop` / `sendShake` / `sendBomb` / `sendNewRound` / `sendNewGame` / `sendPerPoint` / `sendKkeutChoice` | `client.js` |
| 버튼 ID | `#btn-go` / `#btn-stop` / `#btn-shake` / `#btn-shake-no` / `#btn-bomb` / `#btn-new-round` / `#btn-new-game` / `#btn-new-round-modal` / `#btn-kkeut-choice-kkeut` / `#btn-kkeut-choice-ssangpi` | `index.html` |
| 모달 | `#round-modal` / `#kkeut-modal` / `#toast` | `index.html` |

## 기능 목록

| 기능 | 설명 | 상태 |
|------|------|------|
| LAN 1:1 매칭 | 두 PC가 같은 서버에 접속 시 자동 방 매칭 | 완료 |
| 자동 재접속 | 1→2→4→8초 backoff 재시도 | 완료 |
| Heartbeat | 30초 ping/pong, 좀비 슬롯 자동 청소 | 완료 |
| 기본 룰 | 손패 매칭, 더미 뒤집기, 페어/스윕/뻑/쪽/따닥 | 완료 |
| 특수 룰 | 흔들기(×2), 폭탄, 광박/피박/멍박/고박 | 완료 |
| 사통(대통령) | 같은 월 4장 손패 시 모달 선언 → 즉시 라운드 승 + 7점 | 완료 (2026-05-31) |
| 첫뻑 보너스 | 라운드 첫 뻑 생성자가 승리 시 +7점 base 가산 | 완료 (2026-05-31) |
| 흔들기/폭탄 카드 클릭 시점 모달 | 라운드 시작 일괄 검사 → 카드 낼 때 모달 표시 | 완료 (2026-05-31) |
| 폭탄 후 덱 2장 뒤집기 | `drawAndResolve` 2회 연속, 마지막 턴 멈춤 해소 | 완료 (2026-05-31) |
| floor 카드 위치 고정 | 카드 ID 기반 `floorSlotMap` 캐시, 인덱스 당김 없음 | 완료 (2026-05-31) |
| 9월 술잔 선택 | 끗/쌍피 모달 선택 | 완료 |
| 고/스톱 결정 | 7점 도달 시 floor 중앙 대형 overlay 표시 | 완료 |
| 라운드 결과 모달 | 승자·점수·이동금액·고박 사유 표시 | 완료 |
| 점당 설정 | 메타 패널 input으로 변경 (기본 100원) | 완료 |
| v8 UI 테마 | 한국 고스톱 담요 톤 + 3×3 grid + 허니콤 바닥 | 완료 (2026-05-28) |
| fly 애니메이션 | 손패 → 바닥/captured 흡수 보간 | 완료 |
| 모바일/반응형 | 의도적 미지원 (1280×800 단일 화면 fit 정책) | 미지원 |

## 알려진 제약사항

- **단일 해상도 정책**: 1280×800 데스크톱 Chromium 외 뷰포트는 미지원. `@media` 쿼리 없음.
- **단일 클라이언트 매칭 한계**: 1명만 접속 시 "방이 가득 찼다" 토스트가 정적 캡처에 잡힐 수 있으나 production 시각에는 영향 없음.
- **고박 단순화**: "고 부른 측이 결국 패배 시 점수 ×2"로만 처리. 첫쪽 가산은 미적용 (첫뻑 +7만 적용 — 2026-05-31).
- **사통 점수**: 7점 고정 (multiplier 없는 base 가산, 사용자 피드백으로 조정 가능).
- **흔들기 모달 1회 제한**: `g.shakeAsked`로 라운드당 1회만 노출.
- **e2e 회귀 미실행**: 2026-05-31 룰 보강 후 Playwright nested `node_modules` 충돌로 104개 테스트 자동 회귀 미실행 (별도 인프라 이슈). 기존 `E-13/E-15/E-16` shake_decision 의존 케이스는 후속 수정 필요.
- **`bot.js`**: 개발/테스트 전용. 실제 매치메이킹에 봇이 들어가지 않음.

## 향후 계획

- 라이브 2인 매칭 상태에서 ROUND_END / 9월 술잔 모달 / fly 애니메이션을 실제로 트리거한 시각 캡처 추가 (현재 QA가 정적 분석으로 보완 중)
- 카드 hover/클릭 사운드 추가 (현재 무음)
- 라운드 누적 통계 (라운드 수·평균 점수·박 발생률) 표시
- 모바일 폼팩터 대응 (정책 변경 시)

## 변경 이력

상세 변경 이력은 `CHANGELOG.md` 참조.

| 날짜 | 변경 |
|---|---|
| 2026-06-20 | 조커 손패 fly 중복 재생 가드 — 손에서 조커를 낸 케이스 A(`joker_play`)에서 captured fly가 2~3회 재생되던 버그(서버 STATE 2~3회 송신 + 클릭 핸들러 선등록 fly에 키 미기록)를 `client.js` 이중 가드(`lastJokerFlyActionKey` 액션 키 + `pendingFlies` 중복 검사)로 라운드당 1회만 등록. 서버(`game.js`/`server.js`) 무수정. 회귀 게이트 e2e E-32에 "origin='hand' 조커 fly 정확히 1개" 단언 추가. 단위 100 + e2e 32 + adhoc(joker 24/sseul 11/bombdup 7/floor-joker 5) = 179건 PASS |
| 2026-06-17 | 신규 버그 4건 수정 — R5(바닥 2장 먹기 손패 fly 누락: B1이 남긴 손 fly 미등록을 `client.js` `_choiceSrcFlyId` 수집 + `renderMyHand` 후 `startFlyFromHand` + `flyTargetIds`로 해소) / R6(선택 시 fly 순서: 손 fly를 덱 fly보다 먼저 등록, HAND_THROW→DECK 정합) / R7(자뻑 풀이 2피 **룰 변경**: 자뻑만 상대 피 2장·타인 뻑 1장, `game.js` `isPpeokOwner` 헬퍼 + stealPi 3지점 `delete ppeokFlags` 이전 판정, `score.js` 무수정) / R8(조커 사용 후 사라짐: `joker_play` 손 fly 등록 + **`renderCaptured`가 조커를 pi 그룹에 합류**(joker 키 부재로 드롭→fade되던 선존 결함) + 피 카운트 조커 +2). 단위 100·e2e 32(E-31/E-32 신규) 포함 검증 183건 전부 PASS |
| 2026-06-03 | 조커 2장 룰 추가 — 덱 50장(화투 48 + `m00_joker_a/b`), 케이스 A(손 조커 → 매치 스킵 + 상대 피 1 + 더미 1장 손 보충 + **턴 유지** ※2026-06-16 룰 변경) / 케이스 B(더미 뒤집은 게 조커 → 상대 피 1 + 손에 추가 + 재귀 뒤집기). `piCount += joker × 2`. JOKER-001~009 회귀 9건 |
| 2026-06-03 | 쓸 룰 추가 — 바닥 같은 월 2장 + 손 1 + 더미 1 = 4장 + 상대 피 1장. `lastAction.kind=sseul` 신규, `sweep_from_flip` 토스트 "쓸!" → "뻑 풀이!"로 정정 |
| 2026-06-02 | 폭탄 룰 표준화 — `bombDeckCredit` 보너스 뒤집기 권리(+2) 모델로 정정. "기회 보존의 법칙"으로 양쪽 잔여 동기 |
| 2026-05-31 | 룰 보강 5건 — 사통/흔들기·폭탄 카드 클릭 시점/첫뻑 +7/폭탄 후 덱 2턴/floor 위치 고정. `shake_decision` phase 제거, `awaiting_sangtong` phase 신설 |
| 2026-05-28 | v8 UI 시안 이식 — 한국 고스톱 담요 톤, 3×3 grid, 허니콤 바닥 배치, 고/스톱 floor overlay |
