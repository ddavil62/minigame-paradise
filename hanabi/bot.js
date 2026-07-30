/**
 * @fileoverview 마스킹된 하나비 관측만으로 봇의 다음 행동을 결정한다.
 *
 * 이 모듈은 서버 내부 게임 객체나 실제 자기 패를 받지 않는다. 같은 관측에는
 * 항상 같은 결정을 반환하며, 반환값은 서버 권위 게임 함수가 다시 검증한다.
 */

const COLORS = ['white', 'red', 'blue', 'green', 'yellow'];

/**
 * 카드가 받은 단서에서 확정된 색과 숫자를 구한다.
 * @param {{clues?:Array<{type?:string,value?:string|number}>}} card 마스킹된 카드
 * @returns {{color:string|null,number:number|null}} 확정 정보
 */
function knownIdentity(card) {
  const clues = Array.isArray(card?.clues) ? card.clues : [];
  const colorClue = clues.find((clue) => clue?.type === 'color' && COLORS.includes(clue.value));
  const numberClue = clues.find((clue) => clue?.type === 'number' && Number.isInteger(Number(clue.value)));
  return {
    color: colorClue?.value ?? null,
    number: numberClue ? Number(numberClue.value) : null,
  };
}

/**
 * 공개 정보만으로 특정 카드가 이미 쓸모없어진 카드인지 확인한다.
 * @param {{color:string|null,number:number|null}} known 확정된 카드 정보
 * @param {Record<string,number>} fireworks 불꽃 스택
 * @returns {boolean} 버려도 안전한지
 */
function isKnownObsolete(known, fireworks) {
  return known.color !== null
    && known.number !== null
    && Number(fireworks?.[known.color] || 0) >= known.number;
}

/**
 * 상대 패에서 즉시 낼 수 있는 카드에 줄 결정적 단서를 고른다.
 * @param {Array<object>} hand 공개된 상대 패
 * @param {Record<string,number>} fireworks 불꽃 스택
 * @returns {{type:'GIVE_CLUE',clueType:'color'|'number',value:string|number}|null} 단서 행동
 */
function cluePlayableCard(hand, fireworks) {
  for (const card of hand) {
    if (!COLORS.includes(card?.color) || !Number.isInteger(card?.number)) continue;
    if (Number(fireworks?.[card.color] || 0) + 1 !== card.number) continue;
    const clues = Array.isArray(card.clues) ? card.clues : [];
    const knowsColor = clues.some((clue) => clue?.type === 'color' && clue.value === card.color);
    const knowsNumber = clues.some((clue) => clue?.type === 'number' && Number(clue.value) === card.number);
    if (!knowsNumber) return { type: 'GIVE_CLUE', clueType: 'number', value: card.number };
    if (!knowsColor) return { type: 'GIVE_CLUE', clueType: 'color', value: card.color };
  }
  return null;
}

/**
 * 상대 패의 보존 가치가 높은 카드에 줄 단서를 고른다.
 * @param {Array<object>} hand 공개된 상대 패
 * @param {Record<string,number>} fireworks 불꽃 스택
 * @returns {{type:'GIVE_CLUE',clueType:'color'|'number',value:string|number}|null} 단서 행동
 */
function clueValuableCard(hand, fireworks) {
  for (const card of hand) {
    if (!COLORS.includes(card?.color) || !Number.isInteger(card?.number)) continue;
    const valuable = card.number === 5
      || (card.number === 1 && Number(fireworks?.[card.color] || 0) === 0);
    if (!valuable) continue;
    const clues = Array.isArray(card.clues) ? card.clues : [];
    if (!clues.some((clue) => clue?.type === 'number' && Number(clue.value) === card.number)) {
      return { type: 'GIVE_CLUE', clueType: 'number', value: card.number };
    }
    if (!clues.some((clue) => clue?.type === 'color' && clue.value === card.color)) {
      return { type: 'GIVE_CLUE', clueType: 'color', value: card.color };
    }
  }
  return null;
}

/**
 * 마스킹된 관측으로 봇 행동 하나를 결정한다.
 * @param {object} maskedSnapshot `snapshotForPlayer(game, 'p2')` 결과
 * @returns {{type:string,handIndex?:number,clueType?:string,value?:string|number}|null} 제안 행동
 */
export function chooseBotAction(maskedSnapshot) {
  if (!maskedSnapshot || maskedSnapshot.you !== 'p2'
      || maskedSnapshot.phase !== 'playing' || maskedSnapshot.currentTurn !== 'p2') return null;

  const myHand = Array.isArray(maskedSnapshot.myHand) ? maskedSnapshot.myHand : [];
  const opponentHand = Array.isArray(maskedSnapshot.opponentHand) ? maskedSnapshot.opponentHand : [];
  const fireworks = maskedSnapshot.fireworks || {};
  const clueTokens = Number(maskedSnapshot.tokens?.clue || 0);

  // 비공개 정보가 섞인 입력은 사용하지 않고 즉시 거부한다.
  if (myHand.some((card) => card?.color !== null || card?.number !== null)) return null;

  for (let index = 0; index < myHand.length; index += 1) {
    const known = knownIdentity(myHand[index]);
    if (known.color && known.number
        && Number(fireworks[known.color] || 0) + 1 === known.number) {
      return { type: 'PLAY_CARD', handIndex: index };
    }
  }

  if (clueTokens > 0) {
    const playableClue = cluePlayableCard(opponentHand, fireworks);
    if (playableClue) return playableClue;
    const valuableClue = clueValuableCard(opponentHand, fireworks);
    if (valuableClue) return valuableClue;
  }

  for (let index = 0; index < myHand.length; index += 1) {
    if (isKnownObsolete(knownIdentity(myHand[index]), fireworks) && clueTokens < 8) {
      return { type: 'DISCARD_CARD', handIndex: index };
    }
  }

  if (clueTokens < 8 && myHand.length > 0) {
    // 가장 오래 들고 있던 앞쪽 카드부터 버려 결정 결과를 재현 가능하게 만든다.
    return { type: 'DISCARD_CARD', handIndex: 0 };
  }

  if (clueTokens > 0) {
    const fallback = opponentHand.find((card) => Number.isInteger(card?.number));
    if (fallback) return { type: 'GIVE_CLUE', clueType: 'number', value: fallback.number };
  }

  return null;
}
