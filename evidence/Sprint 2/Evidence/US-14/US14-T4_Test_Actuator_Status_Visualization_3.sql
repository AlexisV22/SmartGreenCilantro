-- State changed directly in the database
UPDATE actuators SET state = 'ON', last_update = NOW() WHERE id = 'ACT-SHADE-01' RETURNING id, state, last_update
