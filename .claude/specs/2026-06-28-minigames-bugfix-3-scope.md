# Scope: 재현 확정 버그 3건 수정 — tetris-battle #12/#13 · codenames-duet #10

목적유형: fix / visual_change: ui / pipeline: full / clarity: high (grilled: false)

핵심 목적: 라이브 재현으로 확정된 버그 3건의 근본 원인을 코드 레벨에서 제거.

- **#13 tetris-battle**: 봇 ws 연결이 비동기 SIGTERM 지연으로 좀비 잔존 → 방 2슬롯 점유 → 사람 입장 "Room is full" 거절. (server.js killBotChild L103-109, ws close L436-456; launcher/server.js L83-85 단일 createApp 재사용) visual_change:none, pipeline:full
- **#12 tetris-battle**: 봇 START 핸들러(bot.js L502-507)가 countdown 값 무시 즉시 게임 루프 시작 → 사람(main.js runCountdown L353-376, 3초)보다 ~3초 선행 desync. visual_change:none, pipeline:quick
- **#10 codenames-duet**: GAME_START 핸들러(client.js L199-210)가 복기 DOM(.review-grid/.review-cell/.was-revealed) 미정리 → 새 게임에 이전 복기 점 잔존(라이브: review-cell 25/dot 50/assassin 6). 정상 정리 로직은 closeReviewBackToModal()(L563-588)에 존재. visual_change:ui, pipeline:quick

제외(재현 불가): #8 yutnori 클릭(이미 수정 반영), #9 tetris 조기 패배(VANISH_ZONE 탑아웃 정상 가능성).

회귀 보호: tetris-battle 344 PASS + bot-smoke 8/8(Q7b 기존결함 제외), codenames-duet review-smoke 27/27 + review-visual 11/11 유지.

AD3 대상: #10(codenames 새 게임 보드 화면).
