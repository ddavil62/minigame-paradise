# Wordchain Battle (끝말잇기 배틀) -- 프로젝트별 작업 컨벤션

> LAN 1:1 끝말잇기 대전 (가비지 음절 공격). Node.js + 바닐라 JS. 미니게임 천국 16번째 종목 (포트 3008).

## 정체성

- **목적**: 끝말잇기에 테트리스 배틀의 가비지 공격 메커니즘을 이식한 2인 실시간 대전.
- **기술**: Node 18+ (ESM), 순수 `node:http` + `ws` 8, 바닐라 JS.
- **외부 에셋**: key-art.svg 1개 (SVG 코드 직접 작성).

## 게임 룰

| 항목 | 규칙 |
|---|---|
| 플레이어 | 2인 (LAN 1:1) |
| 체인 | 각자 독립 체인. 자기 마지막 단어의 끝 글자로 이어감 |
| 단어 검증 | 서버 권위. 로컬 한국어 사전 (12만+ 단어) |
| 두음법칙 | 허용 (DUEUM_MAP 테이블) |
| HP | 100 시작. 0이면 패배 |
| 가비지 공격 | 게이지 100 도달 시 자동 발동. 상대에게 강제 시작 글자 + 10 HP 데미지 |
| 타이머 | 20초. 만료 시 5 HP 페널티 |
| 리매치 | 양쪽 동의 시 재시작 |
| AI 봇 | 1차 미지원 |

## 디렉토리

```
wordchain-battle/
├── server.js       # WS 서버 + createApp()
├── game.js         # 순수 게임 로직
├── words.js        # 단어 DB 로드 + 검증
├── data/
│   └── words.json  # 번들 단어 리스트 (git 추적)
├── scripts/
│   └── build-wordlist.js  # CSV -> JSON 빌드 스크립트
├── assets/
│   └── key-art.svg
├── package.json
├── CLAUDE.md
├── docs/
│   ├── PROJECT.md
│   └── CHANGELOG.md
└── public/
    ├── index.html
    ├── css/style.css
    └── js/
        ├── main.js
        ├── network.js
        ├── ui.js
        └── input.js
```

## 테스트 실행법

```bash
# 단독 실행
node wordchain-battle/server.js --port 3008

# 통합 런처
node launcher/server.js
```

## 포트

- 단독 실행: 3008 (충돌 시 +1 폴백)
- 통합 런처: 3000 (/wordchain-battle/ 경로)
