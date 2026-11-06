import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from '../src/server/app';
import { Rooms } from '../src/server/rooms';
import { Store } from '../src/server/store';
import { SONGS } from '../src/game/catalog';
import { guest, testConfig, ORIGIN } from './helpers';

test('room codes address one persisted room, keep hidden songs private, and cannot claim a third seat', () => {
  const store = new Store(':memory:', '11'.repeat(32));
  const rooms = new Rooms(store);
  try {
    const created = rooms.create('a', '甲', 'fixture', false).room;
    assert.match(created.roomCode!, /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
    const other = rooms.create('other', '另一个房间', 'fixture', false).room;
    assert.notEqual(created.roomCode, other.roomCode);
    rooms.select(created.id, 'a', SONGS[0]!, 0, false);
    const joined = rooms.joinByCode(created.roomCode!, 'b', '乙');
    assert.equal(joined.id, created.id);
    assert.equal(joined.me, 'b');
    assert.equal(joined.ownSong, undefined);
    assert.ok(!JSON.stringify(joined).includes(SONGS[0]!.title));
    assert.equal(
      rooms.joinByCode(created.roomCode!, 'b', '乙').version,
      joined.version,
    );
    assert.throws(() => rooms.joinByCode(created.roomCode!, 'c', '丙'), /已满/);
    assert.throws(() => rooms.view(rooms.get(created.id), 'outsider'), /不是/);
    rooms.close();
    const restored = new Rooms(store);
    assert.equal(
      restored.joinByCode(created.roomCode!, 'b', '乙').id,
      created.id,
    );
    restored.close();
  } finally {
    rooms.close();
    store.close();
  }
});

test('expired, revoked and practice room codes cannot join; supported older waiting rooms get a stable code', () => {
  const store = new Store(':memory:', '11'.repeat(32)),
    rooms = new Rooms(store);
  try {
    const { room, invite } = rooms.create('a', '甲', 'fixture', false);
    const oldCode = room.roomCode!;
    rooms.invite(room.id, 'a');
    assert.throws(() => rooms.joinByCode(oldCode, 'b', '乙'), /无效/);
    assert.throws(() => rooms.join(room.id, invite, 'b', '乙'), /无效/);
    const stored = rooms.get(room.id);
    delete stored.joinCode;
    rooms.save(stored);
    const migrated = rooms.get(room.id);
    assert.ok(migrated.joinCode);
    assert.equal(migrated.version, room.version);
    assert.equal(rooms.get(room.id).joinCode, migrated.joinCode);
    migrated.expiresAt = Date.now() - 1;
    rooms.save(migrated);
    assert.throws(
      () => rooms.joinByCode(migrated.joinCode!, 'b', '乙'),
      /过期/,
    );
    assert.ok(store.getRoomByCode(migrated.joinCode!, true));
    const bot = rooms.create('practice', '甲', 'fixture', true).room;
    assert.throws(() => rooms.joinByCode(bot.roomCode!, 'b', '乙'), /无效/);
    assert.throws(() => rooms.joinByCode('00000000', 'b', '乙'), /无效/);
  } finally {
    rooms.close();
    store.close();
  }
});

test('choosing a song is separate from preparation; cancellation, changing songs and stale requests cannot start a match', () => {
  const store = new Store(':memory:', '11'.repeat(32)),
    rooms = new Rooms(store);
  try {
    const created = rooms.create('a', '甲', 'fixture', false);
    const id = created.room.id;
    rooms.joinByCode(created.room.roomCode!, 'b', '乙');
    assert.throws(() => rooms.ready(id, 'a', 1, true), /先选择/);
    let view = rooms.select(id, 'a', SONGS[0]!, 1, false);
    view = rooms.select(id, 'b', SONGS[1]!, view.version, false);
    assert.ok(view.players.every((p) => !p.ready));
    assert.equal(view.canStart, false);
    assert.throws(() => rooms.start(id, 'a', view.version), /确认当前规则/);
    view = rooms.ready(id, 'a', view.version, true);
    view = rooms.ready(id, 'b', view.version, true);
    assert.equal(rooms.view(rooms.get(id), 'a').canStart, true);
    view = rooms.ready(id, 'b', view.version, false);
    assert.equal(view.canStart, false);
    assert.throws(
      () => rooms.ready(id, 'a', view.version - 1, false),
      /已更新/,
    );
    view = rooms.ready(id, 'b', view.version, true);
    view = rooms.select(id, 'a', SONGS[2]!, view.version, false);
    assert.equal(view.players.find((p) => p.seat === 'a')!.ready, false);
    assert.equal(view.canStart, false);
    view = rooms.ready(id, 'a', view.version, true);
    assert.throws(() => rooms.start(id, 'b', view.version), /不能开局/);
    const started = rooms.start(id, 'a', view.version);
    assert.equal(started.status, 'playing');
    assert.ok(started.game);
    assert.throws(
      () => rooms.select(id, 'a', SONGS[0]!, started.version, false),
      /开局后/,
    );
    assert.throws(() => rooms.ready(id, 'a', started.version, false), /先选择/);
  } finally {
    rooms.close();
    store.close();
  }
});

test('HTTP create → code join → real search → choose → prepare → start, including strict flags and CSRF', async () => {
  const { app } = await makeApp({ config: testConfig() });
  try {
    const a = await guest(app, '甲'),
      b = await guest(app, '乙');
    const post = (
      path: string,
      headers: typeof a,
      payload: Record<string, unknown>,
    ) => app.inject({ method: 'POST', url: '/api' + path, headers, payload });
    const created = (
      await post('/rooms', a, { mode: 'fixture', bot: false })
    ).json().room;
    const roomCode = created.roomCode;
    assert.equal(
      (
        await post(
          '/rooms/join',
          { ...b, origin: 'https://evil.test' },
          { code: roomCode },
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (await post('/rooms/join', b, { code: roomCode, side: 'a' })).statusCode,
      400,
    );
    assert.equal(
      (await post('/rooms/join', b, { code: 'bad!' })).statusCode,
      400,
    );
    const joined = await post('/rooms/join', b, {
      code: ' ' + roomCode.toLowerCase() + ' ',
    });
    assert.equal(joined.statusCode, 200);
    const id = created.id;
    let version = joined.json().room.version;
    const songs = (
      await app.inject({ url: '/api/music/search?mode=fixture&q=', headers: a })
    ).json().songs;
    assert.ok(songs.length >= 2);
    assert.equal(
      (
        await post(`/rooms/${id}/song`, a, {
          songId: songs[0].id,
          version,
          ready: 'false',
        })
      ).statusCode,
      400,
    );
    for (const [headers, song] of [
      [a, songs[0]],
      [b, songs[1]],
    ] as const) {
      const r = await post(`/rooms/${id}/song`, headers, {
        songId: song.id,
        version,
        ready: false,
      });
      assert.equal(r.statusCode, 200);
      version = r.json().room.version;
      assert.equal(r.json().room.canStart, false);
    }
    assert.equal(
      (await post(`/rooms/${id}/ready`, a, { version, ready: 1 })).statusCode,
      400,
    );
    for (const headers of [a, b]) {
      const r = await post(`/rooms/${id}/ready`, headers, {
        version,
        ready: true,
      });
      assert.equal(r.statusCode, 200);
      version = r.json().room.version;
    }
    const started = await post(`/rooms/${id}/start`, a, { version });
    assert.equal(started.statusCode, 200);
    assert.equal(started.json().room.status, 'playing');
    assert.equal(
      (await post(`/rooms/${id}/start`, a, { version })).statusCode,
      409,
    );
  } finally {
    await app.close();
  }
});

test('competing code joins admit exactly one guest and failed joins are rate limited', async () => {
  const { app } = await makeApp({ config: testConfig() });
  try {
    const a = await guest(app, '甲'),
      b = await guest(app, '乙'),
      c = await guest(app, '丙');
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: a,
        payload: { mode: 'fixture' },
      })
    ).json();
    const results = await Promise.all(
      [b, c].map((headers) =>
        app.inject({
          method: 'POST',
          url: '/api/rooms/join',
          headers,
          payload: { code: created.room.roomCode },
        }),
      ),
    );
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
    let status = 0;
    for (let i = 0; i < 13; i++)
      status = (
        await app.inject({
          method: 'POST',
          url: '/api/rooms/join',
          headers: { ...c, origin: ORIGIN },
          payload: { code: '00000000' },
        })
      ).statusCode;
    assert.equal(status, 429);
  } finally {
    await app.close();
  }
});
