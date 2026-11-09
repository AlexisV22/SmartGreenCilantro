-- Alert fields in the database
SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'alerts' ORDER BY ordinal_position
