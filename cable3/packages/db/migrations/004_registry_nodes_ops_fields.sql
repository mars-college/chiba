ALTER TABLE registry_nodes
  ADD COLUMN IF NOT EXISTS created_at BIGINT;

ALTER TABLE registry_nodes
  ADD COLUMN IF NOT EXISTS updated_at BIGINT;

UPDATE registry_nodes
SET
  created_at = COALESCE(created_at, imported_at),
  updated_at = COALESCE(updated_at, imported_at)
WHERE created_at IS NULL OR updated_at IS NULL;

ALTER TABLE registry_nodes
  ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE registry_nodes
  ALTER COLUMN updated_at SET NOT NULL;
