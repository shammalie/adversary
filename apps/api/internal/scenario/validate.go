package scenario

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

var hexColorRE = regexp.MustCompile(`(?i)^#[0-9a-f]{6}$`)

// Validate runs full v2 schema checks (parity with simulation-schema.ts).
// It does not mutate the payload. Returns issues (empty when valid).
func Validate(payload any) []ValidationIssue {
	raw, err := json.Marshal(payload)
	if err != nil {
		return []ValidationIssue{{
			Path: "scenario", Message: "payload is not JSON-serializable", Section: "scenario", Field: "scenario",
		}}
	}
	var s SimulationScenario
	if err := json.Unmarshal(raw, &s); err != nil {
		return []ValidationIssue{{
			Path: "scenario", Message: "payload is not a scenario object", Section: "scenario", Field: "scenario",
		}}
	}
	return validateScenario(&s)
}

// ValidateBytes validates a JSON document.
func ValidateBytes(raw []byte) []ValidationIssue {
	var payload any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return []ValidationIssue{{
			Path: "scenario", Message: "invalid JSON", Section: "scenario", Field: "scenario",
		}}
	}
	return Validate(payload)
}

// ParseValid unmarshals and validates; returns the typed scenario when valid.
func ParseValid(payload any) (*SimulationScenario, []ValidationIssue) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, []ValidationIssue{{
			Path: "scenario", Message: "payload is not JSON-serializable", Section: "scenario", Field: "scenario",
		}}
	}
	var s SimulationScenario
	if err := json.Unmarshal(raw, &s); err != nil {
		return nil, []ValidationIssue{{
			Path: "scenario", Message: "payload is not a scenario object", Section: "scenario", Field: "scenario",
		}}
	}
	issues := validateScenario(&s)
	if len(issues) > 0 {
		return nil, issues
	}
	return &s, nil
}

