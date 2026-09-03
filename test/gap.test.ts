import { test } from 'node:test';
import assert from 'node:assert/strict';
import { truncatedExponential } from '../src/gap.ts';
import { DEFAULT_MAX_INTERVAL, DEFAULT_MEAN_INTERVAL, DEFAULT_MIN_INTERVAL } from '../src/index.ts';

const N = 10_000;

function draws(n: number, mean: number, min: number, max: number): number[] {
  return Array.from({ length: n }, () => truncatedExponential(mean, min, max));
}

test('every gap lies within the bounds', () => {
  for (const gap of draws(N, DEFAULT_MEAN_INTERVAL, DEFAULT_MIN_INTERVAL, DEFAULT_MAX_INTERVAL)) {
    assert.ok(
      gap >= DEFAULT_MIN_INTERVAL && gap <= DEFAULT_MAX_INTERVAL,
      `gap ${gap} outside [${DEFAULT_MIN_INTERVAL}, ${DEFAULT_MAX_INTERVAL}]`,
    );
  }
});

test('a zero-width window returns exactly the mean', () => {
  for (const gap of draws(1_000, 60_000, 60_000, 60_000)) {
    assert.equal(gap, 60_000);
  }
});

test('a max hundreds of means away never yields NaN or Infinity', () => {
  // exp(-1000) is below the smallest subnormal double, so the survival
  // function at max is exactly 0 and a careless sampler could hand log() a
  // zero. The bounds must still hold literally.
  const mean = 1_000;
  const min = 1;
  const max = 1_000_000;
  assert.equal(Math.exp(-max / mean), 0);
  for (const gap of draws(N, mean, min, max)) {
    assert.ok(Number.isFinite(gap), `gap ${gap} is not finite`);
    assert.ok(gap >= min && gap <= max, `gap ${gap} outside [${min}, ${max}]`);
  }
});
