-- Every alert created in the test has a severity
SELECT id, sensor_id, type, severity, deviation_pct, status FROM alerts WHERE id = ANY($1)
