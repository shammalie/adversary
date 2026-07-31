package store

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ManageScenarioRow is a storage-management list item.
type ManageScenarioRow struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Status      string    `json:"status"`
	UpdatedAt   time.Time `json:"updatedAt"`
	SizeBytes   int64     `json:"sizeBytes"`
	TargetCount int       `json:"targetCount"`
	EventCount  int       `json:"eventCount"`
	OwnerUserID *string   `json:"ownerUserId,omitempty"`
	ActiveRuns  int       `json:"activeRuns"`
}

// ManageListResult is a paginated manage scenarios response.
type ManageListResult struct {
	Items  []ManageScenarioRow `json:"items"`
	Total  int                 `json:"total"`
	Limit  int                 `json:"limit"`
	Offset int                 `json:"offset"`
}

// ManageListFilter filters manage scenario listings.
type ManageListFilter struct {
	Status      string // empty = all; draft|ready
	Q           string // name ILIKE
	Limit       int
	Offset      int
	OwnerUserID *uuid.UUID // session mode: scope to owner
}

// ManageStats aggregates storage / run counts.
type ManageStats struct {
	DraftCount        int   `json:"draftCount"`
	ReadyCount        int   `json:"readyCount"`
	TotalPayloadBytes int64 `json:"totalPayloadBytes"`
	RunsActive        int   `json:"runsActive"`
	RunsCompleted     int   `json:"runsCompleted"`
	RunsStopped       int   `json:"runsStopped"`
	ScenarioCount     int   `json:"scenarioCount"`
}

// UsageBucket is a time-bucketed usage_events aggregate.
type UsageBucket struct {
	Bucket time.Time      `json:"bucket"`
	Counts map[string]int `json:"counts"`
	Total  int            `json:"total"`
}

// UsageMetricsResult is the manage usage metrics response.
type UsageMetricsResult struct {
	From     time.Time      `json:"from"`
	To       time.Time      `json:"to"`
	Bucket   string         `json:"bucket"`
	Totals   map[string]int `json:"totals"`
	Buckets  []UsageBucket  `json:"buckets"`
	UserID   *string        `json:"userId,omitempty"`
	ClientID *string        `json:"clientId,omitempty"`
}

// UsageQuery filters usage_events rollups.
type UsageQuery struct {
	From     time.Time
	To       time.Time
	UserID   *uuid.UUID
	ClientID string // matches properties->>'client_id'
	Bucket   string // 15m | 1h | 1d
}

