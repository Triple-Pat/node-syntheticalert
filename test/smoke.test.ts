import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MEAN_INTERVAL } from '../src/index.ts';

test('the toolchain runs TypeScript source directly', () => {
  assert.equal(DEFAULT_MEAN_INTERVAL, 3_600_000);
});
