ALTER TABLE devices
ALTER COLUMN platform TYPE VARCHAR(80),
ADD COLUMN IF NOT EXISTS token_preview VARCHAR(80),
ADD COLUMN IF NOT EXISTS token_hash VARCHAR(128),
ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS devices_user_created_idx
ON devices(user_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS devices_token_hash_idx
ON devices(token_hash)
WHERE token_hash IS NOT NULL;
