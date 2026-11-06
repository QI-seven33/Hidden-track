import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeApp } from '../src/server/app';
import { testConfig, guest } from './helpers';
import { hash } from '../src/server/rooms';
import { parseWebAuthResult } from '../src/server/music/auth-callback';
import { PracticeLibrary } from '../src/server/music/practice';
import { MusicAuth } from '../src/server/music/auth';
import { Store } from '../src/server/store';
import { QQMusic } from '../src/server/music/qq';
import candidates from '../src/server/music/practice-recordings.json';
import versions from '../src/shared/asset-versions.json';
import { ART_PACK, artPath } from '../src/client/presentation/skin';
const state = 's'.repeat(32);
test('cross-browser callback stays encrypted and only the initiating session can complete login', async () => {
  const store = new Store(':memory:', '11'.repeat(32));
  store.createSession('owner', '甲');
  store.createSession('foreign', '乙');
  let calls = 0;
  const auth = new MusicAuth(
    store,
    new QQMusic(
      testConfig({ qqAppId: 'test', qqAppKey: 'test', qqWebLogin: true }),
      async () => {
        calls++;
        return new Response(
          JSON.stringify({
            ret: 0,
            encryptString: JSON.stringify({
              qqmusic_open_id: 'mock',
              qqmusic_access_token: 'mock-token',
              expireTime: 2000000000,
            }),
          }),
        );
      },
    ),
  );
  try {
    const start = new URL(auth.web('owner', 'http://localhost:3190').url);
    const nonce = JSON.parse(start.searchParams.get('encryptString')!).state;
    const result = await auth.receiveWebCallback(
      'foreign',
      nonce,
      'code-cross-browser',
      '127.0.0.1',
    );
    assert.equal(result.deferred, true);
    assert.equal(calls, 0);
    assert.equal(store.getAuth('foreign'), undefined);
    assert.equal(store.getAuth('owner'), undefined);
    const row = store.db
      .prepare('SELECT deferred_code FROM web_auth_flows WHERE session=?')
      .get('owner')!;
    assert.ok(!String(row.deferred_code).includes('code-cross-browser'));
    assert.equal(
      (await auth.completeWeb('foreign', '127.0.0.1')).status,
      'expired',
    );
    const results = await Promise.all([
      auth.completeWeb('owner', '127.0.0.1'),
      auth.completeWeb('owner', '127.0.0.1'),
    ]);
    assert.ok(results.every((r) => r.status === 'authorized'));
    assert.equal(calls, 1);
    assert.equal(store.getAuth('foreign'), undefined);
    assert.ok(store.getAuth('owner'));
    await assert.rejects(() =>
      auth.receiveWebCallback('foreign', nonce, 'code-replay', '127.0.0.1'),
    );
  } finally {
    store.close();
  }
});

