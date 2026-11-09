-- Command waiting for the device
SELECT id, actuator_id, action, status, created_at, sent_at FROM actuator_commands WHERE id = $1
