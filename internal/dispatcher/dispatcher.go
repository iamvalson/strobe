package dispatcher

import (
	"context"
	"time"

	"github.com/iamvalson/strobe/internal/config"
	"github.com/iamvalson/strobe/internal/worker"
)

// Run func starts a dedicated goroutine for every monitor to track its own interval
func Run(ctx context.Context, taskChan chan<- worker.Task, controlChan <- chan config.MonitorConfig){
	// Map to track the 'Stop' signal for every running monitor
	running := make(map[string]context.CancelFunc)


	for {
		select {
		case <-ctx.Done():
			return
		
		case m := <- controlChan:
			// If this monitor is already running stop the old version first
			if stopOld, exists := running[m.ID]; exists{
				stopOld()
			}

			// Create a child context specifically for this monitor's goroutine
			mCtx, cancel := context.WithCancel(ctx)
			running[m.ID] = cancel

			// Spawn the goroutine for this specific monitor
			go func(mon config.MonitorConfig, monCtx context.Context) {
			ticker := time.NewTicker(mon.Interval)
			defer ticker.Stop()

			for {
				select {
				case <- monCtx.Done():
					return

				case <- ticker.C:
					// Send task to the workers

					taskChan <- worker.Task{Monitor: mon}
				}
			}
		}(m, mCtx)
		}
	}

	
}