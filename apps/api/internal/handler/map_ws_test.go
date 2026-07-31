package handler

import (
	"encoding/json"
	"testing"

	"github.com/shammalie/adversary/apps/api/internal/bus"
	"github.com/shammalie/adversary/apps/api/internal/engine"
	"github.com/shammalie/adversary/apps/api/internal/simulation"
	"github.com/shammalie/adversary/apps/api/internal/viewport"
)

func TestFilterMapBusMessage(t *testing.T) {
	f := viewport.Filter{
		BBox:             viewport.BBox{West: -1, South: 50, East: 1, North: 52},
		IncludeTargetIDs: []string{"tracked"},
	}

	inside, _ := json.Marshal(simulation.RuntimeTargetState{
		TargetID: "a",
		Position: &simulation.PositionSnapshot{Longitude: 0, Latitude: 51},
	})
	outside, _ := json.Marshal(simulation.RuntimeTargetState{
		TargetID: "b",
		Position: &simulation.PositionSnapshot{Longitude: 20, Latitude: 0},
	})
	tracked, _ := json.Marshal(simulation.RuntimeTargetState{
		TargetID: "tracked",
		Position: &simulation.PositionSnapshot{Longitude: 20, Latitude: 0},
	})

	if _, ok := filterMapBusMessage(f, bus.Message{Type: engine.MsgTargetUpdated, Payload: inside}); !ok {
		t.Fatal("inside should pass")
	}
	if _, ok := filterMapBusMessage(f, bus.Message{Type: engine.MsgTargetUpdated, Payload: outside}); ok {
		t.Fatal("outside should drop")
	}
	if _, ok := filterMapBusMessage(f, bus.Message{Type: engine.MsgTargetUpdated, Payload: tracked}); !ok {
		t.Fatal("included off-screen should pass")
	}
	if _, ok := filterMapBusMessage(f, bus.Message{Type: engine.MsgEventIngested}); ok {
		t.Fatal("ops events should drop on map channel")
	}
	if _, ok := filterMapBusMessage(f, bus.Message{Type: engine.MsgRunCompleted}); !ok {
		t.Fatal("run.completed should pass")
	}

	catchPayload, _ := json.Marshal(map[string]any{
		"asOf": "t",
		"targetStates": map[string]*simulation.RuntimeTargetState{
			"a": {TargetID: "a", Position: &simulation.PositionSnapshot{Longitude: 0, Latitude: 51}},
			"b": {TargetID: "b", Position: &simulation.PositionSnapshot{Longitude: 20, Latitude: 0}},
		},
	})
	out, ok := filterMapBusMessage(f, bus.Message{Type: engine.MsgCatchUp, Payload: catchPayload})
	if !ok {
		t.Fatal("catchup should pass")
	}
	var got struct {
		TargetStates map[string]*simulation.RuntimeTargetState `json:"targetStates"`
	}
	if err := json.Unmarshal(out.Payload, &got); err != nil {
		t.Fatal(err)
	}
	if len(got.TargetStates) != 1 || got.TargetStates["a"] == nil {
		t.Fatalf("filtered catchup = %#v", got.TargetStates)
	}
}
