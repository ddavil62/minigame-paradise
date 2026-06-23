# Implementation Report: 접속 플로우 재설계 페이즈1 (로비 공통부)

## 작업 요약
런처 로비에 닉네임 입장 게이트 + 접속자 presence 목록 + 입장/퇴장 토스트를 추가하고,
로비 WS 프로토콜에 `JOIN{name}`(C→S) · `LOBBY_STATE.players` 확장 · `PLAYER_JOINED`/`PLAYER_LEFT`(S→C)를 신설했다.
오목/게임 방(페이즈2)은 손대지 않았다. 기존 PICK_GAME/VOTE_GAME/REDIRECT/FULL/RESET/RETURN_LOBBY 동작은 후방호환으로 보존했다.

## 변경된 파일
| 파일 경로 | 작업 유형 | 변경 내용 (핵심 라인) |
|---|---|---|
| `launcher/server.js` | 수정 | clients Map value에 `name:string\|null` 추가 (L406~414). connection 시 `name:null` 초기화 (L615). `sendLobbyStateTo`에 `players:[{id,name,role,online}]` 배열 추가 (L471~485, 기존 count/role/hostId/mode/votes 유지). `handleMessage`에 `JOIN` 케이스 추가 — name trim/slice(0,12) + 폴백 '(알 수 없음)' + 자신 제외 `PLAYER_JOINED` broadcast + `broadcastLobbyState()` (L543~558). `ws.on('close')`에서 `PLAYER_LEFT` broadcast 삽입 (L640~641) |
| `launcher/public/index.html` | 수정 | `#nickname-gate` 게이트 화면(닉네임 input + 입장 버튼 + 에러 영역)을 `#lobby-view` 앞에 추가. `#lobby-view`에 `hidden` 클래스 부여(게이트 선행). `.lobby-meta` 내부에 `#presence-list` 추가. `</body>` 앞 `#lobby-toast` 컨테이너 추가 |
| `launcher/public/app.js` | 수정 | `NICKNAME_KEY='minigames:nickname'` + `myName` 모듈 변수 추가. `setupNicknameGate()`(localStorage pre-fill + 1~12자 검증 + 저장) / `enterLobby()`(게이트 숨김→로비 표시→`connectWS`) 신설. `init()`이 게이트 먼저 표시(WS/JOIN 보류). `connectWS` open 콜백에서 `JOIN{name}` 송신. `onMessage`에 `PLAYER_JOINED`/`PLAYER_LEFT` 케이스(토스트). `updateLobbyUI`가 `msg.players`로 `renderPresence` 호출. `renderPresence()`/`showLobbyToast()` 신설. `handleRedirect`에 `&name=` 쿼리 append |
| `launcher/public/style.css` | 수정 | `.nickname-gate-view`/`.nickname-card`/`#nickname-input`/`#btn-enter-lobby`/`.nickname-error`(게이트), `.presence-list`/`.presence-item`/`.presence-dot`/`.presence-name`(접속자 목록), `.lobby-toast`(토스트) 스타일 추가. 기존 로비 우드/네이비+골드 톤 일관, prefix 충돌 없음(`.bw-`·게임 전역과 분리) |
| `tests/lobby-presence-e2e.spec.js` | 신규 | Playwright E2E 6 케이스(아래 결과 참조). 격리 포트 3091에 런처를 spec 내부 spawn(사용자 3000/MCP node 미접촉), afterAll에서 kill |

## WS 프로토콜 변경 (로비 `/ws`)
| 방향 | 메시지 | 페이로드 | 비고 |
|------|--------|---------|------|
| C→S | `JOIN` | `{ name }` | 신규. 게이트 통과 후 WS open 시 송신. name 누락 시 서버 '(알 수 없음)' 폴백 |
| S→C | `LOBBY_STATE` | `{ count, role, hostId, mode, votes, players:[{id,name,role,online}] }` | **기존 필드 전부 유지** + `players` 배열 추가(후방호환) |
| S→C | `PLAYER_JOINED` | `{ name, role }` | 신규. JOIN 수신 시 자신 제외 기존 접속자에게 broadcast(입장 토스트) |
| S→C | `PLAYER_LEFT` | `{ name }` | 신규. WS close 시 잔여 접속자에게 broadcast(퇴장 토스트) |

## 스펙 대비 구현 상태 (페이즈1 한정)
- [x] 로비 진입 시 닉네임 게이트 표시(WS 연결/JOIN 게이트 통과 전 차단)
- [x] 닉네임 입력 후 입장 → localStorage `minigames:nickname` 저장 → WS 연결 → `JOIN{name}` 송신
- [x] 재방문 시 localStorage 닉네임 자동 pre-fill
- [x] 서버 clients Map에 `name` 필드 추가(초기 null)
- [x] `LOBBY_STATE.players:[{id,name,role,online}]` 추가(기존 필드 유지)
- [x] `PLAYER_JOINED{name,role}` / `PLAYER_LEFT{name}` S→C broadcast
- [x] 로비 상단 `#presence-list`(이름 + 🟢) 실시간 렌더(새로고침 불필요)
- [x] 입장/퇴장 토스트(2.5초 자동 소멸)
- [x] JOIN 미수신 폴백 '(알 수 없음)' — 기존 테스트가 JOIN 안 보내도 서버 무손상
- [x] 닉네임 12자 제한 + 공백 trim + 빈 문자열 제출 차단
- [x] 기존 PICK_GAME/VOTE_GAME/REDIRECT/FULL/RESET/RETURN_LOBBY 동작 보존
- [x] REDIRECT URL에 `&name=` 쿼리 추가(페이즈2 닉네임 전달 준비 — 포크 A)
- (페이즈2 항목: 오목 READY/상대이름/이탈 배너/봇 READY 등 — **범위 외, 미착수**)

