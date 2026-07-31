package scenario

import (
	"encoding/json"
	"sort"
	"strings"
	"time"
)

// IsLegacy reports schemaVersion === 1.
func IsLegacy(payload any) bool {
	return ExtractSchemaVersion(payload) == 1
}

// MigrateToV2 converts a document to v2. Pass-through when already v2 (with rail→other).
// Returns the migrated payload as map[string]any for storage.
func MigrateToV2(payload any) (any, error) {
	if IsLegacy(payload) {
		raw, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		var legacy legacyScenario
		if err := json.Unmarshal(raw, &legacy); err != nil {
			return nil, err
		}
		v2 := migrateV1ToV2(legacy)
		return structToMap(v2)
	}

	// Soft-migrate retired vehicle categories on v2-shaped docs.
	raw, err := json.Marshal(payload)
	if err != nil {
		return payload, nil
	}
	var s SimulationScenario
	if err := json.Unmarshal(raw, &s); err != nil {
		return payload, nil
	}
	if s.SchemaVersion != 2 {
		return payload, nil
	}
	changed := false
	for i := range s.Targets {
		cat := migrateVehicleCategory(s.Targets[i].Profile.VehicleCategory)
		if cat != s.Targets[i].Profile.VehicleCategory {
			s.Targets[i].Profile.VehicleCategory = cat
			changed = true
		}
	}
	if !changed {
		return payload, nil
	}
	return structToMap(s)
}

func structToMap(v any) (map[string]any, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, err
	}
	return m, nil
}

type legacyScenario struct {
	SchemaVersion int    `json:"schemaVersion"`
	ID            string `json:"id"`
	Name          string `json:"name"`
	Description   string `json:"description,omitempty"`
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt"`
	Targets       []struct {
		ID             string          `json:"id"`
		Callsign       string          `json:"callsign"`
		StartsUnknown  bool            `json:"startsUnknown"`
		Color          string          `json:"color"`
		InitialProfile json.RawMessage `json:"initialProfile,omitempty"`
	} `json:"targets"`
	Events []json.RawMessage `json:"events"`
}

type legacyEventBase struct {
	ID       string `json:"id"`
	TargetID string `json:"targetId"`
	At       string `json:"at"`
	Type     string `json:"type"`
	Message  string `json:"message,omitempty"`
	Priority int    `json:"priority,omitempty"`
	Code     string `json:"code,omitempty"`
	Status   string `json:"status,omitempty"`
}

func migrateV1ToV2(scenario legacyScenario) SimulationScenario {
	identityProfiles := map[string]TargetProfile{}
	extraMessages := []SimulationEvent{}
	priorityTerms := map[string]struct{}{}

	for _, raw := range scenario.Events {
		var base legacyEventBase
		_ = json.Unmarshal(raw, &base)
		switch base.Type {
		case "identity":
			var wrap struct {
				Profile map[string]any `json:"profile"`
				Message string         `json:"message"`
			}
			_ = json.Unmarshal(raw, &wrap)
			cur := identityProfiles[base.TargetID]
			identityProfiles[base.TargetID] = mergeProfile(cur, wrap.Profile)
			if msg := strings.TrimSpace(wrap.Message); msg != "" {
				extraMessages = append(extraMessages, SimulationEvent{
					ID: base.ID + "-msg", TargetID: base.TargetID, At: base.At, Message: msg,
				})
			}
		case "message", "alert":
			if base.Priority == 1 {
				added := 0
				for _, word := range strings.Fields(base.Message) {
					if len(word) <= 3 {
						continue
					}
					priorityTerms[word] = struct{}{}
					added++
					if added >= 3 {
						break
					}
				}
			}
		}
	}

	targets := make([]TargetDefinition, 0, len(scenario.Targets))
	for _, t := range scenario.Targets {
		var initial map[string]any
		if len(t.InitialProfile) > 0 {
			_ = json.Unmarshal(t.InitialProfile, &initial)
		}
		base := profileFromMap(initial)
		merged := mergeProfile(base, profileToMap(identityProfiles[t.ID]))
		targets = append(targets, TargetDefinition{
			ID:                 t.ID,
			Callsign:           t.Callsign,
			RevealOnFirstEvent: t.StartsUnknown,
			AppearOnFirstEvent: false,
			Color:              t.Color,
			Profile:            merged,
		})
	}

	converted := make([]SimulationEvent, 0, len(scenario.Events))
	for _, raw := range scenario.Events {
		var base legacyEventBase
		_ = json.Unmarshal(raw, &base)
		switch base.Type {
		case "identity":
			continue
		case "position":
			var pos struct {
				Latitude  float64 `json:"latitude"`
				Longitude float64 `json:"longitude"`
				Altitude  float64 `json:"altitude"`
				Speed     float64 `json:"speed"`
			}
			_ = json.Unmarshal(raw, &pos)
			alt, spd := pos.Altitude, pos.Speed
			converted = append(converted, SimulationEvent{
				ID: base.ID, TargetID: base.TargetID, At: base.At,
				Position: &PositionPayload{Latitude: pos.Latitude, Longitude: pos.Longitude, Altitude: &alt, Speed: &spd},
			})
		case "message":
			converted = append(converted, SimulationEvent{
				ID: base.ID, TargetID: base.TargetID, At: base.At, Message: base.Message,
			})
		case "alert":
			msg := base.Message
			if base.Code != "" {
				msg = "[" + base.Code + "] " + base.Message
			}
			converted = append(converted, SimulationEvent{
				ID: base.ID, TargetID: base.TargetID, At: base.At, Message: msg,
			})
		case "status":
			msg := strings.TrimSpace(base.Message)
			if msg == "" {
				msg = "Status changed to " + base.Status + "."
			}
			converted = append(converted, SimulationEvent{
				ID: base.ID, TargetID: base.TargetID, At: base.At, Message: msg,
			})
		}
	}

	events := append(converted, extraMessages...)
	sort.SliceStable(events, func(i, j int) bool {
		ti, tj := parseMillis(events[i].At), parseMillis(events[j].At)
		if ti != tj {
			return ti < tj
		}
		return events[i].ID < events[j].ID
	})

	terms := make([]string, 0, len(priorityTerms))
	for t := range priorityTerms {
		terms = append(terms, t)
	}
	terms = normalizePriorityTerms(terms)

	desc := scenario.Description
	return SimulationScenario{
		SchemaVersion: 2,
		ID:            scenario.ID,
		Name:          scenario.Name,
		Description:   desc,
		CreatedAt:     scenario.CreatedAt,
		UpdatedAt:     time.Now().UTC().Format(time.RFC3339Nano),
		PriorityTerms: terms,
		Targets:       targets,
		Events:        events,
	}
}

