-- The valid measurement stored in the database
SELECT id, sensor_id, value, unit, recorded_at, received_at, is_anomaly FROM measurements WHERE id = $1
