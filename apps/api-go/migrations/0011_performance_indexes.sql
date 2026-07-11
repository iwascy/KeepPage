CREATE INDEX IF NOT EXISTS bookmarks_user_updated_idx
ON bookmarks(user_id, updated_at);

CREATE INDEX IF NOT EXISTS bookmarks_user_folder_idx
ON bookmarks(user_id, folder_id);

CREATE INDEX IF NOT EXISTS private_bookmarks_user_updated_idx
ON private_bookmarks(user_id, updated_at);

CREATE INDEX IF NOT EXISTS bookmark_tags_tag_idx
ON bookmark_tags(tag_id);
