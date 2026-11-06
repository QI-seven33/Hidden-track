import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/server/store';
import { Rooms } from '../src/server/rooms';
import { MusicAuth } from '../src/server/music/auth';
import { QQMusic } from '../src/server/music/qq';
import {
  parseWebAuthResult,
  loginReturnPath,
} from '../src/server/music/auth-callback';
import { makeApp } from '../src/server/app';
import { getSong } from '../src/game/catalog';
import { availableClues, eligibleClues } from '../src/game/clues';
import { cardUnavailableReason, transition } from '../src/game/engine';
import { record } from '../src/game/operations';
import { rulesSchema } from '../src/shared/protocol';
import { DEFAULT_RULES } from '../src/shared/rules';
import { setup } from './game-helpers';
import { testConfig, guest, ORIGIN } from './helpers';
import { RequestQueue } from '../src/server/music/request-queue';
import { loadConfig } from '../src/server/config';

test('a late profile response cannot restore account details after logout', async () => {
  let release!: () => void, started!: () => void;
  const start = new Promise<void>((r) => (started = r)),
    wait = new Promise<void>((r) => (release = r));
  const { app, store, rooms } = await makeApp({
    config: webConfig(),
    fetch: async () => {
      started();
      await wait;
      return new Response(
        JSON.stringify({
          ret: 0,
          user_info: {
            nickname: 'Old account',
            headimgurl: 'https://y.qq.com/old.png',
          },
        }),
      );
    },
  });
  try {
    const headers = await guest(app, '乐友');
    const made = (
      await app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers,
        payload: { mode: 'fixture' },
      })
    ).json();
    const session = rooms.get(made.room.id).players.a!.session;
    store.setAuth(session, {
      openId: 'old',
      accessToken: 'old',
      expiresAt: Date.now() + 3600000,
    });
    const pending = app
      .inject({ url: '/api/session', headers })
      .then((r) => r.json());
    await start;
    await app.inject({
      method: 'POST',
      url: '/api/music/auth/logout',
      headers,
      payload: {},
    });
    release();
    const result = await pending;
    assert.equal(result.qqAuthorized, false);
    assert.equal(result.nickname, undefined);
    assert.equal(result.avatar, undefined);
    assert.equal(store.getSession(session)?.name, '乐友');
  } finally {
    await app.close();
  }
});

test('upstream queue overlaps slow calls, caps concurrency and preserves start spacing after failures', async () => {
  const queue = new RequestQueue(2, 20),
    starts: number[] = [];
  let active = 0,
    maxActive = 0;
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, (_, index) =>
      queue.run(async () => {
        starts.push(Date.now());
        maxActive = Math.max(maxActive, ++active);
        await new Promise((resolve) => setTimeout(resolve, 65));
        active--;
        if (index === 2) throw new Error('simulated upstream failure');
        return index;
      }),
    ),
  );
  assert.equal(maxActive, 2);
  assert.equal(
    results.filter((result) => result.status === 'rejected').length,
    1,
  );
  assert.ok(starts.slice(1).every((time, i) => time - starts[i]! >= 18));
});

test('production defaults disable fixtures and reject invalid ports or origins', () => {
  const env = {
    LOCAL_PRACTICE_ONLY: 'false',
    NODE_ENV: 'production',
    SESSION_SECRET: '11'.repeat(32),
    ADMIN_TOKEN: 'x'.repeat(32),
    APP_ORIGINS: 'https://music.example.com',
  };
  assert.equal(loadConfig(env).fixtures, false);
  for (const patch of [
    { PORT: 'NaN' },
    { PORT: '65536' },
    { APP_ORIGINS: 'https://music.example.com/path' },
    { QQMUSIC_APP_ID: 'only-id' },
  ])
    assert.throws(() => loadConfig({ ...env, ...patch }));
});

