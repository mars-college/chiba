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

-- Govee lights configuration
CREATE TABLE IF NOT EXISTS lights (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  port INTEGER DEFAULT 4003,
  device_id TEXT UNIQUE,
  sku TEXT,
  device_type TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- Current light state (ephemeral)
CREATE TABLE IF NOT EXISTS light_state (
  light_id TEXT PRIMARY KEY REFERENCES lights(id) ON DELETE CASCADE,
  power INTEGER DEFAULT 0,
  hue INTEGER DEFAULT 0,
  saturation INTEGER DEFAULT 100,
  brightness INTEGER DEFAULT 100,
  kelvin INTEGER,
  updated_at INTEGER
);

-- Light presets (scenes)
CREATE TABLE IF NOT EXISTS light_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_predefined INTEGER DEFAULT 0,
  settings TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- Index for fast preset lookups
CREATE INDEX IF NOT EXISTS idx_light_presets_name ON light_presets(name);
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
DROP TABLE IF EXISTS light_schedules;
DROP TABLE IF EXISTS node_content;
DROP TABLE IF EXISTS playlists;
DROP TABLE IF EXISTS content;
DROP TABLE IF EXISTS node_status;
DROP TABLE IF EXISTS nodes;
DROP TABLE IF EXISTS light_state;
DROP TABLE IF EXISTS light_presets;
DROP TABLE IF EXISTS lights;
`;

/**
 * Migrations to apply to existing databases.
 * Each migration is a SQL statement that may fail if already applied.
 *
 * NOTE: Lights are now discovered via LAN multicast (POST /api/lights/discover)
 * rather than synced from a static config file. The light migrations below are
 * kept for compatibility with existing installations.
 */
export const MIGRATIONS = [
  // Add name column to content table
  `ALTER TABLE content ADD COLUMN name TEXT;`,

  // Seed default lights
  `INSERT OR IGNORE INTO lights (id, name, ip_address) VALUES
    ('light-gallery-west', 'gallery west', '100.124.3.230'),
    ('light-gallery-east', 'gallery east', '100.124.3.207'),
    ('light-auditorium', 'auditorium', '100.124.3.206');`,

  // Seed predefined presets
  `INSERT OR IGNORE INTO light_presets (id, name, is_predefined, settings) VALUES
    ('preset-all-off', 'All Off', 1, '[{"lightId":"*","power":false}]'),
    ('preset-all-on', 'All On', 1, '[{"lightId":"*","power":true,"brightness":100}]'),
    ('preset-warm-dim', 'Warm Dim', 1, '[{"lightId":"*","power":true,"hue":30,"saturation":80,"brightness":30}]'),
    ('preset-cool-bright', 'Cool Bright', 1, '[{"lightId":"*","power":true,"hue":200,"saturation":50,"brightness":100}]');`,

  // Migration: Update lights to correct IPs and add all 5 lights
  `DELETE FROM light_state;`,
  `DELETE FROM lights;`,
  `INSERT INTO lights (id, name, ip_address) VALUES
    ('gw1', 'Gallery West 1', '100.124.2.183'),
    ('gw2', 'Gallery West 2', '100.124.2.182'),
    ('ge1', 'Gallery East 1', '100.124.2.146'),
    ('ge2', 'Gallery East 2', '100.124.2.181'),
    ('a', 'Auditorium', '100.124.2.160');`,

  // Add Max Bright preset (cool white at max brightness)
  `INSERT OR IGNORE INTO light_presets (id, name, is_predefined, settings) VALUES
    ('preset-max-bright', 'Max Bright', 1, '[{"lightId":"*","power":true,"kelvin":6500,"brightness":100}]');`,

  // Add Warm Bright preset (warm white 3250K at full brightness)
  `INSERT OR IGNORE INTO light_presets (id, name, is_predefined, settings) VALUES
    ('preset-warm-bright', 'Warm Bright', 1, '[{"lightId":"*","power":true,"kelvin":3250,"brightness":100}]');`,

  // Migration: Update lights to new IPs (Jan 2026 - lights changed addresses)
  `DELETE FROM light_state;`,
  `DELETE FROM lights;`,
  `INSERT INTO lights (id, name, ip_address) VALUES
    ('gw1', 'Gallery West 1', '100.128.2.181'),
    ('gw2', 'Gallery West 2', '100.128.2.146'),
    ('ge1', 'Gallery East 1', '100.128.2.160'),
    ('ge2', 'Gallery East 2', '100.128.2.183'),
    ('a', 'Auditorium', '100.128.2.182');`,

  // Update presets to use kelvin-based white temperatures
  `UPDATE light_presets SET settings = '[{"lightId":"*","power":true,"kelvin":6500,"brightness":100}]' WHERE id = 'preset-max-bright';`,
  `UPDATE light_presets SET settings = '[{"lightId":"*","power":true,"kelvin":3250,"brightness":100}]' WHERE id = 'preset-warm-bright';`,
  `UPDATE light_presets SET settings = '[{"lightId":"*","power":true,"kelvin":3250,"brightness":30}]' WHERE id = 'preset-warm-dim';`,

  // Migration: Add device_id and sku columns to lights table for auto-discovery
  `ALTER TABLE lights ADD COLUMN device_id TEXT UNIQUE;`,
  `ALTER TABLE lights ADD COLUMN sku TEXT;`,

  // Remove UNIQUE constraint from ip_address (IPs can change via DHCP)
  // SQLite doesn't support dropping constraints, so we create a new table
  `CREATE TABLE IF NOT EXISTS lights_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    port INTEGER DEFAULT 4003,
    device_id TEXT UNIQUE,
    sku TEXT,
    device_type TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
  );`,
  `INSERT OR IGNORE INTO lights_new SELECT id, name, ip_address, port, device_id, sku, device_type, created_at, updated_at FROM lights;`,
  `DROP TABLE IF EXISTS lights;`,
  `ALTER TABLE lights_new RENAME TO lights;`,
  `CREATE INDEX IF NOT EXISTS idx_lights_device_id ON lights(device_id);`,

  // Add kelvin column to light_state for temperature mode tracking
  `ALTER TABLE light_state ADD COLUMN kelvin INTEGER;`,

  // Migration: Sync lights with config (Jan 2026 - added Mezzanine and Mimos)
  `DELETE FROM light_state;`,
  `DELETE FROM lights;`,
  `INSERT INTO lights (id, name, ip_address) VALUES
    ('gw1', 'Gallery West 1', '100.128.2.183'),
    ('gw2', 'Gallery West 2', '100.128.2.182'),
    ('ge1', 'Gallery East 1', '100.128.2.146'),
    ('ge2', 'Gallery East 2', '100.128.2.181'),
    ('a', 'Auditorium', '100.128.2.160'),
    ('mz', 'Mezzanine', '100.128.0.223'),
    ('mm', 'Mimos', '100.128.0.226');`,

  // Light schedules table for daily timer/breakpoint system
  `CREATE TABLE IF NOT EXISTS light_schedules (
    light_id TEXT PRIMARY KEY REFERENCES lights(id) ON DELETE CASCADE,
    enabled INTEGER DEFAULT 0,
    breakpoints TEXT NOT NULL DEFAULT '[]',
    updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
  );`,
];
