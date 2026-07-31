package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shammalie/adversary/apps/api/internal/scenario"
	"github.com/shammalie/adversary/apps/api/internal/simulation"
	"github.com/shammalie/adversary/apps/api/internal/viewport"
)

// Run status values.
const (
	RunStatusRunning   = "running"
	RunStatusStopped   = "stopped"
	RunStatusCompleted = "completed"
)

// ErrRunNotFound is returned when a run row is missing.
var ErrRunNotFound = errors.New("run not found")

// ErrScenarioNotReady is returned when starting a run from a non-ready scenario.
var ErrScenarioNotReady = errors.New("scenario is not ready")

// RunStore persists runs and checkpoints.
type RunStore struct {
	Pool *pgxpool.Pool
}

// RunRow is a runs table row.
type RunRow struct {
	ID               uuid.UUID
	ScenarioID       uuid.UUID
	ScenarioName     string // filled when joined with scenarios
	Status           string
	StartAt          time.Time
	ScheduleOffsetMs int64
	StartedAt        time.Time
	StoppedAt        *time.Time
	CompletedAt      *time.Time
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// RunSummary is a list/detail DTO for Active scenarios UI and run detail.
type RunSummary struct {
	ID               string     `json:"id"`
	ScenarioID       string     `json:"scenarioId"`
	ScenarioName     string     `json:"scenarioName,omitempty"`
	Status           string     `json:"status"`
	StartAt          time.Time  `json:"startAt"`
	ScheduleOffsetMs int64      `json:"scheduleOffsetMs"`
	StartedAt        time.Time  `json:"startedAt"`
	StoppedAt        *time.Time `json:"stoppedAt,omitempty"`
	CompletedAt      *time.Time `json:"completedAt,omitempty"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
}

// CheckpointRow is a run_checkpoints row.
type CheckpointRow struct {
	RunID             uuid.UUID
	ProcessedEventIDs []string
	IngestedEvents    []scenario.SimulationEvent
	TargetStates      map[string]*simulation.RuntimeTargetState
	CriticalAlertIDs  []string
	NextEventAt       *time.Time
	LastReconciledAt  time.Time
	RuntimeStatus     string
	UpdatedAt         time.Time
}

func (r *RunRow) ToSummary() RunSummary {
	return RunSummary{
		ID:               r.ID.String(),
		ScenarioID:       r.ScenarioID.String(),
		ScenarioName:     r.ScenarioName,
		Status:           r.Status,
		StartAt:          r.StartAt,
		ScheduleOffsetMs: r.ScheduleOffsetMs,
		StartedAt:        r.StartedAt,
		StoppedAt:        r.StoppedAt,
		CompletedAt:      r.CompletedAt,
		CreatedAt:        r.CreatedAt,
		UpdatedAt:        r.UpdatedAt,
	}
}

// CreateRun inserts a running run + empty checkpoint. Scenario must be ready.
func (s *RunStore) CreateRun(ctx context.Context, id, scenarioID uuid.UUID, startAt time.Time, offsetMs int64, runtime *simulation.Runtime) (*RunRow, error) {
	var status string
	var rowOwner *uuid.UUID
	err := s.Pool.QueryRow(ctx, `SELECT status, owner_user_id FROM scenarios WHERE id = $1`, scenarioID).Scan(&status, &rowOwner)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if !MatchesOwner(ContextOwner(ctx), rowOwner) {
		return nil, ErrNotFound
	}
	if status != scenario.StatusReady {
		return nil, ErrScenarioNotReady
	}

	now := time.Now().UTC()
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	_, err = tx.Exec(ctx, `
		INSERT INTO runs (id, scenario_id, status, start_at, schedule_offset_ms, started_at, created_at, updated_at)
		VALUES ($1, $2, 'running', $3, $4, $5, $5, $5)
	`, id, scenarioID, startAt.UTC(), offsetMs, now)
	if err != nil {
		return nil, fmt.Errorf("insert run: %w", err)
	}

	if err := upsertCheckpointAny(ctx, tx, id, runtime); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	_ = (&ScenarioStore{Pool: s.Pool}).EmitUsage(ctx, "run.started", &scenarioID, &id, map[string]any{
		"scheduleOffsetMs": offsetMs,
	})
	return s.Get(ctx, id)
}

// Get loads a run by id (includes scenario name for Active/detail UI).
// When ctx has an authenticated user, the run's scenario must be owned by that user.
func (s *RunStore) Get(ctx context.Context, id uuid.UUID) (*RunRow, error) {
	row := &RunRow{}
	var rowOwner *uuid.UUID
	err := s.Pool.QueryRow(ctx, `
		SELECT r.id, r.scenario_id, COALESCE(s.name, ''), r.status, r.start_at, r.schedule_offset_ms, r.started_at,
		       r.stopped_at, r.completed_at, r.created_at, r.updated_at, s.owner_user_id
		FROM runs r
		LEFT JOIN scenarios s ON s.id = r.scenario_id
		WHERE r.id = $1
	`, id).Scan(
		&row.ID, &row.ScenarioID, &row.ScenarioName, &row.Status, &row.StartAt, &row.ScheduleOffsetMs, &row.StartedAt,
		&row.StoppedAt, &row.CompletedAt, &row.CreatedAt, &row.UpdatedAt, &rowOwner,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrRunNotFound
	}
	if err != nil {
		return nil, err
	}
	if !MatchesOwner(ContextOwner(ctx), rowOwner) {
		return nil, ErrRunNotFound
	}
	return row, nil
}

// List returns active runs plus recently completed/stopped (newest first).
// Default (includeRecent=true): status=running OR updated within 24h — Active scenarios UI.
// active-only: status=running.
// When ctx has an authenticated user, only runs of that user's scenarios are returned.
func (s *RunStore) List(ctx context.Context, includeRecent bool) ([]RunSummary, error) {
	q := `
		SELECT r.id, r.scenario_id, COALESCE(s.name, ''), r.status, r.start_at, r.schedule_offset_ms, r.started_at,
		       r.stopped_at, r.completed_at, r.created_at, r.updated_at
		FROM runs r
		LEFT JOIN scenarios s ON s.id = r.scenario_id
	`
	args := []any{}
	where := []string{}
	if includeRecent {
		where = append(where, `(r.status = 'running' OR r.updated_at > now() - interval '24 hours')`)
	} else {
		where = append(where, `r.status = 'running'`)
	}
	if owner := ContextOwner(ctx); owner != nil {
		where = append(where, fmt.Sprintf(`s.owner_user_id = $%d`, len(args)+1))
		args = append(args, *owner)
	}
	q += ` WHERE ` + where[0]
	for i := 1; i < len(where); i++ {
		q += ` AND ` + where[i]
	}
	q += ` ORDER BY r.started_at DESC`

	rows, err := s.Pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []RunSummary{}
	for rows.Next() {
		var r RunRow
		if err := rows.Scan(
			&r.ID, &r.ScenarioID, &r.ScenarioName, &r.Status, &r.StartAt, &r.ScheduleOffsetMs, &r.StartedAt,
			&r.StoppedAt, &r.CompletedAt, &r.CreatedAt, &r.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, r.ToSummary())
	}
	return out, rows.Err()
}

// ListRunningIDs returns ids of runs still marked running.
func (s *RunStore) ListRunningIDs(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := s.Pool.Query(ctx, `SELECT id FROM runs WHERE status = 'running'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// UpdateStatus sets run status and optional timestamps.
func (s *RunStore) UpdateStatus(ctx context.Context, id uuid.UUID, status string, stoppedAt, completedAt *time.Time) error {
	now := time.Now().UTC()
	tag, err := s.Pool.Exec(ctx, `
		UPDATE runs
		SET status = $2, stopped_at = COALESCE($3, stopped_at), completed_at = COALESCE($4, completed_at), updated_at = $5
		WHERE id = $1
	`, id, status, stoppedAt, completedAt, now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrRunNotFound
	}
	return nil
}

// SaveCheckpoint persists runtime progress and syncs PostGIS target positions.
func (s *RunStore) SaveCheckpoint(ctx context.Context, runID uuid.UUID, runtime *simulation.Runtime) error {
	return upsertCheckpointAny(ctx, s.Pool, runID, runtime)
}

func upsertCheckpointAny(ctx context.Context, db any, runID uuid.UUID, runtime *simulation.Runtime) error {
	processed, err := json.Marshal(runtime.ProcessedEventIDs)
	if err != nil {
		return err
	}
	ingested, err := json.Marshal(runtime.IngestedEvents)
	if err != nil {
		return err
	}
	states := simulation.CloneTargetStates(runtime.TargetStates)
	targetStates, err := json.Marshal(states)
	if err != nil {
		return err
	}
	critical, err := json.Marshal(runtime.CriticalAlertIDs)
	if err != nil {
		return err
	}
	nextAt := simulation.NextEventAt(runtime)
	now := time.Now().UTC()
	lastRec := now
	if runtime.LastReconciledAt != "" {
		if t, err := time.Parse(time.RFC3339Nano, runtime.LastReconciledAt); err == nil {
			lastRec = t.UTC()
		}
	}
	const q = `
		INSERT INTO run_checkpoints (
			run_id, processed_event_ids, ingested_events, target_states, critical_alert_ids,
			next_event_at, last_reconciled_at, runtime_status, updated_at
		) VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7, $8, $9)
		ON CONFLICT (run_id) DO UPDATE SET
			processed_event_ids = EXCLUDED.processed_event_ids,
			ingested_events = EXCLUDED.ingested_events,
			target_states = EXCLUDED.target_states,
			critical_alert_ids = EXCLUDED.critical_alert_ids,
			next_event_at = EXCLUDED.next_event_at,
			last_reconciled_at = EXCLUDED.last_reconciled_at,
			runtime_status = EXCLUDED.runtime_status,
			updated_at = EXCLUDED.updated_at
	`
	args := []any{runID, processed, ingested, targetStates, critical, nextAt, lastRec, string(runtime.Status), now}
	switch e := db.(type) {
	case *pgxpool.Pool:
		_, err = e.Exec(ctx, q, args...)
		if err != nil {
			return err
		}
		return syncTargetPositions(ctx, e, runID, states, now)
	case pgx.Tx:
		_, err = e.Exec(ctx, q, args...)
		if err != nil {
			return err
		}
		return syncTargetPositions(ctx, e, runID, states, now)
	default:
		return fmt.Errorf("unsupported db type %T", db)
	}
}

type positionExecer interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

// SyncTargetPositions refreshes the PostGIS position index for a run (no checkpoint write).
func (s *RunStore) SyncTargetPositions(ctx context.Context, runID uuid.UUID, states map[string]*simulation.RuntimeTargetState) error {
	return syncTargetPositions(ctx, s.Pool, runID, simulation.CloneTargetStates(states), time.Now().UTC())
}

// QueryViewport returns target states whose current geom is in the bbox OR whose id is included.
// Uses PostGIS ST_MakeEnvelope. Targets without geom are only returned when included by id.
func (s *RunStore) QueryViewport(ctx context.Context, runID uuid.UUID, f viewport.Filter) (map[string]*simulation.RuntimeTargetState, error) {
	include := f.IncludeTargetIDs
	if include == nil {
		include = []string{}
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT target_id, state
		FROM run_target_positions
		WHERE run_id = $1
		  AND (
		    target_id = ANY($2::text[])
		    OR (
		      geom IS NOT NULL
		      AND geom && ST_MakeEnvelope($3, $4, $5, $6, 4326)::geography
		      AND ST_Intersects(geom, ST_MakeEnvelope($3, $4, $5, $6, 4326)::geography)
		    )
		  )
	`, runID, include, f.BBox.West, f.BBox.South, f.BBox.East, f.BBox.North)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[string]*simulation.RuntimeTargetState)
	for rows.Next() {
		var id string
		var raw []byte
		if err := rows.Scan(&id, &raw); err != nil {
			return nil, err
		}
		var st simulation.RuntimeTargetState
		if err := json.Unmarshal(raw, &st); err != nil {
			return nil, err
		}
		st.TargetID = id
		cloned := simulation.CloneTargetStates(map[string]*simulation.RuntimeTargetState{id: &st})
		out[id] = cloned[id]
	}
	return out, rows.Err()
}

func syncTargetPositions(ctx context.Context, db positionExecer, runID uuid.UUID, states map[string]*simulation.RuntimeTargetState, now time.Time) error {
	if _, err := db.Exec(ctx, `DELETE FROM run_target_positions WHERE run_id = $1`, runID); err != nil {
		return fmt.Errorf("clear target positions: %w", err)
	}
	for id, st := range states {
		if st == nil {
			continue
		}
		stateJSON, err := json.Marshal(st)
		if err != nil {
			return err
		}
		trailJSON, err := json.Marshal(st.Trail)
		if err != nil {
			return err
		}
		var posJSON []byte
		if st.Position != nil {
			posJSON, err = json.Marshal(st.Position)
			if err != nil {
				return err
			}
		}
		var lon, lat *float64
		if st.Position != nil {
			lon = &st.Position.Longitude
			lat = &st.Position.Latitude
		}
		_, err = db.Exec(ctx, `
			INSERT INTO run_target_positions (
				run_id, target_id, callsign, color, revealed, appeared,
				geom, position, trail, state, updated_at
			) VALUES (
				$1, $2, $3, $4, $5, $6,
				CASE WHEN $7::float8 IS NULL THEN NULL
				     ELSE ST_SetSRID(ST_MakePoint($7::float8, $8::float8), 4326)::geography
				END,
				$9::jsonb, $10::jsonb, $11::jsonb, $12
			)
		`, runID, id, st.Callsign, st.Color, st.Revealed, st.Appeared,
			lon, lat, nullableJSON(posJSON), trailJSON, stateJSON, now)
		if err != nil {
			return fmt.Errorf("upsert target position %s: %w", id, err)
		}
	}
	return nil
}

func nullableJSON(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	return b
}

// GetCheckpoint loads a checkpoint.
func (s *RunStore) GetCheckpoint(ctx context.Context, runID uuid.UUID) (*CheckpointRow, error) {
	var (
		processed, ingested, states, critical []byte
		row                                   CheckpointRow
	)
	row.RunID = runID
	err := s.Pool.QueryRow(ctx, `
		SELECT processed_event_ids, ingested_events, target_states, critical_alert_ids,
		       next_event_at, last_reconciled_at, runtime_status, updated_at
		FROM run_checkpoints WHERE run_id = $1
	`, runID).Scan(
		&processed, &ingested, &states, &critical,
		&row.NextEventAt, &row.LastReconciledAt, &row.RuntimeStatus, &row.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrRunNotFound
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(processed, &row.ProcessedEventIDs); err != nil {
		return nil, err
	}
	if row.ProcessedEventIDs == nil {
		row.ProcessedEventIDs = []string{}
	}
	if err := json.Unmarshal(ingested, &row.IngestedEvents); err != nil {
		return nil, err
	}
	if row.IngestedEvents == nil {
		row.IngestedEvents = []scenario.SimulationEvent{}
	}
	if err := json.Unmarshal(states, &row.TargetStates); err != nil {
		return nil, err
	}
	if row.TargetStates == nil {
		row.TargetStates = map[string]*simulation.RuntimeTargetState{}
	}
	if err := json.Unmarshal(critical, &row.CriticalAlertIDs); err != nil {
		return nil, err
	}
	if row.CriticalAlertIDs == nil {
		row.CriticalAlertIDs = []string{}
	}
	return &row, nil
}

// LoadScenarioDocument unmarshals the ready scenario payload.
func (s *RunStore) LoadScenarioDocument(ctx context.Context, scenarioID uuid.UUID) (*scenario.SimulationScenario, error) {
	var raw []byte
	var status string
	err := s.Pool.QueryRow(ctx, `SELECT status, payload FROM scenarios WHERE id = $1`, scenarioID).Scan(&status, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if status != scenario.StatusReady {
		return nil, ErrScenarioNotReady
	}
	var doc scenario.SimulationScenario
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("decode scenario payload: %w", err)
	}
	return &doc, nil
}

// BuildRuntimeFromCheckpoint reconstructs a Runtime for engine resume.
func (s *RunStore) BuildRuntimeFromCheckpoint(ctx context.Context, run *RunRow) (*simulation.Runtime, error) {
	doc, err := s.LoadScenarioDocument(ctx, run.ScenarioID)
	if err != nil {
		return nil, err
	}
	cp, err := s.GetCheckpoint(ctx, run.ID)
	if err != nil {
		return nil, err
	}
	rt := &simulation.Runtime{
		SchemaVersion:     2,
		Scenario:          *doc,
		Status:            simulation.RuntimeStatus(cp.RuntimeStatus),
		StartedAt:         run.StartedAt.UTC().Format(time.RFC3339Nano),
		ProcessedEventIDs: cp.ProcessedEventIDs,
		IngestedEvents:    cp.IngestedEvents,
		TargetStates:      cp.TargetStates,
		CriticalAlertIDs:  cp.CriticalAlertIDs,
		LastReconciledAt:  cp.LastReconciledAt.UTC().Format(time.RFC3339Nano),
		ScheduleOffsetMs:  run.ScheduleOffsetMs,
	}
	if run.StoppedAt != nil {
		rt.StoppedAt = run.StoppedAt.UTC().Format(time.RFC3339Nano)
	}
	if run.CompletedAt != nil {
		rt.CompletedAt = run.CompletedAt.UTC().Format(time.RFC3339Nano)
	}
	// Ensure all targets exist (checkpoint may omit empty profiles on old rows).
	if rt.TargetStates == nil {
		rt.TargetStates = map[string]*simulation.RuntimeTargetState{}
	}
	fresh := simulation.CreateRuntime(*doc, run.StartedAt, run.ScheduleOffsetMs)
	for id, st := range fresh.TargetStates {
		if _, ok := rt.TargetStates[id]; !ok {
			rt.TargetStates[id] = st
		}
	}
	return rt, nil
}
