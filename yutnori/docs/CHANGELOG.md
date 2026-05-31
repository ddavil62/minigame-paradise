# Yutnori — 변경 이력

## Rulebook Tests — 룰북 기반 168 시나리오 + 결함 5건 수정 (2026-05-31)

### 추가
- **룰북 기반 Playwright 시나리오 168개 신규 작성** (`tests/rulebook-c1~c14-*.spec.js`, 14개 spec 파일).
  - ID 체계: `YR-C{1~14}-{NNN}`. 기존 `U-/W-/E-`와 충돌 없음.
  - 각 `test()`에 룰북 §번호 인용 + Given/When/Then 한국어 주석.
  - 카테고리: C1 윷가락 30 / C2 이동 15 / C3 잡기 10 / C4 업기 10 / C5 백도 10 / C6 모서리 분기 10 / C7 중앙 분기 10 / C8 보너스 10 / C9 턴 전환 10 / C10 승리 5 / C11 WS 프로토콜 15 / C12 §13 미해소 정책 PASS 8 / C13 §13 해소 회귀 가드 10 / C14 엣지케이스 15.
- **공용 헬퍼 `tests/rulebook-helpers.js`** 신규: `WsClient`, `withRandom`, `startServer`, `stopServer`, `connectWs`, `setupGame`, `inject`, `injectAndDrain`, `placePieces`, `forceResults` 9개 export.
- 룰북 §13 11건 100% 커버: §13-1/2 정책 PASS (C6/C7/C12), §13-3/4/5/6/7/8 정책 PASS (C1/C2/C5/C7/C9/C12), §13-9/10/11 회귀 가드 (C2/C13).

### 변경
- `tests/yut.unit.spec.js` U-18~U-22 5건 기댓값 갱신: §13-10 해소(HOME → 칸 N 정통 매핑) 이전 단순화 기댓값(HOME + do → cell 0 등)이 잔존하여 사전 FAIL 상태였음. YR-C2-001~005 / YR-C13-001~004와 동일 매핑으로 통일. `yut.unit` 65/65 PASS 회복.

### 수정 (Bugfix)
- **`server.js` THROW_YUT 핸들러 capturedBonus 잔류 [HIGH 결함]**: 잡기 직후 보너스 THROW로 do/gae/geol/backdo가 나오면 `capturedBonus=true`가 잔류하여 MOVE 후에도 `hasBonus`가 계속 true → `passTurn`이 진입되지 않아 턴이 영원히 안 넘어가던 결정적 잠금 버그. 발생 확률: 잡기 후 87.5%. 결과 큐 push 직후 `capturedBonus = false`로 1회 소진 리셋 추가. (QA-D2-001/002 회귀 가드)
- **`server.js` MOVE_PIECE 핸들러 capturedBonus 리셋 시점 보강**: 잡기 발생 분기에서 `passTurn` 진입 전 `capturedBonus` 일관성 보장.
- **`server.js` `resetGame()` / `softResetRoom()` capturedBonus 명시 초기화**: 기존에 미초기화되어 첫 액세스 시 undefined. REMATCH 경계에서 잔류 가능성 차단. `game = { ..., capturedBonus: false }` 추가.
- **YR-C5-008 (HOME 백도 자동 폐기) flaky 안정화**: backdo 시도 한도 50회 → 100회 상향으로 이론적 fail 확률 4.07% → 0.16%로 감소.
- **YR-C8-008 (백도 보너스 없음) flaky 안정화**: WS race condition 완화 (drain 순서 보강).

### 회귀 결과
- **253/253 PASS** (5.2초): 신규 168 + 기존 yut.unit 65 + ws.scenarios 20. 5회 반복 안정성 0 flaky.
- E2E 25개는 서버 가동 시 별도 회귀.

### 알려진 이슈 (Out of Scope)
- §13-1 / §13-2 (HIGH 미해소) 정통 룰 정합 발주는 본 작업 범위 밖. C6/C7/C12에서 정책 PASS로 검증만 유지.
- Windows libuv `UV_HANDLE_CLOSING` 콘솔 경고. 테스트 결과 자체에는 영향 없음. Node 22.x 업그레이드 시 자연 해결 가능성.

### 참고
- 목적 정의서: `.claude/specs/2026-05-31-yutnori-rulebook-tests-scope.md`
- 스펙: `.claude/specs/2026-05-31-yutnori-rulebook-tests-plan.md`
- Coder 리포트: `.claude/specs/2026-05-31-yutnori-rulebook-tests-coder-report.md`
- Coder Revise 리포트: `.claude/specs/2026-05-31-yutnori-rulebook-tests-coder-revise-report.md`
- QA 리포트: `.claude/specs/2026-05-31-yutnori-rulebook-tests-qa-report.md`
- Doc Writer 리포트: `.claude/specs/2026-05-31-yutnori-rulebook-tests-doc-writer-report.md`

## Rulebook — 한국 표준 룰북 작성 (2026-05-31)

