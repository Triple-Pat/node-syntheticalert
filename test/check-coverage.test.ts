import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dirname, '..', 'scripts', 'check-coverage.ts');

/** Runs the coverage gate against an lcov fixture and returns its exit status and output. */
function gate(
  name: string,
  lcov: string,
): { status: number | null; stdout: string; stderr: string } {
  const path = join(mkdtempSync(join(tmpdir(), 'check-coverage-')), name);
  writeFileSync(path, lcov);
  const result = spawnSync(process.execPath, [SCRIPT, path], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const FULL = [
  'TN:',
  'SF:src/a.ts',
  'FNF:2',
  'FNH:2',
  'BRF:4',
  'BRH:4',
  'LF:10',
  'LH:10',
  'end_of_record',
];

test('a fully covered report passes', () => {
  const { status, stdout, stderr } = gate('full.info', FULL.join('\n'));
  assert.equal(status, 0, stderr);
  assert.match(stdout, /lines: 10\/10/);
  assert.match(stdout, /branches: 4\/4/);
  assert.match(stdout, /functions: 2\/2/);
});

test('one missed branch fails and is named', () => {
  const lcov = FULL.map((l) => (l === 'BRH:4' ? 'BRH:3' : l)).join('\n');
  const { status, stderr } = gate('branch.info', lcov);
  assert.equal(status, 1);
  assert.match(stderr, /coverage below 100%: branches 3\/4/);
});

test('one missed function fails even with every line hit', () => {
  const lcov = FULL.map((l) => (l === 'FNH:2' ? 'FNH:1' : l)).join('\n');
  const { status, stderr } = gate('function.info', lcov);
  assert.equal(status, 1);
  assert.match(stderr, /coverage below 100%: functions 1\/2/);
});

test('totals are summed across records', () => {
  const second = [
    'SF:src/b.ts',
    'FNF:1',
    'FNH:1',
    'BRF:0',
    'BRH:0',
    'LF:5',
    'LH:4',
    'end_of_record',
  ];
  const { status, stderr } = gate('two.info', [...FULL, ...second].join('\n'));
  assert.equal(status, 1);
  assert.match(stderr, /lines 14\/15/);
});

test('a report with no lines fails rather than passing vacuously', () => {
  const { status, stderr } = gate('empty.info', '');
  assert.equal(status, 1);
  assert.match(stderr, /no lines found/);
});
