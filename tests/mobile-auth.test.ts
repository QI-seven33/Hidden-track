import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/server/store';
import { MusicAuth } from '../src/server/music/auth';
import { QQMusic } from '../src/server/music/qq';
import {
  authReturnPage,
  authReturnTarget,
  validAuthReturnTarget,
} from '../src/server/music/auth-return';
import { makeApp } from '../src/server/app';
import { guest, ORIGIN, testConfig } from './helpers';
import { phoneIsPortrait } from '../src/client/OrientationNotice';

const config = () =>
  testConfig({
    qqAppId: 'fixture-app',
    qqAppKey: 'fixture-key',
    qqWebLogin: true,
  });
const token = () =>
  new Response(
    JSON.stringify({
      ret: 0,
      encryptString: JSON.stringify({
        qqmusic_open_id: 'fixture-new-account',
        qqmusic_access_token: 'fixture-access',
        expireTime: 2000000000,
      }),
    }),
  );
function nonce(url: string) {
  return new URL(
    new URL(url).searchParams.get('callbackUrl')!,
  ).searchParams.get('state')!;
}

test('explicit H5 authorization requests account selection and keeps its callback origin fixed', () => {
  const store = new Store(':memory:', '11'.repeat(32));
  store.createSession('owner', '游戏名');
  try {
    const auth = new MusicAuth(store, new QQMusic(config()));
    const url = new URL(auth.web('owner', ORIGIN).url);
    assert.equal(url.searchParams.get('changeLogin'), '1');
    assert.equal(new URL(url.searchParams.get('callbackUrl')!).origin, ORIGIN);
    assert.throws(() => auth.web('owner', 'https://evil.invalid'));
  } finally {
    store.close();
  }
});

test('same-session callback survives a temporary token exchange failure without exposing its saved code', async () => {
  const store = new Store(':memory:', '11'.repeat(32));
  store.createSession('owner', '游戏名');
  let fail = true,
    calls = 0;
  const auth = new MusicAuth(
    store,
    new QQMusic(config(), async () => {
      calls++;
      if (fail) throw Error('temporary network failure');
      return token();
    }),
  );
  try {
    const state = nonce(
      auth.web('owner', ORIGIN, '/r/test#invite=fixture-invite').url,
    );
    await assert.rejects(() =>
      auth.receiveWebCallback('owner', state, 'code-recoverable', '127.0.0.1'),
    );
    assert.equal(store.getAuth('owner'), undefined);
    assert.equal(store.deferredWebAuthCode('owner'), 'code-recoverable');
    const raw = store.db
      .prepare('SELECT deferred_code FROM web_auth_flows WHERE session=?')
      .get('owner');
    assert.ok(!JSON.stringify(raw).includes('code-recoverable'));
    fail = false;
    const completed = await auth.completeWeb('owner', '127.0.0.1');
    assert.equal(completed.status, 'authorized');
    assert.equal(completed.returnTo, '/r/test#invite=fixture-invite');
    assert.equal(store.deferredWebAuthCode('owner'), undefined);
    assert.equal(calls, 2);
  } finally {
    store.close();
  }
});

test('cross-browser hints reopen only an allowlisted app and never carry credentials', async () => {
  const store = new Store(':memory:', '11'.repeat(32));
  store.createSession('owner', '游戏名');
  const auth = new MusicAuth(store, new QQMusic(config(), async () => token()));
  try {
    const state = nonce(auth.web('owner', ORIGIN, '/', false, 'qqbrowser').url);
    const result = await auth.receiveWebCallback(
      'foreign',
      state,
      'code-private-result',
      '127.0.0.1',
    );
    assert.equal(result.returnPath, '/auth/complete?target=qqbrowser');
    assert.equal(store.getAuth('foreign'), undefined);
    const html = authReturnPage(ORIGIN, 'qqbrowser');
    assert.ok(html.includes('package=com.tencent.mtt'));
    assert.ok(!html.includes(state));
    assert.ok(!html.includes('code-private-result'));
    assert.equal(validAuthReturnTarget('javascript:alert(1)'), '');
    assert.equal(validAuthReturnTarget('__proto__'), '');
    assert.equal(
      (await auth.completeWeb('foreign', '127.0.0.1')).status,
      'expired',
    );
    assert.equal(
      (await auth.completeWeb('owner', '127.0.0.1')).status,
      'authorized',
    );
  } finally {
    store.close();
  }
});

