/**
 * SQLite database schema for the controller.
 * Defines tables for nodes, content, playlists, and their relationships.
 */

/**
 * SQL statements to create the database schema.
 */
export const SCHEMA = `
-- Registered nodes
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  friendly_name TEXT NOT NULL UNIQUE,
  hostname TEXT NOT NULL,
  ip TEXT,
  port INTEGER DEFAULT 8080,
  api_key TEXT,
  version TEXT,
  last_seen INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- Index for looking up nodes by friendly name
CREATE INDEX IF NOT EXISTS idx_nodes_friendly_name ON nodes(friendly_name);

-- Node connection status (ephemeral, may be cleared on startup)
CREATE TABLE IF NOT EXISTS node_status (
  node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  connected INTEGER DEFAULT 0,
  playback_state TEXT,           -- JSON
  disk_usage TEXT,               -- JSON
  hardware_metrics TEXT,         -- JSON
  cached_content TEXT,           -- JSON array
  updated_at INTEGER
);

-- Content sources (known content across all nodes)
CREATE TABLE IF NOT EXISTS content (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  filename TEXT NOT NULL,
  name TEXT,                     -- User-friendly display name
  original_url TEXT,
  source_type TEXT NOT NULL,     -- file, url, youtube, eden
  source_data TEXT,              -- JSON for source details
  content_type TEXT NOT NULL,    -- video, image
  size_bytes INTEGER,
  duration INTEGER,              -- Video duration (seconds)
  width INTEGER,
  height INTEGER,
  metadata TEXT,                 -- JSON for title, author, etc.
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- Index for looking up content by hash
CREATE INDEX IF NOT EXISTS idx_content_hash ON content(hash);

-- Saved playlists
CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  items TEXT NOT NULL,           -- JSON array of PlaylistItem
  loop INTEGER DEFAULT 1,
  show_intros INTEGER DEFAULT 1,
  intro_duration INTEGER DEFAULT 3000,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- Which content is cached on which node
CREATE TABLE IF NOT EXISTS node_content (
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  cached_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  PRIMARY KEY (node_id, content_hash)
);

-- Index for looking up nodes by content
CREATE INDEX IF NOT EXISTS idx_node_content_hash ON node_content(content_hash);
`;

/**
 * SQL statements to clear ephemeral data on startup.
 */
export const CLEAR_EPHEMERAL = `
-- Reset all node connection status
UPDATE node_status SET connected = 0, updated_at = strftime('%s', 'now') * 1000;
`;

/**
 * SQL statements to drop all tables (for testing).
 */
export const DROP_ALL = `
DROP TABLE IF EXISTS node_content;
DROP TABLE IF EXISTS playlists;
DROP TABLE IF EXISTS content;
DROP TABLE IF EXISTS node_status;
DROP TABLE IF EXISTS nodes;
`;

/**
 * Migrations to apply to existing databases.
 * Each migration is a SQL statement that may fail if already applied.
 */
export const MIGRATIONS = [
  // Add name column to content table
  `ALTER TABLE content ADD COLUMN name TEXT;`,
];
