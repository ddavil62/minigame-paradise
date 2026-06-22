# Spec: 미니게임 천국 캐시 버스팅 (JS/CSS/JSON no-cache)

- 날짜: 2026-06-21
- 모드: quick
- visual_change: none
- 작업 디렉토리: `C:\LazySlimeStudio\minigames`

## 목적

코드/정적 파일 배포 후 브라우저가 옛 JS/CSS/JSON을 재사용해 생기는 stale 캐시 문제를 막는다.
(실제 사건: 테트리스 봇 `network.js`가 캐시되어 봇이 안 떴음.)
일반 새로고침(F5)만으로 새 파일을 받게 한다. 하드 새로고침 불필요.

## 접근법

런처 단일 지점에서 처리한다. `launcher/server.js`의 `http.createServer` 콜백 최상단
`attachWidgetInjector(res)`가 이미 `res.writeHead/write/end`를 wrap하며 응답 content-type을
**단일 지점(`decideHtml`)에서 판정**한다(writeHead headers + Express setHeader+write/end 재판정 포함).
이 동일 지점에서 content-type이 JS/CSS/JSON일 때 `Cache-Control: no-cache`를 주입한다.

- 대상 MIME: `application/javascript`, `text/javascript`, `text/css`, `application/json`
- 제외: HTML(기존 조건부헤더 제거+위젯 주입 로직 보존), 바이너리(PNG/WOFF2/octet-stream 등)
- `no-store`가 아니라 `no-cache`(재사용 전 재검증) → Express(ETag/Last-Modified) 게임은 304 효율 유지

## 구현 상세

`launcher/server.js` `attachWidgetInjector` 내부:

1. 신규 헬퍼 `isCacheBustTarget(ct)` — content-type prefix 매칭으로 대상 4종 판정.
2. 기존 `decideHtml(ct)`의 비-HTML 분기에 `else if (isCacheBustTarget(ct) && !res.headersSent)
   res.setHeader('Cache-Control', 'no-cache')` 추가.
   - `decideHtml`은 writeHead/write/end 3경로에서 호출되는 **단일 판정 지점** → 중복 판정 신설 없음.
   - `!res.headersSent` 가드 + writeHead의 경우 `_writeHead.apply` **전에** decideHtml 호출이므로
     헤더가 응답 전송 전에 설정됨 (writeHead 명시 headers 경로 / Express 늦은 판정 경로 모두 커버).
3. HTML 조건부 헤더 제거 블록(약 268~271행) 및 위젯 주입 로직은 미수정.
4. 바이너리는 `isCacheBustTarget`이 false → 버퍼링 없이 원본 통과(현행 유지).

## 수용 기준

- 바닐라 게임 JS → `Cache-Control: no-cache`
- Express 게임 JS → `Cache-Control: no-cache` + ETag/Last-Modified 유지 + 304 동작
- CSS/JSON → `no-cache`
- PNG/바이너리 → cache-control 미부착 + 바이트 무손상
- HTML → 위젯 주입 유지 + 본문 정상(기존 동작 보존)
- 위젯 QA 7/7, 대표 게임 smoke 무영향
