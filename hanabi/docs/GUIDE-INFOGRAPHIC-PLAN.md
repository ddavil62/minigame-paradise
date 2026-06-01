# 하나비 인포그래픽 가이드 메뉴 제작 계획서

> GPT Image 2.0으로 생성하는 인-게임 가이드 메뉴(인포그래픽 7패널) 제작 명세서.
> 모든 수치·규칙은 `docs/RULEBOOK.md` §1~§10에서 직접 인용했다. 색 토큰은 `public/css/style.css`에서 추출했다.
> **전제**: GPT Image 2.0이 한글 텍스트를 이미지에 직접 렌더링하므로, 각 패널은 한글 텍스트까지 박힌 완성형 인포그래픽으로 생성한다.

## 0. 이 문서의 목적과 범위

GPT Image 2.0으로 하나비 가이드 메뉴 패널을 생성하기 위한 완전한 제작 명세서다. 사용자가 이 문서만 보고 프롬프트를 복붙하여 바로 생성할 수 있도록, 한글 텍스트 문자열·구도·팔레트·프롬프트를 모두 확정형으로 기술한다. 룰북 §1~§10의 수치와 규칙은 추측 없이 원문 그대로 인용한다.

---

## 1. 전체 컨셉 및 구조

### 1-1. 가이드 형태

**좌우 스와이프형 카드 패널 7장.** 각 패널은 독립적인 인포그래픽 한 장으로 완결된다. 패널을 순서대로 읽으면 게임을 시작할 수 있는 충분한 지식을 갖추도록 정보 흐름을 설계한다.

| 패널 | 제목 | 룰북 근거 |
|------|------|-----------|
| P1 | 게임 개요 — "우리는 같은 팀" | §1 |
| P2 | 핵심 반전 — "내 손패는 내가 못 본다" | §1, §3 |
| P3 | 구성물 — 덱 50장 + 토큰 | §2 |
| P4 | 한 번의 턴 — 3가지 행동 중 하나 | §4 |
| P5 | 힌트 규칙 — 주는 법, 받는 법 | §5 |
| P6 | 카드 내기 & 버리기 | §6, §7 |
| P7 | 게임 종료 3가지 + 점수 등급 | §9, §10 |

### 1-2. 종횡비 및 해상도

- **기본 종횡비: 2:3 (세로형)**
- **해상도: 1024 × 1536 px**
- 근거: 모바일 세로 화면의 가이드 패널로 최적화. 데스크톱에서는 max-width로 중앙 배치. GPT Image 2.0이 안정 지원하는 세로형 해상도.

---

## 2. 글로벌 스타일 가이드

### 2-1. 팔레트 (style.css 추출 — 수치 변경 금지)

| 토큰명 | HEX | 용도 |
|--------|-----|------|
| `--bg` | `#0E1320` | 패널 최외곽 배경 |
| `--panel` | `#1A2133` | 카드·박스 배경 |
| `--panel-2` | `#232C42` | 서브 박스·힌트 패널 |
| `--line` | `#313B54` | 구분선·테두리 |
| `--text` | `#E8ECF5` | 본문 텍스트 |
| `--text-dim` | `#93A0BD` | 보조 텍스트·레이블 |
| `--accent` | `#FF6B35` | 강조색(포인트) |
| `--card-white` | `#F5F5F5` | 흰 카드 배경 |
| `--card-red` | `#E74C3C` | 빨간 카드 배경 |
| `--card-blue` | `#2980B9` | 파란 카드 배경 |
| `--card-green` | `#27AE60` | 초록 카드 배경 |
| `--card-yellow` | `#F1C40F` | 노란 카드 배경 |
| `--card-hidden` | `#6B7280` | 가려진 카드 배경 (대각선 패턴) |
| `--token-clue` | `#3498DB` | 힌트 토큰 (파란 원) |
| `--token-fuse` | `#E74C3C` | 폭탄 토큰 (빨간 원) |
| `--token-spent` | `#3A3F4B` | 소진된 토큰 (어두운 원) |

### 2-2. 일러스트 톤

- **플랫 모던 벡터 인포그래픽**. 그라디언트는 배경 노이즈 수준으로만 허용.
- 픽셀아트 금지. 포토리얼 금지. 만화체 금지.
- 카드 표현: 둥근 모서리 직사각형. 2:3 비율(실제 게임 카드 비율 일치).
- 아이콘: 단순 도형 기반. 원(토큰), 직사각형(카드), 화살표(흐름).
- 폰트 무드: 굵고 깔끔한 고딕 계열 한글. 숫자는 특히 굵게(weight 800).
- 여백: 패널 사방 최소 32px. 요소 간 수직 간격 최소 16px.
- 배경: `#0E1320` 단색 베이스 위에 패널 `#1A2133` 박스로 정보 구역 구분.
- 색이름별 카드는 반드시 위 팔레트 HEX 정확히 사용.

