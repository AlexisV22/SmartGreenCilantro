-- After returning to range: status RESOLVED and resolved_at filled
SELECT id, status, created_at, resolved_at FROM alerts WHERE id = $1
