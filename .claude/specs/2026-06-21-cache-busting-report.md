# Implementation Report: 미니게임 천국 캐시 버스팅 (JS/CSS/JSON no-cache)

## 작업 요약

런처 `attachWidgetInjector`의 단일 content-type 판정 지점(`decideHtml`)에서, 응답이
JS/CSS/JSON일 때 `Cache-Control: no-cache`를 주입하도록 확장했다. HTML·바이너리는 무영향.
배포 후 F5만으로 새 정적 파일을 받는다(stale 캐시 방지).

## 변경된 파일

| 파일 경로 | 작업 유형 | 변경 내용 |
|---|---|---|
| `launcher/server.js` (L182~213) | 수정 | `attachWidgetInjector` 내부에 헬퍼 `isCacheBustTarget(ct)` 신설 + `decideHtml`의 비-HTML 분기에 JS/CSS/JSON → `res.setHeader('Cache-Control','no-cache')` (`!res.headersSent` 가드) 추가 |

핵심 라인:
- `isCacheBustTarget`: `application/javascript`/`text/javascript`/`text/css`/`application/json` prefix 매칭.
- `decideHtml`: `else if (isCacheBustTarget(ct) && !res.headersSent) res.setHeader('Cache-Control', 'no-cache');`
- `decideHtml`은 `writeHead`(명시 headers 경로) / `write` / `end`(Express 늦은 판정) 3경로에서
  호출되는 단일 판정 지점 — 중복 판정 신설 없음, 위젯 주입 로직과 동일 패턴.

미수정(보존): HTML 조건부헤더 제거 블록(L268~271), 위젯 주입(`</body>` 삽입), 바이너리 통과.

## curl 헤더 검증 결과 (임시 런처 포트 3130, 사용자 3000 미접촉)

| 케이스 | 경로 | 결과 |
|---|---|---|
| 바닐라 게임 JS | `/omok/js/main.js` | 200 + `Cache-Control: no-cache` (ct: application/javascript) PASS |
| Express 게임 JS | `/tetris-battle/js/network.js` | 200 + `Cache-Control: no-cache` + `ETag` + `Last-Modified` 유지 PASS |
| Express 304 | `/tetris-battle/js/network.js` (If-None-Match) | 304 Not Modified (재검증 동작 정상) PASS |
| CSS | `/omok/css/style.css` | 200 + `Cache-Control: no-cache` PASS |
| JSON | `/games.json` | 200 + `Cache-Control: no-cache` PASS |
| JSON (writeHead 명시 headers 경로) | `POST /bug-report` (text 누락→400) | 400 + `Cache-Control: no-cache` (ct: application/json) PASS |
| 바이너리 PNG | `/matgo/assets/cards/m01_gwang.png` | 200, ct: application/octet-stream, **cache-control 미부착** PASS |
| 바이너리 PNG | `/hanabi/assets/guide/1.png` | 200, ct: image/png, **cache-control 미부착** + 바이트 동일(820205B, cmp IDENTICAL) PASS |
| HTML | `/tetris-battle/` | 200 + 위젯 스니펫(`bug-widget.js`)·`</body>` 주입 유지 + 본문 정상(chunked, 4959B), HTML 자체 Cache-Control은 Express 기본(`public, max-age=0`) 미변경 PASS |

비고: Express 304 응답은 본문(content-type)이 없어 우리 판정이 발화하지 않으므로 Express 기본
`public, max-age=0`이 보이나, 200 응답에 `no-cache`가 붙어 브라우저가 재검증→304를 받는 흐름이라
의도된 동작. HTML은 스펙대로 손대지 않아 기존 동작 보존.

## 스펙 대비 구현 상태

- [x] JS/CSS/JSON에 `no-cache` 주입 (단일 판정 지점 재사용, 중복 판정 신설 없음)
- [x] HTML 제외(기존 조건부헤더 제거+위젯 주입 보존)
- [x] 바이너리 무영향(cache-control 미부착 + 바이트 무손상)
- [x] `no-store`가 아닌 `no-cache` 사용 → Express 304 효율 유지
- [x] 헤더 전송 전 setHeader(`!res.headersSent` 가드, writeHead 전 호출)
- [x] 위젯 주입 wrap과 충돌 없음 (동일 함수 내 동일 패턴)

## 빌드/린트 결과

- 모듈 로드(node import): PASS (EADDRINUSE는 사용자 3000 런처 보존 의도, 문법 정상)
- 린트: N/A (프로젝트 린트 스크립트 없음 — 바닐라 JS)

## 회귀 결과

- 위젯 QA `tests/bug-report-widget-qa.spec.js` (Playwright, 포트 3092): **7/7 PASS**
- omok smoke `omok/tests/smoke.test.js`: **106/106 PASS**
- tetris-battle bot-smoke `tetris-battle/tests/bot-smoke.test.js`: **8/8 PASS**

## Art Director 후속 조치

- visual_change: none
- AD 모드 2 필요 여부: 아니오 — 에셋 생성/교체 없음
- AD 모드 3 필요 여부: 아니오 — UI 레이아웃 변경 없음(HTTP 응답 헤더만 변경)

## 알려진 이슈

- 없음.

## QA 참고사항

- 정적 서빙 응답 헤더만 변경 — 게임 로직/WS 프로토콜 무관.
- 검증 시 임시 런처는 `--port`로 격리(예 3130/3092), 사용자 3000 런처·MCP node는 보존.
- 임시 런처 종료 완료(3130/3092 down, 3000 alive 확인).
- 커밋하지 않음(사용자 지시).
