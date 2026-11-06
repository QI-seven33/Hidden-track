import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byteRange, PreviewSources } from '../src/server/music/preview-source';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EventCard } from '../src/client/EventCard';

test('native audio ranges handle open, suffix, clipping and invalid ranges without widening a grant', () => {
  assert.equal(byteRange(undefined, 100), undefined);
  assert.deepEqual(byteRange('bytes=0-', 100), { start: 0, end: 99 });
  assert.deepEqual(byteRange('bytes=10-19', 100), { start: 10, end: 19 });
  assert.deepEqual(byteRange('bytes=-8', 100), { start: 92, end: 99 });
  assert.deepEqual(byteRange('bytes=90-500', 100), { start: 90, end: 99 });
  for (const value of [
    'bytes=100-',
    'bytes=9-2',
    'bytes=-0',
    'bytes=',
    'bytes=0-2,6-9',
    'bytes=9007199254740992-',
  ])
    assert.equal(byteRange(value, 100), null);
});
test('preview sources are ephemeral, session-bound, replace old listener resources and cap memory', () => {
  const cache = new PreviewSources(),
    entry = {
      session: 'a',
      roomId: 'r',
      matchId: 'm',
      segments: 1,
      authKey: 'auth',
      audio: Buffer.from('sample'),
    };
  const issued = cache.put(entry, 100)!;
  assert.equal(cache.get(issued.id, 'other', 101), undefined);
  assert.equal(cache.get(issued.id, 'a', 101)?.segments, 1);
  const next = cache.put(entry, 102)!;
  assert.equal(cache.get(issued.id, 'a', 103), undefined);
  assert.ok(cache.get(next.id, 'a', 103));
  assert.equal(cache.get(next.id, 'a', 120103), undefined);
  for (let i = 0; i < 16; i++)
    assert.ok(cache.put({ ...entry, session: 's' + i }, 200));
  assert.equal(cache.put({ ...entry, session: 'excess' }, 200), undefined);
  assert.equal(
    cache.put({ ...entry, audio: Buffer.alloc(2 * 1024 * 1024 + 1) }, 200),
    undefined,
  );
});
test('event back hides title until automatic reveal; front is selectable', () => {
  const props = {
    event: {
      id: 's1',
      title: '测试事件标题',
      description: '翻面前不得提前朗读的内容',
      rarity: 'silver',
    },
    index: 1,
    locked: false,
    disabled: false,
    refreshable: true,
    choose: () => {},
    refresh: () => {},
  };
  const back = renderToStaticMarkup(
    createElement(EventCard, { ...props, revealed: false }),
  );
  assert.ok(!back.includes(props.event.title));
  assert.ok(!back.includes(props.event.description));
  assert.ok(back.includes('event-back'));
  assert.ok(!back.includes('is-revealed'));
  const front = renderToStaticMarkup(
    createElement(EventCard, { ...props, revealed: true }),
  );
  assert.ok(front.includes(props.event.description));
  assert.ok(front.includes('is-revealed'));
  assert.ok(front.includes('点击选择'));
  assert.ok(!front.includes('翻开'));
});

test('an isolated review cookie does not consume or overwrite the normal game session cookie', async () => {
  const { makeApp } = await import('../src/server/app');
  const { testConfig } = await import('./helpers');
  const { app } = await makeApp({
    config: testConfig(),
    sessionCookieName: 'music_session_feedback_review',
  });
  try {
    const response = await app.inject({
      url: '/api/session',
      headers: { cookie: 'music_session=previous-existing-browser-session' },
    });
    assert.equal(response.statusCode, 200);
    assert.match(
      String(response.headers['set-cookie']),
      /^music_session_feedback_review=/,
    );
    assert.ok(
      !String(response.headers['set-cookie']).includes('music_session='),
    );
  } finally {
    await app.close();
  }
});
