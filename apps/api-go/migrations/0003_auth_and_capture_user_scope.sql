ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

UPDATE users
SET email = lower(trim(email))
WHERE email <> lower(trim(email));

UPDATE users
SET password_hash = ''
WHERE password_hash IS NULL;

ALTER TABLE users
ALTER COLUMN password_hash SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx
ON users(email);

ALTER TABLE capture_uploads
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- Drop unowned pending uploads that cannot be attributed after multi-tenant scope.
-- With the migration ledger this runs at most once per install.
DELETE FROM capture_uploads WHERE user_id IS NULL;

ALTER TABLE capture_uploads
ALTER COLUMN user_id SET NOT NULL;

DROP INDEX IF EXISTS capture_uploads_hash_idx;

CREATE UNIQUE INDEX IF NOT EXISTS capture_uploads_hash_idx
ON capture_uploads(user_id, normalized_url_hash, html_sha256);
