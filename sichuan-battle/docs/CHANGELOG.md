# Changelog

## [2026-07-25] - 아이템 연속 사용·효과 공정성·HUD 재배치

### 변경

- 아이템을 잠금·뒤집기·안개·힌트·정화·방어막 6종으로 정리하고 강제 셔플을 정의·드롭·사용·AI·UI·ko/en에서 제거했다. 남은 가중치 합계 88을 기준으로 기존 상대 가중치를 유지한다.
- 서버가 `matchId + slotId` 소유권과 `requestId` 중복 캐시로 사용을 판정하도록 바꿔, 같은 초기 `inventoryRevision`으로 보낸 서로 다른 3슬롯도 250ms 동기화 전에 각각 한 번 처리한다.
- 일반·공격 쿨다운과 활성 공격 기반 `TARGET_BUSY`를 제거하되 `USE_ITEM` 초당 8회, 전체 메시지 초당 30회 제한, 정화 면역과 방어막은 유지했다.
- 잠금 6장·뒤집기 16장·안개 18장을 경기 seed, 사용자, 사용 순번과 item ID에서 파생한 결정적 PRNG로 유효 후보 전체에 분산한다.
- 데스크톱 HUD를 `아이템 | 내 보드 | 상대 보드`, 모바일을 `내 보드 → 아이템 → 상대 보드` 순서로 재배치했다.

### 수정

- 힌트 효과의 `targets`가 공개 snapshot에서 누락되어 효과 칩만 보이던 직접 원인을 수정했다. 본인에게 합법 짝 두 타일만 3초 공개하고 상대에게 targets와 내부 path를 숨긴다.
- 좌표순 타일 배열에 `slice(0, maximum)`을 적용해 방해 대상이 항상 윗줄에 몰리던 직접 원인을 결정적 Fisher–Yates 비복원 선택으로 교체했다.
- 효과 종료가 모든 방해 플래그를 함께 지워 중첩 효과가 조기 해제되던 문제를 남은 활성 효과 전체의 플래그 재계산으로 수정했다.
- QA F-01에서 `shuffleRemaining()`이 타일 플래그를 초기화한 뒤 활성 효과를 복원하지 않아 자동 교착 셔플과 효과 칩이 불일치하는 문제를 발견했다. `shufflePlayer()`가 셔플 직후 `recomputeDisruptionFlags()`를 호출하도록 수정해 동일 tileId의 잠금·뒤집기·안개를 만료 전까지 유지한다.
- 공유 room 정리 타이밍에 의존하던 2브라우저 연타 테스트를 단일 사람과 인증 AI 조합으로 격리하고, 동기화 경합 테스트는 같은 브라우저 작업 안에서 DOM identity·focus를 원자적으로 검증하도록 보정했다.

### 검증

- AD 모드 3 Round 1에서 1366×768, 1024×768, 390×844의 새 레이아웃·힌트·효과 칩을 `APPROVED`했다.
- F-01 수정 후 AD 모드 3 Round 2에서 자동 셔플 뒤 잠금 6장·뒤집기 16장·안개 18장과 효과 칩 3개의 일치, 세 viewport의 비중첩·무가로 overflow를 다시 `APPROVED`했다.
- 최종 QA Round 2에서 집중 Node 20/20, 전체 Node 52/52, 관련 Playwright 10/10, 변경 JavaScript 문법 검사와 `git diff --check`를 통과해 `PASS` 판정을 받았다.
- 빠른 3슬롯 사용, request dedup, 소비 슬롯 재사용 거절, 힌트 본인 공개·상대 비공개, 결정적 대상 분산, 중첩 만료, 정화·면역·방어막, AI와 ko/en 회귀를 확인했다.

### 참고

- 스펙: `../../../.Codex/specs/2026-07-25-sichuan-item-flow.md` (`COMPLETED`)
- 구현 리포트: `../../../.Codex/specs/2026-07-25-sichuan-item-flow-report.md`
- UI 검수: `../../../.Codex/specs/2026-07-25-sichuan-item-flow-ad3.md` (`APPROVED`, Round 2)
- QA: `../../../.Codex/specs/2026-07-25-sichuan-item-flow-qa.md` (`PASS`, Round 2)
- `assets/` 변경이 없어 Mockup Sync와 `studio-mockup` 동기화를 생략했다.

