/**
 * @fileoverview 끝말잇기 배틀 1차 전투 프로토타입 설정.
 * 밸런스와 표시 문구를 이 파일에서 함께 관리해 규칙 변경이 로직 수정으로 번지지 않게 한다.
 */

export const TURN_STATE = Object.freeze({
  WORD_INPUT: 'word_input',
  REWARD_SELECT: 'reward_select',
});

export const COMBAT_CONFIG = Object.freeze({
  player: Object.freeze({
    maxHp: 100,
    initialAttack: 0,
    initialDefense: 0,
    baseAnswerTimeSec: 10,
    minAnswerTimeSec: 3,
    maxAnswerTimeSec: 15,
  }),
  timers: Object.freeze({
    rewardSelectSec: 10,
    rewardOptionCount: 3,
    wordTimeoutHpPenalty: 20,
    rewardTimeoutPolicy: 'none',
  }),
  damage: Object.freeze({
    minimum: 1,
  }),
  wordEffects: Object.freeze([
    Object.freeze({
      id: 'guard_2', minLength: 2, maxLength: 2, label: '견제',
      baseDamage: 4, description: 'Damage 4',
    }),
    Object.freeze({
      id: 'strike_3', minLength: 3, maxLength: 3, label: '기본 공격',
      baseDamage: 8, description: 'Damage 8',
    }),
    Object.freeze({
      id: 'power_4', minLength: 4, maxLength: 4, label: '강한 공격',
      baseDamage: 12, description: 'Damage 12',
    }),
    Object.freeze({
      id: 'assault_5_plus', minLength: 5, maxLength: null, label: '맹공',
      baseDamage: 16, description: 'Damage 16',
    }),
  ]),
  rewards: Object.freeze([
    Object.freeze({
      id: 'bonus_damage', name: '추가 공격', icon: '⚔️', effectType: 'bonus_damage', amount: 5,
      duration: 'turn', description: '이번 공격 +5 피해',
    }),
    Object.freeze({
      id: 'attack_up', name: '공격 강화', icon: '💪', effectType: 'self_attack', amount: 1,
      duration: 'match', description: 'ATK +1 (영구)',
    }),
    Object.freeze({
      id: 'defense_up', name: '방어 강화', icon: '🛡️', effectType: 'self_defense', amount: 1,
      duration: 'match', description: 'DEF +1 (영구)',
    }),
    Object.freeze({
      id: 'heal', name: '흡혈 / 회복', icon: '❤️', effectType: 'self_heal', amount: 5,
      duration: 'turn', requiresDamage: true, description: 'HP +5',
    }),
    Object.freeze({
      id: 'next_turn_pressure', name: '시간 압박', icon: '⏳', effectType: 'opponent_next_time', amount: -5,
      duration: 'next_turn', description: '상대 다음 -5초',
    }),
    Object.freeze({
      id: 'opponent_time_down', name: '시간 약화', icon: '⌛', effectType: 'opponent_answer_time', amount: -1,
      duration: 'match', description: '상대 영구 -1초',
    }),
    Object.freeze({
      id: 'self_time_up', name: '시간 강화', icon: '⏱️', effectType: 'self_answer_time', amount: 1,
      duration: 'match', description: '내 영구 +1초',
    }),
  ]),
});

/** 클라이언트가 규칙표와 선택지를 렌더링할 때 쓰는 JSON 안전 설정. */
export function publicCombatConfig() {
  return JSON.parse(JSON.stringify(COMBAT_CONFIG));
}
