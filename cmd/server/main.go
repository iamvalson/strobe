package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/iamvalson/strobe/internal/config"
	"github.com/iamvalson/strobe/internal/probe"
)


func main() {
	if os.Getenv("DATABASE_URL") == "" {
		os.Setenv("DATABASE_URL", "postgres://localhost:5432/strobe")
	}

	cfg, err := config.Load()
	if err != nil{
		log.Fatalf("CONFIG ERROR: %v", err)
	}

	fmt.Println("Strobe Monitoring Engine Initialized")


	// Graceful Shutdown
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()


	fmt.Println("Press Ctrl+C to stop")


	// Start ticker as a general pulse
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()


	for {
		select {
		case <- ctx.Done():
			fmt.Println("\nShutting down Strobe...")
			return
		
		case t := <-ticker.C:
			fmt.Printf("\n--- Pulse at %v ---\n", t.Format("15:04:05"))

			for _, m := range cfg.Monitors{
				// Create a specific timeout context for this individual probe

				probeCtx, cancel := context.WithTimeout(ctx, m.Timeout)

				res := probe.HTTP(probeCtx, m)
				cancel()

				if res.Error != nil {
					fmt.Printf("[%s] %s -> Error: %v\n", m.ID, m.URL, res.Error)
				} else {
					fmt.Printf("[%s] %s -> %d (%v)\n", m.ID, m.URL, res.StatusCode, res.RTT)
				}
			}
		}
	}
}