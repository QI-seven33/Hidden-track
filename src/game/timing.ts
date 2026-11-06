import type { GameAction, GameState, Side } from './types';
import { waitingForEvents } from './stage-events';
import { isLocked } from './passives';
/** Play budgets pause during responses and choices; clicks never replenish them. */
export const PHASE_SECONDS = {
  events: 30,
  play: 60,
  discard: 20,
  response: 15,
  choice: 20,
  guess: 30,
};
export function clockPhase(s: GameState) {
  if (s.phase === 'finished') return null;
  if (s.phase !== 'playing')
    return {
      key: s.phase + ':' + s.forcedSides.join(','),
      kind: 'guess',
      seconds: PHASE_SECONDS.guess,
    };
  if (waitingForEvents(s))
    return {
      key: 'events:' + s.round,
      kind: 'events',
      seconds: PHASE_SECONDS.events,
    };
  if (s.response)
    return {
      key:
        'response:' +
        s.turn +
        ':' +
        s.response.windowId +
        ':' +
        s.response.kind,
      kind: 'response',
      seconds: PHASE_SECONDS.response,
    };
  if (s.pending)
    return {
      key:
        'choice:' +
        s.turn +
        ':' +
        s.pending.actor +
        ':' +
        s.pending.kind +
        ':' +
        s.pending.choiceId,
      kind: s.pending.kind === 'discardOwn' ? 'discard' : 'choice',
      seconds:
        s.pending.kind === 'discardOwn'
          ? PHASE_SECONDS.discard
          : PHASE_SECONDS.choice,
    };
  if (s.rps)
    return {
      key: 'rps:' + s.turn + ':' + s.rps.round,
      kind: 'choice',
      seconds: PHASE_SECONDS.choice,
    };
  return {
    key: 'play:' + s.turn,
    kind: 'play',
    seconds: Math.max(
      10,
      PHASE_SECONDS.play - s.players[s.active].effects.playSecondsPenalty,
    ),
  };
}
export function updateClock(s: GameState, now: number) {
  const phase = clockPhase(s);
  if (!phase) {
    s.clock = null;
    return;
  }
  const prior = s.clock;
  const playKey = 'play:' + s.turn;
  let remaining =
    prior?.playKey === playKey
      ? prior.remainingPlay
      : Math.max(
          10,
          PHASE_SECONDS.play - s.players[s.active].effects.playSecondsPenalty,
        ) * 1000;
  if (prior?.key === playKey)
    remaining = Math.max(0, remaining - Math.max(0, now - prior.updatedAt));
  const same = prior?.key === phase.key;
  s.clock = {
    key: phase.key,
    deadline: same
      ? prior.deadline
      : now + (phase.kind === 'play' ? remaining : phase.seconds * 1000),
    remainingPlay: remaining,
    playKey,
    updatedAt: now,
  };
}
export function timeoutAction(s: GameState): GameAction | undefined {
  if (s.phase === 'finished') return;
  if (s.phase !== 'playing') {
    const side = s.forcedSides.find((p) => !s.guesses[p]);
    return side
      ? { type: 'guess', side, answer: { title: '（超时未提交）' } }
      : undefined;
  }
  if (waitingForEvents(s)) {
    const side = (['a', 'b'] as Side[]).find(
      (p) => !s.stageEvents.selected[p],
    )!;
    return {
      type: 'chooseEvent',
      side,
      eventId: s.stageEvents.offers[side][0]!,
    };
  }
  if (s.response)
    return { type: 'respond', side: s.response.defender, instanceId: null };
  if (s.pending) {
    const side = s.pending.actor;
    if (s.pending.kind === 'intercept')
      return {
        type: 'chooseOption',
        side,
        option: s.players[side].hand.some((c) => !isLocked(s, c))
          ? 'discard'
          : 'damage',
      };
    if (s.pending.kind === 'lock')
      return {
        type: 'chooseLocks',
        side,
        indices: s.players[s.pending.target].hand
          .map((c, i) => ({ c, i }))
          .filter(({ c }) => !isLocked(s, c))
          .slice(0, s.pending.remaining)
          .map(({ i }) => i),
      };
    const card = s.players[side].hand.find(
      (c) => !c.generated && !isLocked(s, c),
    );
    return card
      ? { type: 'chooseDiscard', side, instanceId: card.id }
      : undefined;
  }
  if (s.rps) {
    const side: Side = s.rps.moves.a ? 'b' : 'a';
    // Seeded, seat-independent distribution; never inspect the opponent's locked move.
    let seed =
      s.rng ^
      Math.imul(s.turn, 0x9e3779b9) ^
      Math.imul(s.rps.round, 0x85ebca6b) ^
      (side === 'a' ? 0x243f6a88 : 0xc2b2ae35);
    seed = Math.imul(seed ^ (seed >>> 16), 0x21f0aaad);
    seed = Math.imul(seed ^ (seed >>> 15), 0x735a2d97);
    const random = ((seed ^ (seed >>> 15)) >>> 0) / 0x100000000;
    return {
      type: 'rps',
      side,
      move: (['rock', 'paper', 'scissors'] as const)[Math.floor(random * 3)]!,
    };
  }
  return { type: 'endTurn', side: s.active };
}
