-- Events in the database (latest manual and automatic activations)
SELECT e.id, e.created_at, e.action, e.source, u.email AS user_email, e.duration_min, e.reason FROM actuator_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.id = ANY($1)
