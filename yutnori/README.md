# 윷놀이 (Yutnori)

> 친구와 브라우저로 즐기는 한국 전통 윷놀이 대전. 실제 친구 접속은 같은 공유기에서도 `https://112.155.2.238`만 사용한다.

## 빠른 시작

### Windows 공개 운영

1. 프로젝트 루트에서 **`start-public.bat` 더블클릭** 또는 `start-public.ps1` 실행
2. 친구에게 `https://112.155.2.238` 전달
3. 양쪽 모두 **준비** 버튼 클릭 → 카운트다운 후 시작

포트 3000과 개별 게임 포트는 내부·개발 전용이다. 호스트 IP, `192.168.x.x:3000`, 콘솔의 LAN 주소를 친구에게 안내하지 않는다.

### 종료

- 서버 콘솔 창에서 `Ctrl+C`, 또는 `stop.bat` 더블클릭

### 개발·테스트

개별 `start.bat`과 포트 폴백 실행은 로컬 개발·테스트 용도다. 공개 친구 플레이에는 프로젝트 루트의 HTTPS 런처를 사용한다.

## 룰 기준 문서

본 구현의 권위 룰북: **[`docs/RULEBOOK.md`](docs/RULEBOOK.md)** — 한국 표준 룰 + 본 구현 비교 (13섹션 + 부록).

- 출처: 한국어 위키백과 「윷놀이」, 영문 Wikipedia 「Yunnori」, 한국민속대백과사전, 나무위키 (29회 인용).
- `§13 구현 노트`: 구현 vs 표준 차이 **11건** (HIGH 2 미해소 + 1 해소, MED 1 미해소 + 1 해소, LOW 5 미해소 + 1 해소).
  - **§13-1 [HIGH]** 모서리(5/10)에서 강제 지름길 진입 (정통은 선택). 사용자 의심 후보 1순위. **(미해소)**
  - **§13-2 [HIGH]** centerExitB(중앙→좌하) 즉시 완주 (정통은 중간 칸 거침). 사용자 의심 후보 2순위. **(미해소)**
  - **§13-9 [LOW, 해소]** HOME 시작 위치 좌우 분리 → 2026-05-31 양 팀 좌하 통일.
  - **§13-10 [MED, 해소]** HOME → 칸 N-1 단순화 → 2026-05-31 정통 매핑(HOME → 칸 N).
  - **§13-11 [HIGH, 해소]** MOVE_PIECE 후 capturedBonus 잔류 → 2026-05-31 명시 리셋.
- `§12 QA 체크리스트`: 룰북 기반 시나리오 작성 시 §번호를 인용한다.

## 게임 규칙 요약 (한국 표준 윷놀이)

상세는 [`docs/RULEBOOK.md`](docs/RULEBOOK.md) 참조.

### 보드

- 외곽 사각형 20칸 + 두 대각 지름길 + 중앙(방) = 약 29칸
- **시작점**(좌하) → 시계 방향 → 다시 시작점 통과 = 완주
- **모서리에 정확히 멈추면** 다음 이동부터 지름길 사용
  - 좌상(5) → 지름길A → 중앙 → 우하(15)
  - 우상(10) → 지름길B → 중앙 → 좌하(시작점=완주)
- **중앙(방)** 도달 시 두 출구 중 선택 (모달 표시)

### 윷가락

평평한 면이 위로 보이는 개수가 곧 이동 칸 수 (모만 예외).

| 결과 | 평평면 / 둥근면 | 이동 |
|------|-----------------|------|
| 도   | 1 / 3           | 1칸  |
| 개   | 2 / 2           | 2칸  |
| 걸   | 3 / 1           | 3칸  |
| 윷   | 4 / 0           | 4칸 + 한 번 더! |
| 모   | 0 / 4           | 5칸 + 한 번 더! |
| 백도 | 1 / 3 (그 1개 평평면이 마크 가락) | -1칸 (뒤로) |

- 윷/모면 보너스 턴
- **잡기**(같은 칸 상대 말): 상대 말 출발점으로 + 보너스 턴
- **업기**(같은 칸 자기 말): 다음 이동 시 함께 이동. 업힌 묶음이 잡히면 전부 출발점으로
- **백도(-1칸)**: 4개 가락 중 빨간 X 표식이 있는 가락 1개만 뒤집혀 있을 때 발동. 출발한 말만 1칸 뒤로. HOME 말엔 사용 불가(자동 폐기). 보너스 턴 없음.

### 승리

- 자기 말 4개 모두 완주

## 조작