test('logout revokes a deferred authorization result', async () => {
  const store = new Store(':memory:', '11'.repeat(32));
  store.createSession('owner', '甲');
  const auth = new MusicAuth(
    store,
    new QQMusic(
      testConfig({ qqAppId: 'test', qqAppKey: 'test', qqWebLogin: true }),
    ),
  );
  try {
    const nonce = JSON.parse(
      new URL(auth.web('owner', 'http://localhost:3190').url).searchParams.get(
        'encryptString',
      )!,
    ).state;
    await auth.receiveWebCallback('foreign', nonce, 'code-cancel', '127.0.0.1');
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
test('official double-encoded H5 callback exchanges token and the same session enters the lobby', async () => {
  const { app } = await makeApp({
    config: testConfig({ qqAppId: 'test', qqAppKey: 'test', qqWebLogin: true }),
    fetch: async () =>
      new Response(
        JSON.stringify({
          ret: 0,
          encryptString: JSON.stringify({
            qqmusic_open_id: 'mock-owner',
            qqmusic_access_token: 'mock-access',
            expireTime: 2000000000,
          }),
        }),
      ),
  });
  try {
    const headers = await guest(app, '甲');
    const begin = await app.inject({
      method: 'POST',
      url: '/api/music/auth/web',
      headers,
      payload: { returnTo: '/' },
    });
    assert.equal(begin.statusCode, 200, begin.body);
    const authURL = new URL(begin.json().url);
    const flow = JSON.parse(authURL.searchParams.get('encryptString')!).state;
    const payload = JSON.stringify({
      ret: 0,
      encryptString: JSON.stringify({ code: 'code-verified', state: flow }),
    });
    const callback = await app.inject({
      url:
        '/api/music/auth/web/callback?state=' +
        flow +
        '&p=' +
        encodeURIComponent(encodeURIComponent(payload)),
      headers,
    });
    assert.equal(callback.statusCode, 302);
    assert.equal(callback.headers.location, '/');
    const session = (await app.inject({ url: '/api/session', headers })).json();
    assert.equal(session.qqAuthorized, true);
  } finally {
    await app.close();
  }
});
test('callback diagnostics never log payload prefixes or credential values', async () => {
  const { app } = await makeApp({ config: testConfig() });
  const logged: unknown[] = [];
  app.log.warn = ((record: unknown) =>
    logged.push(record)) as typeof app.log.warn;
  const marker = 'private-code-must-never-appear';
  try {
    const payload = JSON.stringify({
      ret: 0,
      encryptString: { code: marker, state },
    });
    const response = await app.inject(
      '/api/music/auth/web/callback?p=' + encodeURIComponent(payload),
    );
    assert.equal(response.statusCode, 302);
    assert.equal(response.headers.location, '/?login=failed');
    assert.ok(logged.length);
    assert.ok(!JSON.stringify(logged).includes(marker));
    assert.ok(!JSON.stringify(logged).includes(state));
  } finally {
    await app.close();
  }
});
test('Android callback returns to the app but remains bound to the original browser session', () => {
  const store = new Store(':memory:', '11'.repeat(32));
  store.createSession('a', '甲');
  try {
    const auth = new MusicAuth(
      store,
      new QQMusic(
        testConfig({ qqAppId: 'test', qqAppKey: 'test', qqWebLogin: true }),
      ),
    );
    const result = new URL(
      auth.web('a', 'http://localhost:3190', '/', true).url,
    );
    const callback = new URL(result.searchParams.get('callbackUrl')!);
    assert.equal(callback.protocol, 'hiddentrack:');
    assert.equal(callback.host, 'oauth');
    const received = callback.searchParams.get('state')!;
    assert.equal(auth.diagnostics('a', received).stateMatches, true);
    assert.equal(
      auth.diagnostics('different-browser', received).differentBrowser,
      true,
    );
  } finally {
    store.close();
  }
});

test('a publicly bound HTTP demo still enforces room authentication', async () => {
  const { app } = await makeApp({
    config: testConfig({ host: '0.0.0.0', qqAppId: 'test', qqAppKey: 'test' }),
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: { origin: 'http://localhost:3190' },
      payload: { mode: 'fixture' },
    });
    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});
test('callback accepts explicit nested objects, JSON and exact codes without discarding object fields', () => {
  for (const encryptString of [
    { code: 'code-test', state },
    JSON.stringify({ code: 'code-test', state }),
    'code-test',
  ])
    assert.deepEqual(
      parseWebAuthResult(JSON.stringify({ ret: 0, encryptString }), state),
      { code: 'code-test', state },
    );
  for (const encryptString of [
    'prefix code-test suffix',
    '{"code":"code-test","state":"bad"}',
    { code: 'code-test', state: 'x'.repeat(32) },
  ])
    assert.throws(() =>
      parseWebAuthResult(JSON.stringify({ ret: 0, encryptString }), state),
    );
  assert.throws(() =>
    parseWebAuthResult(JSON.stringify({ ret: 0, encryptString: 'code-test' })),
  );
});

const mp3 = () => {
  const frame = Buffer.alloc(417);
  frame.writeUInt32BE(0xfffb9000);
  return Buffer.concat(Array.from({ length: 450 }, () => frame));
};
const transport: typeof fetch = async (input) => {
  const url = new URL(String(input));
  if (url.pathname.endsWith('.mp3'))
    return new Response(mp3(), { headers: { 'content-type': 'audio/mpeg' } });
  const song = candidates.find(
    (s) =>
      s.providerMid === url.searchParams.get('song_mid') ||
      s.providerId === url.searchParams.get('song_id'),
  )!;
  return new Response(
    JSON.stringify({
      ret: 0,
      songlist: [
        {
          song_mid: song.providerMid,
          song_id: song.providerId,
          song_name: song.title,
          singer_name: song.artists.join('、'),
          try_playable: 1,
          try_file_size: 200000,
          try_30s_url: 'https://y.qq.com/test.mp3',
        },
      ],
    }),
  );
};

test('practice catalog filters missing official preview and rejects unauthenticated listeners', async () => {
  const qq = new QQMusic(
    testConfig({ qqAppId: 'test', qqAppKey: 'test' }),
    async (input) => {
      const response = await transport(input);
      const json = await response.json();
      if (json.songlist[0].song_mid === candidates[0]!.providerMid)
        json.songlist[0].try_playable = 0;
      return new Response(JSON.stringify(json));
    },
  );
  const library = new PracticeLibrary(qq);
  await assert.rejects(() =>
    library.list('a', { ip: '127.0.0.1', device: 'test' }),
  );
  const songs = await library.list('a', {
    ip: '127.0.0.1',
    device: 'test',
    auth: { openId: 'a', accessToken: 'test', expiresAt: Date.now() + 600000 },
  });
  assert.equal(songs.length, candidates.length - 1);
  assert.ok(
    songs.every(
      (song) => song.cover && song.providerMid && song.previewAvailable,
    ),
  );
  assert.equal(library.current('b').length, 0);
});

test('real-data practice preview obeys unlock, account, match and byte-range boundaries', async () => {
  const { app, rooms, store } = await makeApp({
    config: testConfig({ fixtures: false, qqAppId: 'test', qqAppKey: 'test' }),
    fetch: transport,
  });
  try {
    const headers = await guest(app, '甲'),
      session = hash(headers.cookie.split('=')[1]!);
    store.setAuth(session, {
      openId: 'a',
      accessToken: 'test',
      expiresAt: Date.now() + 600000,
    });
    const made = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers,
      payload: { mode: 'fixture', bot: true },
    });
    assert.equal(made.statusCode, 200, made.body);
    const id = made.json().room.id;
    const selected = await app.inject({
      method: 'POST',
      url: `/api/rooms/${id}/song`,
      headers,
      payload: { songId: candidates[0]!.id, version: 0 },
    });
    assert.equal(selected.statusCode, 200, selected.body);
    rooms.start(id, session, rooms.get(id).version);
    const locked = await app.inject({
      method: 'POST',
      url: `/api/rooms/${id}/preview-source`,
      headers,
      payload: {},
    });
    assert.equal(locked.statusCode, 403);
    const room = rooms.get(id);
    room.game!.players.a.previewSegments = 1;
    rooms.save(room);
    const prepared = await app.inject({
      method: 'POST',
      url: `/api/rooms/${id}/preview-source`,
      headers,
      payload: {},
    });
    assert.equal(prepared.statusCode, 200, prepared.body);
    const src = prepared.json().src;
    const audio = await app.inject({
      url: src,
      headers: { ...headers, range: 'bytes=0-15' },
    });
    assert.equal(audio.statusCode, 206);
    assert.equal(audio.rawPayload.length, 16);
    const other = await guest(app, '乙');
    assert.equal(
      (await app.inject({ url: src, headers: other })).statusCode,
      404,
    );
    store.setAuth(session, null);
    assert.equal((await app.inject({ url: src, headers })).statusCode, 403);
  } finally {
    await app.close();
  }
});

test('versioned art caches without freezing unversioned images; wildcard serves new files and missing assets stay 404', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'music-static-'));
  const src = ART_PACK.cards.strike!.src,
    version = versions[src as keyof typeof versions];
  await mkdir(join(folder, 'art/duel-20261101'), { recursive: true });
  await mkdir(join(folder, 'assets'), { recursive: true });
  await writeFile(join(folder, 'index.html'), '<html>test</html>');
  await writeFile(join(folder, src), 'image');
  const { app } = await makeApp({ config: testConfig({ clientRoot: folder }) });
  try {
    await app.ready();
    assert.match(
      (await app.inject(src + '?v=' + version)).headers['cache-control']!,
      /immutable/,
    );
    assert.equal((await app.inject(src)).headers['cache-control'], 'no-cache');
    await writeFile(join(folder, 'assets/new-abcdefgh.js'), 'test');
    assert.equal((await app.inject('/assets/new-abcdefgh.js')).statusCode, 200);
    assert.equal((await app.inject('/assets/missing.css')).statusCode, 404);
    assert.equal((await app.inject('/api/missing')).statusCode, 404);
    assert.equal((await app.inject('/%2e%2e/package.json')).statusCode, 404);
    assert.match(artPath(ART_PACK.cards.strike)!, /\?v=[a-f0-9]{16}$/);
    const first = await app.inject(src + '?v=' + version);
    assert.equal(
      (
        await app.inject({
          url: src + '?v=' + version,
          headers: { 'if-none-match': String(first.headers.etag) },
        })
      ).statusCode,
      304,
    );
  } finally {
    await app.close();
    await rm(folder, { recursive: true, force: true });
  }
});

