-- The 60 sample records in the database
SELECT sensor_id, value, unit, recorded_at, received_at FROM measurements
      WHERE sensor_id = 'HUM-01' AND recorded_at BETWEEN $1 AND $2 ORDER BY recorded_at
