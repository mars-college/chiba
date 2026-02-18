CREATE TABLE IF NOT EXISTS node_connectivity (
  registry_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  dns_ok BOOLEAN NOT NULL,
  ping_ok BOOLEAN NOT NULL,
  ssh_ok BOOLEAN NOT NULL,
  node_api_ok BOOLEAN NOT NULL,
  cable_api_ok BOOLEAN NOT NULL,
  connectivity_score INTEGER NOT NULL,
  connectivity_total INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('online', 'degraded', 'offline')),
  latency_ms INTEGER,
  error_summary TEXT,
  checked_at BIGINT NOT NULL,
  PRIMARY KEY (registry_id, node_id, namespace)
);

CREATE INDEX IF NOT EXISTS idx_node_connectivity_registry_namespace
  ON node_connectivity(registry_id, namespace);