## [2026-07-23] - 주기 동기화 중 타일 클릭 유실 수정

### 변경

- `BoardView`가 250ms `STATE_SYNC`마다 96개 버튼을 교체하지 않고 `tileId` keyed DOM을 재사용하도록 변경했다.
- 타일 click을 보드 루트 한 곳에서 위임 처리하고, disabled·ARIA·locale·뒤집기 자식과 시각 상태를 기존 노드에 갱신한다.
- WebSocket이 실제 OPEN 상태에서 전송에 성공한 요청만 pending으로 만들고 PAIR 응답을 `requestId + matchId`로 조율한다.
- pending에 2초 응답 제한을 추가하고 revision·셔플·연결 종료·재대결·경기 전환에서 타이머와 transient 상태를 정리한다.

### 수정

- `pointerdown`과 `pointerup` 사이의 주기 동기화가 활성 버튼을 제거해 합성 `click`이 유실되던 간헐적 입력 무반응을 수정했다.
- 미연결·전송 예외·응답 유실에서 보드가 pending 상태로 영구 비활성화되거나 늦은 응답이 현재 선택을 지우는 문제를 방지했다.

### 검증

- 결정적 `pointerdown → STATE_SYNC → pointerup`, 실제 터치, Space/Enter와 120회 선택/취소 스트레스 테스트를 추가했다.
- 입력 신뢰성 spec 5회 반복 15/15, 전체 Playwright 12/12, 전체 Node 42/42와 변경 JavaScript 문법 검사를 통과했다.
- 독립 QA에서 실제 250ms 동기화와 고정 시드 128회 입력, send 예외·reset 격리 시나리오 2/2를 통과했다.
- page error, console error, 테스트 hang과 잔류 서버가 없음을 확인했다.

### 참고

- 스펙: `../../../.Codex/specs/2026-07-23-sichuan-battle-intermittent-click-drop.md` (`COMPLETED`)
- 구현 리포트: `../../../.Codex/specs/2026-07-23-sichuan-battle-intermittent-click-drop-report.md`
- QA: `../../../.Codex/specs/2026-07-23-sichuan-battle-intermittent-click-drop-qa.md` (`PASS`)
- `visual_change: none`이며 `assets/` 변경이 없어 Art Director 검수와 Mockup Sync를 생략했다.

## [2026-07-23] - 독립 듀얼 보드 및 입력 피드백 복구

### 추가

- 큰 내 조작 보드와 상대의 실제 진행 상태를 보여주는 읽기 전용 12×8 축소 보드를 PvP·AI 화면에 동시에 표시했다.
- 개인화 snapshot의 `opponent.board`에 해답·인벤토리 등 비공개 정보를 제외한 공개 보드 사본을 추가했다.
- 첫 선택, 판정 대기, 성공 경로·제거, 문양 불일치·경로 불가 등 사유별 실패를 보드 상태와 ko/en 문구로 표시했다.
- 390×844에서 `내 보드 → 상대 보드 → 아이템` 순서로 접근 가능한 세로 레이아웃을 추가했다.

### 변경

- `public/js/board-view.js`를 조작/읽기 전용 인스턴스로 분리 운용하고, 250ms 상태 동기화 재렌더 뒤에도 선택·pending 상태를 복원하도록 재구성했다.
- 승인·거절 응답에 원 요청 `requestId`를 연결해 오래된 응답이 현재 입력 상태를 지우지 않게 했다.
- 공개 보드 직렬화에서 `solution` 필드를 구조적으로 제외하고 양쪽 보드의 revision·제거·효과 상태를 독립 동기화했다.

### 수정

- 첫 타일 클릭 강조가 주기적 `STATE_SYNC` 뒤 사라져 선택 여부를 알 수 없던 문제를 수정했다.
- 두 번째 클릭 뒤 성공·실패가 불명확하고 pending 중 추가 짝 요청이 가능하던 문제를 수정했다.
- 한 플레이어의 제거가 본인 주 보드와 상대편 축소 보드에만 반영되도록 독립 보드 표시를 복구했다.

### 검증

