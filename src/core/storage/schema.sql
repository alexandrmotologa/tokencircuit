-- TokenCircuit SQLite Schema

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  daily_limit_usd REAL NOT NULL DEFAULT 50.0,
  monthly_limit_usd REAL NOT NULL DEFAULT 500.0,
  auto_downgrade_enabled INTEGER NOT NULL DEFAULT 1,
  fallback_model TEXT DEFAULT 'claude-3-5-haiku-20241022',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL,
  downgraded INTEGER NOT NULL DEFAULT 0,
  failover_occurred INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL,
  status_code INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_tenant_time ON transactions(tenant_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp);

CREATE TABLE IF NOT EXISTS circuit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_circuit_events_time ON circuit_events(provider_id, timestamp);

CREATE TABLE IF NOT EXISTS failover_logs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  attempted_provider TEXT NOT NULL,
  failed_status_code INTEGER,
  error_message TEXT,
  next_provider TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 1,
  timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_failover_logs_time ON failover_logs(timestamp);

CREATE TABLE IF NOT EXISTS loop_detections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  argument_hash TEXT NOT NULL,
  cycle_count INTEGER NOT NULL,
  prevented_cost_usd REAL NOT NULL DEFAULT 0.0,
  timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_loop_detections_time ON loop_detections(timestamp);
