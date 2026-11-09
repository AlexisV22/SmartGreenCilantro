-- Stored passwords (users table): only bcrypt hashes
SELECT u.email, r.name AS role, u.password_hash, length(u.password_hash) AS hash_length,
      (u.password_hash LIKE '$2%') AS is_bcrypt FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.email
