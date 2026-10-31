# 티추 — 프로젝트 작업 지침

서버 권위 4인 2:2 팀전 티추다. 사람 1~4명이 방 설정 화면에서 모이고 호스트가 시작하면 빈자리를 서버 관리형 AI가 채운다. 맞은편이 파트너이며 사람이 2명이면 마주 보는 자리(파트너)에 앉는다. 방·방장·재접속·일시정지·AI 채움 규칙은 마작(`mahjong/`)과 같다. UI는 DOM/CSS이고 특수 카드 4장(`public/assets/{spr,dog,phx,drg}.webp`)과 뒷면(`back.webp`)만 GPT Image 일러스트다(`key-art.webp`는 런처 카드 전용). 개발 포트 3022. 목업 원본: `studio-mockup/minigame-paradise/tichu-design-v2.html`(시안 A 클래식 카드룸 채택).

## 핵심 구조

```text
tichu/
├── lib/cards.js    # 카드 id(0~55)·점수·정렬·시드 난수 (서버·AI·브라우저 공용, Node 전용 API 금지)
├── lib/combos.js   # 조합 해석·비교·봉황 처리·낼 수 있는 조합 열거 (서버·AI·브라우저 공용 순수 함수)
├── lib/game.js     # 대국 상태 머신(TichuGame) — 모든 규칙 판정과 라운드 진행·정산
├── lib/ai.js       # AI(easy/normal/hard), 폭탄 끼어들기, 시간 초과 대체 행동. viewFor() 뷰만 사용한다
├── server.js       # WebSocket 룸, AI 스케줄러, 타이머, 정적 파일(+ /lib/cards.js·combos.js 공유)
├── public/         # index.html, css/style.css, js/{main,cardview,fx,sounds,guide}.js, assets/
└── tests/          # node:test(combos·game·server) + Playwright UI(ui.spec.js)
```

`lib/cards.js`·`lib/combos.js`만 `/lib/`로 브라우저에 내보낸다(서버가 화이트리스트로 제한, `game.js`·`ai.js`는 404). 클라이언트는 이 코드를 버튼 활성화·선택 문구·도우미 칩에만 쓰고 **최종 판정은 항상 서버**다.

## 룰 (표준 티추)

- 56장: 4무늬(옥·검·탑·별) × 2~A + 참새(1)·개·봉황·용. 4명 2:2 팀(좌석 `seat % 2`), 맞은편이 파트너. 좌석은 시계 방향이고 턴은 `seat+1` 순서다.
- 라운드: 8장 → **그랜드 티추**(처음 8장만 보고 ±200, 옵션) → 6장 더 → **카드 3장 교환**(왼쪽 상대·파트너·오른쪽 상대에 한 장씩, `give[0..2]`가 `seat+1`·`+2`·`+3` 순) → 참새를 가진 사람이 선 → 플레이.
- 조합: 싱글·페어·트리플·풀하우스·스트레이트(5장 이상, A가 최고, 참새=1, A-2 연결 없음)·연속 페어(2쌍 이상)·폭탄(네 장 / 같은 무늬 스트레이트 5장 이상). 같은 종류·같은 장수만 비교된다. 폭탄 우열: 일반 < 네 장 < 플러시(길이 → 높이). 플러시는 평소엔 스트레이트로 내고 폭탄이어야 할 때만 폭탄이다(`pickCombo`).
- 봉황: 싱글로 낼 때 직전 싱글 +0.5(선이면 1.5, 용 위에는 불가), 조합에서는 2~A 중 하나를 대신한다(폭탄·참새 자리 불가). 해석이 둘 이상이면(스트레이트 양 끝·2+2+봉황 풀하우스) 이길 수 있는 해석 중 가장 높은 것을 자동 선택하고, 클라이언트가 `as`(봉황이 대신할 숫자)로 고를 수 있다(`phoenixChoices`).
- 개: 선일 때만, 파트너에게 선을 넘긴다(파트너가 나갔으면 파트너 다음 사람). 소원이 걸려 있으면 개로 피할 수 없다.
- 용: 가장 높은 싱글. 용으로 이긴 트릭은 **살아 있는 상대 팀 한 명에게** 줘야 한다(`pending.gift`, 상대가 한 명이면 자동).
- 소원: 참새를 낼 때 `wish`(2~14)를 같이 보낸다. 소원 숫자를 합법 조합으로 낼 수 있는 사람은 반드시 내야 하고 패스·다른 조합이 거절된다(`wish` 에러). 누가 그 숫자를 내면(같은 플레이 포함) 사라진다.
- 폭탄 끼어들기: 폭탄은 **내 차례가 아니어도** 트릭이 진행 중이면 낼 수 있다(선일 때 트릭이 없으면 불가). 낸 사람 다음 순서로 이어지고 패스 기록은 초기화된다. 낸 직후 `bombWindowMs`(0·1·2·3초, 기본 2초) 동안은 **다음 사람이 일반 조합·패스를 못 낸다**(`wait` 에러, 폭탄은 가능). `openAt`이 뷰에 실린다.
- 티추 콜: 첫 카드를 내기 전(패스도 첫 행동)이면 언제든, 내 차례가 아니어도 부를 수 있다(성공 +100 / 실패 −100). 그랜드는 ±200. 성공 = 내가 1등으로 나감(파트너가 1등이어도 실패).
- 정산: 카드 점수 5=5·10=10·K=10·용 +25·봉황 −25(합 100). 꼴찌가 딴 카드는 1등에게, 꼴찌의 남은 손패 점수는 상대 팀에게. 같은 팀이 1·2등(원투)이면 카드 점수 대신 200점이고 라운드가 바로 끝난다. 3명이 나가면 라운드 종료. 누적이 목표(500/1000) 이상이고 동점이 아니면 종료한다(동점이면 계속).
- 라운드가 끝날 때 마지막 트릭은 마지막으로 낸 사람이 가져간다(용이면 선물 선택).
- 미구현: 관전, 점수 기록 저장.

