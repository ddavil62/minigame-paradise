# Changelog

## [2026-07-20] - 별빛 우편탑 협동 부스트·5레벨 도달성 보완

### 추가

- 새 키 없이 기존 좌우 이동과 `Space` 점프로 발동하는 서버 권위 협동 부스트를 추가했다. 아래 플레이어가 상승 중 공중 동료의 하단을 올려치면 수혜자는 해당 레벨 중력 기준 약 190px 추가 상승 속도를 받고, 공격자는 약 45px 낙하 에너지에 해당하는 속도로 즉시 하강한다.
- 수평 교집합, 상하 경계 통과, 상대 접근 속도와 플레이어 상태를 함께 검사하고, 수혜자 공중 1회 소비 상태와 8px 접촉 분리 래치로 중복 발동을 막는다. 양쪽 클라이언트는 동일한 `COOP_BOOST` 이벤트 ID를 사용한다.
- 5개 레벨의 필수 전환에 `boostRequired` 메타데이터와 장치 전력 연동 복귀 발판을 추가했다. 기본 지형 27개 계약과 복귀 발판 8개의 참조·범위·활성 조건은 분리 검증한다.
- 역할색·금색 상승/하강 효과, 감소 모션 정적 링, ko/en 준비 화면·최초 HUD 힌트·접근성 성공 토스트를 추가했다.
- 좌표나 장치 상태를 직접 바꾸지 않고 `applyInput()`과 `stepSimulation(1/30)`만 사용하는 2인 물리 완주 드라이버와 5레벨 도달성 회귀 테스트를 추가했다.

### 수정

- 저중력 레벨에 중력 배율이 중복 적용되던 물리를 바로잡고, 필수 단독 경로의 수직·수평 여유와 결승 접근을 실제 입력 완주 결과에 맞춰 보정했다.
- 잠금 뒤 주기 발판의 고체 상태, 회전 장치 귀환 정렬, 안전지대 고정 플레이어 처리와 실제 스위치 좌표 허용을 수정했다.
- 회전·합류 승강 장치는 얇은 가변 충돌체가 복귀를 반복 차단하지 않도록 원본 안전 데크 충돌을 사용한다. 궤도 도킹 두 모듈의 높이 허용치는 실제 단자·스위치 높이차에 맞추되 상대 속도 조건은 유지했다.
- AD 1차 검수에서 확인된 1024×576 준비 화면 스크롤과 성공 토스트·행동 힌트 겹침을 수정했다. 두 언어의 필수 요소가 카드 안에 표시되고 토스트와 힌트는 최소 4px 이상 분리된다.
- QA에서 발견된 부스트 현재 틱 수직 경계를 정확한 닫힌 구간 `[-8,+8]`로 제한하고 `-9/-8/+8/+9` 회귀를 고정했다.

### 검증

- 5개 레벨 각각 실제 입력으로 부스트 8회, 장치 `POWERED`·`LATCHED` 8회, 체크포인트 8개, `GAME_COMPLETED` 1회, 추락 0회를 확인했다. 강제 진행 API와 좌표 직접 대입은 사용하지 않았다.
- 제품 단위·물리 완주 32/32, Playwright 전체 25/25, QA 독립 경계·드라이버·5레벨 회귀 7/7로 총 64/64 PASS했다.
- Chromium 일반 모션 1280×720과 감소 모션 1024×576, ko/en 준비 화면을 시각 검증했다. AD 모드3 `APPROVED`, QA 최종 `PASS`다.

### 알려진 제약

- 자동 입력 완주는 검증됐지만 실제 두 기기의 체감 난이도와 협동 타이밍은 별도 플레이테스트가 필요하다.
- 회전·합류 승강 장치는 원본 안전 데크 충돌을 사용하며, 두 궤도 도킹 모듈은 실제 높이차 때문에 완화된 높이 계약을 사용한다.

### 참고

- 스펙: `.Codex/specs/2026-07-20-starlight-coop-boost.md` (`COMPLETED`)
- 구현 리포트: `.Codex/specs/2026-07-20-starlight-coop-boost-report.md`
- UI 검수: `.Codex/specs/2026-07-20-starlight-coop-boost-ui-review.md` (`APPROVED`)
- QA: `.Codex/specs/2026-07-20-starlight-coop-boost-qa.md` (`PASS`)

---

## [2026-07-20] - 베네치아 전투·아이템 동기화·게임 중 메뉴 복귀

### 수정

- 서버의 아이템 슬롯 배열을 단일 근거로 삼아 게임·리매치 시작, 획득, 사용, 잘못된 사용 요청마다 사용자 본인에게 `ITEM_SLOTS_SYNC` 전체 배열을 전송한다. 클라이언트와 봇은 이 배열로 슬롯을 완전 교체하며, 응답 대기 중 중복 사용 요청을 막아 경기 중반 이후 슬롯이 어긋나던 문제를 해결했다.
- 유효한 정답마다 상대 HP를 2 감소시키는 공격 규칙을 복구했다. `WORD_CLEARED.attackDamage`, `HIT(source: 'word_clear')`와 서버 권위 `STATE`를 전송하며 오답·없는 단어·상대 단어에는 피해가 없다.
- 단어가 서버 낙하 시계상 바닥에 도달하면 소유자 HP를 단어당 2 감소시킨다. 급류와 같은 tick의 다중 만료에서도 피해를 한 번만 합산하고, HP는 0으로 제한한 뒤 `GAME_OVER(reason: 'hp_zero')`를 한 번만 전송한다.
- 게임 화면에 상시 `← 게임 선택` 버튼을 추가했다. 확인하면 자동 재연결을 중단하고 양쪽에 로비 복귀를 알린 뒤 통합 포탈 `/`로 이동하며, 취소하면 현재 게임과 입력 상태를 유지한다.
- 아이템 안내에 콤보 기반 확률 획득과 숫자 1·2·3 사용법을 명시하고, 피격 연출은 서버 상태를 신뢰해 HP·보드 영역에만 적용했다.

### 검증

- Node 단위·실제 2인 WebSocket에서 서버 권위 슬롯 동기화, 플레이어 간 슬롯 격리, 정답/일반·급류·다중 만료 피해, HP 0 종료를 검증했다.
- Playwright에서 숫자키·IME·급류 회귀, 메뉴 버튼의 취소/확인/재연결 중단, 1280×720·390×844 레이아웃과 콘솔 오류 0건을 검증했다.
- AD 모드3 `APPROVED`, QA 최종 `PASS` 및 제품 결함 0건.

### 참고

- 스펙: `.Codex/specs/2026-07-19-venezia-combat-item-menu.md` (`COMPLETED`)
- 구현 리포트: `.Codex/specs/2026-07-19-venezia-combat-item-menu-report.md`
- UI 검수: `.Codex/specs/2026-07-19-venezia-combat-item-menu-ui-review.md` (`APPROVED`)
- QA: `.Codex/specs/2026-07-19-venezia-combat-item-menu-qa.md` (`PASS`)

---

## [2026-07-19] - 베네치아 숫자키·급류·정답 무피해 전환

### 변경

- 아이템 사용키를 `Alt+1/2/3`에서 단독 `Digit1/2/3`·`Numpad1/2/3`으로 변경했다. IME 조합, `Process`, keyCode 229, 수정키 조합과 일반 편집 요소는 보호한다.
- `item_freeze` 프로토콜 ID는 호환 유지하고 사용자 표시를 `🌊 급류`로 변경했다. 급류는 입력을 막지 않고 4초간 상대 단어 낙하·서버 만료를 2배 가속한다.
- 플레이어별 누적 낙하 시계와 단어별 생성 시계로 서버·Canvas·AI 봇의 낙하 진행을 통일했다. 재사용은 2배를 중첩하지 않고 종료 시각만 갱신하며 방어막은 1회를 차단한다.
- 일반 정답의 상대 HP 감소, `attackDamage`, `HIT`, 피격 shake와 정답 직후 `hp_zero` 검사를 제거했다. HP·회복·기존 종료 구조는 프로토콜 호환을 위해 유지한다.
- 현재 정상 플레이에는 HP를 0으로 만드는 경로와 신규 종료 규칙이 없어 경기가 자동 종료되지 않을 수 있다. 시작 HP가 이미 최대치이고 피해원이 없어 회복 아이템도 실질 효과가 없으며, 두 사항을 기획서의 알려진 제약으로 기록했다.

### 검증

- JS 구문 검사 8/8, Node 순수 로직 6/6, 실제 2인 WS 정답 무피해 1/1, 실제 서버 급류 재사용·타이머 1/1 PASS.
- Playwright 현재 규칙 1/1, 기존 아이템 회귀 7/7, 독립 QA 2/2 PASS. 숫자열·숫자패드, IME/수정키/편집 요소 보호, HP 유지, 1280×720·1024×768·390×844 화면과 모바일 FAB 비겹침을 검증했다.

### 참고

- 스펙: `.Codex/specs/2026-07-19-venice-item-controls.md`
- 구현 리포트: `.Codex/specs/2026-07-19-venice-item-controls-report.md`
- UI 검수: `.Codex/specs/2026-07-19-venice-item-controls-ui-review.md` (`APPROVED`)
- QA: `.Codex/specs/2026-07-19-venice-item-controls-qa.md` (`PASS`)

---

## [2026-07-19] - 베네치아 타이핑 배틀 아이템 시스템 추가

### 추가

- 아이템 5종 구현: 단어 폭탄(즉시 단어 1개 제거), 빙결(상대 입력 4초 차단), 암흑(상대 화면 5초 가림), 방어막(다음 피격 1회 무효화), 회복(HP+15).
- 콤보 기반 확률 드랍 시스템(`rollItemDrop`): 연속 타이핑 성공 시 콤보 누적, 콤보 3~4=10%, 5~6=20%, 7~9=35%, 10~14=50%, 15+=70% 확률로 아이템 획득.
- 아이템 슬롯 UI 3개(FIFO): 입력창 위 배치, Alt+1/2/3 키로 사용. IME 가드 포함으로 한글 입력 중 키 충돌 없음.
- AI 봇 아이템 처리: `ITEM_GRANTED` 수신 시 2~4초 랜덤 딜레이 후 자동 사용(`scheduleItemUse`).
- WS 프로토콜 확장: `ITEM_USED`(C->S), `ITEM_GRANTED`/`ITEM_EFFECT_START`/`ITEM_EFFECT_END`(S->C) 메시지 추가.
- `VeneziaPlayer` 상태에 `combo`, `itemSlots`, `freeze`, `dark`, `shield` 필드 추가.
- CSS 추가: `.item-slots`, `.item-slot`, `.dark-overlay`, `.freeze-active`, `.toast` 스타일.

### 수정

- 리매치 버그 수정: 상대가 먼저 리매치 요청 시 버튼이 잠기던(`disabled` 상태 유지) 문제 해소.
- `resetCombo`: 오입력 또는 시간 초과 시 콤보를 0으로 초기화.

