package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/iamvalson/strobe/internal/config"
	"github.com/iamvalson/strobe/internal/probe"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

var ErrDuplicateURL = errors.New("a monitor with that URL already exists")
var ErrDuplicateID  = errors.New("a monitor with that ID already exists")

type Store struct {
	pg *pgxpool.Pool
	redis *redis.Client
}


// Migrate runs all SQL files in the migrations directory in alphabetical order.
func (s *Store) Migrate(ctx context.Context) error {
	entries, err := os.ReadDir("migrations")
	if err != nil {
		return fmt.Errorf("could not read migrations dir: %w", err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		content, err := os.ReadFile(filepath.Join("migrations", entry.Name()))
		if err != nil {
			return fmt.Errorf("could not read %s: %w", entry.Name(), err)
		}
		if _, err := s.pg.Exec(ctx, string(content)); err != nil {
			return fmt.Errorf("migration %s failed: %w", entry.Name(), err)
		}
	}
	return nil
}


// Initialize connections to both Postgrs and Redis
func New(ctx context.Context, pgURL, redisURL string) (*Store, error) {
	// Connect to Postgres using Connection Pool
	pg, err := pgxpool.New(ctx, pgURL)
	if err != nil{
		return nil, fmt.Errorf("postgres connect error: %w", err)
	}

	// Connect to Redis
	rdb := redis.NewClient(&redis.Options{
		Addr: redisURL,
	})

	// Test Redis Connection
	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("redis connect error: %w", err)
	}


	return &Store{
		pg: pg, redis: rdb,
	}, nil
}



func (s *Store) SaveMonitor(ctx context.Context, m config.MonitorConfig) error {
	query := `INSERT INTO monitors (id, url, interval_sec, timeout_sec) VALUES ($1, $2, $3, $4)`

	_, err := s.pg.Exec(ctx, query, m.ID, m.URL, int(m.Interval.Seconds()), int(m.Timeout.Seconds()))
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			if pgErr.ConstraintName == "monitors_url_unique" {
				return ErrDuplicateURL
			}
			return ErrDuplicateID
		}
		return err
	}
	return nil
}


// formatDuration converts a Duration to a compact human string (e.g. "30s", "2m", "1h").
func formatDuration(d time.Duration) string {
	if d == 0 {
		return "0s"
	}
	if d%time.Hour == 0 {
		return fmt.Sprintf("%dh", int(d.Hours()))
	}
	if d%time.Minute == 0 {
		return fmt.Sprintf("%dm", int(d.Minutes()))
	}
	return fmt.Sprintf("%ds", int(d.Seconds()))
}

func (s *Store) GetMonitors(ctx context.Context) ([]config.MonitorConfig, error) {
	query := `SELECT id, url, interval_sec, timeout_sec, disabled, disabled_reason FROM monitors`
	rows, err := s.pg.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var monitors []config.MonitorConfig
	for rows.Next() {
		var m config.MonitorConfig
		var iSec, tSec int
		if err := rows.Scan(&m.ID, &m.URL, &iSec, &tSec, &m.Disabled, &m.DisabledReason); err != nil {
			return nil, err
		}
		m.Interval = time.Duration(iSec) * time.Second
		m.Timeout = time.Duration(tSec) * time.Second
		m.RawInterval = formatDuration(m.Interval)
		m.RawTimeout = formatDuration(m.Timeout)
		monitors = append(monitors, m)
	}
	return monitors, nil
}

// DisableMonitor marks a monitor as disabled so the dispatcher stops probing it.
func (s *Store) DisableMonitor(ctx context.Context, id, reason string) error {
	_, err := s.pg.Exec(ctx,
		`UPDATE monitors SET disabled = TRUE, disabled_reason = $2 WHERE id = $1`,
		id, reason,
	)
	return err
}

// EnableMonitor clears the disabled flag and reason so the monitor can be restarted.
func (s *Store) EnableMonitor(ctx context.Context, id string) error {
	_, err := s.pg.Exec(ctx,
		`UPDATE monitors SET disabled = FALSE, disabled_reason = '' WHERE id = $1`,
		id,
	)
	return err
}



