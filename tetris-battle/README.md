# Tetris Battle

LAN 환경에서 2~6명이 즉시 즐길 수 있는 대전 테트리스. 한게임 테트리스 아이템전 스타일.

> Phase 1~5 완료. 코어 게임, LAN 연결, 5종 아이템, 폴리시, 더블클릭 런처, Vanish Zone 및 재대결 입력 복구까지 구현. **2026-07-20 QA PASS**.

## TL;DR — 친구가 오면

1. 호스트 PC에서 **`start.bat` 더블클릭** (PowerShell 명령 입력 불필요)
2. 새로 뜨는 콘솔 박스에서 친구용 LAN URL 확인 → 대기 화면의 **[주소 복사]** 버튼으로 친구에게 전달
3. 방에 입장한 전원이 [준비] → 현재 인원(2~6명)으로 3초 카운트다운 → 대전
4. 종료: 서버 콘솔에서 Ctrl+C 또는 **`stop.bat` 더블클릭**

---

## 빠른 시작 (Phase 4 — 더블클릭 한 방)

**가장 쉬운 방법**: 호스트 PC에서 `tetris-battle\start.bat`을 **더블클릭**하면 끝.

1. **start.bat 더블클릭** → 새 콘솔 창에서 서버 자동 기동 + 기본 브라우저에서 `http://localhost:3000` 자동 오픈.
2. 새로 뜬 서버 콘솔 창에 친구 PC용 LAN 주소가 박스로 표시됨:
   ```
   +--------------------------------------------------------+
   |  TETRIS BATTLE - LAN 1:1 대전                          |
   +--------------------------------------------------------+
   |  호스트 PC 접속:                                        |
   |    http://localhost:3000                               |
   |                                                        |
   |  친구 PC 접속:                                          |
   |    http://192.168.219.111:3000                         |
   |                                                        |
   |  종료: Ctrl+C 또는 stop.bat                            |
   +--------------------------------------------------------+
   ```
3. 호스트 브라우저의 대기 화면에 **[주소 복사]** 버튼이 있음. 클릭 → 친구 PC에 카카오톡으로 보내기 → 친구가 붙여넣기 → 자동 입장.
4. 양쪽 모두 [준비] 버튼 → 3초 카운트다운 → 대전 시작.
5. 종료: 서버 콘솔에서 Ctrl+C 또는 `stop.bat` 더블클릭.

> 포트 3000이 이미 사용 중이면 서버가 자동으로 3001, 3002... 까지 순서대로 시도합니다. 박스 안에 실제 사용 포트가 표시됩니다.

---

## 사전 준비 (최초 1회만)