func validateScenario(s *SimulationScenario) []ValidationIssue {
	var issues []ValidationIssue

	if s.SchemaVersion != 2 {
		issues = append(issues, issue("schemaVersion", "Scenario schemaVersion must be 2.", "scenario", nil, "schemaVersion"))
	}
	if strings.TrimSpace(s.ID) == "" {
		issues = append(issues, issue("id", "Scenario id is required.", "scenario", nil, "id"))
	}
	name := strings.TrimSpace(s.Name)
	if name == "" {
		issues = append(issues, issue("name", "Enter a scenario name.", "scenario", nil, "name"))
	} else if utf8.RuneCountInString(name) > 100 {
		issues = append(issues, issue("name", "Scenario names must be 100 characters or fewer.", "scenario", nil, "name"))
	}
	if s.Description != "" && utf8.RuneCountInString(strings.TrimSpace(s.Description)) > 1000 {
		issues = append(issues, issue("description", "Briefs must be 1,000 characters or fewer.", "scenario", nil, "description"))
	}
	if !isISODate(s.CreatedAt) {
		issues = append(issues, issue("createdAt", "createdAt must be an ISO-8601 datetime.", "scenario", nil, "createdAt"))
	}
	if !isISODate(s.UpdatedAt) {
		issues = append(issues, issue("updatedAt", "updatedAt must be an ISO-8601 datetime.", "scenario", nil, "updatedAt"))
	}
	if s.DelaySeconds != nil && *s.DelaySeconds < 0 {
		issues = append(issues, issue("delaySeconds", "Delay cannot be negative.", "scenario", nil, "delaySeconds"))
	}
	if s.FastForwardMultiplier != nil {
		ff := *s.FastForwardMultiplier
		if ff <= 1 {
			issues = append(issues, issue("fastForwardMultiplier", "Fast-forward must be greater than 1.", "scenario", nil, "fastForwardMultiplier"))
		} else if ff > 10 {
			issues = append(issues, issue("fastForwardMultiplier", "Fast-forward must be 10 or less.", "scenario", nil, "fastForwardMultiplier"))
		}
	}
	if s.PriorityTerms == nil {
		issues = append(issues, issue("priorityTerms", "priorityTerms is required.", "scenario", nil, "priorityTerms"))
	} else {
		for i, term := range s.PriorityTerms {
			t := strings.TrimSpace(term)
			if t == "" || utf8.RuneCountInString(t) > 80 {
				idx := i
				issues = append(issues, issue(fmt.Sprintf("priorityTerms.%d", i), "Priority terms must be 1–80 characters.", "scenario", &idx, "priorityTerms"))
			}
		}
	}
	if len(s.Targets) < 1 {
		issues = append(issues, issue("targets", "Each scenario must include at least one target.", "scenario", nil, "targets"))
	}
	if len(s.Events) < 1 {
		issues = append(issues, issue("events", "Each target must have at least one event.", "scenario", nil, "events"))
	}

	targetIDs := map[string]struct{}{}
	callsigns := map[string]struct{}{}
	eventsByTarget := map[string]int{}

	for i, t := range s.Targets {
		idx := i
		prefix := fmt.Sprintf("targets.%d", i)
		tid := strings.TrimSpace(t.ID)
		if tid == "" {
			issues = append(issues, issue(prefix+".id", "Target id is required.", "targets", &idx, "id"))
		} else if _, ok := targetIDs[tid]; ok {
			issues = append(issues, issue(prefix+".id", "Target IDs must be unique.", "targets", &idx, "id"))
		} else {
			targetIDs[tid] = struct{}{}
			eventsByTarget[tid] = 0
		}

		cs := strings.TrimSpace(t.Callsign)
		if cs == "" {
			issues = append(issues, issue(prefix+".callsign", "Enter a callsign for this target.", "targets", &idx, "callsign"))
		} else if utf8.RuneCountInString(cs) > 40 {
			issues = append(issues, issue(prefix+".callsign", "Callsigns must be 40 characters or fewer.", "targets", &idx, "callsign"))
		} else {
			key := strings.ToUpper(cs)
			if _, ok := callsigns[key]; ok {
				issues = append(issues, issue(prefix+".callsign", "Callsigns must be unique.", "targets", &idx, "callsign"))
			} else {
				callsigns[key] = struct{}{}
			}
		}

		if !hexColorRE.MatchString(t.Color) {
			issues = append(issues, issue(prefix+".color", "Choose a valid hex color (#RRGGBB).", "targets", &idx, "color"))
		}
		if t.RevealOnFirstEvent && t.AppearOnFirstEvent {
			issues = append(issues, issue(prefix+".appearOnFirstEvent", "Choose reveal on first event or appear on first event, not both.", "targets", &idx, "appearOnFirstEvent"))
		}
		if t.MaxCruiseKnots != nil && *t.MaxCruiseKnots < 0 {
			issues = append(issues, issue(prefix+".maxCruiseKnots", "maxCruiseKnots cannot be negative.", "targets", &idx, "maxCruiseKnots"))
		}
		issues = append(issues, validateProfile(t.Profile, prefix+".profile", idx)...)
	}

	eventIDs := map[string]struct{}{}
	for i, e := range s.Events {
		idx := i
		prefix := fmt.Sprintf("events.%d", i)
		eid := strings.TrimSpace(e.ID)
		if eid == "" {
			issues = append(issues, issue(prefix+".id", "Event id is required.", "events", &idx, "id"))
		} else if _, ok := eventIDs[eid]; ok {
			issues = append(issues, issue(prefix+".id", "Event IDs must be unique.", "events", &idx, "id"))
		} else {
			eventIDs[eid] = struct{}{}
		}
		if !isISODate(e.At) {
			issues = append(issues, issue(prefix+".at", "Event time must be an ISO-8601 datetime.", "events", &idx, "at"))
		}
		if e.FiresAt != "" && !isISODate(e.FiresAt) {
			issues = append(issues, issue(prefix+".firesAt", "firesAt must be an ISO-8601 datetime.", "events", &idx, "firesAt"))
		}
		tid := strings.TrimSpace(e.TargetID)
		if tid == "" {
			issues = append(issues, issue(prefix+".targetId", "Event targetId is required.", "events", &idx, "targetId"))
		} else if _, ok := targetIDs[tid]; !ok {
			issues = append(issues, issue(prefix+".targetId", "This event references a target that does not exist.", "events", &idx, "targetId"))
		} else {
			eventsByTarget[tid]++
		}
		if e.Position == nil && strings.TrimSpace(e.Message) == "" {
			issues = append(issues, issue(prefix+".message", "Add a position, a message, or both to this event.", "events", &idx, "message"))
		}
		if msg := strings.TrimSpace(e.Message); msg != "" {
			if utf8.RuneCountInString(msg) > 1000 {
				issues = append(issues, issue(prefix+".message", "Messages must be 1,000 characters or fewer.", "events", &idx, "message"))
			}
		} else if e.Message != "" {
			// non-empty but whitespace-only after trim → zod min(1) after trim
			issues = append(issues, issue(prefix+".message", "Message text cannot be empty.", "events", &idx, "message"))
		}
		if e.Position != nil {
			issues = append(issues, validatePosition(*e.Position, prefix+".position", idx)...)
		}
	}

	for i, t := range s.Targets {
		tid := strings.TrimSpace(t.ID)
		if tid == "" {
			continue
		}
		if eventsByTarget[tid] > 0 {
			continue
		}
		idx := i
		issues = append(issues, issue(fmt.Sprintf("targets.%d.callsign", i), "Each target must have at least one event.", "targets", &idx, "callsign"))
	}

	return issues
}

