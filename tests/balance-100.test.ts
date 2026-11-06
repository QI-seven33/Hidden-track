import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardCost, guessMissCost } from '../src/game/budget';
import { availableClues, eligibleClues } from '../src/game/clues';
import {
  cardUnavailableReason,
  createGame,
  settleDeveloperChanges,
  transition,
} from '../src/game/engine';
import { resolveEvent } from '../src/game/event-effects';
import { eventPool, eventUnavailable } from '../src/game/event-eligibility';
import { addPressure, awardClue, gainClue } from '../src/game/operations';
import {
  availableGuesses,
  handLimit,
  ownTurnEnd,
  ownTurnStart,
} from '../src/game/passives';
import { beginStage, waitingForEvents } from '../src/game/stage-events';
import { timeoutAction } from '../src/game/timing';
import type { GameState, Side } from '../src/game/types';
import { RULESET } from '../src/server/ruleset';
import { CARDS, buildDeck } from '../src/shared/cards';
import { developerRulesSchema } from '../src/shared/developer';
import { PROTOCOL_VERSION, rulesSchema } from '../src/shared/protocol';
import { DEFAULT_RULES } from '../src/shared/rules';
import { STAGE_EVENTS } from '../src/shared/stage-events';
import { act, play, respond, setup } from './game-helpers';

function full(s = setup()) {
  s.round = 3;
  for (const song of s.catalog)
    Object.assign(song, {
      genre: '测试流派',
      artistGender: '1 男',
      duration: 240,
      lyricHint: '用于回归的虚构短句',
      lyricHints: ['用于回归的虚构短句'],
      previewAvailable: true,
    });
  return s;
}
const miss = (s: GameState, side: Side = 'a') =>
  act(s, { type: 'guess', side, answer: { title: '确定错误的测试歌名' } });

test('0.7 defaults, costs, versions and both validation schemas agree', () => {
  assert.deepEqual(DEFAULT_RULES, {
    maxRounds: 0,
    maxEnergy: 5,
    startingEnergy: 3,
    initialHand: 4,
    drawPerTurn: 2,
    handLimit: 4,
    pressureLimit: 100,
    damagePressure: 20,
    guessMissPressure: 25,
    cluePressure: { 1: 6, 2: 11, 3: 16, 4: 20 },
    clueOdds: {
      1: [55, 30, 15, 0],
      2: [35, 35, 25, 5],
      3: [15, 25, 35, 25],
      4: [10, 20, 25, 45],
    },
    fusion: true,
  });
  assert.deepEqual(
    CARDS.map((c) => [c.id, c.cost]),
    [
      ['strike', 1],
      ['rest', 0],
      ['breathe', 1],
      ['pause', 0],
      ['information', 1],
      ['intercept', 1],
      ['drawOne', 0],
      ['probe', 2],
      ['rps', 1],
    ],
  );
  assert.equal(buildDeck('a').length, 21);
  assert.equal(rulesSchema.safeParse(DEFAULT_RULES).success, true);
  assert.equal(developerRulesSchema.safeParse(DEFAULT_RULES).success, true);
  assert.equal(
    rulesSchema.safeParse({ ...DEFAULT_RULES, guessMissPressure: -1 }).success,
    false,
  );
  assert.equal(PROTOCOL_VERSION, 10);
  assert.equal(RULESET.revision, 15);
  assert.equal(createGame('wish', 'coral', 1).schemaVersion, 12);
});

