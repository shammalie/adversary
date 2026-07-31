// Package viewport implements map bbox ∪ includeTargetIds filter contracts.
package viewport

import (
	"strings"

	"github.com/shammalie/adversary/apps/api/internal/simulation"
)

// BBox is west, south, east, north in WGS84 degrees (west ≤ east, south ≤ north).
type BBox struct {
	West  float64 `json:"west"`
	South float64 `json:"south"`
	East  float64 `json:"east"`
	North float64 `json:"north"`
}

// Filter is the server-side map subscription filter: bbox ∪ includeTargetIds.
type Filter struct {
	BBox             BBox
	Zoom             float64
	IncludeTargetIDs []string
}

// Valid reports whether the bbox is a finite axis-aligned envelope (no antimeridian wrap).
func (b BBox) Valid() bool {
	if b.West > b.East || b.South > b.North {
		return false
	}
	if b.West < -180 || b.East > 180 || b.South < -90 || b.North > 90 {
		return false
	}
	return true
}

// Contains reports whether (lon, lat) lies inside the bbox (inclusive edges).
func (b BBox) Contains(lon, lat float64) bool {
	return lon >= b.West && lon <= b.East && lat >= b.South && lat <= b.North
}

// ParseIncludeTargetIDs splits a comma-separated includeTargetIds query value.
func ParseIncludeTargetIDs(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, p := range parts {
		id := strings.TrimSpace(p)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

// IncludeSet returns a set of included target ids.
func (f Filter) IncludeSet() map[string]struct{} {
	if len(f.IncludeTargetIDs) == 0 {
		return nil
	}
	m := make(map[string]struct{}, len(f.IncludeTargetIDs))
	for _, id := range f.IncludeTargetIDs {
		m[id] = struct{}{}
	}
	return m
}

// MatchTarget reports whether a target should be sent on the map channel.
// Rule: target id ∈ includeTargetIds OR current position is inside bbox.
// Targets with no position are only matched via includeTargetIds.
func MatchTarget(f Filter, targetID string, pos *simulation.PositionSnapshot) bool {
	if _, ok := f.IncludeSet()[targetID]; ok {
		return true
	}
	if !f.BBox.Valid() {
		return false
	}
	if pos == nil {
		return false
	}
	return f.BBox.Contains(pos.Longitude, pos.Latitude)
}

// FilterTargetStates keeps targets matching bbox ∪ includeTargetIds.
func FilterTargetStates(f Filter, states map[string]*simulation.RuntimeTargetState) map[string]*simulation.RuntimeTargetState {
	if states == nil {
		return map[string]*simulation.RuntimeTargetState{}
	}
	out := make(map[string]*simulation.RuntimeTargetState)
	for id, st := range states {
		if st == nil {
			continue
		}
		if MatchTarget(f, id, st.Position) {
			out[id] = st
		}
	}
	return out
}

// ShouldEvictLocal is the documented client eviction helper contract:
// drop from local overlay when the target is NOT in includeTargetIds and
// its last known position is outside the current bbox (or has no position).
// Server never sends "evict" messages; clients apply this after filter updates.
func ShouldEvictLocal(f Filter, targetID string, pos *simulation.PositionSnapshot) bool {
	return !MatchTarget(f, targetID, pos)
}
