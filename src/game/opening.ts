import { CARD_BY_ID } from "../shared/cards";
import { draw } from "./operations";
import { shuffled } from "./random";
import type { CardId, GameState } from "./types";
export interface OpeningOptions {
  mode: "random" | "balanced" | "custom";
  cardIds?: readonly CardId[];
}
export function validateOpening(options: OpeningOptions, count: number) {
  if (!["random", "balanced", "custom"].includes(options.mode))
    throw new Error("起手模式不受支持");
  if (options.mode === "custom" && options.cardIds?.length !== count)
    throw new Error("起手牌数量不符");
}
export function dealOpening(state: GameState, options: OpeningOptions) {
  for (const side of ["a", "b"] as const) {
    const p = state.players[side];
    [p.deck, state.rng] = shuffled(p.deck, state.rng);
    if (options.mode === "custom" && side === "a")
      for (const id of options.cardIds!) {
        const index = p.deck.findIndex((c) => c.cardId === id);
        if (index < 0 || !CARD_BY_ID[id]) throw new Error("起手牌不在构筑中");
        p.hand.push(...p.deck.splice(index, 1));
      }
    draw(state, side, state.rules.initialHand - p.hand.length);
  }
}