test('opening four, first player draws once after selection, second draws once on own turn', () => {
  let s = createGame('wish', 'coral', 22);
  s.stageEvents.offers = { a: ['a3'], b: ['a4'] };
  assert.deepEqual(
    ['a', 'b'].map((x) => s.players[x as Side].hand.length),
    [4, 4],
  );
  s = act(s, { type: 'chooseEvent', side: 'b', eventId: 'a4' });
  assert.equal(s.players.a.hand.length, 4);
  s = act(s, { type: 'chooseEvent', side: 'a', eventId: 'a3' });
  assert.equal(s.players.a.hand.length, 6);
  assert.equal(s.players.b.hand.length, 4);
  s = act(s, { type: 'endTurn', side: 'a' });
  assert.equal(s.pending?.kind, 'discardOwn');
  assert.equal(s.pending?.remaining, 2);
  while (s.pending)
    s = act(s, {
      type: 'chooseDiscard',
      side: 'a',
      instanceId: s.players.a.hand[0]!.id,
    });
  assert.equal(s.players.a.hand.length, 4);
  assert.equal(s.players.b.hand.length, 6);
  s = act(s, { type: 'endTurn', side: 'b' });
  while (s.pending)
    s = act(s, {
      type: 'chooseDiscard',
      side: 'b',
      instanceId: s.players.b.hand[0]!.id,
    });
  assert.equal(s.round, 2);
  assert.equal(s.players.a.hand.length, 6);
  assert.equal(waitingForEvents(s), false);
});

