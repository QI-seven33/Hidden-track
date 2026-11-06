import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  diagnosticData,
  flattenFields,
  wikiFacts,
  inspectMusic,
} from '../src/server/music/inspect';
import { QQMusic } from '../src/server/music/qq';
import { testConfig } from './helpers';

test('full field inspection retains late and empty fields, while hiding tickets, URLs and lyric text', () => {
  const payload = {
    ...Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [`field_${i}`, i]),
    ),
    language: '',
    song_play_url: 'https://aqqmusic.qq.com/file?key=secret',
    extra: { songToken: 'private' },
    song_lyric: 'must not persist lyric text',
    description: 'literal private-key value',
  };
  const safe = diagnosticData(payload, ['private-key']);
  const serialized = JSON.stringify(safe);
  for (const secret of [
    'key=secret',
    '"private"',
    'must not persist lyric text',
    'private-key',
  ])
    assert.ok(!serialized.includes(secret));
  const rows = flattenFields(safe);
  assert.ok(rows.some((r) => r.path === 'field_99' && r.value === '99'));
  assert.ok(rows.some((r) => r.path === 'language' && r.value === '空字符串'));
  assert.deepEqual(
    wikiFacts(
      '<info><basic><item><key><![CDATA[地区]]></key><value><![CDATA[港台]]></value></item></basic></info>',
    ),
    { 地区: '港台' },
  );
});
test('song inspection keeps independent source sections and requests the numeric song ID for chorus', async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    const command = url.searchParams.get('opi_cmd');
    if (command === 'fcg_music_custom_get_song_info_batch.fcg')
      return new Response(
        JSON.stringify({
          ret: 0,
          songlist: [
            {
              song_id: 123,
              song_mid: 'mid',
              song_name: '曲目',
              album_mid: 'album',
              singer_mid: 'singer',
              language: '',
              song_play_url: 'https://aqqmusic.qq.com/private',
            },
          ],
        }),
      );
    if (command === 'fcg_music_custom_get_mir_detail.fcg') {
      assert.equal(url.searchParams.get('song_ids'), '123');
      return new Response(
        JSON.stringify({ ret: 0, data: { '123': { touchpointStart: 5000 } } }),
      );
    }
    if (command === 'fcg_music_custom_get_singer_info.fcg')
      return new Response(
        JSON.stringify({
          ret: 0,
          wikiInfo:
            '<info><basic><item><key>地区</key><value>港台</value></item></basic></info>',
        }),
      );
    if (command === 'fcg_music_custom_get_album_detail.fcg')
      return new Response(JSON.stringify({ ret: 0, str_language: '国语' }));
    return new Response(JSON.stringify({ ret: 0, list: [] }));
  };
  const result = await inspectMusic(
    new QQMusic(
      testConfig({ qqAppId: '123', qqAppKey: 'private-key' }),
      fetcher,
    ),
    'qq:mid',
    { ip: '127.0.0.1', device: 'test' },
  );
  assert.equal(result.sections.length, 9);
  assert.equal(result.identity, 'anonymous');
  assert.ok(
    result.sections
      .find((s) => s.key === 'album')
      ?.rows.some((r) => r.path === 'str_language' && r.value === '国语'),
  );
  assert.ok(
    result.sections
      .find((s) => s.key === 'song')
      ?.rows.some((r) => r.path === 'language' && r.value === '空字符串'),
  );
  assert.ok(
    !JSON.stringify(result).includes('https://aqqmusic.qq.com/private'),
  );
});
