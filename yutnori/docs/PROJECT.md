# Yutnori — 프로젝트 현황

> 한국 전통 윷놀이 LAN 1:1 대전. 사용자가 친구와 즉시 플레이용으로 발주된 신규 프로젝트.

## 현재 상태 (2026-06-15)

**§13-6 지름길B 중앙 자동 라우팅 + §13-5 첫칸 빽도 워프 해소** — §13-6: 지름길B(우상 10→26→27→23) 경유로 중앙 정확 정착 시 다음 이동 자동 centerExitB(bottom), BRANCH_REQUEST 미발송(자동 조건 `piece.cell===23 && piece.lastPath==='shortcutB'`). 지름길A 경유는 자유 선택 유지. `computeNextCell` 반환 `finalPath` + `piece.lastPath` 저장(STATE 스키마/클라 무변경). §13-5: 첫칸(cell 1) 빽도 → cell 19(참먹이) 워프, cell 19 빽도 → cell 1 복귀(done=false). 신규 6건. 권위 근거: 룰 가이드(`docs/2026-06-15-yutnori-rule-research.md` C3/B6/B7). 회귀 게이트 **서버리스 327 + 봇 smoke 7/7 PASS**.

### 2026-06-15 주요 변경 (§13-5 / §13-6 해소)
- **§13-6 — 지름길B 중앙 자동 라우팅**: `server.js computeNextCell` 반환에 `finalPath` 추가 + `movePiece`가 `piece.lastPath`에 저장. MOVE_PIECE 자동 조건 `piece.cell===23 && piece.lastPath==='shortcutB'`이면 BRANCH_REQUEST 없이 centerExitB(bottom) 자동. 지름길A 경유는 자유 선택 유지, 중첩 분기(cell 5/10)는 자동 조건과 비충돌(YR-C16 무영향). STATE 스키마/클라 무변경.
- **§13-5 — 첫칸 빽도 워프**: `computeNextCell` steps=-1에서 cell 1↔19 양방향 워프(외곽 범용 후퇴 범위 2~18로 좁힘). done=false. HOME 빽도 자동 폐기·cell 0 정책 유지.
- **테스트**: 신규(지름길B 자동/지름길A 선택유지/cell1↔19 양방향/워프 후 완주) + 정책 변경 갱신 YR-C7-008·YR-C5-001·YR-C3 capture. rulebook-c5/c7/yut.unit에 반영.
- 회귀: 서버리스 **327 passed**(이전 321 + 신규 6), 봇 smoke 7/7 PASS. 중첩 분기 무영향.
- 룰북 §13: 구현 vs 표준 차이 12건 → 미해소 4 + 해소 8 (§13-5/§13-6 해소 추가).

### 2026-06-15 주요 변경 (§13-12 해소)
- **`server.js`**: MOVE_PIECE(~972)·CHOOSE_PATH(~1066) capturedBonus 부여 가드(`useResult !== 'yut' && useResult !== 'mo'`). 윷·모 자체 보너스와 잡기 보너스 중복 차단(한 행위 최대 1회), 도/개/걸 잡기는 +1 유지.
- **신규 `tests/rulebook-c19-capture-bonus-no-stack.spec.js`** (YR-C19-001~006). 기존 YR-C8-009는 구버그(중복 보너스) 단언 → 해소 룰로 기댓값 갱신.
- **연구 보고서 보존**: `docs/2026-06-15-yutnori-rule-research.md` (딥리서치 권위 룰 가이드, 향후 표준 기준).
- 회귀: 서버리스 295 + QA 엣지 26 = **321/321 PASS**(이전 315 + YR-C19 6), 봇 smoke 7/7 PASS, E2E 25 유지.
- 룰북 §13: 구현 vs 표준 차이 12건 → 미해소 6 + 해소 6 (§13-12 해소 추가).

### 2026-06-12 주요 변경 (AI 봇)

