package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/shammalie/adversary/apps/api/internal/auth"
	"github.com/shammalie/adversary/apps/api/internal/config"
	"github.com/shammalie/adversary/apps/api/internal/store"
)

// AuthHandlers serves /v1/auth/*.
type AuthHandlers struct {
	Svc   *auth.Service
	Cfg   *config.Config
	Store *store.ScenarioStore // optional; used for auth.login usage_events
}

type authCredentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type authUserResponse struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	CreatedAt time.Time `json:"createdAt"`
}

type authSessionResponse struct {
	User      authUserResponse `json:"user"`
	ExpiresAt time.Time        `json:"expiresAt"`
}

func userResponse(u auth.User) authUserResponse {
	return authUserResponse{
		ID:        u.ID.String(),
		Email:     u.Email,
		CreatedAt: u.CreatedAt,
	}
}

// Register godoc
// @Summary      Register
// @Description  Creates a user and sets the HttpOnly session cookie (AUTH_MODE=session).
// @Tags         auth
// @Accept       json
// @Produce      json
// @Param        body body authCredentials true "email + password (min 8)"
// @Success      201 {object} authSessionResponse
// @Failure      400 {object} errorBody
// @Failure      409 {object} errorBody
// @Failure      503 {object} errorBody
// @Router       /v1/auth/register [post]
func (h *AuthHandlers) Register(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.Svc == nil || h.Cfg == nil || h.Cfg.AuthMode != "session" {
		writeJSON(w, http.StatusServiceUnavailable, errorBody{Error: "auth mode is off"})
		return
	}
	var req authCredentials
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid JSON body"})
		return
	}
	info, err := h.Svc.Register(r.Context(), req.Email, req.Password)
	if errors.Is(err, auth.ErrInvalidEmail) || errors.Is(err, auth.ErrWeakPassword) {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: err.Error()})
		return
	}
	if errors.Is(err, auth.ErrEmailTaken) {
		writeJSON(w, http.StatusConflict, errorBody{Error: err.Error()})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "register failed"})
		return
	}
	auth.SetSessionCookie(w, h.Cfg, info.Token, info.ExpiresAt)
	ctx := auth.WithUser(r.Context(), info.User.ID)
	if h.Store != nil {
		_ = h.Store.EmitUsage(ctx, "auth.register", nil, nil, nil)
	}
	writeJSON(w, http.StatusCreated, authSessionResponse{
		User:      userResponse(info.User),
		ExpiresAt: info.ExpiresAt,
	})
}

// Login godoc
// @Summary      Login
// @Description  Verifies credentials and sets the HttpOnly session cookie (AUTH_MODE=session).
// @Tags         auth
// @Accept       json
// @Produce      json
// @Param        body body authCredentials true "email + password"
// @Success      200 {object} authSessionResponse
// @Failure      400 {object} errorBody
// @Failure      401 {object} errorBody
// @Failure      503 {object} errorBody
// @Router       /v1/auth/login [post]
func (h *AuthHandlers) Login(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.Svc == nil || h.Cfg == nil || h.Cfg.AuthMode != "session" {
		writeJSON(w, http.StatusServiceUnavailable, errorBody{Error: "auth mode is off"})
		return
	}
	var req authCredentials
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid JSON body"})
		return
	}
	info, err := h.Svc.Login(r.Context(), req.Email, req.Password)
	if errors.Is(err, auth.ErrInvalidCredentials) {
		writeJSON(w, http.StatusUnauthorized, errorBody{Error: "invalid email or password"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "login failed"})
		return
	}
	auth.SetSessionCookie(w, h.Cfg, info.Token, info.ExpiresAt)
	ctx := auth.WithUser(r.Context(), info.User.ID)
	if h.Store != nil {
		_ = h.Store.EmitUsage(ctx, "auth.login", nil, nil, nil)
	}
	writeJSON(w, http.StatusOK, authSessionResponse{
		User:      userResponse(info.User),
		ExpiresAt: info.ExpiresAt,
	})
}

// Logout godoc
// @Summary      Logout
// @Description  Clears the session cookie and deletes the server session when present.
// @Tags         auth
// @Success      204 "No Content"
// @Router       /v1/auth/logout [post]
func (h *AuthHandlers) Logout(w http.ResponseWriter, r *http.Request) {
	var cfg *config.Config
	if h != nil {
		cfg = h.Cfg
		if h.Svc != nil {
			if sid, ok := auth.SessionID(r.Context()); ok {
				_ = h.Svc.LogoutSession(r.Context(), sid)
			} else if c, err := r.Cookie(auth.CookieName); err == nil {
				_ = h.Svc.Logout(r.Context(), c.Value)
			}
		}
	}
	auth.ClearSessionCookie(w, cfg)
	w.WriteHeader(http.StatusNoContent)
}

// Me godoc
// @Summary      Current user
// @Description  Returns the authenticated user when the session cookie is valid.
// @Tags         auth
// @Produce      json
// @Success      200 {object} authUserResponse
// @Failure      401 {object} errorBody
// @Failure      503 {object} errorBody
// @Router       /v1/auth/me [get]
func (h *AuthHandlers) Me(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.Svc == nil || h.Cfg == nil || h.Cfg.AuthMode != "session" {
		writeJSON(w, http.StatusServiceUnavailable, errorBody{Error: "auth mode is off"})
		return
	}
	uid, ok := auth.UserID(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, errorBody{Error: "authentication required"})
		return
	}
	u, err := h.Svc.GetUser(r.Context(), uid)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errorBody{Error: "authentication required"})
		return
	}
	writeJSON(w, http.StatusOK, userResponse(*u))
}
