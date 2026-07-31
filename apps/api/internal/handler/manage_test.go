package handler_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/shammalie/adversary/apps/api/internal/config"
	"github.com/shammalie/adversary/apps/api/internal/handler"
	"github.com/shammalie/adversary/apps/api/internal/store"
)

func TestManageListStatsUsageDelete(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	pool, err := openPool(t, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	scStore := &store.ScenarioStore{Pool: pool}
	sc := &handler.ScenarioHandlers{Store: scStore}
	mg := &handler.ManageHandlers{Store: scStore, Manager: nil}
	mux := handler.NewRouter(&config.Config{AuthMode: "off"}, nil, nil, sc, nil, nil, mg)

	// Create draft with client id attribution
	req := httptest.NewRequest(http.MethodPost, "/v1/scenarios", bytes.NewBufferString(`{"name":"manage-test"}`))
	req.Header.Set("X-Client-Id", "test-client-1")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rr.Code, rr.Body.String())
	}
	var created map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &created)
	id := created["id"].(string)

	// Manage list
	req = httptest.NewRequest(http.MethodGet, "/v1/manage/scenarios?q=manage-test", nil)
	rr = httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("list: %d %s", rr.Code, rr.Body.String())
	}
	var list store.ManageListResult
	if err := json.Unmarshal(rr.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range list.Items {
		if item.ID == id {
			found = true
			if item.SizeBytes <= 0 {
				t.Fatalf("expected sizeBytes > 0, got %d", item.SizeBytes)
			}
			if item.Status != "draft" {
				t.Fatalf("status=%s", item.Status)
			}
		}
	}
	if !found {
		t.Fatal("created scenario missing from manage list")
	}

	// Stats
	req = httptest.NewRequest(http.MethodGet, "/v1/manage/stats", nil)
	rr = httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("stats: %d %s", rr.Code, rr.Body.String())
	}
	var stats store.ManageStats
	_ = json.Unmarshal(rr.Body.Bytes(), &stats)
	if stats.ScenarioCount < 1 || stats.DraftCount < 1 {
		t.Fatalf("stats=%+v", stats)
	}

	// Usage metrics filtered by clientId
	req = httptest.NewRequest(http.MethodGet, "/v1/manage/metrics/usage?clientId=test-client-1&bucket=1h", nil)
	rr = httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("usage: %d %s", rr.Code, rr.Body.String())
	}
	var usage store.UsageMetricsResult
	if err := json.Unmarshal(rr.Body.Bytes(), &usage); err != nil {
		t.Fatal(err)
	}
	if usage.Totals["scenario.draft_saved"] < 1 {
		t.Fatalf("expected draft_saved usage, totals=%v", usage.Totals)
	}

	// Prometheus scrape
	req = httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rr = httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("metrics: %d", rr.Code)
	}
	body := rr.Body.String()
	if !strings.Contains(body, "adversary_http_requests_total") {
		t.Fatal("missing adversary_http_requests_total")
	}
	if !strings.Contains(body, "adversary_runs_active") {
		t.Fatal("missing adversary_runs_active")
	}

	// Delete via manage
	req = httptest.NewRequest(http.MethodDelete, "/v1/manage/scenarios/"+id, nil)
	rr = httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", rr.Code, rr.Body.String())
	}

	// Bulk delete empty / invalid
	req = httptest.NewRequest(http.MethodPost, "/v1/manage/scenarios/bulk-delete",
		bytes.NewBufferString(`{"ids":["`+uuid.NewString()+`"]}`))
	rr = httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("bulk: %d %s", rr.Code, rr.Body.String())
	}
	var bulk map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &bulk)
	failed, _ := bulk["failed"].(map[string]any)
	if len(failed) != 1 {
		t.Fatalf("expected 1 failed, got %v", bulk)
	}
}

func TestMetricsStatusClassUnit(t *testing.T) {
	// Smoke: router mounts /metrics without DB.
	mux := handler.NewRouter(&config.Config{AuthMode: "off"}, nil, nil, nil, nil, nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("healthz: %d", rr.Code)
	}
	req = httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rr = httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("metrics: %d", rr.Code)
	}
}