### 2-3. 공통 프리픽스 프롬프트 (매 패널 프롬프트 앞에 반드시 붙이기)

```
Flat modern vector infographic, dark navy background #0E1320, card panels #1A2133, accent color #FF6B35, clean sans-serif Korean typography, no gradients except subtle background, no pixel art, no photorealism, 1024x1536 portrait. Style must be identical across all panels: same background, same card corner radius, same font weight hierarchy, same color palette. Render the following Korean text exactly as written, with no translation or substitution:
```

이 프리픽스를 모든 패널 프롬프트 앞에 붙인다. GPT Image 2.0의 스타일 드리프트를 억제한다.

### 2-4. 패널 간 일관성 유지 팁

1. GPT Image의 "Edit"/"Variation"보다 매 패널을 독립 생성하되, 공통 프리픽스를 동일하게 유지한다.
2. 첫 패널(P1) 생성 후 결과가 만족스러우면, 그 패널을 레퍼런스 이미지로 첨부하고 나머지 패널을 생성한다 (GPT Image 2.0 이미지 참조 기능 활용).
3. 배경색 HEX가 흐릿해 보이면 프롬프트에 "background must be exactly #0E1320, very dark navy, not black"을 추가한다.
4. 한글이 깨진 경우 "Korean text must be rendered in clean Noto Sans KR or Malgun Gothic style, not as decorative glyphs"를 추가한다.

---

## 3. 패널별 상세 명세

### P1 — 게임 개요: "우리는 같은 팀"

**룰북 근거**: §1

**전달할 핵심 정보**
- 장르: 완전 협력(co-op) — 둘이 한 팀, 함께 이기거나 함께 진다
- 목표: 5색 불꽃을 각 색마다 1→2→3→4→5 순서로 쌓아 최대 25점
- 직접 의사소통 금지 — 제한된 힌트 토큰으로만 정보 전달

**이미지에 넣을 한글 텍스트 전문**
```
[상단 헤더]
🎇 하나비 — 빠른 규칙 가이드   1/7
[제목] 우리는 같은 팀
[부제목] 협력 카드게임 | 2인 | 최대 25점
[본문 블록 ①] 목표 / 5색 불꽃을 1→5 순서로 함께 완성
[본문 블록 ②] 승패는 공동 / 둘이 함께 이기거나, 둘이 함께 진다
[본문 블록 ③] ⚠ 주의 / "내 카드가 뭐야?" — 직접 질문 금지! / 오직 힌트 토큰을 소비해야만 정보 전달 가능
[하단 5색 불꽃 라벨] 흰  빨  파  초  노 / 각 색 최대 5점 → 합계 최대 25점
```

**구도 스케치**
```
┌─────────────────────────────────┐
│  🎇 하나비 — 빠른 규칙 가이드   1/7 │  ← 헤더 바 (#1A2133)
├─────────────────────────────────┤
│     [불꽃 일러스트 5색 원형]      │  ← 중앙 상단 히어로 비주얼
│     흰  빨  파  초  노            │
│     ○  ○  ○  ○  ○  →  25점      │
├─────────────────────────────────┤
│  우리는 같은 팀                  │  ← 대제목
│  협력 카드게임 | 2인 | 최대 25점  │  ← 소제목
├─────────────────────────────────┤
│  🎯 목표           │ 🤝 공동 승패 │  ← 2열 카드 박스
├─────────────────────────────────┤
│  ⚠ 직접 질문 금지! → 힌트 토큰만  │  ← 경고 배너 (#FF6B35)
└─────────────────────────────────┘
```

**GPT Image 2.0 프롬프트**
```
Flat modern vector infographic, dark navy background #0E1320, card panels #1A2133, accent color #FF6B35, clean sans-serif Korean typography, no gradients except subtle background, no pixel art, no photorealism, 1024x1536 portrait. Style must be identical across all panels: same background, same card corner radius, same font weight hierarchy, same color palette. Render the following Korean text exactly as written, with no translation or substitution:

Layout: portrait infographic panel about cooperative card game Hanabi.
TOP HEADER BAR (background #1A2133, full width, height ~60px): render text "🎇 하나비 — 빠른 규칙 가이드" on left, "1/7" on right, text color #93A0BD, font size small.
HERO SECTION (center upper area): five rounded rectangles representing firework cards in a horizontal row. Colors exactly: #F5F5F5 (label "흰"), #E74C3C (label "빨"), #2980B9 (label "파"), #27AE60 (label "초"), #F1C40F (label "노"). Each card shows "5" in center. An arrow "→" points to a score badge showing "25점" in #FF6B35.
TITLE BLOCK: large bold Korean text "우리는 같은 팀" in #E8ECF5. Below it smaller text "협력 카드게임 | 2인 | 최대 25점" in #93A0BD.
TWO INFO CARDS side by side (background #232C42, rounded corners):
Left card: icon of target/goal, bold text "목표", below it "5색 불꽃을 1→5 순서로 함께 완성".
Right card: icon of handshake/team, bold text "공동 승패", below it "둘이 함께 이기거나 함께 진다".
WARNING BANNER (border color #FF6B35, background #1A2133): text "⚠ 직접 질문 금지! 오직 힌트 토큰을 소비해야만 정보 전달 가능" in #FF6B35 for the warning icon/first part, #E8ECF5 for the rest.
Overall background #0E1320, all text in Korean as specified.
```

