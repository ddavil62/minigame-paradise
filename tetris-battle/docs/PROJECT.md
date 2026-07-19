# Tetris Battle 기획서

> 최종 업데이트: 2026-07-20 — 프리즈 중에는 블록 조작만 차단하고 아이템 키·슬롯 클릭은 허용. 라운드 종료·재대결 시작 시 프리즈 및 held 입력 상태를 완전히 초기화해 간헐적인 키보드 잠금을 수정. QA PASS(제품 결함 0건). 이전: 2026-06-28 봇 버그 2건 수정

## 프로젝트 개요

LAN 환경에서 두 PC가 IP 접속으로 1:1 대결을 펼치는 한게임 테트리스 아이템전 스타일의 웹 게임. 친구가 놀러 왔을 때 즉시 플레이 가능한 로컬 멀티플레이어 프로토타입. 혼자일 땐 AI 봇과 1인 대전도 가능(2026-06-21).

## 기술 스택

| 항목 | 기술 |
|------|------|
| 서버 | Node.js 18+ (ES Modules), Express 4, ws 8 |
| 클라이언트 | 바닐라 JavaScript (프레임워크 미사용), HTML5 Canvas |
| 네트워크 | WebSocket (단일 포트 HTTP+WS 공유) |
| 테스트 | Node 기반 자체 슈트 + Playwright Chromium 회귀 테스트 |
| 런처 | Windows 배치 파일 (`start.bat` / `stop.bat`) |
| 외부 에셋 | 없음 — 모든 보드/HUD/아이템은 CSS 도형 + 색상으로 렌더 |

## 아키텍처

### 데이터 흐름 (클라이언트 권위 + 서버 중계)

```
[클라이언트 A]                [서버]              [클라이언트 B]
  키 입력 → 로컬 즉시 반영
  라인 제거 → GARBAGE_SEND ──→ 중계 ──→ GARBAGE_RECV → B 보드 하단
  아이템 사용 → ITEM_USE ────→ 권위처리 ─→ ITEM_EFFECT/SHIELD_BLOCK
  게임오버 → GAME_OVER ──────→ 브로드캐스트 ──→ GAME_RESULT
```

서버는 보드 전체 상태를 매 tick 브로드캐스트하지 않는다. 각 클라이언트가 자기 보드를 로컬 시뮬레이션하고 이벤트(가비지/아이템/게임오버)만 중계한다. 입력 지연 최소화가 최우선 (사용자 격투게임 프로 출신).

### 디렉토리 구조

```
tetris-battle/
├── server.js                  # WebSocket + HTTP 정적 서빙 (단일 포트) + 봇 spawn/kill
├── bot.js                     # AI 봇: 독자 테트리스 엔진 + WS 클라이언트 (2026-06-21)
├── start.bat / stop.bat       # Windows 더블클릭 런처/종료
├── package.json
├── README.md
├── docs/                      # PROJECT.md / CHANGELOG.md
├── public/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── main.js            # 진입점, 모듈 와이어업
│       ├── game.js            # 게임 루프 (rAF), 상태 머신
│       ├── tetromino.js       # 7종 피스, 7-bag, 회전
│       ├── board.js           # 보드 상태, 충돌, 라인 제거, 가비지
│       ├── input.js           # DAS/ARR 키 입력
│       ├── network.js         # WebSocket 클라이언트
│       ├── items.js           # 5종 아이템 슬롯/효과
│       └── ui.js              # Canvas 렌더, HUD, 오버레이
└── tests/                     # 단계별 회귀·봇 smoke·브라우저 입력 테스트
```

### 핵심 모듈

| 모듈 | 파일 | 역할 |
|---|---|---|
| 서버 | `server.js` | 2인 1룸 중계, ITEM_USE 권위 처리(방어막/슬롯 차감), LAN IP 자동 감지, 포트 충돌 폴백, `mode=ai` 시 봇 spawn/kill |
| AI 봇 | `bot.js` | 독자 테트리스 엔진(board/tetromino 인라인 재구현) + WS 클라이언트. 1-look 전수 탐색 휴리스틱, 800~1200ms/피스, 라인 클리어 시 GARBAGE_SEND만 중계 |
| 게임 루프 | `public/js/game.js` | rAF 기반 중력/Lock Delay/콤보, 상태 머신 (WAITING→COUNTDOWN→PLAYING→GAME_OVER) |
| 보드 | `public/js/board.js` | 10×22 그리드 (visible 20 + hidden 2 vanish zone), 충돌·라인 제거·가비지(동일 hole)·고스트 |
| 피스 | `public/js/tetromino.js` | I/O/T/S/Z/J/L 7종 + 4회전 행렬 + 7-bag (Fisher-Yates) |
| 입력 | `public/js/input.js` | DAS 167ms + ARR 33ms, 프리즈 시 블록 조작만 차단하고 아이템 키는 허용 |
| 아이템 | `public/js/items.js` | 슬롯 3개, 5종 효과 적용, 다크/프리즈 setTimeout 및 라운드 경계 상태 해제 |
| 네트워크 | `public/js/network.js` | WS 송수신, hostUrl 라우팅, 3초 후 1회 재연결 |
| UI | `public/js/ui.js` | Canvas 보드/NEXT/HOLD, HUD, 다크 오버레이, 초대 패널, 토스트 |

