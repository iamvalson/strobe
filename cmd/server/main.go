package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/go-chi/chi/v5"
	"github.com/iamvalson/strobe/internal/api"
	"github.com/iamvalson/strobe/internal/config"
	"github.com/iamvalson/strobe/internal/dispatcher"
	"github.com/iamvalson/strobe/internal/probe"
	"github.com/iamvalson/strobe/internal/store"
	"github.com/iamvalson/strobe/internal/worker"
	"github.com/iamvalson/strobe/internal/ws"
)

// dnsFailThreshold is the number of consecutive "no such host" errors after
// which a monitor is automatically disabled to stop wasting resources.
const dnsFailThreshold = 3

// isDNSNotFound returns true when the error is a permanent DNS resolution
// failure (the domain simply does not exist).
func isDNSNotFound(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "no such host") ||
		strings.Contains(msg, "name does not exist") ||
		strings.Contains(msg, "NXDOMAIN")
}

func main() {
	if os.Getenv("DATABASE_URL") == "" {
		os.Setenv("DATABASE_URL", "postgres://user:password@localhost:5432/strobe?sslmode=disable")
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("CONFIG ERROR: %v", err)
	}

	fmt.Println("Strobe Monitoring Engine Initialized")

	// Graceful Shutdown
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Initialise Store
	s, err := store.New(ctx, cfg.DatabaseURL, cfg.RedisURL)
	if err != nil {
		log.Fatalf("STORE ERROR: %v", err)
	}
	defer s.Close()

	// Run migrations
	fmt.Println("Running database migrations...")
	if err := s.Migrate(ctx); err != nil {
		log.Fatalf("MIGRATION ERROR: %v", err)
	}

	// WebSocket hub
	hub := ws.NewHub()
	go hub.Run()

	taskChan := make(chan worker.Task, 100)
	resultChan := make(chan probe.Result, 100)

	fmt.Println("Starting worker pool")
	worker.StartPool(ctx, 10, taskChan, resultChan)

	controlChan := make(chan config.MonitorConfig, 10)

	r := chi.NewRouter()
	apiHandler := api.NewHandler(s, controlChan)
	r.Handle("/ws", hub)
	r.Mount("/api", apiHandler.Routes())

	// Load existing monitors from DB — skip any that are already disabled.
	existing, _ := s.GetMonitors(ctx)
	for _, m := range existing {
		if !m.Disabled {
			controlChan <- m
		} else {
			fmt.Printf("[%s] Skipping disabled monitor (%s)\n", m.ID, m.DisabledReason)
		}
	}

	go func() {
		fmt.Printf("🌐 Server listening on :%s\n", cfg.Port)
		if err := http.ListenAndServe(":"+cfg.Port, r); err != nil {
			log.Fatalf("HTTP server failed: %v", err)
		}
	}()

	go dispatcher.Run(ctx, taskChan, controlChan)

	fmt.Println("Strobe Engine is LIVE. Press Ctrl+C to stop")

	// consecutiveDNSFails tracks how many back-to-back "no such host" errors
	// each monitor has produced. Reset to 0 on any successful check.
	consecutiveDNSFails := make(map[string]int)

	for {
		select {
		case <-ctx.Done():
			fmt.Println("\nShutting down Strobe...")
			return

		case res := <-resultChan:
			// ── DNS auto-disable logic ──────────────────────────────
			if isDNSNotFound(res.Error) {
				consecutiveDNSFails[res.MonitorID]++
				n := consecutiveDNSFails[res.MonitorID]

				log.Printf("[%s] DNS failure %d/%d: %v", res.MonitorID, n, dnsFailThreshold, res.Error)

				if n >= dnsFailThreshold {
					reason := res.Error.Error()
					log.Printf("[%s] Auto-disabling after %d consecutive DNS failures", res.MonitorID, n)

					if dbErr := s.DisableMonitor(ctx, res.MonitorID, reason); dbErr != nil {
						log.Printf("[%s] Failed to persist disabled state: %v", res.MonitorID, dbErr)
					}

					// Signal dispatcher to stop the goroutine.
					controlChan <- config.MonitorConfig{
						ID:             res.MonitorID,
						URL:            res.URL,
						Disabled:       true,
						DisabledReason: reason,
					}

					// Mark the result so the WS broadcast tells the frontend
					// to flip this monitor's card to the "paused" state immediately.
					res.Disabled = true
					res.DisabledReason = reason

					delete(consecutiveDNSFails, res.MonitorID)
				}
			} else {
				// Any non-DNS-failure (including transient errors or success) resets the counter.
				consecutiveDNSFails[res.MonitorID] = 0
			}

			// ── Persist & broadcast ─────────────────────────────────
			if err := s.SaveResult(ctx, res); err != nil {
				fmt.Printf("Database Save Error: %v\n", err)
			}

			hub.Broadcast(res)

			if res.Error != nil {
				fmt.Printf("[%s] %s -> Error: %v\n", res.MonitorID, res.URL, res.Error)
			} else {
				fmt.Printf("[%s] %s -> %d (%v)\n", res.MonitorID, res.URL, res.StatusCode, res.RTT)
			}
		}
	}
}