---

### P2 — 핵심 반전: "내 손패는 내가 못 본다"

**룰북 근거**: §1, §3-3

**전달할 핵심 정보**
- 자기 손패를 자신만 볼 수 없다 — 카드를 바깥쪽으로 들고 있음
- 상대 손패는 내가 볼 수 있다
- 게임의 정체성이며 가장 중요한 규칙

**이미지에 넣을 한글 텍스트 전문**
```
[헤더] 🎇 하나비 — 빠른 규칙 가이드   2/7
[제목] 핵심 반전!
[강조 문구] 내 손패는 내가 볼 수 없다
[왼쪽 플레이어 라벨] 나 (Player 1)
[오른쪽 플레이어 라벨] 상대 (Player 2)
[화살표 라벨] 상대 손패는 내가 봄 ✓
[가려진 카드 라벨] 내 손패는 내가 모름 ?
[설명] 카드를 자신 쪽으로 보지 않고 바깥쪽(상대 방향)으로 들고 있는다
[하단 팁] 💡 힌트를 잘 활용해서 내 카드를 추리하자!
```

**구도 스케치**
```
┌─────────────────────────────────┐
│  🎇 하나비 — 빠른 규칙 가이드  2/7│
├─────────────────────────────────┤
│         핵심 반전!               │  ← 대제목 (#FF6B35)
│   내 손패는 내가 볼 수 없다      │  ← 부제목 (굵게)
├─────────────────────────────────┤
│  [나]              [상대]        │  ← 얼굴 아이콘
│  [가려진 카드 ????]              │  ← 회색 줄무늬 카드 5장
│  ← ← ← 양방향 시선 화살표 → →    │
│  [색깔 카드 3 2 5 1 4]           │  ← 공개된 내 카드 (상대 시점)
│  상대 손패는 내가 봄 ✓           │
├─────────────────────────────────┤
│ 바깥쪽(상대 방향)으로 들고 있는다│
├─────────────────────────────────┤
│ 💡 힌트로 내 카드를 추리하자!     │
└─────────────────────────────────┘
```

**GPT Image 2.0 프롬프트**
```
Flat modern vector infographic, dark navy background #0E1320, card panels #1A2133, accent color #FF6B35, clean sans-serif Korean typography, no gradients except subtle background, no pixel art, no photorealism, 1024x1536 portrait. Style must be identical across all panels: same background, same card corner radius, same font weight hierarchy, same color palette. Render the following Korean text exactly as written, with no translation or substitution:

Layout: portrait infographic explaining the key twist of Hanabi — players cannot see their own hand.
TOP HEADER BAR (background #1A2133): left "🎇 하나비 — 빠른 규칙 가이드", right "2/7", color #93A0BD.
TITLE BLOCK: very large bold text "핵심 반전!" in #FF6B35. Below it large bold text "내 손패는 내가 볼 수 없다" in #E8ECF5.
CENTRAL ILLUSTRATION (most of the panel): two player figures facing each other.
- Left player labeled "나 (Player 1)": holds 5 cards facing AWAY from themselves — the card backs show diagonal grey stripes pattern (#6B7280 and #4B5563), with "?" symbols. These are hidden to the left player.
- Right player labeled "상대 (Player 2)": holds 5 visible colored cards facing away from themselves. The visible side of LEFT player's cards shows colored cards: one #E74C3C with "3", one #2980B9 with "2", one #27AE60 with "5", one #F1C40F with "1", one #F5F5F5 with "4".
- A horizontal double-headed arrow between them. Above the arrow: "상대 손패는 내가 봄 ✓" in #27AE60. Below it: "내 손패는 내가 모름 ?" in #93A0BD.
DESCRIPTION BOX (background #1A2133, rounded): text "카드를 자신 쪽으로 보지 않고 바깥쪽(상대 방향)으로 들고 있는다" in #E8ECF5.
TIP BANNER (background #232C42, left border #FF6B35 thick): "💡 힌트를 잘 활용해서 내 카드를 추리하자!" in #E8ECF5.
```