test('production room routes require login even when the frontend is bypassed', async () => {
  const { app } = await makeApp({
    config: testConfig({ production: true, qqAppId: 'mock', qqAppKey: 'mock' }),
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: { origin: ORIGIN },
      payload: { mode: 'fixture', bot: true },
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, 'QQ_LOGIN_REQUIRED');
    assert.equal((await app.inject('/api/session')).statusCode, 200);
  } finally {
    await app.close();
  }
});

test('logout during QR creation invalidates the pending response', async () => {
  const store = new Store(':memory:', '11'.repeat(32));
  store.createSession('owner', '甲');
  let release!: () => void, started!: () => void;
  const start = new Promise<void>((r) => (started = r)),
    wait = new Promise<void>((r) => (release = r));
  const auth = new MusicAuth(
    store,
    new QQMusic(webConfig(), async () => {
      started();
      await wait;
      return new Response(
        JSON.stringify({
          ret: 0,
          auth_code: 'test',
          sdk_qr_code: 'https://y.qq.com/test',
        }),
      );
    }),
  );
  try {
    const qr = auth.qr('owner', '127.0.0.1');
    await start;
    auth.logout('owner');
    release();
    await assert.rejects(qr);
    await assert.rejects(auth.poll('owner', '127.0.0.1'));
  } finally {
    store.close();
  }
});

const tokenResponse = () =>
  new Response(
    JSON.stringify({
      ret: 0,
      encryptString: JSON.stringify({
        qqmusic_open_id: 'mock-owner',
        qqmusic_access_token: 'mock-access',
        qqmusic_refresh_token: 'mock-refresh',
        expireTime: 2000000000,
      }),
    }),
  );
const webConfig = () =>
  testConfig({
    qqAppId: '123',
    qqAppKey: 'mock',
    qqPackage: 'com.example.duel',
    // H5 授权页的 packageName 与扫码用的 qqPackage 分开配置。
    qqH5Package: 'com.example.duel',
    qqWebLogin: true,
  });

test('H5 parses the official nested JSON callback; rejects Harmony format, cancellation and missing state', () => {
  const state = 's'.repeat(32);
  assert.deepEqual(
    parseWebAuthResult(
      JSON.stringify({
        ret: 0,
        encryptString: JSON.stringify({ code: 'code-test', state }),
      }),
    ),
    { code: 'code-test', state },
  );
  for (const payload of [
    'p=code-test',
    '{',
    JSON.stringify({ ret: -1 }),
    JSON.stringify({ ret: 0, encryptString: '{"code":"code-test"}' }),
  ])
    assert.throws(() => parseWebAuthResult(payload));
  assert.equal(loginReturnPath('/r/room#invite=token'), '/r/room#invite=token');
  for (const path of [
    '//evil.test',
    '/\\evil.test',
    'https://evil.test',
    '/api/music/listen',
  ])
    assert.throws(() => loginReturnPath(path));
});

test('H5 state survives auth-service restart, stays session-bound, exchanges once and preserves invitation', async () => {
  const store = new Store(':memory:', '11'.repeat(32));
  store.createSession('owner', '甲');
  store.createSession('other', '乙');
  let calls = 0;
  const qq = new QQMusic(webConfig(), async () => {
    calls++;
    return tokenResponse();
  });
  const first = new MusicAuth(store, qq);
  try {
    const result = first.web('owner', ORIGIN, '/r/room#invite=token');
    const url = new URL(result.url);
    assert.equal(url.searchParams.get('packageName'), 'com.example.duel');
    const state = JSON.parse(url.searchParams.get('encryptString')!).state;
    const restarted = new MusicAuth(store, qq);
    await assert.rejects(() =>
      restarted.webCallback('other', state, 'code-test', '127.0.0.1'),
    );
    await assert.rejects(() =>
      restarted.webCallback('owner', 'wrong', 'code-test', '127.0.0.1'),
    );
    const [a, b] = await Promise.all([
      restarted.webCallback('owner', state, 'code-test', '127.0.0.1'),
      restarted.webCallback('owner', state, 'code-test', '127.0.0.1'),
    ]);
    assert.equal(a.returnPath, '/r/room#invite=token');
    assert.deepEqual(a, b);
    assert.equal(calls, 1);
    await assert.rejects(() =>
      restarted.webCallback('owner', state, 'code-test', '127.0.0.1'),
    );
    assert.equal(store.getAuth('other'), undefined);
  } finally {
    store.close();
  }
});

