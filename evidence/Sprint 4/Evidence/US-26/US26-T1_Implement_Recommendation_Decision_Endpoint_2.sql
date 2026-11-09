-- Decision stored with user and time
SELECT r.id, r.type, r.status, u.email AS decided_by, r.decided_at, r.decision_comment FROM recommendations r LEFT JOIN users u ON u.id = r.decided_by WHERE r.id = $1
