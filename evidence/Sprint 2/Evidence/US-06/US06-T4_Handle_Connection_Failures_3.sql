-- Readings taken during the outage and delivered after reconnecting
SELECT m.sensor_id, m.value, m.recorded_at, m.received_at,
      round(EXTRACT(EPOCH FROM (m.received_at - m.recorded_at))::numeric, 1) AS delivered_after_s
      FROM measurements m WHERE m.received_at >= $1 AND m.sensor_id = 'SM-01' ORDER BY m.recorded_at