// ListManageScenarios returns paginated scenarios with size and counts.
func (s *ScenarioStore) ListManageScenarios(ctx context.Context, f ManageListFilter) (*ManageListResult, error) {
	if f.Limit <= 0 || f.Limit > 200 {
		f.Limit = 50
	}
	if f.Offset < 0 {
		f.Offset = 0
	}

	if f.OwnerUserID == nil {
		f.OwnerUserID = ContextOwner(ctx)
	}
	where := []string{"1=1"}
	args := []any{}
	argN := 1
	if f.Status == "draft" || f.Status == "ready" {
		where = append(where, fmt.Sprintf("s.status = $%d", argN))
		args = append(args, f.Status)
		argN++
	}
	if q := strings.TrimSpace(f.Q); q != "" {
		where = append(where, fmt.Sprintf("s.name ILIKE $%d", argN))
		args = append(args, "%"+q+"%")
		argN++
	}
	if f.OwnerUserID != nil {
		where = append(where, fmt.Sprintf("s.owner_user_id = $%d", argN))
		args = append(args, *f.OwnerUserID)
		argN++
	}
	whereSQL := strings.Join(where, " AND ")

	var total int
	countQ := `SELECT COUNT(*) FROM scenarios s WHERE ` + whereSQL
	if err := s.Pool.QueryRow(ctx, countQ, args...).Scan(&total); err != nil {
		return nil, err
	}

	listArgs := append(append([]any{}, args...), f.Limit, f.Offset)
	listQ := fmt.Sprintf(`
		SELECT s.id, s.name, s.status, s.updated_at,
		       octet_length(s.payload::text)::bigint AS size_bytes,
		       (SELECT COUNT(*) FROM targets t WHERE t.scenario_id = s.id),
		       (SELECT COUNT(*) FROM events e WHERE e.scenario_id = s.id),
		       s.owner_user_id,
		       (SELECT COUNT(*) FROM runs r WHERE r.scenario_id = s.id AND r.status = 'running')
		FROM scenarios s
		WHERE %s
		ORDER BY s.updated_at DESC
		LIMIT $%d OFFSET $%d
	`, whereSQL, argN, argN+1)

	rows, err := s.Pool.Query(ctx, listQ, listArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []ManageScenarioRow{}
	for rows.Next() {
		var item ManageScenarioRow
		var id uuid.UUID
		var owner *uuid.UUID
		if err := rows.Scan(
			&id, &item.Name, &item.Status, &item.UpdatedAt, &item.SizeBytes,
			&item.TargetCount, &item.EventCount, &owner, &item.ActiveRuns,
		); err != nil {
			return nil, err
		}
		item.ID = id.String()
		if owner != nil {
			str := owner.String()
			item.OwnerUserID = &str
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &ManageListResult{Items: items, Total: total, Limit: f.Limit, Offset: f.Offset}, nil
}

// GetManageStats returns aggregate storage / run stats.
func (s *ScenarioStore) GetManageStats(ctx context.Context) (*ManageStats, error) {
	st := &ManageStats{}
	owner := ContextOwner(ctx)
	var err error
	if owner != nil {
		err = s.Pool.QueryRow(ctx, `
			SELECT
				COUNT(*) FILTER (WHERE status = 'draft'),
				COUNT(*) FILTER (WHERE status = 'ready'),
				COUNT(*),
				COALESCE(SUM(octet_length(payload::text)), 0)
			FROM scenarios
			WHERE owner_user_id = $1
		`, *owner).Scan(&st.DraftCount, &st.ReadyCount, &st.ScenarioCount, &st.TotalPayloadBytes)
	} else {
		err = s.Pool.QueryRow(ctx, `
			SELECT
				COUNT(*) FILTER (WHERE status = 'draft'),
				COUNT(*) FILTER (WHERE status = 'ready'),
				COUNT(*),
				COALESCE(SUM(octet_length(payload::text)), 0)
			FROM scenarios
		`).Scan(&st.DraftCount, &st.ReadyCount, &st.ScenarioCount, &st.TotalPayloadBytes)
	}
	if err != nil {
		return nil, err
	}
	if owner != nil {
		err = s.Pool.QueryRow(ctx, `
			SELECT
				COUNT(*) FILTER (WHERE r.status = 'running'),
				COUNT(*) FILTER (WHERE r.status = 'completed'),
				COUNT(*) FILTER (WHERE r.status = 'stopped')
			FROM runs r
			INNER JOIN scenarios s ON s.id = r.scenario_id
			WHERE s.owner_user_id = $1
		`, *owner).Scan(&st.RunsActive, &st.RunsCompleted, &st.RunsStopped)
	} else {
		err = s.Pool.QueryRow(ctx, `
			SELECT
				COUNT(*) FILTER (WHERE status = 'running'),
				COUNT(*) FILTER (WHERE status = 'completed'),
				COUNT(*) FILTER (WHERE status = 'stopped')
			FROM runs
		`).Scan(&st.RunsActive, &st.RunsCompleted, &st.RunsStopped)
	}
	if err != nil {
		return nil, err
	}
	return st, nil
}

// ListRunningIDsForScenario returns running run ids for a scenario.
func (s *ScenarioStore) ListRunningIDsForScenario(ctx context.Context, scenarioID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id FROM runs WHERE scenario_id = $1 AND status = 'running'
	`, scenarioID)
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

// ForceStopRun marks a run stopped without going through the engine (tests / fallback).
func (s *ScenarioStore) ForceStopRun(ctx context.Context, runID uuid.UUID) error {
	now := time.Now().UTC()
	_, err := s.Pool.Exec(ctx, `
		UPDATE runs SET status = 'stopped', stopped_at = $2, updated_at = $2
		WHERE id = $1 AND status = 'running'
	`, runID, now)
	return err
}

// DeleteRunsForScenario removes all runs (and cascaded checkpoints/leases/positions) for a scenario.
func (s *ScenarioStore) DeleteRunsForScenario(ctx context.Context, scenarioID uuid.UUID) (int64, error) {
	tag, err := s.Pool.Exec(ctx, `DELETE FROM runs WHERE scenario_id = $1`, scenarioID)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// CountActiveRuns returns the number of running runs.
func (s *ScenarioStore) CountActiveRuns(ctx context.Context) (int, error) {
	var n int
	err := s.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM runs WHERE status = 'running'`).Scan(&n)
	return n, err
}

// CountOwnedLeases returns unexpired leases for instanceID.
func (s *ScenarioStore) CountOwnedLeases(ctx context.Context, instanceID string) (int, error) {
	var n int
	err := s.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM run_leases
		WHERE owner_instance_id = $1 AND expires_at > now()
	`, instanceID).Scan(&n)
	return n, err
}

// CountActiveReseedJobs returns queued/running geo reseed jobs.
func (s *ScenarioStore) CountActiveReseedJobs(ctx context.Context) (int, error) {
	var n int
	err := s.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM geo_reseed_jobs WHERE status IN ('queued', 'running')
	`).Scan(&n)
	return n, err
}

// QueryUsageMetrics aggregates usage_events into time buckets.
func (s *ScenarioStore) QueryUsageMetrics(ctx context.Context, q UsageQuery) (*UsageMetricsResult, error) {
	bucket := normalizeBucket(q.Bucket)
	if q.To.IsZero() {
		q.To = time.Now().UTC()
	}
	if q.From.IsZero() {
		q.From = q.To.Add(-24 * time.Hour)
	}

	where := []string{"occurred_at >= $1", "occurred_at < $2"}
	args := []any{q.From.UTC(), q.To.UTC()}
	argN := 3
	if q.UserID != nil {
		where = append(where, fmt.Sprintf("user_id = $%d", argN))
		args = append(args, *q.UserID)
		argN++
	}
	if cid := strings.TrimSpace(q.ClientID); cid != "" {
		where = append(where, fmt.Sprintf("properties->>'client_id' = $%d", argN))
		args = append(args, cid)
		argN++
	}
	whereSQL := strings.Join(where, " AND ")

	var selectBucket string
	switch bucket {
	case "15m":
		selectBucket = `to_timestamp(floor(extract(epoch FROM occurred_at) / 900) * 900)`
	case "1d":
		selectBucket = `date_trunc('day', occurred_at AT TIME ZONE 'UTC')`
	default:
		selectBucket = `date_trunc('hour', occurred_at AT TIME ZONE 'UTC')`
	}

	sql := fmt.Sprintf(`
		SELECT %s AS bucket, event_type, COUNT(*)::int
		FROM usage_events
		WHERE %s
		GROUP BY 1, 2
		ORDER BY 1
	`, selectBucket, whereSQL)

	rows, err := s.Pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	totals := map[string]int{}
	byBucket := map[time.Time]*UsageBucket{}
	var order []time.Time

	for rows.Next() {
		var b time.Time
		var et string
		var n int
		if err := rows.Scan(&b, &et, &n); err != nil {
			return nil, err
		}
		b = b.UTC()
		totals[et] += n
		ub, ok := byBucket[b]
		if !ok {
			ub = &UsageBucket{Bucket: b, Counts: map[string]int{}}
			byBucket[b] = ub
			order = append(order, b)
		}
		ub.Counts[et] = n
		ub.Total += n
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	buckets := make([]UsageBucket, 0, len(order))
	for _, t := range order {
		buckets = append(buckets, *byBucket[t])
	}

	out := &UsageMetricsResult{
		From:    q.From.UTC(),
		To:      q.To.UTC(),
		Bucket:  bucket,
		Totals:  totals,
		Buckets: buckets,
	}
	if q.UserID != nil {
		str := q.UserID.String()
		out.UserID = &str
	}
	if cid := strings.TrimSpace(q.ClientID); cid != "" {
		out.ClientID = &cid
	}
	return out, nil
}

func normalizeBucket(b string) string {
	switch strings.ToLower(strings.TrimSpace(b)) {
	case "15m", "15min":
		return "15m"
	case "1d", "day", "d":
		return "1d"
	default:
		return "1h"
	}
}
