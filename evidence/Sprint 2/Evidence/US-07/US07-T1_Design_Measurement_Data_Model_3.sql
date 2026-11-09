-- Columns of the measurements table as created in the database
SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns WHERE table_name = 'measurements' ORDER BY ordinal_position