## 기능 목록

| 기능 | 설명 | 상태 |
|------|------|------|
| 코어 테트리스 | 10×20 보드, 7-bag, 회전, 홀드, 고스트, Lock Delay 500ms | 완료 (Phase 1) |
| 입력 | DAS 167ms / ARR 33ms, 소프트 드롭, 하드 드롭 | 완료 (Phase 1) |
| 점수/레벨 | Single 100/Double 300/Triple 500/Tetris 800 × 레벨, 10줄당 +1 | 완료 (Phase 1) |
| 가비지 공격 | 변환표(0/1/2/4) + 콤보 +0.5/콤보, 동일 hole 칸 | 완료 (Phase 1) |
| LAN 1:1 | WebSocket 중계, JOIN→READY→START(3초 카운트다운) | 완료 (Phase 1) |
| 상대 미니맵 | 컬럼별 높이 막대 (가비지 회색) | 완료 (Phase 1) |
| 게임오버/재대결 | 토프아웃 판정, 결과 오버레이, 양쪽 REMATCH → 재시작. 종료·시작 양쪽에서 프리즈/held 입력 초기화 | 완료 (2026-07-20 보정) |
| 5종 아이템 | 가비지 폭탄 / 시야 가림(5초) / 프리즈(3초) / 라인 클리어 / 방어막 | 완료 (Phase 2) |
| 아이템 지급 | 라인 클리어당 50% 확률, 최대 슬롯 3개 (서버 권위) | 완료 (Phase 2) |
| 방어막 권위 | 서버가 shieldActive 추적, 공격 수신 시 차단 결정 후 양쪽 SHIELD_BLOCK | 완료 (Phase 2) |
| 카운트다운 폴리시 | 3-2-1-GO 펄스 애니메이션 | 완료 (Phase 3) |
| 시각 피드백 | 다크 오버레이 페이드 350ms, 방어막 글로우/알림, 가비지 폭탄 보드 흔들림 | 완료 (Phase 3) |
| 입력/FPS 측정 | `window.__perf.report()` 콘솔 노출 (capture keydown + rAF 샘플링) | 완료 (Phase 3) |
| 런처 | `start.bat` 더블클릭 → 새 콘솔 + 브라우저 자동 오픈 / `stop.bat` 포트 기반 종료 | 완료 (Phase 4) |
| 호스트 안내 | ANSI 컬러 박스 LAN URL, 가상 어댑터 후순위 정렬, JOINED hostUrl 필드 | 완료 (Phase 4) |
| 초대 패널 | 대기 화면에 친구용 URL + [주소 복사] 버튼 + 토스트 (clipboard API + execCommand 폴백) | 완료 (Phase 4) |
| 포트 폴백 | 3000 사용 중이면 3001~3010 자동 재시도 (wss 채널 error 핸들러 포함) | 완료 (Phase 4 revise1) |
| Vanish Zone | 상단 hidden zone 2줄(BOARD_HEIGHT=22, VISIBLE_HEIGHT=20). 표준 SRS/한게임 스타일 스폰 → visible top 가득 시 즉시 게임오버 방지 | 완료 (Phase 5) |
| AI 봇 대전 | 대기 화면 "🤖 AI랑 시작"(`?mode=ai`) → 독자 엔진 봇 1인 대전. 1-look 휴리스틱·800~1200ms/피스 캐주얼 난이도, garbage_bomb만 반영(dark/freeze 무시) | 완료 (2026-06-21) |
| .exe 단일 빌드 | Plan B항 (pkg/SEA) | 미착수 (선택) |

## 게임플레이 규칙 요약

- **보드**: 10 (가로) × 22 (세로, 데이터 영역). 시각 영역은 상단 2줄(hidden vanish zone)을 제외한 20줄. 피스는 hidden zone에서 스폰 → visible top까지 차도 즉시 게임오버되지 않음 (표준 SRS / 한게임 방식)
- **중력**: Lv1 1000ms/줄, 레벨업마다 100ms 감소, 최소 100ms
- **소프트 드롭**: 50ms 간격 (중력의 약 20배)
- **하드 드롭**: 즉시 바닥 고정 (Space)
- **Lock Delay**: 바닥 닿은 후 500ms, 이동/회전으로 리셋 가능 (최대 15회)
- **DAS / ARR**: 167ms / 33ms (Jstris 기본값 근사)
- **콤보**: 첫 클리어는 보너스 없음 (combo 시작값 -1), 두 번째 연속부터 +0.5줄/콤보 가산 (반올림)

