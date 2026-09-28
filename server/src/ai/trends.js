'use strict';

/**
 * Trend identification (US18-T3, FR-26).
 *
 * A least-squares regression over the resampled series gives the slope in
 * units per hour. The slope is classified with a configurable tolerance so
 * sensor noise is not reported as a trend, and the time remaining until the
 * variable reaches its threshold is projected linearly.
 */

/**
 * Least-squares slope of a { t, value } series, expressed in units per hour.
 * Returns null when there is not enough data.
 */
function linearSlopePerHour(series) {
  const points = series
    .filter((s) => s.value !== null && Number.isFinite(s.value))
    .map((s) => ({ x: new Date(s.t).getTime() / 3600000, y: s.value }));

  if (points.length < 3) return null;

  const n = points.length;
  const meanX = points.reduce((a, p) => a + p.x, 0) / n;
  const meanY = points.reduce((a, p) => a + p.y, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    numerator += (point.x - meanX) * (point.y - meanY);
    denominator += (point.x - meanX) ** 2;
  }

  if (denominator === 0) return null;
  return numerator / denominator;
}

/**
 * Classify a slope as RISING, FALLING or STABLE.
 * `tolerance` is expressed in units per hour.
 */
function classify(slopePerHour, tolerance = 0.05) {
  if (slopePerHour === null) return 'UNKNOWN';
  if (Math.abs(slopePerHour) <= tolerance) return 'STABLE';
  return slopePerHour > 0 ? 'RISING' : 'FALLING';
}

/**
 * Hours until the value reaches the nearest threshold bound, following the
 * current slope. Returns null when the trend never reaches a bound.
 */
function hoursToThreshold(currentValue, slopePerHour, { min, max }) {
  if (slopePerHour === null || slopePerHour === 0 || currentValue === null) return null;

  // Falling values approach the minimum; rising values approach the maximum.
  const target = slopePerHour < 0 ? Number(min) : Number(max);
  if (!Number.isFinite(target)) return null;

  const distance = target - currentValue;
  // Already past the bound, or moving away from it.
  if (distance === 0) return 0;
  if (Math.sign(distance) !== Math.sign(slopePerHour)) return null;

  return distance / slopePerHour;
}

/**
 * Full trend report for one variable.
 *
 * @param {Array}  series    resampled series from preprocessing
 * @param {object} threshold { min_value, max_value, unit }
 * @param {number} tolerance units per hour below which the trend is STABLE
 */
function analyse(series, threshold = null, tolerance = 0.05) {
  const slope = linearSlopePerHour(series);
  const direction = classify(slope, tolerance);

  const current = (() => {
    for (let i = series.length - 1; i >= 0; i -= 1) {
      if (series[i].value !== null) return series[i].value;
    }
    return null;
  })();

  const projection = threshold
    ? hoursToThreshold(current, slope, { min: threshold.min_value, max: threshold.max_value })
    : null;

  return {
    current,
    slope_per_hour: slope === null ? null : Number(slope.toFixed(4)),
    direction,
    tolerance,
    hours_to_threshold: projection === null ? null : Number(projection.toFixed(2)),
    threshold: threshold
      ? { min: Number(threshold.min_value), max: Number(threshold.max_value), unit: threshold.unit }
      : null,
  };
}

module.exports = { linearSlopePerHour, classify, hoursToThreshold, analyse };
