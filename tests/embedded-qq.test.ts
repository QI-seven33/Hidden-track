import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from '../src/server/app';
import { guest, testConfig } from './helpers';
import {
  EmbeddedQQ,
  qqLyricText,
  type QQClientFactory,
} from '../src/server/music/embedded-qq';
import { Store } from '../src/server/store';
import { hash } from '../src/server/rooms';
import { SongApi } from '../src/server/music/vendor/QQMusicApi/src/modules/song.js';
import { LoginApi } from '../src/server/music/vendor/QQMusicApi/src/modules/login.js';
import recordings from '../src/server/music/practice-recordings.json';
import { webPlaybackResource } from '../src/server/music/qq';
import { duelMp3 } from '../src/server/music/duel-media';

let sequence = 0;
const calls: { account: unknown; mid: string }[] = [];
const factory: QQClientFactory = (options) =>
  ({
    credential: options.credential,
    async close() {},
    login: {
      async getQrcode() {
        return {
          data: Buffer.from('test-image'),
          mime: 'image/png',
          type: 'qq',
          identifier: String(++sequence),
        };
      },
      async checkQrcode(qr: any) {
        return {
          event: 0,
          credential: {
            musicid: Number(qr.identifier),
            musickey: 'private-native-' + qr.identifier,
            refreshToken: 'private-refresh-' + qr.identifier,
            musickeyCreateTime: Math.floor(Date.now() / 1000),
            keyExpiresIn: 86400,
          },
        };
      },
      async refreshCredential(credential: any) {
        return {
          ...credential,
          musickeyCreateTime: Math.floor(Date.now() / 1000),
        };
      },
    },
    song: {
      async getDetail(mids: string[]) {
        return {
          tracks: mids.flatMap((mid) => {
            const s = recordings.find(
              (s) => s.providerMid === mid || s.providerId === mid,
            );
            return s
              ? [
                  {
                    id: s.providerId,
                    mid: s.providerMid,
                    name: s.title,
                    singer: s.artists.map((name) => ({ name })),
                    album: { id: s.albumId, mid: s.albumMid, name: s.album },
                    interval: s.duration,
                    bpm: s.bpm,
                    time_public: s.year + '-01-01',
                    file: { media_mid: s.providerMid, size_try: 960887 },
                  },
                ]
              : [];
          }),
        };
      },
      async getPlayUrls(mids: string[], type = 'RS02') {
        calls.push({
          account: (options.credential as any)?.musicid,
          mid: mids[0]!,
        });
        return Object.fromEntries(
          mids.map((mid) => [
            mid,
            {
              url:
                'https://aqqmusic.tc.qq.com/' +
                type +
                mid +
                '.mp3?vkey=private',
            },
          ]),
        );
      },
      async getLyrics() {
        return {
          crypt: 0,
          lyric: '[00:00]作词：测试\n[00:10]此处只有原创测试歌词短句',
        };
      },
    },
    user: {
      async getSelfInfo() {
        return {
          info: {
            nick: '账号' + (options.credential as any)?.musicid,
            logo: 'https://y.qq.com/avatar.png',
          },
        };
      },
    },
    async execute() {
      throw Error('unexpected generic request');
    },
  }) as any;

test('QQ trial filename uses one media mid and preserves the original standard filename', () => {
  const song = new SongApi({ credential: {}, platform: 'android' });
  const request = song.getUrls(['003N7EbT2mUdPG'], 'RS02', {
    fileMids: ['002VyDYh2zj4ZM'],
  });
  assert.deepEqual(request.param.filename, ['RS02002VyDYh2zj4ZM.mp3']);
  const standard = song.getUrls(['003N7EbT2mUdPG'], 'M500', {
    fileMids: ['002VyDYh2zj4ZM'],
  });
  assert.deepEqual(standard.param.filename, [
    'M500002VyDYh2zj4ZM002VyDYh2zj4ZM.mp3',
  ]);
});
test('QRC word timing is removed before producing original-language clue lines', () => {
  assert.equal(
    qqLyricText(
      '<Lyric_1 LyricContent="[12345,2400]风(12345,200)吹(12545,200)山岗"/>',
    ),
    '[0:12]风吹山岗',
  );
});