test('attack spends one AP on play, adds 20 pressure on hit, grants zero clues and spends no defender AP', () => {
  let s = setup(['strike']);
  s = play(s, 'strike');
  assert.equal(s.players.a.energy, 2);
  assert.equal(s.players.b.pressure, 0);
  s = respond(s);
  assert.equal(s.players.b.pressure, 20);
  assert.equal(s.players.b.energy, 3);
  assert.equal(s.players.a.energy, 2);
  assert.equal(s.players.a.clues.length + s.players.b.clues.length, 0);
});
test('three attacks are legal, fourth fails atomically when AP exhausted', () => {
  let s = setup(['strike', 'strike', 'strike', 'strike']);
  for (let i = 0; i < 3; i++) s = respond(play(s, 'strike'));
  assert.equal(s.players.b.pressure, 60);
  assert.equal(s.players.a.energy, 0);
  const r = transition(s, {
    type: 'playCard',
    side: 'a',
    instanceId: s.players.a.hand[0]!.id,
  });
  assert.equal(r.error, '行动点不足');
  assert.strictEqual(r.state, s);
});
test('AP zero remains alive; rest is free and refills within cap; own turn end readies three and turn start preserves it', () => {
  let s = setup(['rest', 'rest']);
  s.players.a.energy = 0;
  s = play(s, 'rest');
  assert.equal(s.players.a.energy, 1);
  assert.equal(s.phase, 'playing');
  s.players.a.energy = 5;
  assert.equal(
    cardUnavailableReason(s, 'a', s.players.a.hand[0]!),
    '行动点已满',
  );
  ownTurnEnd(s, 'a');
  assert.equal(s.players.a.energy, 3);
  ownTurnStart(s, 'a');
  assert.equal(s.players.a.energy, 3);
});
test('pause is usable at zero AP and cancels all attack pressure without any dying window', () => {
  let s = setup(['strike'], ['pause', 'rest']);
  s.players.b.energy = 0;
  s = respond(play(s, 'strike'), 'pause');
  assert.equal(s.phase, 'playing');
  assert.equal(s.players.b.pressure, 0);
  assert.equal(s.players.b.energy, 0);
  assert.equal(s.response, null);
});
test('breathe spends one AP and relieves twenty; no pressure is an illegal no-op', () => {
  let s = setup(['breathe']);
  s.players.a.pressure = 25;
  s = play(s, 'breathe');
  assert.equal(s.players.a.pressure, 5);
  assert.equal(s.players.a.energy, 2);
  const z = setup(['breathe']);
  assert.equal(
    cardUnavailableReason(z, 'a', z.players.a.hand[0]!),
    '当前没有压力',
  );
});
test('information has no per-turn quota; shared AP pays one plus two', () => {
  let s = full(setup(['information', 'probe']));
  s = play(s, 'information');
  s = play(s, 'probe');
  assert.equal(s.players.a.energy, 0);
  assert.equal(s.players.a.clues.length, 2);
  // 第 3 轮：搜索是关键 16，分享已能换终极 20，再加分享本身的 +5。
  assert.equal(s.players.a.pressure, 41);
});
test('probe is one tier ahead: advanced at round one, key at two, ultimate from three', () => {
  const expect = {
    1: { tier: 2, pressure: 11 + 5 },
    2: { tier: 3, pressure: 16 + 5 },
    3: { tier: 4, pressure: 20 + 5 },
  } as const;
  for (const round of [1, 2, 3] as const) {
    let s = full(setup(['probe']));
    s.round = round;
    s = play(s, 'probe');
    assert.equal(
      s.players.a.clues[0]!.tier,
      expect[round].tier,
      `第 ${round} 轮`,
    );
    assert.equal(s.players.a.pressure, expect[round].pressure);
  }
});
test('share reaches ultimate at round three, but the round gate and a6 still hold for search', () => {
  // 第 2 轮分享最高只到关键；第 3 轮起分享可换终极，搜索仍要等第 4 轮。
  let s = full(setup(['probe']));
  s.round = 2;
  s = play(s, 'probe');
  assert.equal(s.players.a.clues[0]!.tier, 3);
  const search = full(setup(['information']));
  search.round = 3;
  const t = play(search, 'information');
  assert.equal(t.players.a.clues[0]!.tier, 3);
  // 静场把终极降级：第 3 轮分享也只能拿到关键。
  const quiet = full(setup(['probe']));
  quiet.round = 3;
  resolveEvent(quiet, 'a', 'a6');
  resolveEvent(quiet, 'b', 'a6');
  const q = play(quiet, 'probe');
  assert.equal(q.players.a.clues[0]!.tier, 3);
  assert.equal(q.players.a.pressure, 16 + 5);
});
test('lyrics and audio stay locked until round four, then cost the ultimate fee', () => {
  for (const round of [1, 2, 3]) {
    const s = full();
    s.round = round;
    assert.equal(gainClue(s, 'a', 4, false, 'lyric'), false);
    assert.equal(gainClue(s, 'a', 4, false, 'preview'), false);
    for (let i = 0; i < 30; i++) gainClue(s, 'a', 1, false);
    assert.ok(s.players.a.clues.length > 0);
    assert.ok(s.players.a.clues.every((c) => c.tier < 4));
    assert.ok(eligibleClues(s, 'a', 4).every((c) => c.tier < 4));
  }
  const s = full();
  s.round = 4;
  assert.equal(gainClue(s, 'a', 4, false, 'lyric'), true);
  assert.equal(s.players.a.clues.at(-1)!.tier, 4);
  assert.equal(gainClue(s, 'a', 4, false, 'preview'), true);
  assert.equal(s.players.a.clues.at(-1)!.tier, 4);
  s.players.a.pressure = 0;
  assert.equal(gainClue(s, 'a', 4), true);
  assert.equal(s.players.a.pressure, 20);
});
test('search and share follow the 6/11/16/20 ladder; share is one tier ahead and may reach ultimate at round 3', () => {
  const fee = { 1: 6, 2: 11, 3: 16, 4: 20 } as const;
  for (const [round, search, share] of [
    [1, 1, 2],
    [2, 2, 3],
    [3, 3, 4],
    [4, 4, 4],
    [5, 4, 4],
  ] as const) {
    let s = full(setup(['information']));
    s.round = round;
    s = play(s, 'information');
    assert.equal(s.players.a.clues[0]!.tier, search, `搜索 ${round}`);
    assert.equal(s.players.a.pressure, fee[search], `搜索压力 ${round}`);
    let t = full(setup(['probe']));
    t.round = round;
    t = play(t, 'probe');
    assert.equal(t.players.a.clues[0]!.tier, share, `分享 ${round}`);
    assert.equal(t.players.a.pressure, fee[share] + 5, `分享压力 ${round}`);
  }
});
test('first-round fallback cannot leak lyrics, audio or other key facts after lower facts run out', () => {
  const s = full();
  s.round = 1;
  for (let i = 0; i < 30; i++) gainClue(s, 'a', 1, false);
  assert.ok(s.players.a.clues.length > 0);
  assert.ok(s.players.a.clues.every((c) => c.tier < 3));
  assert.equal(gainClue(s, 'a', 3, false, 'preview'), false);
  assert.equal(gainClue(s, 'a', 3, false, 'lyric'), false);
});
test('clue histories belong to each listener independently', () => {
  const s = full();
  gainClue(s, 'a', 2, false);
  assert.equal(s.players.b.clues.length, 0);
  assert.equal(availableClues(s, 'b').filter((c) => c.tier === 2).length, 6);
});
test('AP disruption persists without a second charge at the next own turn', () => {
  let s = play(setup(['intercept'], ['pause']), 'intercept');
  s = act(s, { type: 'chooseOption', side: 'b', option: 'damage' });
  assert.equal(s.players.b.energy, 2);
  assert.equal(s.players.b.pressure, 0);
  assert.equal(s.players.b.clues.length, 0);
  s = act(s, { type: 'endTurn', side: 'a' });
  assert.equal(s.players.a.energy, 3);
  assert.equal(s.players.b.energy, 2);
  ownTurnStart(s, 'b');
  assert.equal(s.players.b.energy, 2);
  ownTurnEnd(s, 'b');
  assert.equal(s.players.b.energy, 3);
});
test('zero AP does not create debt; an empty hand resolves intercept automatically', () => {
  let s = setup(['intercept'], ['pause']);
  s.players.b.energy = 0;
  s = play(s, 'intercept');
  s = act(s, { type: 'chooseOption', side: 'b', option: 'damage' });
  ownTurnStart(s, 'b');
  assert.equal(s.players.b.energy, 0);
  ownTurnEnd(s, 'b');
  assert.equal(s.players.b.energy, 3);
  const empty = play(setup(['intercept']), 'intercept');
  assert.equal(empty.pending, null);
  assert.equal(empty.players.b.energy, 2);
});

