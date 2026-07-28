# Changelog

## [2026-07-28] - AI 진입 ROOM_FULL 교착 버그 수정

### 수정

- **P-1** `public/js/client.js` -- `#ai-start-button` 클릭 시 `intentionalClose=true` + `LEAVE_GAME` 전송 후 120ms 뒤 `socket.close()` + `location.href` 이동하도록 수정. 기존에는 LEAVE_GAME 없이 바로 이동해 서버가 비자발적 끊김으로 판단, p1 슬롯을 15초 유령 예약 상태로 남겼다.
- **P-2** `public/js/client.js` + `server.js` -- 클라이언트가 1회성 `fresh=1` 플래그를 WS URL에 실어 보내고(`buildWebSocketUrl`에서 `freshEntry` 캡처, open 후 false로 리셋), 서버 `handleUpgrade`가 `mode=ai&fresh=1`일 때만 잔존 슬롯을 강제 정리. 정리 대상 3종: 유령 슬롯(`!ws && disconnectDeadline`), 죽어가는 슬롯(`ws.readyState !== OPEN`), 봇 슬롯(`ws.isBot`). 정리 시 `killBot()` + 시뮬레이션 재초기화. F5 새로고침은 `fresh` 없이 기존 15초 재접속 유예 동작 유지.
- **P-3** `server.js` -- `resetEndedSessionIfAbandoned()` 조건을 `clients.size !== 0` 대신 `[...clients.values()].some(c => c.playerId)`(playerId가 할당된 client 존재)로 완화. JOIN 이전 상태의 재연결 소켓이 초기화를 막던 문제 해소.
- **P-4** `public/js/client.js` -- ROOM_FULL ERROR 수신 시 `intentionalClose=true`로 350ms 자동 재연결 루프 차단.

### 추가

- `server.js` -- 봇 소켓에 `ws.isBot=true` 플래그 설정(`mode=bot` 접속 시). close 핸들러에서 봇은 `pauseForDisconnect` 스킵하여 유령 슬롯 생성 방지.
- `server.js` -- standalone 진입점(`node server.js --port N`)에 `getBotUrl` 기본값 주입. Playwright E2E 환경에서도 AI 모드 동작.
- `tests/ai-bot-ws-qa.spec.js` -- TC-NEW-1(LEAVE_GAME 후 재진입 WELCOME 확인), TC-NEW-2(유령 슬롯+fresh=1 방어), TC-NEW-3(ROOM_FULL 정적 단언 4건) 추가. 총 35건.
- `tests/ai-bot-qa.e2e.spec.js` -- TC-E2E-NEW-1(AI 세션 도중 재진입 -> ROOM_FULL 없이 새 세션) 추가. `waitForFunction` 하드 단언 사용. 총 11건.
- `tests/ai-entry-race-qa.spec.js` -- AI 재진입 레이스 컨디션 회귀 테스트 6건(0ms/50ms 재진입, 연속 3회 재진입, AC-4 F5 유예, AC-5 일반 LAN 재접속). 실행: `node --test tests/ai-entry-race-qa.spec.js`.

### 검증

- 1차 QA FAIL: DEFECT-1(0ms 레이스 -- handleUpgrade가 CLOSING/봇 슬롯 미정리), DEFECT-2(TC-E2E-NEW-1 try/catch 허위 PASS), DEFECT-3(standalone getBotUrl 미주입).
- 2차 구현에서 3건 모두 해결: DEFECT-1은 정리 대상 3종 확장, DEFECT-2는 하드 단언 전환, DEFECT-3은 standalone getBotUrl 주입.
- 2차 QA PASS: AC-1~AC-9 전체 충족. WS 35/35, E2E 11/11, QA 레이스 6/6, npm test 49/50(1건 기존 부채).
- 보존 동작 확인: F5 재접속 유예(AC-4), 일반 LAN 2인 모드(AC-5), 런처 AI 채우기(AC-6).

### 참고

- 스펙: `.claude/specs/2026-07-28-starlight-ai-entry-roomfull-plan.md`
- 구현 리포트 1차: `.claude/specs/2026-07-28-starlight-ai-entry-roomfull-coder-report.md`
- 구현 리포트 2차: `.claude/specs/2026-07-28-starlight-ai-entry-roomfull-coder-report-2.md`
- QA 1차: `.claude/specs/2026-07-28-starlight-ai-entry-roomfull-qa.md` (FAIL)
- QA 2차: `.claude/specs/2026-07-28-starlight-ai-entry-roomfull-qa-2.md` (PASS)
- 에셋 파일 변경이 없어 Mockup Sync를 생략했다.

## [2026-07-28] - 레디 화면 재설계 (UI 2단계)

### 추가

