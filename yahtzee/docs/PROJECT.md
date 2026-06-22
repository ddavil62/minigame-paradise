# Yahtzee (요트 다이스) — PROJECT

## 정체성

- **장르**: LAN 1:1 턴 교대 점수표 다이스 게임 (Yahtzee 표준 룰).
- **목적**: 친구와 LAN으로 즉시 즐기는 정통 요트 다이스. 26턴 후 총점 비교.
- **레포 관리**: lazyslimestudio 하위 폴더(`yahtzee/`)로 관리. 미니게임 천국 8번째 종목.
- **기술**: Node 18+ (ESM), 순수 `node:http` + `ws` 8 (Express 미사용), 바닐라 JS + HTML5 Canvas.
- **외부 에셋**: 0 (다이스는 Canvas 2D pip 패턴, 점수표는 HTML 테이블).

## 핵심 룰 (사용자 확정)

### 진행
- 2인 LAN 1:1, **턴 교대 1턴씩** 번갈아.
- 각자 13턴씩 = 총 26턴 진행 후 점수 비교.
- 다이스 5개, 1턴 최대 3번 굴림.
- 굴림 사이에 keep할 다이스 선택 (나머지만 다시 굴림).
- 1턴 마무리: 13 카테고리 중 1개 선택해서 점수 기록 (이미 기록된 카테고리 사용 불가, 못 맞춰도 0점 기록 필수).

### 13 카테고리

**Upper Section (해당 숫자 합)**
- Aces (1), Twos (2), Threes (3), Fours (4), Fives (5), Sixes (6) — 각각 해당 숫자 개수 × 숫자값.
- **상단 보너스**: 상단 합 ≥ 63 시 +35점.

**Lower Section**
- Three of a Kind: 같은 숫자 3개 이상 → 5개 다이스 합
- Four of a Kind: 같은 숫자 4개 이상 → 5개 다이스 합
- Full House: 3+2 → 25점 고정 (야츠는 풀하우스 불인정)
- Small Straight: 연속 4개 → 30점 고정
- Large Straight: 연속 5개 → 40점 고정
- Yahtzee: 5개 같음 → 50점 고정
- Chance: 아무거나 → 5개 다이스 합

### 야츠 보너스
- yahtzee 카테고리에 50점 기록한 상태에서 추가 야츠 발생 시 → **+100점 누적**.
- yahtzee 카테고리에 0점 기록한 상태에서 추가 야츠는 보너스 없음.

## 아키텍처

### 서버 권위 (Server Authoritative)
- 다이스 랜덤·점수 계산·턴 진행 모두 `game.js` 순수 함수.
- 클라는 keep 선택 + 카테고리 선택만 전송.
- 매 액션 후 동일 STATE를 양쪽에 broadcast (정보 비대칭 없음).

### 파일 구조

```
yahtzee/
├── game.js                  # 순수 게임 로직 (다이스, 점수, 카테고리, 턴, 종료)
├── server.js                # WS 서버 + createApp() factory (단독 3010 + launcher 통합)
├── package.json             # type:module + ws
├── playwright.config.js     # 향후 브라우저 E2E 대비 스켈레톤
├── CLAUDE.md                # 본 게임 컨벤션
├── README.md                # 사용자 대상
├── docs/
│   ├── PROJECT.md           # 본 문서
│   └── CHANGELOG.md         # 변경 이력
├── public/
│   ├── index.html           # 대기/게임/종료 3화면
│   ├── css/style.css        # 다크 테마 + Canvas 다이스 + 점수표
│   └── js/
│       ├── main.js          # 진입점, 모듈 조율
│       ├── network.js       # WebSocket
│       ├── game.js          # 클라 상태 캐시 + 점수 미리보기 (서버 룰 재구현)
│       ├── dice.js          # Canvas pip 패턴 렌더
│       ├── scoreboard.js    # 13 카테고리 표
│       └── ui.js            # HUD / 결과 / 토스트
└── tests/
    └── smoke.test.js        # YACHT-001~010 ad-hoc 노드 러너
```

## WebSocket 프로토콜

### C→S

