-- Sample event records
SELECT e.created_at, e.actuator_id, e.action, e.source, u.email AS user_email, e.duration_min, e.reason FROM actuator_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.created_at >= NOW() - INTERVAL '3 hours' ORDER BY e.created_at DESC LIMIT 12
