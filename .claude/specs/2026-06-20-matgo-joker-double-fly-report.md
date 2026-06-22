# Implementation Report: 맞고 조커 손패 fly 2~3회 중복 재생 수정

## 작업 요약

손패에서 조커를 냈을 때(케이스 A, `joker_play`) captured로 날아가는 fly가 2~3회
재생되던 버그를, `public/client.js`의 조커 fly 등록부에 **이중 가드**(pendingFlies
중복 가드 + 액션 키 가드 `lastJokerFlyActionKey`)를 추가해 라운드당 정확히 1회만
등록되도록 수정했다. 서버(game.js/server.js)는 무수정.

## 변경된 파일

| 파일 경로 | 작업 유형 | 변경 내용 |
|---|---|---|
| `minigames/matgo/public/client.js` | 수정 | 모듈 변수 `lastJokerFlyActionKey` 신설(약 137) / `GAME_START`·`ROUND_START`에서 리셋(약 343, 354) / 조커 fly 등록부 이중 가드(약 644-671) |
| `minigames/matgo/tests/e2e-scenarios.spec.js` | 수정 | E-32에 회귀 단언 추가 — origin='hand' 조커 fly가 정확히 1개(중복 재생 금지) |

### 핵심 변경 (client.js 644-671)

조커 fly 등록 블록을 다음 이중 가드로 교체:

- `jokerActionKey = la.kind + '|' + la.card.id + '|' + la.player` (기존 토스트 가드
  `prevActionKey` 패턴 차용).
- `alreadyFlying = pendingFlies.some((f) => f.cardId === la.card.id)` (choice srcCard
  경로와 동일 패턴).
- 액션 키가 미처리면: `alreadyFlying`이 false일 때만 `_jokerFlyId` 설정(STATE가 fly
  등록), **항상** `lastJokerFlyActionKey`에 키 기록(처리됨 표시).
- `newCardIds.delete(la.card.id)`는 fly 등록 여부와 무관하게 항상 수행(조커가 drewIds
  → 더미 fly로 잘못 분류되는 것 방지).

### 조사 중 확인된 실제 메커니즘 (스펙 보강)

스펙은 STATE 2~3회 송신 + 가드 부재를 원인으로 지목했으나, 디버그 계측 결과
**3회 렌더 중 첫 렌더에서 이미 `alreadyFlying=true`**였다. 이는 클릭 핸들러
`sendPlay`(client.js:1815)가 모든 카드 클릭 시 `startFlyFromHand`로 **fly #1을
선등록**하기 때문이다. 따라서:

- 렌더#1: 클릭-fly가 이미 있어 `alreadyFlying=true` → 기존 코드는 skip하되 **키를
  안 남겨** 후속 렌더가 무방비.
- 렌더#2: pendingFlies가 비고 키도 비어 있어 **두 번째 fly 등록**(중복).

수정의 핵심은 "`alreadyFlying=true`(클릭 핸들러가 이미 처리)여도 액션 키를 기록"해
렌더#2 이후의 재등록을 차단한 것이다. 단순 중복 가드만으론 부족했고 키 가드가
실질 해결책이었다.

## 스펙 대비 구현 상태

- [x] 중복 가드(pendingFlies) 추가
- [x] 액션 키 가드(`lastJokerFlyActionKey`) 추가 + GAME_START/ROUND_START 리셋
- [x] 케이스 A(`joker_play`)에만 적용, 케이스 B(`joker_flip`) 무영향
- [x] fly 1회는 반드시 발생(E-32 통과) — captured pi 그룹 정적 표시 유지
- [x] 서버(game.js/server.js) 무수정
- [x] 신규 회귀 단언 추가(E-32: origin='hand' 조커 fly 정확히 1개)

## 빌드/린트 결과

- 빌드: 해당 없음(바닐라 JS, 빌드 스텝 없음)
- 린트: 별도 린터 설정 없음. 구문 무결성은 e2e/단위 전체 통과로 검증.

## 테스트 결과

| 스위트 | 결과 |
|---|---|
| `score.unit.spec.js` + `game.unit.spec.js` | 100/100 PASS |
| `e2e-scenarios.spec.js` (E-01~E-32) | 32/32 PASS |
| 그중 fly 게이트 E-26~E-32 | 7/7 PASS (E-32 신규 "조커 1회" 단언 포함) |
| `joker-adhoc.mjs` | 24/24 PASS (케이스 A 턴 유지 회귀 포함) |
| `sseul-adhoc.mjs` | 11/11 PASS |
| `bombdup-adhoc.mjs` | 7/7 PASS |
| `floor-joker-smoke.mjs` (포트 3098) | 5/5 PASS |

합계 **179건 PASS / 0 FAIL**. 회귀 0.

### 테스트 실행 메모

- matgo 로컬 `node_modules/playwright(-core)`가 `__bak`로 비활성화돼 있어(루트
  설치 강제용 추정) 루트 `minigames/node_modules/.bin/playwright`로
  `--config=matgo/playwright.config.js`를 지정해 실행했다. matgo의 `__bak`는
  원상 유지(건드리지 않음).
- 서버는 `node server.js --port 3013`(e2e) / `--port 3098`(floor-joker-smoke)로
  띄운 뒤 테스트 후 종료. MCP node 프로세스는 보존.

## Art Director 후속 조치

- visual_change: ui (fly 연출 횟수만 변경 — 에셋·레이아웃·색상 변경 없음)
- AD 모드 2 필요 여부: 아니오 — 에셋 생성/교체 없음
- AD 모드 3 필요 여부: **판단 필요(경미)** — UI 레이아웃·DOM 구조 변경은 없고
  기존 fly 애니메이션이 잘못 2~3회 반복되던 것을 정상 1회로 되돌린 **연출 횟수
  교정**이다. 정적 captured 표시(E-32 안착)는 동일하게 유지된다. 신규 시각 요소가
  없으므로 AD3는 생략 가능 범위로 보이나, 오케스트레이터 판단에 따라 fly 1회
  재생 육안 확인을 원하면 모드 3 1패스 권장.

## 알려진 이슈

- 없음. 서버는 여전히 동일 `joker_play` STATE를 2~3회 송신하지만(설계상 보류 대상
  아님), 클라 가드가 멱등 처리하므로 증상은 완전 해소. 서버 broadcast 횟수 자체를
  줄이는 것은 별도 발주 대상(본 작업 범위 외, 스펙에서 클라 전용 수정 지시).

## QA 참고사항

- 핵심 회귀 게이트: **E-32**(조커 손 fly origin='hand' 정확히 1개 + captured 안착).
- 케이스 B(`joker_flip`, 더미 뒤집은 게 조커)는 가드 대상이 아니므로 무영향임을
  확인(가드 조건 `la.kind === 'joker_play'`).
- 다음 라운드에서 조커를 다시 내도 정상 1회 fly 동작(GAME_START/ROUND_START 리셋
  검증은 e2e 라운드 전환 시나리오로 직접 커버되진 않으나, 리셋 코드 경로는
  기존 floorSlotMap.clear 등과 동일 위치에 배치).
- 육안 확인 권장: 손 조커 클릭 시 captured로 카드가 **한 번만** 날아가는지.
