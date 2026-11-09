-- Log of the scheduled job
SELECT created_at, level, source, message FROM system_logs WHERE source IN ('recommendationJob','recommendations') AND created_at >= $1 ORDER BY created_at
