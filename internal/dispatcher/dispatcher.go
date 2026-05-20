package dispatcher

import (
	"context"
	"time"

	"github.com/iamvalson/strobe/internal/config"
	"github.com/iamvalson/strobe/internal/worker"
)

// Run func starts a dedicated goroutine for every monitor to track its own interval
func Run(ctx context.Context, monitors []config.MonitorConfig, taskChan chan<- worker.Task){
	for _, m := range monitors{
		go func(mon config.MonitorConfig) {
			ticker := time.NewTicker(mon.Interval)
			defer ticker.Stop()

			for {
				select {
				case <- ctx.Done():
					return

				case <- ticker.C:
					// Send task to the workers

					taskChan <- worker.Task{Monitor: mon}
				}
			}
		}(m)
	}
}