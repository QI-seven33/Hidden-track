import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardViewDefinition } from '../src/game/budget';
import { settleDeveloperChanges } from '../src/game/engine';
import { resolveEvent, resolveQueuedEvent } from '../src/game/event-effects';
import { eventPool, eventUnavailable } from '../src/game/event-eligibility';
import {
  addPressure,
  applyEnergyLoss,
  gainClue,
  reducePressure,
} from '../src/game/operations';
import {
  drawTurn,
  handLimit,
  ownTurnEnd,
  ownTurnStart,
  roundStart,
} from '../src/game/passives';
import { nextRandom } from '../src/game/random';
import type { GameState } from '../src/game/types';
import { CARDS, buildDeck } from '../src/shared/cards';
import { STAGE_EVENTS } from '../src/shared/stage-events';
import { act, play, respond, setup } from './game-helpers';

function drain(s: GameState) {
  let count = 0;
  while (s.eventQueue.length) {
    assert.ok(++count < 128, 'recursive grants must terminate');
    const e = s.eventQueue.shift()!;
    resolveQueuedEvent(s, e.side, e.eventId, e.depth, e.bonusRarity);
  }
  return count;
}
function full() {
  const s = setup();
  s.round = 4;
  return s;
}

test('0.9 uses the nine renamed cards and 21 independent physical instances per side', () => {
  assert.deepEqual(
    new Set(CARDS.map((c) => c.title)),
    new Set([
      '封麦',
      '蓝调',
      '和声',
      '奏鸣',
      '共鸣',
      '进拍',
      '引子',
      '升 Key',
      '猜先',
    ]),
  );
  for (const side of ['a', 'b'] as const) {
    const deck = buildDeck(side);
    assert.equal(deck.length, 21);
    assert.equal(new Set(deck.map((c) => c.id)).size, 21);
    assert.ok(!deck.some((c) => String(c.cardId) === 'refresh'));
  }
  assert.deepEqual(
    ['silver', 'gold', 'prismatic'].map(
      (r) => STAGE_EVENTS.filter((e) => e.rarity === r).length,
    ),
    [13, 14, 11],
  );
  assert.ok(STAGE_EVENTS.every((e) => !e.description.includes('海' + '克斯')));
});

test('turn-end energy readies the next turn; first-turn and repeated disruption never double charge', () => {
  let s = setup(['intercept', 'intercept'], ['pause']);
  s = play(s, 'intercept');
  s = act(s, { type: 'chooseOption', side: 'b', option: 'damage' });
  s = play(s, 'intercept');
  s = act(s, { type: 'chooseOption', side: 'b', option: 'damage' });
  assert.equal(s.players.b.energy, 1);
  s = act(s, { type: 'endTurn', side: 'a' });
  assert.equal(s.players.a.energy, 3);
  assert.equal(s.players.b.energy, 1);
  ownTurnStart(s, 'b');
  assert.equal(s.players.b.energy, 1);
  ownTurnEnd(s, 'b');
  assert.equal(s.players.b.energy, 3);
  applyEnergyLoss(s, 'b', 1);
  ownTurnStart(s, 'b');
  assert.equal(s.players.b.energy, 2);
  assert.ok(!('nextTurnApPenalty' in s.players.b.effects));
});

test('carry and permanent AP bonuses are computed from the pre-reset budget exactly once', () => {
  const s = setup();
  const p = s.players.a;
  p.effects.apBonus = 1;
  p.effects.carryApEnabled = true;
  p.energy = 2;
  ownTurnEnd(s, 'a');
  assert.equal(p.energy, 5);
  applyEnergyLoss(s, 'a', 1);
  ownTurnStart(s, 'a');
  assert.equal(p.energy, 4);
  p.energy = 1;
  ownTurnEnd(s, 'a');
  assert.equal(p.energy, 4);
});

test('resonance resolves an empty or all-locked hand without a choice; zero energy never creates debt', () => {
  let s = play(setup(['intercept']), 'intercept');
  assert.equal(s.pending, null);
  assert.equal(s.players.b.energy, 2);
  s = setup(['intercept'], ['pause']);
  s.players.b.hand[0]!.lockedUntilTurn = 99;
  s.players.b.energy = 0;
  s = play(s, 'intercept');
  assert.equal(s.pending, null);
  assert.equal(s.players.b.hand.length, 1);
  ownTurnStart(s, 'b');
  assert.equal(s.players.b.energy, 0);
  ownTurnEnd(s, 'b');
  assert.equal(s.players.b.energy, 3);
});

