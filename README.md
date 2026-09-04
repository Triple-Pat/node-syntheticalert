[![Lint and Test](https://github.com/Triple-Pat/node-syntheticalert/actions/workflows/ci.yml/badge.svg)](https://github.com/Triple-Pat/node-syntheticalert/actions/workflows/ci.yml) [![Coverage Status](https://coveralls.io/repos/github/Triple-Pat/node-syntheticalert/badge.svg?branch=main)](https://coveralls.io/github/Triple-Pat/node-syntheticalert?branch=main)

# node-syntheticalert

Drive a synthetic alert metric from Node.js, so a
[Triple Pat](https://triplepat.com) check-in timer can verify your alerting
pipeline end to end. Works with Prometheus and OpenTelemetry.

## Why

A broken alerting pipeline looks exactly like a healthy system. No alerts
might mean nothing is wrong, or it might mean your alerting is down, and
your alerting system is the one thing that cannot alert you about itself.

This library provides a time-based callback to drive a synthetic alert
metric. You register the callback as a gauge in your existing metrics
setup, alert on the gauge like any other metric, and route the alert to a
Triple Pat check-in timer. Every delivered alert then becomes a check-in,
and every firing is another fire drill for the whole path from metric to
notification. If the check-ins ever stop, your alerting pipeline is
broken, and the Triple Pat app raises an alarm through a separate channel
to tell you so. An example alert rule and Alertmanager route are below.

## Usage

```sh
npm install @triplepat/syntheticalert
```

The library has no dependencies and starts no timers. It is a single
function that answers the question "should the synthetic alert be firing
right now?", and you hand it to your metrics client as a gauge callback.
It is an ES module for Node 22.18 and later, where CommonJS code can
`require()` it too.

### Prometheus

Alongside your existing Prometheus client setup. The official client,
`@prometheus-io/client`, was previously published as `prom-client`, and
the same code works with both:

```js
import { Gauge } from '@prometheus-io/client';
import { syntheticAlert } from '@triplepat/syntheticalert';

const alert = syntheticAlert(); // throws only for invalid options
new Gauge({
  name: 'triplepat_synthetic_alert',
  help:
    'Set to 1 when the synthetic alert should fire and 0 otherwise. Alert on ' +
    'this metric and route the alert to a Triple Pat check-in timer to ' +
    'continuously test your alerting pipeline.',
  collect() {
    this.set(alert());
  },
});
```

### OpenTelemetry

The same callback serves OpenTelemetry. The OTel-to-Prometheus exporter
turns the dotted metric name into `triplepat_synthetic_alert`:

```js
const gauge = meter.createObservableGauge('triplepat.synthetic.alert', {
  description: 'Set to 1 when the synthetic alert should fire and 0 otherwise.',
});
gauge.addCallback((result) => result.observe(alert()));
```

### The schedule

Each firing holds the gauge at 1 for exactly 10 minutes. The silent gap
between firings, from the end of one to the start of the next, is
memoryless: exponentially distributed with a mean of one hour.

Memoryless gaps make the firings an attempt at a Poisson process, which
cannot synchronize with cron jobs or scrape cycles, and which by the
[PASTA theorem](https://en.wikipedia.org/wiki/Arrival_theorem#Theorem_for_arrivals_governed_by_a_Poisson_process)
sees your pipeline as it typically is rather than at some special moment.

As a nod to practicality the gap is truncated. It is never less than 10
minutes, so the alert visibly resolves between firings, and never more
than two hours, so the check-in timer can be sized. The truncation pulls
the realized mean gap down to about 49 minutes and makes the process only
roughly Poisson. If you need the PASTA property and can tolerate wider
variation in start times, set a lower min and a higher max, then size the
timer for the larger max. That recovers most of the Poisson behavior; for
the last few percent, use a mean much longer than the firing duration,
since the interval between firing starts is the firing plus the gap.

The schedule advances lazily, at scrape time, from `Date.now()`. If
nobody scrapes for a while, the next scrape replays every transition it
missed, so the process stays honest whatever your scrape interval.

There is no magic here: one line is a serviceable substitute, firing for
the first ten minutes of every hour:

```js
new Gauge({
  name: 'triplepat_synthetic_alert',
  help: 'A synthetic alert metric, firing ten minutes per hour.',
  collect() {
    this.set(new Date().getMinutes() < 10 ? 1 : 0);
  },
});
```

But that version fires at the top of every hour, exactly when your cron
jobs are doing something interesting. The memoryless schedule cannot
synchronize with anything, and that is the point of the library. If you
want a deterministic schedule anyway, the snippet above is all you need.

### Options

All durations are numbers, in milliseconds, of at least 1.

| Option           | Effect                                    | Default               |
| ---------------- | ----------------------------------------- | --------------------- |
| `meanInterval`   | Mean silent gap between firings           | `3_600_000` (1 hour)  |
| `minInterval`    | Lower bound on the silent gap             | `600_000` (10 min)    |
| `maxInterval`    | Upper bound on the silent gap             | `7_200_000` (2 hours) |
| `firingDuration` | How long each firing holds the gauge at 1 | `600_000` (10 min)    |

```js
const alert = syntheticAlert({ meanInterval: 30 * 60 * 1000, maxInterval: 60 * 60 * 1000 });
```

The firing duration must be shorter than the mean interval, and the min and
max intervals must bracket the mean. Bad options throw when
`syntheticAlert()` is called, never at scrape time: a `RangeError` for a
number out of range and a `TypeError` for anything that is not a number.
Setting all three intervals equal is allowed: every gap is then exactly
that long and the schedule is periodic, which is pointless in production
but handy for deterministic debugging. The defaults are exported as
`DEFAULT_MEAN_INTERVAL`, `DEFAULT_MIN_INTERVAL`, `DEFAULT_MAX_INTERVAL`, and
`DEFAULT_FIRING_DURATION`.

## Alert on the metric

```yaml
groups:
  - name: synthetic
    rules:
      - alert: SyntheticAlert
        expr: triplepat_synthetic_alert == 1
        labels:
          severity: synthetic
        annotations:
          summary: Synthetic alert exercising the alerting pipeline.
```

## Route the alert to a check-in timer

Create a check-in timer at [Triple Pat](https://triplepat.com), then point
the alert at it. Prefer email delivery: mail transfer agents queue, retry,
and try every backend listed in DNS, so a check-in email is more likely to
arrive than a single webhook request to a single destination. Send to the
same timer at both the `.com` and `.net` addresses for good measure; extra
check-ins are harmless. Merge this into your existing Alertmanager config
(the fragment assumes you already have a default receiver and working
`smtp_*` defaults):

```yaml
route:
  routes:
    - matchers:
        - alertname="SyntheticAlert"
      receiver: triplepat
      group_wait: 0s
receivers:
  - name: triplepat
    email_configs:
      - to: YOUR-TIMER-UUID@checkin.triplepat.com
        send_resolved: false
      - to: YOUR-TIMER-UUID@checkin.triplepat.net
        send_resolved: false
```

`send_resolved: false` keeps the resolve notification from counting as an
extra check-in, so each firing checks in when it starts and not again when
it resolves.

If you cannot send email, deliver the alert as a webhook instead:

```yaml
receivers:
  - name: triplepat
    webhook_configs:
      - url: https://triplepat.com/api/v1/checkin/YOUR-TIMER-UUID
        send_resolved: false
```

## Sizing the timer

Set the check-in timer's interval to at least
`max interval + firing duration + your alerting pipeline's latency`. With
the defaults (silent gaps of at most two hours, plus 10 minutes of
firing), a three-hour timer is comfortable.

## License

Apache-2.0. See [LICENSE](LICENSE).
