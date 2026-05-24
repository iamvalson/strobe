package dispatcher

import (
	"context"
	"time"

	"github.com/iamvalson/strobe/internal/config"
	"github.com/iamvalson/strobe/internal/worker"
)

// Run starts a dedicated goroutine per monitor and hot-reloads config changes
// received on controlChan. Sending a MonitorConfig with Disabled = true stops
// that monitor's goroutine without restarting it.
func Run(ctx context.Context, taskChan chan<- worker.Task, controlChan <-chan config.MonitorConfig) {
	// cancel funcs for every running monitor goroutine
	running := make(map[string]context.CancelFunc)

	for {
		select {
		case <-ctx.Done():
			return

		case m := <-controlChan:
			// Always cancel the old goroutine first (handles URL / interval updates)
			if stop, exists := running[m.ID]; exists {
				stop()
				delete(running, m.ID)
			}

			// Disabled monitors are parked — don't restart them.
			if m.Disabled {
				continue
			}

			mCtx, cancel := context.WithCancel(ctx)
			running[m.ID] = cancel

			go func(mon config.MonitorConfig, monCtx context.Context) {
				ticker := time.NewTicker(mon.Interval)
				defer ticker.Stop()

				for {
					select {
					case <-monCtx.Done():
						return
					case <-ticker.C:
						taskChan <- worker.Task{Monitor: mon}
					}
				}
			}(m, mCtx)
		}
	}
}
