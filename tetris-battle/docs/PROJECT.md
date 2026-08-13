# Tetris Battle 기획서

> 최종 업데이트: 2026-08-13 — 방 인원 2~6명 지원. 입장 인원 전원 READY 시 현재 인원으로 시작하고, 입장 순서 번호·닉네임·3×2 상대 보드·탈락 관전·최후 생존 승리를 제공한다. 공격 아이템은 600ms 내 아이템/대상 번호 조합으로 지정하며 일반 가비지는 최근 아이템 대상 또는 무작위 생존 상대에게 전송한다.
> 이전 갱신: 2026-08-01 — 단일 글로벌 2인 룸 구조를 `Map<roomId, Room>` 기반 멀티룸 아키텍처로 전면 재설계. N명 동시 접속 시 자동으로 여러 2인 룸으로 분리. 초대 링크 공유(주소창 room 파라미터 자동 반영), AI 전용 룸 격리, 룸 즉시 소멸 정책 포함. 회귀 17개 슈트 436건 + QA 독립 19건 PASS.

## 프로젝트 개요

공인 IP HTTPS 주소로 2~6명이 대결하는 한게임 테트리스 아이템전 스타일의 웹 게임. 친구는 같은 공유기에서도 `https://112.155.2.238`로 접속하며 포트 3000 직접 접속은 허용하지 않는다. 혼자일 땐 AI 봇과 1:1 대전도 가능하다.

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
  라인 제거 → GARBAGE_SEND(clearEventId) ──→ 중계/아이템 판정 ──→ GARBAGE_RECV
  보드 변경 → BOARD_STATE(cells/final) ─────→ 중계 ──→ OPPONENT_BOARD → 실제 셀 미니맵
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
| 서버 | `server.js` | `Map<roomId, Room>` 멀티룸 관리, 룸 결정 로직(명시적 room/AI 전용/자동 합류), 고유 클리어 이벤트별 80% 확률·아이템 슬롯 권위 처리, 전체 보드 검증·중계, LAN IP 감지, `mode=ai` 봇 관리, WS 하트비트(ping/pong 4초 주기)로 좀비 소켓 자동 회수 |
| AI 봇 | `bot.js` | 독자 테트리스 엔진(board/tetromino 인라인 재구현) + WS 클라이언트. 1-look 전수 탐색 휴리스틱, 800~1200ms/피스, 라인 클리어 시 GARBAGE_SEND만 중계 |
| 게임 루프 | `public/js/game.js` | rAF 기반 중력/Lock Delay/콤보, 상태 머신 (WAITING→COUNTDOWN→PLAYING→GAME_OVER) |
| 보드 | `public/js/board.js` | 10×22 그리드 (visible 20 + hidden 2 vanish zone), 충돌·라인 제거·가비지(동일 hole)·고스트 |
| 피스 | `public/js/tetromino.js` | I/O/T/S/Z/J/L 7종 + 4회전 행렬 + 7-bag (Fisher-Yates) |
| 입력 | `public/js/input.js` | DAS 167ms + ARR 33ms, 프리즈 시 블록 조작만 차단하고 아이템 키는 허용 |
| 아이템 | `public/js/items.js` | 슬롯 3개, 5종 효과 적용, 다크/프리즈 타이머·방어막 글로우 및 레거시 차단 역할 fallback |
| 네트워크 | `public/js/network.js` | WS 송수신, room 파라미터 파싱·sessionStorage 보존, JOINED 수신 시 `history.replaceState`로 주소창 roomId 반영, 클리어 이벤트 ID·전체 보드·최종 상태 전달, 방어막 역할값 보존, 1회 재연결 |
| UI | `public/js/ui.js` | Canvas 보드/NEXT/HOLD, 실제 셀 기반 상대 미니맵, HUD, 효과 오버레이·토스트 |

## 기능 목록

