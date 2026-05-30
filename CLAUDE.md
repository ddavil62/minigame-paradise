# 미니게임 천국 (minigame-paradise)

LAN 1:1 미니게임 5종 통합 패키지. 단일 포트(3000) 통합 라우터 구조.

## 게임 목록

| 경로 | 게임 | 서버 |
|------|------|------|
| `/matgo/` | 맞고 (화투 1:1 대전) | `matgo/server.js` |
| `/tetris-battle/` | 테트리스 배틀 | `tetris-battle/server.js` |
| `/davinci-code/` | 다빈치 코드 | `davinci-code/server.js` |
| `/yutnori/` | 윷놀이 | `yutnori/server.js` |
| `/codenames-duet/` | 코드네임 듀엣 | `codenames-duet/server.js` |

## 서버 실행

```bash
# 통합 런처 (포트 3000)
node launcher/server.js

# 개별 게임 단독 실행 (개발/테스트용)
node matgo/server.js --port 3013
```

## 테스트

각 게임별 CLAUDE.md에 테스트 가이드가 있다. QA는 반드시 해당 게임의 **룰북**을 먼저 숙지한 후 테스트를 진행한다.

## 런처 로비

단일 화면에서 게임 카드 5개를 즉시 표시하고, 호스트가 카드를 클릭하여 게임을 선택한다. 스타트 버튼이나 별도의 종목 선택 단계는 없다.

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