### 변경 파일

- `venezia/game.js` — `rollItemDrop`, `applyItemEffect`, `resetCombo` 함수 추가. `VeneziaPlayer`에 아이템 관련 필드 확장.
- `venezia/server.js` — `ITEM_USED` WS 핸들러, `itemTimers` 관리, 봇 아이템 스폰 로직.
- `venezia/bot.js` — `scheduleItemUse`, `ITEM_GRANTED` 처리.
- `venezia/public/index.html` — 아이템 슬롯 3개 마크업, `effect-overlay` div.
- `venezia/public/js/network.js` — `ITEM_GRANTED`/`ITEM_EFFECT_START`/`ITEM_EFFECT_END` 라우트, `sendItemUsed` 함수.
- `venezia/public/js/main.js` — 아이템 핸들러, `renderItemSlots`, `showToast`, Alt+1/2/3 키바인딩, 리매치 버그 수정.
- `venezia/public/css/style.css` — 아이템 슬롯/효과 오버레이/토스트 스타일.

### 검증

- QA PASS (아이템 드랍/사용/효과 적용/봇 AI/리매치 수정 포함).

### 참고

- 스펙: `.claude/specs/2026-07-19-venezia-plan.md`
- 구현 리포트: `.claude/specs/2026-07-19-venezia-coder-report.md`
- QA: `.claude/specs/2026-07-19-venezia-qa-report.md`

---

## [2026-07-19] - 달빛 주방열차 2인 협동 요리 추가

### 추가

- `moonlight-kitchen-express/`에 LAN 2인 전용 협동 요리 게임을 추가했다. 두 등불 너구리 정비사가 300초 동안 3개 레시피의 주문 9건을 준비·조리·플레이팅·서빙한다.
- 달빛 저장칸·연결 발판·불꽃 조리칸으로 이어진 탑다운 2D Canvas 무대와 재료 상자, 도마, 반죽대, 화로, 찜기, 국솥, 플레이팅대, 쓰레기통, 서빙창을 구현했다.
- 30Hz 서버 권위 시뮬레이션과 15Hz 스냅샷, 입력 `seq`·revision 검증, AABB 충돌, 단일 아이템 소유권, 동시 집기·설비 조작 중재를 적용했다.
- 달버섯 꼬치·등불잎 만두·혜성무 국수의 재료·가공·조리·완성 유예를 구현했다. 라운드에는 주문 공개 5회, 역 정차 5회, 커브 4회가 고정 타임라인으로 발생한다.
- 점수는 성공 주문 기본점수와 남은 시간 보너스, 1.0~2.0 콤보를 사용한다. 주문 만료 -30, 잘못된 서빙 -15, 과열 사고 -25를 적용하며 6건 이상·650점 이상이면 성공한다.
- 공유 열도 70/85/100 경고, 과열 시 조리 속도 80%, 펌프·배기 밸브의 0.75초 동시 허용과 2초 협동 냉각, 8초 미대응 사고를 구현했다.
- READY 승무원 슬롯, 주문 3장, 운행 타임라인, 점수·콤보·시간·열도, 손·파트너·설비 상태, 냉각 진행, 성공/실패 결과와 기여도, 재도전·로비 합의 UI를 추가했다.
- 통합 런처에 13번째 게임 카드와 160×96 SVG 키 아트를 등록하고 HTTP 및 `/moonlight-kitchen-express/ws` 프록시를 연결했다. 2인 전용, AI 미지원으로 등록했다.
- 15초 재접속 유예 동안 시뮬레이션과 주문 시간을 정지하고 같은 토큰의 역할·위치·소유·조리·주문·점수를 복원한다. 5초 긴급 경고, 만료·파트너 이탈·명시 종료 사유와 결과 후 런처 복귀를 제공한다.
- 모든 노출 문구를 한국어·영어로 제공하고 키보드 포커스 트랩, `aria-live`, 감소 모션, 1280·1024·390 폭 레이아웃을 적용했다.

### 수정

- 결과 LOBBY 만장일치 후 닫히는 연결을 재접속으로 오인해 stale 슬롯과 `SESSION_ACTIVE`가 남던 문제를 수정했다. `cleanupSlot()`과 `resetSessionIfEmpty()`로 timeout·중복 close·종료 순서에 무관한 멱등 정리를 보장한다.
- 키 아트의 역할 표식을 P1 청록 초승달과 P2 자홍 별로 분리하고, 390px 재접속 패널·복귀 배너가 경고와 런처 버튼을 침범하지 않도록 조정했다.
- READY·결과 패널의 양방향 포커스 순환, 데스크톱 버튼 전체 가시성, 내부 재료·공정 ID의 ko/en 변환을 보강했다.

### 검증

- 최종 기능 집계 31/31 PASS: 기본 Node/WS 15/15, edge/network 12/12, 실제 게임 E2E 2/2, 통합 런처 E2E 1/1, UI·i18n·콘솔 1/1.
- JavaScript 구문 검사 21/21 PASS, edge/network 12/12를 3회 연속 실행해 36/36 PASS, 콘솔·pageerror·실패 정적 요청 0건을 확인했다.
- 1280×720, 1024×768, 390×844 시각 검수 3/3 PASS. Phase 1~3의 AD 모드 2·3은 각 페이즈 최종 APPROVED다.

### 참고

- 스펙: `.Codex/specs/2026-07-19-moonlight-kitchen-express.md`
- 구현 리포트: `.Codex/specs/2026-07-19-moonlight-kitchen-express-phase1-report.md`, `.Codex/specs/2026-07-19-moonlight-kitchen-express-phase2-report.md`, `.Codex/specs/2026-07-19-moonlight-kitchen-express-phase3-report.md`
- QA: `.Codex/specs/2026-07-19-moonlight-kitchen-express-qa.md`
- 신규 SVG는 프로젝트 내부 코드 네이티브 키 아트이며 `assets/` 외부 생성 에셋 변경은 없다.

---

## [2026-07-19] - 별빛 우편탑 5레벨 캠페인 및 메타 기능 확장

### 추가

- 기존 별빛 우편탑을 포함해 `starlight-tower`, `cloud-cargo`, `moon-clock`, `storm-station`, `orbital-post`의 5개 레벨을 제공한다. 각 레벨은 공용 카탈로그 데이터로 정의된 8개 협동 모듈과 피날레를 가진다.
- 보완 페이즈 R에서 신규 4월드마다 27개 독립 플랫폼, 9개 체크포인트, 8개 모듈, 고유 월드·물리·피날레 데이터를 적용하고 서버 시작 시 참조·경계·개수 계약을 검증한다.
- 대기실에 레벨 이름·테마·예상 플레이시간·최고 기록 카드와 호스트 전용 선택을 추가했다. 선택 레벨은 두 클라이언트에 동기화되고 동일 레벨로 시작한다.
- 결과 화면에 재도전·다음 레벨·레벨 선택 복귀를 추가했다. 두 플레이어의 최신 선택이 일치한 경우에만 360ms 확인 후 한 번 전환하며, 상충하면 재선택을 기다린다.
- `game/records.js`와 `data/records.json`에 레벨별 서버 산정 최단 기록을 원자 저장한다. 더 빠른 기록만 갱신하며 손상 JSON은 격리한 뒤 빈 기록으로 복구한다.
- 구름 열차·시계탑·폭풍 관측소·궤도 우편선의 Canvas 모티프와 신규 장치 11종의 시각 분기, 레벨별 카드 배너를 추가했다.
- 신규 메타 UI와 레벨·오류 문구를 한국어와 영어로 제공하고, 1280×720·1024×768·390×844 반응형 레이아웃과 키보드 포커스를 적용했다.

### 변경

- 서버 메타 상태를 대기실→플레이→결과 흐름으로 관리하고, p1 호스트 권한·진행 중 레벨 변경 거부·15초 재접속 시 레벨/역할/체크포인트 복원을 적용했다.
- 이동 플랫폼과 탑승자 이송, 셔터·주기 발판의 충돌 전환과 240ms 경고, 회전 각도, 돌풍·상승기류·낙뢰·엄폐, 저중력 관성과 도킹 상태를 30Hz 서버 권위 시뮬레이션과 snapshot 기반 Canvas 렌더링으로 연결했다.
- 결과 통계에 완주 시간·추락 수·역할 교대 수를 표시한다. 최고 기록 판정에는 완주 시간만 사용한다.
- 레벨 카드의 예상 시간과 최고 기록을 분리하고, 결과 화면에 이번 기록·최고 기록·추락·교대의 네 통계를 동시에 표시한다. 느린 완주는 기존 최고 기록과 신기록 상태를 변경하지 않는다.
- `NEXT`는 카탈로그의 다음 레벨로 이동하며 마지막 레벨 다음에는 첫 레벨로 순환한다.

### 수정

- RESULT 상태에서 과거 READY 값으로 게임이 재시작되던 문제를 `waiting` 상태 가드와 시작 시 READY 정리로 수정했다.
- 퇴장한 역할의 결과 표가 새 참가자에게 재사용되던 문제를 역할 수명주기별 표·예약 정리로 수정했다.
- 결과 전환 예약 중 양쪽 선택이 바뀌면 최신 만장일치가 유실되던 문제를 예약 취소·재평가·만료 시 재검증으로 수정했다.

### 검증

- 보완 페이즈 R 최종 QA 46/46 PASS: 단위 20/20, 프로젝트 Playwright 24/24, 상위 런처 2/2. JavaScript 구문 검사 20개 파일 PASS.
- 5개 레벨 로드·완료, 독립 데이터, 결정론, 동적 collider와 장치·물리 경계, 결과 통계, 재접속·기록 복구·입력 방어를 검증했다.
- AD 모드 2와 모드 3의 보완 페이즈 R 재검수는 REVISE 수정 후 모두 최종 APPROVED.
- 신규 4월드의 실제 8~15분 체감 난이도와 모든 모듈 연속 실입력 완주는 두 기기 플레이테스트에서 추가 튜닝한다.

### 참고

- 스펙: `.Codex/specs/2026-07-19-starlight-world-expansion.md`
- 구현 리포트: `.Codex/specs/2026-07-19-starlight-world-expansion-report.md`
- QA: `.Codex/specs/2026-07-19-starlight-world-expansion-qa.md`
- 외부 이미지 에셋 변경이 없어 Mockup Sync는 생략한다.

---

## [2026-07-18] - 별빛 우편탑 2인 협동 등반 추가

### 추가

