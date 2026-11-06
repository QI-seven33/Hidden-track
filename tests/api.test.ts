import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from '../src/server/app';
import { guest, testConfig } from './helpers';

test('readiness checks actual storage without creating a guest session or exposing internals', async () => {
  const { app, store } = await makeApp({ config: testConfig() });
  try {
    const healthy = await app.inject({ url: '/api/ready' });
    assert.equal(healthy.statusCode, 200);
    assert.equal(healthy.headers['set-cookie'], undefined);
    store.db.exec('ALTER TABLE rooms RENAME TO unavailable_rooms');
    const failed = await app.inject({ url: '/api/ready' });
    assert.equal(failed.statusCode, 503);
    assert.deepEqual(failed.json(), { ok: false, storage: 'unavailable' });
  } finally {
    await app.close();
  }
});

test('HTTP sessions, invitation membership, strict command validation, CSRF and admin protection', async () => {
  const { app } = await makeApp({ config: testConfig() });
  try {
    const a = await guest(app, '甲'),
      b = await guest(app, '乙'),
      outsider = await guest(app, '路人');
    assert.equal((await app.inject({ url: '/api/health' })).statusCode, 200);
    assert.equal(
      (await app.inject({ url: '/api/admin/status', headers: a })).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          url: '/api/admin/status',
          headers: { ...a, authorization: 'Bearer ' + '乐'.repeat(43) },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/rooms',
          headers: { cookie: a.cookie, origin: 'https://evil.test' },
          payload: { mode: 'fixture' },
        })
      ).statusCode,
      403,
    );
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: a,
        payload: { mode: 'fixture', bot: false },
      })
    ).json();
    assert.ok(created.room.id);
    const id = created.room.id;
    assert.equal(
      (await app.inject({ url: `/api/rooms/${id}`, headers: outsider }))
        .statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/rooms/${id}/join`,
          headers: b,
          payload: { invite: 'x'.repeat(32) },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/rooms/${id}/join`,
          headers: b,
          payload: { invite: created.invite },
        })
      ).statusCode,
      200,
    );
    const invalid = await app.inject({
      method: 'POST',
      url: `/api/rooms/${id}/action`,
      headers: a,
      payload: {
        id: crypto.randomUUID(),
        version: 1,
        action: { type: 'endTurn', side: 'b' },
      },
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(
      (
        await app.inject({
          url: '/api/music/search?mode=qq&q=test',
          headers: a,
        })
      ).statusCode,
      503,
    );
    const admin = {
      ...a,
      authorization: 'Bearer test-admin-token-abcdefghijklmnopqrstuvwxyz',
    };
    const result = (
      await app.inject({
        method: 'POST',
        url: '/api/admin/probe',
        headers: admin,
        payload: { capability: 'search' },
      })
    ).json();
    assert.equal(result.result.status, 'missing_config');
    const cookie = (await app.inject({ url: '/api/session' })).headers[
      'set-cookie'
    ];
    assert.ok(String(cookie).includes('HttpOnly'));
    assert.ok(String(cookie).includes('SameSite=Lax'));
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/rooms',
          headers: a,
          payload: { mode: 'fixture', extra: true },
        })
      ).statusCode,
      400,
    );
  } finally {
    await app.close();
  }
});

