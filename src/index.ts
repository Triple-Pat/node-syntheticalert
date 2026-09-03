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
 * Rejects anything a JavaScript caller might pass that is not a positive,
 * finite number: a TypeError for the wrong type, a RangeError for a number
 * out of range. NaN compares false to everything, so the isFinite check is
 * what catches it.
 */
function assertPositiveFinite(name: string, value: unknown): asserts value is number {
  if (typeof value !== 'number') {
    throw new TypeError(`${name} must be a number, got ${typeof value}`);
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be positive and finite, got ${value}`);
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
 * @throws {RangeError} if an option is not a positive finite number, the
 *   firing duration is not less than the mean interval, or the min and max
 *   intervals do not bracket the mean.
 */
export function syntheticAlert(options: SyntheticAlertOptions = {}): () => number {
  const mean = options.meanInterval ?? DEFAULT_MEAN_INTERVAL;
  const min = options.minInterval ?? DEFAULT_MIN_INTERVAL;
  const max = options.maxInterval ?? DEFAULT_MAX_INTERVAL;
  const firingDuration = options.firingDuration ?? DEFAULT_FIRING_DURATION;
  assertPositiveFinite('mean interval', mean);
  assertPositiveFinite('min interval', min);
  assertPositiveFinite('max interval', max);
  assertPositiveFinite('firing duration', firingDuration);
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
  return () => 0;
}
