CREATE TABLE IF NOT EXISTS api_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  token_preview VARCHAR(80) NOT NULL,
  token_hash VARCHAR(128) NOT NULL,
  scopes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_tokens_user_created_idx
ON api_tokens(user_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_hash_idx
ON api_tokens(token_hash);
