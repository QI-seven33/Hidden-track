import { randomInt } from 'node:crypto';
import { cardUnavailableReason } from '../game/engine';
import { isLocked } from '../game/passives';
import { waitingForEvents } from '../game/stage-events';
import { botGuess } from './practice-brain';
import type { GameState, Side } from '../game/types';
import type { PlayerAction } from '../shared/protocol';

/** Preserve the existing practice cadence; UI animation timing is independent. */
export const BOT_ACTION_DELAY = 350;

/** Uses its own hand and public state; never reads the hidden song or opponent RPS move. */
export function botAction(
  game: GameState,
  side: Side,
): PlayerAction | undefined {
  if (game.phase !== 'playing')
    return game.phase !== 'finished' &&
      game.forcedSides.includes(side) &&
      !game.guesses[side]
      ? { type: 'guess', answer: { title: '暂时没有想起' } }
      : undefined;
  if (waitingForEvents(game)) {
    const eventId = game.stageEvents.offers[side][0];
    return !game.stageEvents.selected[side] && eventId
      ? { type: 'chooseEvent', eventId }
      : undefined;
  }
  if (game.response) {
    if (game.response.defender !== side) return;
    return {
      type: 'respond',
      instanceId:
        game.players[side].hand.find(
          (c) => !cardUnavailableReason(game, side, c),
        )?.id ?? null,
    };
  }
  if (game.pending) {
    const choice = game.pending;
    if (choice.actor !== side) return;
    if (choice.kind === 'lock')
      return {
        type: 'chooseLocks',
        indices: game.players[choice.target].hand
          .map((card, index) => ({ card, index }))
          .filter(({ card }) => !isLocked(game, card))
          .slice(0, choice.remaining)
          .map(({ index }) => index),
      };
    if (choice.kind === 'intercept')
      return {
        type: 'chooseOption',
        option: game.players[side].hand.some((c) => !isLocked(game, c))
          ? 'discard'
          : 'damage',
      };
    const card = game.players[choice.target].hand.find(
      (c) => !c.generated && !isLocked(game, c),
    );
    return card ? { type: 'chooseDiscard', instanceId: card.id } : undefined;
  }
  if (game.rps)
    return game.rps.moves[side]
      ? undefined
      : {
          type: 'rps',
          move: (['rock', 'paper', 'scissors'] as const)[randomInt(3)]!,
        };
  if (game.active !== side) return;
  // 猜歌排在出牌之前：条件不满足时会落回原来的「打第一张能打的牌」。
  const guess = botGuess(game, side);
  if (guess) return guess;
  const card = game.players[side].hand.find(
    (c) => !cardUnavailableReason(game, side, c),
  );
  return card ? { type: 'playCard', instanceId: card.id } : { type: 'endTurn' };
}
