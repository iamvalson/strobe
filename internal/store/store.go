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


func (s *Store) GetMonitors(ctx context.Context) ([]config.MonitorConfig, error){
	query := `SELECT id, url, interval_sec, timeout_sec FROM monitors`
	rows, err := s.pg.Query(ctx, query)
	if err != nil{
		return nil, err
	}
	defer rows.Close()

	var monitors []config.MonitorConfig
	for rows.Next(){
		var m config.MonitorConfig
		var iSec, tSec int
		if err := rows.Scan(&m.ID, &m.URL, &iSec, &tSec); err != nil {
			return nil, err
		}
		m.Interval = time.Duration(iSec) * time.Second
		m.Timeout = time.Duration(tSec) * time.Second
		monitors = append(monitors, m)
	}

	return monitors, nil
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

// Close connections
func (s *Store) Close() {
	s.pg.Close()
	s.redis.Close()
}