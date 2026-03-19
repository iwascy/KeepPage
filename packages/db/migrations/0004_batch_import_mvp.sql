CREATE TYPE import_source AS ENUM (
  'browser_bookmarks',
  'bookmark_html',
  'url_list',
  'csv_file',
  'text_file',
  'markdown_file'
);

CREATE TYPE import_mode AS ENUM (
  'links_only',
  'queue_archive',
  'start_archive'
);

CREATE TYPE import_task_status AS ENUM (
  'draft',
  'parsing',
  'ready',
  'running',
  'paused',
  'completed',
  'partial_failed',
  'failed',
  'cancelled'
);

CREATE TYPE import_item_status AS ENUM (
  'pending',
  'deduplicated',
  'created_bookmark',
  'queued_for_archive',
  'archiving',
  'archived',
  'skipped',
  'failed'
);

CREATE TYPE import_dedupe_result AS ENUM (
  'none',
  'created_bookmark',
  'merged_existing',
  'skipped_existing',
  'skipped_duplicate',
  'invalid_input'
);

CREATE TABLE import_tasks (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_type import_source NOT NULL,
  mode import_mode NOT NULL,
  status import_task_status NOT NULL,
  file_name VARCHAR(255),
  total_count INTEGER NOT NULL DEFAULT 0,
  valid_count INTEGER NOT NULL DEFAULT 0,
  invalid_count INTEGER NOT NULL DEFAULT 0,
  duplicate_in_file_count INTEGER NOT NULL DEFAULT 0,
  duplicate_existing_count INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  merged_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  archive_queued_count INTEGER NOT NULL DEFAULT 0,
  archive_success_count INTEGER NOT NULL DEFAULT 0,
  archive_failed_count INTEGER NOT NULL DEFAULT 0,
  source_meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX import_tasks_user_created_idx ON import_tasks(user_id, created_at);

CREATE TABLE import_items (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES import_tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  source_url TEXT,
  normalized_url TEXT,
  normalized_url_hash VARCHAR(128),
  domain VARCHAR(255),
  folder_path TEXT,
  source_tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  status import_item_status NOT NULL,
  dedupe_result import_dedupe_result NOT NULL,
  reason TEXT,
  bookmark_id TEXT,
  archived_version_id TEXT,
  has_archive BOOLEAN NOT NULL DEFAULT FALSE,
  source_meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX import_items_task_position_idx ON import_items(task_id, position);
CREATE INDEX import_items_user_task_idx ON import_items(user_id, task_id);
CREATE INDEX import_items_bookmark_idx ON import_items(bookmark_id);
