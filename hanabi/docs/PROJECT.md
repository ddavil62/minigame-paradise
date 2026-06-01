# 하나비(Hanabi) 기획서

> 최종 업데이트: 2026-06-01 — 1차 코어 + 대기 화면 가이드 슬라이더 (Playwright 61/61 PASS)

## 프로젝트 개요

LAN 2인 완전 협력 카드게임 하나비. 미니게임 천국 패키지의 7번째 종목. 각자 자기 손패를 볼 수 없는 정보 비대칭을 서버 권위 아키텍처로 강제하며, 5색 불꽃을 협력으로 1→5 쌓아 최대 25점을 함께 만든다.

## 기술 스택

| 항목 | 기술 |
|------|------|
| 런타임 | Node.js 18+ (ESM, `"type":"module"`) |
| 서버 | 순수 `node:http` + `ws` (Express 미사용, noServer 모드) |
| 클라이언트 | 바닐라 JS (프레임워크 0). 게임플레이 시각은 CSS/HTML만, 대기 화면 룰 가이드만 인포그래픽 7장 |
| 테스트 | Playwright |
| 통합 | launcher 단일 포트(3000) path 라우팅 `/hanabi/`, 단독 실행 포트 3007 |

## 아키텍처

### 디렉토리 구조

```
hanabi/
├── game.js            # 순수 게임 로직 (서버 불필요 단위 테스트 가능)
├── server.js          # WS 서버 + createApp() factory + 단독 실행 (PNG MIME 포함)
├── public/            # index.html + css/style.css + js/{main,network}.js + assets/guide/(7장)
├── docs/              # RULEBOOK.md / PROJECT.md / CHANGELOG.md / GUIDE-INFOGRAPHIC-PLAN.md
└── tests/             # Playwright rulebook-c1~c11 (61개)
```

### 핵심 모듈

| 모듈 | 파일 | 역할 |
|------|------|------|
| 게임 로직 | `game.js` | 덱·손패·토큰·힌트/내기/버리기 판정·종료·점수·손패 마스킹 (순수 함수) |
| WS 서버 | `server.js` | `createApp()` → `{ handleHttp, handleUpgrade, setHostUrl }`, 룸 관리, 개별 마스킹 broadcast |
| 렌더링 | `public/js/main.js` | 상태 렌더링, 행동 모드 입력, 종료 화면, 로비 복귀, 대기 화면 가이드 슬라이더(`initGuideSlider`) |
| 통신 | `public/js/network.js` | WS 연결(`/hanabi/ws` ↔ 단독 `/ws`), 메시지 송수신 |

### 핵심 설계 원칙

- **서버 권위 + 손패 가림**: `snapshotForPlayer(state, playerId)`가 본인 손패 `color`/`number`를 명시적 null로 마스킹. 매 액션 후 각 플레이어에게 개별 마스킹 STATE 전송. 받은 힌트(`clues`)는 공개.

## 기능 목록

| 기능 | 설명 | 상태 |
|------|------|------|
| 덱·셋업 | 50장(5색×10, 분포 3/2/2/2/1), 2인 각 5장, 토큰 8·3 | 완료 |
| 힌트 주기 | 색/숫자 힌트, 0장 힌트·토큰0 차단, 받은 힌트 카드 마킹 | 완료 |
| 카드 내기 | 순번 성공/오연주 판정, 폭탄 소진, 5완성 토큰 회수, 보충 | 완료 |
| 카드 버리기 | 토큰 회수, 토큰8 시 차단, 보충 | 완료 |
| 게임 종료 | 25점 승리 / 폭탄3 패배 / 덱소진 양쪽 1턴, 점수·등급표 | 완료 |
| 손패 가림 보장 | 서버 마스킹, raw WS 누설 0 검증 | 완료 |
| 런처 통합 | 로비 카드 + `/hanabi/` 라우팅 | 완료 |
| 재대결/이탈 | REMATCH 양쪽 동의, OPPONENT_LEFT | 완료 |
| 대기 화면 가이드 | 룰 인포그래픽 7장 슬라이더(버튼·키보드·스와이프, 인디케이터 N/7) | 완료 |
| AI 봇 | `bot.js` 협력 휴리스틱 | 미착수 |
| 멀티컬러 변형 | 6번째 색 옵션 | 미착수 |

## 알려진 제약사항

- 2인 전용 (표준 2~5인 중 LAN 1:1 통합 패키지 정책으로 2인 고정).
- AI 봇 미지원 — 1/2 모드 비활성 (`botAvailable:false`).
- 멀티컬러 변형 미포함 (표준 5색 50장만).
- 힌트 마킹 항상 표시 (on/off 옵션 없음).
- 가이드 슬라이더 이미지 404 시 placeholder/onerror 폴백 없음 (실제 7장 전부 200, `min-height:200px`로 레이아웃 보존). — AD3 WARN.
- AD3 WARN(1차 코어 3건: 하드코딩 HEX, 불꽃 색명 라벨 하단 돌출, 결과 폰트 계층 / 가이드 2건: 404 폴백 부재, alt 포맷 경미 불일치) — 기능 이상 없는 UI 폴리시.

## 향후 계획

- AI 협력 봇(`bot.js`) — 안전한 힌트/버리기 휴리스틱 (중간)
- 멀티컬러 변형 옵션 (중간)
- 힌트 마킹 on/off 난이도 옵션 (낮음)
- 가이드 이미지 `<img onerror>` 폴백 (낮음, AD3 WARN)
- UI 폴리시(AD3 WARN), 불꽃 애니메이션·사운드 (낮음)

## 참조

- 권위 룰북: `docs/RULEBOOK.md`
- 변경 이력: `docs/CHANGELOG.md`
- 가이드 인포그래픽 제작 명세: `docs/GUIDE-INFOGRAPHIC-PLAN.md`
- 작업 컨벤션: `CLAUDE.md`
