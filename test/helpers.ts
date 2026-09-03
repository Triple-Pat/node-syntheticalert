import { syntheticAlert } from '../src/index.ts';

/** Fake-clock origin for every schedule test: 2023-11-14T22:13:20Z, an unremarkable instant. */
export const START = 1_700_000_000_000;

/**
 * A schedule whose silent gaps are all exactly `gap` ms and whose firings last
 * exactly `firing` ms: min == mean == max makes the schedule periodic.
 */
export function deterministic(gap: number, firing: number): () => number {
  return syntheticAlert({
    meanInterval: gap,
    minInterval: gap,
    maxInterval: gap,
    firingDuration: firing,
  });
}
