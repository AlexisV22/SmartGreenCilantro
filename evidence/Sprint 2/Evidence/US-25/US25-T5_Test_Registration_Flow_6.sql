-- Readings of SM-25C in the database (only the one sent while active)
SELECT sensor_id, value, recorded_at, received_at FROM measurements WHERE sensor_id = 'SM-25C'
