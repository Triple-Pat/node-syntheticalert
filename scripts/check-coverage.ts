/**
 * The 100% coverage gate, as a separate step so CI can upload the measured
 * number to Coveralls first: the badge then shows the real figure even when
 * this gate fails. Reads the lcov report the test run wrote and requires
 * every line, branch, and function found to be hit.
 *
 * lcov is a line-oriented format: each SF: record carries LF/LH (lines found
 * and hit), BRF/BRH (branches), and FNF/FNH (functions) totals.
 */
import { readFileSync } from 'node:fs';

const path = process.argv[2] ?? 'coverage/lcov.info';
const totals = { LF: 0, LH: 0, BRF: 0, BRH: 0, FNF: 0, FNH: 0 };
for (const line of readFileSync(path, 'utf8').split('\n')) {
  const match = /^(LF|LH|BRF|BRH|FNF|FNH):(\d+)$/.exec(line);
  if (match) {
    totals[match[1] as keyof typeof totals] += Number(match[2]);
  }
}

const short: string[] = [];
for (const [name, found, hit] of [
  ['lines', totals.LF, totals.LH],
  ['branches', totals.BRF, totals.BRH],
  ['functions', totals.FNF, totals.FNH],
] as const) {
  console.log(`${name}: ${hit}/${found}`);
  if (hit < found) {
    short.push(`${name} ${hit}/${found}`);
  }
}
if (totals.LF === 0) {
  short.push(`no lines found in ${path}`);
}
if (short.length > 0) {
  console.error(`coverage below 100%: ${short.join(', ')}`);
  process.exit(1);
}
