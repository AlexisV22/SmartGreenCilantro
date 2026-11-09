-- Engine log (system_logs, source alerts)
SELECT created_at, level, message FROM system_logs WHERE source = 'alerts' AND created_at >= $1 ORDER BY created_at
