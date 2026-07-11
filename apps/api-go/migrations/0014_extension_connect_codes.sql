CREATE TABLE IF NOT EXISTS extension_connect_codes (
  code TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_name VARCHAR(120) NOT NULL,
  platform VARCHAR(80) NOT NULL,
  extension_id VARCHAR(120),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS extension_connect_codes_expires_idx
ON extension_connect_codes(expires_at);

CREATE INDEX IF NOT EXISTS extension_connect_codes_user_idx
ON extension_connect_codes(user_id);
