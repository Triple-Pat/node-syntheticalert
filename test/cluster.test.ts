import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const fixture = fileURLToPath(new URL('fixtures/cluster.ts', import.meta.url));

interface Scrapes {
  values: Record<string, number>;
  workerCounter: string;
}

async function scrape(mode: string): Promise<Scrapes> {
  const { stdout } = await promisify(execFile)(process.execPath, [fixture], {
    env: { ...process.env, MODE: mode },
    timeout: 30_000,
  });
  return JSON.parse(stdout) as Scrapes;
}

test('the README cluster recipe serves one schedule from the primary', async () => {
  const { values, workerCounter } = await scrape('recipe');
  // Only 0 and 1, both seen: one schedule, firing and resolving.
  assert.deepEqual(Object.keys(values).sort(), ['0', '1']);
  // The workers' own metrics still reach the scrape, summed across all four.
  assert.equal(workerCounter, '4');
});

test('an alert in every cluster worker is summed past 1', async () => {
  const { values } = await scrape('per-worker');
  // The failure the README warns about: an alert on == 1 misses firings.
  assert.ok(
    Object.keys(values).some((v) => Number(v) > 1),
    `expected a summed value above 1, saw ${JSON.stringify(values)}`,
  );
});
