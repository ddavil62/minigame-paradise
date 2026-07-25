# Changelog

## [2026-07-25] - 실플레이 힌트·뒤집기 분산·슬롯 정산 회귀 수정

### 변경

- 힌트 안내를 일반 타일 선택 피드백과 분리된 고정 배너로 렌더링했다. 유효한 두 대상은 ①·② 배지와 강한 외곽선으로 표시하며, 경로가 없거나 SVG 밖에서 잘려도 배너와 대상 강조는 유지된다.
- 뒤집기 대상을 화면 상단(`y < 4`)과 하단(`y >= 4`)으로 먼저 나눠 후보가 충분한 16장 공격은 상·하 8장씩 할당하고, 각 절반 안에서는 활성 행을 순환하며 결정적 PRNG로 타일을 선택하도록 변경했다.
- 아이템 입력 즉시 사용 슬롯을 빈칸으로 낙관 렌더링하고 `requestId + slotId`로 정산한다. `ITEM_RESOLVED`와 `STATE_SYNC` 순서 역전, 응답 유실, 재접속에서도 1.5초 watchdog이 pending을 복구하거나 소비 완료로 정리한다.
- 인벤토리 슬롯의 pending 문구를 제거하고, 활성 공격은 `뒤집기 · 3.2s`처럼 별도 효과 칩으로 표시해 소비 슬롯과 지속 효과를 구분했다.

### 검증

- AD 모드 3에서 1366×768·1024×768·390×844의 ko/en 및 reduced-motion을 검수했다. 독립 힌트 배너, 대상 2장, 뒤집기 상·하 8/8, 즉시 빈 슬롯과 효과 칩을 확인해 `APPROVED` 판정을 받았다.
- Node 집중 회귀는 공간 분산·힌트 privacy·동일 공격 갱신·3연타·정화·방어막을 포함해 19/19를 통과했다.
- 실제 WebSocket과 운영형 `s-*` 슬롯을 사용하는 Playwright는 힌트 지속·진행 보드 8/8·메시지 순서 역전·응답 유실·재접속을 포함해 7/7을 통과했고 최종 QA는 `PASS`다.

### 참고

- 스펙: `../../../.Codex/specs/2026-07-25-sichuan-live-item-regression-spec.md` (`COMPLETED`)
- 구현 리포트: `../../../.Codex/specs/2026-07-25-sichuan-live-item-regression-report.md`
- UI 검수: `../../../.Codex/specs/2026-07-25-sichuan-live-item-regression-ad3.md` (`APPROVED`)
- QA: `../../../.Codex/specs/2026-07-25-sichuan-live-item-regression-qa.md` (`PASS`, Node 19/19, Playwright 7/7)
- `assets/` 변경이 없어 Mockup Sync와 `studio-mockup` 동기화를 생략했다.

## [2026-07-25] - 아이템 조작감·오디오·상태 피드백 개선

### 추가

- 외부 오디오 파일 없이 Web Audio 오실레이터·게인·필터로 낮은 볼륨의 반복 BGM과 선택·힌트·매칭·실패·아이템·공격·방어막 차단 SFX를 합성했다.
- 첫 pointer/keyboard 제스처 이후 오디오를 시작하고, ko/en 및 ARIA를 제공하는 음소거 토글과 `localStorage` 설정 복원을 추가했다.
- 방어막 활성 중 내 보드 외곽에 glow를 표시하고 1회 공격 차단 또는 경기 초기화 시 즉시 제거하는 상태 피드백을 추가했다.

### 변경

