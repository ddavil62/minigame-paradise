# Tetris Battle — 프로젝트별 작업 컨벤션

> LAN 1:1 한게임 테트리스 스타일 대전. Node.js + 바닐라 JS. Phase 1~5 완료, 337/337 PASS.

## 정체성

- **목적**: 친구가 놀러 왔을 때 LAN으로 즉시 즐기는 1:1 테트리스
- **레포 관리**: lazyslimestudio 하위 폴더(`tetris-battle/`)로 관리 (별도 git 분리 안 함)
- **기술**: Node 18+ (ESM), Express 4, ws 8, 바닐라 JS (프레임워크 0), HTML5 Canvas
- **외부 에셋**: 없음 — 모든 시각은 CSS/Canvas로 표현

## 핵심 설계 원칙 (변경 시 주의)

1. **클라이언트 권위 + 서버 중계**
   - 게임 시뮬레이션은 각 클라이언트가 로컬에서 처리한다 (입력 지연 최소화)
   - 서버는 가비지/아이템/게임오버만 중계한다. 보드 전체 상태를 매 tick 브로드캐스트하지 않는다
   - 사용자(격투게임 프로 출신)가 입력 지연에 매우 민감 — 키 입력 → 화면 반영은 항상 로컬에서 즉시
2. **방어막은 서버 권위**
   - `player.shieldActive`는 서버 상태. 클라가 우회할 수 없게 서버가 차단 결정
   - SHIELD_BLOCK은 양쪽에 broadcast (송신자도 차단 인지)
3. **신뢰 환경 (LAN, 친구 대전)**
   - 치팅 방지/서버 검증은 Out of Scope. 입력 클램프(0~20 라인, 0~99 콤보)만 안전망으로 유지
4. **포트 충돌 자동 폴백**
   - 3000~3010 자동 시도. `wss = new WebSocketServer({ server })`가 HTTP server를 공유하므로 EADDRINUSE 시 **양 채널에 error 핸들러 필수** (revise1에서 수정한 함정)

## 디렉토리

```
tetris-battle/
├── server.js                 # 백엔드 진입점
├── start.bat / stop.bat      # Windows 더블클릭 런처
├── package.json
├── README.md                 # 사용자 대상 (실행법/규칙/트러블슈팅)
├── CLAUDE.md                 # 본 문서 (에이전트 대상)
├── docs/
│   ├── PROJECT.md            # 현재 상태 스냅샷 (200줄 이내 유지)
│   └── CHANGELOG.md          # Phase별 상세 이력
├── public/
│   ├── index.html
│   ├── css/style.css
│   └── js/*.js               # main/game/tetromino/board/input/network/items/ui
└── tests/
    ├── phase1-unit.test.js
    ├── phase1-ws.test.js
    ├── phase2-items.test.js
    ├── phase2-edge.test.js
    ├── phase3-polish.test.js
    ├── phase4-launcher.test.js
    ├── phase3-4-qa-edge.test.js   # QA 영구 회귀 차단 슈트
    ├── phase5-vanish-zone.test.js # Phase 5 Vanish Zone 회귀
    └── phase5-qa-edge.test.js     # QA 영구 회귀 차단 슈트 (Vanish Zone 엣지)
```

## 테스트 실행법

WS 슈트는 `--port`로 격리된 포트(예: 3055)에서 실행. 슈트별로 끝에 소켓 정리(`a.close(); b.close(); await sleep(150);`)가 포함되어 같은 포트에서 순차 실행 가능.

```powershell
cd C:\LazySlimeStudio\tetris-battle
node --test tests/phase1-unit.test.js
node --test tests/phase1-ws.test.js -- --port 3055
node --test tests/phase2-items.test.js -- --port 3055
node --test tests/phase2-edge.test.js -- --port 3055
node --test tests/phase3-polish.test.js -- --port 3055
node --test tests/phase4-launcher.test.js -- --port 3055
node --test tests/phase3-4-qa-edge.test.js -- --port 3055
node --test tests/phase5-vanish-zone.test.js
node --test tests/phase5-qa-edge.test.js
```

전체 합계: **337/337 PASS**.

### 회귀 게이트
- 어떤 변경도 위 9 슈트가 337/337 PASS를 유지해야 한다.
- 신규 기능 추가 시 신규 슈트를 작성하되 기존 슈트는 절대 수정/삭제하지 않는다 (영구 회귀 차단용).
  - 예외: **사용자 승인 기능 제거**로 단언 대상 자체가 사라진 경우(예: 2026-06-17 C 작업 — invite-panel/copy 버튼 제거)는 해당 단언을 "제거됨을 검증하는 positive 단언"으로 전환한다(`phase4-launcher.test.js` L4/L4b/L5/L7a~c/L7e). 회귀게이트 정신(되살아나면 실패)은 유지된다.
