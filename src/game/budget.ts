import { CARD_BY_ID } from '../shared/cards';
import { clueTierCap, effectiveClueOdds, shareCap } from './clues';
import type { CardId, GameState, Side } from './types';

/** The same effective price is used by legality, payment and the private view. */
export function cardCost(s: GameState, side: Side, id: CardId): number {
  const def = CARD_BY_ID[id],
    e = s.players[side].effects;
  if (id === 'strike' && e.freeFirstAttack && !e.freeFirstAttackUsed) return 0;
  return Math.max(
    0,
    def.cost + (def.kind === 'information' ? e.infoCostDelta : 0),
  );
}

export function cardViewDefinition(s: GameState, side: Side, id: CardId) {
  const definition = { ...CARD_BY_ID[id], cost: cardCost(s, side, id) };
  const p = s.players[side];
  if (id === 'strike') {
    const damage = Math.max(
      0,
      Math.round(
        s.rules.damagePressure *
          (1 + p.damageBonus) *
          (1 + p.effects.damageMul),
      ),
    );
    definition.short = `命中增加对手 ${damage} 压力`;
    definition.description = `命中增加对手 ${damage} 压力。只能主动打出，受击时不能响应。${p.effects.damageClues ? '伤音回响：命中后另得基础线索，支付实际线索压力。' : '攻击不获得线索。'}`;
  }
  if (id === 'information' || id === 'probe') {
    const ahead = id === 'probe' ? 1 : 0;
    const cap = id === 'probe' ? shareCap(s, side) : clueTierCap(s, side);
    const odds = effectiveClueOdds(s, s.round + ahead, cap);
    const text = odds
      .map((pct, i) =>
        pct ? `${['基础', '进阶', '关键', '终极'][i]} ${pct}%` : '',
      )
      .filter(Boolean)
      .join(' / ');
    definition.short = (id === 'probe' ? '下一轮概率：' : '本轮概率：') + text;
    definition.description = `实际抽卡分布：${text}。${
      p.effects.freeCluesUntilRound >= s.round
        ? '本轮全部信息压力为 0。'
        : `按实际档位支付线索压力${p.effects.infoPressureTax ? `，每条额外 +${p.effects.infoPressureTax}` : ''}；${
            id === 'probe'
              ? '按下一轮的表抽，额外 +5 压力；'
              : '基础/进阶/关键/终极为 6/11/16/20；'
          }`
    }无剩余资料时按规则顺延。`;
  }
  if (id === 'rest') {
    definition.short = `回复 ${1 + p.effects.restBonus} 点行动点`;
    definition.description = `自己出牌阶段免费使用，回复 ${1 + p.effects.restBonus} 点行动点，不超过上限 ${p.maxEnergy}。`;
  }
  if (id === 'intercept' && p.effects.dualResonance) {
    definition.short = '随机弃牌与扣行动点同时生效';
    definition.description =
      '对手随机弃 1 张手牌，并失去 1 点当前行动点。无法弃牌或行动点为 0 时仍结算另一项；不记下回合重复扣点。';
  }
  return definition;
}

export function hasFreeGuess(s: GameState, side: Side): boolean {
  const e = s.players[side].effects;
  return e.freeGuessPerRound && e.freeGuessUsedRound !== s.round;
}

/** Free round guess, then the one-use blind bet, then ordinary chances. */
export function guessMissCost(s: GameState, side: Side): number {
  const e = s.players[side].effects;
  if (!hasFreeGuess(s, side) && e.blindGuesses > 0) return 25;
  return Math.max(
    0,
    s.rules.guessMissPressure +
      e.guessMissDelta -
      (hasFreeGuess(s, side) ? 5 : 0),
  );
}