test('fatal pressure directly ends match; no last-chance guess, no dying rescue', () => {
  let s = setup(['strike'], ['rest']);
  s.players.b.pressure = 90;
  s = respond(play(s, 'strike'));
  assert.equal(s.phase, 'finished');
  assert.equal(s.outcome?.winner, 'a');
  assert.equal(s.outcome?.reason, 'pressureGuess');
  assert.equal(s.clock, null);
  assert.equal(s.response, null);
  assert.ok(
    transition(s, { type: 'guess', side: 'b', answer: { title: '愿与愁' } })
      .error,
  );
});
test('wrong guess costs twenty-five and consumes the single ordinary chance; correct guess wins immediately', () => {
  let s = miss(setup());
  assert.equal(s.players.a.pressure, 25);
  assert.equal(availableGuesses(s, 'a'), 0);
  assert.ok(
    transition(s, { type: 'guess', side: 'a', answer: { title: '错误' } })
      .error,
  );
  s = setup();
  s.players.a.pressure = 99;
  s = act(s, {
    type: 'guess',
    side: 'a',
    answer: { title: s.catalog.find((c) => c.id === 'coral')!.title },
  });
  assert.equal(s.outcome?.winner, 'a');
  assert.equal(s.outcome?.reason, 'activeGuess');
  assert.equal(s.players.a.pressure, 99);
});
for (const window of ['response', 'rps', 'intercept', 'events'] as const)
  test(`fatal wrong guess closes outstanding ${window} immediately`, () => {
    let s =
      window === 'response'
        ? play(setup(['strike']), 'strike')
        : window === 'rps'
          ? play(setup(['rps']), 'rps')
          : window === 'intercept'
            ? play(setup(['intercept']), 'intercept')
            : createGame('wish', 'coral', 33);
    s.players.b.pressure = 80;
    s = miss(s, 'b');
    assert.equal(s.phase, 'finished');
    assert.equal(s.outcome?.winner, 'a');
    assert.equal(s.response, null);
    assert.equal(s.pending, null);
    assert.equal(s.rps, null);
    assert.equal(s.eventQueue.length, 0);
  });
