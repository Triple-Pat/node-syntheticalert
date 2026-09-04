/**
 * A time-based callback to drive a synthetic alert metric, so a Triple Pat
 * check-in timer (https://triplepat.com) can verify your alerting pipeline
 * end to end.
 *
 * A broken alerting pipeline looks exactly like a healthy system. The callback
 * returned by {@link syntheticAlert} is 1 while a synthetic alert should be
 * firing and 0 otherwise, on a memoryless schedule. Hand it to whichever
 * metrics client you already use as a gauge callback, alert on the gauge, and
 * route that alert to a Triple Pat check-in timer. Every delivered alert
 * becomes a check-in, and the timer raises an alarm if the alerts stop
 * arriving, which is the one failure your alerting system cannot report about
 * itself.
 *
 * prom-client:
 *
 * ```ts
 * const alert = syntheticAlert();
 * new Gauge({ name: 'triplepat_synthetic_alert', help: '...', collect() { this.set(alert()); } });
 * ```
 *
 * OpenTelemetry:
 *
 * ```ts
 * meter.createObservableGauge('triplepat.synthetic.alert').addCallback((result) => result.observe(alert()));
 * ```
 *
 * The library owns no metric, starts no timer, and has no dependencies.
 *
 * @packageDocumentation
 */
import { truncatedExponential } from './gap.ts';

/** Default mean silent gap between firings, in milliseconds: one hour. */
export const DEFAULT_MEAN_INTERVAL = 3_600_000;
/** Default lower bound on the silent gap, in milliseconds: ten minutes. */
export const DEFAULT_MIN_INTERVAL = 600_000;
/** Default upper bound on the silent gap, in milliseconds: two hours. */
export const DEFAULT_MAX_INTERVAL = 7_200_000;
/** Default length of each firing, in milliseconds: ten minutes. */
export const DEFAULT_FIRING_DURATION = 600_000;

/**
 * Options for {@link syntheticAlert}. All durations are in milliseconds.
 *
 * The max bound exists because an unbounded exponential distribution
 * occasionally produces gaps long enough to false-alarm the check-in timer
 * this library exists to feed; the min bound guarantees the alert visibly
 * resolves between firings.
 */
export interface SyntheticAlertOptions {
  /**
   * Mean of the exponential distribution the silent gaps are drawn from,
   * before truncation to the min and max bounds. The gap is measured from the
   * end of one firing to the start of the next. Truncation pulls the realized
   * average toward the window's interior: with the defaults it is about 49
   * minutes, not an hour. Default {@link DEFAULT_MEAN_INTERVAL}.
   */
  meanInterval?: number;
  /**
   * Lower bound on the silent gap between firings, guaranteeing the alert
   * stays resolved at least that long. Must not exceed `meanInterval`.
   * Setting min, mean, and max all equal is allowed: every gap is then exactly
   * that long and the schedule is periodic, which is pointless in production
   * but handy for deterministic debugging. Default {@link DEFAULT_MIN_INTERVAL}.
   */
  minInterval?: number;
  /**
   * Upper bound on the silent gap between firings. Must be at least
   * `meanInterval`. Default {@link DEFAULT_MAX_INTERVAL}.
   */
  maxInterval?: number;
  /**
   * How long the callback reports 1 during each firing. Must be less than
   * `meanInterval`. Default {@link DEFAULT_FIRING_DURATION}.
   */
  firingDuration?: number;
}

/**
 * Rejects anything a JavaScript caller might pass that is not a finite number
 * of at least one millisecond: a TypeError for the wrong type, a RangeError
 * for a number out of range. NaN compares false to everything, so the
 * isFinite check is what catches it.
 *
 * The 1 ms floor is not cosmetic. Date.now() is integer milliseconds, and at
 * epoch scale a double cannot resolve increments much below a microsecond, so
 * a tiny duration could leave the replay loop's `next` unchanged and spin
 * forever. With every duration at least 1 ms, the loop runs at most once per
 * elapsed millisecond.
 */
