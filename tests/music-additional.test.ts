import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePublicMetadata,
  PublicMetadataReader,
} from '../src/server/music/public-metadata';
import { musicProfile } from '../src/server/music/profile';
import { plainLyricLines, fullLyrics } from '../src/server/music/lyrics';
import { QQMusic, songList, coverUrl } from '../src/server/music/qq';
import { makeApp } from '../src/server/app';
import { guest, testConfig } from './helpers';

const webPayload = (mid = 'mid', id = 1) => ({
  song: {
    code: 0,
    data: {
      track_info: { mid, id, language: 0, genre: 1, bpm: 76 },
      info: {
        lan: { content: [{ value: '国语' }] },
        genre: { content: [{ value: 'Pop' }, { value: 'Pop' }] },
        intro: { content: [{ value: '测试歌曲介绍' }] },
      },
      extras: { wikiurl: 'https://wiki.y.qq.com/i/test' },
    },
  },
});
test('Tencent account avatars use qlogo HTTPS while lookalike and credential URLs remain rejected', () => {
  assert.equal(
    coverUrl('http://thirdqq.qlogo.cn/avatar/100'),
    'https://thirdqq.qlogo.cn/avatar/100',
  );
  assert.equal(coverUrl('https://qlogo.cn.evil.test/avatar'), undefined);
  assert.equal(
    coverUrl('https://private:secret@thirdqq.qlogo.cn/avatar'),
    undefined,
  );
});
test('public metadata binds the exact recording and reads label text instead of guessing numeric enums', () => {
  const data = normalizePublicMetadata(webPayload(), 'mid', '1')!;
  assert.deepEqual(data.languages, ['国语']);
  assert.deepEqual(data.genres, ['Pop']);
  assert.equal(data.bpm, 76);
  assert.equal(
    normalizePublicMetadata(webPayload('other'), 'mid', '1'),
    undefined,
  );
  assert.equal(
    normalizePublicMetadata(webPayload('mid', 2), 'mid', '1'),
    undefined,
  );
  const profile = musicProfile(
    {
      id: 'qq:mid',
      title: '测试',
      artists: ['甲'],
      album: '专辑',
      provider: 'qq',
    },
    {
      song: { ret: 0, language: '', genre: '', bpm: 0 },
      web: { ret: 0, ...data },
    },
    false,
  );
  assert.equal(
    profile.facts.find((f) => f.label === '单曲语言')?.value,
    '国语',
  );
  assert.match(
    profile.facts.find((f) => f.label === '单曲语言')?.note || '',
    /公开网页/,
  );
  assert.ok(!profile.missing.includes('单曲流派'));
  assert.equal(profile.description, '测试歌曲介绍');
});
test('anonymous web metadata has no application or account credentials; cache deduplicates and disable makes zero calls', async () => {
  let calls = 0;
  const transport: typeof fetch = async (input, init) => {
    calls++;
    assert.equal(String(input), 'https://u.y.qq.com/cgi-bin/musicu.fcg');
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.redirect, 'error');
    assert.ok(!JSON.stringify(init).includes('access_token'));
    assert.ok(!JSON.stringify(init).includes('app_key'));
    assert.ok(!JSON.stringify(init).includes('X-QYOPI-Sign'));
    return new Response(JSON.stringify(webPayload()));
  };
  const disabled = new PublicMetadataReader(false, transport);
  await disabled.get('mid', '1');
  assert.equal(calls, 0);
  const reader = new PublicMetadataReader(true, transport);
  const values = await Promise.all([
    reader.get('mid', '1'),
    reader.get('mid', '1'),
  ]);
  assert.equal(calls, 1);
  assert.equal(values[0], values[1]);
  await reader.get('mid', '1');
  assert.equal(calls, 1);
  assert.equal(await reader.get('mid', '2'), undefined);
  assert.equal(calls, 2);
});
test('web metadata failure leaves song selection usable; verified web language can enter a game without stream or wiki blobs', async () => {
  const transport: typeof fetch = async (input) => {
    if (String(input).includes('musicu.fcg'))
      return new Response(JSON.stringify(webPayload()));
    const command = new URL(String(input)).searchParams.get('opi_cmd');
    return new Response(
      JSON.stringify(
        command === 'fcg_music_custom_get_song_info_batch.fcg'
          ? {
              ret: 0,
              songlist: [{ song_id: 1, song_mid: 'mid', song_name: '测试' }],
            }
          : { ret: 0, song_id: 1, song_lyric: '[00:00]词：测试作者' },
      ),
    );
  };
  const selected = await new QQMusic(
    testConfig({ qqAppId: '123', qqAppKey: 'private', qqPublicMetadata: true }),
    transport,
  ).gameSong('qq:mid', { ip: '127.0.0.1', device: 'test' });
  assert.equal(selected.language, '国语');
  assert.equal(selected.genre, 'Pop');
  assert.equal(selected.bpm, 76);
  assert.deepEqual(selected.lyricists, ['测试作者']);
  assert.ok(!JSON.stringify(selected).includes('track_info'));
  const failed = new PublicMetadataReader(true, async () => {
    throw Error('offline');
  });
  assert.equal(await failed.get('mid', '1'), undefined);
});
test('complete lyrics retain the final line, remain inert text and refuse a different recording', async () => {
  const text = Array.from(
    { length: 120 },
    (_, i) => `[00:${String(i % 60).padStart(2, '0')}.50]测试文字${i}`,
  ).join('\n');
  const lines = plainLyricLines('[by:上传者]\n' + text);
  assert.equal(lines.length, 120);
  assert.equal(lines[119]?.text, '测试文字119');
  assert.equal(lines[0]?.seconds, 0.5);
  assert.ok(
    !plainLyricLines('<script>bad()</script>[00:00]安全文字')[0]?.text.includes(
      'bad()',
    ),
  );
  const qq = new QQMusic(
    testConfig({ qqAppId: '123', qqAppKey: 'private' }),
    async (input) =>
      new Response(
        JSON.stringify(
          new URL(String(input)).searchParams.get('opi_cmd') ===
            'fcg_music_custom_get_song_info_batch.fcg'
            ? {
                ret: 0,
                songlist: [{ song_id: 1, song_mid: 'mid', song_name: '测试' }],
              }
            : { ret: 0, song_id: 2, song_lyric: text },
        ),
      ),
  );
  await assert.rejects(
    () => fullLyrics(qq, 'qq:mid', { ip: '127.0.0.1', device: 'test' }),
    /版本/,
  );
});
test('personal libraries require the caller authorization, exclude tickets, paginate and deny foreign playlists', async () => {
  let details = 0;
  const transport: typeof fetch = async (input) => {
    const u = new URL(String(input)),
      command = u.searchParams.get('opi_cmd');
    const response =
      command === 'fcg_music_custom_get_account_info.fcg'
        ? {
            user_info: {
              nickname: '仅甲可见',
              headimgurl: 'https://y.qq.com/avatar.png',
            },
          }
        : command === 'fcg_music_rpc_green_vip_info.fcg'
          ? { green_vip_flag: 1, green_vip_end_time: '2030-01-01' }
          : command === 'fcg_music_custom_get_songlist_self.fcg'
            ? { data: [{ diss_id: 99, diss_name: '甲的歌单' }] }
            : command === 'fcg_music_custom_get_songlist_detail.fcg'
              ? (details++,
                {
                  song_list: [
                    {
                      song_id: 1,
                      song_mid: 'mid',
                      song_name: '测试曲目',
                      song_play_url: 'https://y.qq.com/file?private=1',
                    },
                  ],
                  has_more: 1,
                  total_num: 42,
                })
              : {};
    return new Response(
      JSON.stringify({
        ret: 0,
        ...response,
        qqmusic_access_token: 'never exposed',
      }),
    );
  };
  const { app, store } = await makeApp({
    config: testConfig({ qqAppId: '123', qqAppKey: 'key' }),
    fetch: transport,
  });
  try {
    const a = await guest(app, '甲'),
      b = await guest(app, '乙');
    const row = store.db
      .prepare('SELECT id FROM sessions WHERE name=?')
      .get('甲') as { id: string };
    store.setAuth(row.id, {
      openId: 'private-id',
      accessToken: 'private-ticket',
      expiresAt: Date.now() + 3600000,
    });
    const denied = await app.inject({ url: '/api/music/me', headers: b });
    assert.equal(denied.statusCode, 401);
    assert.ok(!denied.body.includes('仅甲可见'));
    const profile = await app.inject({ url: '/api/music/me', headers: a });
    assert.equal(profile.statusCode, 200);
    assert.equal(profile.json().nickname, '仅甲可见');
    assert.equal(profile.headers['cache-control'], 'private, no-store');
    const likes = await app.inject({
      url: '/api/music/me/library?kind=likes',
      headers: a,
    });
    assert.equal(likes.json().items.length, 1);
    assert.equal(likes.json().hasMore, true);
    assert.equal(likes.json().nextOffset, 1);
    for (const secret of [
      'private-ticket',
      'private-id',
      'never exposed',
      'private=1',
      'song_play_url',
    ])
      assert.ok(!likes.body.includes(secret));
    const foreign = await app.inject({
      url: '/api/music/me/library?kind=playlist&playlistId=100',
      headers: a,
    });
    assert.equal(foreign.statusCode, 403);
    assert.equal(details, 1);
    assert.equal(songList({ song_list: [1, 2] }).length, 2);
  } finally {
    await app.close();
  }
});
