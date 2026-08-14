# Wordchain Battle (끝말잇기 배틀) — 프로젝트 작업 지침

> 공개 HTTPS 통합 런처의 서버 권위 1:1 끝말잇기 전투 게임. Node.js + 바닐라 JavaScript. 개발 포트 3008.

## 게임 규칙

| 항목 | 규칙 |
|---|---|
| 플레이어 | 2인 LAN 대전, 서버 관리형 보통 AI 지원 |
| 체인 | 두 플레이어가 하나의 공유 단어 체인을 번갈아 진행 |
| 단어 판정 | 로컬 한국어 사전, 공용 중복 금지, 두음법칙 허용 |
| 턴 State | `WORD_INPUT` → `REWARD_SELECT` → 상대 `WORD_INPUT` |
| 전투 | 글자 수 설정의 기본 Damage + Attack + 보상 Damage - Defense |
| 보상 | 단어 수락 후 서버가 7종 중 3종을 무작위 제시. 10초 안에 클릭 또는 1·2·3 키로 하나 선택하며 만료 시 보상 없음 |
| 전투 스탯 | HP, Attack, Defense, 영구 Answer Time Modifier, 다음 턴 일회성 시간 압박 |
| 타이머 | 기본 답변 10초(3~15초 제한), 보상 선택 10초 |
| 시간 초과 | 해당 플레이어 HP 20 감소 후 기존 자동 체인 진행 |
| 패배 | HP가 0 이하가 되면 즉시 패배 |
| 첫 단어 | 시작 글자 강제 없이 자유 입력 |
| 리매치 | 양쪽 동의 시 모든 전투 상태를 초기화하고 재시작 |

밸런스와 표시 문구는 `combat-config.js`에서 관리한다. Damage 계산과 보상 적용은 `game.js`의 중앙 resolver만 사용하며 클라이언트가 수치를 결정하지 않는다.

## 주요 파일

```text
wordchain-battle/
├── combat-config.js   # 전투·타이머·글자 수 효과·보상 설정
├── game.js            # 순수 State Machine과 전투 resolver
├── server.js          # WebSocket 의도 검증과 State별 타이머
├── words.js           # 사전, 두음법칙, 막힘 대체 글자
├── ai.js / bot.js     # 단어 선택기와 서버 관리형 AI 클라이언트
├── public/            # 전투 정보·규칙표·보상 선택 UI
├── tests/             # node:test 및 Playwright 회귀 테스트
└── docs/              # 프로젝트 설명과 변경 이력
```

## 검증

```bash
node --test tests/wordchain-combat.test.js tests/wordchain-combat-ws.test.js tests/wordchain-battle-deadend.test.js tests/wordchain-battle-ai.test.js
npx playwright test
```

단독 실행은 `node server.js --port 3008`, 통합 실행은 상위 저장소에서 `node launcher/server.js`를 사용한다.