- `starlight-mail-tower/`에 LAN 2인 전용 협동 등반 게임을 추가했다. 두 정비 로봇이 고정 단자와 이동 역할을 교대하며 3구간 8개 모듈과 최종 발사 절차를 진행한다.
- 30Hz 서버 권위 시뮬레이션, 15Hz 스냅샷, 공동 체크포인트, 1.2초 공동 복귀, 역할 교대, 완주 결과와 양쪽 동의 재경기를 구현했다.
- 런처에 12번째 게임으로 등록하고 `minPlayers: 2`, `maxPlayers: 2`, `botAvailable: false`를 적용했다. 두 사용자가 READY하면 같은 세션의 `p1`·`p2` 역할로 단일 포트 경로에 입장한다.
- 15초 재접속 유예와 역할·체크포인트 복원, 만료 시 세션 종료, 한국어/영어 전환과 저장, 음소거, 런처 복귀 확인 흐름을 추가했다.
- Canvas/CSS 기반 로봇·장치·배경과 `starlight-mail-tower/public/assets/key-art.svg` 런처 키아트를 추가했다. 1280×720과 1024×576 레이아웃 및 감소 모션을 지원한다.

### 수정

- 복수 단절 시 한 명만 돌아와도 게임이 재개되던 문제를 역할별 재접속 타이머와 2인 복귀 정족수로 수정했다.
- 퇴장자의 재경기 투표가 남아 한 명만으로 재시작될 수 있던 문제를 퇴장·단절 정리와 실행 직전 정족수 재검증으로 수정했다.
- 게임 전역 Enter/Space 처리가 버튼의 기본 키보드 활성화를 막던 문제를 네이티브 키보드 대상 분기로 수정했다.
- QA 수정 뒤 AD 모드 3에서 모달 포커스 순환, aria/live, 키보드 조작과 승인 레이아웃을 재검수해 승인했다.

### 검증

- 단위 테스트 10/10, 게임 E2E 5/5, 신규 QA 6/6, 런처 통합 2/2로 최종 23/23 PASS.
- JavaScript 구문 검사 16/16 PASS, 최종 QA PASS, Phase 1~3 AD 모드 2·3 최종 APPROVED.

### 참고

- 스펙: `../.Codex/specs/2026-07-18-buddy-climb.md`
- 구현 리포트: `../.Codex/specs/2026-07-18-buddy-climb-phase1-report.md`, `../.Codex/specs/2026-07-18-buddy-climb-phase2-report.md`, `../.Codex/specs/2026-07-18-buddy-climb-phase3-report.md`
- QA: `../.Codex/specs/2026-07-18-buddy-climb-qa.md`
- 실제 두 기기 8~12분 플레이타임 튜닝과 키아트 Mockup 동기화는 후속 게이트다.

---

## [2026-06-25] - READY 게이트 노후화 테스트 현행화

### 배경
입장 UI 통일 Phase 1~4 (2026-06-24~25)에서 READY 게이트가 도입된 후, 기존 테스트 3종이 JOIN/READY 시퀀스를 거치지 않아 TIMEOUT 상태였다.

### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `davinci-code/server.js` | `POST /test/reset` 엔드포인트 신설 (테스트 격리용 -- WS 연결 전체 terminate + `players=[]` + `game=null` + `readySet.clear()`) |
| `davinci-code/tests/davinci-plus-qa.spec.js` | `connectTwoPlayers()` READY 게이트 대응 (`?name=P1Test/P2Test` + `#btn-ready` + `.play-area:not(.hidden)`), `determineTurnPlayers()` 동적 턴 판별 헬퍼 (E-12/13/14/22/23/24/25), `test.beforeEach` 리셋 |
| `codenames-duet/tests/review-smoke.mjs` | JOIN/JOINED/READY/GAME_START WS 시퀀스 삽입 |
| `codenames-duet/tests/review-visual.mjs` | 1탭→2탭 `?name=ReviewA/ReviewB` + `#btn-ready` 클릭 + `.board-wrap:not(.hidden)` 대기로 변경 |

### 수정
- **davinci E2E 턴 순서 비결정성 (QA 1차 FAIL → 2차 수정)**: QA에서 P1 선공 가정(`waitForFunction('내 턴')`) 7건이 비결정적 실패로 발견됨 (pre-existing 결함, READY 게이트 이전에는 TIMEOUT으로 은폐). `determineTurnPlayers()` 헬퍼로 양쪽 `turn-status`를 읽어 `attacker`/`defender`를 동적 결정하도록 수정
- **테스트 간 서버 상태 격리**: `davinci-code/server.js`에 `POST /test/reset` 엔드포인트 추가 (WS 전체 terminate + 상태 초기화). `test.beforeEach`에서 호출하여 테스트 격리 확보

### 테스트 결과
- davinci-plus-qa.spec.js: **25/25 PASS** (3회 연속, 비결정적 실패 0건)
- review-smoke.mjs: **27/27 PASS**
- review-visual.mjs: **11/11 PASS**
- 단위 회귀 (game-unit-qa.spec.js): **53/53 PASS**

### 참고
- 스코프: `.claude/specs/2026-06-25-test-modernize-scope.md`
- 플랜: `.claude/specs/2026-06-25-test-modernize-plan.md`
- Coder 1차: `.claude/specs/2026-06-25-test-modernize-coder-report.md`
- QA 1차 (FAIL): `.claude/specs/2026-06-25-test-modernize-qa-report.md`
- Coder 2차 (재수정): `.claude/specs/2026-06-25-test-modernize-coder-report2.md`
- 스펙 대비 차이: 원래 프로덕션 코드 무변경 원칙이었으나, QA FAIL로 발견된 테스트 격리 문제 해소를 위해 `davinci-code/server.js`에 `/test/reset` 엔드포인트 1개 추가 (게임 로직 무변경, 테스트 인프라 전용)

---

## [2026-06-25] - 입장 UI 통일 Phase 4 (Entry UI Unify — hanabi, davinci-code, codenames-duet)

### 확인 (코드 변경 없음)

Phase 4 대상 3개 게임(hanabi, davinci-code, codenames-duet)은 **이전 작업에서 이미 입장 UI 통일 패턴이 완전 구현된 상태**였다. 코드 변경 없이 스펙 수용 기준 준수를 검증하였다.

**hanabi** (이미 구현 완료 확인)
- `index.html`: `#screen-waiting`(line 27~74), `#name-gate-inline`(line 32~36), `#ready-panel`(line 43~54), `#opponent-info`(line 39~41), `#opponent-left-banner`(line 77~80), `#screen-game` 초기 `hidden`
- 가이드 슬라이더 7장(`#guide-slider`, line 57~72) `.waiting-card` 내부 유지 (HR-C11 9/9 PASS)
- `js/main.js`: 닉네임 게이트 3단계 폴백, READY 처리(`updateReadyUI()`), 이탈 배너(`showOpponentLeftBanner()`)
- `server.js`: `readySet` + `broadcastReadyState()` + `maybeStartGameIfReady()`, JOIN/READY 핸들러 완비

**davinci-code** (이미 구현 완료 확인)
- `index.html`: `#screen-waiting`(line 36~59), `#name-gate-inline`(line 39~43), `#ready-panel`(line 47~57), `.play-area` 초기 `hidden`
- `client.js`: READY 게이트 DOM 참조, 닉네임 3단계 폴백, JOINED/READY_STATE/GAME_START 핸들러
- `server.js`: `readySet` + `broadcastReadyState()` + `maybeStartGameIfReady()` 완비

**codenames-duet** (이미 구현 완료 확인)
- `index.html`: `#screen-waiting`(line 47~92), `#name-gate-inline`(line 53~57), `#ready-panel`(line 70~79), `.board-wrap` 초기 `hidden`
- 복기 모드 `#review-banner`(line 95~105) 정상 보존
- `server.js`: `readySet` + `broadcastReadyState()` + `maybeStartGameIfReady()` 완비

### 검증

**Phase 4 QA 결과**
- hanabi: Playwright **78/78 PASS** (유닛 31 + WS 7 + QA엣지 8 + E2E 6 + 가이드 슬라이더 9 + 추가분 17)
- davinci-code: 단위 **53/53 PASS** (E2E는 READY 게이트 이전 테스트 미현행화 기존 결함)
- codenames-duet: `#review-banner` 복기 모드 보존 확인 (review-smoke/visual은 READY 게이트 이전 테스트 미현행화 기존 결함)
- AD3: **32/32 APPROVED** (WARN 3건 비강제: davinci-code/codenames-duet `screen` 클래스 누락 + CSS 중복 선언 — 렌더링 기능 동등)

**입장 UI 통일 전 페이즈 완료 현황**
- Phase 1: yahtzee, rummikub (2026-06-24)
- Phase 2: yutnori, tetris-battle (2026-06-24)
- Phase 3: matgo, janggi (2026-06-24)
- Phase 4: hanabi, davinci-code, codenames-duet (2026-06-25)
- **9개 게임 전부 오목 파일럿 패턴 통일 완료**

### 알려진 이슈 (기존 결함, 비차단)
- davinci-code E2E 테스트(`davinci-plus-qa.spec.js`): `connectTwoPlayers()` 헬퍼에 JOIN/READY 시퀀스 미추가로 전건 TIMEOUT. 테스트 현행화 필요 (별도 작업)
- codenames-duet review-smoke/visual: raw WS 클라이언트에 JOIN/READY 미추가로 GAME_START 미수신. 테스트 현행화 필요 (별도 작업)
- AD3 WARN: davinci-code/codenames-duet `class="screen-waiting"` (표준 `class="screen screen-waiting"`에서 `.screen` 클래스 누락 — CSS 기능 동등, Phase 3 동일 선례 허용)

### 참고
- 플랜: `.claude/specs/2026-06-24-entry-ui-unify-plan.md`
- Phase 4 Coder: `.claude/specs/2026-06-25-entry-ui-unify-phase4-coder-report.md`
- Phase 4 AD3: `.claude/specs/2026-06-25-entry-ui-unify-phase4-ad3-report.md` (APPROVED, WARN 3건 비강제)
- Phase 4 QA: `.claude/specs/2026-06-25-entry-ui-unify-phase4-qa-report.md` (PASS, hanabi 78/78 + davinci-code 53/53)
- 통일 패턴: 오목(omok) 파일럿 — `#screen-waiting .waiting-card`, `#name-gate-inline`, `READY_STATE { myReady, opponentReady }`, `#opponent-left-banner`

---

## [2026-06-24] - 입장 UI 통일 Phase 3 (Entry UI Unify — matgo, janggi)

### 추가