---

### P3 — 구성물: 덱 50장 + 토큰

**룰북 근거**: §2-1, §2-2

**전달할 핵심 정보**
- 카드 총 50장, 5색, 각 색 10장, 숫자별 분포: 1은 3장, 2/3/4는 2장, 5는 1장
- 힌트 토큰 8개 (파란 원), 폭탄 토큰 3개 (빨간 원)
- 2인 기준 각 5장 손패로 시작

**이미지에 넣을 한글 텍스트 전문**
```
[헤더] 🎇 하나비 — 빠른 규칙 가이드   3/7
[제목] 구성물
[카드 섹션 제목] 카드 — 총 50장 (5색 × 각 10장)
[숫자 분포 표] 숫자/각 색당 장수/전략 포인트
  1 / 3장 / 가장 흔함
  2 / 2장 / —
  3 / 2장 / —
  4 / 2장 / —
  5 / 1장 / ⚠ 가장 희귀! 버리면 그 색 완성 불가
[5색 라벨] 흰  빨  파  초  노
[토큰 섹션 제목] 토큰
[힌트 토큰] 힌트 토큰 8개 — 힌트를 줄 때 소비, 버리기/5완성 시 회수
[폭탄 토큰] 폭탄 토큰 3개 — 실수마다 소진, 3개 모두 소진 = 즉시 패배
[시작 손패] 2인 시작 손패: 각 5장
```

**GPT Image 2.0 프롬프트**
```
Flat modern vector infographic, dark navy background #0E1320, card panels #1A2133, accent color #FF6B35, clean sans-serif Korean typography, no gradients except subtle background, no pixel art, no photorealism, 1024x1536 portrait. Style must be identical across all panels: same background, same card corner radius, same font weight hierarchy, same color palette. Render the following Korean text exactly as written, with no translation or substitution:

Layout: portrait infographic showing Hanabi game components.
TOP HEADER BAR (background #1A2133): left "🎇 하나비 — 빠른 규칙 가이드", right "3/7", color #93A0BD.
TITLE: large bold "구성물" in #E8ECF5.
CARD SECTION (background #232C42, rounded box):
Section label: "카드 — 총 50장 (5색 × 각 10장)" in #93A0BD small text.
Five card thumbnails in a row, each ~48x72px rounded corners: card1 bg #F5F5F5 text #2b2b2b, card2 bg #E74C3C text white, card3 bg #2980B9 text white, card4 bg #27AE60 text white, card5 bg #F1C40F text #5a4a00. Labels below: "흰","빨","파","초","노" in #93A0BD.
Distribution table (background #1A2133, rounded, border #313B54):
Header "숫자 | 각 색당 장수 | 전략 포인트" in #93A0BD bold.
"1 | 3장 | 가장 흔함" / "2 | 2장 | —" / "3 | 2장 | —" / "4 | 2장 | —" in #E8ECF5.
"5 | 1장 | ⚠ 가장 희귀! 버리면 그 색 완성 불가" — the "5" and warning in #FF6B35.
TOKEN SECTION (background #232C42, rounded box):
"토큰" bold in #E8ECF5.
Clue token row: 8 filled circles color #3498DB, label "힌트 토큰 8개" bold #E8ECF5, below "소비: 힌트 / 회수: 버리기·5완성" #93A0BD.
Fuse token row: 3 filled circles color #E74C3C, label "폭탄 토큰 3개" bold #E8ECF5, below "실수마다 소진 — 3개 모두 소진 = 즉시 패배" with warning in #FF6B35.
BOTTOM INFO BAR (background #1A2133): "2인 시작 손패: 각 5장" centered #93A0BD.
```

---

### P4 — 한 번의 턴: 3가지 행동 중 하나

**룰북 근거**: §4

**전달할 핵심 정보**
- 자기 차례에 정확히 하나 수행 — A(힌트), B(카드 내기), C(버리기). 패스 없음
- B/C 후 덱에서 1장 보충 (덱 비면 보충 없음), A(힌트)는 보충 없음

**이미지에 넣을 한글 텍스트 전문**
```
[헤더] 🎇 하나비 — 빠른 규칙 가이드   4/7
[제목] 내 차례에 딱 하나만!
[행동 A] A. 힌트 주기 / 힌트 토큰 1개 소비 / 상대에게 색 또는 숫자 정보 전달 / 카드 보충 없음
[행동 B] B. 카드 내기 / 내 손패 카드 1장을 불꽃 자리에 시도 / 성공 → 불꽃 진행 / 실패 → 폭탄 토큰 1개 소진 / 이후 덱에서 1장 보충
[행동 C] C. 버리기 / 내 손패 카드 1장을 버림 더미로 / 힌트 토큰 1개 회수 (상한 8) / 이후 덱에서 1장 보충
[하단 규칙] 반드시 셋 중 하나를 해야 한다 — 패스 없음!
```