### 2026-06-12 주요 변경 (AI 봇)
- **`bot.js` 신규** — STATE 기반 상태 머신 봇(분기 응답 → 그리디 말 이동 → 던지기). matgo/janggi/yahtzee/rummikub와 동일한 `getBotUrl` + `child_process.spawn` 패턴. 강한 AI가 아니라 게임 전 흐름을 데드락 없이 완주하는 테스트용 봇.
- **`server.js`**: `getBotUrl` 옵션 + `spawnBotChild`/`killBotChild` + connection 핸들러 `mode=ai/bot/human` 파싱 + **STATE에 `capturedBonus` 필드 추가(후방 호환)**.
- **클라**: 대기 화면 `#ai-panel`("🤖 AI랑 시작") 버튼(p1+혼자 대기+mode≠ai일 때 노출), `?mode=ai` 재진입, `network.js` mode 쿼리 + sessionStorage 백업.
- **런처**: yutnori `getBotUrl` 주입, `games.json` `botAvailable: false → true`(런처 1/2 AI 모드 활성).
- **신규 `tests/bot-smoke.test.js`** (YBOT-001~005, 포트 3104).
- **간헐 데드락(HIGH) 수정**: 봇 중복 행동 방지 키에 `awaitingBranchType` 추가. 중첩 분기(corner shortcut→center 재무장) 시 키가 동일해져 봇이 2차 분기를 무시하던 영구 턴 잠금 해소.

### 2026-06-11 주요 변경
- **FIX-1** 재입장 ID 중복 데드락 수정(미사용 ID 탐색 배정).
- **FIX-2** 모서리(5/10) 외곽/지름길 선택 분기(§13-1 [HIGH] 해소). `BRANCH_REQUEST corner` + `CHOOSE_PATH outer/shortcut`. 모서리 지름길 + 중앙 통과 시 corner→center 2단계 중첩 분기 모달.
- **FIX-3** centerExitB `23→24→25→GOAL` 잔여 소진(§13-2 [HIGH] 해소). 신규 칸 24/25 활성화(`board.js buildCenterExitB`).
- **FIX-4** capturedBonus 소진 조건 정밀화(큐 빈 capturedBonus 진입 THROW에서만 소진, 윷/모 진입 시 보존).
- **§13-12** [LOW] §6-1 윷·모 잡기 중복 보너스 차단 신규 등록(2026-06-15 해소).
- **중첩 분기 결함 수정**: 모서리 지름길 진입이 중앙 통과 시 윷/모 결과 증발 HIGH 버그 → `computeNextCell` 복합 branchChoice(`shortcut-top/bottom`) + CHOOSE_PATH center 재무장.
- **룰북 §13**: 구현 vs 표준 차이 **12건** (미해소 6 + 해소 6). §13-1/§13-2 [HIGH] 본 작업 해소, §13-12 [LOW]는 2026-06-15 해소.

**Phase 2 완료** — 백도(빽도) 추가 + 룰 매핑 정정. smoke 40/40 PASS.

### Phase 2 주요 변경
- 백도(빽도): 마크 가락(0번)만 뒤집힐 때 발동 → -1칸. HOME 말 사용 불가(자동 폐기). 보너스 없음.
- `throwYutSticks` 매핑 버그 수정 (정통 룰: fronts 0→윷, 1→걸, 2→개, 3→도/백도, 4→모).
- 마크 가락 빨간 X 시각화 + 백도 결과 빨간색 칩.
- smoke 시나리오 7~9 신규 (단위 5000회 분포, computeNextCell 백도/지름길 진입, HOME 백도 차단 검증).

**Phase 1 완료** — 동작 가능한 MVP. smoke 18/18 PASS.

### 완료 항목

- ✅ 서버 권위 게임 로직 (윷 던지기, 말 이동, 잡기/업기, 지름길, 분기, 완주 판정)
- ✅ WebSocket 프로토콜 (JOIN/READY/START/STATE/THROW_YUT/MOVE_PIECE/CHOOSE_PATH/GAME_OVER/REMATCH)
- ✅ 보드 렌더링 (사각형 + 두 대각 지름길 + 중앙 "방")
- ✅ 윷가락 시각화 (Canvas, 4개 가락의 앞/뒤 색상 차이)
- ✅ 말 4×2색 렌더링 + 업힘 카운트 표시
- ✅ 결과 큐 → 클릭으로 사용할 결과 선택 → 말 클릭 이동
- ✅ 중앙 분기 모달
- ✅ AI 봇 (`bot.js`, 2026-06-12) — `mode=ai` 자동 spawn, 대기 화면 "🤖 AI랑 시작" 진입점, 런처 1/2 AI 모드
- ✅ 재대결 흐름
- ✅ tetris-battle 패턴: ANSI 콘솔 박스, LAN IP 자동 감지, 포트 3000~3010 폴백
- ✅ 친구 초대 패널 + 주소 복사 버튼 + 토스트
- ✅ `start.bat`/`stop.bat` (Windows 더블클릭, 첫 실행 시 npm install 자동)
- ✅ stop.bat은 윈도우 타이틀 기반 — tetris-battle/matgo 서버 영향 없음

