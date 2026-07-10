ALTER TABLE folders
ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS folders_user_parent_idx
ON folders(user_id, parent_id);

UPDATE folders AS child
SET parent_id = parent.id
FROM folders AS parent
WHERE child.user_id = parent.user_id
  AND child.parent_id IS NULL
  AND POSITION('/' IN child.path) > 0
  AND parent.path = regexp_replace(child.path, '/[^/]+$', '');
