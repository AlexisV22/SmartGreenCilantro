-- LOW_WATER alert created by the engine
SELECT id, type, severity, status, value, message, created_at FROM alerts WHERE type = 'LOW_WATER' ORDER BY created_at DESC LIMIT 1
