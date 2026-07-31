// Package usage carries optional client attribution on the request context.
package usage

import "context"

type ctxKey int

const clientIDKey ctxKey = 1

// WithClientID stores an optional client id (from X-Client-Id) on ctx.
func WithClientID(ctx context.Context, id string) context.Context {
	if id == "" {
		return ctx
	}
	return context.WithValue(ctx, clientIDKey, id)
}

// ClientID returns the optional client id from ctx.
func ClientID(ctx context.Context) string {
	v, _ := ctx.Value(clientIDKey).(string)
	return v
}
