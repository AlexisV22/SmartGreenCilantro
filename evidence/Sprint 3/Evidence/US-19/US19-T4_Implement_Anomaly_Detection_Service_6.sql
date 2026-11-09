-- Flagged measurements
SELECT m.id, m.sensor_id, m.value, m.is_anomaly, a.method FROM measurements m JOIN anomalies a ON a.measurement_id = m.id WHERE a.detected_at >= $1 ORDER BY a.detected_at
