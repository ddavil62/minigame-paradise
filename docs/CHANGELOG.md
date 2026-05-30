# Changelog

## [2026-05-30] - 로비 UX 개선

### 추가
- **단일 화면 로비**: `lobby-view`와 `game-select-view`를 하나의 `lobby-view`로 통합. 접속 즉시 게임 카드 5개 표시
- **투표 시스템**: 게임 카드에 투표 버튼 추가. `VOTE_GAME` WS 메시지로 toggle 방식 투표, `LOBBY_STATE`에 `votes` 필드 포함하여 실시간 갱신
- **로비 복귀 버튼**: 5개 게임 완료 화면에 "다른 종목" 버튼 추가. `POST /lobby/return` HTTP 엔드포인트 호출 -> 서버가 `RETURN_LOBBY` broadcast -> 양쪽 동시 복귀
- **봇 미지원 게임 차단 (3중 가드)**: 1/2 AI 모드에서 봇 없는 게임 선택 차단
  - CSS: `.game-grid.ai-mode .game-card.no-bot` (opacity 0.5, grayscale, pointer-events:none, "AI 봇 미지원" 배지)
  - JS: `pick()` 핸들러에서 `currentCount` 기반 `effectiveMode` 판단, `showStatus()` 안내 메시지
  - 서버: `PICK_GAME` 핸들러에서 `isAiMode && !game.botAvailable` 검증, ERROR 메시지 반환
- **`lobby-meta` UI 영역**: 인원 카운트(72px), 역할 표시, 힌트 텍스트를 카드 그리드 상단에 배치

### 변경
- `launcher/server.js`: `lobbyPhase` 변수 제거, `votes` Map 추가, `PICK_GAME`에서 lobbyPhase 가드 제거 (카드 클릭 시점에 mode 결정), `sendLobbyStateTo`에 votes 직렬화 포함, disconnect 핸들러에 `votes.clear()` 추가
- `launcher/public/index.html`: `start-btn` 제거, `game-select-view` 블록 제거, 단일 `lobby-view`로 재구성
- `launcher/public/app.js`: `transitionTo`/`currentPhase`/`cardsRendered`/`SELECT_VIEW_ID` 제거, `currentVotes`/`cardClickEnabled`/`currentCount` 상태 추가, `updateLobbyUI` 재작성, `RETURN_LOBBY`/`PHASE`(무시) 핸들러 추가
- `launcher/public/style.css`: `.start-btn`/`.game-select-view` 관련 스타일 제거, `.lobby-meta`/`.game-card-vote`/`.game-grid.guest-mode`/`.game-grid.ai-mode` 스타일 추가
- WS 프로토콜: `START`(C->S), `PHASE`(S->C) 제거. `VOTE_GAME`(C->S), `RETURN_LOBBY`(S->C) 추가. `LOBBY_STATE`에 `votes` 필드 추가

### 수정
- **EX-07 (HIGH)**: 1/2 AI 모드에서 botAvailable=false 게임(yutnori, tetris-battle, davinci-code, codenames-duet) 선택이 차단되지 않던 버그 -> 3중 가드로 수정
- **힌트 텍스트 중복 (LOW)**: 게스트 2/2 화면에서 `#lobby-hint`와 `#guest-waiting`에 동일 텍스트가 중복 표시되던 문제 -> 게스트일 때 `#lobby-hint`를 비워서 해소
- **ai-mode CSS 미적용 (LOW)**: `updateLobbyUI()`에서 `grid.classList.toggle('ai-mode', count === 1)` 누락 -> 추가하여 봇 미지원 카드 시각적 비활성화 정상 동작

### 변경된 파일 목록
- `launcher/server.js`, `launcher/public/index.html`, `launcher/public/app.js`, `launcher/public/style.css`
- `matgo/public/index.html`, `matgo/public/client.js`, `matgo/public/style.css`
- `yutnori/public/index.html`, `yutnori/public/js/main.js`, `yutnori/public/css/style.css`
- `tetris-battle/public/index.html`, `tetris-battle/public/js/main.js`, `tetris-battle/public/css/style.css`
- `davinci-code/public/index.html`, `davinci-code/public/client.js`, `davinci-code/public/style.css`
- `codenames-duet/public/index.html`, `codenames-duet/public/client.js`, `codenames-duet/public/style.css`

### 참고
- 스펙: `.claude/specs/2026-05-30-lobby-ux-scope.md`
- 플랜: `.claude/specs/2026-05-30-lobby-ux-plan.md`
- 구현 리포트: `.claude/specs/2026-05-30-lobby-ux-coder-report.md`
- QA: `.claude/specs/2026-05-30-lobby-ux-qa-report.md`
- QA 테스트: `tests/lobby-ux-qa.spec.js` (26개), `tests/lobby-ux-reqa.spec.js` (21개)