test('QQ callback accepts a final code parameter and never emits credential debug output', async () => {
  const messages: unknown[] = [];
  const originalLog = console.log,
    originalError = console.error,
    originalDebug = process.env.QQMUSIC_DEBUG;
  let savedCode = '';
  const login = new LoginApi({
    async request(method: string) {
      return method === 'GET'
        ? { cookies: { p_skey: 'private-cookie' }, statusCode: 302 }
        : {
            headers: {
              location:
                'https://y.qq.com/portal/wx_redirect.html?code=private-code',
            },
            statusCode: 302,
            text: 'private-body',
          };
    },
    async execute(request: any) {
      savedCode = request.param.code;
      return { musicid: 123, musickey: 'private-key' };
    },
  });
  try {
    process.env.QQMUSIC_DEBUG = '1';
    console.log = (...args) => {
      messages.push(args);
    };
    console.error = (...args) => {
      messages.push(args);
    };
    const credential = await login._authorizeQQQr('123', 'private-signature');
    assert.equal(credential.musicid, 123);
    assert.equal(savedCode, 'private-code');
    assert.deepEqual(messages, []);
  } finally {
    console.log = originalLog;
    console.error = originalError;
    if (originalDebug === undefined) delete process.env.QQMUSIC_DEBUG;
    else process.env.QQMUSIC_DEBUG = originalDebug;
  }
});

test('embedded QQ requires login, keeps credentials session-bound, starts the existing practice mode and protects previews', async () => {
  const frame = Buffer.alloc(417);
  frame.set([255, 251, 144, 0]);
  const tag = Buffer.from('PRIVATE_TITLE');
  const mp3 = Buffer.concat([
    Buffer.from([73, 68, 51, 4, 0, 0, 0, 0, 0, tag.length]),
    tag,
    ...Array.from({ length: 700 }, () => frame),
  ]);
  const { app, store, rooms } = await makeApp({
    config: testConfig({ localOnly: true, fixtures: false }),
    qqClientFactory: factory,
    fetch: async (input, init) => {
      assert.equal(new URL(String(input)).hostname, 'aqqmusic.tc.qq.com');
      assert.ok(!JSON.stringify(init).includes('private-native'));
      return new Response(mp3);
    },
  });
  try {
    const owner = await guest(app, '乐友'),
      other = await guest(app, '另一位');
    const meta = (await app.inject('/api/meta')).json();
    assert.equal(meta.qqConfigured, true);
    assert.equal(meta.qrConfigured, true);
    assert.equal(meta.webLoginConfigured, false);
    const create = () =>
      app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: owner,
        payload: { mode: 'fixture', bot: true },
      });
    assert.equal((await create()).statusCode, 401);
    const qr = await app.inject({
      method: 'POST',
      url: '/api/music/auth/qr',
      headers: owner,
      payload: {},
    });
    assert.equal(qr.statusCode, 200);
    assert.match(qr.json().image, /^data:image\/png;base64,/);
    assert.ok(!qr.body.includes('identifier') && !qr.body.includes('musickey'));
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/music/auth/poll',
          headers: other,
          payload: {},
        })
      ).statusCode,
      410,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/music/auth/poll',
          headers: owner,
          payload: {},
        })
      ).json().status,
      'authorized',
    );
    const session = (
      await app.inject({ url: '/api/session', headers: owner })
    ).json();
    assert.equal(session.qqAuthorized, true);
    assert.equal(session.avatar, 'https://y.qq.com/avatar.png');
    assert.match(session.nickname, /^账号/);
    const privateAuth = store.getAuth(hash(owner.cookie.split('=')[1]!))!;
    assert.equal(privateAuth.provider, 'embedded-qq');
    const playback = await app.inject({
      method: 'POST',
      url: '/api/music/playback',
      headers: owner,
      payload: { songId: 'qq:' + recordings[0]!.providerMid },
    });
    assert.equal(playback.statusCode, 200, playback.body);
    assert.equal(playback.json().preview, false);
    assert.equal(playback.json().format, 'mp3');
    assert.equal(playback.json().requiresDecoding, false);
    assert.match(new URL(playback.json().url).pathname, /^\/M500/);
    const stored = store.db
      .prepare('SELECT auth FROM sessions WHERE id=?')
      .get(hash(owner.cookie.split('=')[1]!)) as { auth: string };
    assert.ok(!stored.auth.includes('private-native'));
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/rooms',
          headers: owner,
          payload: { mode: 'qq', bot: false },
        })
      ).statusCode,
      503,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/rooms/join',
          headers: owner,
          payload: { code: '12345678' },
        })
      ).statusCode,
      503,
    );
    let view = (await create()).json().room;
    const songs = (
      await app.inject({
        url: '/api/music/search?mode=fixture&q=',
        headers: owner,
      })
    ).json().songs;
    assert.equal(songs.length, 9);
    assert.deepEqual(
      songs.map((s: any) => s.id),
      recordings.map((s) => s.id),
    );
    view = (
      await app.inject({
        method: 'POST',
        url: `/api/rooms/${view.id}/song`,
        headers: owner,
        payload: { songId: songs[0].id, version: view.version, ready: true },
      })
    ).json().room;
    assert.equal(
      view.players.find((p: any) => p.seat !== view.me).song,
      undefined,
    );
    view = (
      await app.inject({
        method: 'POST',
        url: `/api/rooms/${view.id}/start`,
        headers: owner,
        payload: { version: view.version },
      })
    ).json().room;
    assert.equal(view.status, 'playing');
    assert.equal(view.mode, 'fixture');
    assert.equal(view.bot, true);
    assert.equal(view.rules.maxRounds, 0);
    const path = `/api/rooms/${view.id}/preview-source`;
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: path,
          headers: owner,
          payload: {},
        })
      ).statusCode,
      403,
    );
    const room = rooms.get(view.id);
    room.game!.players[view.me as 'a' | 'b'].previewSegments = 1;
    rooms.save(room);
    const preview = await app.inject({
      method: 'POST',
      url: path,
      headers: owner,
      payload: {},
    });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.ok(!preview.body.includes('vkey') && !preview.body.includes('qq:'));
    const audio = await app.inject({ url: preview.json().src, headers: owner });
    assert.equal(audio.statusCode, 200);
    assert.ok(!audio.rawPayload.includes(tag));
    assert.ok(((audio.rawPayload.length / 417) * 1152) / 44100 <= 10);
    assert.equal(
      (await app.inject({ url: preview.json().src, headers: other }))
        .statusCode,
      401,
    );
    assert.ok(
      calls.every((c) => c.account === (privateAuth.credential as any).musicid),
    );
    const logout = await app.inject({
      method: 'POST',
      url: '/api/music/auth/logout',
      headers: owner,
      payload: {},
    });
    assert.equal(logout.statusCode, 200);
    assert.equal(
      (await app.inject({ url: '/api/session', headers: owner })).json()
        .qqAuthorized,
      false,
    );
    assert.equal((await create()).statusCode, 401);
  } finally {
    await app.close();
  }
});

