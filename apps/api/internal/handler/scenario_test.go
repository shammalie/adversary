package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shammalie/adversary/apps/api/internal/config"
	"github.com/shammalie/adversary/apps/api/internal/db"
	"github.com/shammalie/adversary/apps/api/internal/handler"
	"github.com/shammalie/adversary/apps/api/internal/store"
)

func openPool(t *testing.T, dsn string) (*pgxpool.Pool, error) {
	t.Helper()
	return db.NewPool(context.Background(), dsn)
}

// integration-style tests against DATABASE_URL when set (Compose postgres).
func TestScenarioDraftPublishImport(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	pool, err := openPool(t, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	sc := &handler.ScenarioHandlers{Store: &store.ScenarioStore{Pool: pool}}
	mux := handler.NewRouter(&config.Config{AuthMode: "off"}, nil, nil, sc, nil, nil, nil)

	// Create empty draft
	req := httptest.NewRequest(http.MethodPost, "/v1/scenarios", bytes.NewBufferString(`{}`))
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rr.Code, rr.Body.String())
	}
	var created map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	id := created["id"].(string)
	if created["status"] != "draft" {
		t.Fatalf("status=%v", created["status"])
	}
	issues, _ := created["issues"].([]any)
	if len(issues) == 0 {
		t.Fatal("empty draft should include validation issues")
	}

	// Autosave invalid draft (missing events for target)
	draftID := uuid.MustParse(id)
	incomplete := map[string]any{
		"schemaVersion": 2,
		"id":            draftID.String(),
		"name":          "WIP",
		"createdAt":     "2024-01-01T00:00:00.000Z",
		"updatedAt":     "2024-01-01T00:00:00.000Z",
		"priorityTerms": []any{},
		"targets": []any{
			map[string]any{
				"id": "t1", "callsign": "ONE", "revealOnFirstEvent": false, "appearOnFirstEvent": false,
				"color": "#abcdef",
				"profile": map[string]any{
					"vehicleCategory": "boat", "affiliation": "unknown", "status": "active",
				},
			},
		},
		"events": []any{},
	}
	body, _ := json.Marshal(incomplete)
	req = httptest.NewRequest(http.MethodPut, "/v1/scenarios/"+id+"/draft", bytes.NewReader(body))
	rr = httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("draft: %d %s", rr.Code, rr.Body.String())
	}
	var drafted map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &drafted)
	if drafted["status"] != "draft" {
		t.Fatalf("draft status=%v", drafted["status"])
	}

	// Publish should 422
	req = httptest.NewRequest(http.MethodPost, "/v1/scenarios/"+id+"/publish", nil)
	rr = httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("publish incomplete: %d %s", rr.Code, rr.Body.String())
	}

	// Import valid fixture → ready
	fixture := loadExample(t)
	req = httptest.NewRequest(http.MethodPost, "/v1/scenarios/import", bytes.NewReader(fixture))
	rr = httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("import: %d %s", rr.Code, rr.Body.String())
	}
	var imported map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &imported)
	if imported["status"] != "ready" {
		t.Fatalf("import status=%v body=%s", imported["status"], rr.Body.String())
	}
	impID := imported["id"].(string)

	targets, events, err := sc.Store.CountNormalized(t.Context(), uuid.MustParse(impID))
	if err != nil {
		t.Fatal(err)
	}
	if targets < 1 || events < 1 {
		t.Fatalf("normalized counts targets=%d events=%d", targets, events)
	}

	// List ready-only
	req = httptest.NewRequest(http.MethodGet, "/v1/scenarios?status=ready", nil)
	rr = httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("list: %d", rr.Code)
	}

	// Cleanup
	for _, delID := range []string{id, impID} {
		req = httptest.NewRequest(http.MethodDelete, "/v1/scenarios/"+delID, nil)
		rr = httptest.NewRecorder()
		mux.ServeHTTP(rr, req)
		if rr.Code != http.StatusNoContent {
			t.Fatalf("delete %s: %d", delID, rr.Code)
		}
	}
}

func loadExample(t *testing.T) []byte {
	t.Helper()
	_, file, _, _ := runtime.Caller(0)
	path := filepath.Join(filepath.Dir(file), "..", "..", "..", "web", "src", "lib", "fixtures", "example-scenario.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