### 가비지 변환표 (라인 클리어 → 상대에게 전송)
| 클리어 | 가비지 |
|---|---|
| Single | 0 |
| Double | 1 |
| Triple | 2 |
| Tetris | 4 |

T-spin / Perfect Clear 보너스는 현재 미감지 (향후 확장 후보).

## 아이템 5종 요약

| ID | 이름 | 유형 | 효과 | 지속 |
|---|---|---|---|---|
| `garbage_bomb` | 가비지 폭탄 | 공격 | 상대 보드 하단 2줄 즉시 추가 | 즉시 |
| `dark` | 시야 가림 | 공격 | 상대 보드 위 검은 오버레이 (opacity 0.82, 페이드 350ms) | 5초 |
| `freeze` | 프리즈 | 공격 | 상대 블록 조작 차단, 아이템 키·슬롯 클릭은 허용 (중력은 유지) | 3초 |
| `line_clear` | 라인 클리어 | 방어 | 자기 보드 하단 2줄 즉시 제거 | 즉시 |
| `shield` | 방어막 | 방어 | 서버 권위로 다음 공격 1회 차단, 양쪽에 SHIELD_BLOCK | 다음 공격까지 |

## WebSocket 프로토콜 (요약)

| 방향 | 타입 | 페이로드 |
|---|---|---|
| C→S | `JOIN` | `playerName` |
| C→S | `READY` | - |
| C→S | `GARBAGE_SEND` | `lines` (0~20 클램프), `combo` (0~99 클램프) |
| C→S | `BOARD_STATE` | `height`, `stack` (미니맵용) |
| C→S | `ITEM_USE` | `itemId`, `slotIndex` |
| C→S | `GAME_OVER` | - |
| C→S | `REMATCH` | - |
| S→C | `JOINED` | `playerId`, `waiting`, `hostUrl` (Phase 4 추가) |
| S→C | `START` | `countdown: 3` |
| S→C | `GARBAGE_RECV` | `lines`, `combo` |
| S→C | `OPPONENT_BOARD` | `height`, `stack` |
| S→C | `ITEM_GRANT` | `itemId`, `slotIndex` |
| S→C | `ITEM_EFFECT` | `itemId`, `duration` (ms) |
| S→C | `SHIELD_BLOCK` | `itemId` |
| S→C | `GAME_RESULT` | `winner`, `reason` (`topout` \| `disconnect`) |
| S→C | `REMATCH_STATUS` | `p1Ready`, `p2Ready` |
| S→C | `ERROR` | `message` (예: `Room is full`) |

## 실행 방법

### 더블클릭 (권장)
호스트 PC에서 `tetris-battle\start.bat`을 더블클릭 → 새 콘솔에서 서버 자동 기동 + `http://localhost:3000` 자동 오픈. 새 콘솔 박스에 친구용 LAN URL 표시. 대기 화면의 [주소 복사] 버튼으로 친구에게 전달.

종료: `stop.bat` 더블클릭 (3000~3010 LISTENING PID만 종료, 다른 Node 프로세스는 영향 없음).

### 수동
```powershell
cd C:\LazySlimeStudio\tetris-battle
npm install     # 최초 1회
npm start       # 또는 node server.js [--port 4000]
```

## 알려진 제약사항

- LAN 전용 (WAN/인터넷 매치 미지원)
- 2인 1룸 고정 (3번째 접속 거절)
- SRS 벽킥 미구현 (단순 회전만)
- T-spin / Perfect Clear 보너스 미감지
- Windows 전용 런처 (`.bat`). macOS/Linux에서는 `node server.js` 수동 실행 필요
- 모바일 반응형 미지원 (1080p PC 브라우저 기준)
- 외부 클라이언트 라이브러리 0 (바닐라 JS)

## 향후 확장 후보 (미착수)

- SRS 벽킥 + T-spin 감지 + Perfect Clear 보너스 (가비지 변환표 확장)
- 단일 .exe 빌드 (`pkg` 또는 Node 21+ SEA) — 친구 PC에 Node가 없을 때
- 옵저버/관전 모드 (현재 2인 1룸 고정)
- 매치 통계/랭킹 저장 (현재 세션 임시)
- macOS/Linux 셸 스크립트 (`start.sh`)

## 참조 문서

- 변경 이력: `docs/CHANGELOG.md`
- 사용법: `README.md`
- 파이프라인 산출물: `C:\LazySlimeStudio\.claude\specs\2026-05-25-tetris-battle-*.md`
