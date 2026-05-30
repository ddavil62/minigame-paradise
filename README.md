# 미니게임 천국

친구랑 LAN으로 즐기는 1:1 미니게임 모음. 폴더 하나에서 `npm start` 한 번으로
**단일 포트 3000**에서 런처와 5개 게임이 모두 동작한다.

## 수록 게임

모든 게임은 단일 포트(3000)의 path 라우팅으로 서빙된다.

| 게임 | 경로 | 폴더 | 설명 | 봇 지원 |
|------|------|------|------|---------|
| 런처(로비) | `/` | `launcher/` | WS 기반 로비 + 종목 선택 메뉴 | — |
| 맞고 | `/matgo/` | `matgo/` | 2인 화투 (고스톱) | ✅ |
| 윷놀이 | `/yutnori/` | `yutnori/` | 2인 윷놀이 | ❌ |
| 테트리스 배틀 | `/tetris-battle/` | `tetris-battle/` | 한게임 스타일 1:1 테트리스 배틀 | ❌ |
| 다빈치 코드 | `/davinci-code/` | `davinci-code/` | 2인 추리 게임 | ❌ |
| 코드네임 듀엣 | `/codenames-duet/` | `codenames-duet/` | 2인 협동 워드 게임 | ❌ |

WebSocket 엔드포인트는 각 게임의 경로 하위 `ws`로 통합된다 (런처는 `/ws`, 게임은 `/{gameId}/ws`).

## 사전 조건

- Node.js 18 이상
- Windows 10/11 (다른 OS도 동작하지만 `start.bat`는 윈도우 전용)

## 실행

### 1) 의존성 설치 (최초 1회)

```bash
cd minigames
npm install
```

런처가 WebSocket을 사용하므로 루트에는 `ws`가 설치된다.
각 게임 폴더 자체의 의존성(ws, express 등)은 폴더별 `node_modules/`에 이미 포함되어 있다.

### 2) 실행

```bash
npm start
```

또는 Windows에서는 `start.bat`을 더블클릭한다.