### 룰 단순화 현황 (2026-06-11 갱신)

- ~~모서리에 정확히 멈춘 다음 턴은 자동 지름길 진입~~ → **2026-06-11 FIX-2로 외곽/지름길 선택 모달 적용** (§13-1 해소). 모서리(corner) + 중앙(center) 모두 분기 모달, 모서리 지름길 후 중앙 통과 시 2단계 중첩 모달.
- ~~중앙→좌하 출구는 직접 완주 처리~~ → **2026-06-11 FIX-3로 23→24→25→GOAL 잔여 소진** (§13-2 해소, 칸 24/25 활성화).
- ~~중앙 분기는 진입 경로 무관 top/bottom 자유 선택~~ → **2026-06-15 §13-6 해소**: 지름길B 경유 중앙 정착(`piece.lastPath==='shortcutB'`)은 자동 centerExitB(bottom), 지름길A 경유는 자유 선택 유지.
- ~~첫칸(cell 1) 빽도는 단순 후퇴(cell 0)~~ → **2026-06-15 §13-5 해소**: cell 1↔19 워프(done=false). HOME 빽도 자동 폐기는 유지.
- ~~백도(빽도) 변형 룰 미적용~~ → **Phase 2에서 추가** (마크 가락 0번).
- 백도(빽도) X자 표식 가락 변형 룰 미적용(현행 유지).

### 알려진 제한

- 같은 칸의 자기 말 묶음을 "업힘 1묶음"으로 시각화하지만, **이동 시에는** 같은 cell에 있는 자기 piece 인덱스 전부를 group으로 함께 이동시킴 (의도된 단순화)
- ~~§13-12 [LOW]: §6-1 윷·모로 잡으면 잡기 보너스 + 윷/모 보너스 둘 다 발생~~ → **2026-06-15 해소** (MOVE_PIECE/CHOOSE_PATH 가드로 윷·모 잡기 보너스 미부여, 도/개/걸은 +1 유지)
- HOME 영역 클릭은 좌하/우상 코너 박스 + 빈 영역 폴백으로 처리. 더 명시적인 HOME 클릭 UI는 향후 폴리시.

## 디렉토리

(상세는 `CLAUDE.md` 참조)

## 다음 단계 후보

| 우선순위 | 항목 |
|---|---|
| 중간 | 백도 변형 룰 옵션 |
| 낮음 | 던지기 애니메이션 (가락 회전 → 결과 노출) |
| 낮음 | 사운드 효과 |

## 테스트 현황 (2026-06-15)

- **봇 smoke (YBOT-001~005, 포트 3104): 7/7 PASS**: 봇 vs 봇 1판 완주 + 3판 연속 REMATCH 완주 + corner/center 분기 응답 + capturedBonus 던지기. 인라인 봇 vs 서버 spawn bot.js 대전. `node tests/bot-smoke.test.js`. §13-5/§13-6 변경 후에도 데드락 0.
- **서버리스 회귀 327/327 PASS**: 이전 321 + 신규 6건(§13-5 첫칸 빽도 워프 + §13-6 지름길B 중앙 자동 라우팅). 정책 변경 갱신 YR-C7-008·YR-C5-001·YR-C3 capture는 권위 룰로 기댓값 갱신(순증가 6).
  - 룰북 (YR-C1~C19): 룰북 §1~§13 + 부록 커버, §13 12건 커버. c15 재입장 / c16 모서리 분기(중첩 포함) / c17 centerExitB / c18 보너스 정밀화 / c19 §13-12 윷·모 잡기 중복 차단. c5 빽도(cell1↔19 워프) / c7 분기(지름길B 자동).
  - 신규 파일: `rulebook-c19-capture-bonus-no-stack.spec.js`(YR-C19 6). 기존 `qa-rulefix-edge.spec.js`(QA 엣지 26), `rulebook-c15~c18-*.spec.js`.
- **E2E 25/25 PASS**: `e2e-scenarios.spec.js` (서버 가동 시 별도 회귀).
- `tests/smoke.test.js`: 시나리오 1~8 36 assert + 모서리 분기 보조 assert, 풀 실행 **40 PASS** (레거시 유지). 8b "참고용" WS 샘플러는 환경 의존 장기 실행으로 기능 무관.

## 참조

- 사용자 문서: `README.md`
- 컨벤션: `CLAUDE.md`
- 변경 이력: `docs/CHANGELOG.md`
