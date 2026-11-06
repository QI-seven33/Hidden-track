import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCredits } from '../src/server/music/credits';
import { QQMusic } from '../src/server/music/qq';
import { musicProfile } from '../src/server/music/profile';
import { testConfig } from './helpers';

test('explicit multilingual credits bind to the exact recording and remain distinct from the LRC uploader', () => {
  const credits = extractCredits(
    {
      ret: 0,
      song_id: 97773,
      song_lyric:
        '[by:上传者]\n[00:00.00]词：作者甲\n[00:02.00]曲：作者乙/作者丙\n[00:03.00]编曲：作者丁\n[00:04.00]制作人：作者戊\n[00:05.00]词：作者甲\n[01:20.00]曲：正文中的一句话',
    },
    97773,
  );
  assert.deepEqual(
    credits.map((c) => [c.role, c.names]),
    [
      ['作词', ['作者甲']],
      ['作曲', ['作者乙', '作者丙']],
      ['编曲', ['作者丁']],
      ['制作人', ['作者戊']],
    ],
  );
  assert.ok(
    credits.every(
      (c) => c.songId === '97773' && c.source === 'qq_lyric_credit',
    ),
  );
  const english = extractCredits(
    {
      ret: 0,
      song_id: '99',
      song_lyric:
        "[00:00.00]Lyrics by&#58; Person O&#39;Name/Another Person\n[00:00.10]Composed by：Person O'Name/Another Person",
    },
    '99',
  );
  assert.deepEqual(english[0]?.names, ["Person O'Name", 'Another Person']);
  assert.equal(english[1]?.role, '作曲');
});
test('missing, mismatched, unsafe and denied identities cannot introduce a writer fact', () => {
  for (const payload of [
    { ret: 0, song_id: 2 },
    { ret: 0 },
    { ret: 100002, song_id: 1 },
    { ret: 0, song_id: 0 },
    { ret: 0, song_id: 9007199254740992 },
  ])
    assert.deepEqual(
      extractCredits({ ...payload, song_lyric: '[00:00]词：作者' }, 1),
      [],
    );
  const shared = extractCredits(
    {
      ret: 0,
      song_id: '123',
      song_lyric: '[00:00]词曲：作者甲\n[00:01]Written by：Another Person',
    },
    '123',
  );
  assert.ok(shared.some((c) => c.role === '作词'));
  assert.ok(shared.some((c) => c.role === '作曲'));
  assert.ok(shared.some((c) => c.role === '词曲署名'));
  assert.deepEqual(
    extractCredits(
      {
        ret: 0,
        song_id: 1,
        song_lyric: '[by:作者]\n[ar:歌手]\n[00:10]这是歌词里面的词：并不是署名',
      },
      1,
    ),
    [],
  );
});
test('readable profile uses verified credits with provenance without turning album language into song language', () => {
  const profile = musicProfile(
    {
      id: 'qq:mid',
      title: '测试曲目',
      artists: ['歌手'],
      album: '专辑',
      provider: 'qq',
    },
    {
      song: { song_id: 1, language: '', genre: '' },
      search: { author: '' },
      lyric: {
        ret: 0,
        song_id: 1,
        song_lyric: '[00:00]词：作者甲\n[00:01]曲：作者乙',
      },
      album: { ret: 0, str_language: '国语' },
    },
    true,
  );
  assert.equal(profile.facts.find((f) => f.label === '作词')?.value, '作者甲');
  assert.equal(profile.facts.find((f) => f.label === '作曲')?.value, '作者乙');
  assert.equal(
    profile.facts.find((f) => f.label === '作曲')?.note,
    '来源：QQ 音乐歌词署名',
  );
  assert.ok(
    !profile.missing.includes('作词署名') &&
      !profile.missing.includes('作曲署名'),
  );
  assert.ok(profile.missing.includes('单曲语言'));
});
test('selected QQ songs freeze credited writers and one short hint, never full lyrics or playback tickets', async () => {
  const upstream: typeof fetch = async (input) => {
    const command = new URL(String(input)).searchParams.get('opi_cmd');
    return new Response(
      JSON.stringify(
        command === 'fcg_music_custom_get_song_info_batch.fcg'
          ? {
              ret: 0,
              songlist: [
                {
                  song_id: 1,
                  song_mid: 'mid',
                  song_name: '测试曲目',
                  song_play_url_standard:
                    'https://a.qq.com/audio?ticket=private',
                },
              ],
            }
          : {
              ret: 0,
              song_id: 1,
              song_lyric:
                '[00:00]词：作者甲\n[00:01]曲：作者乙\n[00:20]用于测试的原创占位句子\n[00:30]不应保留的歌词正文',
            },
      ),
    );
  };
  const selected = await new QQMusic(
    testConfig({ qqAppId: '123', qqAppKey: 'key' }),
    upstream,
  ).gameSong('qq:mid', { ip: '127.0.0.1', device: 'test' });
  assert.equal(selected.lyricHint, '用于测试的原创占位句子');assert.ok(selected.lyricHints!.length<=12);assert.ok(selected.lyricHints!.every(s=>[...s].length<=24));
  assert.equal(selected.evidence?.facts.lyricHint?.status,'known');
  assert.deepEqual(selected.lyricists, ['作者甲']);
  assert.deepEqual(selected.composers, ['作者乙']);
  assert.ok(selected.sources.some((s) => s.label.includes('歌词署名')));
  for (const sensitive of [
    'ticket=private',
    'song_lyric',
  ])
    assert.ok(!JSON.stringify(selected).includes(sensitive));
});
test('failure to obtain optional lyrics leaves a song selectable with unknown writers', async () => {
  const upstream: typeof fetch = async (input) =>
    new Response(
      JSON.stringify(
        new URL(String(input)).searchParams.get('opi_cmd') ===
          'fcg_music_custom_get_song_info_batch.fcg'
          ? {
              ret: 0,
              songlist: [
                { song_id: 1, song_mid: 'mid', song_name: '测试曲目' },
              ],
            }
          : { ret: 100002, msg: 'Unavailable' },
      ),
    );
  const selected = await new QQMusic(
    testConfig({ qqAppId: '123', qqAppKey: 'key' }),
    upstream,
  ).gameSong('qq:mid', { ip: '127.0.0.1', device: 'test' });
  assert.equal(selected.title, '测试曲目');
  assert.deepEqual(selected.composers, []);
  assert.deepEqual(selected.lyricists, []);
});
test('explicit instrumental and production credits are displayed without inferring missing instruments', () => {
  const lyric = {
    ret: 0,
    song_id: 1,
    song_lyric:
      '[00:00]吉他：演奏甲\n[00:01]Bass：演奏乙\n[00:02]鼓：演奏丙\n[00:03]Mixing engineer：制作丁\n[00:04]这首歌的吉他：不是署名\n[00:05][02:00]钢琴：正文\n[00:06]合声：演唱甲\n[00:07]合声编写：编写甲\n[00:08]录音工程：工程甲',
  };
  const credits = extractCredits(lyric, 1);
  assert.deepEqual(
    credits.map((c) => [c.role, c.names]),
    [
      ['吉他', ['演奏甲']],
      ['贝斯', ['演奏乙']],
      ['鼓', ['演奏丙']],
      ['混音', ['制作丁']],
      ['和声', ['演唱甲']],
      ['和声编写', ['编写甲']],
      ['录音', ['工程甲']],
    ],
  );
  assert.deepEqual(extractCredits({ ...lyric, vcheck: 1 }, 1), []);
  const profile = musicProfile(
    {
      id: 'qq:mid',
      title: '测试',
      artists: ['歌手'],
      album: '专辑',
      provider: 'qq',
    },
    { song: { song_id: 1 }, lyric },
    false,
  );
  assert.equal(profile.facts.find((f) => f.label === '吉他')?.value, '演奏甲');
  assert.equal(
    profile.facts.find((f) => f.label === '贝斯')?.note,
    '来源：QQ 音乐歌词署名',
  );
  assert.equal(
    profile.facts.find((f) => f.label === '钢琴'),
    undefined,
  );
});
