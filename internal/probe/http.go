package probe

import (
	"context"
	"net/http"
	"time"

	"github.com/iamvalson/strobe/internal/config"
)

type Result struct {
	MonitorID      string
	URL            string
	StatusCode     int
	RTT            time.Duration
	Error          error
	CheckedAt      time.Time
	// Disabled is set to true (by main.go) when this result is the one that
	// triggers an auto-disable so the frontend can update without polling.
	Disabled       bool
	DisabledReason string
}


var client = &http.Client{}



// HTTP performs a single GET request and measures the performance
func HTTP(ctx context.Context, m config.MonitorConfig) Result {
	result := Result{
		MonitorID: m.ID,
		URL: m.URL,
		CheckedAt: time.Now(),
	}


	// Create request with context
	req, err := http.NewRequestWithContext(ctx, "GET", m.URL, nil)
	if err != nil{
		result.Error = err
		return result
	}

	// Start the timer
	start := time.Now()


	// Execute request
	res, err := client.Do(req)
	if err != nil {
		result.Error = err
		return result
	}


	// Clean-up
	defer res.Body.Close()


	// Record metrics
	result.RTT = time.Since(start)
	result.StatusCode = res.StatusCode

	return result
}