- 힌트를 3초 자동 만료에서 해당 쌍 매칭·셔플·경기 종료까지 유지하는 방식으로 바꿨다. 두 타일에 ①·② 배지와 강한 외곽선, 연결 경로를 표시하고 비대상 타일을 감광한다.
- 힌트 안내를 보드 내부 오버레이가 아닌 보드 아래 피드백 행에 배치하고, 효과 칩은 숫자 카운트 대신 `연결할 때까지`/`Until matched`를 표시한다.
- 잠금·뒤집기·안개 대상을 사분면 중심 배분에서 실제 남은 타일의 `y` 행별 균등 quota로 변경했다. 잉여 행과 행 내부 타일은 결정적 PRNG로 무작위 선택한다.
- 아이템 클릭·단축키 입력 시 슬롯을 로컬 pending으로 즉시 표시하고 `requestId + slotId` 명령 큐에서 순차 전송·정산하도록 변경했다. 서로 다른 3슬롯의 100ms 이하 연속 입력을 모두 소비한다.
- 같은 공격을 활성 중 다시 사용하면 새 효과를 중첩하지 않고 기존 `effectId`와 targets를 유지한 채 `endsAt`을 기본 지속시간으로 초기화한다.
- 제거할 디버프가 없어도 정화 아이템을 정상 소비하고 3초 면역을 부여하도록 변경했다.

### 수정

- 힌트 안내가 보드 타일 위에 겹치던 AD 모드 3 지적을 해결하고 세 대상 뷰포트에서 보드와 안내 사이 7px 간격을 확보했다.
- 경기 전환·재접속에서 pending 명령과 오디오 노드를 정리하고, 공격 차단 직후 권위 상태와 함께 방어막 glow가 남지 않게 했다.
- QA에서 이전 사분면·3초 힌트 계약과 충돌하던 테스트를 실제 행 분산·지속 힌트 계약으로 갱신하고, 격리 E2E의 경기 이탈 정리를 보강했다.

### 검증

- AD 모드 3 재검수에서 1366×768·1024×768·390×844, ko/en의 힌트 배지·경로·안내, 오디오 토글, 방어막 glow와 reduced-motion을 검수해 `APPROVED` 판정을 받았다.
- Node 집중 테스트는 행 분산·지속 힌트 privacy·동일 공격 갱신·빈 정화를 포함해 파일별 12/12를 통과했다. 5,000 seed의 방해 대상 행별 최대 편차는 1 이하였다.
- 격리 실제 서버 Playwright는 3/3을 통과했다. 100ms 미만 3연타, 힌트의 4초 이후 유지와 매칭 제거, 오디오 unlock·BGM·mute 복원·7종 SFX, 방어막 glow와 차단 제거를 확인했다.
- QA 수정 뒤 제품 런타임 코드는 추가로 변경하지 않았으며 최종 판정은 `PASS`다.

### 참고

- 스펙: `../../../.Codex/specs/2026-07-25-sichuan-item-audio-polish-spec.md` (`COMPLETED`)
- 구현 리포트: `../../../.Codex/specs/2026-07-25-sichuan-item-audio-polish-report.md`
- AD 수정 리포트: `../../../.Codex/specs/2026-07-25-sichuan-item-audio-polish-revise-report.md`
- UI 재검수: `../../../.Codex/specs/2026-07-25-sichuan-item-audio-polish-ad3-rereview.md` (`APPROVED`)
- QA: `../../../.Codex/specs/2026-07-25-sichuan-item-audio-polish-qa-rerun.md` (`PASS`)
- 신규·변경 에셋이 없어 Mockup Sync와 `studio-mockup` 동기화를 생략했다.

## [2026-07-25] - 아이템 공간 균형·정규화·드롭·방어·힌트 보강

### 원인

- 기존 비복원 무작위 선택은 장기 누적 분포는 균등했지만 단일 사용에서 상단 절반에 대상이 몰리는 클러스터를 허용했다.
- 클라이언트 렌더 경계가 unknown 슬롯을 검증하지 않아 미정의 아이콘이 `undefined`로 노출됐고, 서버의 outbound effect와 권위 effect 상태에도 같은 allowlist·형상 검증이 빠져 있었다.
- 첫 제거 보장, raw 72%, pity 2 규칙은 30쌍 기준 약 22.32개를 지급해 원하는 공급량보다 높았다.
- 방어막이 10초 타이머에 결합돼 다음 공격 전 만료될 수 있었고, 힌트는 데이터 계약이 있어도 시각 강조와 실제 메시지 경로 검증이 약했다.

### 변경

