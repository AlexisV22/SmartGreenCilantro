-- Actuator without updates for 10 minutes
UPDATE actuators SET last_update = NOW() - INTERVAL '10 minutes' WHERE id = 'ACT-LIGHT-01' RETURNING id, state, last_update