## 빌드/린트 결과
- 구문 검사: `node --check launcher/server.js` PASS, `node --check launcher/public/app.js` PASS
- 린트: 별도 린터 미구성(프로젝트에 lint 스크립트 없음) — N/A
- 빌드: 번들 없음(바닐라 JS) — N/A

## 테스트 결과
### 신규 E2E (`tests/lobby-presence-e2e.spec.js`, 격리 포트 3091) — **5/5 PASS**
- CF-01: 게이트 표시 + 빈 입력 차단(에러 메시지) + 입장 후 로비 전환 + 본인 presence 표시 — PASS
- CF-02/CF-04: ctx1 입장 후 ctx2 입장 시 ctx1 목록에 **새로고침 없이** ctx2 이름 추가 + **입장 토스트**, ctx2 종료 시 ctx1 **퇴장 토스트** + 목록 제거 — PASS (요구 시나리오 a/b 충족)
- CF-03: localStorage 재방문 닉네임 자동 pre-fill — PASS (시나리오 c)
- CF-10: 닉네임 12자 초과 trim(maxlength + 서버 slice) — PASS
- CF-REG: 단독 입장 → omok 카드 클릭 → REDIRECT URL에 `mode=ai&name=...`(닉네임 포함) 정상 — PASS

### 기존 회귀 — 무영향 확인
- `tests/bug-report-widget-qa.spec.js` (격리 포트 3092 런처): **7/7 PASS**
- `omok/tests/smoke.test.js` (포트 3105, 오목 단독): **106/106 PASS** (페이즈1은 omok 미수정 — 교차 영향 0)
- 대표 게임 진입(REDIRECT): CF-REG에서 `/omok/?mode=ai&name=...` 이동 검증 PASS

### 기존 stale 테스트 (페이즈1과 무관, 사전 결함)
- `tests/single-port-qa.spec.js`: 16 PASS / 2 FAIL — 둘 다 **사전 stale**(내 변경과 무관):
  - "games.json → 5개 게임" — 현재 게임 10종이므로 `length===5` 단언이 stale (master에서도 실패)
  - "yutnori WS 연결 로그" — yutnori 클라이언트 console 로그 타이밍 단언(로비 presence 코드 미접촉)
- `tests/lobby-flow-smoke.spec.js`: 미실행 — `#start-btn`/`#game-select-view` 등 폐기된 DOM 참조(과거 2단계 종목 선택 UI 기준)로 현 단일 로비 구조에서 이미 동작 불가한 stale 자산. 페이즈1 변경과 무관.

## 테스트 서버/포트 정리
- spec 내 spawn 런처(3091/3093/3094) afterAll kill 확인 — 전부 down
- 회귀용 3092 런처 종료 확인 — down
- **사용자 3000 런처 보존** — 200 alive 확인
- **MCP node 보존** — 미접촉(3091~3094만 사용, 종료)
- `test-results/` 임시 디렉토리 삭제 완료

## Art Director 후속 조치
- visual_change: **ui**
- AD 모드 2 필요 여부: **아니오** — 외부 이미지 에셋 생성/교체 0건(CSS/HTML 전용, 점·이모지는 텍스트 글리프)
- AD 모드 3 필요 여부: **예** — 닉네임 게이트 화면, presence 목록(이름+🟢), 로비 토스트의 신규 UI 레이아웃 추가
- **이 항목이 "예"이므로 QA 진행 전 AD 모드3(로비 UI 검수)를 반드시 거쳐야 한다.** (스펙 §Art Director 실행 계획 — 페이즈1 완료 후 AD 모드3 실행 명시)
- AD3 검수 참고 산출물:
  - `tests/screenshots/lobby-nickname-gate.png` — 닉네임 게이트 화면
  - `tests/screenshots/lobby-presence-join.png` — presence 2명 + 입장 토스트

## 알려진 이슈
- 없음. (페이즈1 범위 내 결함 0)
- 주의: `#player-count`의 초기 HTML 텍스트가 "1/2"로 하드코딩돼 있어, E2E에서 입장 완료 판정은 `#player-count` 텍스트가 아닌 `#presence-list`에 본인 이름이 렌더되는지로 대기해야 신뢰성 있음(테스트에 반영 완료).

## QA 참고사항
- 격리 포트로 별도 런처 기동 가능: `node launcher/server.js --port 3091` (런처는 `--port` 인자 지원, 사용자 3000 미접촉).
- E2E는 spec 내부에서 런처를 spawn하므로 사전 서버 기동 불필요(`npx playwright test tests/lobby-presence-e2e.spec.js`).
- presence 실시간 갱신 핵심 AC: ctx2 입장/퇴장 시 ctx1이 **새로고침 없이** 목록·토스트 반영(CF-02/CF-04로 커버).
- 후방호환 가드: JOIN을 보내지 않는 클라이언트도 LOBBY_STATE.players에 `name:null`(렌더 시 '(입장 중...)')로 표시되며 서버 무손상.
- 페이즈2(오목 READY/상대이름/이탈 배너/봇 READY)는 별도 발주로 미착수 — 이번 QA 범위에서 제외.
