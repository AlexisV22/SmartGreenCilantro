-- Engine log of the blocked cases
SELECT created_at, level, message FROM system_logs WHERE source = 'automationEngine' AND message LIKE '%blocked%' ORDER BY created_at DESC LIMIT 8
