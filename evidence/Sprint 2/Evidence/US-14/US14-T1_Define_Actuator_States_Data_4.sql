-- Allowed values enforced by the database
SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'actuators'::regclass AND contype = 'c'
