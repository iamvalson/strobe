package store

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/iamvalson/strobe/internal/probe"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type Store struct {
	pg *pgxpool.Pool
	redis *redis.Client
}


// Migrate runs the initial SQL setup
func (s *Store) Migrate(ctx context.Context) error {
	// Read migration file
	content, err := os.ReadFile("migrations/001_create_checks_table.sql")
	if err != nil {
		return fmt.Errorf("could not read migration file: %w", err)
	}

	// Execute the SQL
	_, err = s.pg.Exec(ctx, string(content))
	if err != nil {
		return fmt.Errorf("migration failed: %w", err)
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