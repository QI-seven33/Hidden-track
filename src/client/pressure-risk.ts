import type { CardId, GameRules } from '../game/types';

/**
 * 信息牌是拿压力换的。这里算出「这张牌最少要付多少压力」：
 * 引子按最低档，升 Key 固定比同档多 5，猜先按本轮固定档位。
 * 返回 0 表示这张牌不直接加压。
 */
export function infoCardMinPressure(
  cardId: CardId,
  rules: GameRules,
  round: number,
): number {
  const tier = Math.min(4, Math.max(1, Math.floor(round))) as 1 | 2 | 3 | 4;
  if (cardId === 'information') return rules.cluePressure[1];
  if (cardId === 'probe') return rules.cluePressure[1] + 5;
  if (cardId === 'rps') return rules.cluePressure[tier];
  return 0;
}

/**
 * 出手前的自伤判断：只要「最低代价」就够把压力顶到上限，就一定要警告——
 * 压力到顶立即判负，这类死亡在旧版里没有任何提示。
 */
export function selfHarmWarning(input: {
  cardId: CardId;
  rules: GameRules;
  round: number;
  pressure: number;
  pressureCap: number;
  /** 本轮线索免压力时不必警告。 */
  freeClues?: boolean;
}): string {
  if (input.freeClues) return '';
  const min = infoCardMinPressure(input.cardId, input.rules, input.round);
  if (!min) return '';
  const left = input.pressureCap - input.pressure;
  if (left > min) return '';
  return `这条信息至少要付 ${min} 点压力：你的压力会到顶（${input.pressure}/${input.pressureCap}）并立即判负`;
}
