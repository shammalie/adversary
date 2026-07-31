package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shammalie/adversary/apps/api/internal/scenario"
	"github.com/shammalie/adversary/apps/api/internal/usage"
)

// ErrNotFound is returned when a scenario row is missing.
var ErrNotFound = errors.New("scenario not found")

// ScenarioStore persists scenarios, normalized rows, and usage events.
type ScenarioStore struct {
	Pool *pgxpool.Pool
}

// ScenarioRow is a scenarios table row.
type ScenarioRow struct {
	ID            uuid.UUID
	Name          string
	Status        string
	Payload       json.RawMessage
	SchemaVersion int
	OwnerUserID   *uuid.UUID
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// ScenarioSummary is a list item (no full payload).
type ScenarioSummary struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	Status        string    `json:"status"`
	SchemaVersion int       `json:"schemaVersion"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

// ListFilter filters scenario listings.
type ListFilter struct {
	Status      string     // empty = all; draft|ready
	OwnerUserID *uuid.UUID // when set (session mode), only that owner's rows
}

// CreateDraft inserts a new draft scenario.
func (s *ScenarioStore) CreateDraft(ctx context.Context, id uuid.UUID, name string, payload any, schemaVersion int) (*ScenarioRow, error) {
	if schemaVersion == 0 {
		schemaVersion = 2
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal payload: %w", err)
	}
	now := time.Now().UTC()
	owner := ContextOwner(ctx)
	_, err = s.Pool.Exec(ctx, `
		INSERT INTO scenarios (id, name, status, payload, schema_version, owner_user_id, created_at, updated_at)
		VALUES ($1, $2, 'draft', $3::jsonb, $4, $5, $6, $6)
	`, id, name, raw, schemaVersion, owner, now)
	if err != nil {
		return nil, fmt.Errorf("insert scenario: %w", err)
	}
	_ = s.EmitUsage(ctx, "scenario.draft_saved", &id, nil, map[string]any{"created": true})
	return s.Get(ctx, id)
}

// UpsertDraft saves incomplete JSON (never rejects for validation). Reverts ready→draft and clears normalized rows.
func (s *ScenarioStore) UpsertDraft(ctx context.Context, id uuid.UUID, name string, payload any, schemaVersion int) (*ScenarioRow, error) {
	if schemaVersion == 0 {
		schemaVersion = 2
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal payload: %w", err)
	}
	now := time.Now().UTC()

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	owner := ContextOwner(ctx)
	var (
		exists    bool
		rowOwner  *uuid.UUID
	)
	err = tx.QueryRow(ctx, `SELECT owner_user_id FROM scenarios WHERE id = $1`, id).Scan(&rowOwner)
	if err == nil {
		exists = true
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	if exists {
		if !MatchesOwner(owner, rowOwner) {
			return nil, ErrNotFound
		}
		_, err = tx.Exec(ctx, `
			UPDATE scenarios
			SET name = $2, status = 'draft', payload = $3::jsonb, schema_version = $4, updated_at = $5
			WHERE id = $1
		`, id, name, raw, schemaVersion, now)
		if err != nil {
			return nil, fmt.Errorf("update draft: %w", err)
		}
		if _, err := tx.Exec(ctx, `DELETE FROM events WHERE scenario_id = $1`, id); err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM targets WHERE scenario_id = $1`, id); err != nil {
			return nil, err
		}
	} else {
		_, err = tx.Exec(ctx, `
			INSERT INTO scenarios (id, name, status, payload, schema_version, owner_user_id, created_at, updated_at)
			VALUES ($1, $2, 'draft', $3::jsonb, $4, $5, $6, $6)
		`, id, name, raw, schemaVersion, owner, now)
		if err != nil {
			return nil, fmt.Errorf("insert draft: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	_ = s.EmitUsage(ctx, "scenario.draft_saved", &id, nil, map[string]any{"upsert": true})
	return s.Get(ctx, id)
}

// Publish sets status=ready and writes normalized targets/events. Caller must validate first.
func (s *ScenarioStore) Publish(ctx context.Context, id uuid.UUID, doc *scenario.SimulationScenario) (*ScenarioRow, error) {
	raw, err := json.Marshal(doc)
	if err != nil {
		return nil, fmt.Errorf("marshal payload: %w", err)
	}
	now := time.Now().UTC()
	name := doc.Name
	if name == "" {
		name = "Untitled"
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := s.requireOwner(ctx, id); err != nil {
		return nil, err
	}

	tag, err := tx.Exec(ctx, `
		UPDATE scenarios
		SET name = $2, status = 'ready', payload = $3::jsonb, schema_version = $4, updated_at = $5
		WHERE id = $1
	`, id, name, raw, doc.SchemaVersion, now)
	if err != nil {
		return nil, fmt.Errorf("update ready: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}

	if _, err := tx.Exec(ctx, `DELETE FROM events WHERE scenario_id = $1`, id); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM targets WHERE scenario_id = $1`, id); err != nil {
		return nil, err
	}

	for _, t := range doc.Targets {
		tdef, err := json.Marshal(t)
		if err != nil {
			return nil, err
		}
		prof, err := json.Marshal(t.Profile)
		if err != nil {
			return nil, err
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO targets (
				scenario_id, id, callsign, reveal_on_first_event, appear_on_first_event,
				color, profile, max_cruise_knots, definition
			) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb)
		`, id, t.ID, t.Callsign, t.RevealOnFirstEvent, t.AppearOnFirstEvent, t.Color, prof, t.MaxCruiseKnots, tdef)
		if err != nil {
			return nil, fmt.Errorf("insert target %s: %w", t.ID, err)
		}
	}

	for _, e := range doc.Events {
		edef, err := json.Marshal(e)
		if err != nil {
			return nil, err
		}
		var pos any
		if e.Position != nil {
			pos, err = json.Marshal(e.Position)
			if err != nil {
				return nil, err
			}
		}
		at, err := parseTime(e.At)
		if err != nil {
			return nil, fmt.Errorf("event %s at: %w", e.ID, err)
		}
		var firesAt *time.Time
		if e.FiresAt != "" {
			t, err := parseTime(e.FiresAt)
			if err != nil {
				return nil, fmt.Errorf("event %s firesAt: %w", e.ID, err)
			}
			firesAt = &t
		}
		var msg *string
		if e.Message != "" {
			msg = &e.Message
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO events (scenario_id, id, target_id, at, fires_at, position, message, definition)
			VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb)
		`, id, e.ID, e.TargetID, at, firesAt, pos, msg, edef)
		if err != nil {
			return nil, fmt.Errorf("insert event %s: %w", e.ID, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	_ = s.EmitUsage(ctx, "scenario.published", &id, nil, map[string]any{
		"targetCount": len(doc.Targets),
		"eventCount":  len(doc.Events),
	})
	return s.Get(ctx, id)
}

// ImportUpsert stores an imported document as draft or ready.
func (s *ScenarioStore) ImportUpsert(ctx context.Context, id uuid.UUID, name string, payload any, schemaVersion int, ready *scenario.SimulationScenario) (*ScenarioRow, error) {
	if ready != nil {
		// Ensure row exists then publish.
		if _, err := s.UpsertDraft(ctx, id, name, payload, schemaVersion); err != nil {
			return nil, err
		}
		return s.Publish(ctx, id, ready)
	}
	return s.UpsertDraft(ctx, id, name, payload, schemaVersion)
}

// Get loads a scenario by id (enforces owner when AUTH_MODE=session sets ctx user).
func (s *ScenarioStore) Get(ctx context.Context, id uuid.UUID) (*ScenarioRow, error) {
	row := &ScenarioRow{}
	err := s.Pool.QueryRow(ctx, `
		SELECT id, name, status, payload, schema_version, owner_user_id, created_at, updated_at
		FROM scenarios WHERE id = $1
	`, id).Scan(
		&row.ID, &row.Name, &row.Status, &row.Payload, &row.SchemaVersion,
		&row.OwnerUserID, &row.CreatedAt, &row.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if !MatchesOwner(ContextOwner(ctx), row.OwnerUserID) {
		return nil, ErrNotFound
	}
	return row, nil
}

// List returns scenario summaries, newest first.
func (s *ScenarioStore) List(ctx context.Context, f ListFilter) ([]ScenarioSummary, error) {
	if f.OwnerUserID == nil {
		f.OwnerUserID = ContextOwner(ctx)
	}
	q := `
		SELECT id, name, status, schema_version, created_at, updated_at
		FROM scenarios
	`
	args := []any{}
	where := []string{}
	if f.Status == scenario.StatusDraft || f.Status == scenario.StatusReady {
		where = append(where, fmt.Sprintf("status = $%d", len(args)+1))
		args = append(args, f.Status)
	}
	if f.OwnerUserID != nil {
		where = append(where, fmt.Sprintf("owner_user_id = $%d", len(args)+1))
		args = append(args, *f.OwnerUserID)
	}
	if len(where) > 0 {
		q += ` WHERE ` + where[0]
		for i := 1; i < len(where); i++ {
			q += ` AND ` + where[i]
		}
	}
	q += ` ORDER BY updated_at DESC`

	rows, err := s.Pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []ScenarioSummary{}
	for rows.Next() {
		var item ScenarioSummary
		var id uuid.UUID
		if err := rows.Scan(&id, &item.Name, &item.Status, &item.SchemaVersion, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		item.ID = id.String()
		out = append(out, item)
	}
	return out, rows.Err()
}

// PatchName updates the denormalized name and payload.name when present.
func (s *ScenarioStore) PatchName(ctx context.Context, id uuid.UUID, name string) (*ScenarioRow, error) {
	row, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	var payload any
	if err := json.Unmarshal(row.Payload, &payload); err != nil {
		payload = map[string]any{}
	}
	if m, ok := payload.(map[string]any); ok {
		m["name"] = name
		payload = m
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	_, err = s.Pool.Exec(ctx, `
		UPDATE scenarios SET name = $2, payload = $3::jsonb, updated_at = $4 WHERE id = $1
	`, id, name, raw, now)
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, id)
}

// Delete removes a scenario (cascades targets/events).
func (s *ScenarioStore) Delete(ctx context.Context, id uuid.UUID) error {
	if err := s.requireOwner(ctx, id); err != nil {
		return err
	}
	tag, err := s.Pool.Exec(ctx, `DELETE FROM scenarios WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	_ = s.EmitUsage(ctx, "scenario.deleted", &id, nil, nil)
	return nil
}

// requireOwner returns ErrNotFound when the row is missing or not owned by ctx user.
func (s *ScenarioStore) requireOwner(ctx context.Context, id uuid.UUID) error {
	owner := ContextOwner(ctx)
	if owner == nil {
		var exists bool
		if err := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM scenarios WHERE id = $1)`, id).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrNotFound
		}
		return nil
	}
	var rowOwner *uuid.UUID
	err := s.Pool.QueryRow(ctx, `SELECT owner_user_id FROM scenarios WHERE id = $1`, id).Scan(&rowOwner)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if !MatchesOwner(owner, rowOwner) {
		return ErrNotFound
	}
	return nil
}

// CountNormalized returns target/event counts for a ready scenario (tests / diagnostics).
func (s *ScenarioStore) CountNormalized(ctx context.Context, id uuid.UUID) (targets, events int, err error) {
	err = s.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM targets WHERE scenario_id = $1`, id).Scan(&targets)
	if err != nil {
		return
	}
	err = s.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM events WHERE scenario_id = $1`, id).Scan(&events)
	return
}

// EmitUsage inserts a usage_events row (best-effort; ignores errors at call sites).
// AUTH_MODE=off records user_id=null. Session mode sets user_id from ctx when authenticated.
// Optional X-Client-Id is stored in properties.client_id when present on ctx.
func (s *ScenarioStore) EmitUsage(ctx context.Context, eventType string, scenarioID, runID *uuid.UUID, props map[string]any) error {
	if props == nil {
		props = map[string]any{}
	} else {
		// Shallow copy so callers' maps are not mutated.
		cp := make(map[string]any, len(props)+1)
		for k, v := range props {
			cp[k] = v
		}
		props = cp
	}
	if cid := usage.ClientID(ctx); cid != "" {
		if _, ok := props["client_id"]; !ok {
			props["client_id"] = cid
		}
	}
	raw, err := json.Marshal(props)
	if err != nil {
		return err
	}
	userID := ContextOwner(ctx)
	_, err = s.Pool.Exec(ctx, `
		INSERT INTO usage_events (event_type, scenario_id, run_id, user_id, properties)
		VALUES ($1, $2, $3, $4, $5::jsonb)
	`, eventType, scenarioID, runID, userID, raw)
	return err
}

func parseTime(iso string) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339Nano, iso); err == nil {
		return t.UTC(), nil
	}
	if t, err := time.Parse(time.RFC3339, iso); err == nil {
		return t.UTC(), nil
	}
	return time.Time{}, fmt.Errorf("invalid time %q", iso)
}