test('chorus relieves its caster by 10 so only the opponent can die; queued events do not resurrect losers', () => {
  const s = full();
  s.players.a.pressure = 90;
  s.players.b.pressure = 90;
  // 0.9 起合唱额外「自身压力 -10」：同归于尽不再可能，施放方会活下来。
  s.eventQueue = [
    { side: 'a', eventId: 'b4', depth: 0 },
    { side: 'b', eventId: 'c6', depth: 0 },
  ];
  settleDeveloperChanges(s);
  assert.equal(s.phase, 'finished');
  assert.equal(s.outcome?.winner, 'a');
  assert.equal(s.players.a.pressure <= 90, true);
  assert.equal(s.players.b.effects.rescueAt80, false);
});
test('optional round limit still uses final simultaneous guessing and blocks all other actions', () => {
  let s = setup();
  s.rules.maxRounds = 1;
  s = act(s, { type: 'endTurn', side: 'a' });
  s.players.b.hand = [];
  s = act(s, { type: 'endTurn', side: 'b' });
  assert.equal(s.phase, 'finalGuess');
  assert.ok(transition(s, { type: 'endTurn', side: 'a' }).error);
  s = miss(s);
  assert.equal(s.phase, 'finalGuess');
  s = miss(s, 'b');
  assert.equal(s.outcome?.winner, 'draw');
});

test('thirty-eight unique events, thirteen/fourteen/eleven per rarity, exclusively rounds one/three/four', () => {
  assert.equal(STAGE_EVENTS.length, 38);
  assert.equal(new Set(STAGE_EVENTS.map((e) => e.id)).size, 38);
  for (const r of ['silver', 'gold', 'prismatic'])
    assert.equal(
      STAGE_EVENTS.filter((e) => e.rarity === r).length,
      { silver: 13, gold: 14, prismatic: 11 }[r],
    );
  const s = full();
  for (let round = 1; round <= 9; round++) {
    s.round = round;
    s.stageEvents.round = 0;
    s.players.a.seenEvents = [];
    s.players.b.seenEvents = [];
    beginStage(s);
    if ([1, 3, 4].includes(round)) {
      assert.equal(waitingForEvents(s), true);
      assert.equal(
        s.stageEvents.rarity,
        { 1: 'silver', 3: 'gold', 4: 'prismatic' }[round as 1 | 3 | 4],
      );
      assert.equal(new Set(s.stageEvents.offers.a).size, 3);
    } else {
      assert.equal(waitingForEvents(s), false);
      assert.equal(s.stageEvents.drawn, false);
      assert.equal(s.stageEvents.offers.a.length, 0);
    }
  }
  assert.ok(eventUnavailable(s, 'a', 'p2'));
  assert.ok(eventPool(s, 'a').some((e) => e.id === 'g-extra-listen'));
});
for (const side of ['a', 'b'] as const)
  test(`a1 and a5 are effective for ${side} in the acquisition round`, () => {
    let s = createGame('wish', 'coral', 55);
    s.stageEvents.offers = { a: ['a1'], b: ['a1'] };
    s = act(s, { type: 'chooseEvent', side: 'a', eventId: 'a1' });
    s = act(s, { type: 'chooseEvent', side: 'b', eventId: 'a1' });
    assert.equal(s.players[side].energy, 4);
    ownTurnStart(s, side);
    assert.equal(s.players[side].energy, 4);
    s = createGame('wish', 'coral', 55);
    s.stageEvents.offers = { a: ['a5'], b: ['a5'] };
    s = act(s, { type: 'chooseEvent', side: 'a', eventId: 'a5' });
    s = act(s, { type: 'chooseEvent', side: 'b', eventId: 'a5' });
    assert.equal(s.players.a.hand.length, 7);
    assert.equal(handLimit(s, side), 2);
    while (s.active === 'a')
      s = act(
        s,
        s.pending
          ? {
              type: 'chooseDiscard',
              side: 'a',
              instanceId: s.players.a.hand[0]!.id,
            }
          : { type: 'endTurn', side: 'a' },
      );
    assert.equal(s.players.b.hand.length, 7);
  });
