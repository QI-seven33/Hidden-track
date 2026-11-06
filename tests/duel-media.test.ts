import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  officialPreview,
  lyricHint,
  anonymousMp3,
  fetchPreview,
} from '../src/server/music/duel-media';
import { makeApp } from '../src/server/app';
import { hash } from '../src/server/rooms';
import { testConfig, guest } from './helpers';
import { SONGS } from '../src/game/catalog';

function sampleMp3() {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0]);
  const tag = Buffer.from('PRIVATE_SONG_TITLE');
  const id3 = Buffer.from([73, 68, 51, 4, 0, 0, 0, 0, 0, tag.length]);
  return Buffer.concat([
    id3,
    tag,
    ...Array.from({ length: 700 }, () => frame),
    Buffer.from('TAG' + 'private-album'.repeat(10)),
  ]);
}
const raw = {
  try_playable: 1,
  try_file_size: 40000,
  try_30s_url: 'https://a.qq.com/preview.mp3?vkey=private',
};
test('preview eligibility requires actual official MP3 preview fields, not member/full flags', () => {
  assert.equal(officialPreview(raw), raw.try_30s_url);
  for (const change of [
    { try_playable: 0 },
    { try_file_size: 0 },
    { try_30s_url: 'https://evil.invalid/a.mp3' },
    { try_30s_url: 'https://a.qq.com/a.mgg' },
    { try_30s_url: 'https://user:password@a.qq.com/a.mp3' },
  ])
    assert.equal(officialPreview({ ...raw, ...change }), undefined);
  assert.equal(
    officialPreview({
      playable: 1,
      song_play_url_standard: 'https://a.qq.com/full.mp3',
    }),
    undefined,
  );
});
test('lyric hint is short, original, identity matched and skips titles/credits/links', () => {
  const song = { ...SONGS[0]!, providerId: '12' };
  const payload = {
    song_id: 12,
    song_lyric: `[ti:${song.title}]\n[00:00]词：作者\n[00:01]${song.title}\n[00:02]https://example.com\n[00:03]这是专门编写的测试占位句子没有引用现有歌曲内容只测试长度边界\n[00:04]第二行不应保留`,
  };
  const hint = lyricHint(payload, song)!;
  assert.ok(hint.length <= 24);
  assert.ok(hint.startsWith('这是'));
  assert.ok(!hint.includes('第二行'));
  assert.equal(lyricHint({ ...payload, song_id: 13 }, song), undefined);
  assert.equal(
    lyricHint({ song_id: 12, song_lyric: '[00:00]作曲：某人' }, song),
    undefined,
  );
});
test('MP3 response removes ID3 and trailing text and limits duration to at most 10 seconds', () => {
  const result = anonymousMp3(sampleMp3());
  assert.equal(result[0], 255);
  assert.ok(!result.includes(Buffer.from('PRIVATE_SONG_TITLE')));
  assert.ok(!result.includes(Buffer.from('private-album')));
  const duration = ((result.length / 417) * 1152) / 44100;
  assert.ok(duration <= 10 && duration > 9);
  assert.throws(
    () => anonymousMp3(Buffer.from('<html>wrong response</html>')),
    /未取得/,
  );
  assert.throws(
    () => anonymousMp3(Buffer.from([73, 68, 51, 4, 0, 0, 255, 0, 0, 0])),
    /格式/,
  );
});
test('media fetch validates redirects, bounds body size and sends no application credentials', async () => {
  const requests: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    requests.push(String(input));
    assert.equal(init?.redirect, 'manual');
    assert.deepEqual(init?.headers, { Accept: 'audio/mpeg' });
    return new Response(sampleMp3());
  };
  assert.ok((await fetchPreview(raw.try_30s_url, fetcher)).length);
  assert.equal(requests.length, 1);
  await assert.rejects(
    fetchPreview(
      raw.try_30s_url,
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/private' },
        }),
    ),
    /来源无效/,
  );
  await assert.rejects(
    fetchPreview(
      raw.try_30s_url,
      async () =>
        new Response('x', {
          headers: { 'content-length': String(9 * 1024 * 1024) },
        }),
    ),
    /不可用/,
  );
  await assert.rejects(
    fetchPreview(
      raw.try_30s_url,
      async () => new Response('denied', { status: 403 }),
    ),
    /不可用/,
  );
});
test('mutual eligibility, per-listener preview permission, clue gating and secret-free audio/reporting', async () => {
  let denyB = true,
    denyA = false,
    audioRequests = 0;
  const identities: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'a.qq.com') {
      audioRequests++;
      assert.deepEqual(init?.headers, { Accept: 'audio/mpeg' });
      return new Response(sampleMp3());
    }
    const cmd = url.searchParams.get('opi_cmd');
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
    if (cmd === 'fcg_music_monitor_song_listen.fcg')
      return new Response(JSON.stringify({ ret: 0 }));
    if (cmd === 'fcg_music_custom_get_lyric.fcg')
      return new Response(
        JSON.stringify({
          ret: 0,
          song_id: url.searchParams.get('song_mid') === 'midA' ? 1 : 2,
          song_lyric:
            '[00:00]词：作者\n[00:01]曲：作者\n[00:20]用于测试的原创占位句子',
        }),
      );
    const identity = url.searchParams.get('qqmusic_open_id') || 'anonymous';
    identities.push(identity);
    const isA = ['midA', '1'].includes(
      url.searchParams.get('song_mid') || url.searchParams.get('song_id') || '',
    );
    const allowed =
      !(identity === 'ownerB' && isA && denyB) &&
      !(identity === 'ownerA' && denyA);
    return new Response(
      JSON.stringify({
        ret: 0,
        traceId: 'private-trace',
        songlist: [
          {
            song_id: isA ? 1 : 2,
            song_mid: isA ? 'midA' : 'midB',
            song_name: isA ? '秘密曲目甲' : '秘密曲目乙',
            singer_name: '歌手',
            singer_id: 7,
            singer_mid: 'singer',
            album_name: '测试专辑',
            album_pic: 'https://y.qq.com/cover.jpg',
            public_time: '2003-01-01',
            song_play_time: 240,
            language: '国语',
            genre: '流行',
            bpm: 90,
            ...raw,
            try_playable: allowed ? 1 : 0,
          },
        ],
      }),
    );
  };
  const { app, rooms, store } = await makeApp({
    config: testConfig({ qqAppId: 'app', qqAppKey: 'key' }),
    fetch: fetcher,
  });
  try {
    const a = await guest(app, '甲'),
      b = await guest(app, '乙'),
      outsider = await guest(app, '外部');
    const session = (cookie: string) => hash(cookie.split('=')[1]!);
    store.setAuth(session(a.cookie), {
      openId: 'ownerA',
      accessToken: 'private-A',
      expiresAt: Date.now() + 3600000,
    });
    store.setAuth(session(b.cookie), {
      openId: 'ownerB',
      accessToken: 'private-B',
      expiresAt: Date.now() + 3600000,
    });
    const created = rooms.create(session(a.cookie), '甲', 'qq', false),
      id = created.room.id;
    rooms.join(id, created.invite, session(b.cookie), '乙');
    for (const [headers, songId, version] of [
      [a, 'qq:midA', 1],
      [b, 'qq:midB', 2],
    ] as const) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/rooms/${id}/song`,
        headers,
        payload: { songId, version },
      });
      assert.equal(response.statusCode, 200, response.body);
    }
    const denied = await app.inject({
      method: 'POST',
      url: `/api/rooms/${id}/start`,
      headers: a,
      payload: { version: 3 },
    });
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.json().error.code, 'SHARED_PREVIEW_REQUIRED');
    assert.ok(!denied.body.includes('秘密曲目'));
    assert.equal(rooms.get(id).game, undefined);
    denyB = false;
    const started = await app.inject({
      method: 'POST',
      url: `/api/rooms/${id}/start`,
      headers: a,
      payload: { version: 3 },
    });
    assert.equal(started.statusCode, 200, started.body);
    assert.ok(!started.body.includes('秘密曲目乙'));
    const preview = () =>
      app.inject({
        method: 'POST',
        url: `/api/rooms/${id}/preview`,
        headers: a,
      });
    assert.equal((await preview()).statusCode, 403);
    assert.equal(audioRequests, 0);
    const room = rooms.get(id);
    room.game!.players.a.previewSegments = 1;
    room.game!.players.a.clues.push({
      id: 'preview',
      tier: 3,
      label: '试听',
      text: '试听',
      value: '解锁',
      source: { label: '官方', url: '' },
    });
    rooms.save(room);
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/rooms/${id}/preview`,
          headers: outsider,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/rooms/${id}/preview`,
          headers: b,
        })
      ).statusCode,
      403,
    );
    identities.length = 0;
    const played = await preview();
    assert.equal(played.statusCode, 200, played.body.slice(0, 80));
    assert.deepEqual(identities, ['ownerA']);
    assert.equal(audioRequests, 1);
    assert.equal(played.headers['content-type'], 'audio/mpeg');
    assert.match(String(played.headers['cache-control']), /no-store/);
    for (const value of [
      'PRIVATE_SONG_TITLE',
      '秘密曲目乙',
      'private-B',
      'vkey',
      'midB',
    ])
      assert.ok(!played.rawPayload.includes(Buffer.from(value)));
    const sourceResponse = await app.inject({
      method: 'POST',
      url: `/api/rooms/${id}/preview-source`,
      headers: a,
      payload: {},
    });
    assert.equal(sourceResponse.statusCode, 200);
    const source = sourceResponse.json();
    assert.ok(source.src.startsWith('/api/rooms/' + id + '/preview-source/'));
    assert.ok(!JSON.stringify(source).includes('qq.com'));
    const ranged = await app.inject({
      url: source.src,
      headers: { ...a, range: 'bytes=0-127' },
    });
    assert.equal(ranged.statusCode, 206);
    assert.equal(ranged.rawPayload.length, 128);
    assert.deepEqual(ranged.rawPayload, played.rawPayload.subarray(0, 128));
    assert.equal(ranged.headers['content-type'], 'audio/mpeg');
    assert.equal(
      (await app.inject({ url: source.src, headers: b })).statusCode,
      404,
    );
    assert.equal(
      (
        await app.inject({
          url: source.src,
          headers: { ...a, range: 'bytes=9999999-' },
        })
      ).statusCode,
      416,
    );
    const previousAuth = store.getAuth(session(a.cookie))!;
    store.setAuth(session(a.cookie), {
      ...previousAuth,
      accessToken: 'changed-private-auth',
    });
    assert.equal(
      (await app.inject({ url: source.src, headers: a })).statusCode,
      403,
    );
    store.setAuth(session(a.cookie), previousAuth);
    const previousMatch = rooms.get(id);
    const matchId = previousMatch.match!.id;
    previousMatch.match!.id = 'different';
    rooms.save(previousMatch);
    assert.equal(
      (await app.inject({ url: source.src, headers: a })).statusCode,
      403,
    );
    previousMatch.match!.id = matchId;
    rooms.save(previousMatch);
    const grantId = String(played.headers['x-listen-grant']);
    assert.ok(grantId.length > 10);
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/music/listen',
          headers: b,
          payload: { grantId, seconds: 10, ended: true },
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/music/listen',
          headers: a,
          payload: { grantId, seconds: 10, ended: true },
        })
      ).statusCode,
      200,
    );
    const hidden = rooms.get(id);
    hidden.game!.players.a.effects.hideCluesUntilRound = hidden.game!.round + 1;
    rooms.save(hidden);
    assert.equal((await preview()).statusCode, 403);
    assert.equal(
      (await app.inject({ url: source.src, headers: a })).statusCode,
      403,
    );
    assert.equal(
      rooms.view(rooms.get(id), session(a.cookie)).game!.previewSeconds,
      0,
    );
    hidden.game!.players.a.effects.hideCluesUntilRound = 0;
    rooms.save(hidden);
    denyA = true;
    assert.equal((await preview()).statusCode, 403);
    assert.equal(audioRequests, 2);
    const saved = store.getRoom(id);
    assert.ok(!JSON.stringify(saved).includes('vkey'));
    assert.ok(!JSON.stringify(saved).includes('private-A'));
  } finally {
    await app.close();
  }
});

test('truncated previews drop original Xing, Info and VBRI duration/seek headers', () => {
  for (const tag of ['Xing', 'Info', 'VBRI']) {
    const header = Buffer.alloc(417);
    header.set([0xff, 0xfb, 0x90, 0]);
    header.write(tag, 36, 'ascii');
    header.writeUInt32BE(9999, 44);
    const audio = Buffer.alloc(417);
    audio.set([0xff, 0xfb, 0x90, 0]);
    audio[100] = 73;
    const result = anonymousMp3(
      Buffer.concat([header, ...Array.from({ length: 700 }, () => audio)]),
    );
    assert.ok(!result.includes(Buffer.from(tag)));
    assert.equal(result[100], 73);
    assert.ok(((result.length / 417) * 1152) / 44100 <= 10);
  }
});
