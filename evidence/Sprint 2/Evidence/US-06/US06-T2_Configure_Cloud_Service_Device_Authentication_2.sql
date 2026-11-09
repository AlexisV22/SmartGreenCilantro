-- Device credentials (only the SHA-256 hash of each key is stored)
SELECT id, name, is_active, api_key_hash, length(api_key_hash) AS hash_len, last_seen FROM devices ORDER BY id
