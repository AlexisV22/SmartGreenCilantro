-- Stored actuator fields
SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'actuators' ORDER BY ordinal_position
