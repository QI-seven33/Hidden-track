import test from 'node:test';
import assert from 'node:assert/strict';
import { localRect } from '../src/client/presentation/coordinates';
import { flightDelta } from '../src/client/presentation/motion';

test('a rotated client rect recovers the original card shape and local position', () => {
  assert.deepEqual(
    localRect(
      { left: 15, top: 174, width: 117, height: 68 },
      { left: 0, top: 0, width: 390, height: 844 },
      true,
    ),
    { left: 174, top: 258, width: 68, height: 117 },
  );
});
test('landscape geometry stays unchanged, including viewport offsets', () => {
  const rect = { left: 174, top: 258, width: 68, height: 117 };
  assert.deepEqual(
    localRect(rect, { left: 12, top: 20, width: 844, height: 390 }, false),
    rect,
  );
});

test('native DOMRect prototype getters survive landscape conversion', () => {
  const rect = Object.create({ left: 174, top: 258, width: 68, height: 117 });
  assert.deepEqual(
    localRect(rect, { left: 0, top: 0, width: 844, height: 390 }, false),
    { left: 174, top: 258, width: 68, height: 117 },
  );
});
test('rotating the stage preserves card flight vector and uniform scale', () => {
  const from = { left: 200, top: 258, width: 68, height: 117 },
    to = { left: 350, top: 100, width: 50, height: 86 };
  const frame = { left: 0, top: 0, width: 390, height: 844 };
  const screen = (r: typeof from) => ({
    left: 390 - r.top - r.height,
    top: r.left,
    width: r.height,
    height: r.width,
  });
  assert.deepEqual(
    flightDelta(
      localRect(screen(from), frame, true),
      localRect(screen(to), frame, true),
    ),
    flightDelta(from, to),
  );
});
