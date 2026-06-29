# 코드네임 클래식(Codenames) — 프로젝트 현황

> 최종 업데이트: 2026-06-28 — AI 봇 추가 (접근법 C: 완전 오프라인 태그맵)

## 개요

LAN 2:2 정통 코드네임. 미니게임 천국 **11번째** 종목. 기존 codenames-duet(2인 협력)과 독립 병존하며, 정통 룰(단일 공유 키, 2팀 턴제 경쟁, 역할별 시야 분리)을 구현했다. **AI 봇 지원**(완전 오프라인 태그맵 기반) — 사람 1~3명 + 봇으로 시작 가능.

## 기술 스택

- Node.js 18+ (ESM, `"type": "module"`)
- `ws` 8.x (WebSocket, noServer 모드)
- 순수 `node:http` (Express 미사용)
- 바닐라 JS + HTML/CSS (외부 이미지 에셋 0 — 보드/카드는 CSS)

## 룰 요약 (서버 권위)

- 25칸 단어 보드 + **단일 공유 키**(선공팀 9 / 후공팀 8 / 중립 7 / 암살자 1 = 25)
- 선공팀(9장 보유)은 매 게임 랜덤
- 역할별 시야 분리: 스파이마스터는 키 전체, 요원은 공개된 카드 색만
- 턴: 스파이마스터 단서(단어 + 숫자) → 요원 추측(숫자+1 한도)
- 자기 팀 적중 = 턴 유지(한도 내) / 중립·상대·암살자 = 턴 종료
- 암살자 클릭 = 클릭 팀 즉시 패배 / 자기 팀 카드 전부 공개 = 승리
- 리매치 = 양 팀 동의 시 재시작 + 선공 교체
- 상세 룰: `docs/RULEBOOK.md` (§1~§13)

## 디렉토리

```
codenames/
├── game.js                  # 순수 게임 로직 (키 분배·단서·추측·승패·역할 마스킹)
├── server.js                # WS 서버 + createApp(getBotUrl) factory + 다중 봇 spawn + 단독 실행 (port 3014)
├── words.js                 # 단어팩 (duet에서 복사한 독립 파일, 서버 전용)
├── bot.js                   # AI 봇 WS 클라이언트 (스파이마스터 + 요원 양역할)
├── bot-knowledge.js         # 590단어 정적 태그맵 (128 고유태그) + 역조회 헬퍼, 런타임 의존성 0
├── package.json             # { "type": "module" } + ws
├── docs/{RULEBOOK.md, PROJECT.md, CHANGELOG.md}
├── public/
│   ├── index.html           # role_select 대기실(AI 뱃지·"AI로 빈자리 채우기") + 게임 보드 + 결과 모달
│   ├── client.js            # WS 연결 + UI 렌더링 (역할별 화면)
│   └── style.css            # 레드/블루 팀 색상 테마 + AI 뱃지
└── tests/
    ├── smoke.test.js        # WS/로직 스모크 (65건)
    ├── e2e.spec.js          # Playwright E2E (12건, 4 브라우저 컨텍스트)
    ├── bot-knowledge.test.js # 태그맵 단위 (22건, 590 커버리지 100%)
    ├── bot-smoke.test.js    # 봇 vs 봇 1판 완주 (23건)
    └── screenshots/         # role-select / spymaster-view / operative-view 등
```

## WS 흐름 (3단계 phase)

```
role_select  → 4인 입장(JOIN) + PICK_ROLE(팀/역할) + 호스트 START_GAME
playing      → CLUE(스파이마스터) / GUESS·END_TURN(요원), 매 액션 후 역할별 STATE
over         → GAME_OVER(키 전체 복기 공개) + REMATCH(선공 교체)
```

## 진행 상태

- ✅ 핵심 게임 로직 (`game.js`) — 키 분배·단서·추측·턴·승패·역할 마스킹
- ✅ WS 서버 (`server.js`) — 3단계 phase, role_select 대기실, createApp(getBotUrl) factory, 다중 봇 spawn, #13 좀비 정리, 단독 실행 + 포트 폴백, heartbeat
- ✅ 클라이언트 UI (`public/`) — role_select 선택 화면(AI 뱃지·"AI로 빈자리 채우기") + 게임 보드 + 단서/추측 패널 + 결과 모달
- ✅ launcher 통합 — `games.json` 11번째 카드(id `codenames`, port 3014, **botAvailable=true**) + `launcher/server.js` GAME_APPS 등록 + getBotUrl 주입(URL 첫 세그먼트로 codenames-duet과 정확 분리)
- ✅ **AI 봇** (`bot.js` + `bot-knowledge.js`) — 접근법 C(완전 오프라인 590단어 태그맵, 런타임 의존성 0), 스파이마스터(공통 태그 단서·암살자/상대/중립 회피) + 요원(태그 역조회 추측), 2가지 AI 진입 경로(게임 내 "AI로 빈자리 채우기" / 런처 "AI채우기" 자동 슬롯 배정)
- ✅ 룰북 `docs/RULEBOOK.md` (§1~§13)
- ✅ 테스트 — 휴먼 smoke 65 + E2E 12 = 77 PASS, 봇 smoke 23(3회 반복 데드락 0) + bot-knowledge 22(커버리지 100%), codenames-duet 회귀 27/27 무영향, 역할 마스킹 시각 검증(요원 키 누설 0)
- ✅ QA PASS(DEFECT-1·GAP-1 수정 후) / AD3 APPROVED

## 알려진 한계

- **봇 단서 v1** — 카테고리/태그 기반이라 LLM 같은 **창의적 단서는 아님**(사용자 합의). 추후 연상어(association) 보강 여지.
- (LOW, non-blocker) 게임 종료 후 일부 메시지 `silent break`(ERROR 없이 무시). 정상 흐름 무영향.
- (LOW, non-blocker) `isAllSlotsFilled`가 `joined`(JOIN 수신)를 검사하지 않음. PICK_ROLE이 JOIN 이후에만 가능하므로 실제 충돌 없음.
- 단서 자연어 검증 최소화(LAN 신뢰) — 보드 단어 포함 검사 등 미수행.
- 관전 모드 / 3:3 이상 / 타이머 / 채팅 / 단어팩 커스터마이징 미지원(Out of Scope).

## 향후 계획

- 봇 단서 연상어 보강(태그맵 → 의미 연결 강화)
- §13-8 non-blocker 2건 정리
- 단서 자연어 검증 강화 옵션
