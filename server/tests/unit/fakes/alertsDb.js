'use strict';

/**
 * In-memory stand-in for the database used by the alert engine unit tests
 * (US11-T6, US12-T3). It answers only the statements that
 * alerts/service.evaluateMeasurement sends, so the evaluation logic can be
 * tested without PostgreSQL.
 */

const THRESHOLDS = {
  soil_moisture: { id: 'thr-sm', min_value: 60, max_value: 80, unit: '%' },
  temperature: { id: 'thr-tmp', min_value: 15, max_value: 25, unit: 'C' },
  light: { id: 'thr-lux', min_value: 10000, max_value: 40000, unit: 'lux' },
};

function createAlertsDb() {
  const state = { alerts: [], thresholds: { ...THRESHOLDS }, seq: 0 };
  const isOpen = (a) => a.status === 'OPEN' || a.status === 'ACKNOWLEDGED';

  function exec(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ');

    if (s.includes('FROM thresholds t')) {
      const t = state.thresholds[params[1]];
      return { rows: t ? [{ ...t, sensor_type: params[1] }] : [], rowCount: t ? 1 : 0 };
    }

    if (s.startsWith('UPDATE alerts SET status = \'RESOLVED\'')) {
      const [sensorId, keepType] = params;
      const opposite = s.includes('type <> $2');
      const hit = state.alerts.filter((a) => a.sensor_id === sensorId && ['LOW', 'HIGH'].includes(a.type)
        && isOpen(a) && (!opposite || a.type !== keepType));
      for (const a of hit) { a.status = 'RESOLVED'; a.resolved_at = new Date(); }
      return { rows: hit.map((a) => ({ id: a.id })), rowCount: hit.length };
    }

    if (s.startsWith('SELECT * FROM alerts WHERE sensor_id = $1 AND type = $2')) {
      const a = state.alerts.find((x) => x.sensor_id === params[0] && x.type === params[1] && isOpen(x));
      return { rows: a ? [{ ...a }] : [], rowCount: a ? 1 : 0 };
    }

    if (s.startsWith('UPDATE alerts SET value = $1')) {
      const [value, deviation, severity, message, id] = params;
      const a = state.alerts.find((x) => x.id === id);
      Object.assign(a, { value, deviation_pct: deviation, severity, message });
      return { rows: [{ ...a }], rowCount: 1 };
    }

    if (s.startsWith('INSERT INTO alerts')) {
      const [sensorId, areaId, thresholdId, type, value, severity, message, deviation] = params;
      state.seq += 1;
      const a = {
        id: `alr-${state.seq}`, sensor_id: sensorId, area_id: areaId, threshold_id: thresholdId, type, value,
        severity, message, deviation_pct: deviation, status: 'OPEN', created_at: new Date(), resolved_at: null,
      };
      state.alerts.push(a);
      return { rows: [{ ...a }], rowCount: 1 };
    }

    throw new Error(`fake db: unexpected statement: ${s.slice(0, 80)}`);
  }

  return {
    state,
    query: async (sql, params) => exec(sql, params),
    rows: async (sql, params) => exec(sql, params).rows,
    one: async (sql, params) => exec(sql, params).rows[0] || null,
    reset() { state.alerts = []; state.thresholds = { ...THRESHOLDS }; state.seq = 0; },
  };
}

module.exports = { createAlertsDb };
