import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicTranslation } from '../src/server/music/translation';
import { fullLyrics } from '../src/server/music/lyrics';
import { QQMusic } from '../src/server/music/qq';
import { testConfig } from './helpers';
const translated = '[00:01.00]测试中文甲\n[00:02.00]测试中文乙';
const payload = (extra: Record<string, unknown> = {}) => ({
  code: 0,
  song: {
    code: 0,
    data: {
      songID: 1,
      crypt: 0,
      qrc: 0,
      trans: Buffer.from(translated).toString('base64'),
      ...extra,
    },
  },
});
test('Chinese translation decodes UTF-8 Base64 transport text and validates the exact recording and plaintext mode', () => {
  assert.equal(publicTranslation(payload(), '1'), translated);
  assert.equal(
    publicTranslation(payload({ trans: translated }), '1'),
    translated,
  );
  for (const change of [
    { songID: 2 },
    { songID: 9007199254740992 },
    { crypt: 1 },
    { qrc: 1 },
    { trans: 'FFAA7788' },
    { trans: Buffer.from([255, 254]).toString('base64') },
    { trans: Buffer.from('ciphertext blob').toString('base64') },
  ])
    assert.equal(publicTranslation(payload(change), '1'), undefined);
});
test('lyrics API returns the original plus Chinese translation without forwarding credentials to the public service', async () => {
  let publicRequests = 0;
  const transport: typeof fetch = async (input, init) => {
    if (String(input).includes('musicu.fcg')) {
      publicRequests++;
      const request = JSON.stringify(init);
      for (const secret of [
        'private-key',
        'private-user',
        'private-ticket',
        'X-QYOPI-Sign',
        'qqmusic_access_token',
      ])
        assert.ok(!request.includes(secret));
      assert.equal(init?.credentials, 'omit');
      assert.equal(init?.redirect, 'error');
      const body = JSON.parse(String(init?.body));
      assert.equal(body.song.param.songID, 1);
      assert.equal(body.song.param.crypt, 0);
      assert.equal(body.song.param.trans, 1);
      return new Response(JSON.stringify(payload()));
    }
    const command = new URL(String(input)).searchParams.get('opi_cmd');
    return new Response(
      JSON.stringify(
        command === 'fcg_music_custom_get_song_info_batch.fcg'
          ? {
              ret: 0,
              songlist: [{ song_id: 1, song_mid: 'mid', song_name: '测试' }],
            }
          : {
              ret: 0,
              song_id: 1,
              song_lyric: '[00:01]Test original A\n[00:02]Test original B',
              song_translate_lyric: '',
            },
      ),
    );
  };
  const qq = new QQMusic(
    testConfig({
      qqAppId: '123',
      qqAppKey: 'private-key',
      qqPublicLyrics: true,
    }),
    transport,
  );
  const result = await fullLyrics(qq, 'qq:mid', {
    ip: '127.0.0.1',
    device: 'test',
    auth: {
      openId: 'private-user',
      accessToken: 'private-ticket',
      expiresAt: Date.now() + 3600000,
    },
  });
  assert.equal(publicRequests, 1);
  assert.equal(result.translationAvailable, true);
  assert.deepEqual(
    result.sections.map((s) => s.kind),
    ['original', 'translation'],
  );
  assert.equal(result.sections[1]?.lines[1]?.text, '测试中文乙');
  assert.match(result.sections[1]?.source || '', /公开歌词/);
});
test('unavailable or disabled public translation preserves original lyrics and reports absence explicitly', async () => {
  let publicRequests = 0;
  const transport: typeof fetch = async (input) => {
    if (String(input).includes('musicu.fcg')) {
      publicRequests++;
      throw Error('offline');
    }
    return new Response(
      JSON.stringify(
        new URL(String(input)).searchParams.get('opi_cmd') ===
          'fcg_music_custom_get_song_info_batch.fcg'
          ? {
              ret: 0,
              songlist: [{ song_id: 1, song_mid: 'mid', song_name: '测试' }],
            }
          : { ret: 0, song_id: 1, song_lyric: '[00:01]Original only' },
      ),
    );
  };
  for (const enabled of [false, true]) {
    const result = await fullLyrics(
      new QQMusic(
        testConfig({
          qqAppId: '123',
          qqAppKey: 'key',
          qqPublicLyrics: enabled,
        }),
        transport,
      ),
      'qq:mid',
      { ip: '127.0.0.1', device: 'test' },
    );
    assert.equal(result.translationAvailable, false);
    assert.equal(result.sections.length, 1);
  }
  assert.equal(publicRequests, 1);
});
