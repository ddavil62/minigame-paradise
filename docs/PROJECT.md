# 미니게임 천국 기획서

> 최종 업데이트: 2026-07-19 — **달빛 주방열차 추가.** 300초·9주문 기반 LAN 2인 협동 요리, 열차 변수, 재접속과 런처 통합을 완성했으며 최종 QA 31/31 PASS.
> 이전 갱신: 2026-07-19 — 별빛 우편탑 월드 확장 보완 페이즈 R. 신규 4월드의 독립 지형·서버 권위 동적 기믹, 예상/최고 기록 UI를 완성했으며 최종 QA 46/46 PASS.
> 이전 갱신: 2026-07-18 — 별빛 우편탑 추가(12번째 게임).
> 이전 갱신: 2026-06-28 — 코드네임 클래식 신규 추가(11번째 게임).
> 이전 갱신: 2026-06-28 — 재현 확정 버그 3건 수정. codenames-duet #10(새 게임 시 이전 복기 점/배경 잔존 → `clearReviewArtifacts()` 헬퍼로 GAME_START·복기 닫기 양쪽 정리), tetris-battle #12(봇 start desync → `(countdown+1)*1000`ms 지연), #13(AI채우기 재진입 "Room is full" → 좀비 봇 슬롯 동기 제거 + 죽은 슬롯 선제 sweep). 회귀 무회귀 확인(review-smoke 27/27, bot-smoke 11/11), #8/#9는 재현 불가로 제외.
> 이전 갱신: 2026-06-25 — 런처 로비 아키텍처 전면 개편. 공유 로비(단일 LOBBY 룸, WS 상시 연결) → 게임 포탈(WS 없음) + 게임별 독립 대기실(`rooms: Map<gameId, RoomState>`) 전환. READY 시스템(전원 준비 AND 인원 >= minPlayers), 타임아웃 킥(60초), WS 경로 `/ws` → `/lobby/ws?gameId={gameId}`, `POST /lobby/return` 삭제. QA 38/38 PASS.
> 이전 갱신: 2026-06-25 — READY 게이트 노후화 테스트 현행화 완료.
> 이전 갱신: 2026-06-23 — Phase 1-B 윷놀이 N인 확장 완료.
> 이전 갱신: 2026-06-23 — Phase 1-A 런처 로비 다인용 지원 + Lobby Entry UX 개선.
> 이전 갱신: 2026-06-17 — 버그리포트 배치 6건 수정 + 1건 보류.
> 이전 갱신: 2026-05-31

## 프로젝트 개요

LAN 환경에서 2~5인이 즐기는 미니게임 13종 통합 패키지. 단일 포트(3000)에서 통합 라우터로 런처와 각 게임을 경로별로 제공한다. 게임 포탈에서 카드를 선택해 독립 대기실에 입장하고, 최소 인원 이상이 모두 준비하면 게임이 시작된다.

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
  codenames/         # 코드네임 클래식
  janggi/            # 장기 (KJA 2009 룰, PvP 전용)
  hanabi/            # 하나비
  yahtzee/           # 요트 다이스
  rummikub/          # 루미큐브
  omok/              # 오목
  starlight-mail-tower/ # 별빛 우편탑 2인 협동 등반
  moonlight-kitchen-express/ # 달빛 주방열차 2인 협동 요리
  tests/             # Playwright QA 테스트
  docs/              # 프로젝트 문서
