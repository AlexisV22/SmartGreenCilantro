-- Timeouts stored in system_parameters (running database)
SELECT key, value, description FROM system_parameters WHERE key IN ('command.expiry_seconds', 'actuator.offline_minutes', 'device.offline_minutes') ORDER BY key
