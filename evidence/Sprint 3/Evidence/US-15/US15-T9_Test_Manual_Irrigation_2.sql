-- Command sent while the device was offline
SELECT id, action, status, created_at, expires_at FROM actuator_commands WHERE id = $1
