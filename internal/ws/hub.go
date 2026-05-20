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
	CheckOrigin: func(r *http.Request) bool {return true},
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
		clients: make(map[*websocket.Conn]bool),
		broadcast: make(chan probe.Result),
	}
}


// Hub service
func (h *Hub) Run() {
	for {
		// Wait for new result from a worker
		res := <-h.broadcast

		out := struct {
			MonitorID  string  `json:"monitor_id"`
			URL        string  `json:"url"`
			StatusCode int     `json:"status_code"`
			RTT        int64   `json:"rtt_ms"`
			Error      string  `json:"error"`
			CheckedAt  string  `json:"checked_at"`
		}{
			MonitorID:  res.MonitorID,
			URL:        res.URL,
			StatusCode: res.StatusCode,
			RTT:        res.RTT.Milliseconds(),
			CheckedAt:  res.CheckedAt.Format("15:04:05"),
		}

		if res.Error != nil {
			out.Error = res.Error.Error()
		}

		payload, _ := json.Marshal(out)

		h.mu.Lock()

		for client := range h.clients {
			err := client.WriteMessage(websocket.TextMessage, payload)

			if err != nil {
				log.Printf("Websocket error: %v", err)

				client.Close()
				delete(h.clients, client)
			}
		}

		h.mu.Unlock()
	}
}



// ServeHTTP handles websocket requests from the peer
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Upgrade error: %v", err)
		return
	}

	h.mu.Lock()
	h.clients[conn] = true
	h.mu.Unlock()

	log.Printf("New browser connected. Total clients: %d", len(h.clients))
}


// Send a result to the hub channel
func (h *Hub) Broadcast(res probe.Result) {
	h.broadcast <- res
}