test('an existing Android APK can resume its original deferred login; another cookie cannot claim it', async () => {
  const { app } = await makeApp({
    config: config(),
    fetch: async () => token(),
  });
  try {
    const owner = await guest(app, '原玩家'),
      foreign = await guest(app, '另一个浏览器');
    const start = (
      await app.inject({
        method: 'POST',
        url: '/api/music/auth/web',
        headers: owner,
        payload: {
          nativeReturn: true,
          returnTo: '/r/fixture-room#invite=fixture-invite',
        },
      })
    ).json();
    const state = nonce(start.url);
    const callback = await app.inject({
      url:
        '/api/music/auth/web/callback?' +
        new URLSearchParams({
          state,
          p: JSON.stringify({ ret: 0, encryptString: 'code-native-resume' }),
        }),
      headers: foreign,
    });
    assert.equal(callback.headers.location, '/auth/complete?target=native');
    const wrong = await app.inject({
      url: '/api/music/auth/web/callback?resume=1',
      headers: foreign,
    });
    assert.equal(wrong.headers.location, '/?login=resume');
    assert.equal(
      (await app.inject({ url: '/api/session', headers: foreign })).json()
        .qqAuthorized,
      false,
    );
    const resumed = await app.inject({
      url: '/api/music/auth/web/callback?resume=1',
      headers: owner,
    });
    assert.equal(
      resumed.headers.location,
      '/r/fixture-room#invite=fixture-invite',
    );
    assert.equal(
      (await app.inject({ url: '/api/session', headers: owner })).json()
        .qqAuthorized,
      true,
    );
    const page = await app.inject({ url: '/auth/complete?target=native' });
    assert.match(page.body, /hiddentrack:\/\/oauth\?resume=1/);
    assert.ok(!page.body.includes('code-native-resume'));
    assert.equal(page.headers['cache-control'], 'no-store');
  } finally {
    await app.close();
  }
});

test('logout cancels recovery and changing QQ accounts clears profile while preserving the game name', async () => {
  const store = new Store(':memory:', '11'.repeat(32));
  store.createSession('owner', '我的游戏ID');
  const auth = new MusicAuth(store, new QQMusic(config(), async () => token()));
  try {
    store.setAuth('owner', {
      openId: 'old-account',
      accessToken: 'old',
      expiresAt: 2000000000000,
    });
    store.setProfile('owner', '旧QQ昵称', 'https://y.qq.com/old.png');
    let state = nonce(auth.web('owner', ORIGIN).url);
    await auth.receiveWebCallback(
      'owner',
      state,
      'code-new-account',
      '127.0.0.1',
    );
    assert.equal(store.getSession('owner')?.name, '我的游戏ID');
    assert.equal(store.getSession('owner')?.nickname, null);
    state = nonce(auth.web('owner', ORIGIN).url);
    await auth.receiveWebCallback(
      'foreign',
      state,
      'code-cancelled',
      '127.0.0.1',
    );
    auth.logout('owner');
    assert.equal(
      (await auth.completeWeb('owner', '127.0.0.1')).status,
      'expired',
    );
    assert.equal(store.getAuth('owner'), undefined);
  } finally {
    store.close();
  }
});

test('Android return hints distinguish real browsers from QQ/WeChat embedded pages', () => {
  assert.equal(authReturnTarget('Android MQQBrowser/15.0', false), 'qqbrowser');
  assert.equal(authReturnTarget('Android MQQBrowser/6.2 QQ/9.0', false), '');
  assert.equal(
    authReturnTarget('Android Chrome/130 MicroMessenger/8', false),
    '',
  );
  assert.equal(authReturnTarget('Android Chrome/130 EdgA/130', false), 'edge');
  assert.equal(authReturnTarget('Android Chrome/130', true), 'native');
});

test('orientation uses screen state rather than a keyboard-shortened viewport and does not block desktop windows', () => {
  assert.equal(
    phoneIsPortrait({
      mobile: true,
      type: 'portrait-primary',
      width: 400,
      height: 280,
    }),
    true,
  );
  assert.equal(
    phoneIsPortrait({
      mobile: true,
      type: 'landscape-primary',
      width: 784,
      height: 344,
    }),
    false,
  );
  assert.equal(
    phoneIsPortrait({
      mobile: false,
      type: 'portrait-primary',
      width: 500,
      height: 900,
    }),
    false,
  );
  assert.equal(
    phoneIsPortrait({ mobile: true, angle: 90, width: 500, height: 900 }),
    false,
  );
  assert.equal(
    phoneIsPortrait({ mobile: true, width: 400, height: 800 }),
    true,
  );
});

test('WeChat gate only matches the official MicroMessenger UA token', async () => {
  const { isWeChatWebView } = await import('../src/client/WeChatGate');
  assert.equal(isWeChatWebView(''), false);
  assert.equal(
    isWeChatWebView(
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36',
    ),
    false,
  );
  assert.equal(
    isWeChatWebView(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36 MicroMessenger/8.0.49.2600',
    ),
    true,
  );
  // iOS 微信 UA 一样带 MicroMessenger；微信内嵌的 QQ 浏览器内核也有 MQQBrowser。
  assert.equal(
    isWeChatWebView(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 MicroMessenger/8.0.49 NetType/WIFI Language/zh_CN',
    ),
    true,
  );
});
