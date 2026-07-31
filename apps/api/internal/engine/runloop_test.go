package engine

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/shammalie/adversary/apps/api/internal/lease"
)

// failRenewLease acquires successfully then fails every Renew (steal / expiry).
type failRenewLease struct{}

func (failRenewLease) Acquire(context.Context, uuid.UUID, string) (bool, error) {
	return true, nil
}

func (failRenewLease) Renew(context.Context, uuid.UUID, string) error {
	return lease.ErrNotHeld
}

func (failRenewLease) Release(context.Context, uuid.UUID, string) error {
	return nil
}

func TestRunLoopStopsOnRenewFailure(t *testing.T) {
	m := &Manager{
		Leases:     failRenewLease{},
		Log:        slog.Default(),
		InstanceID: "test-instance",
		runners:    make(map[uuid.UUID]context.CancelFunc),
	}
	m.rootCtx, m.cancel = context.WithCancel(context.Background())
	t.Cleanup(func() { m.cancel() })

	runID := uuid.New()
	m.spawn(runID)

	done := make(chan struct{})
	go func() {
		m.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		// ticker exited without leaking the runLoop goroutine
	case <-time.After(2 * time.Second):
		t.Fatal("run ticker did not stop after renew failure")
	}

	m.mu.Lock()
	_, still := m.runners[runID]
	m.mu.Unlock()
	if still {
		t.Fatal("runner map still holds cancelled run")
	}
}

func TestStopLocalCancelsTicker(t *testing.T) {
	// Lease renews forever; stopLocal must cancel the loop.
	m := &Manager{
		Leases:     holdLease{},
		Log:        slog.Default(),
		InstanceID: "test-instance",
		runners:    make(map[uuid.UUID]context.CancelFunc),
	}
	m.rootCtx, m.cancel = context.WithCancel(context.Background())
	t.Cleanup(func() { m.cancel() })

	runID := uuid.New()
	// Avoid tickOnce needing Runs: cancel immediately after spawn registers.
	m.mu.Lock()
	ctx, cancel := context.WithCancel(m.rootCtx)
	m.runners[runID] = cancel
	m.mu.Unlock()
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		defer func() {
			m.mu.Lock()
			delete(m.runners, runID)
			m.mu.Unlock()
		}()
		<-ctx.Done()
	}()

	m.stopLocal(runID)

	done := make(chan struct{})
	go func() {
		m.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("stopLocal did not cancel runner")
	}
	_ = runID
}

// holdLease never fails renew (used only for cancel-path tests).
type holdLease struct{}

func (holdLease) Acquire(context.Context, uuid.UUID, string) (bool, error) {
	return true, nil
}
func (holdLease) Renew(context.Context, uuid.UUID, string) error { return nil }
func (holdLease) Release(context.Context, uuid.UUID, string) error {
	return nil
}