| 기능 | 설명 | 상태 |
|------|------|------|
| 코어 테트리스 | 10×20 보드, 7-bag, 회전, 홀드, 고스트, Lock Delay 500ms | 완료 (Phase 1) |
| 입력 | DAS 167ms / ARR 33ms, 소프트 드롭, 하드 드롭 | 완료 (Phase 1) |
| 점수/레벨 | Single 100/Double 300/Triple 500/Tetris 800 × 레벨, 10줄당 +1 | 완료 (Phase 1) |
| 가비지 공격 | 변환표(0/1/2/4) + 콤보 +0.5/콤보, 동일 hole 칸 | 완료 (Phase 1) |
| HTTPS 2~6인 멀티룸 | `Map<roomId, Room>` 기반 독립 룸. 현재 입장 인원 전원 READY 시 시작, 입장 순서 번호 고정, 탈락 관전과 최후 생존 승리. `?room=<id>` 초대 링크, AI 전용 룸 격리, 인원 0명 즉시 소멸 | 완료 (2026-08-13) |
| 상대 미니맵 | 검증된 22×10 전체 셀로 블록 종류·가비지 구멍을 표시하고 구형 높이 payload는 폴백 처리 | 완료 (2026-07-27 보강) |
| 게임오버/재대결 | 토프아웃 판정, 결과 오버레이, 양쪽 REMATCH → 재시작. 종료·시작 양쪽에서 프리즈/held 입력 초기화 | 완료 (2026-07-20 보정) |
| 5종 아이템 | 가비지 폭탄 / 시야 가림(5초) / 프리즈(레벨 비례 최대 3초) / 라인 클리어 / 방어막. 상대별 보유 슬롯 3개를 서버 권위로 공개·실시간 동기화 | 완료 |
| 아이템 지급 | 콤보와 무관하게 고유 라인 클리어 이벤트마다 80% 확률 지급, 중복 차단·첫 빈 슬롯 재사용 (종류 선택은 무작위) | 완료 (2026-07-27 복원) |
| 반응형 전투 화면 | 390×844 세로 화면에서 ITEMS·보드·NEXT를 첫 행에 두고 VS·상대 미니맵을 아래 흐름에 배치하며 데스크톱 가로 배치를 유지 | 완료 (2026-07-27) |
| 방어막 권위 | 최신 서버의 `isDefender`를 우선하고, 필드 없는 레거시 메시지는 로컬 활성 상태로 단독 방어자를 판별해 방어막을 소모 | 완료 (2026-07-22 호환 보정) |
| 카운트다운 폴리시 | 3-2-1-GO 펄스 애니메이션 | 완료 (Phase 3) |
| 시각 피드백 | 다크 페이드, 방어막 지속 외곽 글로우·차단 소멸, 프리즈 표시, 가비지 폭탄 보드 흔들림 | 완료 (2026-07-22 보강) |
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

Single 0 / Double 1 / Triple 2 / Tetris 4. T-spin / Perfect Clear 보너스는 현재 미감지 (향후 확장 후보).

### 아이템 5종

가비지 폭탄(상대 +2줄) / 시야 가림(5초) / 프리즈(3초, 블록 조작만 차단) / 라인 클리어(자기 -2줄) / 방어막(공격 1회 차단, 금색 글로우)

## 룸 관리 아키텍처 (멀티룸)

서버는 `Map<roomId, Room>` 구조로 동시에 여러 독립 2~6인 룸을 관리한다. 각 Room은 waiting/playing/finished 단계를 가지며 모든 게임 상태는 룸 단위로 격리된다.

### 룸 결정 로직 (3갈래)

| 조건 | 동작 |
|------|------|
| `?room=<id>` 파라미터 있음 | 해당 룸에만 입장 시도. 꽉 찼으면 ERROR "Room is full", 존재하지 않으면 ERROR "Room not found". 자동 폴백 없음 (초대 링크 무결성 보존) |
| `?mode=ai` (room 파라미터 없음) | 항상 전용 신규 룸 생성. 대기 중인 사람 룸에 합류하지 않음. `_botSpawnPending` 가드로 200ms 봇 spawn 대기 중 일반 사용자 침입 차단 |
| 파라미터 없음 (기본) | `findWaitingRoom()`으로 1인 대기 중인 룸에 자동 합류. 없으면 신규 룸 생성 |

### 초대 링크 공유

JOINED 수신 시 `network.js`가 `history.replaceState()`로 브라우저 주소창에 `?room=<roomId>`를 자동 반영. 사용자가 주소창을 복사해 친구에게 공유하면 동일 룸에 바로 입장 가능. `hostUrl` 필드에도 room 파라미터 포함.

### launcher 연동

`launcher/server.js`의 `/lobby/ws` 2인 매칭 로직은 유지. 매칭 완료 시 REDIRECT 페이로드에 `roomId`(`crypto.randomUUID()`)를 추가하고, path를 `/tetris-battle/?room=<roomId>`로 구성해 같은 로비에서 매칭된 두 클라이언트가 게임 서버의 동일 룸으로 진입.

