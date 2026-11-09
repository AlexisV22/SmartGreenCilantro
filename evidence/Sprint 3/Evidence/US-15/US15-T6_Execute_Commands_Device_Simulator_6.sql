-- Command lifecycle and resulting events
SELECT 'command' AS kind, status AS what, created_at AS at FROM actuator_commands WHERE id = $1
        UNION ALL SELECT 'sent', 'SENT', sent_at FROM actuator_commands WHERE id = $1
        UNION ALL SELECT 'executed', 'EXECUTED', executed_at FROM actuator_commands WHERE id = $1
        UNION ALL SELECT 'event', action || ' (' || source || ')', created_at FROM actuator_events WHERE actuator_id = 'ACT-PUMP-01' AND created_at >= $2 ORDER BY at
