package auth

import (
	"context"

	"github.com/google/uuid"
)

type ctxKey int

const (
	userIDKey ctxKey = iota + 1
	sessionIDKey
)

// WithUser stores the authenticated user id on ctx.
func WithUser(ctx context.Context, userID uuid.UUID) context.Context {
	return context.WithValue(ctx, userIDKey, userID)
}

// WithSession stores the session row id on ctx (for logout).
func WithSession(ctx context.Context, sessionID uuid.UUID) context.Context {
	return context.WithValue(ctx, sessionIDKey, sessionID)
}

// UserID returns the authenticated user id when present.
func UserID(ctx context.Context) (uuid.UUID, bool) {
	id, ok := ctx.Value(userIDKey).(uuid.UUID)
	return id, ok
}

// UserIDPtr returns a pointer to the authenticated user id, or nil.
func UserIDPtr(ctx context.Context) *uuid.UUID {
	id, ok := UserID(ctx)
	if !ok {
		return nil
	}
	return &id
}

// SessionID returns the session id when present.
func SessionID(ctx context.Context) (uuid.UUID, bool) {
	id, ok := ctx.Value(sessionIDKey).(uuid.UUID)
	return id, ok
}
