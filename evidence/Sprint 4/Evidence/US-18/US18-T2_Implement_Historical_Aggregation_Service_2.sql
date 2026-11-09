-- Readings flagged as sensor faults in the window (excluded from the statistics)
SELECT s.type, COUNT(*)::int AS flagged FROM measurements m JOIN sensors s ON s.id = m.sensor_id WHERE s.area_id = 'AREA-1' AND m.is_anomaly AND m.recorded_at >= $1 GROUP BY s.type
