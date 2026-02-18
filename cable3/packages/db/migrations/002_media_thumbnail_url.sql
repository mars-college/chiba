ALTER TABLE media_resources
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