test('a canceled QQ scan cannot restore login after logout', async () => {
  const store = new Store(':memory:', '11'.repeat(32));
  store.createSession('owner', '乐友');
  let release!: (v: any) => void;
  const pending = new Promise<any>((r) => (release = r));
  const api = new EmbeddedQQ(store, ':memory:', (options) => {
    const client = factory(options);
    client.login.checkQrcode = () => pending;
    return client;
  });
  try {
    await api.qr('owner');
    const poll = api.poll('owner');
    api.forget('owner');
    store.setAuth('owner', null);
    release({
      event: 0,
      credential: { musicid: 1, musickey: 'private-native' },
    });
    await assert.rejects(poll, /已取消/);
    assert.equal(store.getAuth('owner'), undefined);
  } finally {
    await api.close();
    store.close();
  }
});

test('two QQ logins retain separate profiles and logging out one session leaves the other intact', async () => {
  const { app } = await makeApp({
    config: testConfig({ localOnly: true, fixtures: false }),
    qqClientFactory: factory,
  });
  try {
    const a = await guest(app, '甲'),
      b = await guest(app, '乙');
    for (const headers of [a, b]) {
      await app.inject({
        method: 'POST',
        url: '/api/music/auth/qr',
        headers,
        payload: {},
      });
      assert.equal(
        (
          await app.inject({
            method: 'POST',
            url: '/api/music/auth/poll',
            headers,
            payload: {},
          })
        ).json().status,
        'authorized',
      );
    }
    const first = (
      await app.inject({ url: '/api/music/profile', headers: a })
    ).json();
    const second = (
      await app.inject({ url: '/api/music/profile', headers: b })
    ).json();
    assert.notEqual(first.nickname, second.nickname);
    await app.inject({
      method: 'POST',
      url: '/api/music/auth/logout',
      headers: a,
      payload: {},
    });
    assert.equal(
      (await app.inject({ url: '/api/session', headers: a })).json()
        .qqAuthorized,
      false,
    );
    assert.equal(
      (await app.inject({ url: '/api/session', headers: b })).json()
        .qqAuthorized,
      true,
    );
    assert.deepEqual(
      (await app.inject({ url: '/api/music/profile', headers: b })).json(),
      second,
    );
  } finally {
    await app.close();
  }
});

