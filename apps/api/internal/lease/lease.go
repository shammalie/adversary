package lease

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/samber/do/v2"
)

// DefaultTTL is how long a lease stays valid without renewal.
const DefaultTTL = 15 * time.Second

// ErrNotHeld is returned when renew/release finds another owner (or no lease).
var ErrNotHeld = errors.New("lease not held")

// Store persists run leases in Postgres.
type Store struct {
	Pool *pgxpool.Pool
	TTL  time.Duration
}

// Package registers the lease store.
var Package = do.Package(
	do.Lazy(Provide),
)

// Provide wires the lease store from the pgx pool.
func Provide(i do.Injector) (*Store, error) {
	pool := do.MustInvoke[*pgxpool.Pool](i)
	return &Store{Pool: pool, TTL: DefaultTTL}, nil
}

func (s *Store) ttl() time.Duration {
	if s.TTL <= 0 {
		return DefaultTTL
	}
	return s.TTL
}

// Acquire tries to take or steal an expired lease for runID.
// Returns true if this instance now owns the lease.
func (s *Store) Acquire(ctx context.Context, runID uuid.UUID, instanceID string) (bool, error) {
	now := time.Now().UTC()
	expires := now.Add(s.ttl())

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var owner string
	var exp time.Time
	err = tx.QueryRow(ctx, `
		SELECT owner_instance_id, expires_at FROM run_leases WHERE run_id = $1 FOR UPDATE
	`, runID).Scan(&owner, &exp)

	if errors.Is(err, pgx.ErrNoRows) {
		_, err = tx.Exec(ctx, `
			INSERT INTO run_leases (run_id, owner_instance_id, expires_at, updated_at)
			VALUES ($1, $2, $3, $4)
		`, runID, instanceID, expires, now)
		if err != nil {
			return false, fmt.Errorf("insert lease: %w", err)
		}
		if err := tx.Commit(ctx); err != nil {
			return false, err
		}
		return true, nil
	}
	if err != nil {
		return false, err
	}

	if owner == instanceID || !exp.After(now) {
		_, err = tx.Exec(ctx, `
			UPDATE run_leases
			SET owner_instance_id = $2, expires_at = $3, updated_at = $4
			WHERE run_id = $1
		`, runID, instanceID, expires, now)
		if err != nil {
			return false, fmt.Errorf("update lease: %w", err)
		}
		if err := tx.Commit(ctx); err != nil {
			return false, err
		}
		return true, nil
	}

	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return false, nil
}

// Renew extends the lease if still owned by instanceID.
func (s *Store) Renew(ctx context.Context, runID uuid.UUID, instanceID string) error {
	now := time.Now().UTC()
	expires := now.Add(s.ttl())
	tag, err := s.Pool.Exec(ctx, `
		UPDATE run_leases
		SET expires_at = $3, updated_at = $4
		WHERE run_id = $1 AND owner_instance_id = $2 AND expires_at > $4
	`, runID, instanceID, expires, now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotHeld
	}
	return nil
}

// Release drops the lease if owned by instanceID.
func (s *Store) Release(ctx context.Context, runID uuid.UUID, instanceID string) error {
	tag, err := s.Pool.Exec(ctx, `
		DELETE FROM run_leases WHERE run_id = $1 AND owner_instance_id = $2
	`, runID, instanceID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotHeld
	}
	return nil
}

// Owner returns the current lease owner and expiry, if any.
func (s *Store) Owner(ctx context.Context, runID uuid.UUID) (owner string, expiresAt time.Time, ok bool, err error) {
	err = s.Pool.QueryRow(ctx, `
		SELECT owner_instance_id, expires_at FROM run_leases WHERE run_id = $1
	`, runID).Scan(&owner, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", time.Time{}, false, nil
	}
	if err != nil {
		return "", time.Time{}, false, err
	}
	return owner, expiresAt, true, nil
}
