

CREATE TABLE IF NOT EXISTS monitors (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    interval_sec INT NOT NULL DEFAULT 30,
    timeout_sec INT NOT NULL DEFAULT 10,
    created_at TIMESTAMPTZ DEFAULT NOW()
)