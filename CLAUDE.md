# 미니게임 천국

여러 LAN 멀티플레이 게임을 단일 런처에서 제공하는 Node.js 패키지다. 각 게임은 독립 실행할 수 있고, 통합 모드에서는 런처가 HTTP와 WebSocket을 한 포트로 라우팅한다.

## 먼저 확인할 것

- 게임 카탈로그의 단일 기준: `launcher/public/games.json`
- 서버 등록과 라우팅의 단일 기준: `launcher/server.js`의 `GAME_APPS`
- 게임별 규칙·테스트·함정: `{gameId}/CLAUDE.md`, `README.md`, `docs/`
- 현재 구현을 확인할 때 이 파일에 게임 목록이나 테스트 개수를 복제하지 않는다.

## 실행

```powershell
cd C:\antigravity\minigame-paradise
node launcher/server.js
```

- 통합 런처 기본 포트는 `3000`이다.
- 개별 게임은 해당 디렉터리에서 `node server.js --port <격리 포트>`로 실행한다.
- 테스트 서버는 사용자 런처와 다른 포트를 사용한다.

## 접속 정책

- 실제 친구 접속의 단일 진입점은 `https://112.155.2.238`이다. 같은 공유기 안에서도 이 공인 IP HTTPS 주소를 사용한다.
- 친구에게 `http://{호스트IP}:3000`, `192.168.x.x:3000`, 개별 게임 포트를 안내하지 않는다.
- 포트 `3000`은 Caddy가 `127.0.0.1:3000`으로 전달하는 내부 업스트림과 서버 PC의 개발·점검에만 사용한다. Windows 방화벽의 인바운드 차단을 해제하거나 공유기에 포워딩하지 않는다.
- 공개 운영은 `start-public.ps1` 또는 `start-public.bat`으로 시작하며 공통 비밀번호 인증과 HTTPS를 유지한다. 자세한 절차는 `docs/REMOTE-ACCESS.md`를 따른다.

## 통합 구조

- `launcher/server.js`
  - `/{gameId}/...`를 각 게임의 `handleHttp`로 전달한다.
  - `/{gameId}/ws`를 각 게임 WebSocket 서버로 전달한다.
  - `/lobby/ws?gameId={gameId}`는 게임별 대기실을 제공한다.
  - `GAME_MANAGED_AI_IDS`에 포함된 게임은 게임 서버가 AI 수명주기를 관리한다.
- `launcher/public/games.json`
  - 이름, 설명, 인원, 경로, 키아트 등 런처 표시 메타데이터를 관리한다.
  - 게임 추가·삭제 시 `GAME_APPS` 등록과 함께 갱신한다.
- `launcher/public/app.js`
  - 포탈, 대기실, 준비 상태, AI 채우기와 게임 이동을 담당한다.
- `launcher/public/bug-widget.js`
  - 게임 페이지에 공통 신고 UI를 주입하고 `/bug-report`로 전송한다.

## 변경 규칙

- 게임을 추가하거나 제거할 때 다음을 함께 확인한다.
  - `launcher/public/games.json`
  - `launcher/server.js`의 import, `GAME_APPS`, AI 관련 집합
  - HTTP 경로와 WS 경로
  - 게임별 `CLAUDE.md` 또는 `README.md`
- 개별 게임의 룰과 프로토콜을 루트 문서에 다시 서술하지 않는다. 링크와 한 줄 역할만 둔다.
- 게임 서버는 통합 모드와 단독 모드에서 모두 동작해야 한다.
- AI 자식 프로세스는 사람 이탈, 게임 종료 정책과 서버 종료 시 정리되어야 한다.
- 룸 정원, 준비 상태, 리디렉션 경로는 `games.json`의 인원 설정과 일치해야 한다.
- 사용자 노출 텍스트를 바꾸면 한국어·영어 메타데이터와 관련 테스트를 함께 확인한다.

## 테스트

- 게임 로직 변경은 해당 게임 문서가 지정한 최소 회귀 테스트부터 실행한다.
- 런처 변경은 포탈 로딩, 대기실 입퇴장, READY, AI 채우기, 게임 리디렉션을 확인한다.
- UI 변경은 데스크톱과 작은 뷰포트에서 실제 렌더링을 확인한다.
- 고정된 PASS 개수는 문서에 기록하지 않는다. 테스트 파일과 현재 실행 결과를 기준으로 판단한다.

## 문서 관리

- `docs/PROJECT.md`: 현재 통합 구조와 운영 방식
- `docs/CHANGELOG.md`: 사용자에게 의미 있는 변경 이력
- 날짜별 구현 과정과 QA 횟수는 Git과 변경 이력에 두고 이 파일에는 누적하지 않는다.