```

### 핵심 모듈

| 모듈 | 파일 | 역할 |
|------|------|------|
| 통합 라우터 | `launcher/server.js` | 단일 HTTP/WS 서버, path별 게임 dispatch, 게임별 대기실(`rooms: Map`) 관리 |
| 포탈/대기실 클라이언트 | `launcher/public/app.js` | 포탈 뷰(게임 카드 그리드) + 대기실 뷰(READY/AI 채우기) 상태 관리 |
| 게임 목록 | `launcher/public/games.json` | 13종 게임 메타데이터 (경로, 봇 지원, `minPlayers`/`maxPlayers` 인원 범위) |
| 각 게임 서버 | `{game}/server.js` | `createApp()` factory로 launcher에 연결 |
| 별빛 우편탑 시뮬레이션 | `starlight-mail-tower/game/` | 30Hz 서버 권위 이동·장치·체크포인트·결승 상태 관리 |
| 별빛 우편탑 레벨 카탈로그 | `starlight-mail-tower/shared/levels.js` | 5개 레벨의 월드·8모듈·체크포인트·피날레 공용 데이터 제공 |
| 별빛 우편탑 기록 저장소 | `starlight-mail-tower/game/records.js` | 레벨별 최단 기록을 JSON으로 원자 저장하고 손상 기록을 복구 |
| 달빛 주방열차 시뮬레이션 | `moonlight-kitchen-express/game/` | 30Hz 서버 권위 이동·아이템·조리·주문·열차 이벤트·점수 상태 관리 |
| 달빛 주방열차 클라이언트 | `moonlight-kitchen-express/public/` | Canvas 플레이 화면, READY·HUD·결과·재접속 UI와 ko/en 제공 |

## 기능 목록

| 기능 | 설명 | 상태 |
|------|------|------|
| 단일 포트 통합 라우터 | HTTP/WS를 경로별로 13개 게임에 dispatch | 완료 |
| 게임 포탈 | 닉네임 게이트 통과 후 게임 카드 13개 표시. 카드 클릭으로 대기실 입장 | 완료 |
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
| 코드네임 클래식 | 4인 팀 기반 단어 추리 게임 | 완료 |
| 장기 (janggi) | KJA 2009 룰 준수 한국 전통 장기 2인 대전. 7종 기물, 마/상 배치 4종, 점수제/동형반복/50수 룰 지원. CSS/Canvas 렌더링, 외부 에셋 없음 | 완료 |
| 하나비 | 2~5인 협동 카드 게임 | 완료 |
| 요트 다이스 | 2~4인 주사위 게임 | 완료 |
| 루미큐브 | 2~4인 타일 게임 | 완료 |
| 오목 | 2인 오목 대전 | 완료 |
| 별빛 우편탑 | 독립 지형과 서버 권위 동적 기믹을 갖춘 5개 월드의 LAN 2인 협동 게임. 호스트 선택, 결과 합의, 예상/최고 기록 지원 | 완료 |
| 달빛 주방열차 | 이동식 야시장 열차에서 주문·조리·정차·커브·2인 냉각을 수행하는 LAN 2인 협동 요리 게임 | 완료 |

## 알려진 제약사항

- 봇은 matgo, yutnori, yahtzee, rummikub, omok, janggi, tetris-battle, codenames에서 지원한다. hanabi, codenames-duet, davinci-code, starlight-mail-tower, moonlight-kitchen-express는 AI를 지원하지 않는다.
- 게임별 다인용 로직은 윷놀이만 2~4인 완료. 요트/루미큐브/하나비(Phase 1-C~E)는 미구현.
- 윷놀이 3~4인 게임 중 1명 disconnect 시 게임 즉시 종료. 탈락 처리 후 계속 진행 미지원.
- 일부 기존 게임 클라이언트에 `fetch('/lobby/return')` 호출 코드가 잔존한다. 404는 처리되지만 별도 정리가 필요하다.
- 기존 Playwright 테스트(`lobby-ux-qa`, `lobby-ux-reqa`, `ai-fill-qa` 등)가 구 로비 구조 전제이므로 별도 정리 필요.
- 별빛 우편탑 신규 4월드의 8~15분 체감 난이도와 모든 모듈 연속 실입력 완주는 실제 두 기기 플레이테스트로 추가 튜닝해야 한다.
- 달빛 주방열차는 LAN 2인·키보드 전용이며 추가 맵, 3~4인, AI, 캠페인과 터치 조작을 지원하지 않는다.
- 모바일 반응형 미지원.
- LAN 전용 설계 (인증/보안 없음).

## 향후 계획

- 기존 게임 클라이언트의 `fetch('/lobby/return')` 호출 코드 제거 (후속 정리)
- 구 로비 전제 Playwright 테스트 파일 정리/삭제
- matgo 기존 e2e 32건 현행화
- 다인용 Phase 1-C~E: 요트/루미큐브/하나비 게임 로직 3~4인 확장
- 다인용 Phase 2: 다빈치 코드/맞고/테트리스/코드네임/장기/오목 다인용 검토
- 모바일 반응형 레이아웃
- 장기: 무승부 거절 피드백(DRAW_REJECT), showCheckToast/showToast stale DOM 수정
