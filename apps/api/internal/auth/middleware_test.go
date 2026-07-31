package auth_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/shammalie/adversary/apps/api/internal/auth"
	"github.com/shammalie/adversary/apps/api/internal/config"
)

func TestMiddlewareOffIsNoop(t *testing.T) {
	cfg := &config.Config{AuthMode: "off"}
	r := chi.NewRouter()
	r.Use(auth.Middleware(cfg, nil))
	r.Post("/v1/scenarios", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusCreated)
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/scenarios", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("off mode should allow mutating routes without cookie; got %d", rr.Code)
	}
}

func TestMiddlewareSessionRequiresAuth(t *testing.T) {
	cfg := &config.Config{AuthMode: "session"}
	// svc non-nil with empty pool: LookupToken won't be called without cookie.
	svc := &auth.Service{}
	r := chi.NewRouter()
	r.Use(auth.Middleware(cfg, svc))
	r.Post("/v1/scenarios", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusCreated)
	})
	r.Get("/v1/scenarios", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	r.Get("/v1/geo/regions", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	r.Post("/v1/auth/login", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	r.Get("/v1/runs/x/ws/ops", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusSwitchingProtocols)
	})

	cases := []struct {
		method string
		path   string
		want   int
	}{
		{http.MethodPost, "/v1/scenarios", http.StatusUnauthorized},
		{http.MethodGet, "/v1/scenarios", http.StatusUnauthorized},
		{http.MethodGet, "/v1/runs/x/ws/ops", http.StatusUnauthorized},
		{http.MethodGet, "/v1/geo/regions", http.StatusOK},
		{http.MethodPost, "/v1/auth/login", http.StatusOK},
		{http.MethodGet, "/healthz", http.StatusOK},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		rr := httptest.NewRecorder()
		r.ServeHTTP(rr, req)
		if rr.Code != tc.want {
			t.Errorf("%s %s: got %d want %d body=%s", tc.method, tc.path, rr.Code, tc.want, rr.Body.String())
		}
	}

	// Unauthorized body shape
	req := httptest.NewRequest(http.MethodDelete, "/v1/scenarios/abc", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("delete: %d", rr.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["error"] != "authentication required" {
		t.Fatalf("error=%q", body["error"])
	}
}

func TestMiddlewareSessionRejectsBadCookie(t *testing.T) {
	cfg := &config.Config{AuthMode: "session"}
	svc := &auth.Service{} // nil Pool → LookupToken fails closed
	r := chi.NewRouter()
	r.Use(auth.Middleware(cfg, svc))
	r.Get("/v1/manage/stats", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/v1/manage/stats", nil)
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: "not-a-real-token"})
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("got %d want 401", rr.Code)
	}
}
