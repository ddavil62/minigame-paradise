# 미니게임 천국 (minigame-paradise)

LAN 1:1 미니게임 7종 통합 패키지. 단일 포트(3000) 통합 라우터 구조. (하나비는 2인 협력 게임)

## 게임 목록

| 경로 | 게임 | 서버 | AI 봇 |
|------|------|------|------|
| `/matgo/` | 맞고 (화투 1:1 대전) | `matgo/server.js` | O |
| `/tetris-battle/` | 테트리스 배틀 | `tetris-battle/server.js` | X |
| `/davinci-code/` | 다빈치 코드 | `davinci-code/server.js` | X |
| `/yutnori/` | 윷놀이 | `yutnori/server.js` | X |
| `/codenames-duet/` | 코드네임 듀엣 | `codenames-duet/server.js` | X |
| `/janggi/` | 장기 (한국식 표준 KJA 2009) | `janggi/server.js` | O |
| `/hanabi/` | 하나비 (협력 불꽃 카드게임) | `hanabi/server.js` | X |

AI 봇 지원 게임은 1/2 AI 모드 진입 시 server.js가 `bot.js`를 child_process로 자동 spawn한다 (`getBotUrl` 옵션 패턴).

## 서버 실행

```bash
# 통합 런처 (포트 3000)
node launcher/server.js

# 개별 게임 단독 실행 (개발/테스트용)
node matgo/server.js --port 3013
```

## 테스트

각 게임별 CLAUDE.md에 테스트 가이드가 있다. QA는 반드시 해당 게임의 **룰북**을 먼저 숙지한 후 테스트를 진행한다.

- **장기 (janggi)**: 룰북 `janggi/docs/RULEBOOK.md` (KJA 2009, §1~§13 + 부록 A/B) + 룰북 기반 Playwright 시나리오 111개(`tests/rulebook-c1~c12-*.spec.js`, JR-C1~C12, §11 11/11 커버리지) 완비 (2026-05-31).
- **맞고 (matgo)**: 룰북 + 단위/E2E 104개. 2026-05-31 룰 보강 5건 — 사통(같은 월 4장 모달 +7), 흔들기/폭탄 카드 클릭 시점 모달(`shake_decision` phase 제거, `awaiting_sangtong` 신설), 첫뻑 +7 base 가산, 폭탄 후 덱 2턴 연속 뒤집기, floor 카드 ID 기반 `floorSlotMap` 위치 고정.
- **윷놀이 (yutnori)**: 룰북 `yutnori/docs/RULEBOOK.md` (한국 표준 + 본 구현 비교, §1~§13 + 부록, 2026-05-31) + 룰북 기반 Playwright 시나리오 168개(`tests/rulebook-c1~c14-*.spec.js`, YR-C1~C14, §13 11/11 커버리지) 완비 (2026-05-31). §13 구현 vs 표준 차이 **11건** (미해소 8 + 해소 3) — **§13-1 [HIGH]** 모서리 강제 지름길 / **§13-2 [HIGH]** centerExitB 즉시 완주는 사용자 의심 후보 1·2순위로 미해소. 2026-05-31 해소: §13-9 HOME 시각 통일 / §13-10 HOME → 칸 N 정통 매핑 / §13-11 capturedBonus 리셋(+THROW_YUT 보너스 진입 보강). 테스트: Playwright 273 (유닛 65 + WS 20 + 룰북 168 + E2E 25) + smoke 18.
- **하나비 (hanabi)**: 룰북 `hanabi/docs/RULEBOOK.md` (Antoine Bauza 표준 Hanabi + 본 구현 비교, §1~§13, 2026-06-01) + 룰북 기반 Playwright 시나리오 61개(`tests/rulebook-c1~c11-*.spec.js`, HR-C1~C11) 완비 (2026-06-01). 2인 완전 협력 카드게임 — 서버 권위 + **손패 가림**(`snapshotForPlayer`가 본인 손패 color/number null 마스킹)이 정체성. §13 구현 vs 표준 차이 **8건 전부 confirmed**. 회귀 게이트: 손패 누설(HR-C6-001/HR-C7-001), §13-7 오프바이원(HR-C7-003/004, 2026-06-01 giveClue checkGameEnd 누락 HIGH 버그 수정). 테스트: 유닛 31 + WS 7 + QA엣지 8 + E2E 6 + 가이드 슬라이더 9. **대기 화면 룰 가이드 슬라이더**(인포그래픽 7장 `public/assets/guide/`, 버튼·키보드·스와이프, HR-C11, 2026-06-01 추가 — game.js/WS 무변경). E2E(C8~C11)는 `node server.js --port 3095` 사전 구동 필요. **AI 봇 미지원.**

## 런처 로비

단일 화면에서 게임 카드 7개를 즉시 표시하고, 호스트가 카드를 클릭하여 게임을 선택한다. 스타트 버튼이나 별도의 종목 선택 단계는 없다.

- 1/2: 호스트가 카드 클릭 시 AI 모드로 게임 시작 (봇 미지원 게임은 비활성)
- 2/2: 호스트가 카드 클릭 시 인간 대전으로 양쪽 동시 이동
- 게스트: 카드 클릭 불가, 투표만 가능
- 게임 완료 후 "다른 종목" 버튼(`#btn-return-lobby`)으로 양쪽 동시 로비 복귀
- 게임 진행 중 상시 "게임 선택" 버튼(`#btn-back-to-lobby`)으로 로비 복귀 가능. confirm 다이얼로그 표시 후 `POST /lobby/return` 호출. 상대방은 disconnect 감지(OPPONENT_LEFT / GAME_RESULT disconnect / GAME_OVER disconnect) + path 기반 런처 모드 판정으로 1.2초 후 자동 redirect

### WS 프로토콜 (launcher /ws)

| 방향 | 메시지 | 페이로드 | 설명 |
|------|--------|---------|------|
| C->S | `PICK_GAME` | `{ gameId }` | 호스트가 게임 선택 |
| C->S | `VOTE_GAME` | `{ gameId }` | 투표 toggle |
| S->C | `LOBBY_STATE` | `{ count, role, hostId, mode, votes }` | 로비 상태 스냅샷 |
| S->C | `REDIRECT` | `{ gameId, path, mode }` | 게임 페이지 이동 |
| S->C | `FULL` | `{ message }` | 정원 초과 거절 |
| S->C | `RESET` | `{}` | 호스트 disconnect 시 초기화 |
| S->C | `RETURN_LOBBY` | `{}` | 로비 복귀 (양쪽 location.href='/') |

### HTTP 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/lobby/return` | 게임 완료 화면에서 호출. 서버가 votes/mode 리셋 + RETURN_LOBBY broadcast. 204 응답 |

## 기술 스택

- 바닐라 JavaScript (Node.js 서버, 브라우저 클라이언트)
- WebSocket (`ws` 패키지)
- Playwright (QA 자동화)
- 의존성: `npm install` (루트 `package.json`)
