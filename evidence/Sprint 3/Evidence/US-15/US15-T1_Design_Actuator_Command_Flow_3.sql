-- Command states enforced by the database
SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'actuator_commands'::regclass AND contype = 'c'
