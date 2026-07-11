ALTER TABLE bookmark_versions
ADD COLUMN IF NOT EXISTS reader_html_object_key text;
