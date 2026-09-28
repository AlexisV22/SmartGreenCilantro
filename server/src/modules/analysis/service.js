'use strict';

/**
 * Historical analysis (US-18, FR-25, FR-26).
 *
 * Metrics defined in US18-T1:
 *   * daily minimum, average and maximum per variable
 *   * percentage of time inside the optimal range
 *   * trend slope per day over 24 h and 7 days, classified with a tolerance
 *   * irrigation minutes per day
 *
 * Measurements flagged as anomalies are excluded from every aggregate, which
 * is what US18-T2 requires.
 */

const db = require('../../db');
const trends = require('../../ai/trends');
const preprocessing = require('../../ai/preprocessing');
const settings = require('../../utils/settings');
const events = require('../events/service');
const recommendationsService = require('../recommendations/service');

/**
 * GET /api/analysis/summary?area_id&from&to
 * Daily statistics plus the share of time each variable stayed in range.
 */
async function summary({ areaId, from = null, to = null }) {
  const daily = await db.rows(
    `SELECT s.type AS sensor_type,
            m.sensor_id,
            s.unit,
            date_trunc('day', m.recorded_at) AS day,
            MIN(m.value)::float            AS min_value,
            AVG(m.value)::float            AS avg_value,
            MAX(m.value)::float            AS max_value,
            COUNT(*)::int                  AS samples
       FROM measurements m
       JOIN sensors s ON s.id = m.sensor_id
      WHERE s.area_id = $1
        AND m.is_anomaly = FALSE
        AND ($2::timestamptz IS NULL OR m.recorded_at >= $2)
        AND ($3::timestamptz IS NULL OR m.recorded_at <= $3)
      GROUP BY s.type, m.sensor_id, s.unit, date_trunc('day', m.recorded_at)
      ORDER BY day ASC, s.type`,
    [areaId, from, to],
  );

  // Percentage of readings inside the optimal band, per variable.
  const inRange = await db.rows(
    `SELECT s.type AS sensor_type,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (
              WHERE m.value >= t.min_value AND m.value <= t.max_value
            )::int AS inside
       FROM measurements m
       JOIN sensors s    ON s.id = m.sensor_id
       JOIN thresholds t ON t.area_id = s.area_id AND t.sensor_type = s.type
      WHERE s.area_id = $1
        AND m.is_anomaly = FALSE
        AND ($2::timestamptz IS NULL OR m.recorded_at >= $2)
        AND ($3::timestamptz IS NULL OR m.recorded_at <= $3)
      GROUP BY s.type`,
    [areaId, from, to],
  );

  const optimalRange = inRange.map((row) => ({
    sensor_type: row.sensor_type,
    total_readings: row.total,
    readings_in_range: row.inside,
    pct_time_in_optimal_range: row.total ? Number(((row.inside / row.total) * 100).toFixed(2)) : null,
  }));

  const irrigationMinutes = await events.dailyIrrigationMinutes({ areaId, days: 30 });

  // Readings actually left out of the statistics (flagged as untrustworthy).
  const anomalyCount = await db.one(
    `SELECT COUNT(*)::int AS n
       FROM measurements m JOIN sensors s ON s.id = m.sensor_id
      WHERE s.area_id = $1 AND m.is_anomaly
        AND ($2::timestamptz IS NULL OR m.recorded_at >= $2)
        AND ($3::timestamptz IS NULL OR m.recorded_at <= $3)`,
    [areaId, from, to],
  );

  return {
    area_id: areaId,
    from,
    to,
    daily,
    optimal_range: optimalRange,
    irrigation_minutes_per_day: irrigationMinutes,
    anomalies_excluded: anomalyCount.n,
    generated_at: new Date().toISOString(),
  };
}

/**
 * GET /api/analysis/trends?area_id&window=24h|7d
 * Slope, RISING/FALLING/STABLE classification and projection to threshold.
 */
async function trendReport({ areaId, window = '24h' }) {
  const hours = window === '7d' ? 24 * 7 : 24;
  const tolerance = await settings.getNumber('analysis.trend_tolerance', 0.05);

  const features = await preprocessing.buildFeatures(areaId, hours);
  const thresholds = await recommendationsService.thresholdsFor(areaId);

  const variables = [
    { key: 'soil_moisture', series: features.series.moisture },
    { key: 'temperature', series: features.series.temperature },
    { key: 'air_humidity', series: features.series.humidity },
    { key: 'water_level', series: features.series.tank },
  ];

  const report = variables.map(({ key, series }) => ({
    sensor_type: key,
    ...trends.analyse(series, thresholds[key] || null, tolerance),
  }));

  return {
    area_id: areaId,
    window,
    window_hours: hours,
    tolerance,
    trends: report,
    generated_at: new Date().toISOString(),
  };
}

module.exports = { summary, trendReport };
