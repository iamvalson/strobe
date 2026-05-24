package ws

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/iamvalson/strobe/internal/probe"
)

var upgrader = websocket.Upgrader{
	// Allow react to connect
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Hub struct {
	// Registered clients
	clients map[*websocket.Conn]bool

	// Inbound messages from the workers
	broadcast chan probe.Result

	// Mutex to protect the clients map from concurrent access
	mu sync.Mutex
}

func NewHub() *Hub {
	return &Hub{
		clients:   make(map[*websocket.Conn]bool),
		broadcast: make(chan probe.Result),
	}
}

// Run fans out each probe result to every connected browser.
func (h *Hub) Run() {
	for {
		res := <-h.broadcast

		out := struct {
			MonitorID      string `json:"monitor_id"`
			URL            string `json:"url"`
			StatusCode     int    `json:"status_code"`
			RTT            int64  `json:"rtt_ms"`
			Error          string `json:"error"`
			CheckedAt      string `json:"checked_at"`
			Disabled       bool   `json:"disabled,omitempty"`
			DisabledReason string `json:"disabled_reason,omitempty"`
		}{
			MonitorID:      res.MonitorID,
			URL:            res.URL,
			StatusCode:     res.StatusCode,
			RTT:            res.RTT.Milliseconds(),
			CheckedAt:      res.CheckedAt.Format("15:04:05"),
			Disabled:       res.Disabled,
			DisabledReason: res.DisabledReason,
		}

		if res.Error != nil {
			out.Error = res.Error.Error()
		}

		payload, _ := json.Marshal(out)

		h.mu.Lock()
		for client := range h.clients {
			if err := client.WriteMessage(websocket.TextMessage, payload); err != nil {
				// Write failed — client already gone; clean up silently.
				client.Close()
				delete(h.clients, client)
			}
		}
		h.mu.Unlock()
	}
}

// ServeHTTP upgrades the connection and registers the client.
// A per-connection read goroutine is required by gorilla/websocket:
// it keeps the connection healthy (handles pings/pongs) and detects
// client-side disconnects without waiting for the next write to fail.
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Upgrade error: %v", err)
		return
	}

	h.mu.Lock()
	h.clients[conn] = true
	n := len(h.clients)
	h.mu.Unlock()

	log.Printf("Browser connected. Total clients: %d", n)

	// Read loop: drains client frames (browsers rarely send any, but
	// gorilla/websocket needs this to process control frames like pings and
	// close handshakes). When ReadMessage returns the client has disconnected.
	go func() {
		defer func() {
			h.mu.Lock()
			delete(h.clients, conn)
			remaining := len(h.clients)
			h.mu.Unlock()
			conn.Close()
			log.Printf("Browser disconnected. Total clients: %d", remaining)
		}()
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()
}

// Broadcast sends a result to the hub channel.
func (h *Hub) Broadcast(res probe.Result) {
	h.broadcast <- res
}
