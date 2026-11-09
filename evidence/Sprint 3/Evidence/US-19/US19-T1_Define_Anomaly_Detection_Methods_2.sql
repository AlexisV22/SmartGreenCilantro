-- Parameters of the methods (system_parameters)
SELECT key, value, description FROM system_parameters WHERE key LIKE 'anomaly.%' ORDER BY key