### 추가
- **`docs/RULEBOOK.md` 신규 작성** (635줄, §1~§13 + 부록).
  - matgo/janggi와 동일한 13섹션 패턴 채택.
  - 출처 29회 인용: 한국어 위키백과 「윷놀이」, 영문 Wikipedia 「Yunnori」, 한국민속대백과사전, 나무위키.
  - 섹션 구성:
    - §1 게임 개요 / §2 말판 + ASCII 다이어그램 / §3 윷가락 결과 표 (실측 5,000회 분포 포함)
    - §4 말 / §5 이동 규칙 + 칸 수 표 / §6 보너스 / §7 잡기 / §8 업기
    - §9 백도 / §10 분기점(모서리/중앙) / §11 승리 / §12 QA 체크리스트 (8 카테고리)
    - §13 구현 노트 (구현 vs 표준 차이) + 부록 WebSocket 프로토콜
- **§13 구현 vs 표준 차이 8건** (영향도 라벨):
  - **§13-1 [HIGH]** 모서리(5/10) 강제 지름길 진입 — 정통은 외곽/지름길 선택. 사용자 의심 후보 **1순위**.
  - **§13-2 [HIGH]** centerExitB 즉시 완주 — 중앙→좌하 진행 시 남은 steps 무관 즉시 GOAL. 사용자 의심 후보 **2순위**.
  - §13-3 [LOW] 윷가락 확률 균등 50% (의도된 디지털 단순화).
  - §13-4 [MED] 윷가락 매핑 회귀 위험 (Phase 2→2.1 이력, 현재 해소).
  - §13-5 [LOW] HOME 백도 자동 폐기 (의도된 단순화).
  - §13-6 [LOW] 중앙 분기 양방향 자유 선택 (표준에 모호).
  - §13-7 [LOW] 선후공 결정 절차 생략 (p1 고정).
  - §13-8 [LOW] 외곽 인덱스 20/24/25/28 미사용 (단순화).
- 사용자가 보고한 "뭔가 많이 이상해"의 원인 후보 3건 (§13-1 / §13-2 / §13-4) 명시.

### 변경
- `README.md`: "룰 기준 문서" 섹션 추가. 룰북 링크 + §13 HIGH 2건 강조.
- `CLAUDE.md`: "룰북 (필수 숙지)" 섹션 추가. "변경 시 자주 깨지는 함정"에 §13 매핑 8건 요약표 추가.

### 참고
- 목적 정의서: `.claude/specs/2026-05-31-yutnori-rulebook-scope.md`
- 스펙: `.claude/specs/2026-05-31-yutnori-rulebook-plan.md`
- Doc Writer 리포트: `.claude/specs/2026-05-31-yutnori-rulebook-doc-writer-report.md`

## Phase 2.1 — 윷가락 매핑 재정정 (2026-05-25, 긴급 핫픽스)

### 정정 (Bugfix)
- Phase 2가 "정정"이라고 적용한 매핑(`fronts=0→윷, 1→걸, 2→개, 3→도/백도, 4→모`)이 **사실은 정통 룰의 반대 방향**이었음. 사용자 플레이 중 "개가 나왔는데 1칸만 간다"는 직관 불일치로 발견.
- 한국 표준 윷놀이 정통 룰로 재정정: **평평면 개수(fronts) = 이동 칸 수** (도=1, 개=2, 걸=3, 윷=4). 모만 예외(fronts=0 → 5칸).
  - 새 매핑: `fronts=0→모, 1→도/백도, 2→개, 3→걸, 4→윷`.
  - 백도 조건도 함께 이동: `fronts=3 + sticks[MARKED]=0` → `fronts=1 + sticks[MARKED]=1` (도가 나왔는데 그 1개 평평면이 마크 가락이면 백도). 전체 확률은 1/16로 동일.
- README의 윷가락 표(앞/뒤) 재정정.

### 테스트
- `tests/smoke.test.js` 시나리오 8/8b의 백도·도 sticks 일관성 검증을 새 매핑(`fronts==1`, `sticks[markedIndex]==1=백도 / ==0=도`)으로 갱신.
- 5000회 분포 실측: backdo 6.16%, do 18.68%, gae 37.40%, geol 24.62%, yut 6.86%, mo 6.28% (이론값 6.25/18.75/37.5/25/6.25/6.25%와 일치).
- 전체: **40/40 PASS** 유지.

## Phase 2 — 백도 + 룰 매핑 정정 (2026-05-25)

### 추가
- **백도(빽도)** 추가: 4개 윷가락 중 0번 가락에 빨간 X 마크. 마크 가락만 단독으로 뒷면(=뒤집힘)일 때 발동.
  - 이동: -1칸 (출발한 말만 1칸 뒤로). HOME 말엔 사용 불가 → 서버 자동 폐기.
  - 보너스 턴 없음 (윷/모만 보너스).
  - 백도 후 출발선(0)에서는 더 못 감 → 그대로 유지.
  - 지름길 안에서 백도 → 진입 모서리로 복귀 (21→5, 22→21, 26→10, 27→26, 23→22).
  - 확률: 1/16 = 약 6.25% (단위 5000회 검증, 실측 5~7% 범위).
