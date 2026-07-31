package generate

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shammalie/adversary/apps/api/internal/geo"
	"github.com/shammalie/adversary/apps/api/internal/geoseed"
	"github.com/shammalie/adversary/apps/api/internal/scenario"
	"github.com/shammalie/adversary/apps/api/internal/store"
)

// JobStatus values for async generate jobs.
const (
	JobQueued    = "queued"
	JobRunning   = "running"
	JobSucceeded = "succeeded"
	JobFailed    = "failed"
)

// Job is an in-memory generate job (progress polling).
type Job struct {
	ID                    string     `json:"id"`
	Status                string     `json:"status"`
	Progress              string     `json:"progress"`
	Error                 string     `json:"error,omitempty"`
	ScenarioID            string     `json:"scenarioId,omitempty"`
	DegradedTrackCount    int        `json:"degradedTrackCount,omitempty"`
	AnywhereFallbackCount int        `json:"anywhereFallbackCount,omitempty"`
	CatalogueEmpty        bool       `json:"catalogueEmpty,omitempty"`
	ReseedKicked          bool       `json:"reseedKicked,omitempty"`
	CreatedAt             time.Time  `json:"createdAt"`
	FinishedAt            *time.Time `json:"finishedAt,omitempty"`
}

// Service orchestrates generate + route against Postgres catalogue + tile source.
type Service struct {
	Pool        *pgxpool.Pool
	Scenarios   *store.ScenarioStore
	Reseeder    *geoseed.Reseeder
	TileJSONURL string
	Log         *slog.Logger

	mu   sync.Mutex
	jobs map[string]*Job
}

// NewService constructs a generate service.
func NewService(pool *pgxpool.Pool, scenarios *store.ScenarioStore, reseeder *geoseed.Reseeder, tileJSONURL string, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	return &Service{
		Pool: pool, Scenarios: scenarios, Reseeder: reseeder,
		TileJSONURL: tileJSONURL, Log: log, jobs: map[string]*Job{},
	}
}

// GetJob returns a generate job by id.
func (s *Service) GetJob(id string) (*Job, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, ok := s.jobs[id]
	if !ok {
		return nil, false
	}
	cp := *j
	return &cp, true
}

func (s *Service) setJob(j *Job) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.jobs[j.ID] = j
}

// GenerateRequest is the POST /v1/scenarios/generate body.
type GenerateRequest struct {
	VehicleSelection []string    `json:"vehicleSelection"`
	TargetCount      *int        `json:"targetCount"`
	StartAt          string      `json:"startAt"`
	EndAt            string      `json:"endAt"`
	Origin           *DemoOrigin `json:"origin"`
	RegionIDs        []string    `json:"regionIds"`
	Anywhere         *bool       `json:"anywhere"`
	Seed             *uint32     `json:"seed"`
	ForceSynthetic   bool        `json:"forceSynthetic"`
	Name             string      `json:"name"`
}

// StartGenerate kicks an async plan job; returns job id immediately.
func (s *Service) StartGenerate(ctx context.Context, req GenerateRequest) (*Job, error) {
	id := uuid.NewString()
	job := &Job{ID: id, Status: JobQueued, Progress: "queued", CreatedAt: time.Now().UTC()}
	s.setJob(job)

	go s.runGenerate(id, req)
	return job, nil
}

func (s *Service) runGenerate(jobID string, req GenerateRequest) {
	ctx := context.Background()
	now := time.Now().UTC()
	job := &Job{ID: jobID, Status: JobRunning, Progress: "loading catalogue", CreatedAt: now}
	s.setJob(job)

	loader := &CatalogueLoader{Pool: s.Pool}
	cat, err := loader.Load(ctx)
	if err != nil {
		s.failJob(jobID, err)
		return
	}

	reseedKicked := false
	if cat.IsEmpty() && s.Reseeder != nil {
		job.Progress = "catalogue empty; kicking reseed"
		s.setJob(job)
		if _, err := s.Reseeder.StartReseed(ctx); err != nil {
			s.Log.Warn("generate: reseed kick failed; continuing synthetic", "err", err)
		} else {
			reseedKicked = true
		}
	}

	var tileSrc geo.FeatureSource
	if s.TileJSONURL != "" && !req.ForceSynthetic {
		tileSrc = geo.NewVectorTileClient(s.TileJSONURL, 64, nil)
	}

	selection := RegionSelection{Anywhere: true}
	if req.Anywhere != nil && !*req.Anywhere {
		selection = RegionSelection{Anywhere: false, IDs: req.RegionIDs}
	} else if len(req.RegionIDs) > 0 {
		selection = RegionSelection{Anywhere: false, IDs: req.RegionIDs}
	}

	job.Progress = "planning"
	job.CatalogueEmpty = cat.IsEmpty()
	job.ReseedKicked = reseedKicked
	s.setJob(job)

	result, err := PlanDemoScenario(ctx, PlanOptions{
		VehicleSelection: req.VehicleSelection,
		TargetCount:      req.TargetCount,
		StartAt:          req.StartAt,
		EndAt:            req.EndAt,
		Origin:           req.Origin,
		Regions:          selection,
		Seed:             req.Seed,
		ForceSynthetic:   req.ForceSynthetic || cat.IsEmpty(),
		Catalogue:        cat,
		TileSource:       tileSrc,
		Progress: func(done, total int, message string) {
			j := &Job{
				ID: jobID, Status: JobRunning, Progress: message,
				CatalogueEmpty: cat.IsEmpty(), ReseedKicked: reseedKicked,
				CreatedAt: now,
			}
			s.setJob(j)
		},
	})
	if err != nil {
		s.failJob(jobID, err)
		return
	}

	if req.Name != "" {
		result.Scenario.Name = req.Name
	}
	sid, err := uuid.Parse(result.Scenario.ID)
	if err != nil {
		sid = uuid.New()
		result.Scenario.ID = sid.String()
	}

	// Persist as draft always; promote to ready when valid.
	row, err := s.Scenarios.CreateDraft(ctx, sid, result.Scenario.Name, result.Scenario, 2)
	if err != nil {
		s.failJob(jobID, err)
		return
	}
	issues := scenario.Validate(result.Scenario)
	if len(issues) == 0 {
		if published, err := s.Scenarios.Publish(ctx, sid, &result.Scenario); err == nil {
			row = published
		}
	}
	_ = row

	finished := time.Now().UTC()
	s.setJob(&Job{
		ID: jobID, Status: JobSucceeded, Progress: "done",
		ScenarioID:            sid.String(),
		DegradedTrackCount:    result.DegradedTrackCount,
		AnywhereFallbackCount: result.AnywhereFallbackCount,
		CatalogueEmpty:        result.CatalogueEmpty || cat.IsEmpty(),
		ReseedKicked:          reseedKicked,
		CreatedAt:             now, FinishedAt: &finished,
	})
}