**GPT Image 2.0 프롬프트**
```
Flat modern vector infographic, dark navy background #0E1320, card panels #1A2133, accent color #FF6B35, clean sans-serif Korean typography, no gradients except subtle background, no pixel art, no photorealism, 1024x1536 portrait. Style must be identical across all panels: same background, same card corner radius, same font weight hierarchy, same color palette. Render the following Korean text exactly as written, with no translation or substitution:

Layout: portrait infographic showing the 3 possible actions per turn in Hanabi.
TOP HEADER BAR (background #1A2133): left "🎇 하나비 — 빠른 규칙 가이드", right "4/7", color #93A0BD.
TITLE: large bold "내 차례에 딱 하나만!" in #E8ECF5. Below it a branching arrow splitting into 3 paths.
THREE ACTION CARDS arranged vertically (each tall rounded box, background #232C42, border #313B54, equal height):
Card A (left accent bar #3498DB): big "A" badge in #3498DB. Title "힌트 주기" #E8ECF5. Lines #93A0BD: "힌트 토큰 1개 소비" / "상대에게 색 또는 숫자 정보 전달" / "카드 보충 없음". Icon: blue circle token with minus sign.
Card B (left accent bar #27AE60): big "B" badge in #27AE60. Title "카드 내기" #E8ECF5. Lines: "내 손패 카드 1장을 불꽃 자리에 시도" #93A0BD, "성공 → 불꽃 진행" #27AE60, "실패 → 폭탄 토큰 1개 소진" #E74C3C, "이후 덱에서 1장 보충" #93A0BD. Icon: card with arrow to firework slot.
Card C (left accent bar #E67E22): big "C" badge in #E67E22. Title "버리기" #E8ECF5. Lines #93A0BD: "내 손패 카드 1장을 버림 더미로" / "힌트 토큰 1개 회수 (상한 8)" / "이후 덱에서 1장 보충". Icon: card with discard arrow plus one blue token.
BOTTOM WARNING BAR (border #FF6B35, background #1A2133): "⚠ 반드시 셋 중 하나를 해야 한다 — 패스 없음!" warning in #FF6B35, rest #E8ECF5.
```

---

### P5 — 힌트 규칙: 주는 법, 받는 법

**룰북 근거**: §5-1, §5-2

**전달할 핵심 정보**
- 힌트는 색 힌트 또는 숫자 힌트 (혼합 불가)
- 해당 속성 카드를 전부 가리켜야 함 — 일부만 불가
- 0장 힌트 금지, 토큰 0개이면 힌트 불가

**이미지에 넣을 한글 텍스트 전문**
```
[헤더] 🎇 하나비 — 빠른 규칙 가이드   5/7
[제목] 힌트 규칙
[종류 섹션] 힌트 두 종류 (하나만 선택)
[색 힌트] 색 힌트 / "당신의 파란 카드는 이것들입니다" / → 해당 색 카드 전부를 가리켜야 함
[숫자 힌트] 숫자 힌트 / "당신의 3은 이것들입니다" / → 해당 숫자 카드 전부를 가리켜야 함
[규칙 박스] 반드시 지켜야 할 규칙
  ✓ 해당 속성의 카드를 빠짐없이 전부 가리켜야 한다
  ✗ 일부만 가리키는 것은 불가
  ✗ 0장 힌트 금지: 해당 색·숫자가 없으면 그 힌트를 줄 수 없다
  ✗ 색과 숫자를 같은 힌트에 섞을 수 없다
  ✗ 힌트 토큰이 0개이면 힌트 자체가 불가
```

