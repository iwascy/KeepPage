CREATE TYPE bookmark_icon_source_type AS ENUM (
  'simple-icons',
  'iconify',
  'rel-icon',
  'apple-touch-icon',
  'manifest',
  'favicon-ico',
  'default-path',
  'favicon-api',
  'google-s2',
  'manual',
  'unknown'
);

CREATE TABLE IF NOT EXISTS bookmark_icons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname VARCHAR(255) NOT NULL,
  icon_url TEXT NOT NULL,
  source_url TEXT,
  source_type bookmark_icon_source_type NOT NULL DEFAULT 'unknown',
  width INTEGER,
  height INTEGER,
  format VARCHAR(40),
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS bookmark_icons_hostname_idx
ON bookmark_icons(hostname);

CREATE INDEX IF NOT EXISTS bookmark_icons_refreshed_idx
ON bookmark_icons(refreshed_at);
