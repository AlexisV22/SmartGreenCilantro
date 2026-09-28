'use strict';

/**
 * Natural-language explanation of a recommendation (US-21, FR-29).
 *
 * Section 11 of the project document requires five elements in every
 * recommendation, and this module always produces all five:
 *
 *   1. Recommendation          what to do
 *   2. Reason                  why, from the top contributing factors
 *   3. Relevant measurements   the readings that drove the decision
 *   4. Confidence              a 0..1 value plus a High/Medium/Low wording
 *   5. Timestamp               when it was produced
 *
 * The text is generated from deterministic templates. When an Anthropic API
 * key is configured and `ai_config.llm_enabled` is true, the reason sentence
 * is reworded by Claude for fluency — but the template result is always kept
 * as the fallback, so the platform behaves identically without a key, and any
 * API failure is invisible to the producer (US21-T2).
 */

const config = require('../config');
const { logSystem } = require('../utils/logger');

/** Wording of the confidence indicator (NFR-06: never a bare number). */
function confidenceText(confidence) {
  if (confidence >= 0.75) return 'High';
  if (confidence >= 0.45) return 'Medium';
  return 'Low';
}

/** Short, human-readable label for an area. */
function areaLabel(areaId) {
  const match = /^AREA-(\d+)$/i.exec(areaId);
  return match ? `Area ${match[1]}` : areaId;
}

/** One-line headline per recommendation type. */
function headlineFor(type, areaId, durationMin) {
  const area = areaLabel(areaId);
  switch (type) {
    case 'IRRIGATE':
      return durationMin
        ? `Irrigation is recommended for ${area} for approximately ${durationMin} minutes.`
        : `Irrigation is recommended for ${area}.`;
    case 'CHECK_WATER':
      return `Check the water supply of ${area} before irrigating.`;
    case 'CHECK_SENSOR':
      return `Check the soil-moisture sensors of ${area} before taking any irrigation decision.`;
    case 'VENTILATE':
      return `Ventilation is recommended for ${area}.`;
    case 'WAIT':
    default:
      return `No action is needed in ${area} for now.`;
  }
}

/** Turn one scoring factor into a readable clause. */
function factorClause(factor) {
  switch (factor.key) {
    case 'moisture_deficit':
      return `soil moisture (${factor.value} %) is below the configured target (${factor.target} %)`;
    case 'temperature_high':
      return `the current temperature is high (${factor.value} °C, above the optimal maximum of ${factor.max} °C)`;
    case 'humidity_low':
      return `relative humidity is low (${factor.value} %, below the optimal minimum of ${factor.min} %)`;
    case 'moisture_falling':
      return factor.hours_to_threshold !== null && factor.hours_to_threshold !== undefined
        ? `soil moisture is falling at ${Math.abs(factor.slope_per_hour)} %/h and would reach the minimum in about ${factor.hours_to_threshold} h`
        : `soil moisture is falling at ${Math.abs(factor.slope_per_hour)} %/h`;
    case 'time_since_irrigation':
      return factor.hours === null
        ? 'no irrigation has been recorded for this area yet'
        : `the last irrigation was ${factor.hours} hours ago`;
    case 'recent_irrigation':
      return `irrigation already ran ${factor.hours} hours ago and the ${factor.cooldown_min}-minute cooldown is still active`;
    default:
      return factor.label.toLowerCase();
  }
}

/** Build the "Reason" sentence from the strongest contributing factors. */
function buildReason(type, result) {
  const inputs = result.inputs;

  if (type === 'CHECK_SENSOR') {
    const values = Object.entries(inputs.sensor_values || {})
      .map(([id, value]) => `${id}: ${Number(value).toFixed(1)} %`).join(', ');
    return inputs.soil_sensor_anomalies > 0
      ? `The soil-moisture sensors reported ${inputs.soil_sensor_anomalies} abnormal reading(s) in the last hour, so the data is not reliable enough to decide on irrigation (${values}).`
      : `The soil-moisture sensors disagree by ${inputs.sensor_spread_pct} percentage points (${values}), which is more than the tolerance configured for this greenhouse. One of the probes may be faulty or badly positioned.`;
  }

  if (type === 'CHECK_WATER') {
    return `The water tank is at ${inputs.tank_level} %, below the minimum level required to irrigate safely. Refill the tank before starting irrigation.`;
  }

  if (type === 'VENTILATE') {
    return `Temperature (${inputs.temperature} °C) and relative humidity (${inputs.air_humidity} %) are both above their optimal ranges, which favours fungal problems in cilantro. Ventilating reduces both at the same time.`;
  }

  // IRRIGATE and WAIT are explained from their strongest positive factors.
  const positives = result.factors.filter((f) => f.contribution > 0).slice(0, 3);

  if (type === 'IRRIGATE') {
    const soilRange = inputs.thresholds && inputs.thresholds.soil_moisture;
    const clauses = positives.map((f) => (f.key === 'moisture_deficit' && result.below_minimum && soilRange
      ? `soil moisture (${f.value} %) is below the optimal minimum of ${soilRange.min} % (target ${f.target} %)`
      : factorClause(f)));
    const joined = clauses.length > 1
      ? `${clauses.slice(0, -1).join(', ')} and ${clauses[clauses.length - 1]}`
      : (clauses[0] || 'the configured irrigation conditions are met');
    return `Irrigation should be considered for ${areaLabel(result.area_id || inputs.area_id || '')} because ${joined}. Verify water availability before activating the irrigation system.`.replace('  ', ' ');
  }

  // WAIT
  const negative = result.factors.find((f) => f.contribution < 0);
  if (negative) {
    return `No irrigation is needed right now because ${factorClause(negative)}. Soil moisture is ${inputs.soil_moisture === null ? 'not available' : `${Number(inputs.soil_moisture).toFixed(1)} %`} against a target of ${inputs.target_moisture} %.`;
  }
  const soil = inputs.thresholds && inputs.thresholds.soil_moisture;
  if (soil && inputs.soil_moisture !== null && inputs.soil_moisture > soil.max) {
    return `Soil moisture is ${Number(inputs.soil_moisture).toFixed(1)} %, above the optimal maximum of ${soil.max} %. Do not irrigate: excess water can cause root rot in cilantro.`;
  }
  return `Conditions are inside the expected range: soil moisture is ${inputs.soil_moisture === null ? 'not available' : `${Number(inputs.soil_moisture).toFixed(1)} %`} against a target of ${inputs.target_moisture} %, and the overall irrigation-need score is ${result.score} out of 100, below the threshold that would justify irrigating.`;
}

