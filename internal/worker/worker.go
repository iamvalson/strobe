package worker

import (
	"context"

	"github.com/iamvalson/strobe/internal/config"
	"github.com/iamvalson/strobe/internal/probe"
)

type Task struct {
	Monitor config.MonitorConfig
}


// StartPool with n workers that wait for tasks on taskChan
func StartPool(ctx context.Context, n int, tasks <- chan Task, results chan<- probe.Result) {
	for i := 0; i < n; i++{
		go func(workerID int){
			for {
				select{
				case <-ctx.Done():
					return
				
				case task, ok := <-tasks:
					if !ok {
						return
					}

					// Execute the probe
					probeCtx, cancel := context.WithTimeout(ctx, task.Monitor.Timeout)

					res := probe.HTTP(probeCtx, task.Monitor)
					cancel()

					// Send the results to result chan
					results <- res
				}
			}
		}(i)
	}
}