**GPT Image 2.0 프롬프트**
```
Flat modern vector infographic, dark navy background #0E1320, card panels #1A2133, accent color #FF6B35, clean sans-serif Korean typography, no gradients except subtle background, no pixel art, no photorealism, 1024x1536 portrait. Style must be identical across all panels: same background, same card corner radius, same font weight hierarchy, same color palette. Render the following Korean text exactly as written, with no translation or substitution:

Layout: portrait infographic explaining Hanabi clue rules.
TOP HEADER BAR (background #1A2133): left "🎇 하나비 — 빠른 규칙 가이드", right "5/7", color #93A0BD.
TITLE: large bold "힌트 규칙" in #E8ECF5.
CLUE TYPES SECTION (background #232C42, rounded): label "힌트 두 종류 (하나만 선택)" #93A0BD.
Two side-by-side boxes:
Left box (background #1A2133, left border #3498DB thick): color palette icon. Bold "색 힌트" #E8ECF5. "'당신의 파란 카드는 이것들입니다'" #93A0BD italic. "→ 해당 색 카드 전부를 가리켜야 함" #E8ECF5. Show 3 small blue cards (#2980B9) highlighted with checkmarks.
Right box (background #1A2133, left border #FF6B35 thick): number icon. Bold "숫자 힌트" #E8ECF5. "'당신의 3은 이것들입니다'" #93A0BD italic. "→ 해당 숫자 카드 전부를 가리켜야 함" #E8ECF5. Show 2 cards with "3" highlighted with checkmarks (different colors).
RULES SECTION (background #1A2133, rounded, border #313B54): header "반드시 지켜야 할 규칙" bold #E8ECF5.
"✓ 해당 속성의 카드를 빠짐없이 전부 가리켜야 한다" checkmark #27AE60.
"✗ 일부만 가리키는 것은 불가" X #E74C3C.
"✗ 0장 힌트 금지: 해당 색·숫자가 없으면 그 힌트를 줄 수 없다" X #E74C3C emphasized.
"✗ 색과 숫자를 같은 힌트에 섞을 수 없다" X #E74C3C.
"✗ 힌트 토큰이 0개이면 힌트 자체가 불가" X #E74C3C.
```

---

### P6 — 카드 내기 & 버리기

**룰북 근거**: §6, §7, §8

**전달할 핵심 정보**
- 내기 성공: 빈 색→1, N쌓임→N+1일 때만. 실패: 버림 더미 + 폭탄 토큰 1개 소진
- 5 성공 시 힌트 토큰 1개 회수 (상한 8)
- 버리기: 힌트 토큰 1개 회수, 토큰 8개이면 버리기 불가
- 5(숫자)는 색당 1장뿐 — 잃으면 그 색 최대 4점에 영구 묶임

**이미지에 넣을 한글 텍스트 전문**
```
[헤더] 🎇 하나비 — 빠른 규칙 가이드   6/7
[제목] 카드 내기 & 버리기
[내기 섹션] B. 카드 내기 — 성공과 실패
[성공 조건] 성공 조건 / 그 색이 비어있으면 → 1만 성공 / 이미 N이 쌓였으면 → N+1만 성공
[실패 결과] 실패 시 / 카드는 버림 더미로 / 폭탄 토큰 1개 소진 ⚠
[5완성 보너스] ★ 5를 성공적으로 내면 / 힌트 토큰 1개 회수! (상한 8)
[버리기 섹션] C. 버리기 / 힌트 토큰 1개 회수 (상한 8) / ⚠ 토큰이 8개 가득 차면 버리기 불가!
[경고 박스] ⚠ 5는 색당 단 1장! / 5를 버리면 그 색은 영영 최대 4점에 묶인다
```

**GPT Image 2.0 프롬프트**
```
Flat modern vector infographic, dark navy background #0E1320, card panels #1A2133, accent color #FF6B35, clean sans-serif Korean typography, no gradients except subtle background, no pixel art, no photorealism, 1024x1536 portrait. Style must be identical across all panels: same background, same card corner radius, same font weight hierarchy, same color palette. Render the following Korean text exactly as written, with no translation or substitution:

Layout: portrait infographic explaining play and discard actions in Hanabi.
TOP HEADER BAR (background #1A2133): left "🎇 하나비 — 빠른 규칙 가이드", right "6/7", color #93A0BD.
TITLE: large bold "카드 내기 & 버리기" in #E8ECF5.
PLAY SECTION (background #232C42, rounded): label "B. 카드 내기 — 성공과 실패" bold #E8ECF5.
Two side-by-side boxes:
Success box (background #1A2133, border #27AE60): bold "성공 ✓" #27AE60. "그 색이 비어있으면 → 1만 성공" / "이미 N이 쌓였으면 → N+1만 성공" #E8ECF5. Show a firework slot with "3" and an arrow from card "4" with checkmark.
Failure box (background #1A2133, border #E74C3C): bold "실패 ✗" #E74C3C. "카드는 버림 더미로" / "폭탄 토큰 1개 소진 ⚠" #E8ECF5 with warning #E74C3C. Show red fuse token with minus icon.
BONUS BANNER (background #1A2133, border #FF6B35, gold star): "★ 5를 성공적으로 내면 힌트 토큰 1개 회수! (상한 8)" star #FF6B35, text #E8ECF5.
DISCARD SECTION (background #232C42, rounded): label "C. 버리기" bold #E8ECF5.
"힌트 토큰 1개 회수 (상한 8)" #E8ECF5. "⚠ 토큰이 8개 가득 차면 버리기 불가!" #FF6B35. Show 8 blue circles fully filled.
CRITICAL WARNING BOX (background #1A2133, border #E74C3C thick): "⚠ 5는 색당 단 1장!" #E74C3C large bold. "5를 버리면 그 색은 영영 최대 4점에 묶인다" #E8ECF5. Show a card "5" on #27AE60 with red X slash.
```

