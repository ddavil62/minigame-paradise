# 미니게임 천국 기획서

> 최종 업데이트: 2026-06-25 — 런처 로비 아키텍처 전면 개편. 공유 로비(단일 LOBBY 룸, WS 상시 연결) → 게임 포탈(WS 없음) + 게임별 독립 대기실(`rooms: Map<gameId, RoomState>`) 전환. READY 시스템(전원 준비 AND 인원 >= minPlayers), 타임아웃 킥(60초), WS 경로 `/ws` → `/lobby/ws?gameId={gameId}`, `POST /lobby/return` 삭제. QA 38/38 PASS.
> 이전 갱신: 2026-06-25 — READY 게이트 노후화 테스트 현행화 완료.
> 이전 갱신: 2026-06-23 — Phase 1-B 윷놀이 N인 확장 완료.
> 이전 갱신: 2026-06-23 — Phase 1-A 런처 로비 다인용 지원 + Lobby Entry UX 개선.
> 이전 갱신: 2026-06-17 — 버그리포트 배치 6건 수정 + 1건 보류.
> 이전 갱신: 2026-05-31

## 프로젝트 개요

LAN 환경에서 2~5인이 즐기는 미니게임 10종 통합 패키지. 단일 포트(3000)에서 통합 라우터로 런처와 10개 게임을 path 라우팅으로 서빙한다. 게임 포탈(WS 연결 없음)에서 카드를 클릭하면 해당 게임의 대기실에 입장하고, 전원 준비 완료 시 게임이 시작된다.

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
| 통합 라우터 | `launcher/server.js` | 단일 HTTP/WS 서버, path별 게임 dispatch, 게임별 대기실(`rooms: Map`) 관리 |
| 포탈/대기실 클라이언트 | `launcher/public/app.js` | 포탈 뷰(게임 카드 그리드) + 대기실 뷰(READY/AI 채우기) 상태 관리 |
| 게임 목록 | `launcher/public/games.json` | 10종 게임 메타데이터 (경로, 봇 지원, `minPlayers`/`maxPlayers` 인원 범위) |
| 각 게임 서버 | `{game}/server.js` | `createApp()` factory로 launcher에 연결 |

## 기능 목록

| 기능 | 설명 | 상태 |
|------|------|------|
| 단일 포트 통합 라우터 | HTTP/WS를 path segment로 10개 게임에 dispatch | 완료 |
| 게임 포탈 | 닉네임 게이트 통과 후 WS 없이 게임 카드 10개 표시. 카드 클릭으로 대기실 입장 | 완료 |
| 게임별 대기실 | 게임 카드 클릭 시 `/lobby/ws?gameId={gameId}`로 독립 대기실 입장. 전원 READY + 인원 >= minPlayers 시 게임 시작 | 완료 |
| 대기실 AI 채우기 | 호스트가 빈 슬롯을 AI 봇으로 채워 게임 시작. botAvailable=false 게임은 ERROR 반환 | 완료 |
| 타임아웃 킥 | 대기실 입장 후 60초 내 미준비 시 자동 퇴장(KICKED) | 완료 |
| 닉네임 자동 입장 | localStorage 닉네임 존재 시 게이트 스킵하여 즉시 포탈 진입 | 완료 |
| 로비 복귀 | 게임 완료 후 `location.href='/'`로 포탈 복귀. 각 게임 "로비로" 버튼 현행 유지 | 완료 |
| 게임 중 뒤로가기 | 6개 게임 헤더에 상시 "게임 선택" 버튼(`#btn-back-to-lobby`). confirm 다이얼로그 + disconnect 감지로 양쪽 로비 복귀 | 완료 |
| 봇 미지원 게임 차단 | AI 모드에서 봇 없는 게임 카드 비활성 (CSS+JS+서버 3중 가드) | 완료 |
| 입장 UI 통일 (Phase 1~4) | 오목 파일럿 패턴으로 9개 게임 전체 입장 UI 통일. 닉네임 게이트 + 대기 화면 + READY 프로토콜 + 이탈 배너 | 완료 |
| 맞고 (matgo) | 2인 화투 고스톱, AI 봇 지원 | 완료 |
| 윷놀이 N인 (Phase 1-B) | 윷놀이 2~4인 가변 플레이. N인 턴 순환, 잡기/업기 N인 판정, P3/P4 색상, rematch N인 확장 | 완료 |
| 테트리스 배틀 | 한게임 스타일 1:1 테트리스 대전 | 완료 |
| 다빈치 코드 플러스 | 2인 추리 게임. 빨강/노랑/파랑 3색 39장 타일, 조커 배치 페이즈, 2-column 레이아웃(좌 게임보드 + 우 정보 패널), 숫자 메모판(39칸), 추측 기록 누적 | 완료 |
| 코드네임 듀엣 | 2인 협동 워드 게임 | 완료 |
| 장기 (janggi) | KJA 2009 룰 준수 한국 전통 장기 2인 대전. 7종 기물, 마/상 배치 4종, 점수제/동형반복/50수 룰 지원. CSS/Canvas 렌더링, 외부 에셋 없음 | 완료 |

## 알려진 제약사항

- 봇은 matgo, yutnori, yahtzee, rummikub, omok, janggi, tetris-battle 지원. hanabi, codenames-duet, davinci-code는 AI 대전 불가.
- 게임별 다인용 로직은 윷놀이만 2~4인 완료. 요트/루미큐브/하나비(Phase 1-C~E)는 미구현.
- 윷놀이 3~4인 게임 중 1명 disconnect 시 게임 즉시 종료. 탈락 처리 후 계속 진행 미지원.
- 10개 게임 클라이언트에서 `fetch('/lobby/return')` 호출 코드가 잔존(404 반환). `.catch()` 처리로 사용자 영향 없으나 별도 정리 필요.
- 기존 Playwright 테스트(`lobby-ux-qa`, `lobby-ux-reqa`, `ai-fill-qa` 등)가 구 로비 구조 전제이므로 별도 정리 필요.
- 모바일 반응형 미지원.
- LAN 전용 설계 (인증/보안 없음).

## 향후 계획

- 10개 게임 클라이언트의 `fetch('/lobby/return')` 호출 코드 제거 (후속 정리)
- 구 로비 전제 Playwright 테스트 파일 정리/삭제
- matgo 기존 e2e 32건 현행화
- 다인용 Phase 1-C~E: 요트/루미큐브/하나비 게임 로직 3~4인 확장
- 다인용 Phase 2: 다빈치 코드/맞고/테트리스/코드네임/장기/오목 다인용 검토
- 모바일 반응형 레이아웃
- 장기: 무승부 거절 피드백(DRAW_REJECT), showCheckToast/showToast stale DOM 수정
