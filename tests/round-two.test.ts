import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { SONGS } from '../src/game/catalog';
import { availableClues } from '../src/game/clues';
import { createGame } from '../src/game/engine';
import { resolveEvent, resolveQueuedEvent } from '../src/game/event-effects';
import { gainClue } from '../src/game/operations';
import { PHASE_SECONDS, timeoutAction, updateClock } from '../src/game/timing';
import { Rooms } from '../src/server/rooms';
import { Store } from '../src/server/store';
import { STAGE_EVENTS } from '../src/shared/stage-events';
import { act, play, setup } from './game-helpers';
for (const def of STAGE_EVENTS)
  test(
    def.id +
      ' ' +
      def.description +
      ' resolves without spending card allowances or corrupting base instances',
    () => {
      const s = setup(['strike', 'information'], ['pause', 'rest']);
      resolveEvent(s, 'a', def.id);
      let budget = 50;
      while (s.eventQueue.length && budget-- > 0) {
        const next = s.eventQueue.shift()!;
        resolveQueuedEvent(
          s,
          next.side,
          next.eventId,
          next.depth,
          next.bonusRarity,
        );
      }
      assert.ok(budget > 0);
      assert.equal(s.players.a.attacksUsed, 0);
      assert.equal(s.players.a.informationUsed, false);
      for (const p of Object.values(s.players)) {
        assert.ok(p.energy >= 0 && p.energy <= p.maxEnergy);
        assert.ok(p.pressure >= 0 && p.pressure <= p.pressureCap);
        assert.equal(
          [...p.hand, ...p.deck, ...p.discard].filter((c) => !c.generated)
            .length,
          21,
        );
      }
    },
  );
test('author and composer are advanced; the title-character hint states which character and its position', () => {
  let s = setup();
  s.round = 3;
  const clues = availableClues(s, 'a');
  assert.equal(clues.find((c) => c.id === 'composer')?.tier, 2);
  assert.ok(!clues.some((c) => c.id === 'period' || c.id === 'firstCharacter'));
  while (
    !s.players.a.clues.some((c) => c.id === 'titleCharacter') &&
    s.players.a.clues.length < 30
  )
    gainClue(s, 'a', 3, false);
  const c = s.players.a.clues.find((c) => c.id === 'titleCharacter')!;
  // 0.9：不再只给一个字，而是「歌名的第 N 个字是「X」」，位置和字都要对得上。
  const spot = c.value.match(/^歌名的第 (\d+) 个字是「(.+)」$/);
  assert.ok(spot, c.value);
  const title = s.catalog.find((item) => item.id === 'coral')!.title;
  assert.equal([...title][Number(spot[1]) - 1], spot[2]);
});
test('lyric fallback stops once every distinct line has been used', () => {
  const s = setup();
  s.rules.fusion = false;
  s.round = 4;
  const target = s.catalog.find((c) => c.id === 'coral')!;
  target.lyricHint = '原创测试句一';
  target.lyricHints = ['原创测试句一', '原创测试句二'];
  for (let i = 0; i < 30; i++) gainClue(s, 'a', 3, false);
  const lyrics = s.players.a.clues.filter((c) => c.id.startsWith('lyric-'));
  assert.equal(lyrics.length, 2);
  assert.equal(new Set(lyrics.map((c) => c.value)).size, 2);
  const count = s.players.a.clues.length;
  assert.equal(gainClue(s, 'a', 1), false);
  assert.equal(s.players.a.clues.length, count);
});
test('clock does not refill on actions; response pauses remaining play budget and reload cannot reset it', () => {
  let s = setup(['strike'], ['pause']);
  s.clock = null;
  updateClock(s, 1000);
  const deadline = s.clock!.deadline;
  s = act(s, { type: 'guess', side: 'b', answer: { title: '错误' } }, 6000);
  assert.equal(s.clock!.deadline, deadline);
  s = act(
    s,
    { type: 'playCard', side: 'a', instanceId: s.players.a.hand[0]!.id },
    11000,
  );
  assert.equal(s.clock!.remainingPlay, 50000);
  s = act(
    s,
    { type: 'respond', side: 'b', instanceId: s.players.b.hand[0]!.id },
    20000,
  );
  assert.equal(s.clock!.deadline, 70000);
  assert.equal(PHASE_SECONDS.response, 15);
});
test('timeouts cover event choice, discard, response, guesses and RPS with legal deterministic defaults', () => {
  let s = createGame('wish', 'coral', 4);
  assert.equal(timeoutAction(s)?.type, 'chooseEvent');
  s = setup(['strike']);
  s = play(s, 'strike');
  assert.equal(timeoutAction(s)?.type, 'respond');
  s = setup(['rps']);
  s = play(s, 'rps');
  assert.equal(timeoutAction(s)?.type, 'rps');
  s = setup(['strike', 'strike', 'strike', 'strike', 'strike']);
  s.rules.handLimit = 4;
  s = act(s, { type: 'endTurn', side: 'a' });
  assert.equal(timeoutAction(s)?.type, 'chooseDiscard');
});
function roomSetup() {
  const store = new Store(':memory:', '11'.repeat(32)),
    rooms = new Rooms(store);
  const { room, invite } = rooms.create('a', '甲', 'fixture', false);
  rooms.join(room.id, invite, 'b', '乙');
  rooms.select(room.id, 'a', SONGS[0]!, 1);
  rooms.select(room.id, 'b', SONGS[1]!, 2);
  rooms.start(room.id, 'a', 3);
  return { store, rooms, id: room.id };
}