- `public/index.html`에 `.level-tabs` 탭바(4버튼: 기지/자연/우주/경이)와 `#level-detail-desc` 설명 영역을 신설했다.
- `public/index.html`에 `.ready-footer` 래퍼를 신설하고 `#ready-button`, `#ai-start-button`, `#ready-note`를 내부로 이동했다.
- `public/js/client.js`에 `TAB_MOTIFS` 매핑 상수(tab-tower: tower/train/clock/storm/orbit, tab-nature: ocean/volcano/rainforest/glacier/snowpeak, tab-cosmic: space/crystal/desert/factory, tab-wonder: garden/temple/library), `activeTabId` 상태, `setActiveTab()`, `renderLevelDetail()` 함수를 추가했다.
- `public/js/client.js`의 `renderLevelCards()`에 탭 필터 로직을 삽입해 활성 탭의 레벨만 표시한다.
- `public/js/client.js`의 `updateMenu()`에 탭 자동 전환 로직을 추가해 서버가 다른 탭의 `selectedLevelId`를 보내면 해당 탭으로 자동 전환한다.
- `public/js/i18n.js`에 KO/EN 양쪽 `tab.tower`, `tab.nature`, `tab.cosmic`, `tab.wonder` 번역 키 4개를 추가했다.
- `tests/ready-screen-phase2.e2e.spec.js`에 15건의 E2E 테스트(AC-1~AC-15 대응)를 신설했다.
- `tests/ready-screen-phase2-qa.e2e.spec.js`에 QA 자체 테스트 31건을 신설했다.
- `tests/footer-overlap-regression.e2e.spec.js`에 5개 해상도 풋터 겹침 회귀 테스트 5건을 신설했다.

### 변경

- `.level-card` min-height를 132px에서 88px(CSS)로 변경하고 `.level-banner` height를 44px에서 28px으로 축소했다. 실측 카드 높이: 데스크탑 99.6px, 모바일 72px.
- `.level-info em`(설명문 2줄)을 `display:none`으로 숨기고 `#level-detail-desc` 단일 영역에서 선택 레벨 설명만 표시한다.
- `.level-list` 그리드를 `minmax(180px,1fr)`에서 `minmax(140px,1fr)`로 변경해 데스크탑 5열 단일 행을 확보했다.
- `.ready-card`를 `display:flex; flex-direction:column; overflow-y:auto; max-height:calc(100dvh - 32px)`로 통일했다.
- `.ready-footer`에 `position:sticky; bottom:0; margin-top:auto`를 적용해 준비 버튼을 항상 하단에 고정했다.
- `.level-tab` 터치 영역을 데스크탑 min-height 36px, 모바일(640px 이하) 40px로 설정했다.
- 모바일(520px 이하)에서 `.crew-row` 2열 복원, `.level-list` gap 12->8px, 카드/배너 min-height 축소(80->68px), 배너 폭 104->96px을 적용했다.
- 탭 분기로 낡아진 기존 테스트 8건(`ui-separation-qa`, `qa2-edge-cases`, `defect1-recheck`, `world-expansion`, `ai-bot-qa`)의 `cardCount=17` 단언을 탭 순회 방식으로 갱신했다.

### 검증

- AD 모드 3 1차 REVISE(BLOCKER 3, HIGH 1, MED 2) -> 수정 후 2차 APPROVED. 5개 해상도(1920x1080/1440x900/1280x720/1024x576/520x900) x 4개 탭 = 20개 조합 전부 maxScroll=0, 겹침 0px, `#ready-button` 뷰포트 내 노출.
- QA PASS: 수용 기준 AC-1~AC-15 전체 충족, 예외 시나리오 14건 전부 PASS.
- 전체 스위트: 115 PASS / 4 FAIL(전부 선재 부채).
- 1단계 CARRY-1(1024x576에서 scrollHeight 1420~1456px, 준비 버튼 접근에 874px 스크롤 필요) 완전 해소.

### 참고

- 스펙: `.claude/specs/2026-07-28-starlight-ready-screen-plan.md`
- 구현 리포트: `.claude/specs/2026-07-28-starlight-ready-screen-coder-report.md`
- AD 모드 3 (1차): `.claude/specs/2026-07-28-starlight-ready-screen-ui-review.md` (REVISE)
- AD 모드 3 (2차): `.claude/specs/2026-07-28-starlight-ready-screen-ui-review2.md` (APPROVED)
- QA: `.claude/specs/2026-07-28-starlight-ready-screen-qa.md` (PASS)
- 에셋 파일 변경이 없어 Mockup Sync를 생략했다.

## [2026-07-27] - 런처 준비 승계 중복 UI 제거

### 변경

