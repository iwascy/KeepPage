CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE capture_profile AS ENUM ('standard', 'complete', 'dynamic', 'lightweight');
CREATE TYPE quality_grade AS ENUM ('high', 'medium', 'low');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(320) NOT NULL,
  name VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label VARCHAR(120) NOT NULL,
  platform VARCHAR(40) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX folders_user_path_idx ON folders(user_id, path);

CREATE TABLE bookmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  canonical_url TEXT,
  normalized_url_hash VARCHAR(128) NOT NULL,
  title TEXT NOT NULL,
  domain VARCHAR(255) NOT NULL,
  latest_version_id UUID,
  folder_id UUID REFERENCES folders(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',
  is_pinned_offline BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX bookmarks_user_url_idx ON bookmarks(user_id, normalized_url_hash);
CREATE INDEX bookmarks_latest_version_idx ON bookmarks(latest_version_id);

CREATE TABLE capture_uploads (
  object_key TEXT PRIMARY KEY,
  normalized_url_hash VARCHAR(128) NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  html_sha256 VARCHAR(128) NOT NULL,
  file_size INTEGER NOT NULL,
  capture_profile capture_profile NOT NULL,
  device_id VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX capture_uploads_hash_idx ON capture_uploads(normalized_url_hash, html_sha256);

CREATE TABLE bookmark_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bookmark_id UUID NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  html_object_key TEXT NOT NULL,
  html_sha256 VARCHAR(128) NOT NULL,
  text_sha256 VARCHAR(128),
  text_simhash VARCHAR(128),
  screenshot_object_key TEXT,
  thumbnail_object_key TEXT,
  pdf_object_key TEXT,
  capture_profile capture_profile NOT NULL,
  capture_options_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  quality_score INTEGER NOT NULL,
  quality_grade quality_grade NOT NULL,
  quality_reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  quality_report_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  extracted_text TEXT,
  created_by_device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX bookmark_versions_bookmark_version_idx ON bookmark_versions(bookmark_id, version_no);
CREATE INDEX bookmark_versions_html_sha_idx ON bookmark_versions(html_sha256);
CREATE INDEX bookmark_versions_text_sha_idx ON bookmark_versions(text_sha256);

CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL,
  color VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX tags_user_name_idx ON tags(user_id, name);

CREATE TABLE bookmark_tags (
  bookmark_id UUID NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bookmark_id, tag_id)
);

CREATE TABLE sync_ops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cursor INTEGER GENERATED ALWAYS AS IDENTITY NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id UUID NOT NULL,
  operation VARCHAR(20) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX sync_ops_user_cursor_idx ON sync_ops(user_id, cursor);
