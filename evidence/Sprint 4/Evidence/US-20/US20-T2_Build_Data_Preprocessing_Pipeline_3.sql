-- Readings removed from the input (flagged as sensor faults in the last 24 h)
SELECT m.sensor_id, COUNT(*)::int AS removed FROM measurements m JOIN sensors s ON s.id = m.sensor_id WHERE s.area_id = 'AREA-1' AND m.is_anomaly AND m.recorded_at > NOW() - INTERVAL '24 hours' GROUP BY m.sensor_id
