# 요트 다이스 (Yahtzee)

LAN 1:1 턴 교대 5다이스 점수표 게임. 정통 Yahtzee 룰.

## 실행

```bash
# 단독 실행
cd minigames/yahtzee
node server.js --port 3010

# 또는 통합 런처 (단일 포트 3000)
cd minigames
node launcher/server.js
# 브라우저에서 http://localhost:3000 접속 → 요트 다이스 카드 클릭
```

## 게임 방법

1. 두 명이 접속하고 양쪽 모두 "준비 완료" 클릭 → 게임 시작.
2. 본인 턴이 되면 [주사위 굴리기] 클릭 → 5개 다이스가 굴려진다.
3. 유지할 다이스를 클릭해서 keep 표시 → [다시 굴리기] (1턴 최대 3번).
4. 점수표에서 카테고리 1개 클릭 → 점수 기록 + 턴 종료.
5. 양쪽이 13 카테고리 전부 채우면 (총 26턴) 종료 → 총점 비교.

## 13 카테고리

**Upper (1~6)**: Aces, Twos, Threes, Fours, Fives, Sixes — 해당 숫자 합.
- 상단 합 ≥ 63 → +35 보너스.

**Lower**:
- Three of a Kind: 같은 숫자 3개 이상 → 다이스 합
- Four of a Kind: 같은 숫자 4개 이상 → 다이스 합
- Full House: 3+2 → 25점
- Small Straight: 연속 4개 → 30점
- Large Straight: 연속 5개 → 40점
- Yahtzee: 5개 같음 → 50점
- Chance: 아무거나 → 다이스 합

**야츠 보너스**: yahtzee 50점 기록 후 추가 야츠 발생 시 +100점 누적.

## 테스트

```bash
node tests/smoke.test.js
```
