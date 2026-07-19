# 달빛 주방열차

달빛 주방열차는 두 플레이어가 달리는 열차 주방에서 재료를 손질하고 조리해 주문을 완성하는 실시간 협력 웹 게임이다. Node.js WebSocket 서버와 바닐라 JavaScript Canvas 클라이언트로 구성되며, 게임 규칙과 렌더링을 분리해 에셋 로딩 실패가 플레이 진행에 영향을 주지 않도록 설계한다.

## 실행과 검증

```bash
npm install
npm start
```

기본 서버 포트는 `3016`이다. 전체 자동 검증은 다음 명령으로 실행한다.

```bash
npm run atlas:verify
npm test
npm run test:e2e
node --test tests/final-network-qa.spec.js tests/final-edge-qa.spec.js
npx playwright test -c tests/playwright.final-ui.config.js
```

## GPT Image 스프라이트 파이프라인

2026-07-19부터 재료·설비·캐릭터를 구분하기 쉬운 GPT Image 기반 스프라이트를 사용한다. 생성 원본은 재현과 후속 편집을 위해 `public/assets/gpt-image-sources/`에 보존한다.

| 원본 시트 | 내용 | 런타임 atlas |
|---|---|---|
| `moonlight-ingredients-source.png` | 6재료의 RAW/PREPPED/COOKED/BURNT 상태 | `moonlight-items.webp` |
| `moonlight-stations-source.png` | 빈 접시·완성 요리·주방 설비 | `moonlight-stations.webp` |
| `moonlight-crew-source.png` | P1/P2의 4방향 캐릭터 | `moonlight-crew.webp` |

`scripts/build_sprite_atlas.py`가 원본에서 배경을 제거하고 셀을 분리한 뒤, trim·중앙 정렬·축소·팔레트 정규화를 거쳐 WebP atlas 3장과 `public/assets/sprites/moonlight-atlas.json`을 만든다.

```bash
npm run atlas:build
```

manifest에는 총 49개 프레임이 등록된다.

- 재료 6종 × RAW/PREPPED/COOKED/BURNT 4상태: 24개
- 빈 접시 1개와 완성 요리 3종: 4개
- 설비: 13개
- P1/P2 × down/left/up/right: 8개

모든 불투명 픽셀은 승인된 15색 팔레트에 맞추며, 각 128px 셀은 사방 8% 이상의 투명 안전 여백을 확보한다. 현재 빌드의 최소 여백은 13px이고, 팔레트 평균 거리는 0.00이며 거리 15 이내 픽셀 비율은 100%다. WebP atlas 합계는 146,266바이트다.

## 런타임 로딩과 fallback

`public/js/assets.js`는 manifest와 세 atlas 이미지를 비차단 방식으로 미리 불러온다. 이미지 로딩에는 `Promise.allSettled`를 사용하므로 일부 atlas가 실패해도 성공한 시트는 계속 표시되고 WebSocket 연결과 첫 렌더는 중단되지 않는다. preload 완료 후 최신 snapshot을 다시 그린다.

프레임이 없거나 이미지 디코딩이 실패하면 `public/js/renderer.js`가 기존 Canvas 재료 glyph, 설비 도형, 플레이어 벡터를 사용한다. 진행 상태의 프레임 매핑은 다음과 같다.

- `PREPPING → RAW`
- `COOKING → PREPPED`

에셋은 표현 계층에만 적용한다. 서버 좌표, 충돌 AABB, 상호작용 거리, 조리 시간, 점수와 주문 규칙은 변경하지 않는다.

## 에셋 회귀 기준

`npm run atlas:verify`는 49개 프레임, source rect 경계, 빈 프레임, 15색 팔레트, 8% 안전 여백을 검사한다. 브라우저 테스트는 atlas 디코딩과 일부 시트 404 fallback, 실제 게임 렌더링, 한국어·영어 UI를 검증한다.

시각 회귀 캡처는 다음 세 뷰포트를 기준으로 한다.

- `tests/screenshots/assets-play-1280x720.png`
- `tests/screenshots/assets-play-1024x768.png`
- `tests/screenshots/assets-play-390x844.png`

2026-07-19 기준 검증 결과는 Node/WebSocket 31/31, Playwright 6/6 PASS다. 세 뷰포트에서 주문·경고·타임라인과 냉각 패널·플레이어·footer 영역의 교차 면적은 0이며, 390px 화면은 Canvas HUD 대신 HTML 모바일 HUD를 사용한다.