### 1) Node.js 설치
[https://nodejs.org](https://nodejs.org)에서 LTS 버전(18 이상) 설치.

### 2) 의존성 설치
```powershell
cd C:\LazySlimeStudio\minigames\tetris-battle
npm install
```

### 3) Windows Defender 방화벽
`start.bat` 첫 실행 시 Node.js 통신 허용 팝업 → **개인 네트워크** 체크 → 액세스 허용.

---

## 수동 실행 (배치 파일 미사용)

```powershell
cd C:\LazySlimeStudio\minigames\tetris-battle
npm start
```

또는
```powershell
node server.js
```

포트 변경:
```powershell
node server.js --port 4000
```

### 호스트 PC 브라우저에서 접속
```
http://localhost:3000
```

### 친구 PC 브라우저에서 접속
같은 LAN에 연결된 친구 PC에서 호스트 IP로 접속합니다.
```
http://{호스트IP}:3000
```

### 양쪽 모두 [준비] 버튼을 누르면 3초 카운트다운 후 대전이 시작됩니다.

---

## 호스트 IP 확인 (Windows)

PowerShell 또는 명령 프롬프트에서:
```powershell
ipconfig
```

출력에서 "IPv4 주소" 항목을 찾습니다. 보통 `192.168.x.x` 또는 `10.x.x.x` 형태입니다.

서버 시작 시 콘솔에 표시되는 주소를 그대로 사용하는 것이 가장 편리합니다.

---

## Windows Defender 방화벽 허용

`node server.js`를 처음 실행하면 Windows 보안 경고 팝업이 뜹니다.

1. "Node.js JavaScript Runtime"이 네트워크 통신을 요청한다는 알림이 표시됩니다.
2. **"개인 네트워크"**(홈/회사) 체크박스를 켭니다.
3. "액세스 허용"을 클릭합니다.

> 팝업을 놓쳤거나 거절한 경우:
> `제어판 → Windows Defender 방화벽 → 앱 또는 기능 허용` 메뉴에서 Node.js의 "개인" 항목을 체크하세요.

라우터 측 추가 설정은 필요 없습니다 (LAN 내 통신이므로 포트 포워딩 불필요).

---

## 키 매핑

| 키 | 동작 |
|---|---|
| ← / → | 좌우 이동 (DAS 167ms, ARR 33ms) |
| ↓ | 소프트 드롭 |
| Space | 하드 드롭 |
| ↑ | 시계방향 회전 |
| Ctrl | 반시계방향 회전 |
| Shift | 홀드 |
| 1 / 2 / 3 | 해당 슬롯의 자기 대상 아이템 사용. 2인전에서는 공격 아이템도 상대에게 즉시 사용 |
| 아이템 번호 + 플레이어 번호 | 3인 이상 공격 아이템 대상 지정. 예: `14`는 1번 아이템을 4번 플레이어에게 사용 |
| 슬롯 클릭 | 해당 슬롯 아이템 사용 (마우스) |

프리즈에 걸리면 이동·회전·드롭·홀드 같은 블록 조작만 멈춥니다. 보유한 아이템은 프리즈 중에도 숫자 `1`/`2`/`3` 또는 슬롯 클릭으로 사용할 수 있습니다.

---

## 게임 규칙

- 보드 크기: 10x20
- 7-bag 랜덤 (7종 피스를 한 번씩 무작위 순서로 등장)
- Lv1 중력: 1초/줄 (레벨업마다 100ms 감소, 최소 100ms)
- 라인 클리어 10줄당 레벨 +1
- 점수: Single 100 / Double 300 / Triple 500 / Tetris 800 (× 현재 레벨)
- Lock Delay: 바닥 닿은 후 500ms, 이동/회전으로 리셋 가능 (최대 15회)

### 가비지 라인 공격

| 라인 클리어 | 상대에게 보내는 가비지 |
|---|---|
| Single | 0줄 |
| Double | 1줄 |
| Triple | 2줄 |
| Tetris | 4줄 |

연속 라인 클리어(콤보) 시 +0.5줄/콤보 추가 보너스.

가비지는 한 칸이 비어있는 회색 줄로, 한 공격 배치 내 모든 줄은 같은 위치가 비어있습니다.

### 게임 오버

- 새 피스가 스폰 위치에서 기존 블록과 겹치면 패배(토프아웃).
- 상대방 연결이 끊기면 즉시 승리 처리.

---

## 아이템 시스템 (5종)

라인을 클리어할 때마다 80% 확률로 아이템 1개가 슬롯(최대 3개)에 채워집니다. 슬롯이 꽉 차 있으면 지급되지 않습니다.

| ID | 이름 | 유형 | 효과 | 지속시간 |
|----|------|------|------|---------|
| `garbage_bomb` | 가비지 폭탄 | 공격 | 상대 보드 하단에 즉시 2줄 가비지 추가 | 즉시 |
| `dark` | 시야 가림 | 공격 | 상대 보드를 검은 오버레이로 덮음 | 5초 |
| `freeze` | 프리즈 | 공격 | 상대 블록 조작 차단 (중력은 유지) | 3초 |
| `line_clear` | 라인 클리어 | 방어 | 자신의 하단 2줄 즉시 제거 | 즉시 |
| `shield` | 방어막 | 방어 | 다음 공격 1회 무효화 (시각 피드백) | 다음 공격까지 |

방어막은 서버가 권위적으로 관리합니다. 공격을 받는 측이 방어막을 발동해 두면, 다음 공격 아이템이 서버 단에서 차단되어 양쪽 플레이어에게 `SHIELD_BLOCK` 메시지가 전달됩니다.

게임 종료와 다음 재대결 시작 시에는 프리즈 타이머, 입력 잠금, DAS/ARR 홀드 상태를 모두 초기화합니다. 따라서 프리즈 도중 라운드가 끝나도 다음 경기의 키보드 입력에는 영향을 주지 않습니다.

---

## 트러블슈팅

### "연결할 수 없습니다" 또는 페이지가 안 뜸
- 호스트 PC에서 서버가 실제로 실행 중인지 확인 (`npm start` 콘솔 확인)
- Windows Defender 방화벽에서 Node.js의 개인 네트워크 통신을 허용했는지 확인
- 두 PC가 같은 LAN(같은 공유기)에 연결되어 있는지 확인
- IP 주소를 다시 확인 (`ipconfig`)

### 입력이 끊기거나 지연됨
- 브라우저 탭이 백그라운드면 requestAnimationFrame이 느려집니다. 게임 탭을 활성 상태로 두세요.
- 다른 무거운 프로그램(예: 게임)이 같은 PC에서 실행 중이면 종료하세요.

### "Room is full" 에러
- 이미 2명이 접속 중입니다. 3번째 접속은 거절됩니다.
- 새로 접속하려면 기존 접속자가 탭을 닫아야 합니다.

### 포트 3000이 이미 사용 중
- 서버가 자동으로 3001 → 3002 → ... → 3010까지 순서대로 시도합니다.
- 박스의 `* 요청 포트 3000 사용 중 → 3001로 폴백` 라인에서 실제 포트를 확인하세요.
- 친구에게는 박스의 LAN URL을 그대로 알려주세요 (포트가 자동 반영됨).

### [주소 복사] 버튼이 동작하지 않음
- 일부 브라우저는 보안상 `navigator.clipboard.writeText`를 차단할 수 있습니다 (특히 HTTP non-localhost).
- 폴백으로 `document.execCommand('copy')`가 시도되지만, 그것도 실패하면 박스에 표시된 URL을 직접 드래그·복사해 주세요.

### start.bat 더블클릭 시 콘솔이 바로 꺼짐
- Node.js가 설치되지 않은 경우 — `where node`가 실패하면 안내 후 종료됩니다. [https://nodejs.org](https://nodejs.org)에서 LTS 설치 후 다시 시도.
- `npm install`을 한 번도 안 했을 수 있습니다 — 위의 "사전 준비" 섹션 참조.

---

## 프로젝트 구조

```
tetris-battle/
├── server.js              # Node.js WebSocket + HTTP 서버
├── package.json           # 의존성 (ws, express)
├── README.md              # 본 문서
└── public/
    ├── index.html         # 메인 HTML
    ├── css/style.css      # 색상 팔레트 + 레이아웃
    └── js/
        ├── main.js        # 진입점 + 모듈 와이어업
        ├── game.js        # 게임 루프 + 상태 머신
        ├── tetromino.js   # 7종 피스 + 7-bag
        ├── board.js       # 보드 상태 + 충돌 + 라인 제거 + 가비지
        ├── input.js       # DAS/ARR 키 입력 + 프리즈 차단
        ├── network.js     # WebSocket 클라이언트
        ├── items.js       # Phase 2: 5종 아이템 슬롯 + 효과 + 방어막
        └── ui.js          # Canvas 렌더링 + HUD + 아이템 슬롯/오버레이
```

---

## 테스트

```powershell
cd C:\LazySlimeStudio\minigames\tetris-battle
node --test tests/phase1-unit.test.js
node --test tests/phase1-ws.test.js -- --port 3055
node --test tests/phase2-items.test.js -- --port 3055
node --test tests/phase2-edge.test.js -- --port 3055
node --test tests/phase3-polish.test.js -- --port 3055
node --test tests/phase4-launcher.test.js -- --port 3055
node --test tests/phase3-4-qa-edge.test.js -- --port 3055
node --test tests/phase5-vanish-zone.test.js
node --test tests/phase5-qa-edge.test.js
node tests/input-freeze-rematch.test.js
node tests/input-freeze-rematch-independent-qa.test.js
npx playwright test tests/input-freeze-rematch.browser.spec.js --config=playwright.config.js
```

핵심 회귀 슈트와 프리즈·재대결 전용 Node/Chromium 테스트가 통과했다. WS 슈트는 동일 포트(3055)에서 순차 실행하며 각 시나리오 종료 시점에 클라이언트 소켓을 정리한다. Phase 5 슈트는 순수 단위 테스트로 포트 인자 불필요.

---

## 문서

- 프로젝트 기획서: [`docs/PROJECT.md`](docs/PROJECT.md)
- 변경 이력: [`docs/CHANGELOG.md`](docs/CHANGELOG.md)
- 작업 컨벤션 / 향후 작업 시 주의사항: [`CLAUDE.md`](CLAUDE.md)

---

## 라이선스

MIT © Lazy Slime Studio
