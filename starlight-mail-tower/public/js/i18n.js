/**
 * @fileoverview 별빛 우편탑 Phase 1 사용자 노출 문구의 한국어·영어 번역과 DOM 적용을 담당한다.
 */

const MESSAGES = Object.freeze({
  ko: {
    'game.title': '별빛 우편탑', 'game.subtitle': '두 정비 로봇의 야간 우편 작전', 'section.name': '분류 데크',
    'aria.game': '별빛 우편탑 협동 등반 게임', 'aria.canvas': '별빛 우편탑 분류 데크', 'aria.locale': '언어 전환', 'aria.toolbar': '게임 도구', 'aria.mute': '음소거', 'aria.lobby': '게임 선택으로 돌아가기', 'aria.roleA': 'A 역할 청록 삼각 로봇', 'aria.roleB': 'B 역할 주황 두 점 로봇', 'waiting.short': '대기 중', 'default.name': '정비 로봇', 'section.windRing': '풍향계 링', 'section.observatory': '관측 안테나',
    controls: 'A/D 또는 ←/→ 이동 · Space 점프 · E/Enter 상호작용 · 공중 동료를 아래에서 점프로 올려치면 협동 부스트', ready: '준비', 'ready.done': '준비 완료',
    'waiting.partner': '파트너 접속을 기다리는 중...', 'waiting.ready': '두 로봇의 준비를 기다리는 중...',
    'connection.connecting': '연결 중', 'connection.online': 'LAN 연결됨', 'connection.closed': '연결 끊김',
    'status.moving': '이동', 'status.anchored': '고정', 'status.waiting': '대기', 'status.partner': '파트너',
    'hint.anchor': '단자에서 E를 길게 눌러 고정하세요', 'hint.switch': '파트너가 고정했습니다. 스위치에서 E를 누르세요', 'hint.checkpoint': '둘이 함께 별빛 체크포인트로 이동하세요', 'hint.boost': '공중 동료를 아래에서 점프로 올려쳐 협동 부스트하세요',
    respawn: '별빛 체크포인트로 함께 복귀 중', 'event.powered': '전력 연결! 파트너가 움직일 차례입니다', 'event.latched': '장치 잠금 완료', 'event.checkpoint': '공동 체크포인트 갱신', 'event.fall': '추락! 함께 복귀합니다', 'event.finish': '두 신호가 결합했습니다. 별빛 우편 발사!', 'event.expired': '동시 신호 시간이 지나 다시 준비합니다.', 'event.boost': '협동 부스트 성공! 동료가 별빛을 타고 상승합니다.',
    'hint.final': '좌우 역할 스위치를 3초 안에 함께 누르세요', 'result.title': '함께 배달 완료', 'result.message': '별빛 우편이 밤하늘에 도착했습니다.', 'result.time': '완주 시간', 'result.current': '이번 기록', 'result.best': '최고 기록', 'result.falls': '추락', 'result.swaps': '역할 교대', 'result.rematch': '재경기 준비', 'result.lobby': '로비 복귀', 'result.waiting': '파트너의 준비를 기다립니다.', 'result.ready': '준비 완료 · 파트너 대기 중', 'result.bothReady': '둘 다 준비 완료 · 다시 출발합니다.', 'result.partnerLeft': '파트너가 로비 복귀를 선택했습니다.', 'result.processing': '서버가 새 우편 작전을 준비 중입니다.',
    'toolbar.lobby': '게임 선택', 'reconnect.title': '파트너 재접속 대기', 'reconnect.message': '진행을 안전하게 멈추고 파트너를 기다립니다.', 'reconnect.paused': '입력이 일시 정지되었습니다.', 'reconnect.recovered': '역할과 진행을 복원했습니다.', 'session.title': '작전이 안전하게 종료되었습니다', 'session.expired': '재접속 유예 시간이 끝났습니다.', 'session.agreed': '파트너가 게임 선택으로 돌아가 작전을 종료했습니다.', 'lobbyConfirm.title': '게임 선택으로 돌아갈까요?', 'lobbyConfirm.message': '현재 협동 작전을 종료하고 파트너에게도 안내합니다.', 'lobbyConfirm.continue': '게임 계속',
    'error.roomFull': '두 로봇이 이미 작전 중입니다', 'error.invalidMessage': '잘못된 요청입니다', 'error.joinRequired': '먼저 게임에 참가해 주세요', 'error.resumeExpired': '재접속 시간이 끝났습니다',
    'error.levelSelection': '호스트만 대기실에서 코스를 선택할 수 있습니다', 'menu.choose': '배송 코스 선택', 'menu.hostOnly': '호스트의 선택을 기다리는 중', 'menu.hostControl': '호스트 · 코스를 선택하세요', 'menu.estimatedTime': '예상', 'menu.best': '최고 기록',
    'result.retry': '재도전', 'result.next': '다음 레벨', 'result.select': '레벨 선택', 'result.newBest': '신기록', 'result.waitingChoice': '각자 다음 행동을 골라 주세요.', 'result.partnerChoice': '선택 완료 · 파트너를 기다립니다.', 'result.choiceMismatch': '선택이 다릅니다 · 다시 같은 행동을 골라 주세요.',
    'level.starlight.name': '별빛 우편탑', 'level.starlight.theme': '분류와 역할 교대', 'level.starlight.description': '단자를 고정하고 파트너의 길을 여는 입문 코스',
    'level.cloud.name': '구름 화물열차', 'level.cloud.theme': '이동 객차와 시간 장치', 'level.cloud.description': '달리는 객차 사이에서 타이밍을 맞추는 코스',
    'level.moon.name': '달빛 시계탑', 'level.moon.theme': '회전 발판과 주기', 'level.moon.description': '시계 장치의 박자에 맞춰 역할을 바꾸는 코스',
    'level.storm.name': '폭풍 관측소', 'level.storm.theme': '강풍과 안전지대', 'level.storm.description': '낙뢰 신호를 읽고 함께 피하는 고난도 코스',
    'level.orbital.name': '궤도 우편선', 'level.orbital.theme': '저중력과 도킹', 'level.orbital.description': '부유하며 신호를 합치는 종합 협동 코스',
    'aria.levelList': '배송 코스 선택', 'menu.selected': '선택됨', 'menu.locked': '호스트 선택',
  },
  en: {
    'game.title': 'Starlight Mail Tower', 'game.subtitle': 'A night mail run for two repair robots', 'section.name': 'Sorting Deck',
    'aria.game': 'Starlight Mail Tower cooperative climbing game', 'aria.canvas': 'Starlight Mail Tower sorting deck', 'aria.locale': 'Change language', 'aria.toolbar': 'Game tools', 'aria.mute': 'Mute audio', 'aria.lobby': 'Return to game selection', 'aria.roleA': 'Role A cyan triangle robot', 'aria.roleB': 'Role B coral two-dot robot', 'waiting.short': 'Waiting', 'default.name': 'Repair Robot', 'section.windRing': 'Wind Vane Ring', 'section.observatory': 'Observatory Antenna',
    controls: 'A/D or ←/→ move · Space jump · E/Enter interact · Jump into an airborne partner from below to co-op boost', ready: 'Ready', 'ready.done': 'Ready!',
    'waiting.partner': 'Waiting for your partner...', 'waiting.ready': 'Waiting for both robots to ready up...',
    'connection.connecting': 'Connecting', 'connection.online': 'LAN online', 'connection.closed': 'Disconnected',
    'status.moving': 'Moving', 'status.anchored': 'Anchored', 'status.waiting': 'Waiting', 'status.partner': 'Partner',
    'hint.anchor': 'Hold E at the terminal to anchor', 'hint.switch': 'Partner anchored. Press E at the switch', 'hint.checkpoint': 'Move together into the starlight checkpoint', 'hint.boost': 'Jump into your airborne partner from below to co-op boost',
    respawn: 'Returning together to the starlight checkpoint', 'event.powered': 'Power linked! Your partner can move', 'event.latched': 'Device latched', 'event.checkpoint': 'Team checkpoint updated', 'event.fall': 'Fall! Returning together', 'event.finish': 'Signals linked. Starlight mail launched!', 'event.expired': 'The signal window expired. Try together again.', 'event.boost': 'Co-op boost! Your partner rides the starlight upward.',
    'hint.final': 'Press both role switches together within 3 seconds', 'result.title': 'Delivered Together', 'result.message': 'The starlight mail reached the night sky.', 'result.time': 'Completion Time', 'result.current': 'Current', 'result.best': 'Best', 'result.falls': 'Falls', 'result.swaps': 'Role Swaps', 'result.rematch': 'Ready for Rematch', 'result.lobby': 'Return to Lobby', 'result.waiting': 'Waiting for your partner.', 'result.ready': 'Ready · Waiting for partner', 'result.bothReady': 'Both ready · Departing again.', 'result.partnerLeft': 'Your partner chose to return to the lobby.', 'result.processing': 'The server is preparing a new mail run.',
    'toolbar.lobby': 'Game Select', 'reconnect.title': 'Waiting for Partner to Reconnect', 'reconnect.message': 'Progress is safely paused while we wait for your partner.', 'reconnect.paused': 'Input is temporarily paused.', 'reconnect.recovered': 'Role and progress restored.', 'session.title': 'The Mail Run Ended Safely', 'session.expired': 'The reconnect grace period has ended.', 'session.agreed': 'Your partner returned to game selection and ended the run.', 'lobbyConfirm.title': 'Return to Game Selection?', 'lobbyConfirm.message': 'This ends the current co-op run and informs your partner.', 'lobbyConfirm.continue': 'Continue Game',
    'error.roomFull': 'Two robots are already on duty', 'error.invalidMessage': 'Invalid request', 'error.joinRequired': 'Join the game first', 'error.resumeExpired': 'The reconnect window has expired',
    'error.levelSelection': 'Only the host can choose a course in the lobby', 'menu.choose': 'Choose a Delivery Course', 'menu.hostOnly': 'Waiting for the host to choose', 'menu.hostControl': 'Host · Choose a course', 'menu.estimatedTime': 'Est.', 'menu.best': 'Best',
    'result.retry': 'Retry', 'result.next': 'Next Level', 'result.select': 'Level Select', 'result.newBest': 'New Best', 'result.waitingChoice': 'Each player chooses what to do next.', 'result.partnerChoice': 'Choice locked · Waiting for partner.', 'result.choiceMismatch': 'Different choices · Pick the same action to continue.',
    'level.starlight.name': 'Starlight Mail Tower', 'level.starlight.theme': 'Sorting & Role Swaps', 'level.starlight.description': 'An introductory run about anchoring and opening a route.',
    'level.cloud.name': 'Cloud Cargo Train', 'level.cloud.theme': 'Moving Cars & Timers', 'level.cloud.description': 'Match your timing while crossing a train in motion.',
    'level.moon.name': 'Moonlight Clocktower', 'level.moon.theme': 'Rotating Platforms & Cycles', 'level.moon.description': 'Swap roles to the rhythm of clockwork devices.',
    'level.storm.name': 'Storm Observatory', 'level.storm.theme': 'Gales & Safe Zones', 'level.storm.description': 'Read lightning signals and shelter together.',
    'level.orbital.name': 'Orbital Postship', 'level.orbital.theme': 'Low Gravity & Docking', 'level.orbital.description': 'A combined challenge of drifting and signal relays.',
    'aria.levelList': 'Choose a delivery course', 'menu.selected': 'Selected', 'menu.locked': 'Host choice',
  },
});

let locale = localStorage.getItem('starlight-locale') === 'en' ? 'en' : 'ko';

/**
 * 번역 키를 현재 언어 문자열로 바꾼다.
 * @param {string} key 번역 키
 * @returns {string}
 */
export function t(key) { return MESSAGES[locale][key] ?? MESSAGES.ko[key] ?? key; }

/** @returns {'ko'|'en'} 현재 언어 */
export function getLocale() { return locale; }

/**
 * 현재 문서의 data-i18n 문구와 언어 속성을 갱신한다.
 * @returns {void}
 */
export function applyLocale() {
  document.documentElement.lang = locale;
  document.querySelectorAll('[data-i18n]').forEach((element) => { element.textContent = t(element.getAttribute('data-i18n')); });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => { element.setAttribute('aria-label', t(element.getAttribute('data-i18n-aria-label'))); });
}

/**
 * 한국어와 영어를 전환하고 저장한다.
 * @returns {string}
 */
export function toggleLocale() {
  locale = locale === 'ko' ? 'en' : 'ko';
  localStorage.setItem('starlight-locale', locale);
  applyLocale();
  return locale;
}