---

### P7 — 게임 종료 3가지 + 점수 등급

**룰북 근거**: §9, §10

**전달할 핵심 정보**
- 종료-1: 25점 만점 즉시 승리
- 종료-2: 폭탄 토큰 3개 모두 소진 즉시 패배
- 종료-3: 덱 소진 → 마지막 라운드 (양쪽 각 1턴씩 더 진행 후 종료)
- 점수 등급 6단계: 0~5 처참함 / 6~10 아쉬움 / 11~15 무난함 / 16~20 훌륭함 / 21~24 경이로움 / 25 전설의 불꽃놀이!

**이미지에 넣을 한글 텍스트 전문**
```
[헤더] 🎇 하나비 — 빠른 규칙 가이드   7/7
[제목] 게임이 끝나는 3가지 순간
[종료-1] ① 25점 만점! / 5색 불꽃 전부 5까지 완성 / → 즉시 승리! 🎆
[종료-2] ② 폭탄 3개 전부 소진 / 실수를 3번 → 폭탄 토큰 3개 모두 없어짐 / → 즉시 패배
[종료-3] ③ 덱이 바닥남 / 카드를 더 이상 뽑을 수 없음 / → 마지막 라운드: 양쪽이 각 1턴씩 더 진행 후 종료
[점수 섹션] 점수 = 5색 불꽃 현재 숫자의 합 (최대 25)
[등급표] 0–5 처참함 / 6–10 아쉬움 / 11–15 무난함 / 16–20 훌륭함 / 21–24 경이로움 / 25 ★ 전설의 불꽃놀이!
```

**GPT Image 2.0 프롬프트**
```
Flat modern vector infographic, dark navy background #0E1320, card panels #1A2133, accent color #FF6B35, clean sans-serif Korean typography, no gradients except subtle background, no pixel art, no photorealism, 1024x1536 portrait. Style must be identical across all panels: same background, same card corner radius, same font weight hierarchy, same color palette. Render the following Korean text exactly as written, with no translation or substitution:

Layout: portrait infographic showing 3 end conditions and scoring grades for Hanabi.
TOP HEADER BAR (background #1A2133): left "🎇 하나비 — 빠른 규칙 가이드", right "7/7", color #93A0BD.
TITLE: large bold "게임이 끝나는 3가지 순간" in #E8ECF5.
THREE END CONDITION CARDS (stacked vertically, each rounded box):
Card 1 (background #1A2133, border #F1C40F thick gold): badge "①" #F1C40F. Bold "25점 만점! 🎆 즉시 승리!" #F1C40F. "5색 불꽃 전부 5까지 완성" #E8ECF5. Show 5 small firework slots all lit: #F5F5F5,#E74C3C,#2980B9,#27AE60,#F1C40F each showing "5".
Card 2 (background #1A2133, border #E74C3C thick): badge "②" #E74C3C. Bold "폭탄 3개 전부 소진 → 즉시 패배" #E74C3C. "실수를 3번 → 폭탄 토큰 3개 모두 없어짐" #E8ECF5. Show 3 red circles darkened (#3A3F4B).
Card 3 (background #1A2133, border #3498DB): badge "③" #3498DB. Bold "덱이 바닥남 → 마지막 라운드" #E8ECF5. "양쪽이 각 1턴씩 더 진행 후 점수 집계" #93A0BD. Show empty deck icon with "0장".
SCORING TABLE (background #232C42, rounded): header "점수 = 5색 불꽃 현재 숫자의 합   (최대 25)" #93A0BD.
"0–5 | 처참함" #93A0BD / "6–10 | 아쉬움" #93A0BD / "11–15 | 무난함" #E8ECF5 / "16–20 | 훌륭함" #E8ECF5 / "21–24 | 경이로움" #FF6B35 / "25 | ★ 전설의 불꽃놀이!" highlight #F1C40F 20% opacity, text #F1C40F bold large with gold star.
```

---

## 4. 운영 가이드

### 4-1. 생성 후 검수 체크리스트 (룰북 수치 기준)

