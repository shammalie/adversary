package scenario

// Status values for scenarios rows.
const (
	StatusDraft = "draft"
	StatusReady = "ready"
)

// Vehicle / affiliation / status enums mirror apps/web/src/types/target.ts.
var (
	VehicleCategories = []string{"aircraft", "boat", "car", "truck", "other"}
	Affiliations      = []string{"unknown", "friendly", "neutral", "hostile"}
	TargetStatuses    = []string{"unknown", "active", "stationary", "lost", "inactive"}
)

// TargetProfile is the contact profile on a target definition.
type TargetProfile struct {
	VehicleCategory string `json:"vehicleCategory"`
	VehicleSubtype  string `json:"vehicleSubtype,omitempty"`
	Affiliation     string `json:"affiliation"`
	Status          string `json:"status"`
	Identifier      string `json:"identifier,omitempty"`
	Description     string `json:"description,omitempty"`
}

// TargetDefinition is a scenario target.
type TargetDefinition struct {
	ID                 string        `json:"id"`
	Callsign           string        `json:"callsign"`
	RevealOnFirstEvent bool          `json:"revealOnFirstEvent"`
	AppearOnFirstEvent bool          `json:"appearOnFirstEvent"`
	Color              string        `json:"color"`
	Profile            TargetProfile `json:"profile"`
	MaxCruiseKnots     *float64      `json:"maxCruiseKnots,omitempty"`
}

// PositionPayload is an optional event position.
type PositionPayload struct {
	Latitude  float64  `json:"latitude"`
	Longitude float64  `json:"longitude"`
	Altitude  *float64 `json:"altitude,omitempty"`
	Speed     *float64 `json:"speed,omitempty"`
}

// SimulationEvent is a timed scenario event.
type SimulationEvent struct {
	ID       string           `json:"id"`
	TargetID string           `json:"targetId"`
	At       string           `json:"at"`
	FiresAt  string           `json:"firesAt,omitempty"`
	Position *PositionPayload `json:"position,omitempty"`
	Message  string           `json:"message,omitempty"`
}

// SimulationScenario is the v2 builder document (schemaVersion=2).
type SimulationScenario struct {
	SchemaVersion         int                `json:"schemaVersion"`
	ID                    string             `json:"id"`
	Name                  string             `json:"name"`
	Description           string             `json:"description,omitempty"`
	CreatedAt             string             `json:"createdAt"`
	UpdatedAt             string             `json:"updatedAt"`
	DelaySeconds          *float64           `json:"delaySeconds,omitempty"`
	FastForwardMultiplier *float64           `json:"fastForwardMultiplier,omitempty"`
	PriorityTerms         []string           `json:"priorityTerms"`
	Targets               []TargetDefinition `json:"targets"`
	Events                []SimulationEvent  `json:"events"`
}

// ValidationIssue mirrors apps/web scenario-validation-ui for UI badges.
type ValidationIssue struct {
	Path    string `json:"path"`
	Message string `json:"message"`
	Section string `json:"section"` // scenario | targets | events
	Index   *int   `json:"index,omitempty"`
	Field   string `json:"field,omitempty"`
}