/** The readings that justify the recommendation, for the card and the audit. */
function buildRelevantMeasurements(result) {
  const inputs = result.inputs;
  const items = [];

  if (inputs.soil_moisture !== null && inputs.soil_moisture !== undefined) {
    items.push({
      label: 'Soil moisture',
      value: Number(inputs.soil_moisture.toFixed(1)),
      unit: '%',
      target: inputs.target_moisture,
      range: inputs.thresholds.soil_moisture,
    });
  }
  if (inputs.temperature !== null && inputs.temperature !== undefined) {
    items.push({
      label: 'Air temperature',
      value: Number(inputs.temperature.toFixed(1)),
      unit: '°C',
      range: inputs.thresholds.temperature,
    });
  }
  if (inputs.air_humidity !== null && inputs.air_humidity !== undefined) {
    items.push({
      label: 'Relative humidity',
      value: Number(inputs.air_humidity.toFixed(1)),
      unit: '%',
      range: inputs.thresholds.air_humidity,
    });
  }
  if (inputs.tank_level !== null && inputs.tank_level !== undefined) {
    items.push({ label: 'Water tank level', value: Number(inputs.tank_level.toFixed(1)), unit: '%' });
  }
  if (inputs.hours_since_irrigation !== null && inputs.hours_since_irrigation !== undefined) {
    items.push({ label: 'Time since last irrigation', value: Number(inputs.hours_since_irrigation.toFixed(1)), unit: 'h' });
  }

  return items;
}

/**
 * Optional rewording through the Claude API.
 *
 * Uses the official Anthropic SDK, loaded lazily so the platform runs without
 * the optional dependency installed. Any failure — missing package, missing
 * key, network error, refusal — returns null and the template text stands.
 */
async function rewordWithClaude(templateReason, headline, aiConfig) {
  if (!aiConfig.llm_enabled || !config.ai.anthropicApiKey) return null;

  let Anthropic;
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    Anthropic = require('@anthropic-ai/sdk');
  } catch {
    logSystem('INFO', 'explainer',
      'LLM rewording is enabled but @anthropic-ai/sdk is not installed; using the template explanation.');
    return null;
  }

  try {
    const client = new Anthropic({ apiKey: config.ai.anthropicApiKey });

    const response = await client.messages.create({
      model: aiConfig.llm_model || config.ai.anthropicModel,
      // The output is one short paragraph; a small cap keeps it that way.
      max_tokens: 1024,
      output_config: { effort: 'low' },
      system: 'You rewrite greenhouse advisories for cilantro producers who are not technical. '
        + 'Keep every number and unit exactly as given, never add facts, never give medical or '
        + 'financial advice, and answer with the rewritten paragraph only — no preamble.',
      messages: [{
        role: 'user',
        content: `Rewrite this advisory in at most three plain sentences, keeping all figures identical.\n\n`
          + `Recommendation: ${headline}\nReason: ${templateReason}`,
      }],
    });

    if (response.stop_reason === 'refusal') {
      logSystem('WARN', 'explainer', 'The model declined to reword the advisory; using the template.');
      return null;
    }

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    return text.length ? text : null;
  } catch (err) {
    logSystem('WARN', 'explainer', `LLM rewording failed (${err.message}); using the template explanation.`);
    return null;
  }
}

/**
 * Build the five explanation elements for a recommendation result.
 *
 * @param {object} result   output of recommender.recommend
 * @param {string} areaId
 * @param {object} aiConfig ai_config row
 */
async function explain(result, areaId, aiConfig) {
  const enriched = { ...result, area_id: areaId };

  const recommendation = headlineFor(result.type, areaId, result.recommended_duration_min);
  const templateReason = buildReason(result.type, enriched);
  const relevantMeasurements = buildRelevantMeasurements(enriched);
  const confidence = result.confidence;

  const reworded = await rewordWithClaude(templateReason, recommendation, aiConfig);

  return {
    // 1. Recommendation
    recommendation,
    // 2. Reason (LLM-reworded when available, template otherwise)
    reason: reworded || templateReason,
    reason_source: reworded ? 'llm' : 'template',
    // 3. Relevant sensor measurements
    relevant_measurements: relevantMeasurements,
    // 4. Confidence indicator, as a value and as words
    confidence,
    confidence_text: confidenceText(confidence),
    // 5. Timestamp
    timestamp: new Date().toISOString(),
  };
}

module.exports = { explain, confidenceText, headlineFor, buildReason, buildRelevantMeasurements, areaLabel };