**Phase 3 — matgo (대기 화면 + READY 프로토콜 신규 추가)**
- **`matgo/server.js`**: `readySet` 상태 추가, `otherPlayer()`/`broadcastReadyState()`/`maybeStartGame()` 헬퍼 함수 추가, JOIN/READY 메시지 핸들러 신설, 2인 즉시 게임 시작 제거(READY 게이트로 대체), JOINED 페이로드에 `hasName`/`opponentName` 추가, disconnect 시 `readySet.delete` + `name` 포함 OPPONENT_LEFT
- **`matgo/bot.js`**: `readyTimer` 상태 변수 추가, JOINED 수신 후 `scheduleReady()` 자동 호출(0.3~0.5초 지연), READY_STATE 핸들러(수신만)
- **`matgo/public/client.js`**: 대기 화면 DOM 참조 18개 추가, `getCurrentMode()`/`hideAiButton()`/`showAiButton()`/`updateWaitingTitle()`/`updateOpponentInfo()`/`updateReadyUI()`/`showOpponentLeftBanner()`/`showScreen()`/`submitInlineName()` 헬퍼 함수 추가, `connect()` WS open에 3-tier 닉네임 폴백(URL→sessionStorage→인라인 게이트) + JOIN 자동 송신, JOINED 핸들러 전면 재작성, READY_STATE 핸들러 신설, GAME_START에 showScreen('game') 추가, OPPONENT_LEFT를 배너 표시로 교체(자동 redirect 제거), 대기 화면 이벤트 리스너 4개

**Phase 3 — janggi (대기 화면 + READY 프로토콜 신규 추가)**
- **`janggi/public/index.html`**: `#screen-waiting` 섹션 신설(닉네임 게이트, AI 버튼, READY 패널, 장기 룰 요약 4항목), `#opponent-left-banner` 추가, `.janggi-app`에 `hidden` 초기 클래스 + `id="screen-game"` 추가, `header.topbar`에 `hidden` 초기 클래스 + `id="topbar"` 추가
- **`janggi/public/css/style.css`**: `.screen-waiting`, `.waiting-card`, `.name-gate-inline`, `.btn-inline-enter`, `.waiting-solo`, `.btn-start-ai`, `.opponent-info`, `.ready-panel`, `.btn-ready`, `.rules-summary`, `.opponent-left-banner`, `.btn-banner-return-lobby`, `.hidden` 유틸리티 클래스 등 대기 화면 CSS 전체 추가 (janggi 진남색+한/초 테마 적용)
- **`janggi/public/js/main.js`**: `opponentName`/`myReady`/`opponentReady` 상태 변수 추가, 대기 화면 DOM 참조 18개 추가, 9개 헬퍼 함수 추가, `connect()` WS open에 3-tier 닉네임 폴백 + JOIN 자동 송신, READY_STATE 핸들러 신설, handleJoined 전면 재작성, handleGameStart에 showScreen('game') + READY 초기화, handleOpponentLeft를 배너 표시로 교체, 대기 화면 이벤트 리스너 4개
- **`janggi/server.js`**: `readySet` 상태 추가, `otherPlayer()`/`broadcastReadyState()`/`maybeStartGame()` 헬퍼 함수 추가, `player.name` 필드 도입(봇='AI', 사람='(알 수 없음)'), JOIN/READY 메시지 핸들러 신설, 2인 즉시 배치선택 시작 제거(READY 게이트로 대체), JOINED 페이로드에 `hasName`/`opponentName` 추가, disconnect 시 `readySet.delete` + `name` 포함 OPPONENT_LEFT + game/timer 정리
- **`janggi/bot.js`**: `readyTimer` 상태 변수 추가, JOINED 수신 후 `scheduleReady()` 자동 호출(0.3~0.5초 지연), READY_STATE 핸들러(수신만)

### 검증

**Phase 3 QA 결과**
- matgo: 정상 8 + 예외 6 + 시각 2 = 16/16 PASS (독립 실행 기준)
- janggi: 정상 7 + 예외 5 + 시각 2 = 14/14 PASS
- AD3: DOM 구조 26 + 시각 검증 4 + 레퍼런스 비교 2 = 32/32 PASS, APPROVED

**Phase 3 회귀 테스트**
- matgo 단위: `game.unit.spec.js` 44/44 + `score.unit.spec.js` 56/56 = **100/100 PASS**
- janggi 단위: `janggi.spec.js` 77 + `qa-edge-cases.spec.js` 58 + `rulebook-c1~c9` 111 + `bot-eval-qa.spec.js` 8 = **254/254 PASS**
- matgo 기존 e2e 32건: READY 게이트 도입 후 `joinAndStartGame` 헬퍼가 새 UI 흐름에 미적응하여 전건 TIMEOUT. **기능 결함 아님 — 테스트 코드 현행화 필요** (별도 작업)

### 알려진 이슈 (LOW, 비차단)
- matgo `test/reset` 엔드포인트가 `readySet`을 미초기화 — 순차 실행 시 stale readySet 잔존 가능. `readySet.clear()` 추가 권장 (테스트 인프라, 프로덕션 무영향)
- matgo URL `?name=` 경유 시 닉네임 게이트 순간 노출 — 런처 경유 시 실질적 영향 없음 (onopen에서 즉시 JOIN 송신)
- janggi 입장 버튼 세로 배치가 레퍼런스(omok/yahtzee/matgo)의 인라인 배치와 다름 — 기능/사용성 무영향, janggi 고유 테마 스타일링으로 허용 (AD3 WARN-1, 비강제)

### 참고
- 플랜: `.claude/specs/2026-06-24-entry-ui-unify-plan.md`
- Phase 3 Coder: `.claude/specs/2026-06-24-entry-ui-unify-phase3-coder-report.md`
- Phase 3 AD3: `.claude/specs/2026-06-24-entry-ui-unify-phase3-ad3-report.md` (APPROVED, WARN 1건 비강제)
- Phase 3 QA: `.claude/specs/2026-06-24-entry-ui-unify-phase3-qa-report.md` (PASS, 30/30 + 회귀 matgo 100 + janggi 254)
- 통일 패턴: 오목(omok) 파일럿 — `#screen-waiting .waiting-card`, `#name-gate-inline`, `READY_STATE { myReady, opponentReady }`, `#opponent-left-banner`
- matgo 테마: 녹색 펠트(`--bg-base: #0d2a1c`) + 골드(`--gold: #d4af37`)
- janggi 테마: 진남색 그라디언트(`#1a1a2e`) + 한 적색(`--janggi-han-primary`) / 초 청색(`--janggi-cho-primary`)
- 잔여: Phase 4 (hanabi, davinci-code, codenames-duet) 미착수

---

## [2026-06-24] - 입장 UI 통일 Phase 1+2 (Entry UI Unify)

### 추가

**Phase 1 — yahtzee, rummikub (대기 화면 거의 완성형)**
- **`yahtzee/public/index.html`**: `#name-gate-inline` 닉네임 게이트 추가, `#invite-panel` 제거, `#opponent-info` + `#opponent-left-banner` 추가, READY 마크 ID 오목 패턴으로 통일 (`#my-ready-mark`/`#opp-ready-mark`)
- **`yahtzee/public/css/style.css`**: `name-gate-inline`, `opponent-left-banner`, `btn-start-ai` 클래스 추가
- **`yahtzee/public/js/main.js`**: 닉네임 게이트 로직(sessionStorage `yahtzee:name`), `READY_STATE` → `myReady`/`oppReady` 매핑, 이탈 배너 처리, `submitInlineName()` 함수
- **`yahtzee/public/js/network.js`**: `sessionStorage.getItem('yahtzee:name')` 3단계 폴백(URL `?name=` → sessionStorage → 게이트), `onOpen({ hasName })` 콜백
- **`yahtzee/server.js`**: `broadcastReadyState()` 함수 신설(각 플레이어에 `READY_STATE { myReady, opponentReady }` 개별 전송)
- **`rummikub/public/index.html`**: `#name-gate-inline` 추가, `#opponent-info` + `#opponent-left-banner` 추가
- **`rummikub/public/css/style.css`**: `name-gate-inline`, `opponent-left-banner` 클래스 추가
- **`rummikub/public/js/main.js`**: DOM 참조 ID 전면 수정(`ready-btn`→`btn-ready`, `p1-ready-mark`→`my-ready-mark`, `p2-ready-mark`→`opp-ready-mark`, `ai-panel`→`waitingSolo` 구조), `onOpen({ hasName })` 핸들러, `submitInlineName()` + 클릭/Enter 이벤트, `onReadyState`/`showOpponentLeftBanner()` 핸들러, 8개 헬퍼 함수 추가
- **`rummikub/public/js/network.js`**: 닉네임 3단계 폴백(URL `?name=` → sessionStorage `rummikub:name` → 게이트), `READY_STATE`/`OPPONENT_LEFT` 라우팅 추가, `sendJoin()` API 추가

**Phase 2 — yutnori, tetris-battle (대기 화면 분리 + 신설)**
- **`yutnori/public/index.html`**: `#screen-waiting` 신설(`.game-main` 위), `waiting-card` > `waiting-logo`(주사위) + `#name-gate-inline` + `#waiting-solo`(AI 버튼) + `#opponent-info` + `#ready-panel` + 룰 요약. `.game-main`에 초기 hidden 처리(`#screen-game` 패턴)
- **`yutnori/public/css/style.css`**: `.screen-waiting`, `name-gate-inline`, `opponent-left-banner` 스타일 추가 (우드/한지 테마 유지)
- **`yutnori/public/js/main.js`**: `showScreen('waiting'/'game')` 화면 전환, 닉네임 게이트, 이탈 배너, `onOpen({ hasName })` 콜백
- **`yutnori/public/js/network.js`**: sessionStorage `yutnori:name` 3단계 폴백, `onOpen({ hasName })`
- **`yutnori/server.js`**: `broadcastReadyState()` 신설, JOIN 시 `player.name` 폴백 `'(알 수 없음)'` 확인
- **`tetris-battle/public/index.html`**: `#screen-waiting` 신설, `waiting-card` > `waiting-logo`(게임패드) + `#name-gate-inline` + `#waiting-solo`(AI 버튼) + `#ready-panel` + 룰 요약. `.center-area`에 `VS` 라벨만 유지(게임 중). `.game-main` 초기 hidden
- **`tetris-battle/public/css/style.css`**: `.screen-waiting`, `name-gate-inline`, `opponent-left-banner` 스타일 추가 (다크 테마 유지)
- **`tetris-battle/public/js/main.js`**: `showScreen('waiting'/'game')`, 닉네임 게이트, `onOpen({ hasName })` 콜백 추가, `onReadyState`/`onOpponentLeft` 핸들러 (초기 구현 시 dead code → coder fix에서 연결)
- **`tetris-battle/public/js/network.js`**: sessionStorage `tetris-battle:name` 3단계 폴백, `READY_STATE`/`OPPONENT_LEFT` 라우팅 추가
- **`tetris-battle/server.js`**: `broadcastReadyState()` 함수 신설, READY 핸들러에서 호출, disconnect 시 `OPPONENT_LEFT` 전송 추가

