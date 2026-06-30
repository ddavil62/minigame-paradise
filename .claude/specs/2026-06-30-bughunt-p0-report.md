# Implementation Report: 버그 헌트 P0 — 시스템 결함 수정

## 작업 요약
P0-A(null WS 프레임 가드 10개 게임 + launcher uncaughtException), P0-B(playerId 중복 수정 6개 게임), P0-C(janggi 분수 좌표 크래시 방어 + 타 게임 감사 3건)를 구현했다.

## 변경된 파일
| 파일 경로 | 작업 유형 | 변경 내용 |
|---|---|---|
| `matgo/server.js` | 수정 | P0-A: switch 직전에 null/비-객체 WS 프레임 가드 삽입 |
| `tetris-battle/server.js` | 수정 | P0-A: null guard 삽입 + P0-B: playerId를 usedIds 패턴으로 교체 |
| `davinci-code/server.js` | 수정 | P0-A: null guard 삽입 + P0-B: playerId를 usedIds 패턴으로 교체 |
| `yutnori/server.js` | 수정 | P0-A: null guard 삽입 (P0-B: 이미 안전 — FIX-1 적용) |
| `codenames-duet/server.js` | 수정 | P0-A: null guard 삽입 + P0-B: playerId를 usedIds 패턴으로 교체 |
| `janggi/server.js` | 수정 | P0-A: null guard 삽입 + P0-B: playerId를 usedIds 패턴으로 교체 (reconnect 경로 보존) + P0-C: MOVE 핸들러에 정수 좌표 검증 추가 |
| `hanabi/server.js` | 수정 | P0-A: null guard 삽입 + P0-B: playerId를 usedIds 패턴으로 교체 |
| `yahtzee/server.js` | 수정 | P0-A: null guard 삽입 (P0-B: 이미 안전 — usedIds 패턴) |
| `omok/server.js` | 수정 | P0-A: null guard 삽입 + P0-B: playerId를 usedIds 패턴으로 교체 (color 배정 유지) |
| `codenames/server.js` | 수정 | P0-A: null guard 삽입 (P0-B: 이미 안전 — usedIds 슬롯 탐색) |
| `rummikub/server.js` | 수정 없음 | P0-A: 이미 적용됨 (L290-297). P0-B: 이미 안전 |
| `launcher/server.js` | 수정 | P0-A: `process.on('uncaughtException')` 안전망 추가 (import 직후, HTTP 서버 생성 전) |

## 스펙 대비 구현 상태
- [x] P0-A: 10개 게임 server.js에 null/비-객체 가드 추가 (rummikub 참조 구현 동일 패턴)
- [x] P0-A: sendTo 호출을 try/catch로 감싸 WS 닫힌 상태 방어
- [x] P0-A: launcher/server.js에 uncaughtException 안전망 추가 (process.exit 미호출, stderr 로깅)
- [x] P0-B: tetris-battle, davinci-code, codenames-duet, hanabi, omok, janggi — usedIds 패턴으로 교체
- [x] P0-B: janggi reconnect 경로 (L327-328 missingSide 기반) 보존 확인
- [x] P0-B: omok의 color 배정(playerId 뒤 `p1->black, p2->white`) 유지
- [x] P0-B: SAFE 게임(matgo, yutnori, yahtzee, rummikub, codenames) 미수정 확인
- [x] P0-C: janggi MOVE 핸들러에 Number.isInteger 4값 검증 추가 (applyMove 호출 전)
- [x] P0-C 감사: omok PLACE — game.js placeStone L288에 `Number.isInteger(row) && Number.isInteger(col)` 이미 존재. **안전, 추가 가드 불필요**
- [x] P0-C 감사: davinci-code GUESS — game.js guess L318에 `Number.isInteger(slot)` 이미 존재. **안전, 추가 가드 불필요**
- [x] P0-C 감사: yutnori MOVE_PIECE — server.js L1074에 `Number.isInteger(msg.pieceIndex)` 이미 존재. **안전, 추가 가드 불필요**

## P0-C 감사 상세 결과

| 게임 | 핸들러 | 인덱스/좌표 사용 | 기존 가드 | 크래시 여부 | 결론 |
|---|---|---|---|---|---|
| omok | PLACE (row, col) | `game.js placeStone` L288: `Number.isInteger(row) && Number.isInteger(col)` | 있음 | 없음 | SAFE |
| davinci-code | GUESS (slot) | `game.js guess` L318: `Number.isInteger(slot)` | 있음 | 없음 | SAFE |
| yutnori | MOVE_PIECE (pieceIndex) | `server.js` L1074: `Number.isInteger(msg.pieceIndex) ? msg.pieceIndex : -1` 후 범위 검사 | 있음 | 없음 | SAFE |

3건 모두 기존에 정수 검증이 존재하므로 추가 수정 불필요.

## 빌드/린트 결과
- 빌드: PASS (전 12개 파일 `node --check` 통과)
- 린트: PASS (별도 린트 도구 없음, JSDoc/한국어 주석 준수)

## Art Director 후속 조치
- visual_change: none
- AD 모드 2 필요 여부: 아니오 — 에셋 생성/교체 작업 없음
- AD 모드 3 필요 여부: 아니오 — UI 레이아웃 변경 없음 (순수 백엔드 서버 코드 수정)

## 알려진 이슈
- 없음

## QA 참고사항
- P0-A 검증: `ws.send('null')` 1회로 각 게임 서버가 종료되지 않는지 확인. 클라이언트에 `{ type: 'ERROR', message: '잘못된 메시지 형식입니다.' }`가 수신되는지 확인.
- P0-A 추가 검증: `ws.send('[1,2]')`, `ws.send('42')`, `ws.send('true')` 등 배열/숫자/boolean JSON도 가드에서 차단되는지 확인.
- P0-B 검증: A connect -> B connect -> A close -> C connect 후 C가 올바른 빈 슬롯 ID를 받는지 확인. davinci-code, codenames-duet, omok에서 확정 재현 절차 실행.
- P0-C 검증: janggi에서 분수 좌표 MOVE (`fromFile: 1.5`) 전송 시 서버가 종료되지 않고 `{ type: 'ERROR', message: '잘못된 좌표 형식입니다.' }`를 반환하는지 확인.
- launcher uncaughtException: 가드를 통과하는 예외 발생 시 stderr에 로그가 출력되고 프로세스가 유지되는지 확인.
- 회귀 게이트: 스펙의 11개 게임별 테스트 슈트 전부 PASS 필요.
