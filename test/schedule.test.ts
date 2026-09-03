import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FIRING_DURATION,
  DEFAULT_MAX_INTERVAL,
  DEFAULT_MIN_INTERVAL,
  syntheticAlert,
} from '../src/index.ts';
import { START, deterministic } from './helpers.ts';

const GAP = 60_000;
const FIRING = 10_000;

test('starts resolved', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  assert.equal(deterministic(GAP, FIRING)(), 0);
});

test('fires after exactly one gap and resolves after exactly one firing, 100 cycles', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const alert = deterministic(GAP, FIRING);
  for (let cycle = 0; cycle < 100; cycle++) {
    t.mock.timers.tick(GAP - 1);
    assert.equal(alert(), 0, `cycle ${cycle}: firing just before the gap elapsed`);
    t.mock.timers.tick(1);
    assert.equal(alert(), 1, `cycle ${cycle}: not firing at the end of the gap`);
    t.mock.timers.tick(FIRING - 1);
    assert.equal(alert(), 1, `cycle ${cycle}: resolved before the firing duration elapsed`);
    t.mock.timers.tick(1);
    assert.equal(alert(), 0, `cycle ${cycle}: still firing after the firing duration`);
  }
});

test('the gap is measured from the end of the firing, not its start', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const alert = deterministic(GAP, FIRING);
  // Transitions: fire at GAP, resolve at GAP + FIRING, fire again at
  // GAP + FIRING + GAP. Were the gap measured from the start of the firing,
  // the second firing would already be under way here.
  t.mock.timers.tick(GAP + FIRING + GAP - 1);
  assert.equal(alert(), 0);
  t.mock.timers.tick(1);
  assert.equal(alert(), 1);
});

test('a long pause replays every missed transition', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const alert = deterministic(GAP, FIRING);
  // Ten days and an odd number of milliseconds, so the check lands mid-phase
  // rather than on an edge.
  const pause = 10 * 24 * 60 * 60 * 1000 + 12_345;
  t.mock.timers.tick(pause);
  // The periodic schedule is 0 for GAP ms, then 1 for FIRING ms, repeating.
  const phase = pause % (GAP + FIRING);
  assert.equal(alert(), phase >= GAP ? 1 : 0);
  // And it keeps time from there: step to the next edge and check both sides.
  const toNextEdge = phase >= GAP ? GAP + FIRING - phase : GAP - phase;
  t.mock.timers.tick(toNextEdge - 1);
  assert.equal(alert(), phase >= GAP ? 1 : 0);
  t.mock.timers.tick(1);
  assert.equal(alert(), phase >= GAP ? 0 : 1);
});

test('a backwards clock step holds the state until the clock catches up', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const alert = deterministic(GAP, FIRING);
  t.mock.timers.tick(GAP);
  assert.equal(alert(), 1); // firing; the next transition is at START + GAP + FIRING
  t.mock.timers.setTime(START); // an NTP correction steps the clock back to the start
  assert.equal(alert(), 1); // the state is held, not recomputed from the clock
  t.mock.timers.tick(GAP + FIRING - 1);
  assert.equal(alert(), 1); // one ms short of the pending transition
  t.mock.timers.tick(1);
  assert.equal(alert(), 0); // the clock caught up and the schedule resumed
});

test('with the defaults the first firing starts within [min, max] of construction', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const alert = syntheticAlert();
  t.mock.timers.tick(DEFAULT_MIN_INTERVAL - 1);
  assert.equal(alert(), 0, 'fired before the min interval');
  // Sample every half firing so a whole firing cannot slip between samples.
  const step = DEFAULT_FIRING_DURATION / 2;
  let elapsed = DEFAULT_MIN_INTERVAL - 1;
  while (alert() === 0) {
    assert.ok(elapsed <= DEFAULT_MAX_INTERVAL, 'no firing by the max interval');
    t.mock.timers.tick(step);
    elapsed += step;
  }
});
