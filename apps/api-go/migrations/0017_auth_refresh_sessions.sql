CREATE TABLE IF NOT EXISTS auth_refresh_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  generation bigint NOT NULL DEFAULT 0,
  token_hash varchar(64) NOT NULL,
  previous_hash varchar(64) NOT NULL DEFAULT '',
  rotated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS auth_refresh_sessions_expiry_idx ON auth_refresh_sessions(expires_at);
CREATE INDEX IF NOT EXISTS auth_refresh_sessions_user_idx ON auth_refresh_sessions(user_id);