// Write result to Postgres history and redis current state
func (s *Store) SaveResult(ctx context.Context, res probe.Result) error{
	// Save to Pg
	query := `INSERT INTO checks (monitor_id, url, status_code, latency_ms, error_msg)
	VALUES ($1, $2, $3, $4, $5)`
	errMsg := ""
	if res.Error != nil {
		errMsg = res.Error.Error()
	}

	_, err := s.pg.Exec(ctx, query, res.MonitorID, res.URL, res.StatusCode, res.RTT.Milliseconds(), errMsg)
	if err != nil {
		return fmt.Errorf("postgres save error: %w", err)
	}


	// Save to Redis (Last Known Status)
	// Key format: monitor:google:latest
	redisKey := fmt.Sprintf("monitor:%s:latest", res.MonitorID)

	// Marshal to JSON
	data, _ := json.Marshal(res)


	// Store in Redis with no expiration
	err = s.redis.Set(ctx, redisKey, data, 0).Err()
	if err != nil{
		return fmt.Errorf("redis save error: %w", err)
	}

	return nil

}

// CheckRecord is a single row from the checks table.
type CheckRecord struct {
	ID         int       `json:"id"`
	MonitorID  string    `json:"monitor_id"`
	URL        string    `json:"url"`
	StatusCode int       `json:"status_code"`
	LatencyMs  int       `json:"latency_ms"`
	ErrorMsg   string    `json:"error_msg"`
	CreatedAt  time.Time `json:"created_at"`
}

// GetCheckHistory returns checks for a monitor in chronological order.
// If since is non-nil, all checks after that timestamp are returned (capped at 1 440).
// If since is nil, the most-recent 120 checks are returned.
func (s *Store) GetCheckHistory(ctx context.Context, monitorID string, since *time.Time) ([]CheckRecord, error) {
	if since != nil {
		return s.checksSince(ctx, monitorID, *since)
	}
	return s.checksRecent(ctx, monitorID, 120)
}

func (s *Store) checksSince(ctx context.Context, monitorID string, since time.Time) ([]CheckRecord, error) {
	rows, err := s.pg.Query(ctx, `
		SELECT id, monitor_id, url, status_code, latency_ms, COALESCE(error_msg,''), created_at
		FROM   checks
		WHERE  monitor_id = $1 AND created_at >= $2
		ORDER  BY created_at ASC
		LIMIT  1440
	`, monitorID, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCheckRows(rows)
}

func (s *Store) checksRecent(ctx context.Context, monitorID string, limit int) ([]CheckRecord, error) {
	rows, err := s.pg.Query(ctx, `
		SELECT id, monitor_id, url, status_code, latency_ms, COALESCE(error_msg,''), created_at
		FROM   checks
		WHERE  monitor_id = $1
		ORDER  BY created_at DESC
		LIMIT  $2
	`, monitorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	records, err := scanCheckRows(rows)
	if err != nil {
		return nil, err
	}
	// Reverse DESC result to chronological order
	for i, j := 0, len(records)-1; i < j; i, j = i+1, j-1 {
		records[i], records[j] = records[j], records[i]
	}
	return records, nil
}

// scanCheckRows is a shared row scanner for both history queries.
func scanCheckRows(rows interface {
	Next() bool
	Scan(dest ...any) error
	Close()
}) ([]CheckRecord, error) {
	defer rows.Close()
	var records []CheckRecord
	for rows.Next() {
		var r CheckRecord
		if err := rows.Scan(&r.ID, &r.MonitorID, &r.URL, &r.StatusCode, &r.LatencyMs, &r.ErrorMsg, &r.CreatedAt); err != nil {
			return nil, err
		}
		records = append(records, r)
	}
	return records, nil
}

// DeleteMonitor removes a monitor and all its check history from the database.
func (s *Store) DeleteMonitor(ctx context.Context, id string) error {
	tag, err := s.pg.Exec(ctx, `DELETE FROM monitors WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("monitor %q not found", id)
	}
	// Best-effort: remove the cached latest result from Redis.
	s.redis.Del(ctx, fmt.Sprintf("monitor:%s:latest", id))
	return nil
}

// UpdateMonitor overwrites the URL, interval, and timeout for an existing monitor.
func (s *Store) UpdateMonitor(ctx context.Context, m config.MonitorConfig) error {
	query := `
		UPDATE monitors
		SET url = $2, interval_sec = $3, timeout_sec = $4
		WHERE id = $1
	`
	tag, err := s.pg.Exec(ctx, query, m.ID, m.URL, int(m.Interval.Seconds()), int(m.Timeout.Seconds()))
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return ErrDuplicateURL
		}
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("monitor %q not found", m.ID)
	}
	return nil
}

// Close connections
func (s *Store) Close() {
	s.pg.Close()
	s.redis.Close()
}