test('temporary refresh failure preserves stored login and concurrent refreshes share one request', async () => {
  const store = new Store(':memory:', '11'.repeat(32));
  store.createSession('owner', '甲');
  const original = {
    openId: 'id',
    accessToken: 'old',
    refreshToken: 'refresh',
    expiresAt: Date.now() - 1000,
  };
  store.setAuth('owner', original);
  let calls = 0;
  const auth = new MusicAuth(
    store,
    new QQMusic(webConfig(), async () => {
      calls++;
      throw new Error('network');
    }),
  );
  try {
    const results = await Promise.allSettled([
      auth.context('owner', '127.0.0.1'),
      auth.context('owner', '127.0.0.1'),
    ]);
    assert.ok(results.every((r) => r.status === 'rejected'));
    assert.equal(calls, 1);
    assert.deepEqual(store.getAuth('owner'), original);
  } finally {
    store.close();
  }
});

test('logout while a token exchange is pending cannot restore login', async () => {
  const store = new Store(':memory:', '11'.repeat(32));
  store.createSession('owner', '甲');
  let release!: () => void, started!: () => void;
  const start = new Promise<void>((r) => (started = r)),
    wait = new Promise<void>((r) => (release = r));
  const auth = new MusicAuth(
    store,
    new QQMusic(webConfig(), async () => {
      started();
      await wait;
      return tokenResponse();
    }),
  );
  try {
    const url = new URL(auth.web('owner', ORIGIN).url),
      state = JSON.parse(url.searchParams.get('encryptString')!).state;
    const result = auth.webCallback('owner', state, 'code-test', '127.0.0.1');
    await start;
    auth.logout('owner');
    release();
    await assert.rejects(() => result);
    assert.equal(store.getAuth('owner'), undefined);
  } finally {
    store.close();
  }
});

test('HTTP H5 callback uses fixed same-origin URL, verifies both states and never reflects HTML', async () => {
  const { app } = await makeApp({
    config: webConfig(),
    fetch: async () => tokenResponse(),
  });
  try {
    const headers = await guest(app, '甲');
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/music/auth/web',
          headers,
          payload: { redirectUri: 'https://evil.test' },
        })
      ).statusCode,
      400,
    );
    const issued = (
      await app.inject({
        method: 'POST',
        url: '/api/music/auth/web',
        headers,
        payload: { returnTo: '/r/test#invite=key' },
      })
    ).json();
    const callback = new URL(
      new URL(issued.url).searchParams.get('callbackUrl')!,
    );
    const state = callback.searchParams.get('state')!;
    callback.searchParams.set(
      'p',
      JSON.stringify({
        ret: 0,
        encryptString: JSON.stringify({ state, code: 'code-test' }),
      }),
    );
    const success = await app.inject({
      url: callback.pathname + callback.search,
      headers: { cookie: headers.cookie },
    });
    assert.equal(success.statusCode, 302);
    assert.equal(success.headers.location, '/r/test#invite=key');
    const failure = await app.inject({
      url:
        '/api/music/auth/web/callback?p=' +
        encodeURIComponent('<script>alert(1)</script>'),
      headers,
    });
    assert.equal(failure.headers.location, '/?login=failed');
    assert.ok(!failure.body.includes('<script>'));
  } finally {
    await app.close();
  }
});

test('expired swap cannot be accepted and rendering a room never mutates it', () => {
  const store = new Store(':memory:', '11'.repeat(32)),
    rooms = new Rooms(store);
  try {
    const made = rooms.create('a', '甲', 'fixture', false),
      id = made.room.id;
    rooms.join(id, made.invite, 'b', '乙');
    rooms.requestSwap(id, 'a', rooms.get(id).version);
    const expired = rooms.get(id);
    expired.swapAsk!.at = Date.now() - 61000;
    rooms.save(expired);
    const snapshot = structuredClone(expired);
    rooms.view(expired, 'a');
    assert.deepEqual(expired, snapshot);
    const fresh = rooms.get(id);
    assert.equal(fresh.swapAsk, undefined);
    assert.throws(() => rooms.respondSwap(id, 'b', true, fresh.version));
  } finally {
    rooms.close();
    store.close();
  }
});