### 수정
- **rummikub QA FAIL 수정**: 초기 구현 시 HTML은 통일 패턴으로 갱신되었으나 JS(`main.js`, `network.js`)가 미갱신되어 페이지 로드 시 `Cannot read properties of null` 크래시 발생. DOM ID 전면 수정 + 닉네임 게이트 로직 추가 + `READY_STATE` 지원으로 해소
- **rummikub/tests/sort-buttons-qa.spec.js**: `#ready-btn` 셀렉터를 `#btn-ready`로 수정 (회귀 방지)
- **tetris-battle QA FAIL 수정 (HIGH-1 BLOCKER)**: `main.js`에 `onOpen` 콜백 누락으로 닉네임 게이트 미동작 + `network.js`에 `READY_STATE`/`OPPONENT_LEFT` 라우팅 없음 + `server.js`에 `broadcastReadyState()` 미구현. 3파일 수정으로 해소
- **yahtzee AD3 REVISE**: `#ready-panel`에 hidden 클래스가 있어 초기 비표시. hidden 클래스 제거로 오목 패턴(항상 visible)과 일치시킴

### 참고
- 스코프: `.claude/specs/2026-06-24-entry-ui-unify-scope.md`
- 플랜: `.claude/specs/2026-06-24-entry-ui-unify-plan.md`
- Phase 1 AD3: `.claude/specs/2026-06-24-entry-ui-unify-phase1-ad3-report.md` (yahtzee REVISE→재검수 APPROVED, rummikub APPROVED)
- Phase 1 QA: `.claude/specs/2026-06-24-entry-ui-unify-phase1-qa-report.md` (yahtzee PASS 13/13, rummikub FAIL→재검증 PASS 11/11, 전체 24/24 PASS)
- Phase 1 rummikub JS fix: `.claude/specs/2026-06-24-entry-ui-unify-phase1-rummikub-fix-report.md`
- Phase 2 AD3: `.claude/specs/2026-06-24-entry-ui-unify-phase2-ad3-report.md` (APPROVED, WARN 2건 비강제)
- Phase 2 QA: `.claude/specs/2026-06-24-entry-ui-unify-phase2-qa-report.md` (yutnori PASS 21/21, tetris-battle FAIL→재검증 PASS 44/44, 전체 65/65 PASS)
- Phase 2 tetris-battle fix: `.claude/specs/2026-06-24-entry-ui-unify-phase2-coder-fix-report.md`
- 통일 패턴: 오목(omok) 파일럿 — `#screen-waiting .waiting-card`, `#name-gate-inline`, `READY_STATE { myReady, opponentReady }`, `#opponent-left-banner`
- 남은 게임: Phase 3 (matgo, janggi), Phase 4 (hanabi, davinci-code, codenames-duet) 미착수

---

## [2026-06-24] - 로비 AI 슬롯 채우기 (Lobby AI Fill)

### 추가
- **`launcher/server.js`**: `aiSlotCount` 상태 변수 추가. `FILL_WITH_AI`/`CANCEL_AI_FILL` WS 메시지 핸들러. `PICK_GAME` 정원 체크에 `effectiveCount = clients.size + aiSlotCount` 적용. REDIRECT 시 `spawnBotForAiFill()` 함수로 AI 슬롯 수만큼 `?mode=bot` 쿼리 포함 bot.js spawn. `sendLobbyStateTo`에 `aiSlotCount`/`aiSlots` 필드 추가. connection 핸들러에서 AI 슬롯 양보 로직(실제 플레이어 입장 시 aiSlotCount 1 감소). 리셋 위치 4곳(전원 퇴장/호스트 disconnect/POST lobby-return/SET_TARGET)에 `aiSlotCount=0` 추가
- **`launcher/public/app.js`**: `currentAiSlotCount` 상태 변수. `updateLobbyUI`에 AI 채우기 컨트롤 표시/숨김 + 힌트 텍스트 AI 케이스. `renderPresence`에 `aiSlots` 파라미터 추가, AI 슬롯 "AI N" 이탤릭 표시. `cardClickEnabled` 수식에 `currentAiSlotCount` 포함. `setupAiFillButtons()` 함수 신규. `resetToLobby`에 `currentAiSlotCount` 리셋
- **`launcher/public/index.html`**: `#ai-fill-controls` 영역 추가 (`btn-fill-ai` "AI로 채우기" + `btn-cancel-ai` "AI 취소" + `ai-fill-hint`). player-count-selector 아래, lobby-hint 위에 배치
- **`launcher/public/style.css`**: `.ai-fill-controls`, `.ai-fill-btn`(녹색 반투명), `.ai-fill-cancel-btn`, `.ai-fill-hint`, `.presence-item.ai-slot`(이탤릭 녹색) 스타일 추가

### 수정
- **BUG-1** (`app.js` 라인 273): `updateCardPlayerDisabled(count)` -> `updateCardPlayerDisabled(count + currentAiSlotCount)`. AI 슬롯 채운 상태에서 minPlayers/maxPlayers 비교가 실제 인원만으로 계산되어 적격 게임 카드가 `player-disabled`로 비활성화되던 버그 수정

### 참고
- 스코프: `.claude/specs/2026-06-24-lobby-ai-fill-scope.md`
- 플랜: `.claude/specs/2026-06-24-lobby-ai-fill-plan.md`
- 구현 리포트: `.claude/specs/2026-06-24-lobby-ai-fill-coder-report.md`
- QA: `.claude/specs/2026-06-24-lobby-ai-fill-qa-report.md` (PASS, 15/15)
- WS 프로토콜 신규: `FILL_WITH_AI`(C->S), `CANCEL_AI_FILL`(C->S). `LOBBY_STATE`에 `aiSlotCount`/`aiSlots` 필드 확장
- AI 채우기 대상 게임: 윷놀이, 요트 다이스 (botAvailable=true + maxPlayers>=3). 루미큐브는 서버 2인 고정으로 실질 제외
- `targetPlayers=2` 기존 AI 흐름(1인 단독 -> mode=ai) 무변경

---

## [2026-06-23] - Phase 1-B: 윷놀이 N인 확장 (2~4인 가변 플레이)

### 추가
- **`yutnori/server.js`**: N인 가변 정원 (`roomMaxPlayers`). 첫 접속자의 `?players=N` 쿼리로 2~4인 설정(범위 외 기본 2). `ALL_IDS = ['p1','p2','p3','p4']` 배열에서 미사용 ID 탐색 배정(FIX-1 패턴 유지). `nextPlayer()` 헬퍼 도입(`(idx+1) % playerIds.length` 순환). 잡기 탐색 `opp.id !== mover.id` 가드로 N-1명 검사. 봇 spawn `roomMaxPlayers > 2` 시 차단 + 에러 로그. READY/REMATCH 게이트 `players.length >= roomMaxPlayers && players.every(...)`. 전원 퇴장 시 `roomMaxPlayers = 2` 리셋. `/test/inject` p1~p4 지원 + `roomMaxPlayers` injection. `REMATCH_STATUS`에 `playersReady` 배열 추가(p1Ready/p2Ready 후방 호환 병존)
- **`yutnori/public/js/ui.js`**: P3 초록(`#27ae60`)/P4 보라(`#8e44ad`) 색상. HOME 영역 Y 오프셋 `p1:-36, p2:-18, p3:0, p4:24`(겹침 회피). 보드 말 4방향 분산 오프셋 `{x:-6,y:-4},{x:6,y:-4},{x:-6,y:8},{x:6,y:8}`. GOAL 영역 N인 포지셔닝. `renderPieceStatus` 동적 상대 추적. `--p3`, `--p4` CSS 변수 추가
- **`yutnori/public/js/main.js`**: N인 레이블(P1~P4 + 색상). 동적 턴 표시. N인 rematch 상태 핸들러. N인 game-over 메시지. N인 yut 결과 레이블. `showReadyStatus` 배열 확장
- **`yutnori/public/js/piece.js`**: HOME 클릭 영역 bottom-left 통일(전 플레이어 동일, §13-9 기준)
- **`yutnori/public/index.html`**: `#ready-mark-p3`, `#ready-mark-p4` DOM 요소 추가
- **`yutnori/public/css/style.css`**: `--p3`, `--p4` CSS 변수 추가
- **`yutnori/tests/multiplayer-1b-qa.spec.js`** (신규, 22건): N인 정상 시나리오 17건(YM-001~005 + YM-001b/002b/004a~c) + 예외 시나리오 5건(YM-006~017 중 Playwright 자동화 12건)

### 변경
- **`yutnori/server.js`**: 기존 `players.length >= 2` 하드코딩을 전부 `players.length >= roomMaxPlayers`로 교체. `passTurn()`이 `opponentOf()` 대신 `nextPlayer()` 사용(N인 턴 순환). 잡기 판정이 2인 상대 고정에서 N-1인 동적 검사로 확장. `broadcastState()`는 기존 `for...of` 패턴이라 자동 확장. `opponentOf()` 함수 보존(삭제 안 함). `createApp()` 함수 보존

### 검증
- 신규 N인 QA: **22/22 PASS** (2회 연속 안정)
- 서버리스 회귀: **342/342 PASS** (yut.unit 84 + ws.scenarios 20 + rulebook-c1~c19 212 + qa-defect2 2 + qa-rulefix-edge 26)
- bot-smoke: **10/10 PASS** (YBOT-001~005)
- 전체: **374건 PASS, 0 FAIL**

### 알려진 이슈 (LOW, 비차단)
- 상대 말 패널(`#opp-pieces`)이 현재 턴 상대 1명만 표시. 4인 시 전원 표시 미지원(향후 UI 폴리시 대상)
- P3/P4 ready 마크 DOM 미존재(`#ready-mark-p3/p4` 추가됨으로 부분 해소). 기능적으로 전원 READY 대기 정상 동작
- 3~4인 disconnect 메시지 "상대방 연결이 끊겼습니다" 단수 표현(N인에서 어색)
- `/test/inject`에서 `lastPath` 필드 미복원(테스트 전용, 실 서비스 영향 없음)

### 참고
- 스펙: `.claude/specs/2026-06-23-multiplayer-plan.md` (Phase 1-B 섹션)
- 구현 리포트: `.claude/specs/2026-06-23-multiplayer-plan-1b-report.md`
- QA: `.claude/specs/2026-06-23-multiplayer-1b-qa-report.md` (PASS)

---

## [2026-05-31] - 장기 AI 봇 추가 (mode=ai 자동 spawn)

### 추가
- **`janggi/bot.js`** (신규, 215 LOC): matgo 봇 패턴을 그대로 이식한 WS 봇 클라이언트. `node bot.js --url ws://...` 단독 실행 가능
  - 메시지 라우터: `JOINED`(mySide 저장) / `STATE`(handleState) / `SETUP_PROMPT`(보조 트리거) / `GAME_OVER`/`OPPONENT_LEFT`/`ERROR`(ws.close)
  - 자기 차례 감지: `state.turn === mySide` + 중복 행동 방지 키 `phase|turn|moveCount`
  - 응답 지연 400~900ms (`400 + random*500`)
  - 마/상 배치: `'MSMS'` 고정 송신
  - DRAW_OFFERED 수신 시 무시 (묵시적 거절)
