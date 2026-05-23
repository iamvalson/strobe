package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
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


func main() {
	if os.Getenv("DATABASE_URL") == "" {
		os.Setenv("DATABASE_URL", "postgres://user:password@localhost:5432/strobe?sslmode=disable")
	}

	cfg, err := config.Load()
	if err != nil{
		log.Fatalf("CONFIG ERROR: %v", err)
	}

	fmt.Println("Strobe Monitoring Engine Initialized")


	// Graceful Shutdown
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Intialize Store
	s, err := store.New(ctx, cfg.DatabaseURL, cfg.RedisURL)
	if err != nil {
		log.Fatalf("STORE ERROR: %v", err)
	}

	defer s.Close()

	// Run migration
	fmt.Println("Running database migrations...")
	if err := s.Migrate(ctx); err != nil {
		log.Fatalf("MIGRATION ERROR: %v", err)
	}



	// Initialize websocket hub
	hub := ws.NewHub()
	go hub.Run()


	// Initialize bin chan using buffered chan so the dispatcher doesn't get stuck if the workers are momentarily busy
	taskChan := make(chan worker.Task, 100)
	resultChan := make(chan probe.Result, 100)

	// Worker Pool
	fmt.Println("Starting worker pool")
	worker.StartPool(ctx, 10, taskChan, resultChan)

	// Control channel for dynamic updates
	controlChan := make(chan config.MonitorConfig, 10)

	r := chi.NewRouter()

	// API setup and Websocket routes
	apiHandler := api.NewHandler(s, controlChan)


	
	r.Handle("/ws", hub)
	r.Mount("/api", apiHandler.Routes())


	// Load existing monitors from DB on startup
	existing, _ := s.GetMonitors(ctx)
	for _, m := range existing {
		controlChan <- m
	}

	go func() {
    fmt.Printf("🌐 Server listening on :%s\n", cfg.Port)
    if err := http.ListenAndServe(":"+cfg.Port, r); err != nil {
        log.Fatalf(" HTTP server failed: %v", err)
    }
	}()


	go dispatcher.Run(ctx, taskChan, controlChan)



	fmt.Println("Strobe Engine is LIVE. Press Ctrl+C to stop")

	for {
		select {
		case <- ctx.Done():
			fmt.Println("\nShutting down Strobe...")
			return
		
		case res := <-resultChan:
			// Save to Database
			if err := s.SaveResult(ctx, res); err != nil{
				fmt.Printf("Database Save Error: %v\n", err)
			}

			hub.Broadcast(res)

			// Logs
			if res.Error != nil {
				fmt.Printf("[%s] %s -> Error: %v\n", res.MonitorID, res.URL, res.Error)
			} else{
				fmt.Printf("[%s] %s -> %d (%v)\n", res.MonitorID, res.URL, res.StatusCode, res.RTT)
			}

	}
}
}