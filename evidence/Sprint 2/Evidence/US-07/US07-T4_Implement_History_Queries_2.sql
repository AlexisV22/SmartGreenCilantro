-- Latest value per sensor (view v_latest_measurements used by the dashboard)
SELECT sensor_id, sensor_type, value, unit, recorded_at FROM v_latest_measurements ORDER BY sensor_id
