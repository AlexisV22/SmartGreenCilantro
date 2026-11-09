-- Index on (sensor_id, recorded_at) and the other indexes of measurements
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'measurements' ORDER BY indexname