- 잠금 6장·뒤집기 16장·안개 18장을 좌상·우상·좌하·우하 quota로 배분하고, 사분면 내부 행 round-robin과 부족 후보 재분배로 한 번의 공격에서도 상하·좌우 균형을 맞췄다.
- 서버 생성·grant·snapshot·사용, AI 선택, 클라이언트 렌더·마우스·1/2/3 키에 `lock`, `flip`, `fog`, `hint`, `cleanse`, `shield` allowlist와 슬롯 정규화를 적용했다.
- 드롭을 첫 제거 보장, raw 14%, pity 5로 조정했다. 10,000 seed 평균은 30쌍 7.5202개, 48쌍 11.7575개로 이전 기대량의 약 1/3이다.
- 방어막을 만료 시간이 없는 `shieldActive` boolean으로 교체했다. 다음 유효 공격 한 번만 막고 `1회`/`1 hit` 칩에는 `<time>`을 만들지 않는다.
- 실제 `TEST_GRANT_ITEM → USE_ITEM → ITEM_RESOLVED → STATE_SYNC`의 힌트 targets/path를 본인에게만 공개하고, 정확히 두 타일을 4px outline·inset ring·`✦` 표식과 pulse로 강조했다. reduced-motion에서는 정적 강조를 유지한다.

### 수정

- QA F-01에서 `publicEffects()`가 unknown·구버전·손상 effect를 snapshot에 공개하는 원인을 확인했다. outbound 경계에 allowlist와 finite `endsAt` 검증을 추가하고, legacy timed shield와 invalid effect를 본인·상대 snapshot에서 제거했다.
- QA F-02에서 outbound에서 숨긴 null effect가 권위 상태에 남아 다음 `tick()`·`useItem()`에서 예외를 일으키는 원인을 확인했다. `normalizeEffects()`를 `tick`, `publicEffects`, `recomputeDisruptionFlags`, `clearHints`, `endEffect` 진입점에 적용해 저장 가능한 `lock`·`flip`·`fog`·`hint`만 안전한 형상으로 유지했다.
- 정규화 뒤에도 유효 hint의 targets/path 본인 공개, lock 플래그 재계산·만료, 연속 hint→attack→cleanse 상태 전이가 유지되도록 회귀를 보강했다.

### 검증

- AD 모드 3에서 실제 AI·PvP, 1366×768·1024×768·390×844, ko/en, 기본·reduced-motion을 검수해 `APPROVED`했다. 힌트는 본인 2장·상대 0장, outline 4px, marker opacity 1, 가로 overflow 0px였고 방어 칩의 `<time>`은 0개였다.
- 공간 분포 5,000 seed에서 모든 단일 사용의 사분면·상하·좌우 차이가 1 이하였다. lock의 상단 4장 이상 쏠림은 0/5000이고 flip·fog는 상하 각각 8장·9장이었다.
- 100,000 drop opportunity에서 23,547회가 드롭됐고 6종 가중치는 각 목표의 ±1%p 이내였다.
- 최초 QA는 Node 60/61에서 F-01을 발견했고, F-01 수정 뒤 전체 Node 62/62와 독립 Playwright 3/3을 통과했다. Round 2는 집중 Node 25/26에서 F-02를 발견했다.
- 최종 QA Round 3에서 F-01·F-02가 모두 해결됐으며 집중 Node 28/28, 최소 Playwright 1/1을 통과했다. 직전 독립 Playwright 전체 3/3과 관련 기존 Playwright 16/16 결과도 유지했고 최종 판정은 `PASS`다.
- JavaScript 문법 검사와 `git diff --check`를 통과했으며 제품 UI·CSS·에셋은 QA 수정 과정에서 추가 변경되지 않았다.

### 참고

- 스펙: `../../../.Codex/specs/2026-07-25-sichuan-item-followup.md` (`COMPLETED`)
- 구현 리포트: `../../../.Codex/specs/2026-07-25-sichuan-item-followup-report.md`
- UI 검수: `../../../.Codex/specs/2026-07-25-sichuan-item-followup-ad3.md` (`APPROVED`)
- QA: `../../../.Codex/specs/2026-07-25-sichuan-item-followup-qa.md` (`PASS`, Round 3)
- 신규·변경 아트 에셋이 없어 Mockup Sync와 `studio-mockup` 동기화를 생략했다.

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
