[목적유형: feature / visual_change: ui / pipeline: full / clarity: high, grilled: false]
핵심 목적: 코드네임 클래식(2:2 4인)에 완전 오프라인 AI 봇 추가. 빌드타임 생성 590단어 카테고리/태그 정적맵(bot-knowledge.js)만으로 런타임 동작(LLM API·임베딩·네트워크 0). 스파이마스터 봇(암살자·상대·중립 회피하며 단서+숫자 생성) + 요원 봇(단서 태그 역조회로 추측) 양역할. AI채우기로 빈 슬롯 1~3개 봇 배정. botAvailable false→true. 휴먼 게임 회귀 없음.
수용기준: (1)런타임 0의존성 npm 없이 동작 (2)스파이마스터 자기팀 ≥2단어 공통 태그 단서, 암살자/상대 커버 태그 제외 (3)요원 단서 태그 역조회 추측+위험 회피 (4)암살자 회피 단서 (5)AI채우기 빈 슬롯 N개→봇 N개 (6)휴먼 4인 기존동작 무회귀 (7)태그맵 590단어 100% 커버(미매핑 0) (8)games.json botAvailable true (9)봇 smoke PASS.
범위제외: LLM·임베딩, 명시적 난이도조절, 봇 학습, codenames-duet, 5인+, 봇 채팅.