func (s *Service) failJob(jobID string, err error) {
	finished := time.Now().UTC()
	s.setJob(&Job{
		ID: jobID, Status: JobFailed, Progress: "failed", Error: err.Error(),
		FinishedAt: &finished, CreatedAt: time.Now().UTC(),
	})
	s.Log.Error("generate job failed", "job_id", jobID, "err", err)
}

// RouteRequest is POST .../targets/{tid}/route body.
type RouteRequest struct {
	StartAt    string   `json:"startAt"`
	EndAt      string   `json:"endAt"`
	EventCount int      `json:"eventCount"`
	RegionIDs  []string `json:"regionIds"`
	Anywhere   *bool    `json:"anywhere"`
	Seed       *uint32  `json:"seed"`
}

// RouteTargetResult is the route endpoint response.
type RouteTargetResult struct {
	ScenarioID       string                     `json:"scenarioId"`
	TargetID         string                     `json:"targetId"`
	Events           []scenario.SimulationEvent `json:"events"`
	Degraded         bool                       `json:"degraded"`
	AnywhereFallback bool                       `json:"anywhereFallback"`
	RegionID         *string                    `json:"regionId,omitempty"`
	ReseedKicked     bool                       `json:"reseedKicked,omitempty"`
	CatalogueEmpty   bool                       `json:"catalogueEmpty,omitempty"`
}

// RouteTarget plans events for one target and persists into the draft document.
func (s *Service) RouteTarget(ctx context.Context, scenarioID uuid.UUID, targetID string, req RouteRequest) (*RouteTargetResult, error) {
	row, err := s.Scenarios.Get(ctx, scenarioID)
	if err != nil {
		return nil, err
	}
	var sc scenario.SimulationScenario
	if err := jsonUnmarshal(row.Payload, &sc); err != nil {
		return nil, fmt.Errorf("invalid scenario payload: %w", err)
	}
	var target *scenario.TargetDefinition
	for i := range sc.Targets {
		if sc.Targets[i].ID == targetID {
			target = &sc.Targets[i]
			break
		}
	}
	if target == nil {
		return nil, fmt.Errorf("target not found")
	}

	loader := &CatalogueLoader{Pool: s.Pool}
	cat, err := loader.Load(ctx)
	if err != nil {
		return nil, err
	}
	reseedKicked := false
	if cat.IsEmpty() && s.Reseeder != nil {
		if _, err := s.Reseeder.StartReseed(ctx); err != nil {
			s.Log.Warn("route: reseed kick failed; synthetic soft-fail", "err", err)
		} else {
			reseedKicked = true
		}
	}

	var tileSrc geo.FeatureSource
	if s.TileJSONURL != "" {
		tileSrc = geo.NewVectorTileClient(s.TileJSONURL, 64, nil)
	}
	selection := RegionSelection{Anywhere: true}
	if req.Anywhere != nil && !*req.Anywhere {
		selection = RegionSelection{Anywhere: false, IDs: req.RegionIDs}
	} else if len(req.RegionIDs) > 0 {
		selection = RegionSelection{Anywhere: false, IDs: req.RegionIDs}
	}
	if req.StartAt == "" {
		req.StartAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	if req.EventCount <= 0 {
		req.EventCount = 40
	}

	result, err := PlanTargetRouteEvents(ctx, PlanTargetRouteOptions{
		Target: *target, Regions: selection,
		StartAt: req.StartAt, EndAt: req.EndAt, EventCount: req.EventCount,
		Catalogue: cat, TileSource: tileSrc, Seed: req.Seed,
	})
	if err != nil {
		return nil, err
	}

	// Replace target events in draft payload.
	filtered := sc.Events[:0]
	for _, ev := range sc.Events {
		if ev.TargetID != targetID {
			filtered = append(filtered, ev)
		}
	}
	sc.Events = MergeGeneratedEvents(filtered, result.Events)
	sc.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)

	if _, err := s.Scenarios.UpsertDraft(ctx, scenarioID, sc.Name, sc, sc.SchemaVersion); err != nil {
		return nil, err
	}

	return &RouteTargetResult{
		ScenarioID: scenarioID.String(), TargetID: targetID,
		Events: result.Events, Degraded: result.Degraded,
		AnywhereFallback: result.AnywhereFallback, RegionID: result.RegionID,
		ReseedKicked: reseedKicked, CatalogueEmpty: cat.IsEmpty(),
	}, nil
}

func jsonUnmarshal(raw []byte, v any) error {
	return json.Unmarshal(raw, v)
}
