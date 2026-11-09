-- Server log of the received messages (system_logs)
SELECT created_at, level, source, message FROM system_logs
      WHERE created_at >= $1 AND message LIKE 'POST /api/measurements%' ORDER BY created_at
