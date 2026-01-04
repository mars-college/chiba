/**
 * SQLite database schema for the node.
 * Defines tables for cached content, configuration, and playback history.
 */

/**
 * SQL statements to create the database schema.
 */
export const SCHEMA = `
-- Local content cache registry
CREATE TABLE IF NOT EXISTS cached_content (
  hash TEXT PRIMARY KEY,         -- MD5 hash
  filename TEXT NOT NULL,        -- <hash>.<ext>
  name TEXT,                     -- User-friendly display name
  original_url TEXT,
  source_type TEXT NOT NULL,     -- file, url, youtube, eden
  source_data TEXT,              -- JSON for source details
  content_type TEXT NOT NULL,    -- video, image
  size_bytes INTEGER NOT NULL,
  duration INTEGER,              -- Video duration (seconds)
  width INTEGER,
  height INTEGER,
  metadata TEXT,                 -- JSON for title, author, etc.
  cached_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  last_played_at INTEGER
);

-- Index for looking up by content type
CREATE INDEX IF NOT EXISTS idx_cached_content_type ON cached_content(content_type);

-- Node configuration (key-value store)
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Playback history for analytics
CREATE TABLE IF NOT EXISTS playback_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_hash TEXT,
  played_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  duration_watched INTEGER,      -- Seconds watched
  completed INTEGER DEFAULT 0    -- Whether playback completed
);

-- Index for looking up history by date
CREATE INDEX IF NOT EXISTS idx_playback_history_date ON playback_history(played_at);

-- Download queue for background downloads
CREATE TABLE IF NOT EXISTS download_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,
  source_data TEXT NOT NULL,     -- JSON
  metadata TEXT,                 -- JSON
  priority INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending', -- pending, downloading, completed, failed
  error TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  started_at INTEGER,
  completed_at INTEGER
);

-- Index for pending downloads
CREATE INDEX IF NOT EXISTS idx_download_queue_status ON download_queue(status, priority DESC);
`;

/**
 * SQL statements to drop all tables (for testing).
 */
export const DROP_ALL = `
DROP TABLE IF EXISTS download_queue;
DROP TABLE IF EXISTS playback_history;
DROP TABLE IF EXISTS config;
DROP TABLE IF EXISTS cached_content;
`;

/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG: Record<string, string> = {
  'node.id': '',
  'node.friendly_name': 'unnamed-node',
  'controller.url': 'http://localhost:8080',
  'controller.api_key': '',
  'player.intro_duration': '3000',
  'player.image_duration': '10000',
  'player.show_intros': 'true',
  'audio.volume': '100',
};
