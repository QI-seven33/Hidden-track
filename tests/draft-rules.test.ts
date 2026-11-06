import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGame, transition } from '../src/game/engine';
import { STAGE_EVENT_BY_ID } from '../src/shared/stage-events';
import { act, play, setup } from './game-helpers';
test('event rounds produce three distinct same-colour choices and one free refresh per card', () => {
  let s = createGame('wish', 'coral', 42);
  const original = [...s.stageEvents.offers.a],
    rarity = s.stageEvents.rarity;
  s = act(s, {
    type: 'refreshEvents',
    side: 'a',
    eventId: s.stageEvents.offers.a[0]!,
  });
  assert.notDeepEqual(s.stageEvents.offers.a, original);
  assert.deepEqual(s.stageEvents.freeRefresh.a, [0, 1, 1]);
  assert.deepEqual(s.stageEvents.freeRefresh.b, [1, 1, 1]);
  assert.ok(
    s.stageEvents.offers.a.every(
      (id) => STAGE_EVENT_BY_ID[id]!.rarity === rarity,
    ),
  );
  assert.ok(
    transition(s, {
      type: 'refreshEvents',
      side: 'a',
      eventId: s.stageEvents.offers.a[0]!,
    }).error,
  );
  s.players.a.refreshes = 1;
  s = act(s, {
    type: 'refreshEvents',
    side: 'a',
    eventId: s.stageEvents.offers.a[0]!,
  });
  assert.equal(s.players.a.refreshes, 0);
});
test('round event choice order is independent of which client submits first', () => {
  const run = (order: ('a' | 'b')[]) => {
    let s = createGame('wish', 'coral', 77);
    s.stageEvents.offers = { a: ['a1'], b: ['a3'] };
    for (const side of order)
      s = act(s, {
        type: 'chooseEvent',
        side,
        eventId: side === 'a' ? 'a1' : 'a3',
      });
    return s;
  };
  assert.deepEqual(run(['a', 'b']), run(['b', 'a']));
});
test('RPS remains secret until both lock, ties repeat, winner obtains one paid clue', () => {
  let s = play(setup(['rps']), 'rps');
  s = act(s, { type: 'rps', side: 'a', move: 'rock' });
  assert.ok(transition(s, { type: 'rps', side: 'a', move: 'paper' }).error);
  s = act(s, { type: 'rps', side: 'b', move: 'rock' });
  assert.equal(s.rps!.round, 2);
  s = act(s, { type: 'rps', side: 'a', move: 'rock' });
  s = act(s, { type: 'rps', side: 'b', move: 'scissors' });
  assert.equal(s.rps, null);
  assert.equal(s.players.a.pressure, 6);
  assert.equal(s.players.a.informationUsed, true);
});
