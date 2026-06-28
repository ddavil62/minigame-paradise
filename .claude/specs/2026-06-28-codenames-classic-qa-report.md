# QA 리포트 — 코드네임 클래식 (정통 2:2 팀 대전)

- 대상: 미니게임 천국 11번째 게임 "코드네임"(`codenames/`)
- 날짜: 2026-06-28
- 판정: **PASS (blocker 0)**
- AD3: **APPROVED** (REVISE 6건 반영, 잔여 WARN 2건 비강제)
- 스펙: `.claude/specs/2026-06-28-codenames-classic-spec.md`
- 스코프: `.claude/specs/2026-06-28-codenames-classic-scope.md`

> 본 문서는 Doc Writer가 파이프라인 산출물(QA 결과)을 문서로 보존한 정리본이다.

## 1. 검증 범위

정통 Codenames 룰(단일 공유 키 9/8/7/1, 2팀 턴제 경쟁, 역할별 시야 분리, 암살자 즉시 패배)의 휴먼 전용 2:2 구현 + 런처 통합 + codenames-duet 독립 병존 회귀.

## 2. 테스트 결과

| 스위트 | 건수 | 결과 |
|--------|------|------|
| smoke (`codenames/tests/smoke.test.js`) — 로직 + WS | 65 | PASS |
| Playwright E2E (`codenames/tests/e2e.spec.js`) — 4 브라우저 컨텍스트 | 12 | PASS |
| **신규 합계** | **77** | **PASS** |
| codenames-duet review-smoke (회귀) | 27/27 | PASS (무영향) |

- E2E 4 컨텍스트 = 레드 스파이마스터 / 레드 요원 / 블루 스파이마스터 / 블루 요원.
- 스크린샷 자산: `codenames/tests/screenshots/`(role-select, role-filled, spymaster-view, operative-view, operative-clue, after-guess).

## 3. 핵심 검증 항목

- **역할 마스킹(정체성)**: 요원 STATE의 미공개 카드 `myKey` 항목이 모두 null — **요원 키 누설 0** (시각 육안 검증 + WS 페이로드 검증). 스파이마스터는 키 전체 노출.
- **키 분배**: 선공팀 9 / 후공팀 8 / 중립 7 / 암살자 1 = 25, 선공팀 랜덤.
- **턴 규칙**: 자기 팀 적중 시 `guessesLeft = number+1` 한도 내 턴 유지 / 한도 소진·중립·상대·암살자 시 턴 종료.
- **승패**: 자기 팀 전체 공개 승리 / 상대 카드로 상대 완성 시 상대 승리 / 암살자 클릭 즉시 패배.
- **role_select 대기실**: PICK_ROLE 중복 자리 거부, 4슬롯 충족 시 호스트만 START 활성.
- **리매치**: 양 팀 동의 시 선공 교체 재시작.
- **런처 통합**: URL 첫 세그먼트 매칭으로 `codenames` vs `codenames-duet` 정확 분리(prefix 충돌 0).

## 4. 미해결 / non-blocker

LOW 2건 — 모두 정상 흐름에 영향 없음(blocker 아님). 후속 정리 대상(RULEBOOK §13-8):

1. **종료 후 silent break** — `phase !== 'playing'` 시 일부 메시지를 ERROR 없이 조용히 무시. 클라이언트가 종료 상태에서 해당 액션을 보내지 않으므로 무영향.
2. **`isAllSlotsFilled`의 joined 미검사** — 슬롯 충족 판정이 `team`/`role`만 보고 `joined`(JOIN 수신)는 검사하지 않음. PICK_ROLE이 JOIN 이후에만 가능하므로 실제 충돌 흐름 없음.

## 5. AD3 (UI 레이아웃) 결과

- 판정: APPROVED.
- REVISE 6건 반영 완료.
- 잔여 WARN 2건은 기능 이상 없는 폴리시 수준(비강제).

## 6. 결론

정통 Codenames 2:2 코어(키·역할 시야·턴·승패·리매치·role_select)가 스펙 수용 기준을 충족했고, codenames-duet 회귀에 영향이 없다. 봇은 휴먼 전용 정책상 미구현이며 슬롯 구조만 예약됐다. **QA PASS**.
