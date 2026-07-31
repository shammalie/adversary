package viewport

import (
	"testing"

	"github.com/shammalie/adversary/apps/api/internal/simulation"
)

func TestParseIncludeTargetIDs(t *testing.T) {
	got := ParseIncludeTargetIDs(" a, b ,a, ,c ")
	if len(got) != 3 || got[0] != "a" || got[1] != "b" || got[2] != "c" {
		t.Fatalf("got %#v", got)
	}
	if ParseIncludeTargetIDs("") != nil {
		t.Fatal("empty should be nil")
	}
}

func TestBBoxContains(t *testing.T) {
	b := BBox{West: -1, South: 50, East: 1, North: 52}
	if !b.Valid() {
		t.Fatal("expected valid")
	}
	if !b.Contains(0, 51) {
		t.Fatal("center should be inside")
	}
	if b.Contains(2, 51) {
		t.Fatal("east of bbox")
	}
	if (BBox{West: 2, South: 0, East: 1, North: 1}).Valid() {
		t.Fatal("west>east invalid")
	}
}

func TestMatchTargetBBoxAndInclude(t *testing.T) {
	f := Filter{
		BBox:             BBox{West: -1, South: 50, East: 1, North: 52},
		IncludeTargetIDs: []string{"tracked-offscreen"},
	}
	inside := &simulation.PositionSnapshot{Longitude: 0, Latitude: 51}
	outside := &simulation.PositionSnapshot{Longitude: 10, Latitude: 51}

	if !MatchTarget(f, "t1", inside) {
		t.Fatal("inside bbox should match")
	}
	if MatchTarget(f, "t1", outside) {
		t.Fatal("outside bbox without include should not match")
	}
	if !MatchTarget(f, "tracked-offscreen", outside) {
		t.Fatal("includeTargetIds should match off-screen")
	}
	if !MatchTarget(f, "tracked-offscreen", nil) {
		t.Fatal("include without position should match")
	}
	if MatchTarget(f, "t2", nil) {
		t.Fatal("no position and not included should not match")
	}
}

func TestFilterTargetStates(t *testing.T) {
	f := Filter{
		BBox:             BBox{West: -1, South: 50, East: 1, North: 52},
		IncludeTargetIDs: []string{"far"},
	}
	states := map[string]*simulation.RuntimeTargetState{
		"near": {TargetID: "near", Position: &simulation.PositionSnapshot{Longitude: 0, Latitude: 51}},
		"far":  {TargetID: "far", Position: &simulation.PositionSnapshot{Longitude: 20, Latitude: 0}},
		"gone": {TargetID: "gone", Position: &simulation.PositionSnapshot{Longitude: -20, Latitude: 0}},
	}
	got := FilterTargetStates(f, states)
	if len(got) != 2 {
		t.Fatalf("want 2, got %d", len(got))
	}
	if got["near"] == nil || got["far"] == nil {
		t.Fatalf("got keys %#v", got)
	}
}

func TestShouldEvictLocal(t *testing.T) {
	f := Filter{
		BBox:             BBox{West: -1, South: 50, East: 1, North: 52},
		IncludeTargetIDs: []string{"watched"},
	}
	outside := &simulation.PositionSnapshot{Longitude: 10, Latitude: 51}
	if !ShouldEvictLocal(f, "other", outside) {
		t.Fatal("unwatched outside bbox should evict")
	}
	if ShouldEvictLocal(f, "watched", outside) {
		t.Fatal("watched off-screen should not evict")
	}
	if ShouldEvictLocal(f, "in-view", &simulation.PositionSnapshot{Longitude: 0, Latitude: 51}) {
		t.Fatal("in-view should not evict")
	}
}
