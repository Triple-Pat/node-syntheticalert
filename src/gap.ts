/**
 * Draws one silent gap from the exponential distribution with the given mean,
 * truncated to [min, max], by inverse-CDF sampling: pick a uniform point
 * within the probability mass the exponential puts on the window, then map it
 * back through the exponential's quantile function. One draw, exact shape,
 * and the bounds hold literally.
 *
 * This is deliberately bespoke and single-use, per the series philosophy of
 * reimplementing the memoryless sampler in each library. It is not part of
 * the public API: package.json's exports map hides this module from
 * consumers.
 */
export function truncatedExponential(mean: number, min: number, max: number): number {
  // Work with the survival function S(x) = exp(-x / mean), which is strictly
  // positive at min (min <= mean, so the exponent is at least -1) but
  // underflows to exactly 0 when max is hundreds of means away. Math.random()
  // is in [0, 1), so 1 - Math.random() is in (0, 1] and u lands in
  // (sMax, sMin]: never equal to sMax, so Math.log never sees 0.
  const sMax = Math.exp(-max / mean);
  const sMin = Math.exp(-min / mean);
  const u = sMax + (1 - Math.random()) * (sMin - sMax);
  const gap = -mean * Math.log(u);
  // Mathematically gap is already in [min, max): this is not clamping a
  // distribution, it corrects the few ulps by which exp followed by log can
  // miss a round trip, so the bounds hold literally rather than to within
  // floating-point rounding.
  return Math.min(Math.max(gap, min), max);
}
