-- Sensors / actuators without a device
SELECT 'sensors' AS table_name, COUNT(*)::int AS without_device FROM sensors WHERE device_id IS NULL UNION ALL SELECT 'actuators', COUNT(*)::int FROM actuators WHERE device_id IS NULL