test('listen reporting is session-bound, bounded by elapsed time, and concurrent retries report once', async () => {
  let reports = 0;
  let sentSeconds = -1;
  const fetcher: typeof fetch = async (url) => {
    const endpoint = new URL(String(url));
    if (
      endpoint.searchParams.get('opi_cmd') ===
      'fcg_music_monitor_song_listen.fcg'
    ) {
      reports++;
      sentSeconds = Number(endpoint.searchParams.get('play_time'));
      await new Promise((resolve) => setTimeout(resolve, 30));
      return new Response(JSON.stringify({ ret: 0 }));
    }
    return new Response(
      JSON.stringify({
        ret: 0,
        songlist: [
          {
            song_id: 1,
            song_mid: 'mid',
            song_name: '曲目',
            playable: 1,
            song_play_time: 180,
            song_play_url_standard: 'http://test.qq.com/audio',
          },
        ],
      }),
    );
  };
  const { app } = await makeApp({
    config: testConfig({ qqAppId: '123', qqAppKey: 'private' }),
    fetch: fetcher,
  });
  try {
    const user = await guest(app, '甲'),
      outsider = await guest(app, '乙');
    const playback = await app.inject({
      method: 'POST',
      url: '/api/music/playback',
      headers: user,
      payload: { songId: 'qq:mid' },
    });
    assert.equal(playback.statusCode, 200);
    assert.equal(playback.json().url, 'https://test.qq.com/audio');
    const payload = {
      grantId: playback.json().grantId,
      seconds: 180,
      ended: true,
    };
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/music/listen',
          headers: outsider,
          payload,
        })
      ).statusCode,
      404,
    );
    const responses = await Promise.all(
      [0, 1].map(() =>
        app.inject({
          method: 'POST',
          url: '/api/music/listen',
          headers: user,
          payload,
        }),
      ),
    );
    assert.ok(responses.every((response) => response.statusCode === 200));
    assert.equal(reports, 1);
    assert.ok(sentSeconds >= 0 && sentSeconds < 180);
    assert.ok(responses.some((response) => response.json().replayed));
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/music/listen',
          headers: user,
          payload,
        })
      ).json().replayed,
      true,
    );
    assert.equal(reports, 1);
  } finally {
    await app.close();
  }
});
test('real provider DTO excludes playback URLs and auth details from room persistence', async () => {
  const fetcher: typeof fetch = async (input) => {
    const cmd = new URL(String(input)).searchParams.get('opi_cmd');
    if (cmd === 'fcg_music_custom_get_singer_info.fcg')
      return new Response(
        JSON.stringify({
          ret: 0,
          singer_id: 7,
          singer_mid: 'singer',
          singer_name: '歌手',
          type: 0,
        }),
      );
    if (cmd === 'fcg_music_custom_get_lyric.fcg')
      return new Response(
        JSON.stringify({
          ret: 0,
          song_id: 1,
          song_lyric:
            '[00:00]词：作者\n[00:01]曲：作者\n[00:20]用于安全回归的原创句子',
        }),
      );
    return new Response(
      JSON.stringify({
        ret: 0,
        songlist: [
          {
            song_id: 1,
            song_mid: 'mid',
            song_name: '真实曲目',
            language: '国语',
            genre: 'Pop 流行',
            public_time: '2003-01-01',
            song_play_time: 240,
            album_name: '专辑',
            album_pic: 'https://y.qq.com/cover.jpg',
            singer_id: 7,
            singer_mid: 'singer',
            singer_name: '歌手',
            song_play_url: 'https://qq.com/private?secret=1',
            try_playable: 1,
            try_file_size: 1200,
            try_30s_url: 'https://a.qq.com/preview.mp3?secret=1',
            extra: { token: 'secret' },
          },
        ],
      }),
    );
  };
  const { app, store } = await makeApp({
    config: testConfig({ qqAppId: '123', qqAppKey: 'private' }),
    fetch: fetcher,
  });
  try {
    const user = await guest(app, '甲');
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: user,
        payload: { mode: 'qq' },
      })
    ).json();
    const selected = await app.inject({
      method: 'POST',
      url: `/api/rooms/${created.room.id}/song`,
      headers: user,
      payload: { songId: 'qq:mid', version: 0 },
    });
    assert.equal(selected.statusCode, 200);
    const saved = store.db.prepare('SELECT data FROM rooms').get() as {
      data: string;
    };
    assert.ok(!saved.data.includes('song_play_url'));
    assert.ok(!saved.data.includes('secret=1'));
    assert.ok(!saved.data.includes('private'));
  } finally {
    await app.close();
  }
});