- 런처가 전달하는 `lobbyReady=1` 진입에서는 최초 HTML부터 준비 오버레이와 READY·AI 버튼을 숨기고, waiting 메뉴 상태가 이를 다시 열지 않게 했다.
- 두 참가자 또는 게임 관리형 AI의 연결과 서버 START를 기다리는 동안 추가 READY 조작을 요구하지 않는다.
- 직접 URL 진입은 기존 수동 READY 화면을 유지하며, START 이후에는 결과→레벨 선택에서 READY·AI 버튼을 다시 사용할 수 있다.
- 진행 중 재접속은 기존 역할·진행 상태를 복구하고 READY나 START를 새로 발생시키지 않는다.

### 검증

- 별빛 우편탑 준비 흐름 7/7, 런처 인계·직접 진입 브라우저 UI 검증 2/2 중 해당 시나리오를 통과했다.
- AD 모드 3 `APPROVED`, 최종 QA `PASS`를 확인했다.

### 참고

- 스펙: `../../../.Codex/specs/2026-07-27-minigames-duplicate-ready.md` (`COMPLETED`)
- 구현 리포트: `../../../.Codex/specs/2026-07-27-minigames-duplicate-ready-coder-report.md`
- UI 검수: `../../../.Codex/specs/2026-07-27-minigames-duplicate-ready-ui-review.md` (`APPROVED`)
- QA: `../../../.Codex/specs/2026-07-27-minigames-duplicate-ready-qa.md` (`PASS`)
- 에셋 변경이 없어 Mockup Sync와 `studio-mockup` 동기화를 생략했다.

## [2026-07-26] - 서버 스냅샷 렌더 보간

### 추가

- `public/js/interpolation.js`에 이전·최신 스냅샷과 단조 수신 시각을 사용하는 렌더 전용 보간 버퍼를 추가했다.
- 약 15Hz 수신 간격을 기본으로 하고 40~100ms 표본 제한과 EWMA를 적용해, rAF 렌더 시각을 한 수신 구간 뒤에서 안정적으로 계산한다.
- P1/P2의 `x/y/vx/vy`, 동적 발판의 `x/y`, 회전 장치 각도를 동일 ID와 동일 보간 계수로 연결한다.
- `tests/interpolation.test.js`에 보간 경계값, EWMA, 원본 불변성, 불연속 스냅과 생명주기 초기화의 결정론적 테스트를 추가했다.
- `tests/snapshot-interpolation.e2e.spec.js`에 rAF 렌더 좌표가 권위 좌표보다 촘촘하게 생성되는 브라우저 검증을 추가했다.

### 변경

- `public/js/renderer.js`는 Canvas 프레임마다 렌더 전용 스냅샷을 만들고 플레이어·동적 발판·카메라에 같은 시간축을 사용한다.
- `public/js/client.js`는 서버 스냅샷 수신 시각을 단조 시계로 전달하되 HUD·DOM·이벤트는 최신 권위 스냅샷을 즉시 사용한다.
- START, PAUSED, RESUMED와 레벨·페이즈·체크포인트 전환에서 보간 버퍼를 초기화한다.
- 리스폰 상태 변화, ID 누락, 240px 초과 좌표 변화, 500ms 초과 공백, 중복·역행 tick에서는 과거 위치를 가로지르지 않고 최신 좌표로 스냅한다.
- 서버 30Hz 물리·입력·충돌과 약 15Hz 스냅샷 전송 주기는 변경하지 않았다. 외삽과 로컬 입력 예측도 추가하지 않았다.

### 검증

- Art Director 모드 3: 실제 3000번 포트에서 `APPROVED`.
- 실제 3000번 측정: 1,203.3ms 동안 rAF 73프레임, 권위 좌표 19단계, 고유 렌더 좌표 71개, 최대 프레임 이동 5.762px, 비유한 좌표 0건.
- 리스폰은 낙하 위치와 체크포인트 사이를 여러 프레임으로 가로지르지 않고 한 프레임에 최신 위치로 스냅했다.
- 결정론적·준비·2P 결속·17레벨 체크포인트 회귀 20/20 PASS, 격리 브라우저 보간 E2E 1/1 PASS.
- 전체 단위 회귀 49/50 PASS. 실패 1건은 현재 17개 레벨을 과거 기대값 5와 비교하는 기존 테스트 부채다.

### 참고

- 스펙: `.Codex/specs/2026-07-26-starlight-mail-tower-snapshot-interpolation.md`
- 구현 리포트: `.Codex/specs/2026-07-26-starlight-mail-tower-snapshot-interpolation-coder-report.md`
- AD 모드 3: `.Codex/specs/2026-07-26-starlight-mail-tower-snapshot-interpolation-ui-review.md`
- QA: `.Codex/specs/2026-07-26-starlight-mail-tower-snapshot-interpolation-qa.md`
- 에셋 파일 변경이 없어 `studio-mockup` 동기화는 생략했다.