func validateProfile(p TargetProfile, prefix string, targetIndex int) []ValidationIssue {
	var issues []ValidationIssue
	idx := targetIndex
	if !contains(VehicleCategories, p.VehicleCategory) {
		issues = append(issues, issue(prefix+".vehicleCategory", "Invalid vehicleCategory.", "targets", &idx, "vehicleCategory"))
	}
	if !contains(Affiliations, p.Affiliation) {
		issues = append(issues, issue(prefix+".affiliation", "Invalid affiliation.", "targets", &idx, "affiliation"))
	}
	if !contains(TargetStatuses, p.Status) {
		issues = append(issues, issue(prefix+".status", "Invalid status.", "targets", &idx, "status"))
	}
	if p.VehicleSubtype != "" && utf8.RuneCountInString(strings.TrimSpace(p.VehicleSubtype)) > 80 {
		issues = append(issues, issue(prefix+".vehicleSubtype", "vehicleSubtype must be 80 characters or fewer.", "targets", &idx, "vehicleSubtype"))
	}
	if p.Identifier != "" && utf8.RuneCountInString(strings.TrimSpace(p.Identifier)) > 80 {
		issues = append(issues, issue(prefix+".identifier", "identifier must be 80 characters or fewer.", "targets", &idx, "identifier"))
	}
	if p.Description != "" && utf8.RuneCountInString(strings.TrimSpace(p.Description)) > 500 {
		issues = append(issues, issue(prefix+".description", "description must be 500 characters or fewer.", "targets", &idx, "description"))
	}
	return issues
}

func validatePosition(p PositionPayload, prefix string, eventIndex int) []ValidationIssue {
	var issues []ValidationIssue
	idx := eventIndex
	if p.Latitude < -90 || p.Latitude > 90 {
		issues = append(issues, issue(prefix+".latitude", "Latitude must be between -90 and 90.", "events", &idx, "latitude"))
	}
	if p.Longitude < -180 || p.Longitude > 180 {
		issues = append(issues, issue(prefix+".longitude", "Longitude must be between -180 and 180.", "events", &idx, "longitude"))
	}
	if p.Altitude != nil {
		if *p.Altitude < -500 {
			issues = append(issues, issue(prefix+".altitude", "Altitude must be at least -500 ft.", "events", &idx, "altitude"))
		} else if *p.Altitude > 100_000 {
			issues = append(issues, issue(prefix+".altitude", "Altitude must be 100,000 ft or less.", "events", &idx, "altitude"))
		}
	}
	if p.Speed != nil {
		if *p.Speed < 0 {
			issues = append(issues, issue(prefix+".speed", "Speed cannot be negative.", "events", &idx, "speed"))
		} else if *p.Speed > 2000 {
			issues = append(issues, issue(prefix+".speed", "Speed must be 2,000 kt or less.", "events", &idx, "speed"))
		}
	}
	return issues
}

func issue(path, message, section string, index *int, field string) ValidationIssue {
	return ValidationIssue{Path: path, Message: message, Section: section, Index: index, Field: field}
}

func isISODate(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return false
	}
	if _, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return true
	}
	if _, err := time.Parse(time.RFC3339, s); err == nil {
		return true
	}
	return false
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// ExtractName pulls a display name from a loose payload (draft-safe).
func ExtractName(payload any) string {
	m, ok := asMap(payload)
	if !ok {
		return "Untitled import"
	}
	if name, ok := m["name"].(string); ok && strings.TrimSpace(name) != "" {
		return strings.TrimSpace(name)
	}
	return "Untitled import"
}

// ExtractID pulls an id from a loose payload, or empty if missing.
func ExtractID(payload any) string {
	m, ok := asMap(payload)
	if !ok {
		return ""
	}
	if id, ok := m["id"].(string); ok {
		return strings.TrimSpace(id)
	}
	return ""
}

// ExtractSchemaVersion returns schemaVersion if present.
func ExtractSchemaVersion(payload any) int {
	m, ok := asMap(payload)
	if !ok {
		return 0
	}
	switch v := m["schemaVersion"].(type) {
	case float64:
		return int(v)
	case int:
		return v
	case json.Number:
		n, _ := v.Int64()
		return int(n)
	}
	return 0
}

func asMap(payload any) (map[string]any, bool) {
	switch v := payload.(type) {
	case map[string]any:
		return v, true
	default:
		raw, err := json.Marshal(payload)
		if err != nil {
			return nil, false
		}
		var m map[string]any
		if err := json.Unmarshal(raw, &m); err != nil {
			return nil, false
		}
		return m, true
	}
}

// EnsurePayloadID sets payload.id to id when missing or mismatched (draft upsert).
func EnsurePayloadID(payload any, id string) any {
	m, ok := asMap(payload)
	if !ok {
		return map[string]any{"id": id, "schemaVersion": 2}
	}
	m["id"] = id
	return m
}

// StampUpdatedAt sets updatedAt to now ISO on a map payload.
func StampUpdatedAt(payload any, now time.Time) any {
	m, ok := asMap(payload)
	if !ok {
		return payload
	}
	m["updatedAt"] = now.UTC().Format(time.RFC3339Nano)
	return m
}