test('a2 free attack is consumed even when blocked, and resets only on own turn', () => {
  let s = setup(['strike', 'strike'], ['pause']);
  resolveEvent(s, 'a', 'a2');
  s.players.a.energy = 0;
  s = respond(play(s, 'strike'), 'pause');
  assert.equal(s.players.a.energy, 0);
  assert.equal(cardCost(s, 'a', 'strike'), 1);
  ownTurnStart(s, 'b');
  assert.equal(cardCost(s, 'a', 'strike'), 1);
  ownTurnStart(s, 'a');
  assert.equal(cardCost(s, 'a', 'strike'), 0);
});
test('a3 rest adds two capped at five; a4 carries at most one and is not enabled for other players', () => {
  let s = setup(['rest', 'rest']);
  resolveEvent(s, 'a', 'a3');
  s.players.a.energy = 2;
  s = play(s, 'rest');
  assert.equal(s.players.a.energy, 4);
  s = play(s, 'rest');
  assert.equal(s.players.a.energy, 5);
  resolveEvent(s, 'a', 'a4');
  ownTurnEnd(s, 'a');
  ownTurnStart(s, 'a');
  assert.equal(s.players.a.energy, 4);
  s.players.a.energy = 1;
  ownTurnEnd(s, 'a');
  ownTurnStart(s, 'a');
  assert.equal(s.players.a.energy, 3);
  s.players.b.energy = 5;
  ownTurnEnd(s, 'b');
  ownTurnStart(s, 'b');
  assert.equal(s.players.b.energy, 3);
});
test('a6 downgrade covers both sides, exhausted fallback, requested audio/lyrics and direct award', () => {
  const open = full();
  open.round = 4;
  assert.equal(gainClue(open, 'a', 4, false, 'lyric'), true);
  const s = full();
  s.round = 4;
  resolveEvent(s, 'a', 'a6');
  for (const side of ['a', 'b'] as const) {
    for (let i = 0; i < 30; i++) gainClue(s, side, 4, false);
    const clues = s.players[side].clues;
    assert.ok(clues.length > 0);
    assert.ok(clues.every((c) => c.tier < 4));
    assert.ok(clues.some((c) => c.tier === 3));
    for (const requested of ['lyric', 'preview'] as const)
      assert.equal(gainClue(s, side, 4, false, requested), false);
    assert.equal(
      awardClue(s, side, {
        id: 'forbidden',
        tier: 4,
        label: '禁止',
        value: '禁止',
        text: '禁止',
        source: { label: '测试', url: '' },
      }),
      false,
    );
  }
  assert.ok(eventUnavailable(s, 'b', 'a6'));
  assert.equal(eventUnavailable(s, 'b', 'c4'), undefined);
  resolveEvent(s, 'b', 'c4');
  s.round++;
  assert.equal(
    eligibleClues(s, 'a', 3).some((c) => c.tier > 2),
    false,
  );
});
test('b1 refunds only actual damage; b5 refunds on play even if blocked, and rounds pressure once', () => {
  let s = setup(['strike'], ['pause']);
  resolveEvent(s, 'a', 'b1');
  s = respond(play(s, 'strike'), 'pause');
  assert.equal(s.players.a.energy, 2);
  s = setup(['strike']);
  resolveEvent(s, 'a', 'b1');
  s = respond(play(s, 'strike'));
  assert.equal(s.players.a.energy, 3);
  s = setup(['strike'], ['pause']);
  resolveEvent(s, 'a', 'b5');
  s = respond(play(s, 'strike'), 'pause');
  assert.equal(s.players.a.energy, 3);
  assert.equal(s.players.b.pressure, 0);
  s = setup(['strike']);
  resolveEvent(s, 'a', 'b5');
  s = respond(play(s, 'strike'));
  assert.equal(s.players.b.pressure, 17);
  assert.equal(s.players.a.clues.length, 0);
});
test('b2 discounts all three investigation cards and charges one tax per actual clue, including free rewards', () => {
  const s = full(setup(['information', 'probe', 'rps']));
  resolveEvent(s, 'a', 'b2');
  assert.deepEqual(
    ['information', 'probe', 'rps'].map((id) =>
      cardCost(s, 'a', id as 'information' | 'probe' | 'rps'),
    ),
    [0, 1, 0],
  );
  gainClue(s, 'a', 2);
  assert.equal(s.players.a.pressure, 12);
  gainClue(s, 'a', 2, false);
  assert.equal(s.players.a.pressure, 13);
  s.players.a.clues.push(...availableClues(s, 'a').filter((c) => c.tier <= 3));
  resolveEvent(s, 'a', 'a6');
  assert.equal(gainClue(s, 'a', 4), false);
  assert.equal(s.players.a.pressure, 13);
});
test('b3 pause reward pays information pressure and can cause direct loss', () => {
  let s = full(setup(['strike'], ['pause']));
  resolveEvent(s, 'b', 'b3');
  s.players.b.pressure = 90;
  s = respond(play(s, 'strike'), 'pause');
  assert.equal(s.players.b.clues.length, 1);
  assert.equal(s.players.a.clues.length, 0);
  assert.equal(s.outcome?.winner, 'a');
});
test('b6 grants one free guess per round shared across both turns, without consuming ordinary chance', () => {
  let s = full();
  resolveEvent(s, 'a', 'b6');
  assert.equal(availableGuesses(s, 'a'), 2);
  s = miss(s);
  assert.equal(s.players.a.pressure, 20);
  assert.equal(s.players.a.guessesRemaining, 1);
  ownTurnStart(s, 'a');
  assert.equal(availableGuesses(s, 'a'), 1);
  s = miss(s);
  assert.equal(s.players.a.pressure, 45);
  s.round++;
  assert.equal(availableGuesses(s, 'a'), 1);
  s = miss(s);
  assert.equal(s.players.a.pressure, 65);
});
for (const [id, expected, chances] of [
  ['c1', 15, 1],
  ['c2', 37, 2],
  ['c3', 25, 2],
] as const)
  test(`${id} guess price and finite chances`, () => {
    let s = full();
    resolveEvent(s, 'a', id);
    assert.equal(availableGuesses(s, 'a'), chances);
    assert.equal(guessMissCost(s, 'a'), expected);
    s = miss(s);
    assert.equal(s.players.a.pressure, expected);
    assert.equal(availableGuesses(s, 'a'), chances - 1);
    if (id === 'c3') {
      assert.equal(guessMissCost(s, 'a'), 25);
      s = miss(s);
      assert.equal(s.players.a.pressure, 50);
    }
  });
