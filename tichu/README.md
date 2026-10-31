# 티추

미니게임 천국의 4인 2:2 팀전 카드 게임이다. 맞은편 파트너와 한 팀이 되어 손패를 먼저 다 내고, 용·봉황·개·참새 특수 카드와 티추 콜로 점수를 겨룬다. 사람 1~4명이 모이고 빈자리는 서버 관리형 AI(쉬움·보통·어려움)가 채운다.

- 규칙·구조·프로토콜·테스트: [CLAUDE.md](CLAUDE.md)
- 실행(단독): `node server.js --port 3022` → `http://localhost:3022`
- 통합 런처에서는 `node launcher/server.js`(포트 3000)로 `/tichu/`에 들어온다. 친구 접속은 항상 공인 IP HTTPS 주소(`docs/REMOTE-ACCESS.md`)를 쓴다.
- 테스트: `node --test tests/combos.test.js tests/game.test.js tests/server.test.js`, `npx playwright test --config=playwright.config.js`
