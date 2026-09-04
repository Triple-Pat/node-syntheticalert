import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';
import { START, deterministic } from './helpers.ts';

/**
 * A pull reader with no exporter and no timers: the test calls `collect()`
 * itself. (The JS SDK has no in-memory reader, only an in-memory exporter
 * behind a periodic reader.)
 */
class PullReader extends MetricReader {
  protected override async onForceFlush(): Promise<void> {
    // Nothing buffered.
  }
  protected override async onShutdown(): Promise<void> {
    // Nothing to release.
  }
}

/** Collects once and returns the single gauge's single data point. */
async function latest(reader: MetricReader): Promise<number> {
  const { resourceMetrics, errors } = await reader.collect();
  assert.deepEqual(errors, []);
  const metric = resourceMetrics.scopeMetrics[0]?.metrics[0];
  assert.ok(metric, 'no metric collected');
  assert.equal(metric.descriptor.name, 'triplepat.synthetic.alert');
  const point = metric.dataPoints[0];
  assert.ok(point, 'no data point collected');
  assert.ok(typeof point.value === 'number', 'gauge value is not a number');
  return point.value;
}

test('an OpenTelemetry observable gauge callback observes the alert', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const alert = deterministic(60_000, 10_000);
  const reader = new PullReader();
  const provider = new MeterProvider({ readers: [reader] });
  try {
    // The README snippet.
    const gauge = provider.getMeter('test').createObservableGauge('triplepat.synthetic.alert', {
      description: 'Set to 1 when the synthetic alert should fire and 0 otherwise.',
    });
    gauge.addCallback((result) => result.observe(alert()));

    assert.equal(await latest(reader), 0);
    t.mock.timers.tick(60_000);
    assert.equal(await latest(reader), 1);
    t.mock.timers.tick(10_000);
    assert.equal(await latest(reader), 0);
  } finally {
    await provider.shutdown();
  }
});
