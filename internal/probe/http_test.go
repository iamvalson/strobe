package probe

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/iamvalson/strobe/internal/config"
)

func TestHTTPProbe(t *testing.T) {
	// Test that returns 200 OK
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()


	// Monitor pointing to our fake server
	m := config.MonitorConfig{
		ID:		"test-service",
		URL:	server.URL,
	}


	// Run the probe
	res := HTTP(context.Background(), m)


	// Assertions
	if res.StatusCode != 200 {
		t.Errorf("Expected status 200, got %d", res.StatusCode)
	}
	if res.RTT <= 0 {
		t.Errorf("Expected RTT to be positive, got %v", res.RTT)
	}
	if res.Error != nil {
		t.Errorf("Expected no error, got %v", res.Error)
	}
}