## 게임 불변조건

- 진행 대기 상태는 `game.pending`이 단일 기준이다: `grand`(그랜드 선택) · `exchange`(교환) · `turn`(낼 차례) · `gift`(용 선물) · `ack`(라운드 결과 확인) · null(종료). `waitingSeats()`가 지금 움직여야 하는 좌석이다.
- 모든 변경은 `act(seat, action)`으로만 일어나고 불법 행동은 `{ok:false, error}`로 거절된다. 에러 코드: `not_turn` · `illegal` · `wish` · `wait` · `must_lead` · `not_allowed` · `bad_action`.
- 내 차례가 아니어도 되는 행동은 폭탄 `play`와 `tichu`뿐이다(`act`가 걸러낸다).
- 라운드 중 카드는 항상 56장이고 중복이 없다(`hands + won + trick.pile`; 테스트가 퍼즈로 확인). 라운드의 카드 점수 합은 항상 100(원투는 200)이다.
- 그랜드 선택은 모두가 정할 때까지 서로의 선택이 `viewFor`에 보이지 않는다.
- `viewFor(seat)`에는 상대 손패·남은 덱이 들어가지 않는다(상대 손패를 바꿔도 내 뷰가 같다는 테스트가 있다). `legal`은 `grand`·`exchange`·`exchangeDone`·`turn`·`wait`·`gift`·`ack` 중 하나이고, 낼 수 있는 조합 목록은 서버가 보내지 않으며 클라이언트가 `enumeratePlays`로 계산한다.

## WebSocket 계약

연결: `/{gameId}/ws?key=<세션키>&name=<닉네임>[&role=p1][&room=<방 번호>]`. 방 번호·방장(`role=p1` 최초 1회)·재접속(`key`)·대국 중 입장 거절·90초 빈 방 초기화는 마작과 같다(`mahjong/CLAUDE.md` 참고). 런처는 `ROOM_ID_GAME_IDS`(`mahjong`, `tichu`)에 속한 게임의 대기실이 시작될 때마다 새 UUID를 발급해 `/tichu/?room=<id>`로 보낸다.

| 방향 | 메시지 | 역할 |
|---|---|---|
| C→S | `CONFIG {settings}` | 호스트가 목표 점수(500/1000)·그랜드·폭탄 대기(0~3초)·AI 난이도 변경(방 설정 중) |
| C→S | `START` / `REMATCH` / `LEAVE` | 호스트 시작 / 호스트 다시 하기 / 나가기 |
| C→S | `ACT {action}` | `grand{on}` `exchange{give:[a,b,c]}` `tichu` `play{ids,as?,wish?}` `pass` `gift{to}` `next` |
| C→S | `PAUSE` / `RESUME` | 일시정지 / 재개(누구든 재개) |
| S→C | `JOINED` `ROOM` `STATE` `ERROR` | 좌석·방 설정·대국 뷰(`view`, `seats`, `timers`, `pause`, `events`, `serverNow`) |

`STATE.events`는 효과음·배너용이다: `deal` `dealrest` `exchanged` `start` `play{seat,combo,outOfTurn}` `pass` `dog` `call` `wish` `wishdone` `trickwin` `dragon` `gift` `out` `round` `over` `pause` `resume`.

## 타이머·자동 진행

- 낼 차례 25초 + 대국 전체 여유 30초(`bank`), 그랜드 선택 20초(초과 시 패스), 교환 45초(초과 시 AI 휴리스틱 교환), 용 선물 15초. 라운드 결과 확인은 **시간 제한이 없다**: 접속 중인 사람이 모두 "다음 라운드"를 눌러야 한다(AI는 자동, 접속 끊김·자리 비움은 0.5초 뒤 자동).
- 연속 2회 시간 초과하거나 접속이 끊긴 사람은 자동 진행(자리 비움)이 되며 행동하면 해제된다. 대체 행동은 `ai.js`의 `fallbackAction`(보통 난이도 판단).
- AI가 낼 차례일 때는 폭탄 대기(`openAt`)가 끝난 뒤에 움직이도록 지연을 늘린다(`aiDelay`). 내 차례가 아닌 AI는 상태가 바뀔 때마다 `decideInterrupt`로 폭탄 끼어들기를 다시 판단하고 `irqTimers`로 예약한다(일시정지 때 비우고 재개 때 다시 만든다). 재개하면 `openAt`도 멈춘 시간만큼 미룬다.
- 일시정지·방 정리 규칙은 마작과 같다(시간·횟수 제한 없이 누구든 재개).

