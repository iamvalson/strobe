
CREATE TABLE IF NOT EXISTS checks (
    id SERIAL PRIMARY KEY,
    monitor_id TEXT NOT NULL,
    url TEXT NOT NULL,
    status_code INT,
    latency_ms INT,
    error_msg TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_checks_monitor_id ON
checks(monitor_id)