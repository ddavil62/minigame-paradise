# 맞고 (Matgo) — LAN 1:1 대전 기획서

> 최종 업데이트: 2026-07-30

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
├── match-log.js     # 비차단 매치 JSONL 기록·회전·보존
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
| 서버 | `server.js` | WebSocket 수락, 2인 매칭, heartbeat, 게임 세대별 단계 runner·timer 격리, 상태·입력 로그 연결 |
| 게임 상태기 | `game.js` | 페이즈 전이, 룰 검증, 카드 출처·소유권 타임라인, 선택·후속 처리용 임시 원자 정산 |
| 카드 | `cards.js` | 50장 카드 정의(화투 48 + 조커 2, 2026-06-03) + 셔플 + 손/바닥/덱 분배 |
| 점수 | `score.js` | 일반 광·끗·띠·피·고·박 배수와 일반 배수를 제외한 사통 7점 독립 정산 |
| 매치 로그 | `match-log.js` | 매치·라운드·입력·상태·정산·오류 JSONL 기록, 회전·보존·민감정보 최소화 |
| 봇 | `bot.js` | 자동 입력으로 단일 클라이언트 라운드트립 검증 |
| 클라이언트 | `public/client.js` | STATE 렌더·입력 송신, 소유권 기반 fly, 단일 batch 중복 방지와 최종 fly 뒤 효과 토스트, choice srcCard fly 중복 방지 가드 |
| 효과음 엔진 | `public/audio-engine.js` | 첫 사용자 제스처 뒤 Web Audio 절차형 효과음을 합성하고 중복·동시 발음·수명주기를 제한 |

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
| 기본 룰 | 손패 매칭, 더미 뒤집기, 페어/스윕/뻑/쪽/따닥과 정확한 쓸 판정 | 완료 |
| 특수 룰 | 흔들기(×2), 폭탄, 광박/피박/멍박/고박. 멍박은 승자 끗 7장 이상 기준 | 완료 |
| 조커 | 손 조커는 턴 유지, 덱 조커는 captured 이동·피 강탈·추가 뒤집기 | 완료 |
| 사통(대통령) | 같은 월 4장 선언 시 일반 고·박·흔들기 배수 없이 7점×1로 독립 정산 | 완료 |
| 첫뻑 보너스 | 라운드 첫 뻑 생성자가 승리 시 +7점 base 가산 | 완료 (2026-05-31) |
| 흔들기/폭탄 카드 클릭 시점 모달 | 라운드 시작 일괄 검사 → 카드 낼 때 모달 표시 | 완료 (2026-05-31) |
| 폭탄 후 추가 2장 뒤집기 | 손패 3장 소비에 따른 권리 2회를 누적하고, 손패가 없어도 GO 뒤 더미 입력으로 1회씩 사용 | 완료 |
| floor 카드 위치 고정 | 카드 ID 기반 `floorSlotMap` 캐시, 인덱스 당김 없음 | 완료 (2026-05-31) |
| 9월 술잔 선택 | 끗/쌍피 모달 선택 | 완료 |
| 고/스톱 결정 | 7점 도달 시 floor 중앙 대형 overlay 표시 | 완료 |
| 라운드 결과 모달 | 승자·점수·이동금액·고박 사유 표시 | 완료 |
| 점당 설정 | 메타 패널 input으로 변경 (기본 100원) | 완료 |
| v8 UI 테마 | 한국 고스톱 담요 톤 + 3×3 grid + 허니콤 바닥 | 완료 (2026-05-28) |
| fly 애니메이션 | actor의 손·더미·강탈 이동을 구조화 순서로 1회 재생하고, 손 안착 뒤 다음 fly를 즉시 연결하며 최종 clone 제거 뒤 효과 표시. choice srcCard fly 중복 방지 가드로 경로 A/B 이중 등록 차단 | 완료 |
| 원자 포획 정산 | 선택·폭탄·손뻑 회수의 획득 예정 카드를 보류하고 4·6·7장 결과를 각각 단일 batch로 확정 | 완료 |
| 조커 보충 연출 | 조커·강탈 피 정산 뒤 더미에서 손으로 보충 패를 이동하며 조기 손패 생성을 방지 | 완료 |
| 상황 메시지 i18n | 실제 쪽과 뻑 풀이(자뻑)를 별도 이벤트로 구분해 마지막 fly 뒤 ko/en 메시지를 한 번 표시 | 완료 |
| 절차형 효과음 | 카드 fly·특수 상황·고/스톱·승패를 의미별 합성음으로 전달하고 재전송 중복을 억제 | 완료 |
| 단계 runner 격리 | 게임 교체·이탈·reset 시 이전 timer를 취소하고 세대·소유권으로 새 매치 잠금과 broadcast를 보호 | 완료 |
| 매치 JSONL 로그 | match/round/turn/batch 기준 생명주기·입력·정산·오류 기록, 회전·보존·쓰기 실패 비차단 | 완료 |
| 매칭 카드 부착 표시 | 손패·더미 카드가 바닥 짝패를 가리지 않도록 방향별 오프셋·회전 적용 | 완료 |
| 마지막 손패 진행 | 상대 손패가 먼저 소진돼도 남은 플레이어가 마지막 패를 직접 내고 선택·덱 해결 후 종료 | 완료 |
| 모바일/반응형 | 의도적 미지원 (1280×800 단일 화면 fit 정책) | 미지원 |

## 알려진 제약사항