test('b6+c1 and b6+c2 modifiers compose without overwriting earlier effects', () => {
  for (const [id, free, ordinary] of [
    ['c1', 10, 15],
    ['c2', 32, 37],
  ] as const) {
    let s = full();
    resolveEvent(s, 'a', 'b6');
    resolveEvent(s, 'a', id);
    assert.equal(guessMissCost(s, 'a'), free);
    s = miss(s);
    assert.equal(guessMissCost(s, 'a'), ordinary);
  }
});
test('c4 blocks only the next round, including fallback and explicit rewards, then expires', () => {
  const s = full();
  s.round = 5;
  resolveEvent(s, 'a', 'c4');
  assert.equal(gainClue(s, 'b', 4, false, 'preview'), true);
  s.round = 6;
  assert.equal(gainClue(s, 'b', 4, false), false);
  assert.equal(gainClue(s, 'b', 4, false, 'preview'), false);
  for (let i = 0; i < 30; i++) gainClue(s, 'b', 1, false);
  assert.ok(s.players.b.clues.filter((c) => c.tier === 4).length === 1);
  assert.equal(s.players.b.previewSegments, 1);
  s.round = 7;
  assert.equal(gainClue(s, 'b', 4, false, 'preview'), true);
  assert.equal(s.players.b.previewSegments, 2);
});
test('c5 consumes (never deletes) two non-ultimate clues and grants one paid ultimate clue', () => {
  const s = full();
  s.round = 5;
  assert.ok(eventUnavailable(s, 'a', 'c5'));
  gainClue(s, 'a', 2, false);
  gainClue(s, 'a', 2, false);
  const before = s.players.a.clues.map((c) => c.id);
  assert.equal(eventUnavailable(s, 'a', 'c5'), undefined);
  resolveEvent(s, 'a', 'c5');
  // 线索是记忆：原料留在栏里，只被标记为已消耗。
  assert.equal(s.players.a.clues.length, 3);
  assert.deepEqual(s.players.a.clues.map((c) => c.id).slice(0, 2), before);
  assert.ok(s.players.a.clues.slice(0, 2).every((c) => c.spent));
  assert.equal(s.players.a.clues.at(-1)!.tier, 4);
  assert.ok(!before.includes(s.players.a.clues.at(-1)!.id));
  assert.equal(s.players.a.pressure, 20);
  // 已消耗的线索不能再被 c5 消耗第二次。
  assert.ok(eventUnavailable(s, 'a', 'c5'));
});
for (const pressure of [79, 90, 99])
  test(`c6 rescues from ${pressure}, before lethal pressure, exactly once`, () => {
    const s = full();
    resolveEvent(s, 'a', 'c6');
    s.players.a.pressure = pressure;
    const count = s.players.a.hand.length;
    addPressure(s, 'a', 40);
    settleDeveloperChanges(s);
    assert.equal(s.phase, 'playing');
    assert.equal(s.players.a.pressure, 50);
    assert.equal(s.players.a.hand.length, count + 2);
    addPressure(s, 'a', 60);
    settleDeveloperChanges(s);
    assert.equal(s.phase, 'finished');
    assert.equal(s.players.a.hand.length, count + 2);
  });
