package simulation

import "github.com/shammalie/adversary/apps/api/internal/scenario"

// RuntimeStatus mirrors the web SimulationRuntime status.
type RuntimeStatus string

const (
	StatusRunning   RuntimeStatus = "running"
	StatusStopped   RuntimeStatus = "stopped"
	StatusCompleted RuntimeStatus = "completed"
)

// PositionSnapshot is a derived position with speed/heading.
type PositionSnapshot struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Altitude  float64 `json:"altitude"`
	Speed     float64 `json:"speed"`
	Heading   float64 `json:"heading"`
	Course    float64 `json:"course"`
	At        string  `json:"at"`
}

// RuntimeTargetState is the live state for one target.
type RuntimeTargetState struct {
	TargetID    string                     `json:"targetId"`
	Callsign    string                     `json:"callsign"`
	Color       string                     `json:"color"`
	Profile     map[string]any             `json:"profile"`
	Revealed    bool                       `json:"revealed"`
	Appeared    bool                       `json:"appeared"`
	Position    *PositionSnapshot          `json:"position,omitempty"`
	Trail       []PositionSnapshot         `json:"trail"`
	LastEventAt string                     `json:"lastEventAt,omitempty"`
	Definition  *scenario.TargetDefinition `json:"-"`
}

// Runtime is the in-memory simulation state (ported from web SimulationRuntime).
type Runtime struct {
	SchemaVersion     int                            `json:"schemaVersion"`
	Scenario          scenario.SimulationScenario    `json:"scenario"`
	Status            RuntimeStatus                  `json:"status"`
	StartedAt         string                         `json:"startedAt"`
	StoppedAt         string                         `json:"stoppedAt,omitempty"`
	CompletedAt       string                         `json:"completedAt,omitempty"`
	ProcessedEventIDs []string                       `json:"processedEventIds"`
	IngestedEvents    []scenario.SimulationEvent     `json:"ingestedEvents"`
	TargetStates      map[string]*RuntimeTargetState `json:"targetStates"`
	CriticalAlertIDs  []string                       `json:"criticalAlertIds"`
	LastReconciledAt  string                         `json:"lastReconciledAt"`
	ScheduleOffsetMs  int64                          `json:"scheduleOffsetMs,omitempty"`
}
