import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FIRING_DURATION,
  DEFAULT_MAX_INTERVAL,
  DEFAULT_MEAN_INTERVAL,
  DEFAULT_MIN_INTERVAL,
  syntheticAlert,
  type SyntheticAlertOptions,
} from '../src/index.ts';

// The four defaults are a cross-language contract with the Go and Python
// libraries in this series; a timer sized for one must fit the others.
test('defaults match the series', () => {
  assert.equal(DEFAULT_MEAN_INTERVAL, 60 * 60 * 1000);
  assert.equal(DEFAULT_MIN_INTERVAL, 10 * 60 * 1000);
  assert.equal(DEFAULT_MAX_INTERVAL, 2 * 60 * 60 * 1000);
  assert.equal(DEFAULT_FIRING_DURATION, 10 * 60 * 1000);
});

test('no options and an empty options object are both accepted', () => {
  assert.equal(typeof syntheticAlert(), 'function');
  assert.equal(typeof syntheticAlert({}), 'function');
});

/** An options object with exactly one property set, built without a computed-key type widening. */
function only(name: keyof SyntheticAlertOptions, value: number): SyntheticAlertOptions {
  const options: SyntheticAlertOptions = {};
  options[name] = value;
  return options;
}

const names: (keyof SyntheticAlertOptions)[] = [
  'meanInterval',
  'minInterval',
  'maxInterval',
  'firingDuration',
];

for (const name of names) {
  test(`${name} rejects zero, negative, and non-finite numbers, and non-numbers`, () => {
    const bad = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const value of bad) {
      assert.throws(() => syntheticAlert(only(name, value)), {
        name: 'RangeError',
        message: /must be positive and finite, got/,
      });
    }
    // JavaScript callers get no type checking; a wrong type is a TypeError.
    assert.throws(() => syntheticAlert(only(name, '600000' as unknown as number)), {
      name: 'TypeError',
      message: /must be a number, got string/,
    });
  });
}

test('the positive-and-finite message names the option in words', () => {
  assert.throws(() => syntheticAlert({ meanInterval: Number.NaN }), {
    message: 'mean interval must be positive and finite, got NaN',
  });
  assert.throws(() => syntheticAlert({ minInterval: 0 }), {
    message: 'min interval must be positive and finite, got 0',
  });
  assert.throws(() => syntheticAlert({ maxInterval: -5 }), {
    message: 'max interval must be positive and finite, got -5',
  });
  assert.throws(() => syntheticAlert({ firingDuration: Number.POSITIVE_INFINITY }), {
    message: 'firing duration must be positive and finite, got Infinity',
  });
});

test('the firing duration must be less than the mean interval', () => {
  assert.throws(
    () => syntheticAlert({ meanInterval: 600_000, minInterval: 600_000, firingDuration: 600_000 }),
    {
      name: 'RangeError',
      message: 'firing duration (600000) must be less than the mean interval (600000)',
    },
  );
  assert.throws(() => syntheticAlert({ firingDuration: DEFAULT_MEAN_INTERVAL + 1 }), {
    name: 'RangeError',
    message: /must be less than the mean interval/,
  });
});

test('the min and max intervals must bracket the mean', () => {
  assert.throws(() => syntheticAlert({ minInterval: DEFAULT_MEAN_INTERVAL + 1 }), {
    name: 'RangeError',
    message: `min interval (${DEFAULT_MEAN_INTERVAL + 1}) and max interval (${DEFAULT_MAX_INTERVAL}) must bracket the mean interval (${DEFAULT_MEAN_INTERVAL})`,
  });
  assert.throws(() => syntheticAlert({ maxInterval: DEFAULT_MEAN_INTERVAL - 1 }), {
    name: 'RangeError',
    message: /must bracket the mean interval/,
  });
});

test('a zero-width window (min == mean == max) is legal', () => {
  assert.equal(
    typeof syntheticAlert({
      meanInterval: 60_000,
      minInterval: 60_000,
      maxInterval: 60_000,
      firingDuration: 10_000,
    }),
    'function',
  );
});
