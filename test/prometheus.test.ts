import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Gauge, Registry } from '@prometheus-io/client';
import { START, deterministic } from './helpers.ts';

test('a Prometheus client Gauge with collect() scrapes the alert', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const alert = deterministic(60_000, 10_000);
  const registry = new Registry();
  // The README snippet, plus `registers` so the test owns its registry.
  new Gauge({
    name: 'triplepat_synthetic_alert',
    help:
      'Set to 1 when the synthetic alert should fire and 0 otherwise. Alert on ' +
      'this metric and route the alert to a Triple Pat check-in timer to ' +
      'continuously test your alerting pipeline.',
    registers: [registry],
    collect() {
      this.set(alert());
    },
  });

  assert.match(await registry.metrics(), /^triplepat_synthetic_alert 0$/m);
  t.mock.timers.tick(60_000);
  assert.match(await registry.metrics(), /^triplepat_synthetic_alert 1$/m);
  t.mock.timers.tick(10_000);
  assert.match(await registry.metrics(), /^triplepat_synthetic_alert 0$/m);
});
