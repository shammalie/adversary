package simulation_test

import (
	"testing"
	"time"

	"github.com/shammalie/adversary/apps/api/internal/scenario"
	"github.com/shammalie/adversary/apps/api/internal/simulation"
)

func testScenario() scenario.SimulationScenario {
	return scenario.SimulationScenario{
		SchemaVersion: 2,
		ID:            "scenario-1",
		Name:          "Test",
		CreatedAt:     "2026-07-24T12:00:00.000Z",
		UpdatedAt:     "2026-07-24T12:00:00.000Z",
		PriorityTerms: []string{"critical"},
		Targets: []scenario.TargetDefinition{
			{
				ID:                 "target-1",
				Callsign:           "TEST 01",
				RevealOnFirstEvent: true,
				AppearOnFirstEvent: false,
				Color:              "#22d3ee",
				Profile: scenario.TargetProfile{
					VehicleCategory: "aircraft",
					Affiliation:     "unknown",
					Status:          "active",
					Identifier:      "A1",
				},
			},
		},
		Events: []scenario.SimulationEvent{
			{ID: "event-b", TargetID: "target-1", At: "2026-07-24T12:00:02.000Z", Message: "Critical track update"},
			{ID: "event-a", TargetID: "target-1", At: "2026-07-24T12:00:01.000Z", Message: "Initial contact"},
			{
				ID: "event-c", TargetID: "target-1", At: "2026-07-24T12:00:02.000Z",
				Position: &scenario.PositionPayload{Latitude: 51, Longitude: 0, Altitude: ptr(1000.0)},
				Message:  "Combined position and message",
			},
		},
	}
}

func ptr(v float64) *float64 { return &v }

func TestSortEvents(t *testing.T) {
	ids := simulation.SortEvents(testScenario().Events)
	got := []string{ids[0].ID, ids[1].ID, ids[2].ID}
	want := []string{"event-a", "event-b", "event-c"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("sort = %v, want %v", got, want)
		}
	}
}

func TestReconcileRevealsAndCompletes(t *testing.T) {
	rt := simulation.CreateRuntime(testScenario(), time.Date(2026, 7, 24, 11, 59, 0, 0, time.UTC), 0)
	reconciled := simulation.ReconcileRuntime(rt, time.Date(2026, 7, 24, 12, 0, 5, 0, time.UTC))

	if len(reconciled.ProcessedEventIDs) != 3 {
		t.Fatalf("processed = %v", reconciled.ProcessedEventIDs)
	}
	if reconciled.Status != simulation.StatusCompleted {
		t.Fatalf("status = %s", reconciled.Status)
	}
	ts := reconciled.TargetStates["target-1"]
	if !ts.Revealed || !ts.Appeared {
		t.Fatalf("revealed/appeared = %v/%v", ts.Revealed, ts.Appeared)
	}
	if ts.Profile["vehicleCategory"] != "aircraft" {
		t.Fatalf("profile = %v", ts.Profile)
	}
	if len(ts.Trail) != 1 {
		t.Fatalf("trail len = %d", len(ts.Trail))
	}
	if len(reconciled.CriticalAlertIDs) != 1 || reconciled.CriticalAlertIDs[0] != "event-b" {
		t.Fatalf("critical = %v", reconciled.CriticalAlertIDs)
	}
}

func TestAppearOnFirstEvent(t *testing.T) {
	base := testScenario()
	base.Targets[0].AppearOnFirstEvent = true
	rt := simulation.CreateRuntime(base, time.Date(2026, 7, 24, 11, 59, 0, 0, time.UTC), 0)
	if rt.TargetStates["target-1"].Appeared {
		t.Fatal("expected hidden")
	}
	after := simulation.ReconcileRuntime(rt, time.Date(2026, 7, 24, 12, 0, 1, 500e6, time.UTC))
	if len(after.ProcessedEventIDs) != 1 || after.ProcessedEventIDs[0] != "event-a" {
		t.Fatalf("processed = %v", after.ProcessedEventIDs)
	}
	if !after.TargetStates["target-1"].Appeared {
		t.Fatal("expected appeared")
	}
}