- **단일 해상도 정책**: 1280×800 데스크톱 Chromium 외 뷰포트는 미지원. `@media` 쿼리 없음.
- **모바일 축소 표시**: 고정 캔버스 축소 때문에 부착 카드 오프셋과 선택 버튼 간격·터치 영역이 데스크톱보다 작게 보인다.
- **단일 클라이언트 매칭 한계**: 1명만 접속 시 "방이 가득 찼다" 토스트가 정적 캡처에 잡힐 수 있으나 production 시각에는 영향 없음.
- **고박 단순화**: "고 부른 측이 결국 패배 시 점수 ×2"로만 처리. 첫쪽 가산은 미적용 (첫뻑 +7만 적용 — 2026-05-31).
- **사통 점수**: 일반 카드 점수·배수와 분리된 7점×1 고정 정산.
- **흔들기 모달 1회 제한**: `g.shakeAsked`로 라운드당 1회만 노출.
- **레거시 테스트 하네스**: `e2e-scenarios`, `entry-ui-qa`, `floor-joker-smoke` 일부는 현재 닉네임·자동 READY 게이트를 반영하지 못한다. 현행 #44~#50 수용 경로는 신규 고유 테스트 13건과 #50 독립 반복 3회가 PASS했다.
- **`bot.js`**: 개발/테스트 전용. 실제 매치메이킹에 봇이 들어가지 않음.
- **턴 종료 코드 중복**: `finishTurn`과 `finishTurnKeepTurn`의 유사 흐름은 규칙 변경 시 동기화가 필요하다.

## 향후 계획

- 라이브 2인 매칭 상태에서 ROUND_END / 9월 술잔 모달 / fly 애니메이션을 실제로 트리거한 시각 캡처 추가 (현재 QA가 정적 분석으로 보완 중)
- 카드 hover 같은 UI 효과음과 BGM 추가 (현재 게임 진행·특수 상황 효과음만 지원)
- 라운드 누적 통계 (라운드 수·평균 점수·박 발생률) 표시
- 모바일 폼팩터 대응 (정책 변경 시)

## 변경 이력

상세 변경 이력은 `CHANGELOG.md` 참조.

| 날짜 | 변경 |
|---|---|
| 2026-07-30 | 리포트 #65/#66 수정 — #65: 바닥 2장+상대 선택 흐름에서 상대 손 fly 중복 재생(경로 A/B 이중 등록) 수정. #66: "뻑 풀이!" 토스트 텍스트를 "자뻑!"으로 변경. QA PASS(148건), AD3 APPROVED |
| 2026-07-30 | 리포트 #63/#64 수정 — #63: chooseFloorSteps 쓸 토스트 미표시 수정(game.js 3지점). #64: 상대 카드 choice fly 출발 좌표 오류 수정(choiceActor 분기 추가). QA PASS, AD3 APPROVED |
| 2026-07-29 | 리포트 #51~#53 수정 — 쪽·뻑 풀이 메시지 분리, 폭탄 4/6장 단일 정산, 폭탄 후 보너스 권리 생성·GO 진행·단일 소모 확정. QA PASS, Phase A/B AD3 APPROVED |
| 2026-07-29 | 리포트 #44~#50 수정 — 손→더미 연결 지연 제거, 흔들기·AI 카드 출처 정정, 폭탄 4/6장과 손뻑 7장 단일 정산, 조커 보충 순서, 뻑 풀이 ko/en 토스트를 확정. QA PASS, Phase A/B/C AD3 APPROVED |
| 2026-07-29 | 리포트 #35~#43 수정 — 절대 카드 출처·소유권 fly, 폭탄 입력·상한, 선택/후속 처리 원자 정산, 사통 7점×1, 판별 가능한 JSONL 로그 도입. runner 세대 간섭·#34 fly 중복·효과 토스트 조기 표시도 해소. QA PASS, 페이즈별 AD3 APPROVED |
| 2026-07-27 | 리포트 33~34 수정 — `turnAction` 구조화 타임라인으로 조커 바닥 스테이징과 추가 드로우 순서를 보존하고, 따닥 네 장·조커·강탈 피를 동일 정산 배치에서 이동. QA 110회 PASS, AD3 APPROVED |
| 2026-07-27 | 리포트 27~30 수정 — 매칭 카드 부착 오프셋, 손패 hover 클리핑 해소, 쓸 판정·피 1장 강탈 정정, 마지막 손패의 명시적 플레이·선택·덱 처리 보장. 자동 검증 103/103 PASS, AD3 APPROVED, QA PASS |
| 2026-07-27 | 리포트 9건 수정 — 쌍피·조커 카드 단위 강탈, 덱 조커 captured·추가 뒤집기, 손 조커 턴 유지, 폭탄 같은 턴 추가 2회와 선택 continuation, 승자 다음 선공, 승자 끗 7장 멍박. 강탈 fly 실제 상대 카드 좌표와 안착 후 효과 표시, 선택 UI 진입 시 효과 종료. 제품 수용기준 151/151 PASS, AD3 APPROVED, QA PASS |
| 2026-06-20 | 조커 손패 fly 중복 재생 가드 — `lastJokerFlyActionKey` + `pendingFlies` 이중 가드. E-32 강화 |
| 2026-06-17 | R5~R8 버그 4건 — choice 손패 fly 등록, fly 순서 정합, 자뻑 2피 룰, 조커 pi 그룹 합류 |
| 2026-06-03 | 조커 2장 + 쓸 룰 추가. 2026-06-02 폭탄 룰 표준화 |
| 2026-05-31 | 룰 보강 5건 + v8 UI 시안 이식(2026-05-28) |