- **윷 던지기** 버튼 → 결과가 좌측 "남은 결과" 큐에 추가됨
- 남은 결과 칩 클릭 → 사용할 결과 선택 (강조됨)
- 보드의 내 말 클릭 → 해당 말 이동
- HOME(시작 전) 말 출발: 양 팀 모두 보드 좌하 출발점 근처 HOME 영역 클릭 또는 빈 영역 클릭으로 자동 선택 (2026-05-31 정통 룰 정합)
- 중앙 도착 시: 모달의 "↖ 위쪽 출구 / ↙ 아래쪽 출구" 선택
- 게임 종료 시: **재대결** 버튼 (양쪽 모두 누르면 새 게임)

## 아키텍처

**서버 권위 (Server Authoritative)**:
- 윷가락 던지기 결과 = 서버에서 결정 (클라 부정 방지)
- 말 이동/잡기/업기 판정 = 서버
- 매 액션 후 `STATE` 메시지로 전체 게임 상태 broadcast
- 클라이언트는 입력 + 렌더링만 담당

## 기술 스택

- Node.js 18+ (ESM), Express 4, ws 8
- 바닐라 JS (프레임워크 0), HTML5 Canvas
- 외부 에셋 0 (Canvas/CSS로 표현)
- 한국어 UI + 한국어 주석/JSDoc

## 디렉토리

```
yutnori/
├── server.js               # 서버 + 게임 로직 (서버 권위)
├── start.bat / stop.bat    # Windows 런처
├── package.json
├── README.md / CLAUDE.md
├── public/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── main.js         # 진입점
│       ├── network.js      # WebSocket
│       ├── game.js         # 클라 상태 캐시
│       ├── board.js        # 칸 좌표 + 경로 정의
│       ├── yut.js          # 윷 결과명 + 가락 렌더링
│       ├── piece.js        # 클릭 hit-test
│       └── ui.js           # Canvas + DOM 렌더링
├── docs/PROJECT.md
└── tests/smoke.test.js     # 서버 핵심 흐름 18개 시나리오
```

## 테스트

### Playwright 주력 슈트 (273개)

```powershell
cd C:\LazySlimeStudio\minigames\yutnori

# 터미널 1 (E2E 25개 전용 — 유닛/WS/룰북은 서버 불필요)
node server.js --port 3088

# 터미널 2 (룰북 168 + 기존 110 = 273개)
npx playwright test --reporter=list
```

기대 출력: `253 passed` (유닛 65 + WS 20 + 룰북 168, 서버 없이 실행 시) 또는 `273 passed` (E2E 25 포함, 서버 가동 시).

### 룰북 기반 시나리오 (YR-Cx 시리즈, 168개)

2026-05-31 추가. 룰북 §1~§13 + 부록을 14개 카테고리로 분할하여 `tests/rulebook-c1~c14-*.spec.js`로 작성. §13 11건 모두 커버 (정책 PASS 8 + 회귀 가드 3).

| 카테고리 | 파일 | 시나리오 수 | 룰북 §참조 |
|---|---|---|---|
| YR-C1 | `rulebook-c1-yutsticks.spec.js` | 30 | §3, §13-3, §13-4 |
| YR-C2 | `rulebook-c2-movement.spec.js` | 15 | §5, §13-10 |
| YR-C3 | `rulebook-c3-capture.spec.js` | 10 | §7 |
| YR-C4 | `rulebook-c4-stack.spec.js` | 10 | §8 |
| YR-C5 | `rulebook-c5-backdo.spec.js` | 10 | §9, §13-5 |
| YR-C6 | `rulebook-c6-corner.spec.js` | 10 | §10-1~3, §13-1 |
| YR-C7 | `rulebook-c7-center.spec.js` | 10 | §10-3~5, §13-2, §13-6 |
| YR-C8 | `rulebook-c8-bonus.spec.js` | 10 | §6 |
| YR-C9 | `rulebook-c9-turn.spec.js` | 10 | §5-1, §13-11 |
| YR-C10 | `rulebook-c10-victory.spec.js` | 5 | §11 |
| YR-C11 | `rulebook-c11-ws.spec.js` | 15 | 부록 (WS) |
| YR-C12 | `rulebook-c12-unresolved.spec.js` | 8 | §13-1~8 (정책 PASS) |
| YR-C13 | `rulebook-c13-resolved-regression.spec.js` | 10 | §13-9/10/11 (회귀 가드) |
| YR-C14 | `rulebook-c14-edge.spec.js` | 15 | §10/§6/§9/§11/부록 |

### 레거시 smoke (18 assert)

```powershell
node tests/smoke.test.js --port 3088
```

기대 출력: `PASS: 18, FAIL: 0`

## 트러블슈팅

- **친구 PC에서 접속 안 됨**: `https://112.155.2.238` 접속 여부와 공통 비밀번호를 확인.
- **포트 3000 사용 중**: 공개 스택의 기존 런처 프로세스를 확인한다. 임의 포트 폴백 주소를 친구에게 전달하지 않는다.
- **재대결 후 화면 이상**: 새로고침(F5) → 자동 재입장.

## 라이선스

MIT — Lazy Slime Studio.
