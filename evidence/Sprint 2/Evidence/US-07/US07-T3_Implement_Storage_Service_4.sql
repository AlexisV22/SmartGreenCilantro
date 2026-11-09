-- Rejections written to the system log
SELECT created_at, level, source, message FROM system_logs
      WHERE created_at >= $1 AND source = 'measurements' ORDER BY created_at
