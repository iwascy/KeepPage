DELETE FROM capture_uploads AS older
USING capture_uploads AS newer
WHERE older.normalized_url_hash = newer.normalized_url_hash
  AND older.html_sha256 = newer.html_sha256
  AND older.object_key < newer.object_key;

DROP INDEX IF EXISTS capture_uploads_hash_idx;

CREATE UNIQUE INDEX IF NOT EXISTS capture_uploads_hash_idx
ON capture_uploads(normalized_url_hash, html_sha256);
