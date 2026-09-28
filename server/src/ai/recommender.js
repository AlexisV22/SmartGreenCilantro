'use strict';

/**
 * Irrigation recommendation engine (US-20, FR-28, FR-30).
 *
 * Explainable by construction: the decision is a weighted sum of named
 * factors, each one keeping the measurement that produced it, so the
 * explainer can state exactly why the recommendation was made (FR-29).
 * No black box, which is what section 11 of the project document asks for.
 *
 * Score = sum of the weighted contributions, clamped to 0..100:
 *   moisture deficit, temperature above optimum, low humidity, falling
 *   moisture trend, time since the last irrigation, minus a penalty when
 *   irrigation happened recently.
 */

const trends = require('./trends');

/** Normalise a value into 0..1 over the given span. */
const ratio = (value, span) => Math.max(0, Math.min(1, value / span));

/**
 * Produce the recommendation for one area.
 *
 * @param {object} features    output of preprocessing.buildFeatures
 * @param {object} context
 * @param {object} context.thresholds  { soil_moisture, temperature, air_humidity }
 * @param {object} context.irrigation  irrigation_config row
 * @param {object} context.aiConfig    ai_config row
 */
function recommend(features, context) {
  const { thresholds, irrigation, aiConfig } = context;

  const soilThreshold = thresholds.soil_moisture || null;
  const tempThreshold = thresholds.temperature || null;
  const humidityThreshold = thresholds.air_humidity || null;

  const target = Number(irrigation.target_moisture);
  const maxDuration = Number(irrigation.max_duration_min);
  const cooldownMin = Number(irrigation.cooldown_min);
  const minTank = Number(irrigation.min_tank_level);

  const factors = [];
  let score = 0;

  const addFactor = (key, label, contribution, detail) => {
    if (contribution === 0) return;
    score += contribution;
    factors.push({
      key,
      label,
      contribution: Number(contribution.toFixed(2)),
      ...detail,
    });
  };

  // --- 1. Soil-moisture deficit relative to the target --------------------
  const moisture = features.soil_moisture;
  if (moisture !== null && Number.isFinite(moisture)) {
    const deficit = Math.max(0, target - moisture);
    // A deficit of 20 points or more saturates this factor.
    const weighted = Number(aiConfig.weight_moisture_deficit) * ratio(deficit, 20);
    addFactor('moisture_deficit', 'Soil moisture below the target', weighted, {
      value: Number(moisture.toFixed(1)),
      target,
      deficit: Number(deficit.toFixed(1)),
      unit: '%',
    });
  }

  // --- 2. Temperature above the optimal maximum ---------------------------
  const temperature = features.temperature;
  if (temperature !== null && tempThreshold) {
    const excess = Math.max(0, temperature - Number(tempThreshold.max_value));
    const weighted = Number(aiConfig.weight_temperature) * ratio(excess, 8);
    addFactor('temperature_high', 'Temperature above the optimal range', weighted, {
      value: Number(temperature.toFixed(1)),
      max: Number(tempThreshold.max_value),
      excess: Number(excess.toFixed(1)),
      unit: 'C',
    });
  }

  // --- 3. Low relative humidity increases evaporation ---------------------
  const humidity = features.air_humidity;
  if (humidity !== null && humidityThreshold) {
    const shortfall = Math.max(0, Number(humidityThreshold.min_value) - humidity);
    const weighted = Number(aiConfig.weight_humidity) * ratio(shortfall, 20);
    addFactor('humidity_low', 'Relative humidity below the optimal range', weighted, {
      value: Number(humidity.toFixed(1)),
      min: Number(humidityThreshold.min_value),
      shortfall: Number(shortfall.toFixed(1)),
      unit: '%',
    });
  }

  // --- 4. Falling moisture trend ------------------------------------------
  const moistureTrend = trends.analyse(features.series.moisture, soilThreshold, 0.05);
  if (moistureTrend.direction === 'FALLING' && moistureTrend.slope_per_hour !== null) {
    // A fall of 2 points per hour or faster saturates this factor.
    const weighted = Number(aiConfig.weight_trend) * ratio(Math.abs(moistureTrend.slope_per_hour), 2);
    addFactor('moisture_falling', 'Soil moisture is falling', weighted, {
      slope_per_hour: moistureTrend.slope_per_hour,
      hours_to_threshold: moistureTrend.hours_to_threshold,
      unit: '%/h',
    });
  }

  // --- 5. Time since the last irrigation ----------------------------------
  const hoursSince = features.hours_since_irrigation;
  if (hoursSince !== null) {
    // 12 hours without irrigating saturates this factor.
    const weighted = Number(aiConfig.weight_time_since_irrigation) * ratio(hoursSince, 12);
    addFactor('time_since_irrigation', 'Time elapsed since the last irrigation', weighted, {
      hours: Number(hoursSince.toFixed(1)),
      unit: 'h',
    });
  } else {
    // Never irrigated: treat it as a full interval.
    addFactor('time_since_irrigation', 'No irrigation has been recorded yet',
      Number(aiConfig.weight_time_since_irrigation), { hours: null, unit: 'h' });
  }

  // --- 6. Penalty when irrigation happened inside the cooldown ------------
  if (hoursSince !== null && hoursSince * 60 < cooldownMin) {
    const penalty = -Number(aiConfig.penalty_recent_irrigation);
    addFactor('recent_irrigation', 'Irrigation happened recently (cooldown active)', penalty, {
      hours: Number(hoursSince.toFixed(2)),
      cooldown_min: cooldownMin,
      unit: 'h',
    });
  }

  score = Math.max(0, Math.min(100, score));

  // --- Confidence ---------------------------------------------------------
  // data completeness x sensor agreement x (1 - anomaly ratio)
  const dataCompleteness = features.completeness.overall;

  const spread = features.sensor_spread_pct;
  const disagreementLimit = Number(aiConfig.sensor_disagreement_pct);
  const agreement = features.soil_sensor_count >= 2
    ? Math.max(0, 1 - (spread / Math.max(disagreementLimit * 2, 1)))
    : 0.8; // a single probe cannot be cross-checked

  const anomalyRatio = Math.min(1, features.anomaly_count_last_hour / 10);
  const confidence = Math.max(0, Math.min(1, dataCompleteness * agreement * (1 - anomalyRatio)));

  // --- Decision rules -----------------------------------------------------
  let type;
  let recommendedDuration = null;

  const soilSensorsUnreliable = features.soil_sensor_anomalies > 0
    || (features.soil_sensor_count >= 2 && spread > disagreementLimit);

  const tankLow = features.tank_level !== null && features.tank_level < minTank;

  // Below the agronomic minimum the crop needs water now: the same condition
  // raises the LOW alert (US-11) and starts the automatic engine (US-16), so
  // the recommender must not wait for the weighted score to reach its
  // threshold. The score still anticipates irrigation above the minimum
  // (hot, dry air, falling trend). Right after an irrigation (cooldown) the
  // water is still percolating, so no new irrigation is proposed.
  const belowMinimum = moisture !== null && soilThreshold !== null
    && moisture < Number(soilThreshold.min_value);
  const inCooldown = hoursSince !== null && hoursSince * 60 < cooldownMin;

  const temperatureHigh = temperature !== null && tempThreshold
    && temperature > Number(tempThreshold.max_value);
  const humidityHigh = humidity !== null && humidityThreshold
    && humidity > Number(humidityThreshold.max_value);

  if (soilSensorsUnreliable) {
    // Never irrigate on data that cannot be trusted.
    type = 'CHECK_SENSOR';
  } else if (tankLow) {
    type = 'CHECK_WATER';
  } else if (!inCooldown && (belowMinimum || score >= Number(aiConfig.irrigate_score_threshold))) {
    type = 'IRRIGATE';
    const deficit = moisture === null ? 0 : Math.max(0, target - moisture);
    recommendedDuration = Math.min(
      maxDuration,
      Math.max(1, Math.round(deficit * Number(aiConfig.duration_factor) * 10) / 10),
    );
  } else if (temperatureHigh && humidityHigh) {
    type = 'VENTILATE';
  } else {
    type = 'WAIT';
  }

  factors.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  return {
    type,
    below_minimum: belowMinimum,
    score: Number(score.toFixed(2)),
    confidence: Number(confidence.toFixed(4)),
    recommended_duration_min: recommendedDuration,
    factors,
    trend: moistureTrend,
    inputs: {
      soil_moisture: moisture,
      temperature,
      air_humidity: humidity,
      tank_level: features.tank_level,
      hours_since_irrigation: hoursSince,
      sensor_values: features.sensor_values,
      sensor_spread_pct: Number(spread.toFixed(2)),
      anomaly_count_last_hour: features.anomaly_count_last_hour,
      soil_sensor_anomalies: features.soil_sensor_anomalies,
      target_moisture: target,
      data_completeness: Number(dataCompleteness.toFixed(3)),
      sensor_agreement: Number(agreement.toFixed(3)),
      thresholds: {
        soil_moisture: soilThreshold
          ? { min: Number(soilThreshold.min_value), max: Number(soilThreshold.max_value) } : null,
        temperature: tempThreshold
          ? { min: Number(tempThreshold.min_value), max: Number(tempThreshold.max_value) } : null,
        air_humidity: humidityThreshold
          ? { min: Number(humidityThreshold.min_value), max: Number(humidityThreshold.max_value) } : null,
      },
    },
  };
}

module.exports = { recommend };
