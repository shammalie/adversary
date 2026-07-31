package geoseed_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shammalie/adversary/apps/api/internal/db"
	"github.com/shammalie/adversary/apps/api/internal/geoseed"
)

// Must match geoseed.reseedLockID (0xAE50_5EED).
const reseedLockKey int64 = 0xAE505EED

func openPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	pool, err := db.NewPool(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func TestAdvisoryLockOneAtATime(t *testing.T) {
	pool := openPool(t)
	ctx := context.Background()

	connA, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer connA.Release()

	var okA bool
	if err := connA.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, reseedLockKey).Scan(&okA); err != nil {
		t.Fatal(err)
	}
	if !okA {
		t.Fatal("expected first connection to take advisory lock")
	}
	t.Cleanup(func() {
		_, _ = connA.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, reseedLockKey)
	})

	connB, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer connB.Release()

	var okB bool
	if err := connB.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, reseedLockKey).Scan(&okB); err != nil {
		t.Fatal(err)
	}
	if okB {
		t.Fatal("second connection must not take advisory lock while held")
	}
}

func TestStartReseedBusyWhenJobInFlight(t *testing.T) {
	pool := openPool(t)
	store := &geoseed.Store{Pool: pool}
	ctx := context.Background()

	dir := t.TempDir()
	mbPath := filepath.Join(dir, "openmaptiles.mbtiles")
	if err := os.WriteFile(mbPath, []byte("not-a-real-mbtiles"), 0o644); err != nil {
		t.Fatal(err)
	}

	jobID := uuid.NewString()
	if _, err := store.CreateJob(ctx, jobID, mbPath); err != nil {
		t.Fatalf("CreateJob: %v", err)
	}
	now := time.Now().UTC()
	if err := store.UpdateJob(ctx, jobID, "running", "held for test", "", &now, nil); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM geo_reseed_jobs WHERE id = $1`, jobID)
	})

	r := &geoseed.Reseeder{Store: store, MBTilesPath: mbPath}
	_, err := r.StartReseed(ctx)
	if !errors.Is(err, geoseed.ErrReseedBusy) {
		t.Fatalf("expected ErrReseedBusy, got %v", err)
	}
}
