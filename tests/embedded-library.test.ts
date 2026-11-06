import test from 'node:test';
import assert from 'node:assert/strict';
import { embeddedLibrary } from '../src/server/music/embedded-library';
import { makeApp } from '../src/server/app';
import { guest, testConfig } from './helpers';
import { hash } from '../src/server/rooms';
import type { QQClientFactory } from '../src/server/music/embedded-qq';

const credential = {
  musicid: 1,
  musickey: 'private-test-key',
  encryptUin: 'private-euin',
};
const rawSong = (id: number, account = 1) => ({
  id,
  mid: `mid${account}-${id}`,
  name: `测试曲${id}`,
  singer: [{ name: '测试歌手' }],
  album: { mid: 'album-mid', name: '测试专辑' },
});
const track = (s: any) => ({ song_mid: s.mid, song_name: s.name });
const command = {
  lists: 'fcg_music_custom_get_songlist_self.fcg',
  songs: 'fcg_music_custom_get_songlist_detail.fcg',
  recent: 'fcg_music_custom_get_play_recently.fcg',
  albums: 'fcg_get_fav_album_list.fcg',
  follows: 'fcg_music_custom_get_fav_singerlist.fcg',
  daily: 'fcg_music_custom_rc_songs.fcg',
};

test('native personal libraries reject missing identity and malformed data instead of reporting an empty collection', async () => {
  let called = false;
  const execute = async () => {
    called = true;
    return {};
  };
  await assert.rejects(embeddedLibrary(command.lists, {}, {}, execute, track), {
    code: 'QQ_LOGIN_REQUIRED',
  });
  assert.equal(called, false);
  for (const key of ['lists', 'recent', 'albums', 'follows'] as const)
    await assert.rejects(
      embeddedLibrary(command[key], {}, credential, execute, track),
      { code: 'QQ_LIBRARY_DATA' },
    );
  for (const data of [
    { code: 1, songlist: [] },
    { retcode: 1, songlist: [] },
  ])
    await assert.rejects(
      embeddedLibrary(
        command.songs,
        { dissid: '0' },
        credential,
        async () => data,
        track,
      ),
      { code: 'QQ_LIBRARY_DATA' },
    );
  assert.equal(
    await embeddedLibrary('not-a-library', {}, {}, execute, track),
    undefined,
  );
});

test('native library handles actual QQ directory fields and zero counts', async () => {
  const page = await embeddedLibrary(
    command.lists,
    {},
    credential,
    async (module, method, p) => {
      assert.equal(module, 'music.musicasset.PlaylistBaseRead');
      assert.equal(method, 'GetPlaylistByUin');
      assert.deepEqual(p, { uin: '1' });
      return {
        v_playlist: [
          {
            tid: 99,
            dirName: '测试歌单',
            songNum: 0,
            play_cnt: 0,
            picUrl: 'https://y.qq.com/cover.jpg',
          },
          { tid: 100, invalid: true },
        ],
      };
    },
    track,
  );
  assert.deepEqual(page?.data, [
    {
      diss_id: '99',
      diss_name: '测试歌单',
      song_num: 0,
      listen_num: 0,
      diss_pic: 'https://y.qq.com/cover.jpg',
    },
  ]);
});

test('likes use the encrypted caller identity and real totals stop a full final page', async () => {
  const result = await embeddedLibrary(
    command.songs,
    { dissid: '0', page: 1 },
    credential,
    async (_, method, p) => {
      assert.equal(method, 'CgiGetDiss');
      assert.equal(p.disstid, 0);
      assert.equal(p.dirid, 201);
      assert.equal(p.enc_host_uin, 'private-euin');
      assert.equal(p.song_begin, 30);
      assert.equal(p.song_num, 30);
      assert.equal(p.onlysonglist, false);
      return {
        songlist: Array.from({ length: 30 }, (_, i) => rawSong(i)),
        total_song_num: 60,
        hasmore: 1,
      };
    },
    track,
  );
  assert.equal(result?.total_num, 60);
  assert.equal(result?.has_more, 0);
  const empty = await embeddedLibrary(
    command.songs,
    { dissid: '0' },
    credential,
    async () => ({ songlist: [], total_song_num: 0 }),
    track,
  );
  assert.equal(empty?.total_num, 0);
  assert.equal(empty?.has_more, 0);
});

