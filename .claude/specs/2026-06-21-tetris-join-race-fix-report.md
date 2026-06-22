# Implementation Report: 테트리스 배틀 JOIN 레이스 컨디션 수정 + 회귀 게이트

- 날짜: 2026-06-21
- 스펙: `.claude/specs/2026-06-21-tetris-join-race-fix-spec.md`

## 작업 요약

이미 적용·검증된 `network.js` JOIN 레이스 수정(open 핸들러에서 `pendingJoinName`으로 JOIN 전송)을 박제하기 위해 Playwright E2E 회귀 슈트(`ai-mode-e2e.spec.js`)를 신설하고, CLAUDE.md에 함정/테스트 항목을 추가했다. 코드(`network.js`) 변경은 없다(정독만).

## 증상 / 근본 원인 / 수정 요약

- 증상: 진입 시 "서버 연결 중" 고착, 준비 눌러도 시작 안 됨, AI 모드에서 봇 미spawn, 콘솔 `[net] 연결되지 않은 상태에서 전송 시도: JOIN` 경고. 레이스라 간헐적.
- 근본 원인: `main.js`가 `setTimeout(300)`으로 `net.join()` 호출 → WS open 전이면 `send()`가 `readyState!==OPEN`이라 JOIN 드롭 → 서버 JOINED 미응답 + 봇 spawn(JOIN 핸들러 트리거) 미발생.
- 수정(기적용): `network.js`에 `pendingJoinName` 보관 + WS `open` 핸들러에서 JOIN 확실 전송. 재연결 재JOIN도 동일 경로로 해결.

## 변경된 파일

| 파일 경로 | 작업 유형 | 변경 내용 |
|---|---|---|
| `tetris-battle/public/js/network.js` | 수정(기적용, 본 작업서 무변경) | `pendingJoinName` + open 핸들러 JOIN. 정독만 함 |
| `tetris-battle/tests/ai-mode-e2e.spec.js` | 신규 | JOIN 레이스 회귀 E2E (self-host 포트 3111, 2 케이스) |
| `tetris-battle/playwright.config.js` | 신규 | tetris-battle 자체 Playwright config(`testDir: ./tests`, self-host라 webServer 불요) |
| `tetris-battle/CLAUDE.md` | 수정 | 함정 표 1행 추가 + 디렉토리/테스트 실행 섹션에 신규 슈트 등록 |

> network.js 변경 라인(기적용, 참고): L29-31 `pendingJoinName` 선언, L57-61 open 핸들러 JOIN 전송, L172-178 `join()` 보관 후 OPEN 시 즉시 전송.

## 신규 E2E 설계 메모

- `createApp({ getBotUrl: () => 'ws://localhost:3111/ws?mode=bot' })`로 봇 spawn을 켠 standalone 서버를 spec 내부 `beforeEach`에서 기동(bot-smoke의 getBotUrl 주입 패턴 재사용).
- 룸 상태(`players`)가 closure에 누적되므로 **테스트마다 fresh 서버 재기동** → 사람이 항상 p1.
- `afterEach`: `page.close()` → `server.closeAllConnections()` → `server.close()`를 2초 타임아웃과 레이스(업그레이드 소켓 잔존으로 드레인이 멈추는 것 방지) → 포트 해제 대기.

## 스펙 대비 구현 상태

- [x] 신규 Playwright E2E `ai-mode-e2e.spec.js` 작성(self-host 격리 포트 3111)
- [x] `/?mode=ai` → JOINED 처리 증거(`#player-label` "나 (P1)") 단언
- [x] `#status-msg`가 "서버 연결 중" 아님 단언
- [x] 콘솔 "연결되지 않은 상태에서 전송 시도: JOIN" 경고 **부재** 단언(핵심 게이트)
- [x] 봇 입장 → 양쪽 READY → 카운트다운 GO! 단언
- [x] 기존 `phase*`/`bot-smoke` 슈트 무수정
- [x] CLAUDE.md 함정 1행 추가

## 빌드/린트 결과

- 빌드: PASS (별도 빌드 단계 없음, ESM 모듈)
- 린트: PASS (정책상 JSDoc/한국어 주석 준수 = 통과)

## 검증 결과

| 항목 | 결과 |
|---|---|
| 신규 `ai-mode-e2e.spec.js` (수정 적용 상태) | **2/2 PASS** |
| 게이트 유효성: 버그 임시 재도입 시 | E2E **FAIL**(player-label "접속 중..." 고착) → 게이트 작동 확인 후 원복 |
| `bot-smoke.test.js` (포트 3110) | **8/8 PASS** |
| `phase1-ws.test.js` (포트 3055, 서버 사전 구동) | **37/37 PASS** |
| 콘솔 JOIN 드롭 경고 | 부재(양 케이스 단언 통과) |

서버 흐름 로그 확인: `p1 연결됨 → 봇 spawn → p2 연결됨 → p1/p2 READY → 양쪽 READY → 게임 시작 카운트다운`.

스크린샷: `tetris-battle/tests/screenshots/ai-mode-countdown.png`(카운트다운 GO! 시점).

## Art Director 후속 조치

- visual_change: none
- AD 모드 2 필요 여부: 아니오 — 에셋 생성/교체 없음(외부 에셋 정책상 0)
- AD 모드 3 필요 여부: 아니오 — UI 레이아웃 변경 없음(클라 네트워크 로직 + 테스트/문서만)

## 알려진 이슈

- `phase3-4-qa-edge.test.js`의 Q7b 1건은 본 작업과 무관한 기존 테스트 취약성(printBanner 정규식 비탐욕 오검출)으로 baseline부터 FAIL. 회귀 게이트 무영향(CLAUDE.md 「기존 결함」 참조).

## QA 참고사항

- 신규 E2E는 self-host(포트 3111)라 외부 서버 사전 구동 불요: `npx playwright test tests/ai-mode-e2e.spec.js --config=playwright.config.js`.
- `phase1-ws.test.js`는 외부 서버 사전 구동 필요: `node server.js --port 3055` 후 `node tests/phase1-ws.test.js --port 3055`(`node --test` 래퍼는 `--port` 전달 안 됨, ad-hoc 러너로 직접 실행).
- 봇 spawn은 실제 `child_process`라 케이스당 수 초 소요 가능(timeout 충분).
- 테스트 종료 후 포트 3111/3055/3110 좀비 없음 확인됨(MCP node 보존).
