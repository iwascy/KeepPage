DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'share_status') THEN
    CREATE TYPE share_status AS ENUM ('active', 'revoked');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_token VARCHAR(64) NOT NULL,
  title VARCHAR(80) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status share_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS shares_public_token_idx
ON shares(public_token);

CREATE INDEX IF NOT EXISTS shares_user_updated_idx
ON shares(user_id, updated_at);

CREATE INDEX IF NOT EXISTS shares_status_token_idx
ON shares(status, public_token);

CREATE TABLE IF NOT EXISTS share_items (
  share_id UUID NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  bookmark_id UUID NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (share_id, bookmark_id)
);

CREATE INDEX IF NOT EXISTS share_items_share_position_idx
ON share_items(share_id, position);

CREATE INDEX IF NOT EXISTS share_items_bookmark_idx
ON share_items(bookmark_id);