test('dual resonance applies both independent effects and preserves all 21 physical cards', () => {
  let s = setup(['intercept'], ['pause']);
  resolveEvent(s, 'a', 'p-dual-resonance');
  s = play(s, 'intercept');
  assert.equal(s.pending, null);
  assert.equal(s.players.b.energy, 2);
  assert.equal(s.players.b.hand.length, 0);
  assert.equal(s.players.b.discard.length, 1);
  assert.equal(
    s.players.b.hand.length +
      s.players.b.deck.length +
      s.players.b.discard.length,
    21,
  );
  ownTurnStart(s, 'b');
  assert.equal(s.players.b.energy, 2);
  const shown = cardViewDefinition(s, 'a', 'intercept');
  assert.ok(shown.description.includes('并失去'));
  assert.ok(!shown.description.includes('二选一'));
});

test('slow breathing checks the completed own turn, counts blocked attacks, and skips the first turn', () => {
  const s = setup();
  resolveEvent(s, 'a', 's-slow-breath');
  s.players.a.pressure = 30;
  s.players.a.turnsStarted = 0;
  ownTurnStart(s, 'a');
  assert.equal(s.players.a.pressure, 30);
  s.players.a.attacksUsed = 1;
  ownTurnStart(s, 'a');
  assert.equal(s.players.a.pressure, 30);
  s.players.a.attacksUsed = 0;
  ownTurnStart(s, 'a');
  assert.equal(s.players.a.pressure, 25);
  s.players.a.effects.noReliefUntil = s.turn;
  ownTurnStart(s, 'a');
  assert.equal(s.players.a.pressure, 25);
});

test('long breathing triggers immediately, not again in the acquisition round, then once in later own rounds', () => {
  for (const side of ['a', 'b'] as const) {
    const s = setup();
    s.players[side].pressure = 30;
    resolveEvent(s, side, 'g-long-breath');
    assert.equal(s.players[side].pressure, 25);
    ownTurnStart(s, side);
    assert.equal(s.players[side].pressure, 25);
    s.round++;
    ownTurnStart(s, side);
    assert.equal(s.players[side].pressure, 20);
    ownTurnStart(s, side);
    assert.equal(s.players[side].pressure, 20);
  }
});

test('silence forbids normal relief, passive relief, rescue and lowering pressure by swapping', () => {
  const s = setup();
  s.players.b.pressure = 80;
  s.players.b.effects.rescueAt80 = true;
  resolveEvent(s, 'a', 's-silence-chain');
  assert.equal(s.players.b.effects.noReliefUntil, 2);
  s.turn = 2;
  s.active = 'b';
  reducePressure(s, 'b', 20);
  addPressure(s, 'b', 0);
  ownTurnStart(s, 'b');
  assert.equal(s.players.b.pressure, 80);
  assert.equal(s.players.b.effects.rescueAt80, true);
  assert.ok(eventUnavailable(s, 'b', 'p-pressure-swap'));
  resolveEvent(s, 'b', 'p-pressure-swap');
  assert.equal(s.players.b.pressure, 80);
  s.turn = 3;
  ownTurnStart(s, 'b');
  assert.equal(s.players.b.pressure, 50);
  assert.equal(s.players.b.effects.rescueAt80, false);
});

test('a forbidden rescue cannot prevent pressure loss; lowering the cap uses the same lethal settlement', () => {
  let s = setup(['strike']);
  s.players.b.pressure = 80;
  s.players.b.effects.rescueAt80 = true;
  s.players.b.effects.noReliefUntil = 99;
  s = respond(play(s, 'strike'));
  assert.equal(s.phase, 'finished');
  assert.equal(s.outcome?.winner, 'a');
  s = setup();
  s.players.b.pressure = 90;
  resolveEvent(s, 'a', 'p-tight-threshold');
  settleDeveloperChanges(s);
  assert.equal(s.players.b.pressureCap, 85);
  assert.equal(s.phase, 'finished');
  assert.equal(s.outcome?.winner, 'a');
});

test('roaring pressure is a fixed fifteen; skip discard never protects against a forced discard', () => {
  let s = setup(['intercept'], ['pause']);
  resolveEvent(s, 'a', 's-roaring-pressure');
  assert.equal(s.players.b.pressure, 15);
  resolveEvent(s, 'b', 'p-endless-score');
  s = play(s, 'intercept');
  s = act(s, { type: 'chooseOption', side: 'b', option: 'discard' });
  assert.equal(s.players.b.hand.length, 0);
  resolveEvent(s, 'a', 's-hidden-record');
  assert.equal(handLimit(s, 'a'), 5);
});