- 백도 결과 시각: 결과 큐 칩 + 결과 라벨 빨간색 강조 + 윷가락 마크 가락에 빨간 X 표식 (`yut-backdo` CSS 변수).
- `YUT_RESULT` 메시지에 `markedIndex` (마크 가락 인덱스), `discarded` (자동 폐기 여부) 필드 추가.

### 정정 (Bugfix)
- `throwYutSticks` 결과 매핑이 정통 룰과 어긋남(`fronts=1 → 도`)이라 백도가 영원히 발동하지 않던 버그 수정.
  - 정통 룰 매핑으로 일관성 통일: fronts=0→윷, 1→걸, 2→개, 3→도/백도, 4→모.
  - (`sticks[i]=1`이 앞면이라는 시각화 컨벤션은 그대로 유지.)
- README의 윷가락 표(앞/뒤) 정정.

### 테스트
- `tests/smoke.test.js` 시나리오 7~9 추가:
  - 7: `YUT_RESULT.markedIndex` 존재/범위 검증
  - 8: `throwYutSticks` 5000회 단위 분포 + `computeNextCell` 백도/지름길 진입 6+3 케이스
  - 8b: WS 통합 분포 sanity (마크 일관성)
  - 9: HOME 말에 백도 시도 시 ERROR 반환
- 기존 시나리오 3, 4: 첫 던지기에 백도가 나오면 자동 폐기되어 STATE에 안 들어가는 케이스 대응 — `throwUntilNonBackdo()` 헬퍼로 일반 결과 확보. (시나리오 의미는 유지)
- 결과: **40/40 PASS** (기존 18개 → 40개 확장).

## Phase 1 — MVP (2026-05-25)

신규 프로젝트. 사용자가 친구와 즉시 플레이 가능하도록 30~60분 안에 완성.

### 추가
- `server.js`: 서버 권위 게임 로직 + WebSocket 라우터 + ANSI 콘솔 박스 + LAN IP 자동 감지 + 포트 폴백.
- `public/index.html`, `public/css/style.css`: 한국 전통 보드 톤 (한지/먹/주황) UI.
- `public/js/main.js`: 진입점 (UI ↔ Network ↔ Game 와이어업).
- `public/js/network.js`: WebSocket 클라이언트 (JOIN/READY/THROW_YUT/MOVE_PIECE/CHOOSE_PATH/REMATCH 송수신).
- `public/js/game.js`: STATE 캐시 + `canThrow()`, `isMyTurn()` 등 검증 헬퍼.
- `public/js/board.js`: 칸 인덱스(0~19 외곽, 21/22/26/27 지름길, 23 중앙) → 캔버스 좌표 매핑. `hitTestCell()` 클릭 판정.
- `public/js/yut.js`: 윷 결과명/한글 매핑 + Canvas로 가락 4개 렌더링 (앞면=베이지, 뒷면=어두운 갈색).
- `public/js/piece.js`: 클릭 위치 → 내 piece 인덱스 추정. HOME 영역 폴백.
- `public/js/ui.js`: 보드(사각형 + 두 대각 지름길) + 말(빨강/파랑 + 업힘 카운트) + 윷가락 + HUD 렌더링. 초대 패널/토스트/카운트다운 포함.
- `start.bat`/`stop.bat`: Windows 런처. stop은 윈도우 타이틀 기반(다른 프로젝트 서버 영향 없음).
- `tests/smoke.test.js`: 6 시나리오/18 assert. 18/18 PASS.

### 게임 규칙 (Phase 1)
- 외곽 사각형 20칸 + 두 지름길 + 중앙(방).
- 도(1)/개(2)/걸(3)/윷(4, +턴)/모(5, +턴).
- 잡기(상대 말 출발점으로 + 보너스 턴), 업기(같은 칸 자기 말 묶음 함께 이동).
- 모서리(좌상 5, 우상 10) 정확히 멈춤 → 다음 이동 시 자동 지름길 진입.
- 중앙(23) 도달 시 출구 분기 (모달 선택).
- 자기 말 4개 모두 완주 시 승.

### 단순화 (정통 룰 대비)
- 모서리에서 외곽 계속 vs 지름길 선택지 없음 (정확히 멈추면 자동 지름길).
- 중앙→좌하 출구는 직접 완주 처리.
- 백도(빽도) 변형 룰 미적용.

### 검증
- `node server.js --port 3088` 정상 기동, ANSI 박스 + LAN IP 출력.
- `curl http://localhost:3088/` HTML 200 응답 (4361 bytes).
- `node tests/smoke.test.js --port 3088`: **18/18 PASS**.
- Playwright 스크린샷 6개 (`tests/screenshots/`): 보드 렌더링 + 던지기 + 결과 칩 선택 + 말 이동 정상 확인.
