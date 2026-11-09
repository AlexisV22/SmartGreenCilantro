-- Alerts created by the out-of-range cycle and resolved by the next cycle (simulator)
SELECT id, sensor_id, type, severity, status, value, created_at, resolved_at FROM alerts WHERE created_at >= $1 ORDER BY created_at
