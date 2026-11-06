import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from '../src/server/app';
import { testConfig } from './helpers';
import { hash } from '../src/server/rooms';
import { Rooms } from '../src/server/rooms';
import { Store } from '../src/server/store';
import { SONGS } from '../src/game/catalog';
import { resolveEvent } from '../src/game/event-effects';
import { randomUUID } from 'node:crypto';
import { setup } from './game-helpers';

test('0.7 adopts a valid copied session into its own cookie, without changing the original cookie or encrypted authorization', async () => {
  const { app, store } = await makeApp({
    config: testConfig(),
    sessionCookieName: 'music_session_07',
    legacySessionCookieName: 'music_session',
  });
  try {
    const raw = 'a'.repeat(43),
      session = hash(raw);
    store.createSession(session, '隔离测试');
    store.setAuth(session, {
      openId: 'fixture-id',
      accessToken: 'fixture-private-token',
      expiresAt: Date.now() + 60000,
    });
    const r = await app.inject({
      url: '/api/session',
      headers: { cookie: `music_session=${raw}` },
    });
    assert.equal(r.statusCode, 200);
    assert.match(String(r.headers['set-cookie']), /^music_session_07=/);
    assert.ok(!String(r.headers['set-cookie']).includes('music_session='));
    assert.equal(store.getAuth(session)?.accessToken, 'fixture-private-token');
    assert.ok(!r.body.includes('fixture-private-token'));
  } finally {
    await app.close();
  }
});

test('wire prices, AP payment, deduplication, refreshed snapshots and old-schema rejection stay consistent', () => {
  const store = new Store(':memory:', '11'.repeat(32)),
    rooms = new Rooms(store);
  try {
    const { room, invite } = rooms.create('a', '甲', 'fixture', false);
    const id = room.id;
    rooms.join(id, invite, 'b', '乙');
    rooms.select(id, 'a', SONGS[0]!, 1);
    rooms.select(id, 'b', SONGS[1]!, 2);
    rooms.start(id, 'a', 3);
    const r = rooms.get(id);
    r.game = setup(['information', 'probe', 'strike', 'rest']);
    r.game.round = 3;
    resolveEvent(r.game, 'a', 'b2');
    resolveEvent(r.game, 'a', 'a2');
    resolveEvent(r.game, 'a', 'a3');
    r.game.clock = null;
    rooms.save(r);
    const view = rooms.view(rooms.get(id), 'a');
    assert.deepEqual(
      view.game!.hand.map((c) => c.definition.cost),
      [0, 1, 0, 0],
    );
    assert.match(view.game!.hand[3]!.definition.short, /2 点/);
    const command = {
      id: randomUUID(),
      version: view.version,
      action: {
        type: 'playCard' as const,
        instanceId: view.game!.hand[0]!.card.id,
      },
    };
    const first = rooms.act(id, 'a', command),
      again = rooms.act(id, 'a', command);
    assert.equal(again.replayed, true);
    assert.equal(first.room.game!.clues.length, again.room.game!.clues.length);
    assert.equal(rooms.get(id).game!.players.a.energy, 3);
    const opponent = JSON.stringify(rooms.view(rooms.get(id), 'b'));
    for (const key of [
      'catalog',
      'rng',
      'eventQueue',
      'effects',
      'cluePressureTax',
    ])
      assert.ok(!opponent.includes('"' + key + '"'));
    const old = rooms.get(id);
    (old.game as unknown as { schemaVersion: number }).schemaVersion = 8;
    rooms.save(old);
    assert.throws(() => rooms.get(id), /其他版本/);
  } finally {
    rooms.close();
    store.close();
  }
});
