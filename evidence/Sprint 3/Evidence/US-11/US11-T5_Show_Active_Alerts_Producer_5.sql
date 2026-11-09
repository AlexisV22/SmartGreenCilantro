-- Acknowledgement stored with user and time
SELECT a.id, a.status, a.message, u.email AS acknowledged_by, a.acknowledged_at FROM alerts a LEFT JOIN users u ON u.id = a.acknowledged_by WHERE a.sensor_id = 'SM-01' AND a.status = 'ACKNOWLEDGED' ORDER BY a.created_at DESC LIMIT 1