| 타입 | 페이로드 | 설명 |
|------|---------|------|
| `JOIN` | `{ playerName? }` | 입장 |
| `READY` | `{}` | 시작 준비 |
| `ROLL_DICE` | `{ keep: bool[5] }` | 1차 굴림은 keep 무시 |
| `TOGGLE_KEEP` | `{ index:0~4, value:bool }` | 본인 턴 + rollCount≥1 시 실시간 keep 1비트 동기화. 실패는 조용히 무시 |
| `SCORE_CATEGORY` | `{ category }` | 13 카테고리 ID 중 하나 |
| `REMATCH` | `{}` | 재대결 |

### S→C

| 타입 | 페이로드 | 설명 |
|------|---------|------|
| `JOINED` | `{ playerId, waiting, hostUrl }` | p1/p2 할당 |
| `READY_STATUS` | `{ p1Ready, p2Ready }` | READY 상태 broadcast |
| `START` | `{}` | 양쪽 READY 시 |
| `DICE_ROLLED` | `{ by, dice, rollCount }` | 굴림 직후 효과 트리거 |
| `STATE` | snapshot(state) 구조 | 매 액션 후 전체 상태 |
| `CATEGORY_SCORED` | `{ by, category, scored, yahtzeeBonusAwarded }` | 카테고리 기록 알림 |
| `GAME_OVER` | `{ winner, p1Total, p2Total, breakdown }` | 26턴 끝 |
| `REMATCH_STATUS` | `{ p1Ready, p2Ready }` | |
| `OPPONENT_LEFT` | `{ message }` | |
| `ERROR` | `{ message }` | 잘못된 요청 |

## 회귀 테스트

- YACHT-001~005: 각 카테고리 점수 계산
- YACHT-006: 상단 보너스 (정확히 63점 경계 포함)
- YACHT-007: 야츠 보너스 +100 (yahtzee=50 기록 후 vs yahtzee=0 기록 후)
- YACHT-008: 전체 26턴 WS 시나리오 → GAME_OVER 검증
- YACHT-009: 1턴 최대 3회 굴림 제한
- YACHT-010: 카테고리 중복 선택 차단 + 미굴림 차단
- YACHT-LIVE-001: `toggleKeep` 단위 가드(phase/턴/rollCount/index)
- YACHT-LIVE-002: WS TOGGLE_KEEP → 양쪽 STATE.keep 일치 + 상대 턴 시도 무시
- YACHT-LIVE-003/004: dice.js `opponentTurn` 라벨 "상대 KEEP" + 본인 턴 회귀
- YACHT-011: 2판 연속 GAME_OVER → REMATCH → START 사이클 + 3판째 START 도달 (N5 재대결 고착 회귀, 2026-06-17)
- YACHT-012: rollDice 400회 통계 — keep=true 동결 + keep=false 재굴림 + rollCount 권위(2026-06-20)
- YACHT-KEEP-006/007/008: 컵 굴림 애니메이션 트리거 rollCount 기준 — 값 동일 재굴림 발동(006, 버그 직격) / rollCount 불변 미발동(007, 무한 루프 방지) / 턴 리셋 후 첫 굴림 발동(008) (2026-06-20)
- YACHT-BOT-001~005: 봇 시나리오 25건 (포트 3099)

실행: `node tests/smoke.test.js` (169/169), `node tests/dice-render.test.js` (55/55), `node tests/bot-smoke.test.js` (25/25). 누적 **249 / 249 PASS**.

## 현재 상태 (2026-06-20)

- 1차 코어 + AI 봇 + 효과음 + 실시간 keep 동기화 + 카테고리 강조 애니메이션 완료.
- UX 개선: 점수표 가로줄 정렬·카테고리 색 3상태(F/G), 봇 지연 2배(N1), 총점 가독성(N2), 컵 굴림 중 미리보기 억제→착지 시 자동 노출(N3), 굴리기 연타 차단(N4), 재대결 버튼 고착 해소(N5).
- 버그 수정: 재굴림 애니메이션 미발동(2026-06-20) — 컵 굴림 트리거를 dice 값 변화에서 서버 권위 rollCount 증가로 교체. 우연히 직전과 같은 면으로 굴려져도 정상 발동.
- 단독/launcher 통합 양쪽 동작 확인.
- 모든 회귀 PASS (249/249).
- launcher games.json에 yahtzee 카드(#E84A5F) 등록.
