-- Row written by POST /measurements (through the US-07 storage service)
SELECT id, sensor_id, value, unit, recorded_at, received_at FROM measurements WHERE id = $1