test('transient QQ refresh failure preserves login while a rejected credential clears only the old login', async () => {
  const store = new Store(':memory:', '11'.repeat(32));
  store.createSession('owner', '乐友');
  store.setAuth('owner', {
    provider: 'embedded-qq',
    credential: { musicid: 1, musickey: 'private-old' },
    openId: '1',
    accessToken: 'private-old',
    refreshToken: 'private-refresh',
    expiresAt: Date.now() - 1,
  });
  let rejected = false;
  const api = new EmbeddedQQ(store, ':memory:', (options) => {
    const client = factory(options);
    client.login.refreshCredential = async () => {
      const error = new Error('private response must not escape');
      error.name = rejected ? 'CredentialRefreshError' : 'NetworkError';
      throw error;
    };
    return client;
  });
  try {
    await assert.rejects(
      api.context('owner', '127.0.0.1'),
      (error: any) =>
        error.status === 502 && !error.message.includes('private'),
    );
    assert.equal(store.getAuth('owner')?.accessToken, 'private-old');
    rejected = true;
    await assert.rejects(
      api.context('owner', '127.0.0.1'),
      (error: any) => error.status === 401,
    );
    assert.equal(store.getAuth('owner'), undefined);
  } finally {
    await api.close();
    store.close();
  }
});

test('full non-MP3 account assets retain their real format and require decoding instead of masquerading as previews', async () => {
  const store = new Store(':memory:', '11'.repeat(32));
  const api = new EmbeddedQQ(store, ':memory:', (options) => {
    const client = factory(options);
    client.song.getPlayUrls = async (mids: string[], type: string) =>
      Object.fromEntries(
        mids.map((mid) => [
          mid,
          {
            url: `https://aqqmusic.tc.qq.com/${type}${mid}.${type === 'RS02' ? 'mp3' : 'mgg'}?vkey=private`,
          },
        ]),
      );
    return client;
  });
  try {
    const raw = (
      await api.call(
        'fcg_music_custom_get_song_info_batch.fcg',
        { song_mid: recordings[0]!.providerMid },
        {
          device: 'test',
          auth: {
            provider: 'embedded-qq',
            credential: { musicid: 123, musickey: 'private' },
            openId: '123',
            accessToken: 'private',
            expiresAt: Date.now() + 86400000,
          },
        },
      )
    ).song_list[0];
    const resource = webPlaybackResource(raw)!;
    assert.equal(resource.preview, false);
    assert.equal(resource.format, 'mgg');
    assert.equal(resource.requiresDecoding, true);
    assert.match(new URL(resource.url).pathname, /^\/M500.*\.mgg$/);
    assert.match(new URL(duelMp3(raw)!).pathname, /^\/RS02/);
  } finally {
    await api.close();
    store.close();
  }
});

test('a full MP3 without a trial remains usable and a missing full asset stays explicitly a trial', () => {
  const full = {
    resource_source: 'embedded-qq',
    account_resource: {
      url: 'https://aqqmusic.tc.qq.com/M500record.mp3',
      format: 'mp3',
      requiresDecoding: false,
    },
    try_playable: 0,
  };
  assert.equal(duelMp3(full), 'https://aqqmusic.tc.qq.com/M500record.mp3');
  assert.equal(webPlaybackResource(full)?.preview, false);
  const fallback = {
    resource_source: 'embedded-qq',
    try_playable: 1,
    try_file_size: 960887,
    try_30s_url: 'https://aqqmusic.tc.qq.com/RS02record.mp3',
  };
  assert.equal(webPlaybackResource(fallback)?.preview, true);
});