func migrateVehicleCategory(category string) string {
	if category == "rail" {
		return "other"
	}
	if contains(VehicleCategories, category) {
		return category
	}
	return "other"
}

func mergeProfile(base TargetProfile, patch map[string]any) TargetProfile {
	out := base
	if out.VehicleCategory == "" {
		out.VehicleCategory = "other"
	}
	if out.Affiliation == "" {
		out.Affiliation = "unknown"
	}
	if out.Status == "" {
		out.Status = "active"
	}
	if patch == nil {
		out.VehicleCategory = migrateVehicleCategory(out.VehicleCategory)
		return out
	}
	if v, ok := stringField(patch, "vehicleCategory"); ok {
		out.VehicleCategory = migrateVehicleCategory(v)
	} else {
		out.VehicleCategory = migrateVehicleCategory(out.VehicleCategory)
	}
	if v, ok := stringField(patch, "vehicleSubtype"); ok {
		out.VehicleSubtype = v
	}
	if v, ok := stringField(patch, "affiliation"); ok {
		out.Affiliation = v
	}
	if v, ok := stringField(patch, "status"); ok {
		out.Status = v
	}
	if v, ok := stringField(patch, "identifier"); ok {
		out.Identifier = v
	}
	if v, ok := stringField(patch, "description"); ok {
		out.Description = v
	}
	return out
}

func stringField(m map[string]any, key string) (string, bool) {
	v, ok := m[key].(string)
	if !ok || strings.TrimSpace(v) == "" {
		return "", false
	}
	return v, true
}

func profileFromMap(m map[string]any) TargetProfile {
	return mergeProfile(TargetProfile{}, m)
}

func profileToMap(p TargetProfile) map[string]any {
	m := map[string]any{}
	if p.VehicleCategory != "" {
		m["vehicleCategory"] = p.VehicleCategory
	}
	if p.Affiliation != "" {
		m["affiliation"] = p.Affiliation
	}
	if p.Status != "" {
		m["status"] = p.Status
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

func normalizePriorityTerms(terms []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(terms))
	for _, term := range terms {
		value := strings.Join(strings.Fields(strings.TrimSpace(term)), " ")
		if value == "" {
			continue
		}
		key := strings.ToLower(value)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, value)
	}
	return out
}

func parseMillis(iso string) int64 {
	if t, err := time.Parse(time.RFC3339Nano, iso); err == nil {
		return t.UnixMilli()
	}
	if t, err := time.Parse(time.RFC3339, iso); err == nil {
		return t.UnixMilli()
	}
	return 0
}
