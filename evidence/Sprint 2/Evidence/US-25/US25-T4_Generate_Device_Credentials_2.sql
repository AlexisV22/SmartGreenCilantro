-- Stored credential: SHA-256 hash only
SELECT id, api_key_hash, length(api_key_hash) AS len, encode(sha256(convert_to($1, 'UTF8')), 'hex') = api_key_hash AS matches_generated_key FROM devices WHERE id = 'dev-node-25b'
