# Rummikub — 프로젝트 현황

## 개요

LAN 1:1 루미큐브. 미니게임 천국 9번째 종목.

## 기술 스택

- Node.js 18+ (ESM)
- `ws` 8.x (WebSocket)
- 순수 `node:http` (Express 미사용)
- 바닐라 JS + HTML/CSS (외부 에셋 0)

## 룰 요약 (서버 권위)

- 타일 106장 (1~13 × 4색 × 2 + 조커 2)
- 분배: 손 14×2 + 더미 78
- 그룹(같은 숫자/다른 색 3~4장) / 런(같은 색/연속 숫자 3장+)
- 첫 등판 30점 이상 필요
- 턴 종료 시 보드 valid 검증 → invalid면 롤백 + 더미 1장
- 손 0장 즉시 승리

## 디렉토리

```
rummikub/
├── game.js
├── server.js
├── bot.js
├── package.json
├── CLAUDE.md / README.md
├── docs/{PROJECT.md, CHANGELOG.md}
├── public/{index.html, css/style.css, js/*}
└── tests/smoke.test.js
```

## 진행 상태

- ✅ 핵심 게임 로직 (`game.js`)
- ✅ WS 서버 + createApp + 단독 실행 + 봇 spawn (`server.js`)
- ✅ AI 봇 (`bot.js`)
- ✅ 클라이언트 UI (보드/손/HUD/효과음)
- ✅ launcher 통합 (GAME_APPS 등록 + games.json 카드)
- ✅ smoke 테스트 (RUMMI-001~022, 113/113 PASS)
- ✅ 조커 회수 표준 룰 (`SWAP_JOKER` 액션 + `jokerReturnedThisTurn` 추적)
- ✅ 봇 보드 단순 확장 (런 양 끝/그룹 4번째 색 자동 MOVE_TILE)
- ✅ 더미 빈 후 무한 루프 방지 + 손 적은 자 승리 (`consecutivePassesAfterDeckEmpty`)
- ✅ **봇 조커 활용** (그룹 빈 색 + 런 빈 자리 모든 패턴, 2026-06-10)
- ✅ **봇 보드 재구성** (보드 세트 분해 + 새 세트 재조립, 500ms 시간 제한, 2026-06-10)

## 알려진 한계

- 봇은 보드 조커 회수(`SWAP_JOKER`)를 시도하지 않음. 조커 포함 세트는 분해 후보에서 제외 (안전 회피).
- 봇 재구성 깊이는 1단계(분해 1회 + 재조립 1개). 다단계 보드 재배치는 미지원.
- (LOW, wontfix) `swapJoker` 그룹에서 조커가 어느 색을 대체했는지 보드에 메타로 기록되지 않아 두 색 모두 swap 가능. 정보가 없어 구현상 모호 — 보드 모델 변경이 필요해 우선순위 낮음.
- (LOW, wontfix) `moveTile` hand→hand 호출 시 splice+push로 손 순서가 바뀜. 현재 UI는 노출하지 않으며 WS 페이로드 직접 송신 시에만 트리거.
