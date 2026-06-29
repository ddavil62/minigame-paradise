# QA 리포트 — 코드네임 클래식 AI 봇 (접근법 C: 완전 오프라인 태그맵)

> 대상: `minigames/codenames` AI 봇 추가
> 날짜: 2026-06-28
> 최종 판정: **PASS** (원 QA PARTIAL → DEFECT-1·GAP-1 수정 후 해소)
> 관련: 스펙 `.claude/specs/2026-06-28-codenames-bot-spec.md` · 스코프 `.claude/specs/2026-06-28-codenames-bot-scope.md`

---

## 1. 개요

코드네임 클래식(2:2 4인)에 **완전 오프라인 AI 봇**을 추가했다. 런타임 외부 의존성 0(LLM API·임베딩·HTTP 호출 없음) — 빌드타임 생성 590단어 정적 태그맵(`bot-knowledge.js`, 128 고유태그)만으로 스파이마스터(단서 생성)·요원(추측) 양역할을 수행한다. `botAvailable: false → true`로 사람 1~3명 + 봇 시작이 가능하다.

원 QA에서 결함 2건(DEFECT-1·GAP-1)이 발견되어 **PARTIAL** 판정 → Coder 수정 후 재검증으로 **PASS** 해소.

---

## 2. 발견 결함 및 수정

| ID | 영향도 | 증상 | 원인 | 수정 | 재검증 |
|----|-------|------|------|------|--------|
| DEFECT-1 | HIGH(blocker) | 스파이마스터 봇 데드락 — CLUE를 영원히 보류 | 유효 태그 0 + 폴백 미발동 조건에서 단서를 내지 못하고 턴이 멈춤 | `bot.js` 폴백 로직 보강(위험 회피 1:1 단서 → 임의 자기팀 단어 첫 태그 2단 폴백) | 봇 smoke 23 **3회 반복** 데드락 **0** |
| GAP-1 | HIGH(blocker) | 런처 "AI채우기" 진입 시 게임 시작 불가 | 런처는 team/role 없는 제너릭 봇(`?mode=ai`)을 spawn하는데 서버가 PICK_ROLE 없는 봇을 슬롯 배정하지 않음 | `server.js`에 **team/role 없는 봇 자동 슬롯 배정** 추가 | 런처 "AI채우기" 1+3/2+2/3+1 정상 시작 |

> 두 결함 모두 수정 후 재검증 PASS. 잔여 blocker 0.

---

## 3. 수용 기준(AC) 검증 결과

| AC | 내용 | 결과 |
|----|------|------|
| AC-1 | 태그맵 미매핑 단어 0 / 빈 태그 배열 0 (590 커버리지 100%) | PASS (bot-knowledge 단위 22) |
| AC-2 | 스파이마스터 단서 태그가 암살자 단어 태그와 교집합 없음 | PASS |
| AC-3 | 스파이마스터 단서 숫자 = 실제 커버 단어 수(≥2) | PASS |
| AC-4 | 요원이 단서 태그 역조회로 보드 단어 추측 | PASS |
| AC-5 | 봇 vs 봇 1판 완주(암살자 즉사 없이 정상 승패) | PASS (봇 smoke 23, CBOT 시리즈) |
| AC-6 | AI채우기 1인+3봇 / 2인+2봇 / 3인+1봇 정상 시작 | PASS |
| AC-7 | codenames 휴먼 smoke 65 전체 PASS | PASS (회귀 무영향) |
| AC-8 | codenames E2E 12 전체 PASS(4 브라우저 컨텍스트) | PASS (회귀 무영향) |
| AC-9 | games.json `botAvailable === true` | PASS |
| AC-10 | 봇 없는 4인 휴먼 게임 진행 시 봇 spawn 0 | PASS |
| AC-11 | 사람 disconnect 시 봇 슬롯 정리 + 재접속 "방 가득" ERROR 없음(#13) | PASS (좀비 무재발) |

---

## 4. 검증 합계

- 봇 smoke **23**(`bot-smoke.test.js`) — 3회 반복 데드락 0.
- bot-knowledge 단위 **22**(`bot-knowledge.test.js`) — 590단어 커버리지 100%(미매핑 0).
- AI채우기 시나리오 — 1인+3봇 / 2인+2봇 / 3인+1봇 모두 정상 시작(GAP-1 자동 배정 검증).
- #13 좀비 무재발 — 사람 disconnect → 재접속 ERROR 0.
- 휴먼 회귀 — codenames smoke 65 + E2E 12 + codenames-duet 27 무영향.

## 5. AD3 (UI 검수)

- role_select 봇 슬롯 "AI" 뱃지 + 호스트 "AI로 빈자리 채우기" 버튼 + 봇슬롯 클릭 가드 → **APPROVED**.

## 6. v1 한계 (non-blocker, 추후 보강 여지)

- 봇 단서가 카테고리/태그 기반이라 LLM 같은 **창의적 단서는 아님**(사용자 합의). 아쉬우면 연상어(association) 보강 가능.

---

## 7. 최종 판정

**PASS** — blocker 0. DEFECT-1(스파이마스터 데드락)·GAP-1(런처 진입) 수정으로 원 PARTIAL 해소. 봇 smoke 23×3 데드락 0 + GAP-1 자동 배정 검증 + 회귀 무영향으로 확정.
