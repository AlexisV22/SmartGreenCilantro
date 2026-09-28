'use strict';

/**
 * Periodic anomaly detection (US19-T2).
 *
 * The ingestion path already covers OUT_OF_RANGE, SUDDEN_JUMP and ZSCORE.
 * This job covers the two methods defined by absence of data — MISSING_DATA
 * and FLATLINE — which no incoming request can trigger (NFR-08).
 */

const anomalies = require('../modules/anomalies/service');
const { logSystem } = require('../utils/logger');

const NAME = 'anomalyJob';
// Every minute: fine-grained enough for a 5-minute missing-data window.
const SCHEDULE = '* * * * *';

async function run() {
  const created = await anomalies.runPeriodicChecks();
  if (created.length) {
    logSystem('WARN', NAME, `Detected ${created.length} anomaly(ies) from the periodic checks.`);
  }
  return created.length;
}

module.exports = { NAME, SCHEDULE, run };
