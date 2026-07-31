package store

import (
	"context"

	"github.com/google/uuid"

	"github.com/shammalie/adversary/apps/api/internal/auth"
)

// ContextOwner returns the authenticated user id when present (AUTH_MODE=session).
func ContextOwner(ctx context.Context) *uuid.UUID {
	return auth.UserIDPtr(ctx)
}

// MatchesOwner reports whether rowOwner is accessible to owner.
// When owner is nil (AUTH_MODE=off), all rows match.
func MatchesOwner(owner, rowOwner *uuid.UUID) bool {
	if owner == nil {
		return true
	}
	return rowOwner != nil && *rowOwner == *owner
}
