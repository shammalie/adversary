package engine_test

import (
	"testing"

	"go.uber.org/goleak"

	"github.com/shammalie/adversary/apps/api/internal/engine"
	"github.com/shammalie/adversary/apps/api/internal/lease"
)

func TestMain(m *testing.M) {
	goleak.VerifyTestMain(m)
}

// Compile-time check: Postgres lease store satisfies the engine lease surface.
var _ engine.LeaseHolder = (*lease.Store)(nil)