function assertDuration(name: string, value: unknown): asserts value is number {
  if (typeof value !== 'number') {
    throw new TypeError(`${name} must be a number, got ${typeof value}`);
  }
  if (!Number.isFinite(value) || value < 1) {
    throw new RangeError(`${name} must be a finite number of at least 1 ms, got ${value}`);
  }
}

/**
 * Returns a measurement callback for a synthetic alert: 1 while the alert
 * should be firing and 0 otherwise.
 *
 * Each firing holds the value at 1 for exactly the firing duration. The silent
 * gap between firings, from the end of one to the start of the next, is
 * exponentially distributed (memoryless) with the configured mean: an attempt
 * at a Poisson process, which cannot synchronize with cron jobs or scrape
 * cycles. As a nod to practicality the gap is truncated to the configured min
 * and max, which makes the process only roughly Poisson; widen the bounds to
 * get closer.
 *
 * The schedule advances lazily: nothing happens until the callback is called,
 * at which point every transition up to `Date.now()` is replayed. The first
 * firing starts one silent gap after this function returns.
 *
 * @throws {TypeError} if an option is not a number.
 * @throws {RangeError} if an option is not a finite number of at least 1 ms,
 *   the firing duration is not less than the mean interval, or the min and
 *   max intervals do not bracket the mean.
 */
export function syntheticAlert(options: SyntheticAlertOptions = {}): () => number {
  const mean = options.meanInterval ?? DEFAULT_MEAN_INTERVAL;
  const min = options.minInterval ?? DEFAULT_MIN_INTERVAL;
  const max = options.maxInterval ?? DEFAULT_MAX_INTERVAL;
  const firingDuration = options.firingDuration ?? DEFAULT_FIRING_DURATION;
  assertDuration('mean interval', mean);
  assertDuration('min interval', min);
  assertDuration('max interval', max);
  assertDuration('firing duration', firingDuration);
  if (firingDuration >= mean) {
    throw new RangeError(
      `firing duration (${firingDuration}) must be less than the mean interval (${mean})`,
    );
  }
  if (min > mean || mean > max) {
    throw new RangeError(
      `min interval (${min}) and max interval (${max}) must bracket the mean interval (${mean})`,
    );
  }
  let firing = false;
  let next = Date.now() + truncatedExponential(mean, min, max);
  return () => {
    // Why carry state and replay transitions, rather than compute the state
    // from the clock alone?
    //
    // A stateless answer to "is a firing in progress?" needs the firing times
    // to be a pure function of wall-clock time. That is possible for a plain
    // Poisson process, because it has independent increments: chop time into
    // epochs, seed a PRNG from the epoch index, draw that epoch's arrivals, and
    // check whether one falls within the last firing duration. It has a real
    // attraction, too: every replica of a service would compute the same
    // schedule and raise one alert instead of N.
    //
    // But the min and max bounds on the silent gap make each gap depend on
    // where the previous firing ended, which destroys independent increments;
    // epochs can no longer be generated in isolation. Thinning and back-filling
    // a plain Poisson stream to fake the bounds would have to peek across epoch
    // boundaries and would no longer have a distribution the tests can name.
    // The bounds exist for practical reasons (the alert must visibly resolve;
    // the check-in timer must not false-alarm), so we honor them exactly with
    // an alternating renewal process: fixed firings, i.i.d. truncated-
    // exponential gaps, and two variables of state.
    //
    // Replaying every missed transition, rather than jumping to the current
    // state, keeps the realized schedule identical whatever the scrape cadence.
    // It costs one loop iteration per elapsed transition, about fifty a day at
    // the defaults, so even a scrape after a week of silence is trivial.
    //
    // Date.now() is wall-clock time and can step. A backwards step (an NTP
    // correction) simply holds the current state until the clock passes the
    // pending transition again; a forwards step replays the skipped
    // transitions exactly as a long scrape gap does. Both are harmless.
    // Node is single-threaded, so no lock is needed; worker threads and
    // cluster workers each hold their own instance and their own schedule.
    const now = Date.now();
    while (now >= next) {
      firing = !firing;
      next += firing ? firingDuration : truncatedExponential(mean, min, max);
    }
    return firing ? 1 : 0;
  };
}
