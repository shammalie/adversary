package geoseed

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store persists mined catalogues and job metadata in Postgres.
type Store struct {
	Pool *pgxpool.Pool
}

// Meta is the geo_seed_meta singleton view.
type Meta struct {
	SchemaV           int        `json:"schemaV"`
	GeneratedAt       *time.Time `json:"generatedAt,omitempty"`
	MBTilesPath       string     `json:"mbtilesPath"`
	MBTilesSourceURL  string     `json:"mbtilesSourceUrl"`
	JobStatus         string     `json:"jobStatus"`
	Error             string     `json:"error,omitempty"`
	AerodromeCount    int        `json:"aerodromeCount"`
	PortCount         int        `json:"portCount"`
	SeaLaneCount      int        `json:"seaLaneCount"`
	RoadAnchorCount   int        `json:"roadAnchorCount"`
	RegionCount       int        `json:"regionCount"`
	MBTilesExists     bool       `json:"mbtilesExists"`
	UpdatedAt         time.Time  `json:"updatedAt"`
}

// Job is a geo_reseed_jobs row.
type Job struct {
	ID          string     `json:"id"`
	Status      string     `json:"status"`
	MBTilesPath string     `json:"mbtilesPath"`
	Progress    string     `json:"progress"`
	Error       string     `json:"error,omitempty"`
	StartedAt   *time.Time `json:"startedAt,omitempty"`
	FinishedAt  *time.Time `json:"finishedAt,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
}

// ReadSourceURL reads the first non-comment line from SOURCE.txt beside the MBTiles.
func ReadSourceURL(mbtilesPath string) string {
	dir := filepath.Dir(mbtilesPath)
	data, err := os.ReadFile(filepath.Join(dir, "SOURCE.txt"))
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		return line
	}
	return ""
}

// ReplaceCatalogue atomically replaces all seed tables with cat.
func (s *Store) ReplaceCatalogue(ctx context.Context, cat *Catalogue, mbtilesPath, sourceURL string) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	stmts := []string{
		`DELETE FROM geo_road_anchors`,
		`DELETE FROM geo_sea_lanes`,
		`DELETE FROM geo_ports`,
		`DELETE FROM geo_aerodromes`,
		`DELETE FROM geo_regions`,
	}
	for _, q := range stmts {
		if _, err := tx.Exec(ctx, q); err != nil {
			return fmt.Errorf("%s: %w", q, err)
		}
	}

	for _, r := range cat.Regions {
		_, err := tx.Exec(ctx, `
			INSERT INTO geo_regions (id, name, west, south, east, north, bbox, supports)
			VALUES (
				$1, $2, $3, $4, $5, $6,
				ST_MakeEnvelope($3, $4, $5, $6, 4326)::geography,
				$7
			)`,
			r.ID, r.Name, r.BBox[0], r.BBox[1], r.BBox[2], r.BBox[3], r.Supports,
		)
		if err != nil {
			return fmt.Errorf("insert region %s: %w", r.ID, err)
		}
	}

	for _, a := range cat.Aerodromes {
		runways, err := json.Marshal(a.Runways)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO geo_aerodromes (icao, iata, name, class, ele_ft, geom, runways)
			VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography, $8::jsonb)`,
			a.ICAO, a.IATA, a.Name, a.Class, a.EleFt, a.Lng, a.Lat, string(runways),
		)
		if err != nil {
			return fmt.Errorf("insert aerodrome: %w", err)
		}
	}

	for _, p := range cat.Ports {
		_, err := tx.Exec(ctx, `
			INSERT INTO geo_ports (name, kind, geom)
			VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography)`,
			p.Name, p.Kind, p.Lng, p.Lat,
		)
		if err != nil {
			return fmt.Errorf("insert port: %w", err)
		}
	}

	for _, p := range cat.SeaLanes {
		_, err := tx.Exec(ctx, `
			INSERT INTO geo_sea_lanes (geom)
			VALUES (ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)`,
			p.Lng, p.Lat,
		)
		if err != nil {
			return fmt.Errorf("insert sea lane: %w", err)
		}
	}

	for _, a := range cat.RoadAnchors {
		_, err := tx.Exec(ctx, `
			INSERT INTO geo_road_anchors (region_id, geom)
			VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography)`,
			a.RegionID, a.Lng, a.Lat,
		)
		if err != nil {
			return fmt.Errorf("insert road anchor: %w", err)
		}
	}

	now := time.Now().UTC()
	_, err = tx.Exec(ctx, `
		UPDATE geo_seed_meta SET
			schema_v = $1,
			generated_at = $2,
			mbtiles_path = $3,
			mbtiles_source_url = $4,
			job_status = 'succeeded',
			error = '',
			aerodrome_count = $5,
			port_count = $6,
			sea_lane_count = $7,
			road_anchor_count = $8,
			region_count = $9,
			updated_at = $2
		WHERE id = 1`,
		SchemaV, now, mbtilesPath, sourceURL,
		len(cat.Aerodromes), len(cat.Ports), len(cat.SeaLanes),
		len(cat.RoadAnchors), len(cat.Regions),
	)
	if err != nil {
		return fmt.Errorf("update meta: %w", err)
	}

	return tx.Commit(ctx)
}

