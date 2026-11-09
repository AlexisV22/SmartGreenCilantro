-- Command stored as PENDING
SELECT id, actuator_id, action, duration_min, source, status, requested_by, created_at, expires_at FROM actuator_commands WHERE id = $1
