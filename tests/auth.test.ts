import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/server/store';
import { MusicAuth } from '../src/server/music/auth';
import { QQMusic } from '../src/server/music/qq';
import { testConfig } from './helpers';

test('QR lets upstream validate an empty package; OAuth exchange preserves 64-bit identity and binds one session', async () => {
  const store = new Store(':memory:', '11'.repeat(32));
  store.createSession('owner', '甲');
  store.createSession('outsider', '乙');
  const transport: typeof fetch = async (input) => {
    const url = new URL(String(input));
    const command = url.searchParams.get('opi_cmd');
    if (command === 'fcg_music_custom_sdk_get_qr_code.fcg') {
      assert.equal(url.searchParams.get('qqmusic_package_name'), '');
      return new Response(
        JSON.stringify({
          ret: 0,
          sdk_qr_code: 'https://y.qq.com/qr/test',
          auth_code: 'auh-test',
        }),
      );
    }
    if (command === 'fcg_music_custom_qrcode_auth_poll.fcg')
      return new Response(
        JSON.stringify({ ret: 0, encryptString: 'code-test' }),
      );
    assert.equal(command, 'fcg_music_oauth_get_accesstoken.fcg');
    assert.equal(url.searchParams.get('code'), 'code-test');
    return new Response(
      JSON.stringify({
        ret: 0,
        encryptString:
          '{"qqmusic_open_id":15874200098810912345,"qqmusic_access_token":"test-access","expireTime":2000000000}',
      }),
    );
  };
  const auth = new MusicAuth(
    store,
    new QQMusic(
      testConfig({ qqAppId: '123', qqAppKey: 'private', qqPackage: '' }),
      transport,
    ),
  );
  try {
    const qr = await auth.qr('owner', '127.0.0.1');
    assert.ok(qr.url.startsWith('https://'));
    await assert.rejects(
      () => auth.poll('outsider', '127.0.0.1'),
      /二维码已过期/,
    );
    assert.deepEqual(await auth.poll('owner', '127.0.0.1'), {
      status: 'authorized',
    });
    assert.equal(store.getAuth('owner')?.openId, '15874200098810912345');
    assert.equal(store.getAuth('outsider'), undefined);
    assert.ok(!JSON.stringify(qr).includes('test-access'));
    auth.logout('owner');
    assert.equal(store.getAuth('owner'), undefined);
  } finally {
    store.close();
  }
});
