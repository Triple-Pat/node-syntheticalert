import { test } from 'node:test';
import assert from 'node:assert/strict';
import { START, deterministic } from './helpers.ts';

const GAP = 60_000;
const FIRING = 10_000;

test('starts resolved', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  assert.equal(deterministic(GAP, FIRING)(), 0);
});