test('c6 selecting at high pressure triggers immediately; selecting below eighty arms without drawing', () => {
  for (const pressure of [0, 79, 80, 95]) {
    const s = full();
    s.players.a.pressure = pressure;
    const before = s.players.a.hand.length;
    resolveEvent(s, 'a', 'c6');
    assert.equal(s.players.a.pressure, pressure >= 80 ? 50 : pressure);
    assert.equal(s.players.a.hand.length, before + (pressure >= 80 ? 2 : 0));
  }
});
test('removed refresh card is absent from the deck', () => {
  assert.ok(!CARDS.some((c) => String(c.id) === 'refresh'));
});

test('timeout RPS defaults are deterministic, never read locked opponent move, and are not always won by seat a', () => {
  const wins = { a: 0, b: 0, tie: 0 };
  for (let seed = 1; seed <= 500; seed++) {
    const s = setup(['rps']);
    s.rng = seed;
    s.rps = { actor: 'a', round: 1, moves: {} };
    const aa = timeoutAction(s)!;
    assert.deepEqual(aa, timeoutAction(s));
    if (aa.type !== 'rps') throw Error();
    s.rps.moves.a = 'rock';
    const bb = timeoutAction(s)!;
    s.rps.moves.a = 'paper';
    assert.deepEqual(bb, timeoutAction(s));
    if (bb.type !== 'rps') throw Error();
    if (aa.move === bb.move) wins.tie++;
    else if (
      { rock: 'scissors', paper: 'rock', scissors: 'paper' }[aa.move] ===
      bb.move
    )
      wins.a++;
    else wins.b++;
  }
  assert.ok(wins.a > 0 && wins.b > 0 && wins.tie > 0);
});
