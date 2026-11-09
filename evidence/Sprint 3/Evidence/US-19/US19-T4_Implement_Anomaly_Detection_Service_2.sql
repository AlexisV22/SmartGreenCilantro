-- Anomaly records (injected values and the silent period of US16-T4)
SELECT a.detected_at, a.sensor_id, a.method, a.value, round(a.score, 2) AS score, a.measurement_id, left(a.explanation, 90) AS explanation FROM anomalies a WHERE a.detected_at >= $1 ORDER BY a.method, a.detected_at