test('recent songs retain upstream order, metadata and covers through bounded pagination without duplicates', async () => {
  const execute: Parameters<typeof embeddedLibrary>[3] = async (
    _,
    method,
    p,
  ) => {
    assert.equal(method, 'GetPlayRecentlyInfo');
    assert.deepEqual(p, {
      requestCnt: 2500,
      type: 2,
      updateTime: 0,
      lastTime: 0,
    });
    const entries = Array.from({ length: 51 }, (_, i) => ({
      track: rawSong(i),
      lastTime: 2000 - i,
      listenCnt: i,
    }));
    entries.splice(1, 0, entries[0]!);
    return { data: { songList: entries } };
  };
  const first = await embeddedLibrary(
    command.recent,
    {},
    credential,
    execute,
    track,
  );
  const last = await embeddedLibrary(
    command.recent,
    { offset: 50 },
    credential,
    execute,
    track,
  );
  assert.equal(first?.song_list.length, 50);
  assert.equal(first?.total_num, 51);
  assert.equal(first?.song_list[0].listenCount, 0);
  assert.equal(first?.song_list[0].lastTime, 2000);
  assert.equal(first?.has_more, 1);
  assert.equal(last?.song_list.length, 1);
  assert.equal(last?.song_list[0].song_mid, 'mid1-50');
  assert.equal(last?.has_more, 0);
  assert.equal(last?.next_offset, 51);
});

test('albums and followed singers use the signed-in account, correct offsets and actual end markers', async () => {
  const albums = await embeddedLibrary(
    command.albums,
    { offset: 20 },
    credential,
    async (_, method, p) => {
      assert.equal(method, 'CgiGetAlbumFavInfo');
      assert.deepEqual(p, { euin: 'private-euin', offset: 20, size: 20 });
      return {
        v_list: [
          {
            id: 1,
            mid: 'album',
            name: '测试专辑',
            v_singer: [{ name: '测试歌手' }],
            songnum: 4,
            pubtime: 1704067200,
            logo: 'https://y.qq.com/album.jpg',
          },
        ],
        total: 21,
        hasmore: 0,
      };
    },
    track,
  );
  assert.equal(albums?.albums[0].trackNums, 4);
  assert.equal(albums?.albums[0].releaseTime, '2024-01-01');
  assert.equal(albums?.hasMore, false);
  const follows = await embeddedLibrary(
    command.follows,
    { start_index: 20 },
    credential,
    async (_, method, p) => {
      assert.equal(method, 'GetFollowSingerList');
      assert.deepEqual(p, { HostUin: 'private-euin', From: 20, Size: 20 });
      return {
        List: [
          {
            MID: 'singer',
            Name: '测试歌手',
            AvatarUrl: 'https://y.qq.com/singer.jpg',
          },
        ],
        Total: 21,
        HasMore: false,
      };
    },
    track,
  );
  assert.equal(follows?.singer_list[0].singer_name, '测试歌手');
  assert.equal(follows?.hasMore, 0);
});

function feed(cards: any[]) {
  return { v_shelf: [{ v_niche: [{ v_card: cards }] }] };
}
test('daily recommendations resolve today’s unique dynamic playlist, with numeric IDs and song pagination', async () => {
  const requests: any[] = [];
  const result = await embeddedLibrary(
    command.daily,
    { page: 1 },
    credential,
    async (module, method, p) => {
      requests.push({ module, method, p });
      if (method === 'get_recommend_feed')
        return feed([
          { subtype: 510, id: '123456', time: Math.floor(Date.now() / 1000) },
        ]);
      assert.equal(p.disstid, 123456);
      assert.equal(p.dirid, 0);
      assert.equal(p.song_begin, 30);
      return { songlist: [rawSong(2)], total_song_num: 31, hasmore: 0 };
    },
    track,
  );
  assert.equal(requests.length, 2);
  assert.equal(requests[0].module, 'music.recommend.RecommendFeed');
  assert.equal(result?.song_list[0].song_mid, 'mid1-2');
  assert.equal(result?.has_more, 0);
});

test('daily recommendations never substitute radio, yesterday’s playlist, ambiguous cards or malformed IDs', async () => {
  const today = {
    subtype: 510,
    id: '123456',
    time: Math.floor(Date.now() / 1000),
  };
  for (const cards of [
    [],
    [{ ...today, time: today.time - 86400 }],
    [today, today],
    [{ ...today, id: 'invalid' }],
    [{ ...today, subtype: 711 }],
  ]) {
    let count = 0;
    await assert.rejects(
      embeddedLibrary(
        command.daily,
        {},
        credential,
        async (_, method) => {
          count++;
          assert.equal(method, 'get_recommend_feed');
          return feed(cards);
        },
        track,
      ),
      { code: 'QQ_DAILY_UNAVAILABLE' },
    );
    assert.equal(count, 1);
  }
});

