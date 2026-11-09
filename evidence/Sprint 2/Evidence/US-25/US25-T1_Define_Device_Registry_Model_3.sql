-- Every sensor and actuator references a device (NOT NULL foreign key)
SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_name IN ('sensors','actuators') AND column_name = 'device_id'
