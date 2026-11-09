-- Fields of the thresholds table
SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'thresholds' ORDER BY ordinal_position