test('legacy authorization table migrates without losing existing sessions and pending state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auth-migration-'));
  const file = join(dir, 'old.sqlite');
  const { DatabaseSync } = await import('node:sqlite');
  const legacy = new DatabaseSync(file);
  legacy.exec(
    'CREATE TABLE web_auth_flows(session TEXT PRIMARY KEY,state TEXT NOT NULL,expires INTEGER NOT NULL,return_path TEXT NOT NULL)',
  );
  legacy
    .prepare('INSERT INTO web_auth_flows VALUES(?,?,?,?)')
    .run('owner', 'pending', Date.now() + 60000, '/');
  legacy.close();
  const store = new Store(file, '11'.repeat(32));
  try {
    assert.equal(store.getWebAuthFlow('owner')?.state, 'pending');
    assert.equal(store.deferWebAuthCode('pending', 'code-migration'), true);
    assert.equal(store.deferredWebAuthCode('owner'), 'code-migration');
    store.setWebAuthFlow('owner', 'renewed', Date.now() + 60000, '/');
    assert.equal(store.deferredWebAuthCode('owner'), undefined);
    assert.equal(store.deferWebAuthCode('pending', 'code-old'), false);
    store.setWebAuthFlow('owner', 'expired', Date.now() - 1, '/');
    assert.equal(store.deferWebAuthCode('expired', 'code-expired'), false);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('cross-browser HTTP callback signs in only the original cookie; foreign Origin cannot claim it', async () => {
  const { app } = await makeApp({
    config: testConfig({ qqAppId: 'test', qqAppKey: 'test', qqWebLogin: true }),
    fetch: async () =>
      new Response(
        JSON.stringify({
          ret: 0,
          encryptString: JSON.stringify({
            qqmusic_open_id: 'mock',
            qqmusic_access_token: 'mock-token',
            expireTime: 2000000000,
          }),
        }),
      ),
  });
  try {
    const owner = await guest(app, '甲'),
      foreign = await guest(app, '乙');
    const begin = await app.inject({
      method: 'POST',
      url: '/api/music/auth/web',
      headers: owner,
      payload: { returnTo: '/' },
    });
    const nonce = JSON.parse(
      new URL(begin.json().url).searchParams.get('encryptString')!,
    ).state;
    const p = JSON.stringify({ ret: 0, encryptString: 'code-http-deferred' });
    const callback = await app.inject({
      url:
        '/api/music/auth/web/callback?' +
        new URLSearchParams({ state: nonce, p }),
      headers: foreign,
    });
    assert.equal(callback.headers.location, '/auth/complete');
    const malicious = await app.inject({
      method: 'POST',
      url: '/api/music/auth/web/complete',
      headers: { ...owner, origin: 'https://example.invalid' },
      payload: {},
    });
    assert.equal(malicious.statusCode, 403);
    const received = await app.inject({
      method: 'POST',
      url: '/api/music/auth/web/complete',
      headers: owner,
      payload: {},
    });
    assert.equal(received.statusCode, 200);
    assert.equal(received.json().status, 'authorized');
    assert.equal(
      (await app.inject({ url: '/api/session', headers: owner })).json()
        .qqAuthorized,
      true,
    );
    assert.equal(
      (await app.inject({ url: '/api/session', headers: foreign })).json()
        .qqAuthorized,
      false,
    );
  } finally {
    await app.close();
  }
});
