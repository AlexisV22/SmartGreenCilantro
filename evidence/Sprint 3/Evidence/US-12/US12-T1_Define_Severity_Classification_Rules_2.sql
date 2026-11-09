-- Configured limits (system_parameters)
SELECT key, value, description FROM system_parameters WHERE key LIKE 'severity.%' ORDER BY key
