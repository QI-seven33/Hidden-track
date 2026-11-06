import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from './simulation-07';

test('500 seeded full games preserve cards, integer budgets, pressure, stage gates and finite chances on every transition', () => {
  for (let seed = 1; seed <= 500; seed++)
    simulate(seed, [0, 0.25, 0.65, 0.9][seed % 4]!);
});
test('simulation seed reproduces the same full outcome and action count', () => {
  assert.deepEqual(simulate(4421, 0.65), simulate(4421, 0.65));
});
