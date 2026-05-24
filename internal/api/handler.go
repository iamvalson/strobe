package api

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/iamvalson/strobe/internal/config"
	"github.com/iamvalson/strobe/internal/store"
)

func generateID() string {
	b := make([]byte, 6)
	rand.Read(b)
	return fmt.Sprintf("%x", b)
}

type Handler struct {
	store		*store.Store
	controlChan	chan <- config.MonitorConfig
}


func NewHandler(s *store.Store, c chan <- config.MonitorConfig) *Handler{
	return &Handler{store: s, controlChan: c}
}


func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/monitors", h.ListMonitors)
	r.Post("/monitors", h.CreateMonitor)
	r.Get("/monitors/{id}/history", h.GetHistory)
	r.Patch("/monitors/{id}", h.UpdateMonitor)
	r.Delete("/monitors/{id}", h.DeleteMonitor)
	r.Post("/monitors/{id}/enable", h.EnableMonitor)
	return r
}


func (h *Handler) ListMonitors(w http.ResponseWriter, r *http.Request) {
	monitors, err := h.store.GetMonitors(r.Context())
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	json.NewEncoder(w).Encode(monitors)
}


func (h *Handler) CreateMonitor(w http.ResponseWriter, r *http.Request) {
	var m config.MonitorConfig
	if err := json.NewDecoder(r.Body).Decode(&m); err != nil {
		http.Error(w, "Invalid JSON", 400)
		return
	}

	if m.ID == "" {
		m.ID = generateID()
	}
	if m.Interval == 0 {
		m.Interval = 30 * time.Second
	}
	if m.Timeout == 0 {
		m.Timeout = 10 * time.Second
	}

	if err := h.store.SaveMonitor(r.Context(), m); err != nil {
		if errors.Is(err, store.ErrDuplicateURL) || errors.Is(err, store.ErrDuplicateID) {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	h.controlChan <- m

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(m)
}


// parseSince maps UI range tokens to durations. "1d" is not a valid Go duration
// string so we handle the supported set explicitly.
func parseSince(s string) time.Duration {
	switch s {
	case "5m":
		return 5 * time.Minute
	case "10m":
		return 10 * time.Minute
	case "1h":
		return time.Hour
	case "1d":
		return 24 * time.Hour
	default:
		d, _ := time.ParseDuration(s)
		return d
	}
}

func (h *Handler) GetHistory(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var since *time.Time
	if sinceStr := r.URL.Query().Get("since"); sinceStr != "" {
		if d := parseSince(sinceStr); d > 0 {
			t := time.Now().Add(-d)
			since = &t
		}
	}

	records, err := h.store.GetCheckHistory(r.Context(), id, since)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if records == nil {
		records = []store.CheckRecord{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(records)
}


func (h *Handler) UpdateMonitor(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	// Load existing monitor first so omitted fields keep their current values.
	all, err := h.store.GetMonitors(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	var current *config.MonitorConfig
	for i := range all {
		if all[i].ID == id {
			current = &all[i]
			break
		}
	}
	if current == nil {
		http.Error(w, "monitor not found", http.StatusNotFound)
		return
	}

	var body struct {
		URL         string `json:"url"`
		RawInterval string `json:"interval"`
		RawTimeout  string `json:"timeout"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Merge: only overwrite fields that were actually sent.
	m := *current
	if body.URL != "" {
		m.URL = body.URL
	}
	if body.RawInterval != "" {
		d, err := time.ParseDuration(body.RawInterval)
		if err != nil {
			http.Error(w, "invalid interval: "+err.Error(), http.StatusBadRequest)
			return
		}
		m.Interval = d
		m.RawInterval = body.RawInterval
	}
	if body.RawTimeout != "" {
		d, err := time.ParseDuration(body.RawTimeout)
		if err != nil {
			http.Error(w, "invalid timeout: "+err.Error(), http.StatusBadRequest)
			return
		}
		m.Timeout = d
		m.RawTimeout = body.RawTimeout
	}

	if err := h.store.UpdateMonitor(r.Context(), m); err != nil {
		if errors.Is(err, store.ErrDuplicateURL) {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Re-register with dispatcher so interval/URL changes take effect immediately.
	// If the monitor was disabled, keep it disabled — use /enable to restart.
	h.controlChan <- m

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(m)
}


// EnableMonitor clears the disabled flag and restarts the probe goroutine.
func (h *Handler) EnableMonitor(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	if err := h.store.EnableMonitor(r.Context(), id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Load the updated config and hand it to the dispatcher to restart probing.
	all, err := h.store.GetMonitors(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	for _, m := range all {
		if m.ID == id {
			h.controlChan <- m
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(m)
			return
		}
	}

	http.Error(w, "monitor not found", http.StatusNotFound)
}


// DeleteMonitor removes a monitor and all its history, then tells the
// dispatcher to stop probing it.
func (h *Handler) DeleteMonitor(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	// Load URL before deleting so we can build the control message.
	all, err := h.store.GetMonitors(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	var url string
	for _, m := range all {
		if m.ID == id {
			url = m.URL
			break
		}
	}
	if url == "" {
		http.Error(w, "monitor not found", http.StatusNotFound)
		return
	}

	if err := h.store.DeleteMonitor(r.Context(), id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Tell the dispatcher to stop the goroutine for this monitor.
	h.controlChan <- config.MonitorConfig{
		ID:       id,
		URL:      url,
		Disabled: true,
	}

	w.WriteHeader(http.StatusNoContent)
}