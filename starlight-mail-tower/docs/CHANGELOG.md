# Changelog

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
