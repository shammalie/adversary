package scenario_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/shammalie/adversary/apps/api/internal/scenario"
)

func TestValidateExampleFixture(t *testing.T) {
	raw := loadWebFixture(t, "example-scenario.json")
	issues := scenario.ValidateBytes(raw)
	if len(issues) != 0 {
		t.Fatalf("expected valid fixture, got issues: %+v", issues)
	}
}

func TestValidateIncompleteDraftOKForIssues(t *testing.T) {
	payload := map[string]any{
		"schemaVersion": 2,
		"id":            "11111111-1111-1111-1111-111111111111",
		"name":          "",
		"createdAt":     "2024-01-01T00:00:00.000Z",
		"updatedAt":     "2024-01-01T00:00:00.000Z",
		"priorityTerms": []any{},
		"targets":       []any{},
		"events":        []any{},
	}
	issues := scenario.Validate(payload)
	if len(issues) == 0 {
		t.Fatal("expected validation issues for incomplete draft")
	}
	foundName := false
	for _, issue := range issues {
		if issue.Field == "name" || issue.Path == "name" {
			foundName = true
		}
	}
	if !foundName {
		t.Fatalf("expected name issue, got %+v", issues)
	}
}

func TestMigrateV1ToV2(t *testing.T) {
	legacy := map[string]any{
		"schemaVersion": 1,
		"id":            "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
		"name":          "Legacy op",
		"createdAt":     "2024-01-01T00:00:00.000Z",
		"updatedAt":     "2024-01-01T00:00:00.000Z",
		"targets": []any{
			map[string]any{
				"id":            "t1",
				"callsign":      "ALPHA",
				"startsUnknown": true,
				"color":         "#112233",
				"initialProfile": map[string]any{
					"vehicleCategory": "rail",
					"affiliation":     "hostile",
					"status":          "active",
				},
			},
		},
		"events": []any{
			map[string]any{
				"id": "e1", "targetId": "t1", "at": "2024-01-01T00:01:00.000Z",
				"type": "position", "latitude": 1.0, "longitude": 2.0, "altitude": 0.0, "speed": 10.0,
				"heading": 0.0, "course": 0.0,
			},
			map[string]any{
				"id": "e2", "targetId": "t1", "at": "2024-01-01T00:02:00.000Z",
				"type": "message", "priority": 1, "message": "Critical contact near channel",
			},
		},
	}
	migrated, err := scenario.MigrateToV2(legacy)
	if err != nil {
		t.Fatal(err)
	}
	doc, issues := scenario.ParseValid(migrated)
	if len(issues) != 0 {
		t.Fatalf("migrated doc invalid: %+v", issues)
	}
	if doc.SchemaVersion != 2 {
		t.Fatalf("schemaVersion=%d", doc.SchemaVersion)
	}
	if doc.Targets[0].Profile.VehicleCategory != "other" {
		t.Fatalf("expected rail→other, got %q", doc.Targets[0].Profile.VehicleCategory)
	}
	if !doc.Targets[0].RevealOnFirstEvent {
		t.Fatal("startsUnknown should map to revealOnFirstEvent")
	}
	if len(doc.Events) < 2 {
		t.Fatalf("expected events, got %d", len(doc.Events))
	}
}

func TestEnsurePayloadID(t *testing.T) {
	id := "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
	out := scenario.EnsurePayloadID(map[string]any{"name": "x"}, id)
	m := out.(map[string]any)
	if m["id"] != id {
		t.Fatalf("id=%v", m["id"])
	}
}

func loadWebFixture(t *testing.T, name string) []byte {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	path := filepath.Join(filepath.Dir(file), "..", "..", "..", "web", "src", "lib", "fixtures", name)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	// Sanity: JSON
	var probe any
	if err := json.Unmarshal(raw, &probe); err != nil {
		t.Fatal(err)
	}
	return raw
}
