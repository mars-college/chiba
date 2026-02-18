ALTER TABLE media_resources
  ADD COLUMN IF NOT EXISTS thumbnail_object_key TEXT;
