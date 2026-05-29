# Yutnori — 변경 이력

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