- [ ] 카드 총 50장, 색당 10장, 숫자별 분포 3/2/2/2/1 (P3)
- [ ] 힌트 토큰 8개, 폭탄 토큰 3개 (P3)
- [ ] 2인 시작 손패 5장 (P3)
- [ ] 힌트 토큰 상한 8 (P4, P6)
- [ ] 버리기 시 토큰 8개이면 버리기 불가 (P6)
- [ ] 5 완성 시 힌트 토큰 1개 회수, 상한 8 초과 시 회수 없음 (P6)
- [ ] 폭탄 3개 소진 = 즉시 패배 (P3, P7)
- [ ] 덱 소진 후 양쪽 각 1턴 (마지막 라운드) (P7)
- [ ] 등급표 6단계 수치: 0~5/6~10/11~15/16~20/21~24/25 (P7)
- [ ] 등급 한글명: 처참함/아쉬움/무난함/훌륭함/경이로움/전설의 불꽃놀이! (P7)
- [ ] 0장 힌트 금지 문구 포함 (P5)
- [ ] "부분 가리키기 불가" 문구 포함 (P5)

**팔레트 정확성**
- [ ] 배경 `#0E1320` (매우 어두운 네이비, 순검정 아님)
- [ ] 패널 `#1A2133`, 서브패널 `#232C42`
- [ ] 카드: 흰 `#F5F5F5` / 빨 `#E74C3C` / 파 `#2980B9` / 초 `#27AE60` / 노 `#F1C40F`
- [ ] accent `#FF6B35`, 힌트 토큰 `#3498DB`, 폭탄 토큰 `#E74C3C`

**패널 간 일관성**
- [ ] 헤더 바 스타일 7장 동일 (좌측 타이틀 + 우측 N/7)
- [ ] 카드 모서리 둥글기 7장 일관
- [ ] 폰트 굵기 계층 동일 (대제목 > 섹션 제목 > 본문 > 보조)
- [ ] 배경색 7장 동일 (흰 배경 발생 여부 확인)

### 4-2. 재생성 시 스타일 고정 팁

1. P1을 먼저 생성하고 만족스러우면, 그 P1 이미지를 GPT Image에 업로드하며 "same style as this reference image, panel 2/7, ..." 형태로 참조 고정.
2. 매 프롬프트 앞 공통 프리픽스(§2-3) 반드시 포함.
3. 배경이 흐릿하면: "background is strictly #0E1320 dark navy, not black, not grey" 추가.
4. 한글 오자/영문 치환 시: 문제 텍스트를 따옴표로 재강조 + "render this Korean text exactly letter by letter" 추가.
5. 카드 색이 팔레트에서 벗어나면 해당 카드 HEX 재명시.

### 4-3. 생성 이미지 저장 경로 (실제 적용)

생성된 7장은 정적 서빙을 위해 `public/assets/guide/`에 패널 순서대로 `1.png~7.png`로 저장한다. (`handleHttp`가 `public/`만 서빙하므로 `assets/guide/` 직하 금지 — 단독·런처 양쪽 동작을 위해 public 하위 필수.)

```
C:\LazySlimeStudio\minigames\hanabi\public\assets\guide\
  1.png   ← P1 게임 개요
  2.png   ← P2 핵심 반전 (손패 가림)
  3.png   ← P3 구성물
  4.png   ← P4 턴 3행동
  5.png   ← P5 힌트 규칙
  6.png   ← P6 내기·버리기
  7.png   ← P7 종료·점수
```

**가이드 메뉴 UI 결합 (완료, 2026-06-01):** `public/index.html`의 `#screen-waiting .waiting-card` 영역에 `.guide-slider`(`#guide-slider`)를 삽입하여, 좌우 버튼·키보드 ←/→·터치 스와이프로 7장 패널을 넘기는 슬라이더로 결합했다. 인디케이터 `N/7`, 양 끝 버튼 비활성, `object-fit:contain`. 상대 경로 `assets/guide/N.png`로 참조하여 단독·런처 양쪽 동작. (Playwright HR-C11 9개로 검증.)

---

## 5. 추출 근거 요약 (수치 변경 시 참조)

| 수치·규칙 | 출처 |
|-----------|------|
| 총 50장, 5색, 색당 10장, 분포 3/2/2/2/1 | §2-1 |
| 힌트 토큰 8개, 폭탄 토큰 3개 | §2-2 |
| 2인 손패 5장 | §3 |
| 턴 3행동 (A힌트/B내기/C버리기), 패스 없음 | §4 |
| 힌트 2종류, 전부 가리키기, 0장 금지, 토큰0 힌트불가 | §5-1, §5-2 |
| 내기 성공/실패 판정, 5완성 토큰 회수(상한8) | §6-1, §6-2 |
| 버리기 토큰 +1, 토큰8 시 버리기 불가 | §7, §13-5 |
| 종료 3조건 (만점/폭탄3/덱소진) | §9 |
| 덱 소진 후 양쪽 각 1턴 | §9 종료-3, §13-7 |
| 등급표 6단계 | §10 |
