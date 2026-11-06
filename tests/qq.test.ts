import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  QQMusic,
  signQuery,
  safeSample,
  parseUpstreamJSON,
  songFromQQ,
  probe,
  webPlaybackResource,
} from '../src/server/music/qq';
import { testConfig } from './helpers';

test('encrypted full resources use an independently authorized plain preview; no entitlement bypass or fake full playback', () => {
  const raw = {
    playable: 1,
    song_play_url_standard: 'http://a.qq.com/full.mgg?vkey=sensitive',
    try_playable: 1,
    try_file_size: 200,
    try_30s_url: 'http://a.qq.com/preview.mp3?vkey=sensitive',
  };
  assert.deepEqual(webPlaybackResource(raw), {
    url: 'https://a.qq.com/preview.mp3?vkey=sensitive',
    preview: true,
    quality: 10,
    fullNeedsSdk: true,
  });
  assert.equal(webPlaybackResource({ ...raw, try_playable: 0 }), undefined);
  assert.equal(
    webPlaybackResource({ ...raw, playable: 0, try_file_size: 0 }),
    undefined,
  );
  assert.equal(
    webPlaybackResource({
      ...raw,
      song_play_url_standard: 'javascript:alert(1)',
      try_30s_url: 'https://evil.test/song.mp3',
    }),
    undefined,
  );
  assert.equal(
    webPlaybackResource({
      ...raw,
      song_play_url_standard: 'https://a.qq.com/plain.mp3',
    })?.preview,
    false,
  );
});

test('request signing preserves exact encoded order, and appkey stays out of normal request parameters', async () => {
  let called = false;
  const transport: typeof fetch = async (input, init) => {
    called = true;
    const url = new URL(String(input));
    assert.equal(url.searchParams.get('app_key'), null);
    assert.ok(url.search.endsWith('w=%E6%99%B4%E5%A4%A9'));
    assert.equal(
      (init?.headers as Record<string, string>)['X-QYOPI-Sign'],
      createHmac('sha256', 'private-key')
        .update(url.search.slice(1) + '&cookie=')
        .digest('hex'),
    );
    return new Response(JSON.stringify({ ret: 0, list: [] }));
  };
  const qq = new QQMusic(
    testConfig({ qqAppId: '123', qqAppKey: 'private-key' }),
    transport,
  );
  await qq.call(
    'fcg_music_custom_search.fcg',
    { w: '晴天' },
    { ip: '1.2.3.4', device: 'device' },
  );
  assert.ok(called);
  assert.equal(
    signQuery('app_id=123&timestamp=1&w=%E6%99%B4%E5%A4%A9', 'unit-test-key'),
    '2a35626c7bae75dcb1f168e336ab5b8b5c0a4f6dcaaa777aede609ff15a8f2d2',
  );
});
test('diagnostics redact credentials, playback URLs and lyrics without removing useful field names', () => {
  const sample = safeSample({
    qqmusic_access_token: 'sensitive',
    song_ekey_standard: 'secret',
    song_play_url: 'https://example.test/file?token=secret',
    song_lyric: 'lyrics',
    album_desc: '专辑介绍',
  });
  const serialized = JSON.stringify(sample);
  assert.ok(!serialized.includes('sensitive'));
  assert.ok(!serialized.includes('token=secret'));
  assert.ok(!serialized.includes('lyrics'));
  assert.ok(serialized.includes('专辑介绍'));
});
test('missing credentials and missing user authorization are reported honestly without fake data', async () => {
  const qq = new QQMusic(testConfig(), async () => {
    throw new Error('must not run');
  });
  const result = await probe(
    qq,
    'search',
    {},
    { ip: '127.0.0.1', device: 'test' },
  );
  assert.equal(result.status, 'missing_config');
  const configured = new QQMusic(
    testConfig({ qqAppId: '123', qqAppKey: 'key' }),
    async () => {
      throw new Error('must not run');
    },
  );
  assert.equal(
    (
      await probe(
        configured,
        'account',
        {},
        { ip: '127.0.0.1', device: 'test' },
      )
    ).status,
    'needs_login',
  );
});
test('64-bit upstream identities survive JSON parsing and missing facts remain unknown', () => {
  assert.equal(
    (
      parseUpstreamJSON('{"qqmusic_open_id":15874200098810912345}') as Record<
        string,
        unknown
      >
    ).qqmusic_open_id,
    '15874200098810912345',
  );
  const song = songFromQQ({
    song_id: 1,
    song_mid: 'testmid',
    song_name: '测试歌曲',
    album_pic: 'javascript:alert(1)',
  });
  assert.equal(song.language, undefined);
  assert.equal(song.hasFemaleVoice, undefined);
  assert.equal(song.cover, undefined);
  assert.ok(!('song_play_url' in song));
});
