# Yutnori — 프로젝트별 작업 컨벤션

> LAN 1:1 한국 전통 윷놀이. Node.js + 바닐라 JS. **2026-06-20 버그 B/C 수정: B — 결과 선택 후 빈 칸 클릭이 첫 HOME 말을 자동 출발시키던 폴백 제거(`main.js`, 내 말/HOME 박스 정확 클릭에만 이동) / C — 윷·모 보너스 던지기 이중 부여(소진 순서 비대칭 리필) 수정 — 2026-06-17 버그 D의 `bonusFromConsumed`(이동 시점) 모델을 `pendingThrows`(던지기 시점 적립/소비) 모델로 교체, `hasBonus = capturedBonus || pendingThrows>0`. 버그 D(보너스 소실)와 양립. 서버리스 342 + bot-smoke 10 + 관련 27 PASS.** 2026-06-18 시각 재디자인 (룰/로직 무변경): 3단 → 2단 레이아웃(왼쪽 큰 보드 + 오른쪽 320px 인포바 통합, 요트다이스 패턴 차용) / 한지·원목·먹·단 테마 + 웹폰트 Jua+Gowun Dodum(요트·오목 통일) / Canvas 보드 입체화(나뭇결·칸 radialGradient·말 3D) + centerExitA(23→28→29→15) 점선 신규 렌더(누락 보완) / 윷가락 실측 비율 재설계(H:W≈5:1 가늘고 긴 막대·반원통 단면) / 외부 에셋 0 유지(Canvas/CSS 합성). 부수 버그픽스: 2단 도입으로 보드 클릭 hit-test 어긋남(HIGH) → `main.js` 클릭 매핑을 `BOARD_SIZE(560)/rect.width|height`로 수정. 회귀 게이트에 `tests/redesign-hittest-qa.spec.js` 4건 + dpr 1/2/2.5 매트릭스 추가.** 2026-06-16 버그A/B 해소 (버그A: 중앙(23) 통과 시 BRANCH 미발송 + 진입 지름길 기준 자동 라우팅, 정확 착지에만 분기 / 버그B: centerExitA에 중간 칸 28/29 신설, `23→28→29→15→…→GOAL`, centerExitB 24/25와 거울 대칭).** 2026-06-15 §13-5·§13-6 해소 (첫칸 빽도 워프 cell 1↔19 + 지름길B 중앙 자동 centerExitB). 2026-06-15 §13-12 해소 (윷·모 잡기 중복 보너스 차단). 2026-06-12 AI 봇 추가. 2026-06-11 룰 정합 수정 4건(FIX-1~4) + 중첩 분기 수정 QA PASS. 회귀 게이트: 서버리스 **342**(2026-06-20 버그 C YR-C8-011~014 신규 4) + E2E **25** + smoke 40 + bot-smoke **10** + HT-BUGB(버그 B). 룰북 §13 12건(미해소 4 + 해소 8) — §13-1/§13-2/§13-5/§13-6/§13-12 해소.

## 룰북 (필수 숙지)

**`docs/RULEBOOK.md`** — 한국 표준 윷놀이 룰 + 본 구현 비교. matgo/janggi와 동일한 13섹션 패턴.

- QA는 룰북 시나리오 작성 시 §번호를 반드시 인용한다 (예: §5-2 칸 수 검증, §10-2 모서리 분기).
- Coder가 게임 로직(`server.js`)을 수정하면 **§13 구현 노트의 영향 항목을 확인**하고 룰북에 영향이 있으면 Doc Writer가 §13을 갱신한다.
- `§13 구현 노트`: 구현 vs 표준 차이 **12건** (미해소 LOW 5 / MED 1, 해소 HIGH 3 / MED 1 / LOW 2). 룰북 시나리오 회귀 게이트의 핵심.
- **2026-06-20 버그 B/C 수정 완료**: B — 보드 클릭 3단계 폴백(빈 칸 → 첫 HOME 말 자동 선택, `pickFirstHomePiece`) 제거(`main.js`). 내 말 정확 클릭 또는 HOME 박스 영역 클릭에만 이동, 둘 다 실패 시 "이동할 말을 클릭하세요." 토스트 후 return. 회귀 HT-BUGB. / C — 윷·모 보너스 던지기 이중 부여 수정. 2026-06-17 버그 D가 도입한 `bonusFromConsumed`(이동 시점 부여)가 던지기+이동 이중 부여 → 소진 순서 따라 던지기가 리필되던 비대칭 버그. `server.js`에서 `bonusFromConsumed` **제거** + `game.pendingThrows` 별도 카운트 도입(THROW 시 +1 적립 / 보너스 THROW 시 -1 소비), `hasBonus = capturedBonus || pendingThrows>0`로 통일. 소진 순서 무관 + 버그 D(보너스 소실) 재발 방지 양립. MOVE_PIECE·CHOOSE_PATH 양쪽 적용. STATE에 `pendingThrows` 노출(후방 호환), `/test/inject` 주입 지원. 회귀 YR-C8-011(개먼저)/012(모먼저)/013(이중 적립 0)/014(버그 D 양립) 신규, YR-C8-009 기댓값 갱신(던지지 않은 yut 소비 → 리필 없음). 서버리스 **342** + bot-smoke 10 + 관련 27(c8/c18/c19/qa-defect2) PASS. visual_change: none(AD 생략).
- **2026-06-17 버그 B/C/D 수정 완료**: B — 준비 버튼 :hover 위치 튐(CSS, `.ready-btn:hover:not(:disabled)`에 `transform: translate(-50%,-50%) scale(1.04)` 추가로 `.primary-btn:hover` translateY override) / C — 대기 화면 초대 주소 패널 제거 → 요트다이스 P1/P2 ready 패턴 통일(서버 hostUrl/setHostUrl·JOINED 필드는 유지, 클라 표시만 제거) / D — 윷·모로 말 이동 시 보너스 던지기 소실(서버, MOVE_PIECE/CHOOSE_PATH에서 `bonusFromConsumed`를 splice **이전**에 계산해 hasBonus에 포함). **※ 2026-06-20 버그 C에서 이 `bonusFromConsumed` 이동 시점 모델은 `pendingThrows` 던지기 시점 모델로 교체됨.** 회귀 YR-C8-009 단언을 해소 룰 기댓값으로 갱신(2026-06-20 재갱신), e2e E-02 invite-panel→`#ready-status` 갱신. 서버리스 338 + bot-smoke 10 + e2e 25 전부 PASS, AD3 APPROVED.
- **2026-06-11 룰 정합 수정 4건(FIX-1~4) + 중첩 분기 수정 완료**: §13-1 모서리 외곽/지름길 선택 분기(FIX-2) / §13-2 centerExitB 24/25 경유 완주(FIX-3) / §13-11 FIX-4 capturedBonus 소진 조건 정밀화 / §13-12 [LOW] §6-1 중복 보너스 차단(2026-06-15 해소). FIX-1 재입장 ID 중복 데드락 수정. 상세는 룰북 §13.
- **2026-05-31 정통 룰 정합 수정 3건 완료**: §13-9 HOME 시각 통일 / §13-10 HOME → 칸 N 정통 매핑 / §13-11 capturedBonus 리셋. 상세는 룰북 §13.
- **2026-05-31 룰북 기반 168 시나리오 추가 + 잠재 결함 5건 수정**: §13-11 capturedBonus 라이프사이클을 정밀 검증 중 결정적 잠금 버그(잡기 후 보너스 THROW 잔류) 발견 및 해소. U-18~U-22 기댓값 정통 룰로 갱신, resetGame/softResetRoom 명시 초기화, YR-C5-008/C8-008 flaky 안정화. 회귀 게이트가 253/253 PASS로 확장.

