# Rummikub — 프로젝트 현황

## 개요

공개 HTTPS 통합 런처에서 즐기는 루미큐브. 친구는 같은 공유기에서도 `https://112.155.2.238`로 접속하며 개별 포트 직접 접속은 운영하지 않는다. 미니게임 천국 9번째 종목.

## 기술 스택

- Node.js 18+ (ESM)
- `ws` 8.x (WebSocket)
- 순수 `node:http` (Express 미사용)
- 바닐라 JS + HTML/CSS (외부 에셋 0)

## 룰 요약 (서버 권위)

- 타일 106장 (1~13 × 4색 × 2 + 조커 2)
- 분배: 손 14×2 + 더미 78
- 그룹(같은 숫자/다른 색 3~4장) / 런(같은 색/연속 숫자 3장+)
- 첫 등판 30점 이상 필요 (기존 보드 타일 결합 불가, 런 점수는 순서 독립 계산)
- 턴 종료 시 보드 valid 검증 → invalid면 롤백 + 더미 1장
- 손 타일을 1장도 내지 않은 턴(순수 재배치)은 commit 불가 → 롤백 + 더미 1장 (`no_tile_played`)
- 조커 회수(`SWAP_JOKER`)는 첫 등판 후 + 정확한 대체 타일에서만 허용
- 손 0장 즉시 승리
- 보드 세트는 `moveTile`/`swapJoker` 후 valid일 때만 자동 오름차순 정규화(런: 슬롯 순, 그룹: 색 순). invalid(배치 중) 세트는 놓은 순서 보존

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
└── tests/{smoke.test.js, qa-pass4-sort.test.js, sort-buttons-qa.spec.js, ...}
```

## 진행 상태

- ✅ 핵심 게임 로직 (`game.js`)
- ✅ WS 서버 + createApp + 단독 실행 + 봇 spawn (`server.js`)
- ✅ AI 봇 (`bot.js`)
- ✅ 클라이언트 UI (보드/손/HUD/효과음)
- ✅ launcher 통합 (GAME_APPS 등록 + games.json 카드)
- ✅ smoke 테스트 (RUMMI-001~037, 150/150 PASS)
- ✅ 조커 회수 표준 룰 (`SWAP_JOKER` 액션 + `jokerReturnedThisTurn` 추적, 등판 후 + 정확 타일 검증)
- ✅ 봇 보드 단순 확장 (런 양 끝/그룹 4번째 색 자동 MOVE_TILE)
- ✅ 더미 빈 후 무한 루프 방지 + 손 적은 자 승리 (`consecutivePassesAfterDeckEmpty`)
- ✅ **봇 조커 활용** (그룹 빈 색 + 런 빈 자리 모든 패턴, 2026-06-10)
- ✅ **봇 보드 재구성** (보드 세트 분해 + 새 세트 재조립, 500ms 시간 제한, 2026-06-10)
- ✅ **룰 정합 수정 10건** (2026-06-11) — 재배치만 commit 차단(`no_tile_played`), 첫 등판 전 보드 격리, 런 점수 순서 독립, 조커 회수 정확 검증, 빈 세트 4개 상한, 봇 actionEpoch 체인 취소 등. 상세는 CHANGELOG 참조.
- ✅ **손패 정렬 버튼 2종 + 보드 세트 자동 정규화** (2026-06-12) — 손패 "색상순"(기본)/"숫자순" 토글 버튼(localStorage `rummikub.sortMode` 영속, 본인 턴 무관 즉시 재렌더). 서버 `moveTile`/`swapJoker` 후 valid 세트만 오름차순 정규화(WS 프로토콜 무변경). smoke 150/150 + qa-pass4-sort 34/34.

## 알려진 한계

- 봇은 보드 조커 회수(`SWAP_JOKER`)를 시도하지 않음. 조커 포함 세트는 분해 후보에서 제외 (안전 회피).
- 봇 재구성 깊이는 1단계(분해 1회 + 재조립 1개). 다단계 보드 재배치는 미지원.
- (LOW, 표준 룰 정상) `swapJoker` 그룹에서 3장 그룹의 조커는 빠진 색 어느 쪽으로도 회수 가능. 표준 룰상 정상 동작으로 종결 (2026-06-11 QA 재확인).
- (LOW, wontfix) `moveTile` hand→hand 호출 시 splice+push로 손 순서가 바뀜. 현재 UI는 노출하지 않으며 WS 페이로드 직접 송신 시에만 트리거.
- (LOW, 기존) `server.js` 종료 시 `wss.close()` 미명시(RES-004). 단일 인스턴스 환경 무영향, 후속 처리 대상.
