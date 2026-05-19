package main

import (
	"fmt"
	"log"
	"os"

	"github.com/iamvalson/strobe/internal/config"
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
	fmt.Printf("Running on port: %s\n", cfg.Port)
	fmt.Printf("Loaded %d monitors from monitors.json\n\n", len(cfg.Monitors))


	for _, m := range cfg.Monitors {
		fmt.Printf("[%s] Target: %s | Every: %v | Timeout: %v\n", m.ID, m.URL, m.Interval, m.Timeout)
	}
}