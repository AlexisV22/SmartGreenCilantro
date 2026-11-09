-- Repeated out-of-range readings of SM-01: one alert only
SELECT id, type, severity, status, value, created_at FROM alerts WHERE sensor_id = 'SM-01' AND status <> 'RESOLVED'
