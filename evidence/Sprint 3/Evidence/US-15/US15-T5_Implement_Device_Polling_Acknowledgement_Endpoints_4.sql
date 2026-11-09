-- After the first poll the command is SENT
SELECT id, status, sent_at, executed_at FROM actuator_commands WHERE id = $1
