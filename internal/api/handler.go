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