func TestNoDuplicateAcrossReconciles(t *testing.T) {
	rt := simulation.CreateRuntime(testScenario(), time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC), 0)
	first := simulation.ReconcileRuntime(rt, time.Date(2026, 7, 24, 12, 0, 1, 500e6, time.UTC))
	second := simulation.ReconcileRuntime(first, time.Date(2026, 7, 24, 12, 0, 1, 900e6, time.UTC))
	if len(second.IngestedEvents) != 1 || second.IngestedEvents[0].ID != "event-a" {
		t.Fatalf("ingested = %v", second.IngestedEvents)
	}
}

func TestDelaySeconds(t *testing.T) {
	delayed := testScenario()
	d := 30.0
	delayed.DelaySeconds = &d
	rt := simulation.CreateRuntime(delayed, time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC), 0)

	before := simulation.ReconcileRuntime(rt, time.Date(2026, 7, 24, 12, 0, 20, 0, time.UTC))
	if len(before.ProcessedEventIDs) != 0 {
		t.Fatalf("before delay processed = %v", before.ProcessedEventIDs)
	}
	afterFirst := simulation.ReconcileRuntime(before, time.Date(2026, 7, 24, 12, 0, 31, 0, time.UTC))
	if len(afterFirst.ProcessedEventIDs) != 1 || afterFirst.ProcessedEventIDs[0] != "event-a" {
		t.Fatalf("after first = %v", afterFirst.ProcessedEventIDs)
	}
	if afterFirst.IngestedEvents[0].At != "2026-07-24T12:00:01.000Z" {
		t.Fatalf("authored at mutated: %s", afterFirst.IngestedEvents[0].At)
	}
}

func TestScheduleOffset(t *testing.T) {
	sc := testScenario()
	// Align earliest event (12:00:01) to 13:00:00 → offset = 3599000 ms
	startAt := time.Date(2026, 7, 24, 13, 0, 0, 0, time.UTC)
	offset := simulation.ScheduleOffsetMs(sc.Events, startAt)
	const wantOffset int64 = 3599000
	if offset != wantOffset {
		t.Fatalf("schedule_offset_ms = %d, want %d", offset, wantOffset)
	}
	rt := simulation.CreateRuntime(sc, startAt, offset)

	// Before startAt: nothing due (replay waits for wall clock)
	before := simulation.ReconcileRuntime(rt, startAt.Add(-time.Second))
	if len(before.ProcessedEventIDs) != 0 {
		t.Fatalf("before startAt processed = %v", before.ProcessedEventIDs)
	}

	// At startAt, first event should be due
	atStart := simulation.ReconcileRuntime(before, startAt)
	if len(atStart.ProcessedEventIDs) != 1 || atStart.ProcessedEventIDs[0] != "event-a" {
		t.Fatalf("at startAt processed = %v (offset=%d)", atStart.ProcessedEventIDs, offset)
	}
	// Authored times are never rewritten
	if atStart.IngestedEvents[0].At != "2026-07-24T12:00:01.000Z" {
		t.Fatalf("authored at mutated: %s", atStart.IngestedEvents[0].At)
	}

	// One second later still only event-a
	soon := simulation.ReconcileRuntime(atStart, startAt.Add(500*time.Millisecond))
	if len(soon.ProcessedEventIDs) != 1 {
		t.Fatalf("soon processed = %v", soon.ProcessedEventIDs)
	}

	// At +1s authored gap → event-b and event-c
	later := simulation.ReconcileRuntime(soon, startAt.Add(time.Second))
	if len(later.ProcessedEventIDs) != 3 {
		t.Fatalf("later processed = %v", later.ProcessedEventIDs)
	}
}
