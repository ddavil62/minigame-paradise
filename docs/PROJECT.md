# 미니게임 천국 기획서

> 최종 업데이트: 2026-06-15 — 맞고 선공 바닥 조커 연출 수정 + 바닥 리필 룰 (사안 A: `client.js` `isRoundStart`에 `floor_joker_to_first` 추가 → 조커·리필 카드 fly 없이 appear. 사안 B: `game.js applyFloorJokerToFirst`가 조커 제거 후 `deck.pop()`으로 floor를 항상 8로 리필(연쇄 최대 2, deck 소진 방어) → `floor === 8`, `deck === 22 - N` 가변(22 불변 폐기), 총합 50 불변. joker 23/0, 단위 98/0, smoke 5/5(floor8/total50), e2e 3회 30/0/0. score.js 무수정)
> 이전 갱신: 2026-06-13 — 맞고 레거시 shake_decision/pendingShake 데드코드 정리 (죽은 `shake_decision` 분기 + `pendingShake` 필드 제거, 동작 무변경 프로덕션 no-op. 레거시 테스트 G-22/G-23 제거로 game.unit 42, 단위 98 passed / adhoc 42 / e2e 30 passed. 커밋 513a603)
> 이전 갱신: 2026-06-13 — 맞고 E-15/E-16 흔들기 E2E 현행 모달 흐름 재작성(skip 해제) (inject 1월 손 3장+바닥 0장 → 카드 클릭 → shake-modal 표시(E-15) / btn-shake 클릭 → shaking.p1 반영(E-16). 3회 연속 30 passed / 0 skipped / 0 failed, 28 passed/2 skipped → 30 passed/0 skipped)
> 이전 갱신: 2026-06-13 — 맞고 e2e 스위트 flakiness 안정화 (공유 룸 teardown 레이스 → `POST /test/reset` + beforeEach/afterEach, 오프닝 fly+무가드 click 레이스 → waitForFlyIdle + pickSafePlayCard 헬퍼)
> 이전 갱신: 2026-06-13 — 맞고 폭탄 손 3장 fly 출처 수정 (버그6: 폭탄 발동 시 손 3장이 myCards에서 출발, E-30 PASS)
> 이전 갱신: 2026-06-13 — 맞고 fly-출처 정합 수정 2건 (강탈 피는 oppCapturedZone 출발 / 흔들기 낸 카드는 myCards 출발)
> 이전 갱신: 2026-06-13 — 맞고 연출-STATE 순서 정합 수정 2건 (chooseFloor 획득 순간이동 / 뻑 토스트 선행)
> 이전 갱신: 2026-05-31

## 프로젝트 개요

LAN 환경에서 1:1로 즐기는 미니게임 6종 통합 패키지. 단일 포트(3000)에서 통합 라우터로 런처와 6개 게임을 path 라우팅으로 서빙한다.

## 기술 스택

| 항목 | 기술 |
|------|------|
| 언어 | 바닐라 JavaScript (Node.js 서버 + 브라우저 클라이언트) |
| 통신 | WebSocket (`ws` 패키지), HTTP |
| 테스트 | Playwright |
| 패키지 관리 | npm |

## 아키텍처

### 디렉토리 구조

```
minigame-paradise/
  launcher/          # 통합 라우터 + 로비 (server.js, public/)
  matgo/             # 맞고 (봇 지원)
  yutnori/           # 윷놀이
  tetris-battle/     # 테트리스 배틀
  davinci-code/      # 다빈치 코드 플러스
  codenames-duet/    # 코드네임 듀엣
  janggi/            # 장기 (KJA 2009 룰, PvP 전용)
  tests/             # Playwright QA 테스트
  docs/              # 프로젝트 문서
```

### 핵심 모듈

| 모듈 | 파일 | 역할 |
|------|------|------|
| 통합 라우터 | `launcher/server.js` | 단일 HTTP/WS 서버, path별 게임 dispatch, 로비 WS 관리 |
| 로비 클라이언트 | `launcher/public/app.js` | 로비 UI 상태 관리, 카드 렌더링, 투표, 리다이렉트 |
| 게임 목록 | `launcher/public/games.json` | 6개 게임 메타데이터 (경로, 봇 지원 여부 등) |
| 각 게임 서버 | `{game}/server.js` | `createApp()` factory로 launcher에 연결 |

## 기능 목록

| 기능 | 설명 | 상태 |
|------|------|------|
| 단일 포트 통합 라우터 | HTTP/WS를 path segment로 6개 게임에 dispatch | 완료 |
| 단일 화면 로비 | 접속 즉시 게임 카드 6개 표시, 호스트가 클릭하여 게임 선택 | 완료 |
| AI/인간 모드 자동 분기 | 1/2=AI, 2/2=인간 대전. 카드 클릭 시점에 결정 | 완료 |
| 투표 시스템 | 호스트/게스트가 카드에 투표하여 선호 종목 공유 (toggle) | 완료 |
| 로비 복귀 | 게임 완료 후 "다른 종목" 버튼으로 양쪽 동시 복귀 | 완료 |
| 게임 중 뒤로가기 | 6개 게임 헤더에 상시 "게임 선택" 버튼(`#btn-back-to-lobby`). confirm 다이얼로그 + disconnect 감지로 양쪽 로비 복귀 | 완료 |
| 봇 미지원 게임 차단 | AI 모드에서 봇 없는 게임 카드 비활성 (CSS+JS+서버 3중 가드) | 완료 |
| 맞고 (matgo) | 2인 화투 고스톱, AI 봇 지원 | 완료 |
| 윷놀이 (yutnori) | 2인 윷놀이 | 완료 |
| 테트리스 배틀 | 한게임 스타일 1:1 테트리스 대전 | 완료 |
| 다빈치 코드 플러스 | 2인 추리 게임. 빨강/노랑/파랑 3색 39장 타일, 조커 배치 페이즈, 2-column 레이아웃(좌 게임보드 + 우 정보 패널), 숫자 메모판(39칸), 추측 기록 누적 | 완료 |
| 코드네임 듀엣 | 2인 협동 워드 게임 | 완료 |
| 장기 (janggi) | KJA 2009 룰 준수 한국 전통 장기 2인 대전. 7종 기물, 마/상 배치 4종, 점수제/동형반복/50수 룰 지원. CSS/Canvas 렌더링, 외부 에셋 없음 | 완료 |

## 알려진 제약사항

- 봇은 matgo만 지원. 나머지 5종은 AI 대전 불가.
- 최대 2명 동시 접속. 3인 이상 로비 미지원.
- 모바일 반응형 미지원.
- LAN 전용 설계 (인증/보안 없음).

## 향후 계획

- 나머지 5종 게임 봇 구현 (장기 포함)
- 모바일 반응형 레이아웃
- 장기: 무승부 거절 피드백(DRAW_REJECT), showCheckToast/showToast stale DOM 수정