test('discard phase keeps one deadline across every chosen card', () => {
  let s = setup(['strike', 'strike', 'strike', 'strike', 'strike', 'pause']);
  s.rules.handLimit = 4;
  s = act(s, { type: 'endTurn', side: 'a' }, 1000);
  const deadline = s.clock!.deadline;
  s = act(
    s,
    { type: 'chooseDiscard', side: 'a', instanceId: s.players.a.hand[0]!.id },
    6000,
  );
  assert.equal(s.pending!.remaining, 1);
  assert.equal(s.clock!.deadline, deadline);
});
test('hidden clues are absent from the wire, including new clues and preview access count', () => {
  const { store, rooms, id } = roomSetup();
  try {
    const r = rooms.get(id);
    r.game = setup();
    r.game.round = 2;
    gainClue(r.game, 'b', 3);
    r.game.players.b.effects.hideCluesUntilRound = 2;
    rooms.save(r);
    const v = rooms.view(rooms.get(id), 'b');
    assert.equal(v.game!.cluesHidden, true);
    assert.equal(v.game!.clues.length, 0);
    r.game.round = 3;
    rooms.save(r);
    assert.equal(rooms.view(rooms.get(id), 'b').game!.cluesHidden, false);
  } finally {
    rooms.close();
    store.close();
  }
});
test('authorized lock selector sees full enemy hand only while that choice is active', () => {
  const { store, rooms, id } = roomSetup();
  try {
    const r = rooms.get(id);
    r.game = setup([], ['pause', 'rest']);
    r.game.pending = { kind: 'lock', actor: 'a', target: 'b', remaining: 2 };
    rooms.save(r);
    const a = rooms.view(rooms.get(id), 'a'),
      b = rooms.view(rooms.get(id), 'b');
    assert.deepEqual(
      a.game!.choice!.cards.map((c) => c.definition.id),
      ['pause', 'rest'],
    );
    assert.equal(b.game!.choice, undefined);
    assert.ok(!JSON.stringify(b).includes('"catalog"'));
  } finally {
    rooms.close();
    store.close();
  }
});
test('server expires disconnected rooms on reload, rematch preserves membership and invalidates old song snapshots', () => {
  const { store, rooms, id } = roomSetup();
  try {
    let r = rooms.get(id);
    r.game!.clock!.deadline = Date.now() - 1;
    rooms.save(r);
    r = rooms.get(id);
    assert.equal(r.game!.stageEvents.resolved, true);
    const finished = rooms.act(id, 'a', {
      id: randomUUID(),
      version: r.version,
      action: { type: 'guess', answer: { title: SONGS[1]!.title } },
    });
    const replayVersion = finished.room.version;
    const v = rooms.rematch(id, 'b', replayVersion);
    assert.equal(v.status, 'waiting');
    assert.equal(v.id, id);
    assert.ok(v.players.every((p) => p.joined && !p.ready));
    assert.equal(v.ownSong, undefined);
    assert.throws(() => rooms.rematch(id, 'a', v.version), /结束后/);
  } finally {
    rooms.close();
    store.close();
  }
});
