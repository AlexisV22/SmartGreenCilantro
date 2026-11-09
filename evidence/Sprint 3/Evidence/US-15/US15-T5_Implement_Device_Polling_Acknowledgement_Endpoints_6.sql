-- After the acknowledgement: command EXECUTED and actuator state ON
SELECT c.id, c.status, c.executed_at, a.id AS actuator, a.state AS actuator_state
        FROM actuator_commands c JOIN actuators a ON a.id = c.actuator_id WHERE c.id = $1
