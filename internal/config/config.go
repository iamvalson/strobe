package config

import (
	"encoding/json"
	"fmt"
	"os"
	"time"
)

// Monitor parameters for health checks
type MonitorConfig struct {
	ID             string        `json:"id"`
	URL            string        `json:"url"`
	Interval       time.Duration `json:"-"`
	Timeout        time.Duration `json:"-"`
	RawInterval    string        `json:"interval"`
	RawTimeout     string        `json:"timeout"`
	Disabled       bool          `json:"disabled"`
	DisabledReason string        `json:"disabled_reason,omitempty"`
}


type Config struct {
	Port		string
	DatabaseURL	string
	RedisURL	string
	Monitors	[]MonitorConfig
}


func Load() (*Config, error) {
	cfg := &Config{
		Port:			getEnv("PORT", "8080"),
		DatabaseURL: 	os.Getenv("DATABASE_URL"),
		RedisURL: 		getEnv("REDIS_URL", "localhost:6379"),
	}

	// Check if the Database URL exists
	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL environment variable is required")
	}

	// Read and parse monitors.json
	data, err := os.ReadFile("monitors.json")
	if err != nil {
		return nil, fmt.Errorf("Could not read monitor.json: %w", err)
	}

	var monitors []MonitorConfig
	if err := json.Unmarshal(data, &monitors); err != nil {
		return nil, fmt.Errorf("Failed to parse JSON: %w", err)
	}

	// Converting "10s" strings into real time.Duration objects
	for i := range monitors {
		intv, err := time.ParseDuration(monitors[i].RawInterval)
		if err != nil {
			return nil, fmt.Errorf("Invalid interval for %s: %w", monitors[i].ID, err)
		}

		tout, err := time.ParseDuration(monitors[i].RawTimeout)
		if err != nil {
			return nil, fmt.Errorf("Invalid timeout for %s: %w", monitors[i].ID, err)
		}
		monitors[i].Interval = intv
		monitors[i].Timeout = tout
	}

	cfg.Monitors = monitors
	return cfg, nil
	
}


func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}