## AI

- easy: 티추 콜·폭탄 끼어들기 없음, 가끔 무작위 패스, 20% 무작위 선. normal: 강한 손(`handStrength`)이면 티추·그랜드 콜, 상대가 곧 나가거나 용이면 폭탄. hard: 콜 기준이 더 엄격하고 리치한(콜한) 상대에 폭탄 대응. 점수가 300 넘게 앞서면 콜하지 않는다.
- 선: 한 번에 다 털 수 있으면 그것, 개는 파트너가 살아 있으면 일찍, 용·봉황·폭탄은 아끼며 낮은 조합을 많이 털어내는 쪽. 따라가기: 파트너가 이기고 있으면 패스(소원이 걸리면 제외), 가장 싼 조합으로 이기고 특수 카드는 트릭 점수·위기에 따라 사용.
- AI는 `viewFor(seat)`와 `view.legal`만 쓴다(`game.h` 직접 접근 금지).

## 클라이언트(public/js/main.js) 요령

- 매 STATE마다 `#content` 전체를 다시 그린다. 선택·교환 슬롯·소원 모달 같은 상태는 `S`에만 둔다(DOM에 의존 금지). 연출(배너·번쩍임)은 재렌더로 지워지지 않는 `#fx` 레이어(`fx.js`)에 그린다(새 배너가 오면 이전 배너를 치운다).
- 무대는 1200×760 고정이고 `fit()`이 창에 맞춰 비율만 줄인다. 카드·이름판·모달·방 설정 CSS는 목업(`tichu-design-v2.html`)에서 가져왔다.
- 선택한 카드의 판정은 `selInfo()`(`pickCombo`·`interpretations`·`phoenixChoices`)가 한다. 참새를 내려면 소원 모달(`S.wish`)을 거쳐 `play`에 `wish`를 싣는다. 폭탄 대기 카운트다운은 `[data-wait]` 요소를 `updateTimers()`가 갱신한다.
- 도우미(`#btn-assist`, 로컬 설정 `tichu:assist`)를 켜면 내 차례에 낼 수 있는 조합 칩과 못 내는 카드 흐림을 보여 준다. 서버와 무관하다(`ASSIST` 메시지는 무시).
- 룰 가이드(`guide.js`)는 4탭 오버레이이고 타이머·점수 같은 수치가 바뀌면 문구도 함께 고친다. 테스트 전용 `?auto=N`은 단순 전략으로 자동 진행한다.
- 효과음은 WebAudio 합성(`sounds.js`)이며 사용자 조작 전에는 오디오를 만들지 않는다. BGM은 아직 없다.

## 테스트

```powershell
cd C:\antigravity\minigame-paradise\tichu
node --test tests/combos.test.js tests/game.test.js tests/server.test.js
npx playwright test --config=playwright.config.js   # UI 회귀(격리 포트에서 서버를 직접 기동)
```

- `tests/helpers.js`의 `playFullMatch(seed)`가 AI 4명으로 한 대국을 끝까지 돌린다. 규칙을 바꾸면 `game.test.js`의 퍼즈(카드 56장 보존·점수 합)가 확인한다.
- 시나리오 테스트는 `setup()`으로 `game.h.hands`를 직접 구성한다(`bombWindowMs: 0`, `now` 주입).
- 화면 검증용: `TICHU_FAST=1 node server.js --port 3076` 후 `/?name=테스터&auto=1`(자동 진행, 테스트 전용). 사용자 런처(3000)와 다른 포트를 쓴다.
- 통합 검증: 런처를 격리 포트로 띄워(`node launcher/server.js --port 3081`) 대기실 → AI 채우기 → READY → `/tichu/?room=<UUID>` 리디렉션을 확인한다.
- 고정된 PASS 개수는 문서에 적지 않는다.

## 변경 시 주의할 점

- 조합 판정을 바꾸면 `combos.js`(서버·AI·클라이언트가 같이 쓴다)와 `tests/combos.test.js`, 룰 가이드 문구를 함께 고친다. `enumeratePlays`는 후보를 만든 뒤 반드시 `interpretations`로 다시 검증하므로 새 조합 종류는 `interpretations`에 먼저 넣는다.
- `viewFor`에 필드를 추가할 때 상대 손패가 새지 않게 한다. 클라이언트가 보는 `legal.kind`가 바뀌면 `main.js`의 `stripHtml`·`actionsHtml`·`modalHtml`을 함께 본다.
- 특수 카드 일러스트는 `public/assets/*.webp`(448×672)다. 이름·표기는 "참새"(영어 SPARROW, Mah Jong)를 쓴다.
