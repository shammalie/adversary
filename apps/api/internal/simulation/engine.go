package simulation

import (
	"slices"
	"time"

	"github.com/shammalie/adversary/apps/api/internal/scenario"
)

// SortEvents sorts by (firesAt ?? at) then id (stable).
func SortEvents(events []scenario.SimulationEvent) []scenario.SimulationEvent {
	out := slices.Clone(events)
	slices.SortFunc(out, func(a, b scenario.SimulationEvent) int {
		ta := EventAuthoredMs(a)
		tb := EventAuthoredMs(b)
		if ta != tb {
			if ta < tb {
				return -1
			}
			return 1
		}
		if a.ID < b.ID {
			return -1
		}
		if a.ID > b.ID {
			return 1
		}
		return 0
	})
	return out
}

// EventAuthoredMs is Date.parse(firesAt ?? at).
func EventAuthoredMs(event scenario.SimulationEvent) int64 {
	if event.FiresAt != "" {
		return parseMillis(event.FiresAt)
	}
	return parseMillis(event.At)
}

// ScenarioDelaySeconds returns max(0, delaySeconds).
func ScenarioDelaySeconds(sc scenario.SimulationScenario) float64 {
	if sc.DelaySeconds == nil {
		return 0
	}
	if *sc.DelaySeconds < 0 {
		return 0
	}
	return *sc.DelaySeconds
}

// EffectiveEventAtMs is (firesAt ?? at) + delay + scheduleOffset.
func EffectiveEventAtMs(event scenario.SimulationEvent, delaySeconds float64, scheduleOffsetMs int64) int64 {
	delayMs := int64(mathMax0(delaySeconds) * 1000)
	return EventAuthoredMs(event) + delayMs + scheduleOffsetMs
}

// EarliestAuthoredMs returns min(firesAt ?? at) across events, or 0 if empty.
func EarliestAuthoredMs(events []scenario.SimulationEvent) int64 {
	if len(events) == 0 {
		return 0
	}
	min := EventAuthoredMs(events[0])
	for _, e := range events[1:] {
		if ms := EventAuthoredMs(e); ms < min {
			min = ms
		}
	}
	return min
}

// ScheduleOffsetMs aligns the earliest authored event to startAt.
func ScheduleOffsetMs(events []scenario.SimulationEvent, startAt time.Time) int64 {
	t0 := EarliestAuthoredMs(events)
	if t0 == 0 && len(events) == 0 {
		return 0
	}
	return startAt.UTC().UnixMilli() - t0
}

func mathMax0(v float64) float64 {
	if v < 0 {
		return 0
	}
	return v
}

func maskedProfile(target scenario.TargetDefinition) map[string]any {
	if target.RevealOnFirstEvent {
		return map[string]any{}
	}
	return profileToMap(target.Profile)
}

func profileToMap(p scenario.TargetProfile) map[string]any {
	m := map[string]any{
		"vehicleCategory": p.VehicleCategory,
		"affiliation":     p.Affiliation,
		"status":          p.Status,
	}
	if p.VehicleSubtype != "" {
		m["vehicleSubtype"] = p.VehicleSubtype
	}
	if p.Identifier != "" {
		m["identifier"] = p.Identifier
	}
	if p.Description != "" {
		m["description"] = p.Description
	}
	return m
}

func createInitialTargetStates(sc scenario.SimulationScenario) map[string]*RuntimeTargetState {
	out := make(map[string]*RuntimeTargetState, len(sc.Targets))
	for i := range sc.Targets {
		t := sc.Targets[i]
		tdef := t
		out[t.ID] = &RuntimeTargetState{
			TargetID:   t.ID,
			Callsign:   t.Callsign,
			Color:      t.Color,
			Profile:    maskedProfile(t),
			Revealed:   !t.RevealOnFirstEvent,
			Appeared:   !t.AppearOnFirstEvent,
			Trail:      []PositionSnapshot{},
			Definition: &tdef,
		}
	}
	return out
}

// CreateRuntime builds a fresh running runtime.
func CreateRuntime(sc scenario.SimulationScenario, now time.Time, scheduleOffsetMs int64) *Runtime {
	return &Runtime{
		SchemaVersion:     2,
		Scenario:          sc,
		Status:            StatusRunning,
		StartedAt:         now.UTC().Format(time.RFC3339Nano),
		ProcessedEventIDs: []string{},
		IngestedEvents:    []scenario.SimulationEvent{},
		TargetStates:      createInitialTargetStates(sc),
		CriticalAlertIDs:  []string{},
		LastReconciledAt:  now.UTC().Format(time.RFC3339Nano),
		ScheduleOffsetMs:  scheduleOffsetMs,
	}
}

func revealTarget(current *RuntimeTargetState, definition *scenario.TargetDefinition) *RuntimeTargetState {
	if definition == nil || current.Revealed {
		return current
	}
	next := *current
	next.Revealed = true
	next.Profile = profileToMap(definition.Profile)
	return &next
}

func appearTarget(current *RuntimeTargetState) *RuntimeTargetState {
	if current.Appeared {
		return current
	}
	next := *current
	next.Appeared = true
	return &next
}

