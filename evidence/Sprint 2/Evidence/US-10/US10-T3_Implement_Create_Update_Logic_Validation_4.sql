-- Audit trail of the change (before / after)
SELECT created_at, action, entity, entity_id, before_data, after_data FROM audit_logs WHERE entity = 'thresholds' AND entity_id = $1 ORDER BY created_at
