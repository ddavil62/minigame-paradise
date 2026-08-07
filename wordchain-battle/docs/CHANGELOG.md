# 끝말잇기 배틀 변경 이력

## 2026-08-07: 한글 자모 분리(NFD) 입력 시 정상 단어가 "한글 아님"으로 거부되는 버그 수정

### 수정

- macOS 등 일부 OS의 한글 IME는 완성형(NFC) 대신 자모가 분리된 정규화 형태(NFD)로 텍스트를 전달한다. 사전(`data/words.json`)은 전부 NFC로 저장되어 있는데 클라이언트·서버 어디에서도 유니코드 정규화를 하지 않아, NFD로 들어온 정상 단어(예: "사과")가 `isKorean()`의 `/^[가-힣]+$/` 정규식(완성형 음절 범위만 매칭)을 통과하지 못하고 "한글 단어를 입력해주세요"로 거부되던 버그를 수정했다. 사용자에게는 "거의 모든 입력이 실패하는 것"처럼 보였다.
- `game.js`의 `submitWord()` 최상단에서 `word = word.normalize('NFC')`를 적용해, 이후 `isKorean` 검증·사전 조회(`wordSet.has`)·중복 체크(`usedWords`)·체인 갱신(`lastWord`/`lastSyllable`) 전부가 정규화된 형태로 일관되게 처리되도록 했다. 서버가 유일한 검증 지점이므로 이 한 곳의 수정으로 클라이언트 종류와 무관하게 방어된다.

### 검증

- Node 스크립트로 재현: 수정 전 NFD "사과" 제출 시 `not_korean`으로 거부됨을 확인, 수정 후 정상 수락(`ok:true`) 확인.
- NFC로 제출된 단어와 NFD로 제출된 동일 단어가 중복으로 정확히 판정됨을 확인(정규화 후 `usedWords` 비교 일관성).
- `tests/wordchain-battle-ai.test.js` 회귀 통과(AI 선택기 forced·두음법칙·공용 중복 로직 무영향).

## 2026-08-07: 런처 썸네일·대기실 입장 복구

### 수정

- 실행 중인 구 런처가 최신 `games.json`만 다시 제공해 카드에는 끝말잇기가 보이지만 HTTP/WS 라우터는 이를 모르는 split-brain 상태를 제거했다.
- 런처 시작 시 `games.json`의 순서를 보존한 카탈로그·조회 Map·JSON을 한 번만 만들고, `GAME_APPS`와 양방향 id 정합성을 검증한다.
- `/games.json`도 같은 런타임 스냅샷을 응답해 썸네일 경로, 카드 입장과 `/lobby/ws?gameId=wordchain-battle` 지원 상태를 한 버전으로 고정했다.
- 360×640과 390×844 런처 대기실에서 제목과 `AI로 채우기`가 두 줄로 접히지 않도록 제목 크기·헤더 간격·나가기 폭을 압축하고, 준비·AI 버튼을 한 줄의 동일한 52px 높이로 정렬했다.
- 런처 카탈로그 불일치가 감지되면 준비 전 예외를 런타임 안전망으로 계속 실행하지 않고 명시적 nonzero 코드로 종료하도록 시작 생명주기를 보강했다.
- AI의 1.2~2.0초 예약값 생성기를 순수 함수로 분리해 난수 경계를 결정적으로 검증하고, 실제 제출 E2E에는 프로세스·사전·WS 전달 여유를 포함한 3초 상한을 적용했다.

### 검증

- 신규 focused Playwright 6건이 모두 통과했다.
- 기존 SVG 자체와 카드 레이아웃은 변경하지 않고 200 `image/svg+xml`, 자연 크기 250×150을 확인했다.
- 실제 입장 버튼, raw 로비 WS, AI 채우기, 두 사람 READY handoff, 정상 prefix 3종과 경로 이탈 12종을 검증했다.
- 최종 QA는 Playwright 35건과 Node 8건으로 **43/43 PASS**, AI 예약값·실제 제출 추가 반복은 **10/10 PASS**다.
- 모바일 360×640·390×844의 제목과 두 CTA는 한 줄·동일 52px 높이로 검수되었고 AD 모드 3에서 **APPROVED** 판정을 받았다.
- stale PID 17488만 교체했으며 사용자 테스트용 포트 3000은 현재 소스의 PID 76924로 복구했다.

### 참고

