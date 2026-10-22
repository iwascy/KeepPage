CREATE TABLE IF NOT EXISTS private_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  path TEXT NOT NULL,
  parent_id UUID REFERENCES private_folders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS private_folders_user_path_idx
ON private_folders(user_id, path);

CREATE INDEX IF NOT EXISTS private_folders_user_parent_idx
ON private_folders(user_id, parent_id);

CREATE TABLE IF NOT EXISTS private_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL,
  color VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS private_tags_user_name_idx
ON private_tags(user_id, name);

CREATE TABLE IF NOT EXISTS private_bookmark_tags (
  bookmark_id UUID NOT NULL REFERENCES private_bookmarks(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES private_tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bookmark_id, tag_id)
);

CREATE INDEX IF NOT EXISTS private_bookmark_tags_tag_idx
ON private_bookmark_tags(tag_id);

ALTER TABLE private_bookmarks
ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES private_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS private_bookmarks_user_folder_idx
ON private_bookmarks(user_id, folder_id);