test('starting clears pending swaps; a late response cannot exchange live player identities', () => {
  const store = new Store(':memory:', '11'.repeat(32)),
    rooms = new Rooms(store);
  try {
    const made = rooms.create('a', '甲', 'fixture', false),
      id = made.room.id;
    rooms.join(id, made.invite, 'b', '乙');
    rooms.select(id, 'a', getSong('wish'), rooms.get(id).version);
    rooms.select(id, 'b', getSong('coral'), rooms.get(id).version);
    rooms.requestSwap(id, 'a', rooms.get(id).version);
    rooms.start(id, 'a', rooms.get(id).version);
    assert.equal(rooms.get(id).swapAsk, undefined);
    assert.throws(() =>
      rooms.respondSwap(id, 'b', true, rooms.get(id).version),
    );
    assert.equal(rooms.get(id).players.a!.session, 'a');
  } finally {
    rooms.close();
    store.close();
  }
});

test('an idle human swap expires without waiting for another HTTP request', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const store = new Store(':memory:', '11'.repeat(32)),
    rooms = new Rooms(store);
  try {
    const made = rooms.create('a', '甲', 'fixture', false),
      id = made.room.id;
    rooms.join(id, made.invite, 'b', '乙');
    rooms.requestSwap(id, 'a', rooms.get(id).version);
    t.mock.timers.tick(60_000);
    assert.equal(store.getRoom<{ swapAsk?: unknown }>(id)?.swapAsk, undefined);
  } finally {
    rooms.close();
    store.close();
  }
});

test('HTTP practice starts after the human swaps to the second seat', async () => {
  const { app, rooms } = await makeApp({ config: testConfig() });
  try {
    const headers = await guest(app, '甲');
    const made = (
      await app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers,
        payload: { mode: 'fixture', bot: true },
      })
    ).json();
    const id = made.room.id,
      r = rooms.get(id),
      human = r.players.a!,
      bot = r.players.b!;
    r.players.a = bot;
    r.players.b = human;
    rooms.save(r);
    rooms.select(id, human.session, getSong('wish'), r.version);
    const response = await app.inject({
      method: 'POST',
      url: `/api/rooms/${id}/start`,
      headers,
      payload: { version: rooms.get(id).version },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().room.me, 'b');
  } finally {
    await app.close();
  }
});

test('exhausted low-tier information cannot consume a card or AP under a lyric restriction', () => {
  const s = setup(['information', 'probe']);
  s.players.a.clues = availableClues(s, 'a').filter((c) => c.tier <= 2);
  assert.equal(eligibleClues(s, 'a', 1).length, 0);
  for (const card of s.players.a.hand) {
    assert.ok(cardUnavailableReason(s, 'a', card));
    const result = transition(s, {
      type: 'playCard',
      side: 'a',
      instanceId: card.id,
    });
    assert.ok(result.error);
    assert.equal(result.state, s);
  }
});

test('played totals survive the 400-entry engine log and probability rows cannot silently lose mass', () => {
  const s = setup();
  for (let i = 0; i < 450; i++)
    record(s, { kind: 'card', side: 'a', title: '封麦', text: 'test' });
  assert.equal(s.events.length, 400);
  assert.equal(s.cardsPlayed!.a, 450);
  assert.equal(rulesSchema.safeParse(DEFAULT_RULES).success, true);
  for (const odds of [
    [20, 20, 20, 20],
    [100, 100, 0, 0],
  ])
    assert.equal(
      rulesSchema.safeParse({
        ...DEFAULT_RULES,
        clueOdds: { ...DEFAULT_RULES.clueOdds, 1: odds },
      }).success,
      false,
    );
});