- Node 테스트 42/42, Playwright 7/7과 변경 JavaScript `node --check`, `git diff --check`를 통과했다.
- 1366×768, 1024×768, 390×844에서 양쪽 보드 비중첩·무가로 overflow, 모바일 순서와 읽기 전용 상대 보드를 확인했다.
- AD 모드 3 `APPROVED`, 최종 QA `PASS`를 기록했다.
- 비차단 제약으로 390px 내 타일 약 28×30px와 `/favicon.ico` 404 메시지를 확인했다.

### 참고

- 스펙: `../../../.Codex/specs/2026-07-23-sichuan-battle-dual-board-playability.md` (`COMPLETED`)
- 구현 리포트: `../../../.Codex/specs/2026-07-23-sichuan-battle-dual-board-playability-report.md`
- UI 검수: `../../../.Codex/specs/2026-07-23-sichuan-battle-dual-board-playability-ui-review.md` (`APPROVED`)
- QA: `../../../.Codex/specs/2026-07-23-sichuan-battle-dual-board-playability-qa.md` (`PASS`)
- `assets/` 변경이 없어 Mockup Sync와 `studio-mockup` 동기화는 생략했다.

## [2026-07-23] - AI 대전 모드

### 추가

- 런처 `AI 채우기`와 게임 대기 화면 `AI 대전` CTA에서 한 명이 즉시 시작하는 서버 권위 AI 모드를 추가했다.
- AI는 서버 발급 일회성 토큰으로만 WebSocket 봇 슬롯에 참여하며, 일반 사용자의 `mode=bot` 위장을 차단한다.
- AI가 개인화된 실제 보드 snapshot에서 최대 2회 꺾임·외곽 경로의 합법 짝을 찾아 기존 `MATCH_PAIR` 검증으로 제거하도록 구현했다.
- 첫 행동 900~1,700ms, 일반 짝 850~1,550ms, 아이템 550~1,200ms의 가변 지연과 숙고·휴지·방해 효과 반응을 적용한 보통 난이도를 추가했다.
- 기존 72%+pity 드롭과 3슬롯을 그대로 사용하며 잠금·뒤집기·강제 셔플·안개·힌트·정화·방어막 7종을 상황에 따라 사용한다.
- 사람 재접속 중 AI pause/resume, 한 번의 사람 요청으로 재대결, 명시 이탈·유예 만료·서버 종료 시 봇·타이머·방 정리를 추가했다.
- AI 참가자 이름·텍스트 배지·상태·재대결 UX를 ko/en과 키보드 접근 가능한 버튼으로 제공한다.

### 수정

- 런처가 무토큰 레거시 봇을 직접 생성하던 사천성 경로를 게임 관리형 `mode=ai` 리다이렉트와 `REQUEST_AI` 인증 경로로 수정했다.
- 후보 선택을 65% 상위 후보군·35% 전체 합법 후보군으로 조정하고, 아이템·효과·revision 변화마다 기존 예약을 폐기해 최신 snapshot에서 다시 판단하도록 했다.
- AD 모드 3 피드백에 따라 새 경기의 이전 토스트 잔존, 390px 토스트 겹침, AI 명칭 중복과 영문 배지 줄바꿈을 수정했다.

### 검증

- 독립 공격 테스트 2/2, AI 정책·실제 봇 프로토콜·런처 통합 9/9, 전체 Node 41/41, Playwright 5/5를 통과했다.
- AI 판단 성능 200회에서 median 0.89ms, p95 1.31ms, max 10.42ms를 기록했다.
- AD 모드 3 재검수 `APPROVED`, `node --check`, JSON 파싱과 `git diff --check`를 통과했다.

### 참고

- 스펙: `../../../.Codex/specs/2026-07-23-sichuan-ai-mode.md` (`COMPLETED`)
- 구현 리포트: `../../../.Codex/specs/2026-07-23-sichuan-ai-mode-report.md`
- UI 검수: `../../../.Codex/specs/2026-07-23-sichuan-ai-mode-ui-review.md` (`APPROVED`)
- QA: `../../../.Codex/specs/2026-07-23-sichuan-ai-mode-qa.md` (`PASS`)
- 신규 에셋이 없어 `studio-mockup` 동기화는 필요하지 않다.

## [2026-07-23] - 초기 보드 무작위 분산 수정

### 수정

