package lease_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/goleak"

	"github.com/shammalie/adversary/apps/api/internal/db"
	"github.com/shammalie/adversary/apps/api/internal/lease"
)

func TestMain(m *testing.M) {
	goleak.VerifyTestMain(m)
}

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

// ensureRunRow inserts a minimal runs row so run_leases FK succeeds.
func ensureRunRow(t *testing.T, pool *pgxpool.Pool, runID uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	// scenarios.id is required by runs FK — create a throwaway draft scenario.
	var scenarioID uuid.UUID
	err := pool.QueryRow(ctx, `
		INSERT INTO scenarios (id, name, status, payload, created_at, updated_at)
		VALUES (gen_random_uuid(), 'lease-test', 'draft', '{}'::jsonb, now(), now())
		RETURNING id
	`).Scan(&scenarioID)
	if err != nil {
		t.Fatalf("insert scenario: %v", err)
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO runs (id, scenario_id, status, start_at, schedule_offset_ms, created_at, updated_at)
		VALUES ($1, $2, 'running', now(), 0, now(), now())
	`, runID, scenarioID)
	if err != nil {
		t.Fatalf("insert run: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM run_leases WHERE run_id = $1`, runID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM runs WHERE id = $1`, runID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM scenarios WHERE id = $1`, scenarioID)
	})
}

func TestAcquireStealRenewFailure(t *testing.T) {
	pool := openPool(t)
	store := &lease.Store{Pool: pool, TTL: 200 * time.Millisecond}
	ctx := context.Background()
	runID := uuid.New()
	ensureRunRow(t, pool, runID)

	ok, err := store.Acquire(ctx, runID, "inst-a")
	if err != nil || !ok {
		t.Fatalf("acquire a: ok=%v err=%v", ok, err)
	}

	// Active lease cannot be stolen by another instance.
	ok, err = store.Acquire(ctx, runID, "inst-b")
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("expected steal denied while lease unexpired")
	}

	// Renew by non-owner fails → ticker must stop (engine contract).
	if err := store.Renew(ctx, runID, "inst-b"); !errors.Is(err, lease.ErrNotHeld) {
		t.Fatalf("renew non-owner: %v", err)
	}

	// Wait for TTL expiry, then steal.
	time.Sleep(250 * time.Millisecond)
	ok, err = store.Acquire(ctx, runID, "inst-b")
	if err != nil || !ok {
		t.Fatalf("steal after expiry: ok=%v err=%v", ok, err)
	}

	// Previous holder renew fails immediately after steal.
	if err := store.Renew(ctx, runID, "inst-a"); !errors.Is(err, lease.ErrNotHeld) {
		t.Fatalf("renew after steal: %v", err)
	}

	owner, _, held, err := store.Owner(ctx, runID)
	if err != nil || !held || owner != "inst-b" {
		t.Fatalf("owner=%q held=%v err=%v", owner, held, err)
	}

	if err := store.Release(ctx, runID, "inst-b"); err != nil {
		t.Fatal(err)
	}
}
