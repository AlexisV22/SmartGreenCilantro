-- Final values in the running database
SELECT key, value, description FROM system_parameters WHERE key IN ('anomaly.zscore_threshold', 'anomaly.flatline_minutes', 'anomaly.flatline_minutes.water_level', 'anomaly.jump.temperature', 'anomaly.jump.soil_moisture') ORDER BY key