## 정체성

- **목적**: 친구가 놀러 왔을 때 LAN으로 즉시 즐기는 1:1 윷놀이
- **레포 관리**: lazyslimestudio 하위 폴더(`yutnori/`)로 관리 (별도 git 분리 안 함)
- **기술**: Node 18+ (ESM), Express 4, ws 8, 바닐라 JS (프레임워크 0), HTML5 Canvas
- **외부 에셋**: 없음 — 모든 시각은 CSS/Canvas로 표현 (윷가락도 Canvas). 웹폰트만 예외(Google Fonts Jua+Gowun Dodum, 요트·오목과 통일). **2026-06-18 시각 재디자인 후에도 외부 이미지 에셋 0 유지(Canvas/CSS 합성)** — `visual_change: art`는 여전히 발생하지 않음.
- **레이아웃(2026-06-18~)**: 2단 — 왼쪽 큰 보드 + 오른쪽 320px 인포바 통합(윷가락→남은결과→나의말→상대말→최근결과→룰). `.game-main grid 1fr 320px`, 반응형 브레이크 1100/900px. 테마: 한지(#f0e6c8)/원목(#6b4220)/먹·단 — 배경 #2c1f12, 강조 #d4812a, P1 #c0392b / P2 #1a6fad.

## 핵심 설계 원칙 (변경 시 주의)

1. **서버 권위 (Server Authoritative)**
   - 윷가락 던지기 결과는 **서버에서 결정** (`throwYutSticks()` in server.js)
   - 말 이동/잡기/업기/완주 판정 모두 서버 (`movePiece()`, `resolveLanding()`)
   - 매 액션 후 전체 게임 상태(`STATE`)를 양쪽에 broadcast
   - 클라이언트는 입력 전송 + 상태 렌더링만 (`game.js`는 캐시 + 검증 헬퍼)
   - **tetris-battle와 차이**: tetris-battle은 클라 권위 + 서버 중계. yutnori는 턴제 + 랜덤이 핵심이므로 권위형이 적합.
2. **신뢰 환경 (LAN, 친구 대전)**
   - 입력 검증은 있으나(턴/완주/큐 잔여) 가벼움. 강한 안티치트는 Out of Scope.
3. **포트 충돌 자동 폴백**
   - 3000~3010 자동 시도. `wss = new WebSocketServer({ server })`가 HTTP server를 공유하므로 EADDRINUSE 시 **양 채널에 error 핸들러 필수** (tetris-battle 함정 동일).
4. **단순화 결정**
   - 모서리(5, 10)에 정확히 멈추면 다음 이동 시 **외곽 계속 / 지름길 진입 선택 모달** 표시(정통 룰 적용, 2026-06-11 FIX-2). 이전 자동 지름길 진입 단순화는 해소 — 룰북 §13-1 해소.
   - 분기 결정은 모서리(5/10)·중앙(23)에 **정확히 착지**한 경우에만 발생. **중앙을 통과(정확히 안 멈춤)하면 BRANCH_REQUEST 미발송 + 진입 지름길 기준 자동 라우팅**(2026-06-16 버그A 해소): 지름길A 통과 → centerExitA, 지름길B 통과 → centerExitB. 모서리 지름길 + 중앙 통과 시 corner→center 2단계 모달(중첩 분기, 정확 착지 케이스)은 유지.
   - **중앙 정확 착지**: 지름길A 경유 → 다음 이동 BRANCH center 자유 선택 / 지름길B 경유 → 자동 centerExitB(bottom) (`piece.lastPath==='shortcutB' && cell===23`, BRANCH 미발송, 2026-06-15 §13-6 해소). 이전 "진입 경로 무관 양방향 자유" 단순화는 해소.
   - 백도(빽도, X자 표식 가락) 변형 룰 미적용. 단 **첫칸 빽도 워프**는 적용(2026-06-15 §13-5 해소): cell 1↔19 워프. HOME 백도 자동 폐기는 유지.
   - 중앙→좌하 출구는 **23→24→25→GOAL 잔여 steps 소진**(정통 룰 적용, 2026-06-11 FIX-3). 이전 즉시 완주 단순화는 해소 — 룰북 §13-2 해소.
   - HOME → 보드 진입은 **2026-05-31부로 정통 룰 매핑 적용** (HOME → 칸 N). 이전 단순화(HOME → 칸 N-1)는 해소. 룰북 §13-10 참조.
   - HOME 시각 위치는 **2026-05-31부로 양 팀 좌하 통일** (정통 룰). 이전 P2 우상 배치 단순화는 해소. 룰북 §13-9 참조.

## 디렉토리

```
yutnori/
├── server.js                 # 백엔드 + 게임 로직 (서버 권위, getBotUrl + spawn/killBotChild + mode 파싱)
├── bot.js                    # AI 봇 (STATE 기반 상태 머신, mode=ai 진입 시 server.js가 spawn)
├── start.bat / stop.bat      # Windows 더블클릭 런처
├── package.json
├── playwright.config.js      # Playwright 공통 설정 (port 3088)
├── README.md                 # 사용자 대상
├── CLAUDE.md                 # 본 문서
├── docs/
│   ├── PROJECT.md            # 현재 상태 스냅샷
│   └── CHANGELOG.md          # Phase별 이력
├── public/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── main.js           # 진입점
│       ├── network.js        # WebSocket
│       ├── game.js           # 클라 상태 캐시 + 검증 헬퍼
│       ├── board.js          # 칸 좌표 + 경로 정의 (서버 인덱스와 동기화. 24/25 centerExitB + 28/29 centerExitA)
│       ├── yut.js            # 윷 결과명/한글/가락 렌더링 (2026-06-18 윷가락 H:W≈5:1 반원통 단면 재설계)
│       ├── piece.js          # 클릭 hit-test
│       └── ui.js             # Canvas 보드/말 + DOM HUD (2026-06-18 나뭇결·칸 radialGradient·말 3D·centerExitA 점선 + resizeBoard 캔버스 표시크기 동적화)
└── tests/
    ├── smoke.test.js                       # 레거시 smoke (node 직접 실행, 시나리오 1~8 + 모서리 분기/shortcut 보조 assert)
    ├── bot-smoke.test.js                   # 봇 smoke (node 직접 실행, YBOT-001~005, 포트 3104. 인라인 봇 vs 서버 spawn bot.js. 10/10 — YBOT-004 결정적 inject 프로브 보강, 2026-06-16)
    ├── yut.unit.spec.js                    # Playwright 단위 — throwYutSticks/computeNextCell (U-66~U-72 중첩 분기 포함)
    ├── ws.scenarios.spec.js                # Playwright WS — 메시지 프로토콜/게임 흐름
    ├── e2e-scenarios.spec.js               # Playwright E2E 25개 — 브라우저 2페이지 실전 검증
    ├── qa-defect2-captured-bonus-stuck.spec.js  # capturedBonus 잠금 회귀 가드 (QA-D2)
    ├── qa-rulefix-edge.spec.js             # FIX-1~4 + 중첩 분기 QA 엣지 26개 (QA-RF1/2/3/4/X, 2026-06-11)
    ├── redesign-hittest-qa.spec.js         # 2단 레이아웃 보드 클릭 hit-test 회귀 (2026-06-18, 4건 + dpr 1/2/2.5 매트릭스. BOARD_SIZE/rect 매핑 가드) + HT-BUGB(2026-06-20 빈 칸 클릭 → HOME 말 미출발)
    ├── rulebook-helpers.js                 # 룰북 시나리오 공용 헬퍼 (WsClient/startServer/inject/withRandom)
    └── rulebook-c1~c19-*.spec.js           # Playwright 룰북 (YR-C1~C19, §1~§13+부록 커버. c15 재입장 / c16 모서리 분기 / c17 centerExitB / c18 보너스 정밀화 / c19 §13-12 윷·모 잡기 중복 차단)
```

## 테스트 실행법

### Playwright (주력 테스트 스위트)

> 2026-06-16 기준: 서버리스 회귀 **338 PASS**(직전 327 + 버그A/B 신규 11), E2E 25(서버 필요), bot-smoke 10/10(YBOT-004 결정적 inject 프로브 보강). 신규 케이스: 중앙 통과 자동 라우팅(버그A) + centerExitA 28/29 경유(버그B). 갱신 테스트 9: yut.unit, rulebook-c2/c7/c11/c12/c13/c14/c16, ws.scenarios, qa-rulefix-edge, bot-smoke.

```powershell
cd C:\LazySlimeStudio\minigames\yutnori

# 터미널 1 (서버 — E2E 25개 전용. 유닛/WS/룰북은 서버 없이도 가능)
node server.js --port 3088

# 터미널 2 (전체 실행)
npx playwright test --reporter=list

# 서버 없이 가능한 부분만 (321개: 회귀 295 + QA 엣지 26)
npx playwright test tests/yut.unit.spec.js tests/ws.scenarios.spec.js tests/rulebook-c*.spec.js tests/qa-defect2-captured-bonus-stuck.spec.js tests/qa-rulefix-edge.spec.js --reporter=list

# 개별 실행
npx playwright test tests/yut.unit.spec.js          # 유닛 (서버 불필요, U-66~U-72 중첩 분기 단위 포함)
npx playwright test tests/ws.scenarios.spec.js      # WS (서버 불필요 — createApp 직접 import)
npx playwright test tests/rulebook-c*.spec.js       # 룰북 (서버 불필요, YR-C1~C19, §13 커버. c16 모서리 분기 / c17 centerExitB / c18 보너스 정밀화 / c19 §13-12 윷·모 잡기 중복 차단)
npx playwright test tests/qa-rulefix-edge.spec.js   # QA 엣지 26개 (FIX-1~4 + 중첩 분기, 서버 불필요)
npx playwright test tests/e2e-scenarios.spec.js     # E2E 25개 (port 3088 서버 필요)
```

기대: 서버리스 `321 passed` (회귀 295 + QA 엣지 26), E2E 25는 서버 가동 시 별도

### 레거시 smoke (시나리오 1~8 + 모서리 분기 보조 assert)

```powershell
node tests/smoke.test.js --port 3088
```

기대: 풀 실행 시 `PASS: 40, FAIL: 0` (시나리오 1~8 36 assert + 모서리 분기 대기/shortcut 진입 보조 assert). 시나리오 8b "참고용" WS 분포 샘플러는 다수 THROW 반복으로 환경 의존 장기 실행이라 기능 검증과 무관(장기 샘플).

### 봇 smoke (YBOT-001~005, 포트 3104)

```powershell
node tests/bot-smoke.test.js
```

기대: `10/10 PASS` (봇 vs 봇 1판 완주 + 3판 연속 REMATCH 완주 + corner/center 분기 응답 + capturedBonus 던지기, 데드락 0. 2026-06-16 YBOT-004를 결정적 inject 프로브로 보강 — 중앙 통과 자동 라우팅 검증). 인라인 봇(테스트 운전) vs 서버 spawn한 실제 `bot.js` 자식 프로세스 대전으로 `mode=ai → spawnBotChild → mode=bot` 경로까지 검증. 포트 3104는 bot-smoke 전용으로 사용자 launcher(3000)와 무영향. 환경변수 `YUTNORI_BOT_DELAY_MIN/RAND`로 봇 속도 조정(테스트는 짧게 단축, 기본 300~800ms).

### 회귀 게이트

- 모든 변경은 **서버리스 회귀 342/342 PASS**를 유지해야 한다 (2026-06-20 기준, 직전 338 + 버그 C YR-C8-011~014 신규 4). E2E 25는 서버 가동 시 별도 회귀. bot-smoke 10/10(YBOT-004 결정적 inject 프로브 보강). HT-BUGB(버그 B 빈 칸 클릭 미출발)는 서버 필요 스위트(`tests/redesign-hittest-qa.spec.js`).
- smoke도 유지한다 (시나리오 1~8, 36 assert PASS. 8b "참고용" WS 샘플러는 환경 의존 장기 실행으로 기능 무관).
- 룰북 시나리오(YR-C1~C19)는 §13 12건을 커버. 새 게임 로직 변경 시 영향 받는 카테고리를 우선 회귀 실행한다.
- 신규 시나리오는 추가하되 기존 시나리오는 수정/삭제하지 않는다. **단, 정통 룰로 기댓값이 바뀐 경우 갱신 사유를 파일 주석에 명기하고 수정 허용**(2026-06-11 §13-1/§13-2 해소로 YR-C6/C7/C12, qa-defect2, smoke/unit 일부 갱신).

## WebSocket 메시지 프로토콜

| 방향 | 타입 | 페이로드 | 비고 |
|------|------|----------|------|
| C→S | JOIN | `{ playerName }` | 입장 |
| S→C | JOINED | `{ playerId, waiting, hostUrl }` | p1/p2 할당 |
| C→S | READY | `{}` | 시작 준비 |
| S→C | START | `{ countdown }` | 양쪽 READY 시 broadcast |
| S→C | STATE | `{ started, currentTurn, pendingResults, awaitingBranchAt, awaitingBranchType, capturedBonus, pendingThrows, winner, players }` | 매 액션 후 전체 상태 broadcast. `awaitingBranchType: 'center'\|'corner'\|null` (FIX-2). `capturedBonus: boolean` — true면 큐 비어도 THROW 가능(잡기 보너스). `pendingThrows: number` — 윷·모 "한 번 더 던지기" 적립 카운트(2026-06-20 버그 C, 후방 호환 추가). 봇이 자체 추적 없이 던지기 가능 여부 판단(2026-06-12 capturedBonus 추가) |
| C→S | THROW_YUT | `{}` | 권위: 서버가 결과 결정 |
| S→C | YUT_RESULT | `{ by, sticks, result, steps, bonus }` | 양쪽 broadcast |
| C→S | MOVE_PIECE | `{ pieceIndex, useResult }` | 사용 결과는 큐에서 차감 |
| S→C | BRANCH_REQUEST | `{ pieceIndex, playerId, branchType }` | 중앙/모서리 분기 대기. `branchType: 'center'\|'corner'` (FIX-2) |
| C→S | CHOOSE_PATH | `{ pathChoice: 'top'\|'bottom'\|'outer'\|'shortcut' }` | center: top/bottom, corner: outer/shortcut. 내부 합성값 `'shortcut-top'\|'shortcut-bottom'`은 서버 전용(중첩 분기) |
| S→C | GAME_OVER | `{ winner, reason? }` | 4말 완주 또는 disconnect |
| C→S | REMATCH | `{}` | 재대결 요청 |
| S→C | REMATCH_STATUS | `{ p1Ready, p2Ready }` | 양쪽 모두 시 START 재발송 |
| S→C | ERROR | `{ message }` | 잘못된 요청 |

### 접속 쿼리 `?mode=` (2026-06-12 AI 봇)

WS 연결 URL(`/ws?mode=...`)에 모드 쿼리를 부착한다. `network.js`가 부착 + 새로고침 유실 대비 `sessionStorage('yutnori:mode')` 백업.

| `mode` 값 | 의미 |
|---|---|
| `human` (기본) | 일반 사람 대전 |
| `ai` | 사람(p1)이 AI 대전을 요청. 혼자 입장 시 server.js가 `spawnBotChild`로 `bot.js`를 자식 프로세스 spawn(URL은 `?mode=bot`). 사람이 끊기면 `killBotChild`로 봇 정리 |
| `bot` | spawn된 봇 자신의 접속. 자동 spawn 경로 전용(클라이언트가 직접 쓰지 않음) |

## 코드 컨벤션

- **언어**: 한국어 UI + 한국어 주석/문서
- **모듈**: ES Modules (`"type": "module"`)
- **외부 라이브러리**: 클라이언트 0, 서버는 ws + express만 (devDependency로 playwright)
- **주석**: `@fileoverview` + JSDoc + `// ── 섹션 ──` 구분

## 변경 시 자주 깨지는 함정

| 항목 | 함정 |
|---|---|
| `wss = new WebSocketServer({ server })` | server와 wss 양쪽에 error 핸들러 필요. wss에만 또는 server에만 등록하면 EADDRINUSE 시 unhandled로 즉시 종료. |
| `board.js` 칸 좌표 vs `server.js` 인덱스 | 칸 인덱스 매핑은 양쪽이 **반드시 일치**해야 함 (0~19 외곽, 21/22 지름길A, 26/27 지름길B, 23 중앙, **24/25 centerExitB** — 2026-06-11 FIX-3 신설, board.js `CENTER_EXIT_B`/`buildCenterExitB`, **28/29 centerExitA** — 2026-06-16 버그B 신설, board.js `CENTER_EXIT_A`/`buildCenterExitA`, 중앙(23)→우하(15) 대각 1/3·2/3 지점 (356.67,356.67)·(433.33,433.33), centerExitB와 x=280 수직 대칭). 변경 시 양쪽 동시 갱신. |
| `MOVE_PIECE`의 `useResult` 검증 | 서버는 `pendingResults`에 해당 결과명이 있는지 indexOf로 검사. 큐에 없으면 ERROR. |
| 보너스 턴 처리 | `pendingThrows > 0`이면 큐가 비어도 다시 던질 수 있음(윷·모 "한 번 더 던지기" 권리, 2026-06-20 버그 C). 잡기 보너스는 `game.capturedBonus` 플래그로 별도. 턴 종료 판단 시 `hasBonus = capturedBonus || pendingThrows>0` 체크 필수. |
| 윷·모 보너스는 던지기 시점에 적립/소비한다 (2026-06-20 버그 C, 던지기 시점 모델) | **2026-06-17 버그 D의 `bonusFromConsumed`(이동 시점 부여) 모델은 폐기됨.** 그 모델은 윷·모를 던질 때 한 번, 그 윷·모로 말을 **이동**할 때 또 한 번 보너스를 부여(이중 부여)해, 큐에 윷·모가 여럿일 때 **소진 순서에 따라 던지기가 리필**되는 비대칭 버그를 냈다. 대신 `game.pendingThrows`(초기 0) 카운트를 쓴다 — **THROW_YUT**: ①적립 권리 행사 던지기(`pendingThrows>0`)면 `-=1` 소비, ②결과가 `yut`/`mo`면 `+=1` 적립. **MOVE_PIECE/CHOOSE_PATH**: `bonusFromConsumed` 계산·가산을 **완전 제거**하고 큐 splice 후 `hasBonus = capturedBonus===true || pendingThrows>0`로만 판정(`lastResult` 종류 비의존) — false면 `passTurn()`. 초기화: `passTurn`/`createGame`/`softResetRoom`/`resetGame`에서 `pendingThrows=0`. STATE에 노출(후방 호환 추가 필드, 클라 무영향), `/test/inject` 주입 지원. **던지기 권리는 소진 순서가 아니라 pendingThrows 적립/소비로 판정**(capturedBonus 잡기 보너스 로직과 독립). capturedBonus 소진/리셋·§13-12 가드는 그대로(윷·모 잡기 중복 미부여). 회귀 YR-C8-011(개먼저)/012(모먼저)/013(이중 적립 0)/014(버그 D 양립). |
| 보드 클릭은 정확 클릭에만 이동한다 (2026-06-20 버그 B) | 보드 클릭 핸들러(`main.js`)의 **3단계 폴백(빈 칸 → 첫 HOME 말 자동 선택, `pickFirstHomePiece`)을 제거**했다. 1단계 `pickMyPieceAt`(보드 위 내 말) 또는 2단계 `isClickOnHomeArea`+`pickFirstHomePiece`(HOME 박스 영역)에서 말이 특정될 때**만** `net.movePiece`. 둘 다 실패(`pieceIdx < 0`)하면 `ui.showToast('이동할 말을 클릭하세요.', 'error')` 후 `return`. 폴백을 되살리면 빈 칸 클릭이 의도치 않게 HOME 말을 출발시킨다. 좌표 매핑(`BOARD_SIZE/rect.width|height`, dpr 무관)은 2026-06-18 재디자인 회귀 가드 그대로 유지. 회귀 게이트: `tests/redesign-hittest-qa.spec.js` HT-BUGB. |
| `capturedBonus` 라이프사이클 | **3개 분기 모두에 명시 리셋 필요** (2026-05-31 §13-11 + 보강 해소): ① MOVE_PIECE/CHOOSE_PATH 핸들러의 `passTurn()` 직후 `game.capturedBonus = false`, ② THROW_YUT 핸들러에서 잡기 보너스 권리로 진입한 던지기에서만 1회 소진 — **2026-06-11 FIX-4: 소진 조건을 `enteredViaCapturedBonus = pendingResults.length === 0 && capturedBonus === true`로 한정**(큐에 yut/mo 잔여 시 보존). 무조건 소진하면 윷·모 보너스 진입 던지기에서 잡기 보너스 권리를 부당하게 잃음. ③ `resetGame()` / `softResetRoom()` 명시 초기화. 누락하면 잡기 후 보너스 결과가 yut/mo가 아닐 경우 87.5% 확률로 결정적 턴 잠금 (QA-D2-001/002 회귀 가드). 보너스 진입 검사식: `hasBonus = capturedBonus===true || lastResult==='yut' || lastResult==='mo'`. |
| 재입장 ID 배정 (FIX-1) | connection 핸들러는 `players.length` 기반이 아니라 **미사용 ID 탐색**(`usedIds = new Set(players.map(p=>p.id))` → `!usedIds.has('p1') ? 'p1' : 'p2'`)으로 배정해야 함. length 기반이면 p1 disconnect 후 재접속 시 p2 중복 배정으로 게임이 잠긴다. (2026-06-11 §13-1 무관, FIX-1) |
| 중첩 분기 (shortcut-top/bottom 합성) | 모서리(5/10) 지름길 선택 후 잔여 steps가 중앙(23)을 통과하면 `computeNextCell`이 `awaitingBranch: true` 재반환 → **CHOOSE_PATH 핸들러가 큐 차감 없이 center 분기 재무장**(BRANCH_REQUEST center 재발송) 후 break. 2차 CHOOSE_PATH에서 piece.cell이 5/10이고 choice가 top/bottom이면 `shortcut-` 접두 합성(`shortcut-top`/`shortcut-bottom`, 서버 내부 전용). `isShortcutChoice`/`isBottomExit` 헬퍼로 판정. 누락하면 윷/모 결과가 증발하고 말이 제자리에 남는 HIGH 버그(2026-06-11 수정 사유). |
| 첫칸 빽도 워프 범위 조정 (2026-06-15 §13-5) | `computeNextCell` `steps === -1` 분기에서 cell 1→19 / cell 19→1 특례를 **외곽 범용 후퇴(`fromCell-1`) 앞에** 배치하고, 범용 범위를 `1~19`에서 **`2~18`로 좁혀야** 한다. 특례를 뒤에 두거나 범위를 안 좁히면 cell 1이 0으로(언더플로우), cell 19가 18로 잘못 후퇴해 워프가 무효화된다. done=false 유지(toCell=19는 GOAL 아님 → movePiece가 done 미설정). |
| 지름길B 중앙 자동 출구 — cell 23 조건 한정 (2026-06-15 §13-6) | MOVE_PIECE 자동 bottom 조건은 **`piece.cell === 23 && piece.lastPath === 'shortcutB'`** 로만 발동. 중첩 분기(cell 5/10에서 shortcut 후 중앙 통과)는 `awaitingBranch=true`로 BRANCH_REQUEST center 재무장 경로로 빠지고 piece.cell이 5/10이므로 자동 분기와 절대 겹치지 않는다. 조건을 cell 23 외로 넓히면 중첩 분기(YR-C16-011)·QA-RF2가 깨진다. `piece.lastPath`는 `computeNextCell` 반환 `finalPath`를 movePiece가 저장하는 **서버 내부 필드 — broadcastState 직렬화 목록에 절대 추가하지 말 것**(STATE 스키마 무변경, 클라이언트/봇 무영향). |
| `computeNextCell` 반환 `finalPath` 누락 방지 (2026-06-15) | 모든 return에 `finalPath`를 포함해야 한다. 착지 return은 `pathContext`, awaitingBranch=true·백도(-1) return은 `null`. 누락하면 piece.lastPath가 `undefined`가 되어 자동 라우팅이 동작하지 않는다. |
| 중앙 통과 자동 라우팅 — 정확 착지만 분기 (2026-06-16 버그A) | 말이 중앙(23)을 **정확히 멈추지 않고 통과**하는 이동은 BRANCH_REQUEST를 발송하지 않고 **진입 지름길 기준으로 자동 라우팅**한다(지름길A 통과 → centerExitA 28/29, 지름길B 통과 → centerExitB 24/25). `BRANCH_REQUEST`/분기 모달은 **중앙(23)·모서리(5/10) 정확 착지** 시에만 무장해야 한다. 통과 케이스에서 awaitingBranch를 켜면 말이 중앙에 멈춰 분기 모달이 잘못 뜬다. 중첩 분기(모서리 5/10 정확 착지 후 shortcut→중앙 통과)는 별도 경로(`shortcut-top`/`shortcut-bottom` 합성)로 piece.cell이 5/10이라 통과 자동 라우팅과 겹치지 않는다. 자동 라우팅 출구 선택은 `piece.lastPath`(`shortcutA`→centerExitA / `shortcutB`→centerExitB) 기준. |
| centerExitA 28/29 추가 시 server.js↔board.js 대칭 (2026-06-16 버그B) | `advanceOneCell` centerExitA는 `23→28→29→15→16→17→18→19→GOAL`, 백도 복귀 `29→28`/`28→23`. centerExitB(24/25, `23→24→25→16…`)와 거울 대칭. 시작 칸 28/29 이동은 `pathContext='centerExitA'`로 잔여 소진. board.js `buildCenterExitA`/`CENTER_EXIT_A`로 28=(356.67,356.67)/29=(433.33,433.33) 렌더링·hit-test·경로선 동시 추가(누락 시 칸은 가지만 화면에 안 보임). |
| 봇 dedup 키에 `awaitingBranchType` 필수 (2026-06-12) | `bot.js`/`bot-smoke.test.js` 인라인 봇의 중복 행동 방지 키(`${currentTurn}\|${pendingResults}\|${awaitingBranchAt}\|${awaitingBranchType}\|${capturedBonus}`)에서 **`awaitingBranchType`을 빼면 안 됨**. 중첩 분기(corner shortcut→center 재무장) 시 서버가 `pieceIndex`(awaitingBranchAt)·큐·capturedBonus를 그대로 둔 채 `awaitingBranchType`만 `corner→center`로 바꿔 STATE를 재발송하므로, 이 필드가 키에 없으면 키가 동일해져 봇이 2차 center 분기를 "이미 처리한 상태"로 무시 → **영구 턴 잠금**. 봇이 corner에서 shortcut을 고르고 잔여 steps가 정확히 중앙을 통과할 때만 발생하는 간헐(확률적) 데드락이라 재현이 까다로움. (bot.js:169, bot-smoke.test.js:120, HIGH 수정 사유) |
| HOME → 보드 진입 칸 수 | `advanceOneCell()` cell === -1 분기는 **`return 1`** (정통 룰: HOME에서 도 = 칸 1). 추가로 `cell === 0`에서 `return 1` 안전망 필요. 이전 `return 0` 단순화는 정통과 1칸 차이를 유발했음. (2026-05-31 룰북 §13-10 해소 사유) |
| 분기 대기 (`awaitingBranchAt`) | THROW/MOVE 모두 차단. 중앙 도달 시 piece는 **아직 이동시키지 않은 상태**로 두고 awaiting만 기록 → CHOOSE_PATH 시 movePiece 재호출. |
| 보드 클릭 hit-test 좌표계 (2026-06-18 시각 재디자인) | 보드 클릭 hit-test는 **`BOARD_SIZE(560) / rect.width \| rect.height`** 비율로 매핑해야 한다(`main.js`, dpr 무관). 2단 레이아웃 도입으로 `ui.js resizeBoard()`가 캔버스 **표시 크기**를 동적화하므로, 옛 `canvas.width ≡ 560` 가정으로 좌표를 스케일하면 보드 말 클릭/이동이 어긋난다(QA HIGH 발견·해소). canvas.width 기반 스케일 **금지**. 회귀 게이트: `tests/redesign-hittest-qa.spec.js`(4건) + dpr 1/2/2.5 매트릭스. |
| `start.bat` 인코딩 | ASCII-only로 유지. 한글 포함 시 cmd 949 코드페이지에서 깨짐. |
| `stop.bat` 방식 | tetris-battle와 달리 윈도우 타이틀(`Yutnori Server`) 기준으로 종료 → 포트 3000~3010을 공유하는 다른 프로젝트(tetris-battle, matgo) 서버를 실수로 죽이지 않음. |
| 윷가락 fronts↔result 매핑 | 정통 룰: 평평면 개수 = 칸 수 (도=1, 개=2, 걸=3, 윷=4). **모만 예외 (0개 → 5칸).** 백도는 fronts=1이고 그 평평면이 마크 가락일 때 발동. 거꾸로(fronts=0→윷, 4→모) 매핑하면 사용자 직관과 정반대로 동작하여 즉시 신고됨. Phase 2.1 핫픽스 사유. (룰북 §13-4) |

### 룰북 §13 매핑 요약 — 구현 vs 표준 차이 (12건, 미해소 6 / 해소 6)

코드 수정 시 영향 항목을 반드시 확인한다. 상세는 `docs/RULEBOOK.md` §13.

| § | 항목 | 영향도 | 상태 | 한 줄 요약 |
|---|---|---|---|---|
| §13-1 | 모서리 분기 강제→선택 | **HIGH** | **2026-06-11 해소** | 외곽/지름길 선택 분기(FIX-2). `BRANCH_REQUEST corner` + `CHOOSE_PATH outer/shortcut` + 중첩 분기 2단계 모달. |
| §13-2 | centerExitB 즉시 완주 | **HIGH** | **2026-06-11 해소 (2026-06-16 보강)** | `23→24→25→GOAL` 잔여 소진(FIX-3). 24/25 활성화. **2026-06-16 버그B**: centerExitA도 대칭 중간 칸 28/29 신설(`23→28→29→15→…→GOAL`), board.js `buildCenterExitA`/`CENTER_EXIT_A`. 잡기/업기/백도(29→28/28→23) 동작. |
| §13-3 | 윷가락 확률 균등 50% | LOW | 미해소 | 물리 가락은 60~65% 뒤집힘 편향. 디지털 단순화. |
| §13-4 | 윷가락 매핑 회귀 위험 | MED | 미해소 | Phase 2→2.1 이력. 현재 정상. 회귀 테스트 필수. |
| §13-5 | 첫칸 빽도 워프 | LOW | **2026-06-15 해소** | `computeNextCell` steps=-1: cell 1↔19 워프(범용 후퇴 2~18로 좁힘). done=false. HOME 백도 자동 폐기·cell 0 정책은 유지. YR-C5-001/010/011/012/013, U-56b. |
| §13-6 | 중앙 분기 진입 경로별 출구 | LOW | **2026-06-15 해소 (2026-06-16 보강)** | 지름길B 경유 중앙(23) 정확 정착(`piece.lastPath==='shortcutB'`) → 다음 이동 자동 centerExitB(bottom), BRANCH_REQUEST 미발송. 지름길A 자유 선택 유지. **2026-06-16 버그A**: 중앙 **통과**(정확히 안 멈춤) 시에도 BRANCH 미발송 + 진입 지름길 기준 자동 라우팅(지름길A→centerExitA, 지름길B→centerExitB). 결정은 정확 착지에만. `finalPath`/`lastPath`(STATE 미노출). YR-C7-008/011/012. |
| §13-7 | 선후공 결정 절차 생략 | LOW | 미해소 | 정통은 첫 던지기로 결정. 본 구현은 p1 고정. |
| §13-8 | 외곽 인덱스 20/28 미사용 | LOW | 미해소 | 단순화. 24/25는 2026-06-11 centerExitB로 활성화(§13-2). |
| §13-9 | HOME 시작 위치 좌우 분리 | LOW | **2026-05-31 해소** | 이전 P1 좌하/P2 우상 → 양 팀 좌하 통일 (`public/js/ui.js`). |
| §13-10 | HOME → 칸 N-1 단순화 | MED | **2026-05-31 해소** | `advanceOneCell` `cell === -1` `return 0 → 1` + `cell === 0` 안전망. HOME → 칸 N 정통 매핑. |
| §13-11 | capturedBonus 잔류 위험 | **HIGH** | **2026-05-31 해소 + 2026-06-11 정밀화** | MOVE_PIECE/CHOOSE_PATH `passTurn()` 직후 명시 리셋 + THROW_YUT 1회 소진 + `resetGame`/`softResetRoom` 초기화. 2026-06-11 FIX-4: 소진 조건을 "큐 빈 capturedBonus 진입 THROW"로 한정(윷/모 진입 시 보존). |
| §13-12 | §6-1 윷·모 잡기 중복 보너스 차단 | LOW | **2026-06-15 해소** | MOVE_PIECE/CHOOSE_PATH capturedBonus 부여에 `useResult !== 'yut' && useResult !== 'mo'` 가드. 윷·모로 잡아도 잡기 보너스 미부여(중복 차단), 도/개/걸 잡기는 +1 유지. 회귀 YR-C19-001~006. |

## 파이프라인 적용 규칙

- **`visual_change: ui`**가 기본 (Canvas/CSS 변경). UI 변경 시 AD3 검수 권장. 2026-06-18 시각 재디자인(레이아웃/테마/Canvas/윷가락)도 `ui`로 AD3 APPROVED.
- **`visual_change: art`는 발생하지 않음** (외부 이미지 에셋 사용 안 함). AD1/2 생략. 웹폰트 도입(Google Fonts)도 이미지 에셋이 아니므로 art 미해당.
- 순수 서버 변경은 `visual_change: none` 가능.

## 향후 작업 우선순위

| 우선순위 | 항목 | 비고 |
|---|---|---|
| 중간 | 백도(빽도) 변형 룰 옵션 추가 | X자 표식 가락 1개 |
| 낮음 | 던지기 애니메이션 (가락 회전) | 시각 폴리시 |
| 낮음 | 사운드 (윷가락 소리, 잡기 효과음) | |
| 낮음 | 채팅 또는 이모지 | 친구 대전 폴리시 |
| 낮음 | 옵저버 모드 | 현재 2인 1룸 고정 |

## Mockup Sync

- 외부 이미지 에셋이 없으므로 `studio-mockup` 동기화 **불필요**.

## 참조

- 사용자 문서: `README.md`
- **권위 룰북**: `docs/RULEBOOK.md`
- 현재 상태: `docs/PROJECT.md`
- 변경 이력: `docs/CHANGELOG.md`
- Coder 리포트: `C:\LazySlimeStudio\.claude\specs\2026-05-25-yutnori-coder-report.md`
- 시각 재디자인(2026-06-18): `.claude/specs/2026-06-18-yutnori-redesign-{concept,spec,report,ad3-review}.md`, `.claude/specs/2026-06-18-yutnori-yut-stick-redesign.md`
- 버그 B/C(2026-06-20): `.claude/specs/2026-06-20-yutnori-click-bonus-bugfix-{spec,report}.md`