- `phase3-4-qa-edge.test.js`는 QA에서 발견한 결함(Q1 포트 폴백 등)을 영구 차단하는 슈트 — 특히 보존.
- `phase5-qa-edge.test.js`는 사용자 신고 버그(visible top 가득 시 게임오버) 재현 시나리오(QE3) 포함 — 특히 보존.

## 코드 컨벤션

- **언어**: 한국어 UI + 한국어 주석/문서
- **모듈**: ES Modules (`"type": "module"`)
- **외부 라이브러리**: 클라이언트는 0 (바닐라 JS), 서버는 ws + express만
- **주석**: `@fileoverview` + JSDoc + `// ── 섹션 ──` 구분
- **린트**: 별도 도구 없음 (정책상 JSDoc/한국어 주석 준수 = 통과)
- **i18n**: 현재는 한국어 단일 — 향후 영어 추가 시 `js/i18n.js` 생성 검토

## 파이프라인 적용 규칙

- **`visual_change: ui`**가 기본 (CSS/Canvas 변경이 잦음). UI 변경 시 **AD 모드3 필수**.
- **`visual_change: art`는 발생하지 않음** (외부 이미지 에셋 사용 금지 정책). 따라서 AD 모드1/2 생략 가능.
- **순수 백엔드 변경** (예: server.js 단독)은 `visual_change: none` 가능 → AD3 생략 가능.
- **`pipeline: full`**가 기본 (다중 파일 + WS 프로토콜 영향). 단일 수치 조정만이면 `quick` 허용.

### 멀티 페이즈 작업
- Phase별로 AD3를 **매번 독립 실행**. 이전 페이즈 AD APPROVED를 다음 페이즈에 재사용 금지.

## 변경 시 자주 깨지는 함정

| 항목 | 함정 |
|---|---|
| `wss = new WebSocketServer({ server })` | server와 wss 양쪽에 error 핸들러 필요. wss에만 또는 server에만 등록하면 EADDRINUSE 시 unhandled로 즉시 종료. |
| 콤보 시작값 | `combo = -1`. 첫 클리어 = 0 (보너스 0), 두 번째 연속 = 1 (보너스 +1). 변경 시 `phase1-unit` 가비지 보너스 회귀 실패 |
| 가비지 hole 위치 | 한 공격 배치(2~4줄)는 **모든 줄이 같은 칸** 비어있어야 함. 줄마다 다른 hole이면 의도와 다름 |
| 다크/프리즈 setTimeout | `items.reset()`에서 반드시 clearTimeout — 안 그러면 게임오버 후 잔존 |
| 슬롯 클릭 차단 | 프리즈 중에는 `useItem()` 진입부에서 `deps.input.isFrozen()` 검사 필요 |
| 카운트다운 펄스 | `runCountdown()` + `triggerCountdownPulse()` 분리. 펄스 클래스는 animationend에서 cleanup |
| `start.bat` 인코딩 | ASCII-only로 유지. 한글 포함 시 cmd 949 코드페이지에서 깨짐. `chcp 65001`은 콘솔만 UTF-8로 전환 |
| `stop.bat` 포트 범위 | server.js `MAX_PORT_FALLBACK = 10`과 `for %%P in (3000 ... 3010)` 범위 일치 유지 |
| `BOARD_HEIGHT=22` vs `VISIBLE_HEIGHT=20` | 데이터 영역 22, 시각 영역 20, 차이 = `VANISH_ZONE=2` (hidden zone). 렌더링/미니맵/그리드 라인은 **visible만**, `isColliding`/`lockPiece`/`clearLines`/`addGarbage`는 **데이터 영역 전체**. 두 값을 혼동해 렌더링에 `BOARD_HEIGHT`를 쓰면 캔버스 크기가 660px로 늘어나거나 hidden zone이 노출됨. 좌표 변환은 `(gridRow - VANISH_ZONE) * CELL_SIZE`, hidden zone 셀은 `gy < 0` 가드로 스킵 |

## 향후 작업 시 우선순위

| 우선순위 | 항목 | 비고 |
|---|---|---|
| 낮음 | SRS 벽킥 + T-spin 감지 + PC 보너스 | 가비지 변환표 확장 필요 |
| 낮음 | 단일 `.exe` 빌드 (pkg / Node SEA) | 친구 PC에 Node 없을 때만 |
| 낮음 | macOS/Linux 셸 스크립트 | `start.sh` |
| 낮음 | 옵저버 모드 | 현재 2인 1룸 고정 |

## Mockup Sync

- 외부 이미지 에셋이 없으므로 `studio-mockup` 동기화 **불필요** (정책: 에셋 변경 시에만 동기화).
- 본 프로젝트는 `assets/` 디렉토리 자체가 없다.

## 참조

- 사용자 문서: `README.md`
- 현재 상태: `docs/PROJECT.md`
- 변경 이력: `docs/CHANGELOG.md`
- 파이프라인 산출물: `C:\LazySlimeStudio\.claude\specs\2026-05-25-tetris-battle-*.md`