- **`chooseMove(board, side)` 1수 휴리스틱 평가 함수**:
  - `getAllLegalMoves(board, side)`로 합법 수 열거 (`wouldBeSelfCheck` 내장 필터 → 자살수 원천 차단)
  - 잡는 수: `PIECE_SCORE[target.type]` 가산 (차13/포7/마5/상3/사3/졸2)
  - 장군 보너스: `cloneBoard` + `movePiece` 후 `isInCheck(sim, opponent)`이면 +1
  - 기본 가중치 0.1 (동률 다양성 확보)
  - 최댓값 동률은 random 선택 → 동형반복 3회 자초 가능성 완화
  - 합법 수 0이면 `RESIGN` 송신 (외통수 직전 자동 기권)

### 변경
- **`janggi/server.js`**:
  - `import { spawn } from 'child_process'` 추가
  - `createApp()` → `createApp(opts = {})` 시그니처 + `opts.getBotUrl` 옵션 (기본값 `() => null`)
  - `spawnBotChild()` / `killBotChild()` 블록 이식 (matgo 패턴, prefix `[janggi]`): `fs.existsSync(botPath)` 사전 체크 + `botChild.exitCode === null` 중복 spawn 방지 + `getBotUrl()` null 가드 + `botChild.on('exit')`에서 슬롯 해제
  - connection 핸들러: `wsMode`/`ws._isBot` 추출 → `wsMode === 'ai' && !isBot` 분기에서 200ms 후 `spawnBotChild()`
  - close 핸들러: `if (!ws._isBot) killBotChild()` (봇 disconnect 시 cascade 차단)
  - 단독 실행 분기: `getBotUrl: () => 'ws://localhost:${PORT}/ws?mode=bot'` 자동 구성
- **`launcher/server.js`**: `createJanggiApp({ getBotUrl: () => 'ws://localhost:${PORT}/janggi/ws?mode=bot' })` 주입 (matgo와 동일 시그니처)
- **`launcher/public/games.json`**: janggi `botAvailable: false → true` → 1/2 AI 모드 카드 활성화 (현재 botAvailable=true: matgo + janggi 2개)

### 회귀 검증
- `npx playwright test tests/rulebook-c*.spec.js`: **111/111 PASS** (2.5s, JR-C1~C12 전부)
- `node --check`: bot.js / server.js / launcher/server.js 모두 PASS
- 통합 동작 검증 (coder 리포트 §A/B): 단독(3066) + launcher(3077) 모두 사람 입장 → 200ms 후 봇 spawn → MSMS 배치 → playing → 졸 응수 → disconnect 시 봇 자동 정리 정상

### 알려진 한계 (의도된 범위)
- 봇 강도는 1수 휴리스틱 수준 (다음 턴 상대의 잡힘 위험 평가 없음). 스펙 §봇 강도 명시 범위
- 장군 보너스(+1)가 졸 잡기(+2)보다 작아 무의미 장군보다 졸 잡기 우선 (보수적 동작, 의도)
- launcher upgrade 라우터 회귀 (직전 QA agent 발견)는 본 작업과 독립 → 별도 스펙 분리 권고

### 변경된 파일 목록
- `janggi/bot.js` (신규)
- `janggi/server.js` (수정)
- `launcher/server.js` (수정 1줄)
- `launcher/public/games.json` (수정 1플래그)

### 참고
- 목적 정의서: `.claude/specs/2026-05-31-janggi-ai-bot-scope.md`
- 스펙: `.claude/specs/2026-05-31-janggi-ai-bot-plan.md`
- 구현 리포트: `.claude/specs/2026-05-31-janggi-ai-bot-coder-report.md`
- QA: `.claude/specs/2026-05-31-janggi-ai-bot-qa-report.md` (PASS, 룰북 111/111 회귀 + 정적 + 평가 함수 리뷰 모두 PASS)

---

## [2026-05-31] - 장기 룰북 LOW 권고 5건 보강 (105 → 111 시나리오, §11 100% 커버리지)

### 추가
- **`tests/rulebook-c12-procedure.spec.js`** (신규, JR-C12-001~005, 5건): 룰북 §11-11 절차 위반 5종 회귀 가드
  - JR-C12-001: 상대 차례에 둔 수 거절 (`'당신의 차례가 아니다'`)
  - JR-C12-002: 자기 차례에 상대 기물 이동 거절 (`'자기 기물만 이동할 수 있다'`)
  - JR-C12-003: 한 제안 후 한 자기 수락 거절 (`drawOfferedBy === side` 체크)
  - JR-C12-004: 기권 후 `ended` 상태에서 MOVE 거절
  - JR-C12-005: `setup_han` 단계에서 MOVE 시도 거절
- **JR-C8-006** (신규, `rulebook-c8-draw.spec.js`): 무승부 제안 양방향 자동 취소 — 한 제안 → 초가 수를 두면 `drawOfferedBy=null`

### 변경
- **JR-C5-006/010 강화** (`rulebook-c5-repetition.spec.js`): 종료 시 덤 1.5 정확 검증 추가
  - `endScores.cho === rawScores.cho + DEOM`, `endScores.cho - rawScores.cho === 1.5`
  - 포획 없는 사이클 가드: `han === 72`, `cho === 73.5`
  - `calculateScore`, `DEOM` import 추가
- **JR-C10-004 재구성** (`rulebook-c10-bigcheck.spec.js`): 빅장 응수 컨텍스트 재구성
  - "초 차(0,1)가 한 궁(4,1)에 가로 장군 직후" setup → 한이 무관계 차로 응수 시도 → `wouldBeSelfCheck=true`로 자살수 거절
  - 룰북 §8-6(빅장) + §8-3(자살수) 동시 인용으로 의도 명확화
- **JR-C1 5개 케이스 정밀도 강화** (`rulebook-c1-pieces.spec.js`): `arrayContaining` → length + set 비교
  - JR-C1-001(궁 중앙 8), JR-C1-002(대각 4), JR-C1-010(포 가로 5), JR-C1-016(한 졸 3), JR-C1-018(초 병 3)
  - 의도 외 후보 추가/누락 시 즉시 spec 깨짐 → 회귀 안전망

### 카테고리 분포 (105 → 111)
| 카테고리 | 파일 | 이전 | 현재 |
|---------|------|------|------|
| C8 무승부/기권 | rulebook-c8-draw.spec.js | 5 | 6 (+006) |
| C12 절차 위반 | rulebook-c12-procedure.spec.js (신규) | 0 | 5 |
| **합계** | | **105** | **111** |

### §11 금지 수 커버리지
- 이전 10/11 (절차 위반 항목만 MISS, probe로만 확인)
- 현재 **11/11 (100%)** — 절차 위반이 JR-C12 5건으로 spec 가드됨

### QA 판정
- **PASS** (이전 CONDITIONAL_PASS → 격상)
- 5회 연속 111/111 PASS (평균 2.0초, flaky 0건)
- 회귀: 비-rulebook spec 135/135 PASS (1.9초)
- lib/룰북 코드 변경 없음 — 테스트 보강만으로 안전망 강화

### 알려진 트레이드오프 (수용)
- JR-C10-004 사전 `inCheck` assert는 주석으로만 명시 (helpers `isInCheck` re-export 없음)
- JR-C8-006의 `state.turn = 'cho'` 직접 조작 — `drawOfferedBy` side-무관 동작 검증 핵심에 영향 없음
- JR-C5-006/010의 `han=72/cho=73.5` 가정 — `PIECE_SCORE`/`DEOM` 변경 시 알람 (의도된 동작)

### 변경된 파일 목록
- `janggi/tests/rulebook-c12-procedure.spec.js` (신규)
- `janggi/tests/rulebook-c1-pieces.spec.js` (5개 케이스 강화)
- `janggi/tests/rulebook-c5-repetition.spec.js` (006/010 보강)
- `janggi/tests/rulebook-c8-draw.spec.js` (+006)
- `janggi/tests/rulebook-c10-bigcheck.spec.js` (004 재구성)

### 참고
- 스펙: `.claude/specs/2026-05-31-janggi-rulebook-low-fix-plan.md`
- 구현 리포트: `.claude/specs/2026-05-31-janggi-rulebook-low-fix-coder-report.md`
- QA: `.claude/specs/2026-05-31-janggi-rulebook-low-fix-qa-report.md` (PASS, 격상)

---

## [2026-05-31] - 장기(Janggi) 신규 게임 추가

### 추가
- **6번째 게임 "장기"**: `janggi/` 디렉토리 신설. KJA 2009 개정 룰(빅장 폐지, 점수제, 동형반복 3회) 준수 LAN 1:1 한국 전통 장기
- **서버 게임 로직 5개 모듈** (`janggi/lib/`):
  - `board.js`: 9x10 보드 CRUD, 4종 마/상 배치(MSMS/SMSM/MSSM/SMMS), 직렬화, 동형반복용 해시
  - `pieces.js`: 7종 기물 합법 이동 산출 (궁/사/차/포/마/상/졸). 포다리 규칙, 마/상 멱 차단, 궁성 대각선 포함
  - `rules.js`: 장군/외통수/자살수/양수겸장/동형반복 판정
  - `score.js`: 기물 점수표(K=0, A=3, R=13, C=7, H=5, E=3, P=2) + 후수 덤 1.5
  - `game.js`: GameSession 상태 관리 (배치 선택 -> 플레이 -> 종료). 종료 조건 5가지(외통수, 기권, 시간패, 동형반복 3회, 50수 룰). 시간제 본 시간 10분 + 초읽기 30초x3회