런처 단일 프로세스(`node launcher/server.js`)가 기동되어 [http://localhost:3000](http://localhost:3000)에서 열린다.
별도의 게임 서버 프로세스나 `concurrently` 같은 멀티 런처는 더 이상 사용하지 않는다.

## 통합 라우터 구조

런처 프로세스(`launcher/server.js`)가 단일 `http.Server`를 띄우고 path 첫 segment로 HTTP/WS 요청을 각 게임 인스턴스에 분기한다.
각 게임의 `server.js`는 `createApp()` factory를 export하여 `{ handleHttp, handleUpgrade }` 인터페이스로 launcher에 연결된다.
모든 게임 상태(players, game room 등)는 `createApp()` closure로 격리되어 게임 간 상태 공유가 없다.

```
HTTP  /                  → launcher 정적 (launcher/public/)
HTTP  /{gameId}/...      → 해당 게임 정적 (각 게임의 public/)
WS    /ws                → 런처 로비
WS    /{gameId}/ws       → 해당 게임 WSS (noServer)
```

## 로비 흐름

런처는 **단일 화면 로비**로 동작한다. 접속 즉시 게임 카드 5개가 표시되며, 별도의 스타트 버튼이나 종목 선택 단계가 없다.
인스턴스 1개에 최대 **2명까지** 입장 가능하며, 먼저 접속한 사용자가 호스트가 된다.

```
접속 → 로비(WS, 카드 즉시 표시) → 호스트가 카드 클릭 → 게임 페이지로 동시 이동
                                           ↑
게임 완료 → "다른 종목" 버튼 클릭 → 양쪽 로비 복귀 ─┘
```

### 로비 화면

- 접속 즉시 "미니게임 천국" 타이틀, **플레이어 카운트**(1/2 또는 2/2), 역할(호스트/게스트)이 표시된다.
- 게임 카드 5개가 그리드로 즉시 렌더링된다.
- WebSocket으로 실시간 동기화 -- 친구가 입장하면 양쪽 화면이 즉시 2/2로 갱신된다.
- 3번째 접속자는 "현재 게임이 진행 중입니다" 안내 후 WS가 즉시 종료된다.

### 모드 자동 분기

호스트가 카드를 클릭하는 시점의 플레이어 수에 따라 모드가 **자동으로** 결정된다 (별도 모드 선택 UI 없음).

| 클릭 시 인원 | 모드 | 동작 |
|-------------|------|------|
| 1/2 | **AI 대전** | 호스트 + 봇 1명. 런처가 해당 게임의 `bot.js`를 자동으로 child_process spawn |
| 2/2 | **인간 대전** | 호스트 + 게스트. 봇 기동 없음 |

- **종목 선택은 호스트만 가능하다.** 게스트 화면은 카드에 "호스트가 선택 중..." 오버레이가 덮인다.
- 호스트가 카드를 클릭하면 양쪽 클라이언트가 즉시 해당 게임 경로(`/{gameId}/`)로 동시 이동한다 (포트 이동 없음).

### 투표 시스템

- 호스트와 게스트 모두 게임 카드의 투표 버튼을 클릭하여 선호 종목을 표현할 수 있다.
- 투표는 toggle 방식 (재클릭 시 취소)이며, 투표 수는 양쪽 화면에 실시간 갱신된다.
- 투표 결과는 정보 공유 전용이며, 자동 게임 선택 기능은 없다.

### 로비 복귀

- 5개 게임의 완료 화면에 "다른 종목" 버튼이 있다.
- 클릭 시 `POST /lobby/return` HTTP 요청이 전송되고, 서버가 양쪽에 `RETURN_LOBBY` WS 메시지를 broadcast하여 동시에 로비로 복귀한다.
- 복귀 시 서버의 votes, mode 상태가 리셋된다.

### AI 모드의 봇 미지원 게임

현재 **봇 자동 spawn은 `matgo`만 지원한다.** 나머지 4종(코드네임 듀엣, 다빈치 코드, 윷놀이, 테트리스 배틀)은 아직 `bot.js`가 없다.

- AI 대전 모드에서는 봇이 없는 카드는 **비활성 + "AI 봇 미지원" 배지**로 표시되어 선택할 수 없다.
- 인간 대전 모드에서는 모든 카드가 정상 활성화된다.
- 봇 spawn URL은 `ws://localhost:3000/{gameId}/ws` (예: `ws://localhost:3000/matgo/ws`)이다.
- 안전 가드: 런처는 spawn 직전 `fs.existsSync`로 실제 파일 존재 여부를 다시 확인한다. 누락 시 콘솔에 `[launcher] bot.js 없음, AI 봇 생략: {gameId}` 경고 출력 후 게임 페이지 이동만 정상 진행한다.

## LAN 접속

- 호스트 PC의 IP를 확인 (Windows: `ipconfig`로 IPv4 주소 확인)
- 친구는 같은 네트워크에서 `http://{호스트IP}:3000/` **단일 진입점**으로 런처에 접속
- 게스트가 입장하면 호스트 화면이 "2/2"로 갱신되고, 호스트가 게임 카드를 클릭하면 양쪽이 동시에 게임 페이지(같은 도메인의 `/{gameId}/`)로 이동한다.
- 호스트가 브라우저를 닫으면 게스트 화면이 로비로 복귀하고 게스트가 새 호스트로 자동 승격된다.
- 최초 실행 시 Windows Defender 방화벽 팝업이 뜨면 "개인 네트워크" 허용을 선택 (3000 포트 1개만 허용하면 충분)

## 개별 게임 단독 실행

각 게임 폴더에서 독립적으로 실행할 수도 있다. 이 경우 런처 로비를 거치지 않고 게임 페이지에 직접 접속한다.
standalone 실행은 게임별 기본 포트(`matgo` 3003, `yutnori` 3004 등)를 그대로 사용한다.

```bash
cd matgo
npm start
```

## 각 게임 상세 문서

- [코드네임 듀엣](./codenames-duet/README.md)
- [다빈치 코드](./davinci-code/README.md)
- [맞고](./matgo/README.md)
- [윷놀이](./yutnori/README.md)
- [테트리스 배틀](./tetris-battle/README.md)

## 종료

`npm start` 콘솔에서 `Ctrl+C`를 누르면 런처 프로세스가 종료되어 모든 게임 핸들러가 함께 정리된다.
런처가 spawn한 봇 프로세스는 `child.unref()`로 분리되어 있으므로 게임 WSS가 봇 WS를 닫을 때 자연 종료된다 (matgo bot.js는 close 시 `process.exit(0)`).

## 개발자 메모

- **단일 포트 통합 라우터**: 모든 HTTP/WS 트래픽은 launcher의 `http.Server` 하나로 들어와 path 첫 segment로 dispatch된다.
- 각 게임 `server.js`는 `createApp()` factory를 export하고 launcher가 import하여 인스턴스화한다 (`GAME_APPS` 맵).
- 각 게임의 WSS는 `new WebSocketServer({ noServer: true })`로 생성되고, launcher의 `upgrade` 이벤트에서 path 분석 후 `wss.handleUpgrade()`로 위임한다.
- 게임 상태는 `createApp()` closure에 격리되어 모듈 import만으로는 공유되지 않는다.
- standalone 실행은 `isDirectExecution()` 가드로 분기되어 단독 실행 시에만 listen 블록이 동작한다.
- 런처 정적 파일은 `launcher/public/`에 있다.
- `launcher/public/games.json`의 `botAvailable` 플래그로 AI 모드 카드 활성 여부를 제어한다. `httpPath`/`wsPath` 필드로 경로 정보를 보관하며, `port` 필드는 standalone 단독 실행용으로만 유지된다.
- 런처 WS 프로토콜: `LOBBY_STATE`(votes 포함) / `REDIRECT` / `FULL` / `RESET` / `RETURN_LOBBY` (S->C), `PICK_GAME` / `VOTE_GAME` (C->S). HTTP: `POST /lobby/return`.
- 클라이언트 WS URL은 `location.pathname` 기반으로 자동 구성된다(`/{gameId}/ws` 또는 standalone 시 `/ws`).
