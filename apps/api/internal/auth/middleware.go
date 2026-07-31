package auth

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/shammalie/adversary/apps/api/internal/config"
)

// Middleware loads the session cookie into context when AUTH_MODE=session.
// Mutating /v1 routes, owner-scoped reads, and WebSockets require a valid session.
// AUTH_MODE=off is a no-op (Compose / trusted local).
func Middleware(cfg *config.Config, svc *Service) func(http.Handler) http.Handler {
	mode := "off"
	if cfg != nil {
		mode = cfg.AuthMode
	}
	if mode != "session" || svc == nil {
		return func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				next.ServeHTTP(w, r)
			})
		}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if c, err := r.Cookie(CookieName); err == nil && c.Value != "" {
				userID, sessionID, err := svc.LookupToken(r.Context(), c.Value)
				if err == nil {
					ctx := WithUser(r.Context(), userID)
					ctx = WithSession(ctx, sessionID)
					r = r.WithContext(ctx)
				}
			}

			if requiresAuth(r) {
				if _, ok := UserID(r.Context()); !ok {
					writeUnauthorized(w)
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// requiresAuth reports whether the request must carry a session in session mode.
func requiresAuth(r *http.Request) bool {
	path := r.URL.Path
	if !strings.HasPrefix(path, "/v1/") {
		return false
	}
	switch path {
	case "/v1/auth/register", "/v1/auth/login", "/v1/auth/logout", "/v1/auth/me":
		return false
	}
	// Shared geo catalogue reads stay public.
	if (r.Method == http.MethodGet || r.Method == http.MethodHead) && strings.HasPrefix(path, "/v1/geo/") {
		return false
	}
	if strings.Contains(path, "/ws/") {
		return true
	}
	switch r.Method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	}
	// Owner-scoped resource reads (list/get/manage/admin meta).
	if strings.HasPrefix(path, "/v1/scenarios") ||
		strings.HasPrefix(path, "/v1/runs") ||
		strings.HasPrefix(path, "/v1/manage") ||
		strings.HasPrefix(path, "/v1/admin") {
		return true
	}
	return false
}

func writeUnauthorized(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": "authentication required"})
}

// SetSessionCookie writes the opaque session cookie.
func SetSessionCookie(w http.ResponseWriter, cfg *config.Config, token string, expiresAt time.Time) {
	secure := false
	if cfg != nil {
		secure = cfg.AuthCookieSecure
	}
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		Expires:  expiresAt,
		MaxAge:   int(time.Until(expiresAt).Seconds()),
	})
}

// ClearSessionCookie expires the session cookie.
func ClearSessionCookie(w http.ResponseWriter, cfg *config.Config) {
	secure := false
	if cfg != nil {
		secure = cfg.AuthCookieSecure
	}
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
		Expires:  time.Unix(0, 0).UTC(),
	})
}
