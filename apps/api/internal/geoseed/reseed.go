package geoseed

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Reseeder runs async MBTiles → Postgres catalogue jobs (one at a time).
type Reseeder struct {
	Store       *Store
	MBTilesPath string
	Log         *slog.Logger
}

// StartReseed creates a job and runs Mine+Replace in a goroutine when the advisory lock is free.
func (r *Reseeder) StartReseed(ctx context.Context) (Job, error) {
	path := r.MBTilesPath
	if path == "" {
		return Job{}, fmt.Errorf("MBTILES_PATH is empty")
	}
	if _, err := os.Stat(path); err != nil {
		return Job{}, fmt.Errorf("mbtiles not found at %s: %w", path, err)
	}

	// Reject if a job is already running (cheap check before taking a conn).
	latest, err := r.Store.LatestJob(ctx)
	if err != nil {
		return Job{}, err
	}
	if latest != nil && (latest.Status == "queued" || latest.Status == "running") {
		return Job{}, ErrReseedBusy
	}

	conn, err := r.Store.Pool.Acquire(ctx)
	if err != nil {
		return Job{}, fmt.Errorf("acquire conn: %w", err)
	}

	ok, err := tryAdvisoryLockConn(ctx, conn)
	if err != nil {
		conn.Release()
		return Job{}, fmt.Errorf("advisory lock: %w", err)
	}
	if !ok {
		conn.Release()
		return Job{}, ErrReseedBusy
	}

	id := uuid.NewString()
	job, err := r.Store.CreateJob(ctx, id, path)
	if err != nil {
		_ = advisoryUnlockConn(ctx, conn)
		conn.Release()
		return Job{}, err
	}
	_ = r.Store.SetMetaStatus(ctx, "running", "", path)

	go r.run(conn, id, path)
	return job, nil
}

// ErrReseedBusy means another reseed holds the advisory lock or a job is in flight.
var ErrReseedBusy = fmt.Errorf("reseed already running")

func (r *Reseeder) run(conn *pgxpool.Conn, jobID, path string) {
	ctx := context.Background()
	log := r.Log
	if log == nil {
		log = slog.Default()
	}
	defer func() {
		_ = advisoryUnlockConn(ctx, conn)
		conn.Release()
	}()

	now := time.Now().UTC()
	_ = r.Store.UpdateJob(ctx, jobID, "running", "opening mbtiles", "", &now, nil)

	mb, err := OpenMBTiles(path)
	if err != nil {
		r.fail(ctx, jobID, err)
		return
	}
	defer mb.Close()

	_ = r.Store.UpdateJob(ctx, jobID, "running", "mining", "", nil, nil)
	cat, err := Mine(mb, MineOptions{Log: log})
	if err != nil {
		r.fail(ctx, jobID, err)
		return
	}

	_ = r.Store.UpdateJob(ctx, jobID, "running", "writing postgres", "", nil, nil)
	source := ReadSourceURL(path)
	if err := r.Store.ReplaceCatalogue(ctx, cat, path, source); err != nil {
		r.fail(ctx, jobID, err)
		return
	}

	finished := time.Now().UTC()
	_ = r.Store.UpdateJob(ctx, jobID, "succeeded", "done", "", nil, &finished)
	log.Info("geo reseed succeeded",
		"job_id", jobID,
		"aerodromes", len(cat.Aerodromes),
		"ports", len(cat.Ports),
		"sea_lanes", len(cat.SeaLanes),
		"road_anchors", len(cat.RoadAnchors),
		"regions", len(cat.Regions),
	)
}

func (r *Reseeder) fail(ctx context.Context, jobID string, err error) {
	finished := time.Now().UTC()
	msg := err.Error()
	_ = r.Store.UpdateJob(ctx, jobID, "failed", "failed", msg, nil, &finished)
	_ = r.Store.SetMetaStatus(ctx, "failed", msg, "")
	if r.Log != nil {
		r.Log.Error("geo reseed failed", "job_id", jobID, "err", err)
	}
}

func tryAdvisoryLockConn(ctx context.Context, conn *pgxpool.Conn) (bool, error) {
	var ok bool
	err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, reseedLockID).Scan(&ok)
	return ok, err
}

func advisoryUnlockConn(ctx context.Context, conn *pgxpool.Conn) error {
	_, err := conn.Exec(ctx, `SELECT pg_advisory_unlock($1)`, reseedLockID)
	return err
}

// RunSync mines and upserts synchronously (CLI).
func RunSync(ctx context.Context, store *Store, mbtilesPath string, log *slog.Logger) (*Catalogue, error) {
	if log == nil {
		log = slog.Default()
	}
	mb, err := OpenMBTiles(mbtilesPath)
	if err != nil {
		return nil, err
	}
	defer mb.Close()

	cat, err := Mine(mb, MineOptions{Log: log})
	if err != nil {
		return nil, err
	}
	if store != nil {
		source := ReadSourceURL(mbtilesPath)
		if err := store.ReplaceCatalogue(ctx, cat, mbtilesPath, source); err != nil {
			return nil, err
		}
	}
	return cat, nil
}