// GetMeta returns the singleton catalogue meta + path health.
func (s *Store) GetMeta(ctx context.Context, mbtilesPathFallback string) (Meta, error) {
	var m Meta
	var generatedAt *time.Time
	err := s.Pool.QueryRow(ctx, `
		SELECT schema_v, generated_at, mbtiles_path, mbtiles_source_url, job_status, error,
		       aerodrome_count, port_count, sea_lane_count, road_anchor_count, region_count, updated_at
		FROM geo_seed_meta WHERE id = 1`,
	).Scan(
		&m.SchemaV, &generatedAt, &m.MBTilesPath, &m.MBTilesSourceURL, &m.JobStatus, &m.Error,
		&m.AerodromeCount, &m.PortCount, &m.SeaLaneCount, &m.RoadAnchorCount, &m.RegionCount, &m.UpdatedAt,
	)
	if err != nil {
		return Meta{}, err
	}
	m.GeneratedAt = generatedAt
	path := m.MBTilesPath
	if path == "" {
		path = mbtilesPathFallback
	}
	if path != "" {
		if _, err := os.Stat(path); err == nil {
			m.MBTilesExists = true
		}
	}
	return m, nil
}

// SetMetaStatus updates job_status / error on the singleton.
func (s *Store) SetMetaStatus(ctx context.Context, status, errMsg, mbtilesPath string) error {
	_, err := s.Pool.Exec(ctx, `
		UPDATE geo_seed_meta SET job_status = $1, error = $2,
			mbtiles_path = CASE WHEN $3 = '' THEN mbtiles_path ELSE $3 END,
			updated_at = now()
		WHERE id = 1`, status, errMsg, mbtilesPath)
	return err
}

// TryAdvisoryLock attempts to take the reseed advisory lock (non-blocking) on a pooled query.
// Prefer holding a dedicated *pgxpool.Conn for the job lifetime (see Reseeder).
func (s *Store) TryAdvisoryLock(ctx context.Context) (bool, error) {
	var ok bool
	err := s.Pool.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, reseedLockID).Scan(&ok)
	return ok, err
}

// AdvisoryUnlock releases the reseed advisory lock on a pooled query.
func (s *Store) AdvisoryUnlock(ctx context.Context) error {
	_, err := s.Pool.Exec(ctx, `SELECT pg_advisory_unlock($1)`, reseedLockID)
	return err
}

// CreateJob inserts a queued reseed job.
func (s *Store) CreateJob(ctx context.Context, id, mbtilesPath string) (Job, error) {
	var j Job
	err := s.Pool.QueryRow(ctx, `
		INSERT INTO geo_reseed_jobs (id, status, mbtiles_path, progress)
		VALUES ($1, 'queued', $2, 'queued')
		RETURNING id::text, status, mbtiles_path, progress, error, started_at, finished_at, created_at`,
		id, mbtilesPath,
	).Scan(&j.ID, &j.Status, &j.MBTilesPath, &j.Progress, &j.Error, &j.StartedAt, &j.FinishedAt, &j.CreatedAt)
	return j, err
}

// UpdateJob updates job fields.
func (s *Store) UpdateJob(ctx context.Context, id, status, progress, errMsg string, started, finished *time.Time) error {
	_, err := s.Pool.Exec(ctx, `
		UPDATE geo_reseed_jobs SET
			status = $2,
			progress = $3,
			error = $4,
			started_at = COALESCE($5, started_at),
			finished_at = COALESCE($6, finished_at)
		WHERE id = $1::uuid`,
		id, status, progress, errMsg, started, finished,
	)
	return err
}

// GetJob returns a job by id.
func (s *Store) GetJob(ctx context.Context, id string) (Job, error) {
	var j Job
	err := s.Pool.QueryRow(ctx, `
		SELECT id::text, status, mbtiles_path, progress, error, started_at, finished_at, created_at
		FROM geo_reseed_jobs WHERE id = $1::uuid`, id,
	).Scan(&j.ID, &j.Status, &j.MBTilesPath, &j.Progress, &j.Error, &j.StartedAt, &j.FinishedAt, &j.CreatedAt)
	if err == pgx.ErrNoRows {
		return Job{}, ErrNotFound
	}
	return j, err
}

