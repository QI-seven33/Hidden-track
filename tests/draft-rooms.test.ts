import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Rooms } from '../src/server/rooms';
import { Store } from '../src/server/store';
import { SONGS } from '../src/game/catalog';
import { makeApp } from '../src/server/app';
import { guest, testConfig } from './helpers';
test('removed loadout endpoint and ultimate action cannot be invoked', async () => {
  const { app } = await makeApp({ config: testConfig() });
  try {
    const a = await guest(app, '甲');
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: a,
        payload: { mode: 'fixture' },
      })
    ).json();
    const removed = await app.inject({
      method: 'POST',
      url: '/api/rooms/' + created.room.id + '/loadout',
      headers: a,
      payload: {
        version: 0,
        loadout: { cards: ['accent'], ultimate: 'pitch' },
      },
    });
    assert.equal(removed.statusCode, 404);
    const action = await app.inject({
      method: 'POST',
      url: '/api/rooms/' + created.room.id + '/action',
      headers: a,
      payload: { id: randomUUID(), version: 0, action: { type: 'ultimate' } },
    });
    assert.equal(action.statusCode, 400);
  } finally {
    await app.close();
  }
});
test('phase choices are private, versioned, deduplicated, persistent and block turns until both select', () => {
  const store = new Store(':memory:', '11'.repeat(32)),
    rooms = new Rooms(store);
  try {
    const { room, invite } = rooms.create('a', '甲', 'fixture', false),
      id = room.id;
    rooms.join(id, invite, 'b', '乙');
    let view = rooms.select(id, 'a', SONGS[0]!, 1);
    view = rooms.select(id, 'b', SONGS[1]!, view.version);
    view = rooms.start(id, 'a', view.version);
    assert.equal(rooms.get(id).game?.schemaVersion, 12);
    assert.equal(view.game?.canEndTurn, false);
    for (const key of ['ultimate', 'loadout', 'wave', 'catalog', 'rng'])
      assert.ok(!JSON.stringify(view).includes('"' + key + '"'));
    const secret = rooms.get(id);
    secret.game!.stageEvents.offers.a = ['a3'];
    secret.game!.stageEvents.offers.b = ['private-placeholder'];
    rooms.save(secret);
    assert.ok(
      !JSON.stringify(rooms.view(rooms.get(id), 'a')).includes(
        'private-placeholder',
      ),
    );
    secret.game!.stageEvents.offers.b = ['a4'];
    rooms.save(secret);
    const command = {
      id: randomUUID(),
      version: view.version,
      action: { type: 'chooseEvent' as const, eventId: 'a3' },
    };
    const first = rooms.act(id, 'a', command),
      again = rooms.act(id, 'a', command);
    assert.equal(again.replayed, true);
    assert.equal(again.room.version, first.room.version);
    assert.equal(first.room.game!.canEndTurn, false);
    assert.equal(
      rooms.get(id).game!.stageEvents.selected.a,
      command.action.eventId,
    );
    assert.equal(
      rooms.view(rooms.get(id), 'b').game!.stageEvent.selected,
      undefined,
    );
    const second = rooms.act(id, 'b', {
      id: randomUUID(),
      version: first.room.version,
      action: { type: 'chooseEvent', eventId: 'a4' },
    });
    assert.equal(rooms.view(rooms.get(id), 'a').game!.canEndTurn, true);
    assert.throws(
      () =>
        rooms.act(id, 'a', {
          id: randomUUID(),
          version: second.room.version,
          action: command.action,
        }),
      /有效事件/,
    );
    const snapshot = rooms.get(id);
    snapshot.ruleset!.revision = 3;
    rooms.save(snapshot);
    assert.throws(() => rooms.get(id), /其他版本/);
  } finally {
    rooms.close();
    store.close();
  }
});
