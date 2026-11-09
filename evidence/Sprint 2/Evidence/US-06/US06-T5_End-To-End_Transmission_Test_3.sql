-- Stored readings per sensor during the test run
SELECT m.sensor_id, COUNT(*)::int AS readings, MIN(m.recorded_at) AS first_recorded, MAX(m.recorded_at) AS last_recorded,
      round(AVG(EXTRACT(EPOCH FROM (m.received_at - m.recorded_at)) * 1000)::numeric, 1) AS avg_delay_ms
      FROM measurements m WHERE m.received_at BETWEEN $1 AND $2 AND m.recorded_at >= $1 GROUP BY m.sensor_id ORDER BY m.sensor_id