// LatestJob returns the most recent reseed job, if any.
func (s *Store) LatestJob(ctx context.Context) (*Job, error) {
	var j Job
	err := s.Pool.QueryRow(ctx, `
		SELECT id::text, status, mbtiles_path, progress, error, started_at, finished_at, created_at
		FROM geo_reseed_jobs ORDER BY created_at DESC LIMIT 1`,
	).Scan(&j.ID, &j.Status, &j.MBTilesPath, &j.Progress, &j.Error, &j.StartedAt, &j.FinishedAt, &j.CreatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &j, nil
}

// ErrNotFound indicates a missing row.
var ErrNotFound = fmt.Errorf("not found")

// ListRegions returns all geo_regions.
func (s *Store) ListRegions(ctx context.Context) ([]Region, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, name, west, south, east, north, supports FROM geo_regions ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Region
	for rows.Next() {
		var r Region
		var supports []string
		if err := rows.Scan(&r.ID, &r.Name, &r.BBox[0], &r.BBox[1], &r.BBox[2], &r.BBox[3], &supports); err != nil {
			return nil, err
		}
		r.Supports = supports
		out = append(out, r)
	}
	return out, rows.Err()
}

// PointRow is a geo feature with lng/lat for API responses.
type PointRow struct {
	ID       int64          `json:"id"`
	Lng      float64        `json:"lng"`
	Lat      float64        `json:"lat"`
	Name     string         `json:"name,omitempty"`
	Kind     string         `json:"kind,omitempty"`
	ICAO     string         `json:"icao,omitempty"`
	IATA     string         `json:"iata,omitempty"`
	Class    string         `json:"class,omitempty"`
	EleFt    int            `json:"eleFt,omitempty"`
	Runways  json.RawMessage `json:"runways,omitempty"`
	RegionID string         `json:"regionId,omitempty"`
}

// ListAerodromesInBBox returns aerodromes intersecting the envelope.
func (s *Store) ListAerodromesInBBox(ctx context.Context, west, south, east, north float64, limit int) ([]PointRow, error) {
	if limit <= 0 || limit > 5000 {
		limit = 2000
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT id, icao, iata, name, class, ele_ft, ST_X(geom::geometry), ST_Y(geom::geometry), runways
		FROM geo_aerodromes
		WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography
		LIMIT $5`, west, south, east, north, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PointRow
	for rows.Next() {
		var p PointRow
		if err := rows.Scan(&p.ID, &p.ICAO, &p.IATA, &p.Name, &p.Class, &p.EleFt, &p.Lng, &p.Lat, &p.Runways); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ListPortsInBBox returns ports in bbox.
func (s *Store) ListPortsInBBox(ctx context.Context, west, south, east, north float64, limit int) ([]PointRow, error) {
	if limit <= 0 || limit > 10000 {
		limit = 5000
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT id, name, kind, ST_X(geom::geometry), ST_Y(geom::geometry)
		FROM geo_ports
		WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography
		LIMIT $5`, west, south, east, north, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PointRow
	for rows.Next() {
		var p PointRow
		if err := rows.Scan(&p.ID, &p.Name, &p.Kind, &p.Lng, &p.Lat); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ListSeaLanesInBBox returns sea-lane points in bbox.
func (s *Store) ListSeaLanesInBBox(ctx context.Context, west, south, east, north float64, limit int) ([]PointRow, error) {
	if limit <= 0 || limit > 10000 {
		limit = 5000
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT id, ST_X(geom::geometry), ST_Y(geom::geometry)
		FROM geo_sea_lanes
		WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography
		LIMIT $5`, west, south, east, north, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PointRow
	for rows.Next() {
		var p PointRow
		if err := rows.Scan(&p.ID, &p.Lng, &p.Lat); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ListRoadAnchorsInBBox returns road anchors in bbox.
func (s *Store) ListRoadAnchorsInBBox(ctx context.Context, west, south, east, north float64, limit int) ([]PointRow, error) {
	if limit <= 0 || limit > 5000 {
		limit = 2000
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT id, region_id, ST_X(geom::geometry), ST_Y(geom::geometry)
		FROM geo_road_anchors
		WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography
		LIMIT $5`, west, south, east, north, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PointRow
	for rows.Next() {
		var p PointRow
		if err := rows.Scan(&p.ID, &p.RegionID, &p.Lng, &p.Lat); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
