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

## 기술 스택

- 바닐라 JavaScript (Node.js 서버, 브라우저 클라이언트)
- WebSocket (`ws` 패키지)
- Playwright (QA 자동화)
- 의존성: `npm install` (루트 `package.json`)
