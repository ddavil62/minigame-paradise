# Implementation Report: hanabi E2E 테스트 READY 게이트 적용

## 작업 요약
hanabi E2E 브라우저 테스트 6개 파일(c8~c12)에 동적 포트 자체 서버 생성(createApp) + READY 게이트(btn-ready 클릭) + ?name= 쿼리 파라미터를 적용하여, 외부 서버 사전 구동 없이 테스트가 독립 실행되도록 수정했다.

## 변경된 파일
| 파일 경로 | 작업 유형 | 변경 내용 |
|---|---|---|
| `hanabi/tests/rulebook-c8-e2e-browser.spec.js` | 수정 | 서버 헬퍼(startServer/stopServer) + beforeAll/afterAll 추가, `const BASE` -> `let BASE`, joinAndReady 헬퍼 추가, goto URL에 ?name= 쿼리 추가, READY 버튼 클릭 게이트 추가 |
| `hanabi/tests/rulebook-c9-e2e-actions.spec.js` | 수정 | 서버 헬퍼 + beforeAll/afterAll 추가, joinTwo에 ?name=P1/P2 + READY 게이트 추가 |
| `hanabi/tests/rulebook-c10-e2e-gameover.spec.js` | 수정 | 서버 헬퍼 + beforeAll/afterAll 추가, HR-C10-001에 ?name= + READY 게이트 추가 |
| `hanabi/tests/rulebook-c11-guide-slider.spec.js` | 수정 | 서버 헬퍼 + beforeAll/afterAll 추가, openWaiting에 ?name=P1 + READY 클릭 추가, HR-C11-007에 p1/p2 ?name= + READY 게이트 추가(슬라이더 조작 후 p2 합류 순서 유지), HR-C11-008 동적 BASE 사용 |
| `hanabi/tests/rulebook-c11b-guide-modal.spec.js` | 수정 | 서버 헬퍼 + beforeAll/afterAll 추가, openPage에 ?name=P1 + READY 클릭 추가 |
| `hanabi/tests/rulebook-c12-counter.spec.js` | 수정 | 서버 헬퍼 + beforeAll/afterAll 추가, joinTwo에 ?name=P1/P2 + READY 게이트 추가 |

## 스펙 대비 구현 상태
- [x] c8: 서버 헬퍼 + joinAndReady 헬퍼 + READY 게이트 적용
- [x] c9: joinTwo에 READY 게이트 적용
- [x] c10: HR-C10-001에 READY 게이트 적용
- [x] c11: openWaiting에 READY 게이트 + HR-C11-007 p1 READY -> 슬라이더 조작 -> p2 합류 READY 순서 적용
- [x] c11b: openPage에 READY 게이트 적용
- [x] c12: joinTwo에 READY 게이트 적용
- [x] 각 파일 @fileoverview의 사전 요건을 "없음 -- createApp()으로 동적 포트에서 자체 서버를 생성한다."로 갱신
- [x] c1~c7 테스트 무수정 (이미 완료)
- [x] 테스트 본문 로직(assertions, actions) 무변경 (goto+READY gate 제외)

## 빌드/린트 결과
- 빌드: N/A (바닐라 JS, 빌드 단계 없음)
- 린트: N/A (린터 미설정)
- 테스트: **78/78 PASS** (c1-c5 unit 31 + c6 WS 7 + c7 QA edge 8 + c8 E2E 2 + c9 E2E 3 + c10 E2E 1 + c11 guide slider 9 + c11b guide modal 8 + c12 counter 9)

## Art Director 후속 조치
- visual_change: none
- AD 모드 2 필요 여부: 아니오 -- 에셋 생성/교체 작업 없음
- AD 모드 3 필요 여부: 아니오 -- UI 레이아웃 변경 없음

## 알려진 이슈
- 없음

## QA 참고사항
- 이제 E2E 테스트(c8~c12)도 외부 서버 사전 구동 없이 `npx playwright test` 한 번으로 전체 78개가 실행된다.
- 기존 `node server.js --port 3095` 사전 구동 요구사항이 제거되었다.
- 각 테스트 파일이 beforeAll에서 동적 포트(port 0)로 자체 서버를 띄우고 afterAll에서 정리한다.
- READY 게이트 흐름: goto(?name=P1) -> waitForSelector(#btn-ready:not([hidden])) -> click(#btn-ready) -> waitForSelector(#my-hand .card) 순서.
