-- De-duplication enforced by the database (one open alert per sensor and type)
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'alerts' AND indexname LIKE 'uq_%'
