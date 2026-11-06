import { isLocked } from '../src/game/passives';
import { waitingForEvents } from '../src/game/stage-events';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  transition,
  cardUnavailableReason,
} from '../src/game/engine';
import { SONGS } from '../src/game/catalog';
import { eligibleClues } from '../src/game/clues';
import type { GameAction, GameState, Side } from '../src/game/types';

test('independent decks, deterministic seed, immutable invalid transitions and attack response ordering', () => {
  const state = createGame('wish', 'coral', 42);
  assert.deepEqual(state, createGame('wish', 'coral', 42));
  for (const side of ['a', 'b'] as const) {
    assert.equal(state.players[side].hand.length, 4);
    assert.equal(state.players[side].deck.length, 17);
    assert.equal(state.players[side].maxEnergy, 5);
    assert.equal(state.players[side].energy, 3);
  }
  state.stageEvents.resolved = true;
  state.stageEvents.drawn = true;
  state.stageEvents.selected = { a: 'a3', b: 'a3' };
  state.players.a.hand = [{ id: 'a-test', cardId: 'strike' }];
  const before = structuredClone(state);
  const invalid = transition(state, {
    type: 'playCard',
    side: 'b',
    instanceId: 'a-test',
  });
  assert.ok(invalid.error);
  assert.strictEqual(invalid.state, state);
  const attack = transition(state, {
    type: 'playCard',
    side: 'a',
    instanceId: 'a-test',
  });
  assert.deepEqual(state, before);
  assert.equal(attack.state.players.b.energy, 3);
  assert.equal(attack.state.response?.defender, 'b');
  assert.ok(
    transition(attack.state, { type: 'respond', side: 'a', instanceId: null })
      .error,
  );
  const result = transition(attack.state, {
    type: 'respond',
    side: 'b',
    instanceId: null,
  });
  assert.equal(result.state.players.b.energy, 3);
  assert.equal(result.state.players.b.pressure, 20);
  assert.equal(result.state.players.b.clues.length, 0);
});
test('unknown metadata is omitted rather than invented as a negative fact', () => {
  const unknown = {
    ...SONGS[0]!,
    id: 'unknown',
    language: undefined,
    year: undefined,
    hasFemaleVoice: undefined,
    lyricists: [],
    composers: [],
  };
  const state = createGame('wish', 'unknown', 10, {}, [SONGS[0]!, unknown]);
  const clues = eligibleClues(state, 'a');
  for (const id of [
    'language',
    'female',
    'year',
    'period',
    'composer',
    'lyricist',
  ])
    assert.ok(!clues.some((c) => c.id === id));
});
function nextAction(s: GameState): GameAction {
  if (s.phase !== 'playing') {
    const side = s.forcedSides.find((side) => !s.guesses[side])!;
    return { type: 'guess', side, answer: { title: '没有想起' } };
  }
  if (waitingForEvents(s)) {
    const side = (['a', 'b'] as const).find((p) => !s.stageEvents.selected[p])!;
    return {
      type: 'chooseEvent',
      side,
      eventId: s.stageEvents.offers[side][0]!,
    };
  }
  if (s.response) {
    const side = s.response.defender;
    return {
      type: 'respond',
      side,
      instanceId:
        s.players[side].hand.find((c) => !cardUnavailableReason(s, side, c))
          ?.id || null,
    };
  }
  if (s.rps) {
    const side = !s.rps.moves.a ? 'a' : 'b';
    return { type: 'rps', side, move: side === 'a' ? 'rock' : 'scissors' };
  }
  if (s.pending?.kind === 'intercept')
    return {
      type: 'chooseOption',
      side: s.pending.actor,
      option: s.players[s.pending.actor].hand.some((c) => !isLocked(s, c))
        ? 'discard'
        : 'damage',
    };
  if (s.pending?.kind === 'lock')
    return {
      type: 'chooseLocks',
      side: s.pending.actor,
      indices: Array.from({ length: s.pending.remaining }, (_, i) => i),
    };
  if (s.pending)
    return {
      type: 'chooseDiscard',
      side: s.pending.actor,
      instanceId: s.players[s.pending.target].hand.find(
        (c) => !c.generated && !isLocked(s, c),
      )!.id,
    };
  const card = s.players[s.active].hand.find(
    (c) => !cardUnavailableReason(s, s.active, c),
  );
  return card
    ? { type: 'playCard', side: s.active, instanceId: card.id }
    : { type: 'endTurn', side: s.active };
}
test('100 seeded matches with the optional 20-round limit terminate and preserve card conservation', () => {
  for (let seed = 1; seed <= 100; seed++) {
    let s = createGame('wish', 'coral', seed, { maxRounds: 20 });
    let actions = 0;
    while (s.phase !== 'finished' && actions++ < 1000) {
      const result = transition(s, nextAction(s));
      assert.equal(result.error, undefined);
      s = result.state;
      for (const side of ['a', 'b'] as Side[]) {
        const player = s.players[side];
        assert.equal(
          player.hand.filter((c) => !c.generated).length +
            player.deck.length +
            player.discard.length,
          21,
        );
        assert.ok(player.energy >= 0 && player.energy <= player.maxEnergy);
        assert.ok(player.pressure >= 0 && player.pressure <= 100);
      }
    }
    assert.equal(s.phase, 'finished', `seed=${seed}`);
  }
});
