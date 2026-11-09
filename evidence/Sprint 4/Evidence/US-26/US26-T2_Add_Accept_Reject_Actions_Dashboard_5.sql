-- Irrigation command created by accepting (source AI)
SELECT id, actuator_id, action, duration_min, source, status, requested_by, created_at, executed_at FROM actuator_commands WHERE source = 'AI' ORDER BY created_at DESC LIMIT 1
