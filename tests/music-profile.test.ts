import { test } from 'node:test';
import assert from 'node:assert/strict';
import { musicProfile, readableText } from '../src/server/music/profile';
import type { SongSummary } from '../src/shared/protocol';
const song: SongSummary = {
  id: 'qq:mid',
  title: '曲目',
  artists: ['歌手'],
  album: '专辑',
  provider: 'qq',
};

test('readable music profile separates song facts from album facts, preserves unknowns and exposes no audio credentials', () => {
  const result = musicProfile(
    song,
    {
      song: {
        song_version: 0,
        song_play_time: 269,
        language: '',
        genre: '',
        playable: 1,
        song_play_url_standard: 'http://a.qq.com/whole.mgg?vkey=private',
        song_size_standard: 3e6,
        song_ekey_standard: 'very-private',
        try_playable: 1,
        try_file_size: 10000,
        try_30s_url: 'https://a.qq.com/preview.mp3?vkey=private',
        excited_begin: 84346,
        excited_end: 142843,
      },
      search: { author: '', origin: 0 },
      album: {
        ret: 0,
        album_name: '专辑',
        str_language: '国语',
        str_genre: '流行',
        album_desc: '第一段<br>第二段',
      },
      singer: {
        ret: 0,
        type: 0,
        wikiInfo:
          '<info><desc><![CDATA[歌手介绍]]></desc><basic><item><key>出生地</key><value>地方</value></item></basic><other><item><key>经历</key><value>经历正文</value></item></other></info>',
      },
      lyric: { ret: 0, song_lyric: 'secret lyric body' },
      versions: {
        ret: 0,
        song_list: [
          {
            mid: 'cover',
            name: '其他版本',
            singer_list: [{ name: '翻唱歌手' }],
            album: { name: '另一张专辑' },
          },
          { mid: 'cover', name: '其他版本（重复返回）' },
        ],
      },
      similar: { ret: 0, songlist: [] },
      chorus: { ret: 0 },
    },
    true,
  );
  assert.equal(
    result.facts.find((f) => f.label === '单曲语言')?.value,
    '暂未提供',
  );
  assert.equal(
    result.album.facts.find((f) => f.label === '专辑语言')?.value,
    '国语',
  );
  assert.equal(
    result.facts.find((f) => f.label === '歌曲时长')?.value,
    '4 分 29 秒',
  );
  assert.equal(
    result.facts.find((f) => f.label === '原唱信息')?.value,
    '尚不能确认',
  );
  assert.equal(result.listening.fullAllowed, true);
  assert.equal(result.listening.delivery, 'preview');
  assert.equal(
    result.listening.resources.find((r) => r.kind === 'full')?.format,
    'MGG',
  );
  assert.equal(result.singer.biography, '歌手介绍');
  assert.ok(
    result.singer.facts.some((f) => f.label === '出生地' && f.value === '地方'),
  );
  assert.equal(result.singer.chapters[0]?.body, '经历正文');
  assert.equal(result.versions[0]?.artists[0], '翻唱歌手');
  assert.equal(result.versions.length, 1);
  assert.equal(result.album.description, '第一段\n第二段');
  assert.equal(result.chorus?.begin, 84.346);
  for (const secret of [
    'private',
    'secret lyric body',
    'whole.mgg',
    'preview.mp3',
  ])
    assert.ok(!JSON.stringify(result).includes(secret));
});
test('upstream rich text remains inert text and failure states never fabricate a complete player', () => {
  assert.equal(
    readableText('<p>A &amp; B</p><script>evil()</script><![CDATA[下一段]]>'),
    'A & B\n下一段',
  );
  const result = musicProfile(
    song,
    {
      song: {
        song_play_url_standard: 'https://a.qq.com/whole.mgg',
        playable: 0,
        try_playable: 0,
      },
    },
    false,
  );
  assert.equal(result.listening.delivery, 'unavailable');
  assert.equal(result.listening.fullAllowed, false);
  assert.ok(result.notices.some((n) => n.includes('专辑资料')));
  assert.equal(result.chorus, undefined);
});
test('artist identity zero remains valid, and chorus points match the exact song including a zero start', () => {
  const result = musicProfile(
    song,
    {
      song: { song_id: 123, song_play_time: 60 },
      singer: { ret: 0, identity: 0, song_sum: 32 },
      chorus: {
        ret: 0,
        data: {
          '999': { touchpointStart: 5000, touchpointEnd: 10000 },
          '123': { touchpointStart: 0, touchpointEnd: 30000 },
        },
      },
    },
    false,
  );
  assert.equal(
    result.singer.facts.find((f) => f.label === '平台身份')?.value,
    '演唱',
  );
  assert.equal(
    result.singer.facts.find((f) => f.label === '曲库作品数')?.value,
    '32 首',
  );
  assert.deepEqual(result.chorus, { begin: 0, end: 30 });
  const wrong = musicProfile(
    song,
    {
      song: { song_id: 123 },
      chorus: {
        ret: 0,
        data: { '999': { touchpointStart: 5000, touchpointEnd: 10000 } },
      },
    },
    false,
  );
  assert.equal(wrong.chorus, undefined);
  const composer = musicProfile(
    song,
    { song: {}, singer: { ret: 0, identity: 1 } },
    false,
  );
  assert.equal(
    composer.singer.facts.find((f) => f.label === '平台身份')?.value,
    '作曲家',
  );
  assert.ok(composer.missing.includes('作曲署名'));
});