test('draw penalty is consumed once and morph changes only the unlocked left card after drawing', () => {
  const s = setup(['strike']);
  resolveEvent(s, 'a', 'g-missing-beat');
  const before = s.players.b.hand.length;
  drawTurn(s, 'b');
  assert.equal(s.players.b.hand.length, before + 1);
  drawTurn(s, 'b');
  assert.equal(s.players.b.hand.length, before + 3);
  resolveEvent(s, 'a', 's-flowing-score');
  const left = s.players.a.hand[0]!;
  const id = left.id;
  drawTurn(s, 'a');
  assert.equal(left.id, id);
  assert.notEqual(left.cardId, 'strike');
  const kind = left.cardId;
  left.lockedUntilTurn = 99;
  drawTurn(s, 'a');
  assert.equal(left.cardId, kind);
  assert.equal(
    s.players.a.hand.length +
      s.players.a.deck.length +
      s.players.a.discard.length,
    21,
  );
});

test('damage echoes require actual nonlethal damage, charge clues, and respect blue responses and shields', () => {
  let s = setup(['strike', 'strike', 'strike'], ['pause']);
  resolveEvent(s, 'a', 'g-wound-echo');
  s = respond(play(s, 'strike'), 'pause');
  assert.equal(s.players.a.clues.length, 0);
  resolveEvent(s, 'b', 'g-rest-shelter');
  s = respond(play(s, 'strike'));
  assert.equal(s.players.a.clues.length, 0);
  assert.equal(s.players.b.shields, 0);
  s = respond(play(s, 'strike'));
  assert.equal(s.players.a.clues.length, 1);
  assert.equal(s.players.a.pressure, 6);
  s = setup(['strike']);
  resolveEvent(s, 'a', 'g-wound-echo');
  s.players.b.pressure = 90;
  s.players.a.pressure = 99;
  s = respond(play(s, 'strike'));
  assert.equal(s.outcome?.winner, 'a');
  assert.equal(s.players.a.clues.length, 0);
  assert.equal(s.players.a.pressure, 99);
  s = setup(['strike']);
  resolveEvent(s, 'a', 'g-wound-echo');
  s.players.a.pressure = 99;
  s = respond(play(s, 'strike'));
  assert.equal(s.outcome?.winner, 'b');
  assert.equal(s.players.a.clues.length, 1);
});

test('noise-free sampling suppresses base, tax, probe surcharge and event clue pressure for only its round', () => {
  let s = setup(['information', 'probe']);
  resolveEvent(s, 'a', 'b2');
  resolveEvent(s, 'a', 'g-noise-free');
  s = play(s, 'information');
  s = play(s, 'probe');
  resolveEvent(s, 'a', 'g-dice-law');
  assert.equal(s.players.a.pressure, 0);
  assert.ok(s.players.a.clues.length >= 3);
  assert.ok(
    cardViewDefinition(s, 'a', 'probe').description.includes('压力为 0'),
  );
  s.round++;
  gainClue(s, 'a', 1);
  assert.ok(s.players.a.pressure >= 7);
});

test('fifth movement gives exactly two paid clues once at round five and cannot be offered after its trigger', () => {
  const s = full();
  resolveEvent(s, 'a', 's-fifth-movement');
  roundStart(s);
  assert.equal(s.players.a.clues.length, 0);
  s.round = 5;
  roundStart(s);
  assert.equal(s.players.a.clues.length, 2);
  assert.equal(s.players.a.pressure, 32);
  roundStart(s);
  assert.equal(s.players.a.clues.length, 2);
  const late = full();
  late.round = 5;
  assert.ok(eventUnavailable(late, 'a', 's-fifth-movement'));
  const blocked = full();
  resolveEvent(blocked, 'a', 's-fifth-movement');
  resolveEvent(blocked, 'b', 'c4');
  blocked.round = 5;
  roundStart(blocked);
  assert.ok(blocked.players.a.clues.every((c) => c.tier <= 2));
  assert.equal(blocked.players.a.clues.length, 0);
  assert.equal(blocked.players.a.pressure, 0);
});

test('dice law uses exactly a seeded d6 then acquires one paid clue from the mapped tier', () => {
  const rolled = new Set<number>();
  for (let seed = 1; seed <= 300; seed++) {
    const s = full();
    s.rng = seed * 1234567;
    const roll = Math.floor(nextRandom(s.rng)[0] * 6) + 1;
    rolled.add(roll);
    resolveEvent(s, 'a', 'g-dice-law');
    assert.equal(s.players.a.clues.length, 1);
    const tier = roll <= 3 ? 1 : roll <= 5 ? 2 : 3;
    assert.equal(s.players.a.clues[0]!.tier, tier);
    assert.equal(s.players.a.pressure, s.rules.cluePressure[tier]);
  }
  assert.equal(rolled.size, 6);
});

