import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/server/store';
import { Rooms } from '../src/server/rooms';
import { botAction } from '../src/server/practice-bot';
import { createGame, transition } from '../src/game/engine';
import { setup } from './game-helpers';
import { guessCandidates } from '../src/server/practice-brain';
import type { Clue, GameState } from '../src/game/types';

function practice(game: GameState) {
  const store = new Store(':memory:', '11'.repeat(32));
  const errors: unknown[] = [];
  const rooms = new Rooms(store, false, undefined, (error) =>
    errors.push(error),
  );
  const { room: view } = rooms.create('human', '玩家', 'fixture', true);
  const room = rooms.get(view.id);
  room.game = game;
  rooms.save(room);
  rooms.publish(room);
  return {
    store,
    rooms,
    id: room.id,
    errors,
    close: () => {
      rooms.close();
      store.close();
    },
  };
}
const cards = (s: GameState) =>
  s.events.filter((e) => e.kind === 'card' && e.side === 'b').length;

/** 电脑的猜歌线索夹具：只要 id 与 value 对得上，取值口径与 clues.ts 一致。 */
const clue = (id: string, value: string): Clue => ({
  id,
  label: id,
  tier: 2,
  value,
  text: value,
  source: { label: '测试', url: '' },
});
function botTurn(clues: Clue[], round: number) {
  const game = setup([], ['drawOne']);
  game.active = 'b';
  game.round = round;
  game.players.b.clues = clues;
  return game;
}

test('电脑前三轮只出牌，到第 4 轮才按自己的线索赌一把', () => {
  const early = botTurn([clue('artist', '林俊杰')], 3);
  assert.notEqual(botAction(early, 'b')?.type, 'guess');
  const late = botTurn([clue('artist', '林俊杰')], 4);
  const action = botAction(late, 'b');
  assert.deepEqual(action, { type: 'guess', answer: { title: '愿与愁' } });
  assert.equal(transition(late, { ...action!, side: 'b' }).error, undefined);
});

test('歌词与试听不算数：电脑听不懂，候选不会因此收敛', () => {
  const game = botTurn(
    [clue('lyric-0', '圈圈圆圆圈圈'), clue('preview-0', '0–10 秒')],
    4,
  );
  assert.equal(guessCandidates(game, 'b').length, game.catalog.length);
  // 池子没收敛，但它照样会瞎挑一首；这一步必须是合法动作。
  const action = botAction(game, 'b');
  assert.equal(action?.type, 'guess');
  assert.equal(transition(game, { ...action!, side: 'b' }).error, undefined);
});

test('记性只有一条：后面的线索不参与筛选，压力到线也不赌', () => {
  const two = botTurn(
    [clue('artistCount', '1 位'), clue('artist', '林俊杰')],
    4,
  );
  // 只用第一条（署名歌手数）时是 8 首，全用才会收敛到 1 首。
  assert.equal(guessCandidates(two, 'b').length, 8);
  assert.equal(guessCandidates(two, 'b', 2).length, 1);
  const uneasy = botTurn([clue('artist', '林俊杰')], 4);
  uneasy.players.b.pressure = 75;
  assert.notEqual(botAction(uneasy, 'b')?.type, 'guess');
  const blind = botTurn([], 4);
  assert.notEqual(botAction(blind, 'b')?.type, 'guess');
});

test('bot locks only eligible indices and its move passes the real rule engine', () => {
  const game = setup(['strike', 'rest', 'drawOne'], []);
  game.players.a.hand[0]!.lockedUntilTurn = game.turn + 5;
  game.pending = {
    kind: 'lock',
    actor: 'b',
    target: 'a',
    remaining: 2,
    choiceId: 99,
  };
  const action = botAction(game, 'b');
  assert.deepEqual(action, { type: 'chooseLocks', indices: [1, 2] });
  assert.equal(transition(game, { ...action!, side: 'b' }).error, undefined);
});

test('bot waits for human choices and discards an unlocked non-generated card', () => {
  const game = setup([], ['strike', 'rest', 'drawOne']);
  game.pending = { kind: 'discardOwn', actor: 'b', target: 'b', remaining: 1 };
  game.players.b.hand[0]!.lockedUntilTurn = game.turn + 5;
  game.players.b.hand[1]!.generated = true;
  const action = botAction(game, 'b');
  assert.deepEqual(action, {
    type: 'chooseDiscard',
    instanceId: game.players.b.hand[2]!.id,
  });
  assert.equal(transition(game, { ...action!, side: 'b' }).error, undefined);
  game.pending.actor = 'a';
  assert.equal(botAction(game, 'b'), undefined);
  game.pending.actor = 'b';
  game.players.b.hand = [];
  assert.equal(botAction(game, 'b'), undefined);
});

