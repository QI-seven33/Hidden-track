import { eligibleClues, shareCap } from './clues';
import {
  addPressure,
  reducePressure,
  draw,
  gainStageClue,
  heal,
  otherSide,
  progressionTier,
  discardCard,
  randomIndex,
  interceptApLoss,
} from './operations';
import type { CardId, GameState, Side } from './types';
export interface EffectHandler {
  canPlay?: (s: GameState, side: Side) => string | undefined;
  apply: (s: GameState, side: Side) => void;
}
export const CARD_EFFECTS: Record<CardId, EffectHandler> = {
  strike: { apply: () => {} },
  pause: { apply: () => {} },
  rest: {
    canPlay: (s, p) =>
      s.players[p].energy >= s.players[p].maxEnergy ? '行动点已满' : undefined,
    apply: (s, p) => heal(s, p, 1 + s.players[p].effects.restBonus),
  },
  breathe: {
    canPlay: (s, p) =>
      s.players[p].effects.noReliefUntil >= s.turn
        ? '本回合禁止减压'
        : s.players[p].pressure === 0
          ? '当前没有压力'
          : undefined,
    apply: (s, p) => {
      const n = Math.min(20, s.players[p].pressure);
      reducePressure(s, p, n);
    },
  },
  information: {
    canPlay: (s, p) =>
      eligibleClues(s, p, 1).length ? undefined : '本阶段没有新的可用信息',
    apply: (s, p) => {
      gainStageClue(s, p, true, 0);
    },
  },
  intercept: {
    apply: (s, p) => {
      const target = otherSide(p);
      const discardable = s.players[target].hand.filter(
        (c) => (c.lockedUntilTurn ?? 0) < s.turn,
      );
      if (s.players[p].effects.dualResonance) {
        if (discardable.length)
          discardCard(
            s,
            target,
            discardable[randomIndex(s, discardable.length)]!.id,
          );
        interceptApLoss(s, target);
        return;
      }
      if (!discardable.length) {
        interceptApLoss(s, target);
        return;
      }
      s.pending = {
        choiceId: s.nextEventId++,
        kind: 'intercept',
        actor: otherSide(p),
        target: otherSide(p),
        remaining: 1,
      };
    },
  },
  drawOne: {
    canPlay: (s, p) =>
      s.players[p].deck.length + s.players[p].discard.length === 0
        ? '没有可摸的牌'
        : undefined,
    apply: (s, p) => draw(s, p, 1),
  },
  probe: {
    canPlay: (s, p) =>
      eligibleClues(s, p, 1, shareCap(s, p)).length
        ? undefined
        : '没有可用线索',
    apply: (s, p) => {
      if (
        gainStageClue(s, p, true, 1, shareCap(s, p)) &&
        s.players[p].effects.freeCluesUntilRound < s.round
      )
        addPressure(s, p, 5, '《升 Key》额外 +5 点压力');
    },
  },
  rps: {
    canPlay: (s) =>
      (['a', 'b'] as const).some(
        (p) => eligibleClues(s, p, progressionTier(s)).length,
      )
        ? undefined
        : '双方均无可用线索',
    apply: (s, p) => {
      s.rps = { actor: p, round: 1, moves: {} };
    },
  },
};
