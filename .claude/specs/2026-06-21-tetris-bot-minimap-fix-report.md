# Implementation Report: 테트리스 배틀 AI 봇 미니맵 미표시 버그 수정 (회귀 테스트 + 문서)

## 작업 요약

이미 적용·검증된 `bot.js` 미니맵 fix(봇이 `BOARD_STATE.stack`을 빈 배열 대신 `getColumnHeights`
컬럼 높이 배열로 송신)에 대해 **회귀 게이트 TBOT-006**을 추가하고, 게이트 유효성(stack:[] 복귀 시
FAIL)을 실증한 뒤, 산출물 문서 2건과 CLAUDE.md 함정 1행을 작성했다. `bot.js`는 추가 변경하지 않았다.

## 증상 · 근본 원인 · 수정 (요약)

- **증상**: AI 대전 시 상대(봇) 보드 미니맵이 비어 보임. 사람 대전은 정상.
- **근본 원인**: 미니맵 경로 `BOARD_STATE{height,stack}` → server `OPPONENT_BOARD` → `ui.js renderOpponent`에서,
  봇이 `stack: []`(빈 배열)을 보내 그릴 컬럼 높이 데이터가 없었다. 사람 클라는 `board.js getColumnHeights`로
  길이 10 컬럼 높이 배열을 보낸다.
- **수정**: `bot.js`에 `board.js`와 동일 포맷 `getColumnHeights(grid)` 추가
  (`VANISH_ZONE`부터 스캔, `heights[c] = BOARD_HEIGHT - r`, 길이 `BOARD_WIDTH=10`, 값 0~20),
  `BOARD_STATE` 송신을 `const stack = getColumnHeights(botGrid); const height = stack.length ? Math.max(...stack) : 0; send({ type:'BOARD_STATE', height, stack });`로 변경.

## 변경된 파일

| 파일 경로 | 작업 유형 | 변경 내용 |
|---|---|---|
| `tetris-battle/bot.js` | (기존 수정, 재변경 없음) | `getColumnHeights` 추가 + `BOARD_STATE` stack 실데이터화 (정독·확인만) |
| `tetris-battle/tests/bot-smoke.test.js` | 수정 | 헤더 주석에 TBOT-006 명세 추가, TBOT-001/002 블록 뒤에 `runMinimapStackScenario`(TBOT-006) 신규 추가. 기존 TBOT-001~005 무변경 |
| `tetris-battle/CLAUDE.md` | 수정 | "변경 시 자주 깨지는 함정" 표에 봇 미니맵 동기화 1행 추가 |
| `.claude/specs/2026-06-21-tetris-bot-minimap-fix-spec.md` | 신규 | 스펙 문서 |
| `.claude/specs/2026-06-21-tetris-bot-minimap-fix-report.md` | 신규 | 본 리포트 |

## 회귀 게이트 — TBOT-006

봇 → 사람으로 중계되는 `OPPONENT_BOARD.stack`이 컬럼 높이 배열임을 단언:
1. `stack`이 배열로 도착 (Array.isArray).
2. `stack.length === 10` (BOARD_WIDTH).
3. 봇이 피스를 쌓은 뒤(최대 30s 폴링) `stack`에 **0 초과 값 1개 이상** 존재.

## 스펙 대비 구현 상태

- [x] TBOT-006 회귀 단언 추가 (stack 길이=10 + 0 초과 값 존재)
- [x] 기존 TBOT-001~005 및 타 phase 슈트 무수정
- [x] 실제 실행 PASS 확인 (bot-smoke 11/11)
- [x] 게이트 유효성 검증 (stack:[] 복귀 시 FAIL → 즉시 원복, 원복 확인)
- [x] 산출물 문서 2건 작성
- [x] CLAUDE.md 함정 1행 추가
- [x] 서버 종료, MCP node 보존

## 빌드/린트/테스트 결과

- **bot-smoke (포트 3110)**: **11/11 PASS** (기존 8 단언 + 신규 TBOT-006 3 단언). "모든 봇 smoke 테스트 통과."
- **게이트 유효성**: `bot.js`를 일시적으로 `stack: []`로 되돌리면 TBOT-006 "길이=10"·"0 초과 값" 2건 FAIL
  (9 PASS / 2 FAIL), "배열로 도착" pre-check는 PASS(빈 배열도 배열). 확인 후 즉시 원복 → 11/11 복구.
- **회귀 9 슈트**:
  - 비포트 유닛: phase1-unit / phase5-vanish-zone(52 PASS) / phase5-qa-edge — PASS.
  - WS 슈트(별도 `node server.js --port 3055` 구동 후): phase1-ws / phase2-items / phase2-edge /
    phase3-polish / phase4-launcher — 전부 PASS.
  - phase3-4-qa-edge — **20 PASS / 1 FAIL**. 유일 FAIL은 문서화된 baseline 결함 **Q7b**(printBanner
    정규식 비탐욕 매칭이 뒤따르는 주석의 유니코드 `─`까지 오검출하는 테스트 취약성, 봇 무관·기능 무해).
- **린트**: 별도 도구 없음(정책상 JSDoc/한국어 주석 준수 = 통과). 신규 시나리오에 JSDoc·한국어 주석 부착.

## Art Director 후속 조치

- visual_change: **none** (봇 송신 페이로드 데이터만 변경, UI/CSS/Canvas 무변경)
- AD 모드 2 필요 여부: **아니오** — 에셋 생성/교체 없음(본 프로젝트 외부 에셋 0)
- AD 모드 3 필요 여부: **아니오** — UI 레이아웃 변경 없음. 미니맵 렌더 코드(ui.js)는 무변경, 봇이 올바른 데이터를 공급하게 됐을 뿐
- **이 작업은 AD 생략 가능(`visual_change: none`).**

## 알려진 이슈

- phase3-4-qa-edge **Q7b** baseline FAIL — 봇/미니맵과 무관한 기존 테스트 취약성(회귀 게이트 슈트 임의
  수정 금지 원칙상 미수정). 별도 보정 이슈로 분리 권장(정규식을 printBanner 함수 경계로 한정).

## QA 참고사항

- 미니맵 실시각 검증은 Playwright로 AI 게임 시작 → `#opponent-canvas` 시간 경과 갱신 +
  하단이 상단보다 밝음(바닥부터 차오르는 컬럼 막대)으로 확인 가능.
- bot-smoke는 ad-hoc 러너(`node tests/bot-smoke.test.js`, 포트 3110, `--test` 미사용). 내부에서
  서버를 띄우고 닫으므로 별도 사전 구동 불필요.
- WS phase 슈트는 `node server.js --port 3055`를 **별도로 먼저 띄운 뒤** 실행해야 하며, 여러 파일을
  한 번에 묶어 실행하면 포트 공유 충돌이 나므로 파일별 순차 실행 권장.
