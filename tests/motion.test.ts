import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import {
  composeFeedback,
  flightDelta,
} from '../src/client/presentation/motion';
import { PresentationCursor } from '../src/client/presentation/events';

test('one hit yields one immediate pressure cue instead of duplicate sequential popups', () => {
  const cues = composeFeedback([
    { id: 1, kind: 'card', side: 'a', cardId: 'strike' },
    { id: 2, kind: 'pressure', side: 'b', amount: 20 },
    { id: 3, kind: 'damage', side: 'b', amount: 20 },
    { id: 4, kind: 'heal', side: 'a', amount: 1 },
  ]);
  assert.deepEqual(
    cues.map((c) => c.kind),
    ['damage', 'heal'],
  );
  assert.equal(cues[0]!.label, '+20 压力');
});
test('same-side multi-clue rewards aggregate, opponent facts never become local clue content', () => {
  const cues = composeFeedback([
    { id: 1, kind: 'clue', side: 'a', text: '私有资料不会复制' },
    { id: 2, kind: 'clue', side: 'a' },
    { id: 3, kind: 'clue', side: 'b' },
  ]);
  assert.deepEqual(
    cues.map((c) => c.label),
    ['2 条新线索', '新线索'],
  );
  assert.ok(!JSON.stringify(cues).includes('私有资料'));
});
test('routine draws and turn announcements do not create a stale toast backlog', () => {
  const cues = composeFeedback(
    Array.from({ length: 32 }, (_, i) => ({
      id: i,
      kind: i % 2 ? 'draw' : 'turn',
      side: 'a' as const,
      amount: 2,
    })),
  );
  assert.deepEqual(cues, []);
});
test('feedback is bounded, masks guess text, and AP disruption cannot be displayed as attack pressure', () => {
  assert.deepEqual(
    composeFeedback([
      { id: 1, kind: 'damage', side: 'b', title: '失去行动点', amount: 1 },
    ]),
    [],
  );
  const cues = composeFeedback([
    { id: 2, kind: 'guess', side: 'b', text: '不应公开的猜测' },
  ]);
  assert.ok(!JSON.stringify(cues).includes('不应公开'));
  assert.equal(
    composeFeedback([
      { id: 1, kind: 'response', side: 'a', title: '伤害免疫' },
    ])[0]!.label,
    '已免疫',
  );
});
test('flight uses measured centers and rejects invalid geometry without changing the layout', () => {
  assert.deepEqual(
    flightDelta(
      { left: 20, top: 10, width: 60, height: 80 },
      { left: 100, top: 200, width: 120, height: 160 },
    ),
    { x: -110, y: -230, scale: 0.5 },
  );
  assert.equal(
    flightDelta(
      { left: NaN, top: 0, width: 60, height: 80 },
      { left: 0, top: 0, width: 0, height: 1 },
    ),
    undefined,
  );
});
test('reconnect and hidden snapshots establish a baseline without replaying old motion', () => {
  const cursor = new PresentationCursor();
  cursor.next('m:1', [{ id: 1, kind: 'card' }]);
  assert.deepEqual(
    composeFeedback(
      cursor.next('m:2', [{ id: 10, kind: 'damage', amount: 20 }]),
    ),
    [],
  );
  assert.deepEqual(
    composeFeedback(
      cursor.next('m:2', [{ id: 11, kind: 'damage', amount: 20 }], false),
    ),
    [],
  );
});
test('the motion override stylesheet contains no resting layout, sizing or spacing changes', () => {
  const css = postcss.parse(
    readFileSync('src/client/presentation/motion.css', 'utf8'),
  );
  const forbidden =
    /^(position|display|inset.*|top|right|bottom|left|width|height|min-.*|max-.*|margin.*|padding.*|gap|.*-gap|grid.*|flex.*|font-size|line-height|overflow)$/;
  css.walkDecls((d) =>
    assert.ok(!forbidden.test(d.prop), `layout change: ${d.prop}`),
  );
});