### 룸 수명주기

인원 0명 시 `roomMap`에서 즉시 삭제(소멸). 유예시간 없음. REMATCH는 양쪽 접속 유지 상태에서만 성립하므로 즉시 소멸 정책과 충돌하지 않음.

## WebSocket 프로토콜 (요약)

| 방향 | 타입 | 페이로드 |
|---|---|---|
| C→S | `JOIN` | `playerName` |
| C→S | `READY` | - |
| C→S | `GARBAGE_SEND` | `lines` (0~20), `combo` (0~99), `clearEventId` |
| C→S | `BOARD_STATE` | `height`, `stack`, `cells` (22×10), `final?` |
| C→S | `ITEM_USE` | `itemId`, `slotIndex` |
| C→S | `GAME_OVER` | - |
| C→S | `REMATCH` | - |
| S→C | `JOINED` | `playerId`, `waiting`, `hostUrl` (Phase 4 추가), `roomId` (멀티룸 추가) |
| S→C | `START` | `countdown: 3` |
| S→C | `GARBAGE_RECV` | `lines`, `combo` |
| S→C | `OPPONENT_BOARD` | `height`, `stack`, 검증된 `cells`, `final` |
| S→C | `ITEM_GRANT` | `itemId`, `slotIndex` |
| S→C | `ITEM_EFFECT` | `itemId`, `duration` (ms) |
| S→C | `SHIELD_BLOCK` | `itemId`, `isDefender?` (최신 서버는 실제 방어자 여부를 명시, 레거시는 생략 가능) |
| S→C | `GAME_RESULT` | `winner`, `reason` (`topout` \| `disconnect`) |
| S→C | `REMATCH_STATUS` | `p1Ready`, `p2Ready` |
| S→C | `ERROR` | `message` (예: `Room is full`) |

## 실행 방법

### 공개 운영 (권장)
프로젝트 루트에서 `start-public.ps1` 또는 `start-public.bat`을 실행하고 친구에게 `https://112.155.2.238`을 전달한다. 같은 공유기에서도 이 주소를 사용한다. 포트 3000과 개별 게임 포트는 내부·개발 전용이다.

종료: 공개 서버 콘솔에서 Ctrl+C. 코드 반영을 위해 재시작할 때는 정확한 런처 프로세스만 대상으로 한다.

### 수동 (개발·테스트 전용)
```powershell
cd C:\LazySlimeStudio\tetris-battle
npm install     # 최초 1회
npm start       # 또는 node server.js [--port 4000]
```

## 알려진 제약사항

- 공개 HTTPS 통합 런처를 통한 친구 플레이를 지원하며 임의 공개 매치메이킹은 지원하지 않음
- 각 룸은 2~6인. 대기 중인 룸에는 최대 6명까지 합류하며 게임 시작 후에는 잠긴다. 좀비 소켓은 하트비트(4초 주기)로 자동 회수한다.
- SRS 벽킥 미구현 (단순 회전만)
- T-spin / Perfect Clear 보너스 미감지
- Windows 전용 런처 (`.bat`). macOS/Linux에서는 `node server.js` 수동 실행 필요
- 390×844 세로형 전투 화면은 지원하지만 터치 조작과 그보다 작은 화면의 품질은 보장하지 않음
- 외부 클라이언트 라이브러리 0 (바닐라 JS)
- 기존 `phase3-4-qa-edge.test.js` Q7b는 유니코드 콘솔 배너와 ASCII 전용 검사의 불일치로 실패하며 게임 기능과 무관한 문서화된 테스트 부채

## 향후 확장 후보 (미착수)

- SRS 벽킥 + T-spin 감지 + Perfect Clear 보너스 (가비지 변환표 확장)
- 단일 .exe 빌드 (`pkg` 또는 Node 21+ SEA) — 친구 PC에 Node가 없을 때
- 경기 시작 전부터 들어오는 별도 옵저버 모드(탈락 플레이어의 관전은 지원)
- 매치 통계/랭킹 저장 (현재 세션 임시)
- macOS/Linux 셸 스크립트 (`start.sh`)

## 참조 문서

- 변경 이력: `docs/CHANGELOG.md`
- 사용법: `README.md`
- 파이프라인 산출물: `.claude/specs/2026-05-25-tetris-battle-*.md`, `.claude/specs/2026-08-01-tetris-battle-multiroom-*.md`
