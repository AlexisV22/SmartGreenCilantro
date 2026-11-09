-- Readings stored by the simulator run (one cycle every 10 s in this test)
SELECT m.sensor_id, s.device_id, m.value, m.unit, m.recorded_at, m.received_at,
      round(EXTRACT(EPOCH FROM (m.recorded_at - lag(m.recorded_at) OVER (PARTITION BY m.sensor_id ORDER BY m.recorded_at)))::numeric, 1) AS seconds_since_previous
      FROM measurements m JOIN sensors s ON s.id = m.sensor_id WHERE m.received_at >= $1 AND m.sensor_id IN ('SM-01','SM-02','TMP-01')
      ORDER BY m.sensor_id, m.recorded_at