test('the six HTTP library pages stay private, normalize actual QQ data and deny a different account’s playlist', async () => {
  const requests: { account: number; method: string; p: any }[] = [];
  const factory: QQClientFactory = (options) => {
    const c = options.credential as typeof credential;
    return {
      credential: c,
      async close() {},
      async execute({ method, param: p }: any) {
        requests.push({ account: c.musicid, method, p });
        switch (method) {
          case 'GetPlaylistByUin':
            return {
              v_playlist: [
                {
                  tid: c.musicid,
                  dirName: `账户${c.musicid}的歌单`,
                  songNum: 31,
                  picUrl: 'https://y.qq.com/p.jpg',
                },
              ],
            };
          case 'CgiGetDiss':
            return {
              songlist: [rawSong(p.song_begin, c.musicid)],
              total_song_num: 31,
              hasmore: p.song_begin === 0 ? 1 : 0,
            };
          case 'GetPlayRecentlyInfo':
            return {
              data: {
                songList: [
                  { track: rawSong(2, c.musicid), lastTime: 100, listenCnt: 0 },
                ],
              },
            };
          case 'CgiGetAlbumFavInfo':
            return {
              v_list: [
                {
                  id: 1,
                  mid: 'a',
                  name: '测试专辑',
                  songnum: 1,
                  logo: 'https://y.qq.com/a.jpg',
                },
              ],
              total: 1,
              hasmore: 0,
            };
          case 'GetFollowSingerList':
            return {
              List: [{ MID: 's', Name: '测试歌手' }],
              Total: 1,
              HasMore: false,
            };
          case 'get_recommend_feed':
            return feed([
              {
                subtype: 510,
                id: '123456',
                time: Math.floor(Date.now() / 1000),
              },
            ]);
          default:
            throw Error('unexpected read');
        }
      },
    } as any;
  };
  const { app, store } = await makeApp({
    config: testConfig({ localOnly: true, fixtures: false }),
    qqClientFactory: factory,
  });
  try {
    const a = await guest(app, '甲'),
      b = await guest(app, '乙');
    assert.equal(
      (
        await app.inject({
          url: '/api/music/me/library?kind=likes',
          headers: a,
        })
      ).statusCode,
      401,
    );
    for (const [i, headers] of [a, b].entries()) {
      store.setAuth(hash(headers.cookie.split('=')[1]!), {
        provider: 'embedded-qq',
        credential: {
          ...credential,
          musicid: i + 1,
          encryptUin: `private-account-${i + 1}`,
        },
        openId: `private-open-${i}`,
        accessToken: 'private-test-key',
        expiresAt: Date.now() + 3600000,
      });
    }
    for (const kind of [
      'likes',
      'playlists',
      'recent',
      'albums',
      'follows',
      'daily',
    ]) {
      const res = await app.inject({
        url: `/api/music/me/library?kind=${kind}`,
        headers: a,
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.headers['cache-control'], 'private, no-store');
      assert.equal(res.json().items.length, 1);
      for (const secret of [
        'private-account',
        'private-test-key',
        'private-open',
        'encryptUin',
        '_seed',
      ])
        assert.ok(!res.body.includes(secret));
      if (kind === 'recent') {
        assert.equal(res.json().items[0].listenCount, 0);
        assert.equal(res.json().items[0].lastPlayedAt, 100);
        assert.ok(res.json().items[0].cover);
      }
    }
    const denied = await app.inject({
      url: '/api/music/me/library?kind=playlist&playlistId=1',
      headers: b,
    });
    assert.equal(denied.statusCode, 403);
    assert.equal(
      requests.filter((r) => r.account === 2 && r.method === 'CgiGetDiss')
        .length,
      0,
    );
    const own = await app.inject({
      url: '/api/music/me/library?kind=playlist&playlistId=2',
      headers: b,
    });
    assert.equal(own.statusCode, 200);
    assert.equal(own.json().items[0].id, 'qq:mid2-0');
    const tail = await app.inject({
      url: '/api/music/me/library?kind=likes&offset=1',
      headers: a,
    });
    assert.equal(tail.json().hasMore, false);
    assert.equal(tail.json().items[0].id, 'qq:mid1-30');
  } finally {
    await app.close();
  }
});