- 동일 문양이 가로로 두 장씩 붙어 생성되던 48개 고정 도미노 배치를 제거했다.
- 96개 전체 좌표에 24 face×4장을 분산하면서 실제 경로 규칙으로 완주 가능한 해답을 만드는 결정적 생성기로 교체했다.
- 남은 타일 셔플을 같은 생성기로 통합해 교차 후에도 항상 완주 가능하게 했다.
- 2회 꺾임 경로 탐색을 직선·1회·2회 검사로 최적화해 대량 시드 검증 성능을 보강했다.

### 검증

- 고정 시드 10,000개에서 완주, 결정성, 10,000개 고유 배치 지문을 확인했다.
- 인접 동일 face 비율은 전체 3.4367%, 가로 3.3193%, 세로 3.5598%, 기존 가로 슬롯 3.1617%로 계측됐다.
- 초기 보드 1,000개 생성은 총 2,631.7ms, median 1.99ms, p95 7.74ms, max 11.39ms로 측정됐다.
- 진행도별 연속 셔플 1,800/1,800, Node 32/32, 기본 Playwright 연속 2회 4/4 테스트가 통과했다.

### 참고

- 스펙: `../../../.Codex/specs/2026-07-23-sichuan-random-board.md` (`COMPLETED`)
- 구현 리포트: `../../../.Codex/specs/2026-07-23-sichuan-random-board-report.md`
- QA: `../../../.Codex/specs/2026-07-23-sichuan-random-board-qa.md` (`PASS`)
- UI·에셋 변경이 없어 `studio-mockup` 동기화는 필요하지 않다.

## [2026-07-23] - 최초 구현

### 추가

- 동일 시드 12×8 독립 보드, 최대 2회 꺾임·외곽 경로, 3분 단판 규칙을 구현했다.
- 서버 권위 제거 판정, 자동 교착 복구, 선완주·시간 점수·무승부, 15초 연결 복구와 양측 동의 재대결을 추가했다.
- 첫 제거 확정 지급과 이후 72%+2회 pity를 사용하는 3슬롯 고빈도 아이템전을 추가했다.
- 공격 4종(잠금·뒤집기·강제 셔플·안개)과 보조 3종(힌트·정화·방어막), 면역·재사용 제한·방어 대응을 구현했다.
- ko/en 대기·플레이·결과 UI, 키보드 1/2/3, ARIA, 저감 모션과 1366×768·1024×768 데스크톱 레이아웃을 추가했다.
- GPT Image 2 기반 공용 도자 타일 몸체·야간 정원 배경과 고유 SVG 문양 24종을 런타임 PNG/WebP로 적용했다.
- 단위·프로토콜·공격적 QA·2브라우저 Playwright·에셋 검증을 추가했다.

### 변경

- AD2 Round 1 피드백에 따라 6개 반복 추상 패턴을 해·초승달·북극성 등 24개 고유 사물 실루엣으로 교체하고, SVG에서 중복 공용 래스터 내장을 제거했다.
- AD3 Round 1 피드백에 따라 뒤집힌 타일의 얼굴을 공통 뒷면으로 완전히 차폐하고, 강제 셔플 경고와 내·상대 효과 남은 시간을 추가했다.
- QA 수정 뒤 아이템 ko/en 설명·ARIA, 자동 교착 450ms 경고, 힌트 수명 정리와 재대결 동의 상태를 AD3 Round 3에서 재승인했다.

### 수정

- stale `matchId`, 경기 중 재대결, 메시지 폭주와 반복 대형 메시지를 서버에서 거부하도록 보강했다.
- 힌트 대상 제거·셔플 뒤 효과가 남는 문제와 자동 교착이 경고 없이 즉시 재배치되던 문제를 수정했다.
- 결과 후 첫 재대결 표만으로 새 경기가 시작되지 않도록 양측 동의 게이트를 고정했다.

### 검증

- 공격적 QA 11/11, 전체 단위·프로토콜 24/24, Playwright 4/4, 런처 HTTP/WS smoke PASS.
- AD2 Round 2와 AD3 Round 3 `APPROVED`, 최종 QA `PASS`.

### 참고

- 스펙: `../../../.Codex/specs/2026-07-23-sichuan-battle.md`
- 구현 리포트: `../../../.Codex/specs/2026-07-23-sichuan-battle-report.md`
- QA: `../../../.Codex/specs/2026-07-23-sichuan-battle-qa.md`
- 에셋이 추가되었으므로 `studio-mockup` 동기화가 필요하다.