- 스펙: `.Codex/specs/2026-08-07-wordchain-battle-lobby-entry-fix.md`
- 구현 리포트: `.Codex/specs/2026-08-07-wordchain-battle-lobby-entry-fix-report.md`
- QA: `.Codex/specs/2026-08-07-wordchain-battle-lobby-entry-fix-qa.md`
- UI 검수: `.Codex/specs/2026-08-07-wordchain-battle-lobby-entry-fix-ui-review.md`
- 신규 이미지·에셋 파일 변경이 없어 Mockup asset sync는 생략했다.

## 2026-08-07: 1인 보통 AI 테스트 모드

### 추가

- 런처의 `AI로 채우기`로 사람 1명과 `AI (보통)` 1명이 자동 매칭되는 게임 서버 관리형 AI 모드를 추가했다.
- `ai.js`에 서버 사전 기반 시작 글자 인덱스와 forced·자기 체인·두음법칙·공용 중복·게이지 완성·막다른 체인을 고려하는 순수 선택기를 추가했다.
- `bot.js`에 1.2~2.0초 지연 제출, 경기 세대·상태 키 기반 stale 입력 차단, 거절 후보 재시도, 자동 리매치를 추가했다.

### 변경

- 브라우저의 `mode=ai`만 게임 WebSocket으로 전달하고, 런처는 끝말잇기를 `GAME_MANAGED_AI_IDS`에 등록해 범용 detached 봇 중복 실행을 차단했다.
- 사람이 이탈하면 봇 소켓·자식 프로세스·카운트다운·입력·리매치 예약을 함께 정리하도록 서버 생명주기를 확장했다.
- 런처 카드 메타를 `1인 AI · 2인 대전`, `보통 AI 지원` 및 대응 영어 문구로 갱신했다.
- 런처의 601~860px 게임 카드 그리드를 3열로 조정하고 카드 최소 너비를 해제해 800px 화면의 가로 오버플로를 제거했다. 360px 1열, 861~1100px 4열, 1280px 5열은 유지했다.

### 수정

- 서버가 생성한 봇마다 예측 불가능한 일회용 자격 증명을 발급하고 자식 프로세스 환경변수와 WebSocket upgrade 헤더로만 전달하도록 봇 인증을 강화했다.
- 현재 AI 사람의 JOIN 상태, 활성 자식 프로세스, 현재 세대의 미사용 자격 증명이 모두 일치할 때만 봇 슬롯을 승인하도록 수정했다.
- 승인 즉시 자격 증명을 폐기하고 kill·사람 이탈·자식 오류/종료·새 spawn에서도 이전 값을 폐기했다. 비교에는 길이 확인과 상수 시간 비교를 사용한다.

### 검증

- Node 4건과 Playwright 25건, 총 **29/29** 테스트가 통과했다.
- 정상 AI 플레이·리매치·이탈 정리와 함께 자격 증명 누락·불일치·재사용·이전 세대 연결 거부, 사람 2인 회귀, 경로 격리, stale 카운트다운, `wasGarbage` 동기화를 검증했다.
- 360×640, 800×640, 1280×640 런처와 360×640, 800×640 AI 경기 화면에서 잘림·겹침·가로 오버플로가 없음을 확인했다.
- AD 모드 3 최종 판정은 `APPROVED`, QA 최종 판정은 `PASS`다.

### 참고

- 스펙: `.Codex/specs/2026-08-07-wordchain-battle-ai-mode.md`
- 구현 리포트: `.Codex/specs/2026-08-07-wordchain-battle-ai-mode-report.md`
- UI 검수: `.Codex/specs/2026-08-07-wordchain-battle-ai-mode-ui-review.md`
- QA: `.Codex/specs/2026-08-07-wordchain-battle-ai-mode-qa.md`
- 신규 이미지·에셋 파일 변경이 없어 Mockup asset sync는 생략했다.

## 2026-08-07: 통합 감사 후속 수정

### 수정

- 카운트다운 이탈·재접속 시 이전 timeout이 새 게임을 조기 시작시키던 상태 경쟁을 취소 핸들과 세대·identity 검증으로 차단했다.
- 단독 서버와 통합 런처 진입점에서 정적 파일 경로 이탈 및 인코딩·혼합 구분자 변형을 차단했다.
- 서버 권위 `WORD_ACCEPTED.wasGarbage`를 추가하고 양쪽 체인에서 기존 `.garbage-word` 강조가 표시되도록 연결했다.
- 360×640에서 가비지 알림이 강조 단어를 가리던 배치를 화면 하단 16px 안전 영역으로 옮겼다. 800×640의 기존 상단 배치는 유지했다.

