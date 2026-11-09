-- Rejected recommendation with its reason
SELECT r.id, r.type, r.status, u.email AS decided_by, r.decided_at, r.decision_comment FROM recommendations r LEFT JOIN users u ON u.id = r.decided_by WHERE r.status = 'REJECTED' ORDER BY r.decided_at DESC LIMIT 1
