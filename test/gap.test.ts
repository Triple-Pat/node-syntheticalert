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

/** CDF of the exponential distribution with `mean`, truncated to [min, max]. */
function truncatedCdf(mean: number, min: number, max: number): (x: number) => number {
  const F = (x: number): number => 1 - Math.exp(-x / mean);
  const mass = F(max) - F(min);
  return (x) => (F(x) - F(min)) / mass;
}

/**
 * One-sample Kolmogorov-Smirnov statistic: the largest vertical distance
 * between the empirical CDF of `sample` and `cdf`, checked on both sides of
 * each step.
 */
function ksStatistic(sample: number[], cdf: (x: number) => number): number {
  const sorted = [...sample].sort((a, b) => a - b);
  const n = sorted.length;
  let d = 0;
  for (const [i, x] of sorted.entries()) {
    const f = cdf(x);
    d = Math.max(d, f - i / n, (i + 1) / n - f);
  }
  return d;
}

const ALPHA = 0.01;

/**
 * Asymptotic K-S critical value: reject when D > sqrt(-ln(alpha / 2) / (2n)).
 * At alpha = 0.01 this is the textbook 1.628 / sqrt(n).
 */
function critical(n: number): number {
  return Math.sqrt(-Math.log(ALPHA / 2) / (2 * n));
}

/**
 * A correct sampler fails one K-S attempt with probability alpha = 1% by
 * construction. Three independent attempts bring the false-failure rate to
 * 1e-6 without a flaky-retry plugin; a wrong distribution fails all three.
 */
function passesKs(sampler: () => number, cdf: (x: number) => number, attempts = 3): boolean {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const sample = Array.from({ length: N }, sampler);
    if (ksStatistic(sample, cdf) <= critical(N)) {
      return true;
    }
  }
  return false;
}

const mean = DEFAULT_MEAN_INTERVAL;
const min = DEFAULT_MIN_INTERVAL;
const max = DEFAULT_MAX_INTERVAL;

test('gaps are memoryless: K-S against the truncated exponential', () => {
  assert.ok(passesKs(() => truncatedExponential(mean, min, max), truncatedCdf(mean, min, max)));
});

test('the shape also holds in the far tail where S(max) underflows to 0', () => {
  // The same parameters as the finiteness test above; here the K-S test
  // checks that the survival-space arithmetic still yields the right
  // distribution, not merely finite in-bounds numbers.
  assert.ok(
    passesKs(() => truncatedExponential(1_000, 1, 1_000_000), truncatedCdf(1_000, 1, 1_000_000)),
  );
});

test('K-S accepts an independent implementation of the right distribution', () => {
  // The memoryless property lets a truncated exponential on [min, max] be
  // drawn as min plus an exponential truncated to [0, max - min], by a
  // different formula from the one under test: a positive control.
  const width = max - min;
  const control = (): number =>
    min - mean * Math.log(1 - Math.random() * (1 - Math.exp(-width / mean)));
  assert.ok(passesKs(control, truncatedCdf(mean, min, max)));
});

test('K-S rejects wrong distributions', () => {
  const cdf = truncatedCdf(mean, min, max);
  // Uniform on the window.
  assert.equal(
    passesKs(() => min + Math.random() * (max - min), cdf),
    false,
  );
  // An untruncated exponential clamped to the window piles about 15% of its
  // mass at min, which is what "clamping instead of truncating" looks like.
  assert.equal(
    passesKs(() => Math.min(Math.max(-mean * Math.log(1 - Math.random()), min), max), cdf),
    false,
  );
  // The right shape with the mean off by 25%.
  assert.equal(
    passesKs(() => truncatedExponential(mean * 1.25, min, max), cdf),
    false,
  );
});

test('the realized mean gap under the defaults is about 49 minutes, as documented', () => {
  // Closed-form mean of the exponential truncated to [min, max]:
  // mean + (min S(min) - max S(max)) / (S(min) - S(max)) with S(x) = exp(-x / mean).
  const S = (x: number): number => Math.exp(-x / mean);
  const expected = mean + (min * S(min) - max * S(max)) / (S(min) - S(max));
  const minute = 60_000;
  assert.ok(Math.abs(expected - 49 * minute) < minute, `closed form is ${expected / minute} min`);
  // The sample mean's standard error is under 0.3 min at N = 10 000; allow 2 min.
  const sample = draws(N, mean, min, max);
  const observed = sample.reduce((a, b) => a + b, 0) / N;
  assert.ok(Math.abs(observed - expected) < 2 * minute, `sample mean ${observed / minute} min`);
});