### 검증

- Playwright 전체 17건(기존·기능 회귀 13건, 추가 공격 검증 4건)이 통과했다.
- 반복 이탈 카운트다운 세대 격리, 단독·실제 통합 런처 경로 우회 각 12종, `WORD_ACCEPTED.wasGarbage` 양측 일치와 입력 연타 경계를 검증했다.
- 360×640과 800×640 시각 검증 및 AD 모드 3 재검수에서 최종 `APPROVED`, QA에서 `PASS`를 받았다.

### 참고

- 스펙: `.Codex/specs/2026-08-07-wordchain-battle-audit-fixes.md`
- 구현 리포트: `.Codex/specs/2026-08-07-wordchain-battle-audit-fixes-report.md`
- UI 검수: `.Codex/specs/2026-08-07-wordchain-battle-audit-fixes-ui-review.md`
- QA: `.Codex/specs/2026-08-07-wordchain-battle-audit-fixes-qa.md`
- `assets/` 변경이 없어 Mockup asset sync는 생략했다.

## 2026-08-07: v0.1.0 — 초기 구현 및 QA 안정화

### 추가

- `server.js`, `game.js`, `words.js`에 Node.js ESM 기반 2인 WebSocket 게임 서버와 서버 권위 규칙 엔진을 추가했다.
- `public/`에 대기실, 3초 카운트다운, 독립 체인, HP·게이지·20초 타이머, 가비지 알림, 결과·리매치 UI를 추가했다.
- 123,754개 한글 명사를 포함한 `data/words.json`과 CSV 변환용 `scripts/build-wordlist.js`를 추가했다.
- 단어 길이별 게이지 충전(2/3/4/5글자 이상: 15/25/35/50), 100 게이지 자동 공격, 가비지 10 HP 피해, 타이머 만료 5 HP 피해를 구현했다.
- 50개 이상의 유효 단어가 존재하는 시작 글자만 가비지 후보로 사용하는 필터를 추가했다.
- 매치 전체 단어 중복 방지, HP 0 즉시 종료, 기권, 양쪽 동의 리매치와 상태 초기화를 추가했다.
- `assets/key-art.svg`와 런처의 게임 카드·라우트 등록을 추가하고, 포트 3008 독립 실행을 지원했다.
- `tests/wordchain-battle-qa.spec.js`와 모바일·데스크톱 승인 스크린샷을 추가했다.

### 변경

- 모바일 플레이어·체인 영역을 2열로 유지하도록 압축하고 가비지 알림을 HP/게이지 아래 안전 영역에 배치해 360×640 화면 초과를 제거했다.
- 반복 색상을 CSS 커스텀 프로퍼티로 통합하고, 800×640 데스크톱 레이아웃을 함께 보존했다.
- 두음법칙 판정을 명세 방향(`라→나`, `랴→야` 등)으로만 허용하도록 제한했다.
- 게임 시작 조건을 소켓 2개 연결이 아닌 양쪽 플레이어의 JOIN 완료로 강화했다.

### 수정

- `PLAYING` 수신 직후 시작 오버레이를 동기적으로 닫아 활성 입력을 약 0.5초간 가리던 상태 전이 경쟁을 수정했다.
- 가비지 피격 효과를 HP 값 갱신과 분리해 `undefined` HP가 중간 프레임에 전달될 수 있던 문제를 수정했다.
- WebSocket 테스트 대기자가 타임아웃 뒤 남아 후속 메시지를 가로채던 테스트 하네스 문제를 수정했다.

### 검증

- Playwright 회귀 테스트 9개가 모두 통과했다.
- 360×640 모바일과 800×640 데스크톱 시각 검증, 콘솔·페이지 오류 검사, AD 아트/UI 검수를 통과했다.

### 참고

- 확정 스펙: `.Codex/specs/2026-08-07-wordchain-battle.md`
- 최초 구현 리포트: `.claude/specs/2026-08-07-wordchain-battle-report.md`
- UI 수정 리포트: `.Codex/specs/2026-08-07-wordchain-battle-ui-fix-report.md`
- QA 수정 리포트: `.Codex/specs/2026-08-07-wordchain-battle-qa-fix-report.md`
- 최종 QA: `.Codex/specs/2026-08-07-wordchain-battle-qa.md`
