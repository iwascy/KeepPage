CREATE TABLE IF NOT EXISTS private_mode_configs (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  password_algo VARCHAR(40) NOT NULL DEFAULT 'scrypt',
  enabled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  password_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS private_bookmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  canonical_url TEXT,
  normalized_url_hash VARCHAR(128) NOT NULL,
  title TEXT NOT NULL,
  domain VARCHAR(255) NOT NULL,
  latest_version_id UUID,
  note TEXT NOT NULL DEFAULT '',
  is_favorite BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS private_bookmarks_user_url_idx
ON private_bookmarks(user_id, normalized_url_hash);

CREATE INDEX IF NOT EXISTS private_bookmarks_latest_version_idx
ON private_bookmarks(latest_version_id);

CREATE TABLE IF NOT EXISTS private_capture_uploads (
  object_key TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  normalized_url_hash VARCHAR(128) NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  html_sha256 VARCHAR(128) NOT NULL,
  file_size INTEGER NOT NULL,
  capture_profile capture_profile NOT NULL,
  device_id VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS private_capture_uploads_hash_idx
ON private_capture_uploads(user_id, normalized_url_hash, html_sha256);

CREATE TABLE IF NOT EXISTS private_bookmark_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bookmark_id UUID NOT NULL REFERENCES private_bookmarks(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  html_object_key TEXT NOT NULL,
  reader_html_object_key TEXT,
  html_sha256 VARCHAR(128) NOT NULL,
  text_sha256 VARCHAR(128),
  text_simhash VARCHAR(128),
  capture_profile capture_profile NOT NULL,
  capture_options_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  quality_score INTEGER NOT NULL,
  quality_grade quality_grade NOT NULL,
  quality_reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  quality_report_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  extracted_text TEXT,
  created_by_device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS private_bookmark_versions_bookmark_version_idx
ON private_bookmark_versions(bookmark_id, version_no);

CREATE INDEX IF NOT EXISTS private_bookmark_versions_html_sha_idx
ON private_bookmark_versions(html_sha256);

CREATE INDEX IF NOT EXISTS private_bookmark_versions_text_sha_idx
ON private_bookmark_versions(text_sha256);
