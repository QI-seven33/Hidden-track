import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PresentationCursor } from '../src/client/presentation/events';
import { artPath } from '../src/client/presentation/skin';

test('presentation skips history, duplicates, reconnects and gaps without carrying hidden event data', () => {
  const cursor = new PresentationCursor();
  const event = (id: number) => ({
    id,
    kind: 'card',
    side: 'a' as const,
    secret: 'must-not-pass',
  });
  assert.deepEqual(cursor.next('room:1', [event(1), event(2)]), []);
  assert.deepEqual(cursor.next('room:1', [event(1), event(2)]), []);
  assert.deepEqual(cursor.next('room:1', [event(2), event(3)]), [
    { id: 3, kind: 'card', side: 'a' },
  ]);
  assert.deepEqual(cursor.next('room:2', [event(3), event(4)]), []);
  assert.deepEqual(cursor.next('room:2', [event(4), event(5)], false), []);
  assert.deepEqual(cursor.next('room:2', [event(5), event(6)]), [
    { id: 6, kind: 'card', side: 'a' },
  ]);
  assert.deepEqual(cursor.next('room:2', [event(100), event(101)]), []);
  assert.equal(
    cursor.next('room:2', [event(102), event(103), event(104), event(105)])
      .length,
    4,
  );
  assert.deepEqual(cursor.next('room:2', [event(4)]), []);
});

test('art packs accept local static assets and reject external, executable and traversal paths', () => {
  assert.equal(
    artPath({ src: '/art/v1/cards/attack.webp' }),
    '/art/v1/cards/attack.webp',
  );
  for (const src of [
    'https://x.test/a.png',
    '//x.test/a.png',
    '/art/../x.png',
    '/art/a.js',
    '/art/a.png?token=secret',
    '/art/%2e%2e/x.png',
  ])
    assert.equal(artPath({ src }), undefined);
  assert.equal(artPath(), undefined);
});
