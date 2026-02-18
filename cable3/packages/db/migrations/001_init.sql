CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS registries (
  id TEXT PRIMARY KEY,
  source_path TEXT NOT NULL,
  imported_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS registry_nodes (
  registry_id TEXT NOT NULL REFERENCES registries(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  host TEXT,
  ip TEXT,
  node_name TEXT,
  orientation TEXT,
  display_rotate INTEGER,
  guide_port INTEGER,
  node_port INTEGER,
  server_port INTEGER,
  api_key TEXT,
  imported_at BIGINT NOT NULL,
  PRIMARY KEY (registry_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_registry_nodes_node_id ON registry_nodes(node_id);

CREATE TABLE IF NOT EXISTS media_resources (
  id TEXT PRIMARY KEY,
  title TEXT,
  artist TEXT,
  description TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('path', 'url')),
  source_value TEXT NOT NULL,
  cache BOOLEAN NOT NULL DEFAULT TRUE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_resources (
  id TEXT PRIMARY KEY,
  title TEXT,
  artist TEXT,
  description TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_items (
  playlist_id TEXT NOT NULL REFERENCES playlist_resources(id) ON DELETE CASCADE,
  item_index INTEGER NOT NULL,
  media_id TEXT REFERENCES media_resources(id) ON DELETE SET NULL,
  child_playlist_id TEXT REFERENCES playlist_resources(id) ON DELETE SET NULL,
  duration_sec DOUBLE PRECISION,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (playlist_id, item_index)
);

CREATE TABLE IF NOT EXISTS block_resources (
  id TEXT PRIMARY KEY,
  title TEXT,
  mode TEXT CHECK (mode IN ('loop', 'once', 'clocked')),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS block_items (
  block_id TEXT NOT NULL REFERENCES block_resources(id) ON DELETE CASCADE,
  item_index INTEGER NOT NULL,
  media_id TEXT REFERENCES media_resources(id) ON DELETE SET NULL,
  playlist_id TEXT REFERENCES playlist_resources(id) ON DELETE SET NULL,
  duration_sec DOUBLE PRECISION,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (block_id, item_index)
);

CREATE TABLE IF NOT EXISTS channel_resources (
  id TEXT PRIMARY KEY,
  number_text TEXT,
  name TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_blocks (
  channel_id TEXT NOT NULL REFERENCES channel_resources(id) ON DELETE CASCADE,
  block_index INTEGER NOT NULL,
  block_id TEXT NOT NULL REFERENCES block_resources(id) ON DELETE RESTRICT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (channel_id, block_index)
);

CREATE TABLE IF NOT EXISTS profile_resources (
  id TEXT PRIMARY KEY,
  title TEXT,
  defaults_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_node_assignments (
  profile_id TEXT NOT NULL REFERENCES profile_resources(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('media', 'playlist', 'block', 'channel', 'profile')),
  target_id TEXT NOT NULL,
  launch_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (profile_id, node_id)
);

CREATE TABLE IF NOT EXISTS desired_screen_state (
  screen_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  revision BIGINT NOT NULL,
  controller_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('media', 'playlist', 'block', 'channel', 'profile')),
  target_id TEXT NOT NULL,
  launch_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (screen_id, namespace)
);

CREATE TABLE IF NOT EXISTS apply_operations (
  id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL,
  controller_id TEXT NOT NULL,
  request_json JSONB NOT NULL,
  result_json JSONB,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS node_runtime_reports (
  node_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  desired_revision BIGINT,
  active_revision BIGINT,
  phase TEXT NOT NULL,
  report_json JSONB NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (node_id, namespace)
);