test('bot preserves its existing cadence; duplicate snapshots do not postpone it', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  const game = setup([], ['drawOne', 'drawOne']);
  game.active = 'b';
  const p = practice(game);
  try {
    t.mock.timers.tick(200);
    p.rooms.publish(p.rooms.get(p.id));
    t.mock.timers.tick(149);
    assert.equal(cards(p.rooms.get(p.id).game!), 0);
    t.mock.timers.tick(1);
    assert.equal(cards(p.rooms.get(p.id).game!), 1);
    t.mock.timers.tick(349);
    assert.equal(cards(p.rooms.get(p.id).game!), 1);
    t.mock.timers.tick(1);
    assert.equal(cards(p.rooms.get(p.id).game!), 2);
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test('a changed snapshot starts a new delay; stale timer cannot rush a new response', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  const game = setup(['strike'], ['pause']);
  game.stageEvents.resolved = false;
  game.stageEvents.selected = { a: 'a3' };
  game.stageEvents.offers.b = ['a3'];
  const p = practice(game);
  try {
    t.mock.timers.tick(250);
    const room = p.rooms.get(p.id);
    const attacking = setup(['strike'], ['pause']);
    room.game = transition(
      attacking,
      {
        type: 'playCard',
        side: 'a',
        instanceId: attacking.players.a.hand[0]!.id,
      },
      Date.now(),
    ).state;
    room.version++;
    p.rooms.save(room);
    p.rooms.publish(room);
    t.mock.timers.tick(100); // Old event timer would have fired now.
    assert.equal(p.rooms.get(p.id).game!.response?.defender, 'b');
    t.mock.timers.tick(249);
    assert.equal(p.rooms.get(p.id).game!.response?.defender, 'b');
    t.mock.timers.tick(1);
    assert.equal(p.rooms.get(p.id).game!.response, null);
    assert.equal(cards(p.rooms.get(p.id).game!), 1);
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test('bot pause cancels pending work; resume receives a fresh delay and close clears work', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  const game = setup([], ['drawOne']);
  game.active = 'b';
  const p = practice(game);
  try {
    t.mock.timers.tick(300);
    let room = p.rooms.get(p.id);
    room.developer = { used: true, paused: true };
    room.version++;
    p.rooms.save(room);
    p.rooms.publish(room);
    t.mock.timers.tick(2000);
    assert.equal(cards(p.rooms.get(p.id).game!), 0);
    room = p.rooms.get(p.id);
    room.developer!.paused = false;
    room.version++;
    p.rooms.save(room);
    p.rooms.publish(room);
    t.mock.timers.tick(349);
    assert.equal(cards(p.rooms.get(p.id).game!), 0);
    t.mock.timers.tick(1);
    assert.equal(cards(p.rooms.get(p.id).game!), 1);
    p.rooms.close();
    t.mock.timers.tick(60000);
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test('bot first seat uses the same legal response and pacing path after swapping seats', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  const p = practice(setup(['drawOne'], []));
  try {
    const room = p.rooms.get(p.id);
    [room.players.a, room.players.b] = [room.players.b, room.players.a];
    room.version++;
    p.rooms.save(room);
    p.rooms.publish(room);
    t.mock.timers.tick(349);
    assert.equal(
      p.rooms.get(p.id).game!.events.some((e) => e.kind === 'card'),
      false,
    );
    t.mock.timers.tick(1);
    assert.equal(
      p.rooms
        .get(p.id)
        .game!.events.some((e) => e.kind === 'card' && e.side === 'a'),
      true,
    );
    assert.deepEqual(p.errors, []);
  } finally {
    p.close();
  }
});

test('bot decisions remain legal across seeded games, including generated event choices', () => {
  for (let seed = 1; seed <= 60; seed++) {
    let game = createGame('wish', 'coral', seed);
    for (let step = 0; step < 500 && game.phase !== 'finished'; step++) {
      const side = botAction(game, 'b') ? 'b' : 'a';
      const action = botAction(game, side);
      assert.ok(action, `no move at seed ${seed}, step ${step}`);
      const result = transition(game, { ...action, side }, step * 1000);
      assert.equal(
        result.error,
        undefined,
        `seed ${seed}, step ${step}, ${action.type}: ${result.error}`,
      );
      game = result.state;
    }
  }
});