- **WebSocket 서버** (`janggi/server.js`): createApp() 팩토리 패턴. WS 메시지 C->S 6종 + S->C 10종. 1초 tick 타이머, 배치 30초 타이머, heartbeat 30초, 재접속 복구. 단독 포트 3006
- **클라이언트 UI** (`janggi/public/`):
  - Canvas 보드 렌더링 592x672px (격자선, 강 띠 楚河漢界, 궁성 대각선 X)
  - 기물 DOM 렌더링 (한자 표기, 팔각형 clip-path, 한 적색 #C8102E / 초 청색 #2E5BBA)
  - CSS 변수 18개, check-pulse 애니메이션, 런처 일관 radial-gradient 배경
  - 배치 선택 모달 (4종 카드 + 30초 카운트다운)
  - 합법 수 하이라이트 (이동/잡기 구분, 서버 권위 REQUEST_MOVES)
  - 시간 패널 (MM:SS + 초읽기), 잡힌 기물 패널, 장군 토스트, 종료 모달 (승/패 + 점수)
  - 헤더에 `#btn-back-to-lobby` (기존 5개 게임과 동일 ID/confirm 패턴)
- **런처 통합** (`launcher/server.js`, `launcher/public/games.json`):
  - `createJanggiApp()` import + `GAME_APPS` 등록
  - games.json에 janggi 항목 추가 (color: #C8102E, botAvailable: false)
  - 콘솔 배너 게임 목록에 `/janggi/` 추가
- **Playwright 테스트** (`janggi/tests/`):
  - `janggi.spec.js`: QA-001~QA-020 커버 77개 (서버 lib 직접 호출형 단위 테스트)
  - `qa-edge-cases.spec.js`: QA 도출 엣지케이스 58개 (상 경계값, 포 궁성 대각선, 배치 코드 16종 전수 검증 등)
  - `qa-e2e.spec.js`: 브라우저 E2E 5개 (초기 로딩, 배치 모달, 보드 렌더링, 모바일 뷰포트, 3인 거절)
- **스모크 테스트**: `_smoke.js` 73개 + `_smoke_server.js` 34개 + `_smoke_launcher.js` 19개

### 수정
- **PATCH-P2-1 (AD 모드3 REVISE)**: `public/js/main.js`에서 기물 클릭 시 piecesLayer와 boardContainer 핸들러가 동시 발화되어 합법 수 하이라이트가 표시되지 않는 버그. piecesLayer/highlightsLayer 핸들러에 `e.stopPropagation()` 추가로 해결
- **PATCH-P4-1 (상 이동 패턴)**: `lib/pieces.js`의 `getElephantMoves`에서 상(elephant) 최종 변위가 (+-3,+-3)으로 잘못 계산되던 버그. endDf/endDr 값을 (+-1,+-1)로 교정하여 룰북 SS5-6 기준 (+-2,+-3)/(+-3,+-2) 변위로 정상화

### 스펙 대비 구현 차이
- 스펙의 `GameSession` 클래스 대신 순수 함수 + 상태 객체 패턴 채택 (직렬화 단순화, davinci-code 패턴 일관성)
- 기물 타입 내부 표현: 스펙 약어(K/A/R/C/H/E/P) 대신 풀네임(`king`/`advisor` 등) 사용 (가독성). 해시에서만 약어
- games.json color: 스펙 `#8B1A1A` -> AD 컨셉 확정 `#C8102E` (한국 적색)
- 궁성 대각선 인접 관계: 런타임 계산 대신 정적 매핑(PALACE_DIAG_ADJ) 사전 빌드

### QA 판정
- **PASS** (140개 테스트 전체 통과)
- AC-1 ~ AC-8 수용 기준 전부 충족
- 24개 엣지케이스 시나리오 전부 PASS
- 6개 게임 런처 회귀 PASS

### 알려진 이슈 (MEDIUM/LOW, 기능 영향 없음)
- `public/js/ui.js`: `showCheckToast()`/`showToast()` 함수에서 `replaceChild` 후 stale DOM 참조. 연속 호출 시 두 번째 알림 미표시
- 무승부 거절 시 서버에 `DRAW_REJECT` 미전송. 제안측에 "거절됨" 피드백 없음 (수 두면 자동 초기화)

### 변경된 파일 목록
- `janggi/server.js`, `janggi/lib/{board,pieces,rules,score,game}.js` (신규 6개)
- `janggi/public/index.html`, `janggi/public/css/style.css`, `janggi/public/js/{main,board,pieces,ui}.js` (신규 6개)
- `janggi/tests/{janggi.spec,qa-edge-cases.spec,qa-e2e.spec,helpers}.js`, `janggi/playwright.config.js` (신규 5개)
- `janggi/lib/{_smoke,_smoke_server,_smoke_launcher}.js` (신규 3개)
- `launcher/server.js` (수정 3개소: import, GAME_APPS, 배너)
- `launcher/public/games.json` (수정: janggi 항목 추가)

### 참고
- 목적 정의서: `.claude/specs/2026-05-31-janggi-add-scope.md`
- 스펙: `.claude/specs/2026-05-31-janggi-add-plan.md`
- 룰북: `.claude/specs/2026-05-31-janggi-rulebook.md`
- Coder P1: `.claude/specs/2026-05-31-janggi-coder-p1-report.md`
- Coder P2: `.claude/specs/2026-05-31-janggi-coder-p2-report.md`
- AD2/AD3: `.claude/specs/2026-05-31-janggi-ad2-ad3-report.md` (APPROVED, PATCH-P2-1 적용)
- Coder P3: `.claude/specs/2026-05-31-janggi-coder-p3-report.md`
- Coder P4: `.claude/specs/2026-05-31-janggi-coder-p4-report.md` (PATCH-P4-1 상 이동 수정)
- QA: `.claude/specs/2026-05-31-janggi-qa-report.md` (PASS, 140개)

---

## [2026-05-31] - 5개 게임 게임 중 상시 뒤로가기 버튼 추가

### 추가
- **`#btn-back-to-lobby` 버튼**: 5개 게임(matgo, tetris-battle, davinci-code, yutnori, codenames-duet)의 헤더/메타패널에 "← 게임 선택" 상시 표시 버튼 추가. 게임 진행 중 언제든 로비(`/`)로 복귀 가능
- **confirm 다이얼로그**: 버튼 클릭 시 `confirm('게임을 중단하고 게임 선택 화면으로 돌아가시겠어요? 상대방도 함께 로비로 이동합니다.')` 표시. 취소 시 동작 없음
- **양쪽 동시 로비 복귀**: P1이 confirm 수락 -> `fetch('/lobby/return')` + `location.href = '/'`. P1 WS 연결 종료 -> 게임 서버가 P2에 disconnect 메시지 전송 -> P2 클라이언트가 path 기반 런처 모드 판정 후 1.2초 딜레이로 자동 redirect
  - matgo/davinci-code/codenames-duet: `OPPONENT_LEFT` 핸들러에 런처 모드 감지 + redirect 추가
  - tetris-battle: `GAME_RESULT` (reason=disconnect) 핸들러에 런처 모드 감지 + redirect 추가
  - yutnori: `GAME_OVER` (reason=disconnect) 핸들러에 런처 모드 감지 + redirect 추가
- **게임별 고스트 버튼 CSS**: 각 게임 팔레트에 맞춘 투명 고스트 스타일 적용
  - matgo: gold-soft 60% 투명 (`.meta-panel .btn-back-to-lobby`, 특이도 0,2,0)
  - tetris-battle: accent 민트 50% 투명 + flex-shrink:0
  - davinci-code: wheat 55% 투명 + `.back-stat` 래퍼 + `.topbar-stats { flex-wrap: wrap }`
  - yutnori: text-dim 60% 투명 + flex-shrink:0
  - codenames-duet: wheat 55% 투명 + `.back-stat` 래퍼 + `.topbar-stats { flex-wrap: wrap }`
- **QA 테스트**: `tests/back-button-qa.spec.js` (BB-01~BB-10, 14개), `tests/back-button-extended-qa.spec.js` (EQ-1~EQ-7, 24개)

### 수정
- **matgo CSS 특이도 버그 (QA v1 FAIL-1)**: `.btn-back-to-lobby` (0,1,0)이 `.meta-panel button` (0,1,1)에 패배하여 gold gradient가 표시됨 -> `.meta-panel .btn-back-to-lobby` (0,2,0)으로 셀렉터 변경하여 투명 고스트 정상 적용
- **양쪽 동시 로비 복귀 미동작 (QA v1 FAIL-2)**: `POST /lobby/return`의 `RETURN_LOBBY` broadcast가 런처 WS에만 도달하여 게임 페이지 P2에 전달 안됨 -> 서버 코드 변경 없이 기존 disconnect 감지 메커니즘 활용 + 클라이언트 측 path 기반 런처 모드 판정 + 1.2초 딜레이 redirect로 해결

### 변경된 파일 목록
- `matgo/public/index.html`, `matgo/public/style.css`, `matgo/public/client.js`
- `tetris-battle/public/index.html`, `tetris-battle/public/css/style.css`, `tetris-battle/public/js/main.js`
- `davinci-code/public/index.html`, `davinci-code/public/style.css`, `davinci-code/public/client.js`
- `yutnori/public/index.html`, `yutnori/public/css/style.css`, `yutnori/public/js/main.js`
- `codenames-duet/public/index.html`, `codenames-duet/public/style.css`, `codenames-duet/public/client.js`
- `tests/back-button-qa.spec.js` (신규), `tests/back-button-extended-qa.spec.js` (QA 자체 작성)

### 참고
- 스펙: `.claude/specs/2026-05-31-minigame-back-button-plan.md`
- 목적 정의서: `.claude/specs/2026-05-31-minigame-back-button-scope.md`
- 구현 리포트 v1: `.claude/specs/2026-05-31-minigame-back-button-coder-report.md`
- 구현 리포트 v2: `.claude/specs/2026-05-31-minigame-back-button-coder-report-v2.md` (QA FAIL 수정)
- AD3: `.claude/specs/2026-05-31-minigame-back-button-ad3-report.md` (APPROVED)
- QA v1: `.claude/specs/2026-05-31-minigame-back-button-qa-report.md` (FAIL -- FAIL-1 CSS 특이도, FAIL-2 양쪽 복귀)
- QA v2: `.claude/specs/2026-05-31-minigame-back-button-qa-report-v2.md` (PASS -- 59개 전체 통과, BB-10 테스트 타이밍 이슈는 기능 정상)
- 서버 코드(launcher/server.js, 5개 게임 server.js) 변경 없음
- 기존 `#btn-return-lobby`(결과 화면) 유지, 새 `#btn-back-to-lobby`(상시)와 ID 분리
- 기존 회귀: lobby-ux-reqa 21/21 PASS, T-10~T-14 PASS
- BB-10 테스트 잔존 이슈: WS 연결 대기 타이밍 부족으로 CI에서 간헐 FAIL 가능. `await p2.waitForTimeout(500)` 추가 권장

---

## [2026-05-30] - 다빈치 코드 플러스 (3색 룰업)

### 추가
- **3색 타일 구성**: 기존 흑/백 2색(24장)을 빨강/노랑/파랑 3색(39장)으로 전면 교체. 각 색상별 0~11 숫자 12장 + 조커 1장 = 13장 x 3색 = 39장
- **조커 배치 페이즈**: 게임 시작 직후 `awaiting_joker_placement` 페이즈 진입. 양쪽 모두 조커를 손패 원하는 위치에 배치 완료 후 게임 시작 (`drawForCurrentTurn` -> `awaiting_guess`)
- **`placeJoker(state, playerId, insertAfter)` 함수**: 조커를 손패 `insertAfter+1` 위치에 splice 삽입. 양쪽 배치 완료 시 자동 전환
- **조커 추측 UI**: 추측 패널에 "조커?" 버튼(`#btn-guess-joker`, `.btn-joker-guess` 보라색 #7d3c98) 추가. `{ type: 'GUESS', slot: N, value: null }` 전송
- **조커 배치 UI**: `#joker-place-panel`에 손패 수+1개 배치 버튼(`.btn-slot-place`) 렌더링, 조커 뱃지에 색상 표시
- **3색 메모판**: 빨강/노랑/파랑 각 12칸 + 조커 3칸 = 39칸. `.memo-tile.red-tile/.yellow-tile/.blue-tile/.joker-tile` CSS 클래스
- **PLACE_JOKER 서버 핸들러**: `server.js`에 PLACE_JOKER 메시지 케이스 추가, `placeJoker` import

### 변경
- `game.js` (541줄): `COLORS = ['red', 'yellow', 'blue']`, `buildFullDeck()` 39장, `sortHand()` 조커 위치 보존, `createGame()` 조커 분리(`unplacedJokers`) + `awaiting_joker_placement` 시작, `guess()` value=null 허용 (조커 추측), `snapshotForPlayer()` 조커 관련 필드 포함
- `server.js` (416줄): PLACE_JOKER 핸들러, GUESS 로그 가독성 개선 (`val=JOKER`)
- `public/client.js` (628줄): `initMemoBoard()` 3색 39칸, `renderJokerPlacement()`, `updateActionPanel()` 조커 배치 페이즈, `renderOppHand()`/`renderMyHand()` 3색+조커 표시, `btnGuessJoker` 핸들러, `addGuessHistory()` 조커 중복 방지 키
- `public/style.css` (672줄): 흑/백 CSS 전부 삭제 (`.card.black/.white`, `.pending-card.black/.white`, `.memo-tile.black-tile/.white-tile`), red/yellow/blue 카드 색상 추가, `.card.joker::after` 별표 오버레이, 조커 배치/추측 UI 스타일
- `public/index.html` (118줄): 타이틀 "DA VINCI CODE+", `#joker-place-panel` 추가, `#btn-guess-joker` 추가

### 수정
- **CSS 유니코드 이스케이프 (LOW)**: `style.css`의 `.card.joker::after` content에서 `\u2605` (JS 방식) -> `\2605` (CSS 방식)으로 수정. 수정 전에는 "u2605" 텍스트가 표시되었으나, font-size 0.65rem + opacity 0.7로 사용성 영향 미미

### 참고
- 스펙: `.claude/specs/2026-05-30-davinci-plus-plan.md`
- 목적 정의서: `.claude/specs/2026-05-30-davinci-plus-scope.md`
- 구현 리포트: `.claude/specs/2026-05-30-davinci-plus-coder-report.md`
- AD3: `.claude/specs/2026-05-30-davinci-plus-ad3-report.md` (APPROVED, 23항목 전 PASS)
- QA: `.claude/specs/2026-05-30-davinci-plus-qa-report.md` (PASS, 단위 53개 + E2E 25개 = 78개 전체 통과)
- QA 테스트: `davinci-code/tests/game-unit-qa.spec.js` (53개), `davinci-code/tests/davinci-plus-qa.spec.js` (25개)
- 정렬 규칙: value 오름차순, 동점 시 red < yellow < blue. 조커는 배치 위치 고정
- 색상 값: red=#c0392b, yellow=#f1c40f, blue=#2980b9

---

## [2026-05-30] - 다빈치 코드 UI 전면 개편 (2-column 레이아웃)

### 추가
- **2-column Grid 레이아웃**: `.play-area`를 `display: grid; grid-template-columns: 1fr 300px`으로 전환. 좌 컬럼(`.game-board`)에 게임보드, 우 컬럼(`.info-panel`)에 정보 패널 배치
- **숫자 메모판**: 우 패널 상단에 흑 0~11(12칸) + 백 0~11(12칸) = 24칸 타일. 공개된 카드에 대응하는 타일에 `.used` 클래스 적용 (opacity 0.25, line-through)
- **추측 기록 누적 표시**: 우 패널 하단에 추측 기록을 클라이언트 메모리에 누적하여 스크롤 가능한 목록으로 표시. 최신 항목이 맨 위. `lastHistoryKey`(from+slot+value 3-tuple)로 중복 추가 방지
- **`initMemoBoard()`**: 모듈 로드 시 호출하여 게임 시작 전에도 24타일 표시
- **`addGuessHistory()`**: `lastGuess` 신규 항목을 prepend 방식으로 추가
- **`resetGuessHistory()`**: `GAME_START` 수신 시 추측 기록 + 메모판 초기화

### 변경
- `davinci-code/public/index.html`: `.game-board` 좌 컬럼 래퍼 추가, `action-panel`을 `<main>` 내부로 이동, `#last-guess` 엘리먼트 제거, `<aside class="info-panel">` 추가 (메모판 + 추측 기록 DOM)
- `davinci-code/public/style.css`: `.play-area` flex -> CSS Grid 전환, 카드 크기 `.card`/`.pending-card` 80x110px, `.deck-card` 86x118px으로 확대, `.hand` max-width 1000px -> 100%, `.info-panel`/`.memo-board`/`.memo-tile`/`.guess-history-panel`/`.history-item` 신규 스타일 추가, `.last-guess` 관련 규칙 제거
- `davinci-code/public/client.js`: `lastGuessEl`/`renderLastGuess()` 제거, `memoBoardEl`/`guessHistoryEl` DOM 참조 추가, `renderState()` 내에서 `renderMemoBoard()` + `addGuessHistory()` 호출로 교체

### 스펙 대비 구현 차이
- `.play-area` gap: 스펙 16px -> 구현 0 (border-left로 시각적 구분 대체, QA 허용)
- `.memo-tile.used` opacity: 스펙 0.3 -> 구현 0.25 (시각적 차이 미미, QA 허용)
- 추측 기록 렌더링: 스펙의 전체 재렌더 방식 대신 prepend + `lastHistoryKey` 중복 방지 방식으로 구현 (동일 결과, 성능 개선)

### 변경된 파일 목록
- `davinci-code/public/index.html`, `davinci-code/public/style.css`, `davinci-code/public/client.js`

### 참고
- 스펙: `.claude/specs/2026-05-30-davinci-ui-overhaul-plan.md`
- 구현 리포트: `.claude/specs/2026-05-30-davinci-ui-overhaul-coder-report.md`
- QA: `.claude/specs/2026-05-30-davinci-ui-overhaul-qa-report.md` (26개 테스트 전체 PASS)
- QA 테스트: `tests/davinci-ui-overhaul-qa.spec.js`
- server.js, game.js 미수정. WebSocket 프로토콜 변경 없음.

---

## [2026-05-30] - 로비 UX 개선

### 추가
- **단일 화면 로비**: `lobby-view`와 `game-select-view`를 하나의 `lobby-view`로 통합. 접속 즉시 게임 카드 5개 표시
- **투표 시스템**: 게임 카드에 투표 버튼 추가. `VOTE_GAME` WS 메시지로 toggle 방식 투표, `LOBBY_STATE`에 `votes` 필드 포함하여 실시간 갱신
- **로비 복귀 버튼**: 5개 게임 완료 화면에 "다른 종목" 버튼 추가. `POST /lobby/return` HTTP 엔드포인트 호출 -> 서버가 `RETURN_LOBBY` broadcast -> 양쪽 동시 복귀
- **봇 미지원 게임 차단 (3중 가드)**: 1/2 AI 모드에서 봇 없는 게임 선택 차단
  - CSS: `.game-grid.ai-mode .game-card.no-bot` (opacity 0.5, grayscale, pointer-events:none, "AI 봇 미지원" 배지)
  - JS: `pick()` 핸들러에서 `currentCount` 기반 `effectiveMode` 판단, `showStatus()` 안내 메시지
  - 서버: `PICK_GAME` 핸들러에서 `isAiMode && !game.botAvailable` 검증, ERROR 메시지 반환
- **`lobby-meta` UI 영역**: 인원 카운트(72px), 역할 표시, 힌트 텍스트를 카드 그리드 상단에 배치

### 변경
- `launcher/server.js`: `lobbyPhase` 변수 제거, `votes` Map 추가, `PICK_GAME`에서 lobbyPhase 가드 제거 (카드 클릭 시점에 mode 결정), `sendLobbyStateTo`에 votes 직렬화 포함, disconnect 핸들러에 `votes.clear()` 추가
- `launcher/public/index.html`: `start-btn` 제거, `game-select-view` 블록 제거, 단일 `lobby-view`로 재구성
- `launcher/public/app.js`: `transitionTo`/`currentPhase`/`cardsRendered`/`SELECT_VIEW_ID` 제거, `currentVotes`/`cardClickEnabled`/`currentCount` 상태 추가, `updateLobbyUI` 재작성, `RETURN_LOBBY`/`PHASE`(무시) 핸들러 추가
- `launcher/public/style.css`: `.start-btn`/`.game-select-view` 관련 스타일 제거, `.lobby-meta`/`.game-card-vote`/`.game-grid.guest-mode`/`.game-grid.ai-mode` 스타일 추가
- WS 프로토콜: `START`(C->S), `PHASE`(S->C) 제거. `VOTE_GAME`(C->S), `RETURN_LOBBY`(S->C) 추가. `LOBBY_STATE`에 `votes` 필드 추가

### 수정
- **EX-07 (HIGH)**: 1/2 AI 모드에서 botAvailable=false 게임(yutnori, tetris-battle, davinci-code, codenames-duet) 선택이 차단되지 않던 버그 -> 3중 가드로 수정
- **힌트 텍스트 중복 (LOW)**: 게스트 2/2 화면에서 `#lobby-hint`와 `#guest-waiting`에 동일 텍스트가 중복 표시되던 문제 -> 게스트일 때 `#lobby-hint`를 비워서 해소
- **ai-mode CSS 미적용 (LOW)**: `updateLobbyUI()`에서 `grid.classList.toggle('ai-mode', count === 1)` 누락 -> 추가하여 봇 미지원 카드 시각적 비활성화 정상 동작

### 변경된 파일 목록
- `launcher/server.js`, `launcher/public/index.html`, `launcher/public/app.js`, `launcher/public/style.css`
- `matgo/public/index.html`, `matgo/public/client.js`, `matgo/public/style.css`
- `yutnori/public/index.html`, `yutnori/public/js/main.js`, `yutnori/public/css/style.css`
- `tetris-battle/public/index.html`, `tetris-battle/public/js/main.js`, `tetris-battle/public/css/style.css`
- `davinci-code/public/index.html`, `davinci-code/public/client.js`, `davinci-code/public/style.css`
- `codenames-duet/public/index.html`, `codenames-duet/public/client.js`, `codenames-duet/public/style.css`

### 참고
- 스펙: `.claude/specs/2026-05-30-lobby-ux-scope.md`
- 플랜: `.claude/specs/2026-05-30-lobby-ux-plan.md`
- 구현 리포트: `.claude/specs/2026-05-30-lobby-ux-coder-report.md`
- QA: `.claude/specs/2026-05-30-lobby-ux-qa-report.md`
- QA 테스트: `tests/lobby-ux-qa.spec.js` (26개), `tests/lobby-ux-reqa.spec.js` (21개)
