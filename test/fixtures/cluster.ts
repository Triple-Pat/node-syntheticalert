// Runs the README's cluster recipe (MODE=recipe) or the per-worker mistake
// it warns about (MODE=per-worker) with real cluster workers, scrapes the
// primary's /metrics, and prints what the scrapes saw as JSON. A fixture
// rather than a test, because cluster.fork() re-runs this file in every
// worker.
import cluster from 'node:cluster';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { ClusterRegistry, Counter, Gauge } from '@prometheus-io/client';
import { syntheticAlert } from '../../src/index.ts';

const WORKERS = 4;
const SCRAPES = 100;

// Fast enough that a two-second scrape loop sees many firings; memoryless
// gaps so per-worker schedules drift apart instead of firing in step.
function registerAlert(): void {
  const alert = syntheticAlert({
    meanInterval: 300,
    minInterval: 50,
    maxInterval: 1_000,
    firingDuration: 200,
  });
  new Gauge({
    name: 'triplepat_synthetic_alert',
    help: 'Set to 1 when the synthetic alert should fire and 0 otherwise.',
    collect() {
      this.set(alert());
    },
  });
}

function sample(body: string, name: string): string {
  const line = body.split('\n').find((l) => l.startsWith(`${name} `));
  return line?.split(' ')[1] ?? 'absent';
}

const mode = process.env.MODE;

// Before the branch, as the client requires: the constructor installs the
// IPC listener in every process.
const registry = new ClusterRegistry();

if (cluster.isPrimary) {
  if (mode === 'recipe') registerAlert();
  const server = http.createServer((_req, res) => {
    registry.clusterMetrics().then(
      (metrics) => {
        res.setHeader('Content-Type', registry.contentType);
        res.end(metrics);
      },
      (err: unknown) => {
        res.statusCode = 500;
        res.end(String(err));
      },
    );
  });
  server.listen(0, '127.0.0.1', () => {
    void (async () => {
      const { port } = server.address() as AddressInfo;
      let online = 0;
      cluster.on('online', () => online++);
      for (let i = 0; i < WORKERS; i++) cluster.fork();
      while (online < WORKERS) await sleep(10);
      // Let every worker announce itself to the primary's registry.
      await sleep(500);

      const values: Record<string, number> = {};
      let workerCounter = 'absent';
      for (let i = 0; i < SCRAPES; i++) {
        const body = await (await fetch(`http://127.0.0.1:${port}/metrics`)).text();
        const value = sample(body, 'triplepat_synthetic_alert');
        values[value] = (values[value] ?? 0) + 1;
        workerCounter = sample(body, 'app_requests_total');
        await sleep(20);
      }
      console.log(JSON.stringify({ values, workerCounter }));
      for (const worker of Object.values(cluster.workers ?? {})) worker?.kill();
      server.close();
    })();
  });
} else {
  if (mode === 'per-worker') registerAlert();
  new Counter({ name: 'app_requests_total', help: 'Requests served.' }).inc();
  // Stay up until the primary kills this worker.
  setInterval(() => undefined, 60_000);
}