// ApplyEvent mutates a copy of runtime by applying one event.
func ApplyEvent(runtime *Runtime, event scenario.SimulationEvent) *Runtime {
	target := runtime.TargetStates[event.TargetID]
	if target == nil {
		return runtime
	}

	var definition *scenario.TargetDefinition
	for i := range runtime.Scenario.Targets {
		if runtime.Scenario.Targets[i].ID == event.TargetID {
			definition = &runtime.Scenario.Targets[i]
			break
		}
	}

	target = appearTarget(target)
	target = revealTarget(target, definition)
	nextTarget := *target
	nextTarget.LastEventAt = event.At
	nextTarget.Trail = slices.Clone(target.Trail)

	if event.Position != nil {
		var previous *PositionSnapshot
		if target.Position != nil {
			previous = target.Position
		} else if len(target.Trail) > 0 {
			prev := target.Trail[len(target.Trail)-1]
			previous = &prev
		}
		vehicleCategory := ""
		if cat, ok := nextTarget.Profile["vehicleCategory"].(string); ok {
			vehicleCategory = cat
		}
		if vehicleCategory == "" && definition != nil {
			vehicleCategory = definition.Profile.VehicleCategory
		}
		pos := DerivePositionSnapshot(*event.Position, event.At, previous, vehicleCategory)
		nextTarget.Position = &pos
		nextTarget.Trail = append(nextTarget.Trail, pos)
	}

	isCritical := false
	if event.Message != "" {
		isCritical = IsPriorityMessage(event.Message, runtime.Scenario.PriorityTerms)
	}

	next := *runtime
	nextStates := make(map[string]*RuntimeTargetState, len(runtime.TargetStates))
	for k, v := range runtime.TargetStates {
		nextStates[k] = v
	}
	nextStates[event.TargetID] = &nextTarget
	next.TargetStates = nextStates
	next.ProcessedEventIDs = append(slices.Clone(runtime.ProcessedEventIDs), event.ID)
	next.IngestedEvents = append(slices.Clone(runtime.IngestedEvents), event)
	if isCritical {
		next.CriticalAlertIDs = append(slices.Clone(runtime.CriticalAlertIDs), event.ID)
	} else {
		next.CriticalAlertIDs = slices.Clone(runtime.CriticalAlertIDs)
	}
	return &next
}

// ReconcileRuntime applies all due unprocessed events (with schedule offset).
func ReconcileRuntime(runtime *Runtime, now time.Time) *Runtime {
	if runtime.Status != StatusRunning {
		return runtime
	}

	nowMs := now.UTC().UnixMilli()
	delay := ScenarioDelaySeconds(runtime.Scenario)
	processed := make(map[string]struct{}, len(runtime.ProcessedEventIDs))
	for _, id := range runtime.ProcessedEventIDs {
		processed[id] = struct{}{}
	}

	due := make([]scenario.SimulationEvent, 0)
	for _, event := range SortEvents(runtime.Scenario.Events) {
		if _, ok := processed[event.ID]; ok {
			continue
		}
		if EffectiveEventAtMs(event, delay, runtime.ScheduleOffsetMs) <= nowMs {
			due = append(due, event)
		}
	}

	next := runtime
	for _, event := range due {
		next = ApplyEvent(next, event)
	}

	complete := len(next.ProcessedEventIDs) == len(runtime.Scenario.Events)
	out := *next
	out.LastReconciledAt = now.UTC().Format(time.RFC3339Nano)
	if complete {
		out.Status = StatusCompleted
		out.CompletedAt = now.UTC().Format(time.RFC3339Nano)
	} else {
		out.Status = StatusRunning
		out.CompletedAt = ""
	}
	return &out
}

// StopRuntime marks the runtime stopped.
func StopRuntime(runtime *Runtime, now time.Time) *Runtime {
	out := *runtime
	out.Status = StatusStopped
	out.StoppedAt = now.UTC().Format(time.RFC3339Nano)
	out.LastReconciledAt = now.UTC().Format(time.RFC3339Nano)
	return &out
}

// GetNextEvent returns the next unprocessed event in schedule order.
func GetNextEvent(runtime *Runtime) *scenario.SimulationEvent {
	processed := make(map[string]struct{}, len(runtime.ProcessedEventIDs))
	for _, id := range runtime.ProcessedEventIDs {
		processed[id] = struct{}{}
	}
	for _, event := range SortEvents(runtime.Scenario.Events) {
		if _, ok := processed[event.ID]; !ok {
			e := event
			return &e
		}
	}
	return nil
}

// NextEventAt returns when the next unprocessed event is due, or nil if none.
func NextEventAt(runtime *Runtime) *time.Time {
	event := GetNextEvent(runtime)
	if event == nil {
		return nil
	}
	ms := EffectiveEventAtMs(*event, ScenarioDelaySeconds(runtime.Scenario), runtime.ScheduleOffsetMs)
	t := time.UnixMilli(ms).UTC()
	return &t
}

// EventsDueByTime returns events with effective time <= previewTimeMs.
func EventsDueByTime(sc scenario.SimulationScenario, previewTimeMs, scheduleOffsetMs int64) []scenario.SimulationEvent {
	delay := ScenarioDelaySeconds(sc)
	var due []scenario.SimulationEvent
	for _, event := range SortEvents(sc.Events) {
		if EffectiveEventAtMs(event, delay, scheduleOffsetMs) <= previewTimeMs {
			due = append(due, event)
		}
	}
	return due
}

// CloneTargetStatesJSON-safe copy of target states for checkpoint / wire.
func CloneTargetStates(states map[string]*RuntimeTargetState) map[string]*RuntimeTargetState {
	out := make(map[string]*RuntimeTargetState, len(states))
	for k, v := range states {
		if v == nil {
			continue
		}
		cp := *v
		cp.Trail = slices.Clone(v.Trail)
		if v.Position != nil {
			pos := *v.Position
			cp.Position = &pos
		}
		prof := make(map[string]any, len(v.Profile))
		for pk, pv := range v.Profile {
			prof[pk] = pv
		}
		cp.Profile = prof
		cp.Definition = nil
		out[k] = &cp
	}
	return out
}