test('recursive gold → prismatic → gift grants terminate, stay unique and replay deterministically', () => {
  let found = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const run = () => {
      const s = full();
      s.rng = seed;
      s.players.a.pressure = 30;
      const allowed = new Set([
        's-gold-tune',
        'g-prismatic-tune',
        'p-harmonic-gift',
        'a3',
        'g-long-breath',
        'p-endless-score',
      ]);
      s.players.a.seenEvents = STAGE_EVENTS.filter(
        (e) => !allowed.has(e.id),
      ).map((e) => e.id);
      resolveEvent(s, 'a', 's-gold-tune');
      drain(s);
      return s;
    };
    const s = run();
    assert.deepEqual(s, run());
    const ids = s.players.a.eventHistory.map((h) => h.id);
    assert.equal(ids.length, new Set(ids).size);
    if (ids.includes('g-prismatic-tune') && ids.includes('p-harmonic-gift')) {
      found++;
      assert.equal(ids.length, 5);
      assert.ok(
        s.players.a.eventHistory.slice(1).every((h) => h.origin === 'bonus'),
      );
    }
  }
  assert.ok(found > 0, 'must actually exercise nested transformations');
});

test('gift has two unique grants across random colours; acquired or queued events cannot be awarded twice', () => {
  const colors = new Set<string>();
  for (let seed = 1; seed <= 160; seed++) {
    const s = full();
    s.rng = seed * 8191;
    s.players.a.pressure = 30;
    resolveEvent(s, 'a', 'p-harmonic-gift');
    drain(s);
    const history = s.players.a.eventHistory;
    assert.ok(history.length >= 3);
    assert.equal(new Set(history.map((h) => h.id)).size, history.length);
    for (const h of history.slice(1))
      colors.add(STAGE_EVENTS.find((e) => e.id === h.id)!.rarity);
    assert.ok(history.length <= STAGE_EVENTS.length);
  }
  assert.equal(colors.size, 3);
  const s = full();
  s.eventQueue.push({ side: 'a', eventId: 'g-extra-listen', depth: 1 });
  assert.ok(!eventPool(s, 'a').some((e) => e.id === 'g-extra-listen'));
});

test('pressure swap is immediate, respects each cap, and additional guesses persist without altering miss price', () => {
  const s = full();
  s.players.a.pressure = 60;
  s.players.b.pressure = 20;
  resolveEvent(s, 'a', 'p-pressure-swap');
  assert.deepEqual([s.players.a.pressure, s.players.b.pressure], [20, 60]);
  const before = s.players.a.guessesRemaining;
  resolveEvent(s, 'a', 'g-extra-listen');
  assert.equal(s.players.a.guessesRemaining, before + 1);
});

test('event-node grants and locks resolve before the first seat begins its passives', () => {
  let s = setup();
  s.round = 2;
  s.turn = 4;
  s.active = 'b';
  s.players.a.turnsStarted = 2;
  s.players.a.attacksUsed = 0;
  s.players.a.pressure = 30;
  s.players.a.effects.slowBreath = true;
  s.players.a.effects.regenPressure = 1;
  s.players.a.effects.regenAppliedRound = 2;
  s = act(s, { type: 'endTurn', side: 'b' });
  assert.equal(s.round, 3);
  assert.equal(s.players.a.pressure, 30);
  // A staged grant is equivalent whether selected directly or granted recursively.
  s.stageEvents.offers = { a: ['a3'], b: ['s-silence-chain'] };
  s = act(s, { type: 'chooseEvent', side: 'a', eventId: 'a3' });
  s = act(s, { type: 'chooseEvent', side: 'b', eventId: 's-silence-chain' });
  assert.equal(s.players.a.pressure, 30);
  assert.equal(s.players.a.turnsStarted, 3);
  let late = setup();
  late.round = 3;
  late.turn = 6;
  late.active = 'b';
  late.players.a.turnsStarted = 3;
  late.players.a.attacksUsed = 0;
  late.players.a.pressure = 30;
  late = act(late, { type: 'endTurn', side: 'b' });
  late.stageEvents.offers = { a: ['s-slow-breath'], b: ['a3'] };
  late = act(late, {
    type: 'chooseEvent',
    side: 'a',
    eventId: 's-slow-breath',
  });
  late = act(late, { type: 'chooseEvent', side: 'b', eventId: 'a3' });
  assert.equal(late.players.a.pressure, 25);
});
