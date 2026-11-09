-- The records after the test: still in the database, deactivated
SELECT 'device' AS kind, id, name, is_active FROM devices WHERE id = 'dev-node-25a'
      UNION ALL SELECT 'sensor', id, name, is_active FROM sensors WHERE id = 'SM-25A' UNION ALL SELECT 'actuator', id, name, is_active FROM actuators WHERE id = 'ACT-25A'
